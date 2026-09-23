// Use a local dev server and an isolated Chrome debugging profile.
import assert from "node:assert/strict";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9352";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4192/";
const targets = await fetch(`${debugOrigin}/json`).then(response => response.json());
const target = targets.find(tab => tab.type === "page" && (tab.url === "about:blank" || tab.url === appOrigin));
assert(target, "Open about:blank in an isolated Chrome debugging profile.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(body) {
  const response = await send("Runtime.evaluate", {
    expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}
const modelImport = "const { documentModel } = await import('/src/document/DocumentModel.ts');";
const storeImport = "const { useVectorStore } = await import('/src/store/useVectorStore.ts');";
const count = () => evaluate(`${modelImport} return documentModel.getDocument().entities.size;`);
async function key(key, modifiers = 0) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const windowsVirtualKeyCode = key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  await wait();
}
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", {
  type, x, y, button: "left", buttons, ...(type === "mouseMoved" ? {} : { clickCount: 1 }),
});
const down = (x, y) => mouse("mousePressed", x, y);
const move = (x, y) => mouse("mouseMoved", x, y);
async function up(x, y) {
  await mouse("mouseReleased", x, y, 0);
  await wait();
}
async function stroke(offset = 0) {
  await down(403, 353 + offset);
  for (let step = 1; step <= 80; step++) {
    await move(403 + step * 2, 353 + offset + Math.sin(step / 10) * 30);
  }
  await up(563, 353 + offset + Math.sin(8) * 30);
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(1200);
  await evaluate(`${modelImport} ${storeImport}
    for (const id of documentModel.getDocument().entities.keys()) documentModel.removeEntity(id);
    const { history } = await import('/src/document/History.ts'); history.clear();
    useVectorStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
    useVectorStore.getState().updateDraftingPreferences({ snapToGrid: true, gridSize: 24 });
    document.querySelector('button[aria-label="Line tools"]').click();
  `);
  await wait();
  assert(await evaluate(`const row = [...document.querySelectorAll('.line-menu button')].find(button => button.textContent.includes('Freehand'));
    if (!row || !row.querySelector('svg')) return false; row.click(); return true;`), "Freehand must have an icon inside the line menu.");
  await wait();
  assert.equal(await evaluate(`${storeImport} return useVectorStore.getState().activeTool;`), "freehand");
  assert(await evaluate(`return document.querySelector('button[aria-label="Line tools"]').getAttribute('aria-pressed') === 'true';`));

  await stroke();
  assert.equal(await count(), 1, "A drag must create one path.");
  const drawn = await evaluate(`${modelImport} return [...documentModel.getDocument().entities.values()][0];`);
  assert.equal(drawn.type, "polyline");
  assert.equal(drawn.closed, false);
  assert.equal(drawn.name, "Freehand");
  assert(drawn.points.length > 4 && drawn.points.length < 80, "Simplify sampling noise while retaining bends.");
  assert.deepEqual(drawn.points[0], { x: -317, y: 97 }, "Freehand must bypass snapping even when grid snap is on.");
  assert(Math.abs(drawn.points.at(-1).y - (97 - Math.sin(8) * 30)) < 1e-4, "Preserve the final pointer position.");
  await stroke(100);
  assert.equal(await count(), 2, "Consecutive drags must create separate paths.");
  await key("z", 4);
  assert.equal(await count(), 1, "One undo must remove the entire latest stroke.");
  await key("z", 12);
  assert.equal(await count(), 2, "Redo must restore the entire stroke.");

  await down(600, 400); await up(600, 400);
  assert.equal(await count(), 2, "Clicking without dragging must not add an empty path.");
  for (const interrupt of [
    () => key("Escape"),
    () => key("l"),
    () => evaluate(`window.dispatchEvent(new Event('blur'));`),
    () => evaluate(`document.querySelector('canvas').releasePointerCapture(1);`),
    () => evaluate(`document.querySelector('canvas').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));`),
    () => evaluate(`${storeImport} useVectorStore.getState().setViewport({ x: 15, y: 0, zoom: 1 });`),
    () => evaluate(`${storeImport} useVectorStore.getState().setTemporaryPanActive(true);`),
  ]) {
    await key("b"); await down(600, 400); await move(650, 450);
    await interrupt(); await wait(); await up(670, 470);
    assert.equal(await count(), 2, "Interrupted strokes must be discarded.");
    await evaluate(`${storeImport} useVectorStore.getState().setTemporaryPanActive(false); useVectorStore.getState().resetViewport();`);
  }

  for (const blocked of [{ locked: true }, { visible: false }]) {
    await evaluate(`${modelImport} documentModel.updateLayer(documentModel.getActiveLayer().id, ${JSON.stringify(blocked)});`);
    await key("b"); await stroke();
    assert.equal(await count(), 2, "Do not draw on hidden or locked layers.");
    await evaluate(`${modelImport} documentModel.updateLayer(documentModel.getActiveLayer().id, { locked: false, visible: true });`);
  }
  await evaluate(`${storeImport} useVectorStore.getState().setViewport({ x: 40, y: -20, zoom: 4 });`);
  await stroke();
  const zoomed = await evaluate(`${modelImport} return [...documentModel.getDocument().entities.values()].at(-1);`);
  assert.deepEqual(zoomed.points[0], { x: -89.25, y: 19.25 }, "Convert freehand coordinates correctly after pan and zoom.");
  assert.equal(zoomed.points.length, drawn.points.length, "Simplification must feel consistent at different zoom levels.");

  const roundTrips = await evaluate(`${modelImport}
    const doc = documentModel.getDocument();
    const { parseVectoraDocument, serializeVectoraDocument } = await import('/src/io/filePersistence.ts');
    const { parseSvg, exportSvg } = await import('/src/io/svgParser.ts');
    const { parseDxf, exportDxf } = await import('/src/io/dxfSerializer.ts');
    return [parseVectoraDocument(serializeVectoraDocument(doc)), parseSvg(exportSvg(doc)), parseDxf(exportDxf(doc))]
      .map(result => result.entities.filter(entity => entity.type === 'polyline' && !entity.closed).length);
  `);
  assert.deepEqual(roundTrips, [3, 3, 3], "Native, SVG, and DXF exports must retain all freehand paths.");
  console.log("Freehand menu, unsnapped drawing, simplification, consecutive strokes, undo/redo, cancellation, locked/hidden layers, pan/zoom, and native/SVG/DXF round trips passed.");
} finally {
  socket.close();
}
