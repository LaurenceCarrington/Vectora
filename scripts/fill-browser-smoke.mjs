import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9346";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated fill-feature test tab.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
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
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(1_300);
  await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    documentModel.resetDocument('mm');
    const layerId = documentModel.getDocument().activeLayerId;
    const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] };
    documentModel.replaceEntitySet([], [
      { id:'fill-browser-rect', type:'rectangle', layerId, intent:'cut', visible:true, locked:false, style,
        origin:{x:-50,y:-30}, width:100, height:60, cornerRadius:0, bbox:{minX:-50,minY:-30,maxX:50,maxY:30} },
      { id:'fill-browser-line', type:'line', layerId, intent:'cut', visible:true, locked:false, style,
        start:{x:120,y:0}, end:{x:180,y:0}, bbox:{minX:120,minY:0,maxX:180,maxY:0} }
    ]);
  })()`);

  await evaluate(`document.querySelector('[aria-label="Fill bucket"]').click()`);
  await wait(150);
  assert(await evaluate(`document.querySelector('.fill-tool-menu input[aria-label="Fill bucket color"]') !== null`),
    "Fill bucket color options did not open from the left dock.");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1_100, y: 160 });
  await wait(80);
  assert(await evaluate(`document.querySelector('.fill-tool-menu') !== null`),
    "Fill bucket options closed when the pointer left for the expanded color picker.");
  await evaluate(`(() => {
    const input = document.querySelector('.fill-tool-menu input[aria-label="Fill bucket color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#e11d48');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const canvas = await evaluate(`(() => { const rect = document.querySelector('.cad-canvas').getBoundingClientRect(); return { x:rect.x, y:rect.y, width:rect.width, height:rect.height }; })()`);
  await click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await wait(180);
  assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('fill-browser-rect').style.fillColor === '#e11d48')()`),
    "Clicking inside the closed shape did not apply the bucket color.");

  await click(canvas.x + canvas.width / 2 + 150, canvas.y + canvas.height / 2);
  await click(canvas.x + canvas.width / 2 + 300, canvas.y + canvas.height / 2 - 120);
  assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('fill-browser-line').style.fillColor === null)()`),
    "The bucket filled an open path or empty canvas area.");

  await evaluate(`document.querySelector('[aria-label="Properties"]').click()`);
  await wait(180);
  assert(await evaluate(`document.querySelector('.property-color-control input[aria-label="Fill color"]')?.value === '#e11d48'`),
    "Properties did not expose the selected closed shape's fill color.");
  await evaluate(`(() => {
    const input = document.querySelector('.property-color-control input[aria-label="Fill color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#22c55e');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(180);
  assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('fill-browser-rect').style.fillColor === '#22c55e')()`),
    "Properties did not update the fill color immediately.");
  assert(await evaluate(`document.querySelector('.property-color-control input[aria-label="Line color"]') !== null`),
    "Properties did not expose line color for the selected rectangle.");
  await evaluate(`(() => {
    const input = document.querySelector('.property-color-control input[aria-label="Line color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#123abc');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(100);
  assert(await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { serializeVectoraDocument, parseVectoraDocument } = await import('/src/io/filePersistence.ts');
    const { exportSvg } = await import('/src/io/svgParser.ts');
    const rectangle = documentModel.getDocument().entities.get('fill-browser-rect');
    return rectangle.style.strokeColor === '#123abc' &&
      exportSvg(documentModel.getDocument()).includes('stroke="#123abc"') &&
      parseVectoraDocument(serializeVectoraDocument()).entities.find(entity => entity.id === rectangle.id)?.style.strokeColor === '#123abc';
  })()`), "Line color did not update the shape or persist through SVG/native export.");
  await evaluate(`document.querySelector('.property-color-field:has(input[aria-label="Line color"]) button').click()`);
  await wait(80);
  assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('fill-browser-rect').style.strokeColor === null)()`),
    "Use layer color did not restore inherited line color.");

  await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.selectEntities(['fill-browser-line']))()`);
  await wait(80);
  assert(await evaluate(`document.querySelector('.property-color-control input[aria-label="Line color"]') !== null &&
    document.querySelector('.property-color-control input[aria-label="Fill color"]') === null`),
    "Open lines did not get line color without an irrelevant fill control.");
  await evaluate(`(() => {
    const input = document.querySelector('.property-color-control input[aria-label="Line color"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#e11d48');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(80);
  assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('fill-browser-line').style.strokeColor === '#e11d48')()`),
    "Properties did not update an open line's color.");
  assert(await evaluate(`(async () => {
    const { undo } = await import('/src/document/History.ts');
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return undo() && documentModel.getDocument().entities.get('fill-browser-line').style.strokeColor === null;
  })()`), "Undo did not restore the line's inherited color.");
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/vectora-fill-feature.png", Buffer.from(screenshot.data, "base64"));
  assert(runtimeErrors.length === 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  console.log("Fill bucket, closed-shape guard, Properties fill/line color editing, and SVG/native persistence passed.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  socket.close();
}
