import { WebSerialController, SerialLineTransformer, prepareGcode, marlinFrame, type MachineSerialPort, type MachineSerial } from "../src/cam/webSerialController";
import { initialMachineState, useMachineStore } from "../src/store/useMachineStore";
import { machineDocumentTransform, DEFAULT_GRBL_LASER_PROFILE } from "../src/cam/gcodeCompiler";

function assert(value: unknown, description: string): asserts value { if (!value) throw new Error(description); }
const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean, description: string, timeout = 2000) {
  const start = Date.now();
  while (!test()) { if (Date.now() - start > timeout) throw new Error(`Timeout: ${description}`); await sleep(); }
}
const snapshot = () => useMachineStore.getState();

class FakePort extends EventTarget implements MachineSerialPort {
  readable: ReadableStream<Uint8Array<ArrayBuffer>> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  input!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  writes: string[] = [];
  closeCount = 0;
  openCount = 0;
  baud = 0;
  delayOpen: Promise<void> | null = null;
  onWrite: ((text: string) => void) | null = null;
  async open(options: { baudRate: number }) {
    await this.delayOpen;
    this.openCount++; this.baud = options.baudRate;
    this.readable = new ReadableStream({ start: (controller) => { this.input = controller; } });
    this.writable = new WritableStream({ write: (bytes) => {
      const text = new TextDecoder().decode(bytes); this.writes.push(text); this.onWrite?.(text);
    } });
  }
  async close() {
    assert(!this.readable?.locked && !this.writable?.locked, "Serial locks must be released before port.close");
    this.closeCount++; this.readable = null; this.writable = null;
  }
  send(text: string) { this.input.enqueue(new TextEncoder().encode(text)); }
}
class FakeSerial extends EventTarget implements MachineSerial {
  constructor(readonly port = new FakePort()) { super(); }
  async requestPort() { return this.port; }
  async getPorts() { return [this.port]; }
  event(type: string, port = this.port) {
    const event = new Event(type); Object.defineProperty(event, "port", { value: port }); this.dispatchEvent(event);
  }
}
async function fixture(dialect: "grbl" | "marlin" = "grbl", reportInches = false) {
  useMachineStore.setState({ ...initialMachineState });
  const serial = new FakeSerial();
  const driver = new WebSerialController(() => serial, 0);
  await driver.connect(115200, dialect);
  if (dialect === "grbl") {
    await until(() => serial.port.writes.includes("$$\n"), "GRBL handshake");
    serial.port.send(`$13=${reportInches ? 1 : 0}\r\nok\r\n`);
    await sleep();
    serial.port.send("<Idle|MPos:10,20,30|WCO:1,2,3|FS:100,250|Ov:110,100,90>\r\n");
  } else {
    await until(() => serial.port.writes.some((wire) => wire.includes("M110 N0")), "Marlin initialization");
    serial.port.send("ok\n"); await sleep();
    serial.port.send("ok\n"); await sleep();
    serial.port.send("ok\n"); await sleep();
    serial.port.send("X:1 Y:2 Z:3 Count X:80 Y:160 Z:1200\nok\n");
  }
  await until(() => snapshot().ready, "controller ready");
  return { serial, port: serial.port, driver };
}

// Chunk boundaries, CRLF, and partial trailing acknowledgements.
{
  const transform = new SerialLineTransformer(); const lines: string[] = [];
  const sink = { enqueue: (line: string) => lines.push(line) } as TransformStreamDefaultController<string>;
  transform.transform("o", sink); transform.transform("k\r", sink);
  transform.transform("\n<Idle|MPos:1,2,3>\nok", sink);
  assert(lines.join(";") === "ok;<Idle|MPos:1,2,3>", "Line splitting must retain incomplete responses");
  const source = prepareGcode("; heading\r\nG21 (mm)\r\n\nG1 X1; end\n");
  assert(source.length === 2 && source[1]?.sourceLine === 4, "Executable lines retain source indices");
  for (const source of ["G1 X1!", "G1 Xé", "G1 " + "X".repeat(80), "G10 L20 P1 X0", "G10L20P1X0", "G28.1X0", "$13=1", "N3 G1 X1*12"]) {
    let rejected = false; try { prepareGcode(source); } catch { rejected = true; }
    assert(rejected, `Reject unsafe stream input: ${source}`);
  }
}
{
  const { driver, port } = await fixture("grbl", true);
  assert(Math.abs(snapshot().workPosition.x - 228.6) < 1e-9, "$13 inch reports converted to mm with WCO");
  assert(snapshot().feedRateOverride === 110 && snapshot().spindleSpeedOverride === 90, "Override status parsing");
  port.send("<Run|WPos:2,3,4>\n"); await sleep();
  assert(Math.abs(snapshot().machinePosition.x - 76.2) < 1e-9, "Cached WCO reconstructs MPos from WPos");
  port.send("<Idle|MPos:0,0,0>\n"); await sleep();
  const before = port.writes.filter((line) => line === "?").length;
  await sleep(450);
  // Supply reports so the next 200ms query isn't deliberately suppressed.
  port.send("<Idle|MPos:0,0,0>\n"); await sleep(220);
  assert(port.writes.filter((line) => line === "?").length > before, "Status queries poll when connected");
  await driver.disconnect();
  const writes = port.writes.length; await sleep(240);
  assert(port.writes.length === writes && port.closeCount === 1, "Disconnect stops polling and releases streams");
}
{
  const { driver, port } = await fixture();
  const commands = Array.from({ length: 16 }, (_, i) => `G1 X${i}.123 Y100.456 F600`);
  driver.runJob(commands.join("\n"), 120);
  await sleep();
  assert(snapshot().bufferLevel <= 127 && snapshot().bufferLevel > 80, "GRBL fills available RX capacity conservatively");
  const firstCount = port.writes.filter((line) => line.startsWith("G1")).length;
  assert(firstCount > 1 && firstCount < commands.length, "GRBL sends a window, not an unbounded job");
  port.send("<Run|MPos:1,2,3|FS:600,0>\n[MSG:ok]\n"); await sleep();
  assert(snapshot().acknowledgedLines === 0, "Status/feedback must not acknowledge commands");
  port.send("o"); await sleep(); assert(snapshot().acknowledgedLines === 0, "Partial ok not processed");
  port.send("k\r\n"); await sleep();
  assert(snapshot().acknowledgedLines === 1 && port.writes.filter((line) => line.startsWith("G1")).length > firstCount, "Ack frees exact bytes and refills window");
  await driver.feedHold();
  const held = port.writes.filter((line) => line.startsWith("G1")).length;
  port.send("ok\n<Hold:0|MPos:1,2,3>\n"); await sleep();
  assert(snapshot().jobStatus === "paused" && port.writes.at(-1) === "!", "Hold bypasses full RX queue");
  assert(port.writes.filter((line) => line.startsWith("G1")).length === held, "Hold blocks unsent job lines");
  await driver.resume();
  await sleep();
  assert(port.writes.includes("~") && snapshot().jobStatus === "streaming", "Resume requires explicit command");
  for (let i = snapshot().acknowledgedLines; i < commands.length; i++) { port.send("ok\n"); await sleep(); }
  assert(snapshot().jobStatus === "draining", "All ok responses do not prove completed motion");
  // Discard an older query response, then answer the post-drain poll.
  port.send("<Run|MPos:1,2,3>\n"); await sleep(230);
  port.send("<Idle|MPos:1,2,3>\n"); await sleep();
  assert(snapshot().jobStatus === "complete", "Fresh Idle confirms motion completion");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  driver.runJob(Array.from({ length: 40 }, (_, i) => `G1 X${i} F600`).join("\n")); await sleep();
  const count = port.writes.filter((line) => line.startsWith("G1")).length;
  port.send("error:2\nok\n"); await sleep();
  assert(snapshot().jobStatus === "aborted" && !snapshot().ready && port.writes.includes("!"), "Parser error halts stream");
  assert(port.writes.filter((line) => line.startsWith("G1")).length === count, "Following ok cannot resume failed stream");
  await driver.softReset();
  assert(port.writes.includes("\x18"), "Reset sends a raw Ctrl-X byte");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  await driver.feedHold();
  driver.jog("X", -0.1, 600); await sleep();
  assert(port.writes.includes("$J=G21 G91 X-0.100 F600\n"), "Jog is incremental with explicit millimetres");
  let blocked = false; try { driver.zeroWorkOffset(); } catch { blocked = true; }
  assert(blocked, "Manual command cannot overlap jogging");
  port.send("ok\n"); await sleep(); port.send("<Idle|MPos:0,0,0>\n"); await sleep(220); port.send("<Idle|MPos:0,0,0>\n"); await sleep();
  driver.zeroWorkOffset(); await sleep();
  assert(port.writes.at(-1) === "G54\n", "Select G54 before zeroing P1");
  port.send("ok\n"); await sleep();
  assert(port.writes.includes("G10 L20 P1 X0 Y0 Z0\n"), "GRBL zero uses G10 L20");
  await driver.disconnect();
}
{
  const { driver, port, serial } = await fixture();
  driver.runJob("G1 X1\nG1 X2\n"); await sleep();
  serial.event("disconnect"); await until(() => port.closeCount === 1, "Unplug cleanup");
  assert(snapshot().jobStatus === "aborted" && snapshot().connectionStatus === "error", "Unplug aborts job");
  serial.event("connect", new FakePort()); await sleep(); assert(port.openCount === 1, "Do not reconnect an unrelated port");
  serial.event("connect"); await until(() => port.openCount === 2, "Authorized same-port reconnect");
  await sleep(); assert(snapshot().jobStatus === "aborted" && snapshot().acknowledgedLines === 0, "Reconnect must not resume a job");
  await driver.disconnect();
  serial.event("connect"); await sleep(); assert(port.openCount === 2, "Explicit disconnect disables reconnect");
}
{
  const { driver, port } = await fixture("marlin");
  assert(!snapshot().machinePositionKnown && snapshot().workPosition.x === 1, "Marlin Count fields are not machine coordinates");
  const base = port.writes.length;
  driver.runJob("G21\nG1 X2\n"); await sleep();
  assert(port.writes.length === base + 1, "Marlin keeps one numbered line outstanding");
  const frame = port.writes.at(-1)!;
  const number = Number(/^N(\d+)/.exec(frame)![1]);
  assert(frame === marlinFrame("G21", number), "Marlin line number and checksum framing");
  port.send(`Error:checksum mismatch, Last Line: ${number - 1}\nResend: ${number}\nok\n`); await sleep();
  assert(port.writes.at(-1) === frame && snapshot().acknowledgedLines === 0, "Resend protocol ok does not acknowledge job line");
  port.send("ok\n"); await sleep();
  assert(snapshot().acknowledgedLines === 1, "Resent line counts once on its actual ack");
  const second = port.writes.at(-1)!;
  const secondNumber = Number(/^N(\d+)/.exec(second)![1]);
  port.send(`rs N${secondNumber}\n`); await sleep();
  assert(port.writes.at(-1) === second && snapshot().acknowledgedLines === 1, "rs N resend replays in-flight line");
  port.send("ok\n"); await sleep();
  assert(port.writes.at(-1)?.includes("M400") && snapshot().jobStatus === "draining", "Marlin drains planner via M400");
  port.send("ok\n"); await sleep();
  assert(snapshot().jobStatus === "complete", "Marlin M400 acknowledgement completes motion");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture("marlin");
  driver.runJob("G1 X1\nG1 X2"); await sleep();
  port.send("Resend: 9999\nok\n"); await sleep();
  assert(snapshot().jobStatus === "aborted" && port.writes.includes("M112\n"), "Invalid resend stops instead of repeating old motion");
  await driver.disconnect();
}
{
  const serial = new FakeSerial();
  let release!: () => void;
  serial.port.delayOpen = new Promise<void>((resolve) => { release = resolve; });
  const driver = new WebSerialController(() => serial, 0);
  const opening = driver.connect(); await sleep();
  const closing = driver.disconnect(); release();
  await Promise.all([opening, closing]);
  assert(serial.port.closeCount === 1 && snapshot().connectionStatus === "disconnected", "Disconnect during async port.open closes the late port");
}
{
  const { driver, port } = await fixture();
  // Reentrant firmware replies can arrive before writer.write resolves.
  port.onWrite = (text) => { if (text.startsWith("G1")) port.send("ok\n"); };
  driver.runJob(Array.from({ length: 100 }, (_, i) => `G1 X${i}`).join("\n"));
  await until(() => snapshot().acknowledgedLines === 100, "Fast acknowledgements do not stall pump");
  await driver.disconnect();
}
{
  const driver = new WebSerialController(() => undefined);
  assert(!driver.supported, "Feature detection without navigator.serial");
  let rejected = false; try { await driver.connect(); } catch { rejected = true; }
  assert(rejected && snapshot().lastError?.includes("HTTPS"), "Unsupported browser explains export fallback");
}
{
  const plan = { documentId: "a", documentVersion: 1, units: "in" as const, processes: [], profiles: [], toolpaths: [
    { points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] },
  ] } as Parameters<typeof machineDocumentTransform>[0];
  const transform = machineDocumentTransform(plan, { ...DEFAULT_GRBL_LASER_PROFILE, originAlignment: "lower-left" });
  assert(transform.mmPerUnit === 25.4 && transform.offsetX === -25.4 && transform.offsetY === -50.8, "Live marker shares compiler scale and origin");
}

{
  const { driver, port } = await fixture();
  port.onWrite = () => { throw new Error("USB write failed"); };
  driver.runJob("G1 X1\nG1 X2");
  await until(() => port.closeCount === 1, "Write failure releases all pipe locks");
  assert(snapshot().connectionStatus === "error" && snapshot().jobStatus === "aborted", "Write failure aborts job and connection");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  port.input.error(new Error("USB read failed"));
  await until(() => port.closeCount === 1, "Read failure releases all pipe locks");
  assert(!snapshot().ready && snapshot().connectionStatus === "error", "Read failure cannot leave machine ready");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  await driver.emergencyStop();
  port.send("Grbl 1.1h ['$' for help]\n");
  port.send("<Idle|MPos:0,0,0>\n"); await sleep();
  assert(!snapshot().ready && snapshot().jobStatus === "aborted", "Emergency stop stays latched after reset banner");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  port.send("ALARM:1\n"); await sleep();
  assert(snapshot().machineState === "Alarm" && !snapshot().ready, "Alarm disables machine commands");
  await driver.disconnect();
}
{
  const { driver, port } = await fixture();
  driver.runJob("G1 X1\nG1 X2"); await sleep();
  port.send("Grbl 1.1h ['$' for help]\n"); await sleep();
  assert(snapshot().jobStatus === "aborted" && !snapshot().ready, "Unexpected firmware reboot cannot resume job");
  await driver.disconnect();
}
{
  const serial = new FakeSerial();
  serial.requestPort = async () => { throw new DOMException("Picker cancelled", "NotFoundError"); };
  const driver = new WebSerialController(() => serial);
  await driver.connect();
  assert(snapshot().connectionStatus === "disconnected" && snapshot().lastError === null, "Picker cancellation is not a machine error");
  await driver.disconnect();
}
{
  useMachineStore.setState({ ...initialMachineState });
  const serial = new FakeSerial();
  // Browser APIs may throw synchronously when invocation loses user activation.
  serial.requestPort = (() => { throw new Error("requestPort activation failed"); }) as FakeSerial["requestPort"];
  const driver = new WebSerialController(() => serial);
  let rejected = false;
  try { await driver.connect(); } catch { rejected = true; }
  assert(rejected, "A synchronous serial picker failure did not reject connect.");
  assert(snapshot().connectionStatus === "error" && snapshot().lastError?.includes("activation failed"), "A synchronous serial picker failure left stale connection state.");
  await driver.disconnect();
}

console.log("Web Serial smoke passed: framing, RX limits, flow control, status/units, jogging, error/hold/reset, Marlin resend/drain, reconnect and stream cleanup.");
