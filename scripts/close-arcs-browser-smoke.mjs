const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create a Close path browser tab.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
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
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(700);
  await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
  const result = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { history } = await import('/src/document/History.ts');
    const doc = documentModel.getDocument();
    const base = { layerId: doc.activeLayerId, intent: 'cut', visible: true, locked: false,
      style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
      center: { x: 0, y: 0 }, radius: 10,
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, counterClockwise: false };
    documentModel.addEntity({ ...base, id: 'upper-arc', type: 'arc', startAngle: 0, endAngle: Math.PI });
    documentModel.addEntity({ ...base, id: 'lower-arc', type: 'arc', startAngle: Math.PI, endAngle: Math.PI * 2 });
    documentModel.selectEntities(['upper-arc', 'lower-arc']);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const close = [...document.querySelectorAll('.selection-actions button')]
      .find((button) => button.textContent.includes('Close path'));
    const offered = Boolean(close) && close.getAttribute('aria-disabled') !== 'true';
    close?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = [...documentModel.getDocument().entities.values()].filter((entity) =>
      entity.id === 'upper-arc' || entity.id === 'lower-arc');
    const combined = after.length === 1 && after[0].type === 'polyline' && after[0].closed;
    const undo = history.undo();
    const restored = ['upper-arc', 'lower-arc'].every((id) => documentModel.getDocument().entities.get(id)?.type === 'arc');
    const redo = history.redo();
    const reclosed = documentModel.getDocument().entities.get('upper-arc')?.type === 'polyline';
    return { offered, combined, undo, restored, redo, reclosed };
  })()`);
  assert(result.offered && result.combined && result.undo && result.restored && result.redo && result.reclosed,
    `Close path did not join selected arcs as one undoable outline: ${JSON.stringify(result)}.`);
  console.log("Close path joins two selected arcs into one closed, undoable outline.");
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
