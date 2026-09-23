import { initialMachineState, useMachineStore, type MachinePosition, type MachineSnapshot, type MachineState } from "../store/useMachineStore";
import type { GcodeDialect } from "./gcodeCompiler";

// Structural interfaces keep Web Serial optional, without a global navigator shim.
export interface MachineSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array<ArrayBuffer>> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize: number; flowControl: "none" }): Promise<void>;
  close(): Promise<void>;
}
export interface MachineSerial extends EventTarget {
  requestPort(): Promise<MachineSerialPort>;
  getPorts(): Promise<MachineSerialPort[]>;
}
export const SERIAL_BAUD_RATES = [115200, 9600, 38400, 250000] as const;
export const GRBL_RX_BUFFER_SIZE = 128;
// AVR's ring buffer reserves one slot; never consume the full advertised capacity.
const RX_LIMIT = GRBL_RX_BUFFER_SIZE - 1;
const patch = (state: Partial<MachineSnapshot>) => useMachineStore.setState(state);
const state = () => useMachineStore.getState();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function browserSerial(): MachineSerial | undefined {
  return typeof navigator === "undefined" ? undefined
    : (navigator as Navigator & { serial?: MachineSerial }).serial;
}

export class SerialLineTransformer implements Transformer<string, string> {
  private partial = "";
  transform(chunk: string, controller: TransformStreamDefaultController<string>): void {
    this.partial += chunk;
    const lines = this.partial.split(/\r\n|\r|\n/);
    this.partial = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) controller.enqueue(line.trim());
    if (this.partial.length > 8192) throw new Error("Serial response exceeded 8192 characters.");
  }
  // An unterminated response is discarded on disconnect, never treated as an ack.
}

interface Command {
  text: string;
  sourceLine: number;
  kind: "job" | "manual" | "poll" | "init" | "finish";
  wire?: string;
  number?: number;
  bytes?: number;
  retries?: number;
  sentAt?: number;
}

export function prepareGcode(source: string): Command[] {
  return source.split(/\r\n|\r|\n/).flatMap((raw, index) => {
    const text = raw.replace(/\([^)]*\)/g, "").replace(/;.*$/, "").trim().toUpperCase();
    if (!text || text === "%") return [];
    if (/[^\x20-\x7e]|[!?~\x18]/.test(text) || /[()*]|^N\d/.test(text)) {
      throw new Error(`Unsupported serial command on source line ${index + 1}.`);
    }
    // GRBL's parser line buffer is 80 bytes, independent of its serial RX buffer.
    if (text.length > 79) throw new Error(`Source line ${index + 1} exceeds the 79-character command limit.`);
    // EEPROM writes must use isolated send/response, never character-counted streaming.
    if (/^\$|G10\s*L(?:20|2)(?![\d.])|G(?:28|30)\.1(?![\d.])/.test(text)) {
      throw new Error(`Settings/offset writes cannot be streamed (source line ${index + 1}).`);
    }
    return [{ text, sourceLine: index + 1, kind: "job" as const }];
  });
}

export function marlinFrame(text: string, number: number): string {
  const payload = `N${number} ${text}`;
  let checksum = 0;
  for (const char of payload) checksum ^= char.charCodeAt(0);
  return `${payload}*${checksum}\n`;
}

function position(text: string | undefined, factor: number): MachinePosition | null {
  if (!text) return null;
  const values = text.split(",").map(Number);
  if (values.length < 3 || text.split(",").some((value) => !value.trim()) || values.some((value) => !Number.isFinite(value))) return null;
  return { x: values[0]! * factor, y: values[1]! * factor, z: values[2]! * factor };
}

export class WebSerialController {
  private port: MachineSerialPort | null = null;
  private rememberedPort: MachineSerialPort | null = null;
  private serial: MachineSerial | undefined;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private abort: AbortController | null = null;
  private pipes: Promise<unknown>[] = [];
  private readTask: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private epoch = 0;
  private pumpEpoch: number | null = null;
  private pumpRequested = false;
  private queue: Command[] = [];
  private pending: Command[] = [];
  private baudRate = 115200;
  private dialect: GcodeDialect = "grbl";
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeAt = 0;
  private lastResponseAt = 0;
  private reportFactor: number | null = null;
  private wco: MachinePosition | null = null;
  private initialized = false;
  private nextNumber = 0;
  private paused = false;
  private failed = false;
  private reconnect = false;
  private statusQuery: { at: number; draining: boolean } | null = null;
  private resendAwaitingOk = false;
  private manualAwaitingIdle = false;

  constructor(private readonly getSerial: () => MachineSerial | undefined = browserSerial, private readonly bootDelayMs = 1500) {}
  get supported(): boolean { return !!this.getSerial(); }

  async connect(baudRate = 115200, dialect: GcodeDialect = "grbl"): Promise<void> {
    if (this.opening || this.closing || this.port) throw new Error("A machine connection is already active or closing.");
    if (!SERIAL_BAUD_RATES.some((rate) => rate === baudRate)) throw new Error("Unsupported baud rate.");
    const serial = this.getSerial();
    if (!serial) {
      const error = "Web Serial is unavailable. Use desktop Chrome or Edge over HTTPS or localhost, or export the job from Manufacture.";
      patch({ connectionStatus: "error", lastError: error });
      throw new Error(error);
    }
    this.serial = serial;
    this.baudRate = baudRate;
    this.dialect = dialect;
    this.reconnect = true;
    serial.addEventListener("connect", this.onPortConnect);
    serial.addEventListener("disconnect", this.onPortDisconnect);
    const epoch = ++this.epoch;
    patch({ ...initialMachineState, connectionStatus: "connecting", dialect });
    // Invoke requestPort synchronously within the originating click's user activation.
    let request: Promise<MachineSerialPort>;
    try {
      request = serial.requestPort();
    } catch (error) {
      this.reconnect = false;
      this.removeListeners();
      patch({ connectionStatus: "error", lastError: message(error) });
      throw error;
    }
    this.opening = (async () => {
      try {
        const port = await request;
        if (epoch !== this.epoch) return;
        this.rememberedPort = port;
        await this.openPort(port, epoch);
      } catch (error) {
        if (epoch !== this.epoch) return;
        const cancelled = error instanceof DOMException && error.name === "NotFoundError";
        if (this.port) await this.closePort("error");
        patch({ connectionStatus: cancelled ? "disconnected" : "error", lastError: cancelled ? null : message(error) });
        this.reconnect = false;
        this.removeListeners();
        if (!cancelled) throw error;
      }
    })();
    try { await this.opening; } finally { this.opening = null; }
  }

  private async openPort(port: MachineSerialPort, epoch: number): Promise<void> {
    await port.open({ baudRate: this.baudRate, bufferSize: 4096, flowControl: "none" });
    if (epoch !== this.epoch) { await port.close(); return; }
    this.port = port;
    if (!port.readable || !port.writable) {
      this.port = null;
      await port.close();
      throw new Error("The serial port has no readable or writable stream.");
    }
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    const decoder = new TextDecoderStream();
    const lines = new TransformStream(new SerialLineTransformer());
    const encoder = new TextEncoderStream();
    const pipeError = (error: unknown) => { if (epoch === this.epoch) void this.connectionLost(error); };
    this.pipes = [
      port.readable.pipeTo(decoder.writable, options).catch(pipeError),
      decoder.readable.pipeTo(lines.writable, options).catch(pipeError),
      encoder.readable.pipeTo(port.writable, options).catch(pipeError),
    ];
    this.reader = lines.readable.getReader();
    this.writer = encoder.writable.getWriter();
    patch({ connectionStatus: "connected", ready: false, dialect: this.dialect, lastError: null,
      workPositionKnown: false, machinePositionKnown: false, rawMachineState: "Synchronising" });
    this.readTask = this.readLoop(this.reader, epoch);
    this.startHandshake();
    this.pollTimer = setInterval(() => this.tick(), 200);
  }

  private startHandshake(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.queue = []; this.pending = []; this.paused = false; this.failed = false;
    this.initialized = false; this.reportFactor = null; this.wco = null; this.nextNumber = 0;
    this.statusQuery = null; this.resendAwaitingOk = false; this.manualAwaitingIdle = false;
    this.handshakeAt = Date.now(); this.lastResponseAt = Date.now();
    patch({ ready: false, bufferLevel: 0, workPositionKnown: false, machinePositionKnown: false });
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.queue = (this.dialect === "grbl" ? ["$$"] : ["M110 N0", "G21", "M400", "M114"])
        .map((text) => ({ text, sourceLine: 0, kind: "init" }));
      void this.pump();
    }, this.bootDelayMs);
  }

  private async readLoop(reader: ReadableStreamDefaultReader<string>, epoch: number): Promise<void> {
    try {
      while (epoch === this.epoch) {
        const { value, done } = await reader.read();
        if (done) { if (epoch === this.epoch) void this.connectionLost(new Error("Machine serial stream closed.")); break; }
        if (epoch === this.epoch) this.receive(value);
      }
    } catch (error) { if (epoch === this.epoch) void this.connectionLost(error); }
    finally { reader.releaseLock(); }
  }

  private tick(): void {
    if (!this.writer) return;
    if (!this.initialized && Date.now() - this.handshakeAt > 12_000) {
      void this.connectionLost(new Error("The machine did not synchronise. Check the firmware and baud rate.")); return;
    }
    const responseAt = this.dialect === "grbl" ? this.pending[0]?.sentAt ?? Date.now() : this.lastResponseAt;
    if (this.pending.length && Date.now() - responseAt > 120_000) {
      this.protocolFailure("Machine acknowledgement timed out. Reset and inspect the machine."); return;
    }
    if (this.bootTimer) return;
    if (this.dialect === "grbl") {
      // A lost query is retried, but never build up a queue of real-time requests.
      if (this.statusQuery && Date.now() - this.statusQuery.at < 1000) return;
      this.statusQuery = { at: Date.now(), draining: state().jobStatus === "draining" || this.manualAwaitingIdle };
      void this.write("?").catch(() => {});
    } else if (this.initialized && !this.failed && !this.paused && !this.queue.some((item) => item.kind === "poll") && !this.pending.some((item) => item.kind === "poll")) {
      // M114 has an ok: it must share the numbered send/response queue.
      this.queue.unshift({ text: "M114", sourceLine: 0, kind: "poll" });
      void this.pump();
    }
  }

  private async write(text: string): Promise<void> {
    if (!this.writer) throw new Error("Connect a machine first.");
    const epoch = this.epoch;
    try { await this.writer.write(text); }
    catch (error) {
      if (epoch === this.epoch) void this.connectionLost(error);
      throw error;
    }
  }

  private async pump(): Promise<void> {
    const epoch = this.epoch;
    if (this.pumpEpoch === epoch) { this.pumpRequested = true; return; }
    this.pumpRequested = false;
    this.pumpEpoch = epoch;
    try {
      while (epoch === this.epoch && this.writer && !this.paused && !this.failed && this.queue.length) {
        const command = this.queue[0]!;
        if (this.dialect === "marlin" && this.pending.length) break;
        // Only job lines may share the GRBL RX buffer; manual/EEPROM writes are barriers.
        if (this.pending.length && (command.kind !== "job" || this.pending.some((item) => item.kind !== "job"))) break;
        const wire = this.dialect === "marlin" ? marlinFrame(command.text, this.nextNumber) : `${command.text}\n`;
        if (this.dialect === "grbl" && state().bufferLevel + wire.length > RX_LIMIT) break;
        this.queue.shift();
        command.wire = wire; command.bytes = wire.length; command.number = this.nextNumber++;
        command.sentAt = Date.now();
        this.pending.push(command);
        patch({ bufferLevel: this.pending.reduce((sum, item) => sum + (item.bytes ?? 0), 0) });
        await this.write(wire);
      }
    } catch (error) { if (epoch === this.epoch) void this.connectionLost(error); }
    finally {
      if (this.pumpEpoch === epoch) {
        this.pumpEpoch = null;
        if (this.pumpRequested && epoch === this.epoch) void this.pump();
      }
    }
  }

  private receive(line: string): void {
    this.lastResponseAt = Date.now();
    if (/^(Grbl\s|start$)/i.test(line)) {
      if (this.initialized) {
        this.protocolFailure("Controller restarted. The job was cancelled; reconnect before continuing.", false);
      } else this.startHandshake();
      return;
    }
    if (this.dialect === "grbl") {
      const reportUnits = /^\$13=([01])(?:\s|$)/.exec(line);
      if (reportUnits) this.reportFactor = reportUnits[1] === "1" ? 25.4 : 1;
      if (line.startsWith("<") && line.endsWith(">")) { this.grblStatus(line); return; }
      if (/^ALARM:/i.test(line)) {
        patch({ machineState: "Alarm", rawMachineState: line });
        this.protocolFailure(line); return;
      }
    } else {
      const resend = /^(?:rs\s*(?:N\s*)?|Resend:\s*)(\d+)/i.exec(line);
      if (resend) { this.resend(Number(resend[1]), /^Resend:/i.test(line)); return; }
      // Marlin follows these recoverable errors with Resend + a protocol ok.
      if (/^Error:.*(?:checksum|line number|No Line Number)/i.test(line)) return;
      const xyz = /(?:^|\s)X:([-+\d.]+)\s+Y:([-+\d.]+)\s+Z:([-+\d.]+)/i.exec(line);
      if (xyz) {
        const factor = this.reportFactor ?? 1;
        const p = position(`${xyz[1]},${xyz[2]},${xyz[3]}`, factor);
        if (p) patch({ workPosition: p, workPositionKnown: true, ready: this.initialized && !this.failed });
        // M114's Count values are steps, not machine-space coordinates.
      }
    }
    if (/^(?:error:|!!)/i.test(line)) { this.protocolFailure(line); return; }
    if (/^ok(?:\s|$)/i.test(line)) {
      if (this.resendAwaitingOk) {
        this.resendAwaitingOk = false;
        const command = this.pending[0];
        if (command?.wire) void this.write(command.wire).catch(() => {});
        return;
      }
      const command = this.pending.shift();
      if (!command || this.failed) return;
      const acknowledgedNumber = /^ok\s+N(\d+)/i.exec(line);
      if (this.dialect === "marlin" && acknowledgedNumber && Number(acknowledgedNumber[1]) !== command.number) {
        this.protocolFailure(`Unexpected Marlin acknowledgement: ${line}`); return;
      }
      patch({ bufferLevel: this.pending.reduce((sum, item) => sum + (item.bytes ?? 0), 0) });
      if (this.dialect === "marlin") {
        if (/\bG20\b/.test(command.text)) this.reportFactor = 25.4;
        if (/\bG21\b/.test(command.text)) this.reportFactor = 1;
      }
      if (command.kind === "job") {
        patch({ activeLine: command.sourceLine, activeCommand: command.text, acknowledgedLines: state().acknowledgedLines + 1 });
        if (state().acknowledgedLines === state().totalLines) patch({ jobStatus: this.paused ? "paused" : "draining" });
      }
      if (command.kind === "finish" && !this.paused) this.completeJob();
      if (command.kind === "manual" && !this.queue.some((item) => item.kind === "manual")) {
        if (/^(?:G10|G92)\b/.test(command.text)) {
          this.wco = null;
          patch({ workPositionKnown: false });
        }
        if (this.dialect === "marlin") patch({ machineState: "Idle", rawMachineState: "Idle" });
        else this.manualAwaitingIdle = true;
      }
      if (command.kind === "init" && !this.queue.some((item) => item.kind === "init")) {
        this.initialized = true;
        if (this.dialect === "marlin") patch({ ready: state().workPositionKnown, machineState: "Idle", rawMachineState: "Idle" });
      }
      void this.pump();
    }
  }

  private grblStatus(line: string): void {
    const [raw = "Unknown", ...fields] = line.slice(1, -1).split("|");
    const base = raw.split(":")[0]!;
    const mapped: MachineState = base === "Idle" ? "Idle" : base === "Hold" ? "Hold" : base === "Door" ? "Door" : base === "Alarm" ? "Alarm" : "Run";
    const data = Object.fromEntries(fields.map((field) => { const index = field.indexOf(":"); return [field.slice(0, index), field.slice(index + 1)]; }));
    const update: Partial<MachineSnapshot> = { machineState: mapped, rawMachineState: raw };
    if (this.reportFactor !== null) {
      const factor = this.reportFactor;
      const offset = position(data.WCO, factor);
      if (offset) this.wco = offset;
      const machine = position(data.MPos, factor);
      const work = position(data.WPos, factor);
      if (machine) { update.machinePosition = machine; update.machinePositionKnown = true; }
      if (work) { update.workPosition = work; update.workPositionKnown = true; }
      if (this.wco && machine && !work) {
        update.workPosition = { x: machine.x - this.wco.x, y: machine.y - this.wco.y, z: machine.z - this.wco.z };
        update.workPositionKnown = true;
      }
      if (this.wco && work && !machine) {
        update.machinePosition = { x: work.x + this.wco.x, y: work.y + this.wco.y, z: work.z + this.wco.z };
        update.machinePositionKnown = true;
      }
      const fs = (data.FS ?? data.F)?.split(",").map(Number);
      if (fs && Number.isFinite(fs[0])) update.feedRate = fs[0]! * factor;
      if (fs && Number.isFinite(fs[1])) update.spindleSpeed = fs[1]!;
    }
    const overrides = data.Ov?.split(",").map(Number);
    if (overrides?.length === 3 && overrides.every(Number.isFinite)) {
      update.feedRateOverride = overrides[0]!; update.spindleSpeedOverride = overrides[2]!;
    }
    update.ready = this.initialized && this.reportFactor !== null && !this.failed;
    patch(update);
    const requestedAfterDrain = this.statusQuery?.draining;
    this.statusQuery = null;
    if (base === "Alarm") { this.protocolFailure(`Machine alarm: ${raw}`); return; }
    if (base === "Hold" || base === "Door") {
      this.paused = true;
      if (["streaming", "draining"].includes(state().jobStatus)) patch({ jobStatus: "paused" });
    }
    if (base === "Idle" && requestedAfterDrain && !this.paused && !this.failed) {
      this.manualAwaitingIdle = false;
      if (state().jobStatus === "draining") this.completeJob();
    }
  }

  private resend(number: number, followsWithOk: boolean): void {
    const command = this.pending[0];
    if (this.failed) return;
    // Exactly one Marlin line is in flight: replaying any earlier line could repeat motion.
    if (!command?.wire || command.number !== number || (command.retries ?? 0) >= 3) {
      this.protocolFailure(`Invalid or repeated Marlin resend request: ${number}.`); return;
    }
    command.retries = (command.retries ?? 0) + 1;
    if (followsWithOk) this.resendAwaitingOk = true;
    else void this.write(command.wire).catch(() => {});
  }

  private protocolFailure(error: string, stop = true): void {
    if (this.failed) return;
    this.failed = true; this.paused = true; this.queue = [];
    patch({ ready: false, lastError: error, jobStatus: state().totalLines ? "aborted" : "idle" });
    // GRBL hold prevents queued motion continuing after a parser failure.
    if (stop && this.writer) void this.write(this.dialect === "grbl" ? "!" : "M112\n")
      .catch(() => {});
  }

  private assertIdle(): void {
    if (!state().ready || !this.writer || this.failed) throw new Error("Wait for the machine connection to synchronise.");
    if (state().machineState !== "Idle" || this.paused || this.pending.some((item) => item.kind !== "poll") || this.queue.length || this.manualAwaitingIdle
      || ["streaming", "paused", "draining"].includes(state().jobStatus)) throw new Error("Wait until the machine and command queue are idle.");
  }

  runJob(source: string, estimatedSeconds = 0): void {
    this.assertIdle();
    const commands = prepareGcode(source);
    if (!commands.length) throw new Error("The job has no executable G-code.");
    this.queue = [...this.queue, ...commands];
    if (this.dialect === "marlin") this.queue.push({ text: "M400", sourceLine: 0, kind: "finish" });
    patch({ jobStatus: "streaming", activeLine: 0, activeCommand: "", totalLines: commands.length,
      acknowledgedLines: 0, estimatedSeconds, lastError: null });
    if (this.dialect === "marlin") patch({ machineState: "Run", rawMachineState: "Streaming" });
    void this.pump();
  }

  jog(axis: "X" | "Y" | "Z", distanceMm: number, feedMm: number): void {
    this.assertIdle();
    if (!["X", "Y", "Z"].includes(axis) || !Number.isFinite(distanceMm) || Math.abs(distanceMm) > 100 || distanceMm === 0
      || !Number.isFinite(feedMm) || feedMm < 1 || feedMm > 6000) throw new Error("Invalid jog distance or feed speed.");
    const motion = `${axis}${distanceMm.toFixed(3)} F${feedMm.toFixed(0)}`;
    this.manual(this.dialect === "grbl" ? [`$J=G21 G91 ${motion}`] : ["G21", "G91", `G1 ${motion}`, "G90", "M400"]);
  }

  zeroWorkOffset(): void {
    this.assertIdle();
    this.wco = null;
    patch({ workPositionKnown: false });
    this.manual(this.dialect === "grbl" ? ["G54", "G10 L20 P1 X0 Y0 Z0"] : ["G92 X0 Y0 Z0"]);
  }

  private manual(commands: string[]): void {
    this.queue.push(...commands.map((text): Command => ({ text, sourceLine: 0, kind: "manual" })));
    patch({ machineState: "Run", rawMachineState: "Command pending" });
    void this.pump();
  }

  async feedHold(): Promise<void> {
    if (this.dialect !== "grbl") throw new Error("Marlin has no universal real-time feed hold. Use Emergency Stop to abort motion.");
    // GRBL ignores a hold while idle; do not create an unresumable host-only pause.
    if (state().machineState === "Idle" && !["streaming", "draining", "paused"].includes(state().jobStatus)
      && !this.queue.length && !this.pending.length && !this.manualAwaitingIdle) {
      await this.write("!");
      return;
    }
    this.paused = true;
    if (["streaming", "draining"].includes(state().jobStatus)) patch({ jobStatus: "paused" });
    await this.write("!");
  }

  async resume(): Promise<void> {
    if (this.dialect !== "grbl" || this.failed || !state().ready || state().rawMachineState !== "Hold:0") {
      throw new Error("Resume requires a fully stopped GRBL hold (Hold:0).");
    }
    await this.write("~");
    this.paused = false;
    if (state().jobStatus === "paused") patch({ jobStatus: state().acknowledgedLines === state().totalLines ? "draining" : "streaming" });
    void this.pump();
  }

  async softReset(): Promise<void> {
    if (this.dialect !== "grbl") throw new Error("Reset Marlin at the controller after an emergency shutdown, then reconnect.");
    this.failed = true; this.paused = true; this.queue = []; this.pending = [];
    patch({ ready: false, jobStatus: "aborted", bufferLevel: 0, lastError: null });
    await this.write("\x18");
    this.startHandshake();
  }

  async emergencyStop(): Promise<void> {
    this.failed = true; this.paused = true; this.queue = []; this.pending = [];
    this.initialized = true;
    patch({ ready: false, jobStatus: "aborted", bufferLevel: 0, lastError: "Job stopped. Inspect the machine and reset before continuing." });
    await this.write(this.dialect === "grbl" ? "\x18" : "M112\n");
  }

  private completeJob(): void {
    patch({ jobStatus: "complete", machineState: "Idle", rawMachineState: "Idle" });
  }

  private onPortDisconnect = (event: Event): void => {
    const port = (event as Event & { port?: MachineSerialPort }).port ?? event.target;
    if (port === this.port || port === this.rememberedPort) void this.connectionLost(new Error("Machine USB disconnected. The job was cancelled."));
  };
  private onPortConnect = (event: Event): void => {
    const port = (event as Event & { port?: MachineSerialPort }).port ?? event.target;
    if (!this.reconnect || port !== this.rememberedPort) return;
    void this.reopen().catch((error: unknown) => patch({ connectionStatus: "error", lastError: message(error) }));
  };
  private async reopen(): Promise<void> {
    if (this.closing) await this.closing;
    if (!this.reconnect || !this.rememberedPort || this.port || this.opening) return;
    const ports = await this.serial?.getPorts();
    if (!this.reconnect || this.port || this.opening || !ports?.includes(this.rememberedPort)) return;
    const epoch = ++this.epoch;
    patch({ connectionStatus: "connecting", ready: false });
    this.opening = this.openPort(this.rememberedPort, epoch);
    try {
      await this.opening;
    } catch (error) {
      if (epoch === this.epoch && this.port) await this.closePort("error");
      throw error;
    } finally { this.opening = null; }
  }
  private removeListeners(): void {
    this.serial?.removeEventListener("connect", this.onPortConnect);
    this.serial?.removeEventListener("disconnect", this.onPortDisconnect);
  }
  private async connectionLost(error: unknown): Promise<void> {
    if (this.closing) return;
    patch({ lastError: message(error) });
    await this.closePort("error");
  }

  async disconnect(): Promise<void> {
    this.reconnect = false; this.rememberedPort = null; this.removeListeners();
    if (this.writer && (["streaming", "paused", "draining"].includes(state().jobStatus) || state().machineState === "Run")) {
      // Bound the best-effort stop: a stalled USB write must not prevent releasing the port.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.emergencyStop().catch(() => {}),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 250); }),
      ]);
      if (timer) clearTimeout(timer);
    }
    await this.closePort("disconnected");
    // Also wait for an outstanding picker/open to finish and release its port.
    await this.opening?.catch(() => {});
    patch({ connectionStatus: "disconnected" });
  }
  private async closePort(status: "disconnected" | "error"): Promise<void> {
    if (this.closing) return this.closing;
    ++this.epoch;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.pollTimer = null; this.bootTimer = null;
    this.queue = []; this.pending = []; this.failed = true; this.paused = true;
    const port = this.port, reader = this.reader, writer = this.writer, abort = this.abort;
    const pipes = this.pipes, readTask = this.readTask;
    this.port = null; this.reader = null; this.writer = null; this.abort = null;
    this.readTask = null; this.pipes = [];
    patch({ connectionStatus: status, ready: false, bufferLevel: 0, workPositionKnown: false, machinePositionKnown: false,
      jobStatus: ["streaming", "draining", "paused"].includes(state().jobStatus) ? "aborted" : state().jobStatus });
    this.closing = (async () => {
      // Cancelling/aborting all pipe stages releases both underlying serial locks.
      abort?.abort();
      await Promise.allSettled([reader?.cancel(), writer?.abort(), ...pipes, readTask]);
      writer?.releaseLock();
      if (port) {
        try { await port.close(); } catch (error) { patch({ lastError: `Port close: ${message(error)}` }); }
      }
    })();
    try { await this.closing; } finally { this.closing = null; }
  }
}

export const webSerialController = new WebSerialController();
