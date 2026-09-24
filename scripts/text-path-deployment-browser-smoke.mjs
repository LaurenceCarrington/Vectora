const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "https://laurencecarrington.github.io/Vectora/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create a deployment test tab.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
const failures = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Network.loadingFailed") failures.push(message.params);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const key = async (value, code) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code });
};
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(1400);
  await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
  await key("f", "KeyF");
  await click(720, 450);
  await wait(150);
  const input = await evaluate(`document.querySelector('.canvas-text-editor')?.getAttribute('aria-label')`);
  if (input !== "Text on canvas") throw new Error(`Text tool did not open its editor: ${input}`);
  await send("Input.insertText", { text: "VECTOR" });
  await key("Enter", "Enter");
  await wait(250);
  const before = await evaluate(`!![...document.querySelectorAll('.selection-actions button')]
    .find((button) => button.textContent.includes('Convert to paths'))`);
  if (!before) throw new Error("New text was not selected for path conversion.");
  await evaluate(`[...document.querySelectorAll('.selection-actions button')]
    .find((button) => button.textContent.includes('Convert to paths'))?.click()`);
  await wait(1700);
  const after = await evaluate(`({
    convertButton: !![...document.querySelectorAll('.selection-actions button')]
      .find((button) => button.textContent.includes('Convert to paths')),
    selected: document.querySelector('.selection-actions-handle')?.textContent,
    messages: [...document.querySelectorAll('[role="status"], [role="alert"]')]
      .map((item) => item.textContent?.trim()).filter(Boolean),
  })`);
  if (after.convertButton || !after.selected || failures.length) {
    throw new Error(`Production text conversion failed: ${JSON.stringify({ after, failures })}`);
  }
  console.log(`Text converted to paths on ${appOrigin}; ${after.selected}.`);
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
