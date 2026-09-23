import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9346";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated semantic-color test tab.");
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(1_500);

  const tokens = await evaluate(`(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      cut: read('--v-color-cut'), engrave: read('--v-color-engrave'), construction: read('--v-color-construction'),
      bitmap: read('--v-color-bitmap'), selection: read('--v-color-selection'), snap: read('--v-color-snap'),
      danger: read('--v-color-danger'), rapid: read('--v-color-toolpath-rapid'), preview: read('--v-color-preview-background')
    };
  })()`);
  assert(new Set([tokens.cut, tokens.engrave, tokens.construction, tokens.bitmap, tokens.selection, tokens.snap, tokens.danger, tokens.rapid]).size === 8,
    "Manufacturing, interaction, feedback, and rapid tokens are not independently representable.");

  await evaluate(`document.querySelector('[aria-label="Layers"]').click()`);
  await wait(250);
  const layers = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.layer-row')];
    return rows.map((row) => ({
      name: row.querySelector('.layer-name')?.childNodes[0]?.textContent?.trim(),
      swatch: getComputedStyle(row.querySelector('.layer-swatch')).backgroundColor,
      selected: row.classList.contains('is-selected'),
      rowBackground: getComputedStyle(row).backgroundColor,
    }));
  })()`);
  assert(layers.length >= 3, "Default manufacturing layers are missing.");
  assert(new Set(layers.slice(0, 3).map((layer) => layer.swatch)).size === 3, "Cut, engrave, and construction layers do not retain distinct colors.");
  assert(layers.some((layer) => layer.selected && layer.rowBackground !== layer.swatch), "Selected layer styling replaced its operation color.");
  const layerShot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/vectora-semantic-layers.png", Buffer.from(layerShot.data, "base64"));
  await evaluate(`document.querySelector('.layers-panel [aria-label="Close panel"]').click()`);
  await wait(120);

  await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const doc = documentModel.getDocument();
    if (!doc.entities.has('semantic-color-qa')) documentModel.addEntity({
      id: 'semantic-color-qa', name: 'Semantic color QA', type: 'rectangle', layerId: doc.activeLayerId,
      intent: 'cut', visible: true, locked: false,
      style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
      origin: { x: 10, y: 10 }, width: 40, height: 25, cornerRadius: 0,
      bbox: { minX: 10, minY: 10, maxX: 50, maxY: 35 }
    });
  })()`);
  await evaluate(`document.querySelector('[aria-label="Manufacture"]').click()`);
  await wait(500);
  const cam = await evaluate(`(() => {
    const panel = document.querySelector('.cam-panel');
    const primary = panel?.querySelector('.cam-actions button.primary');
    const swatch = panel?.querySelector('.cam-toolpath-swatch');
    const panelRect = panel?.getBoundingClientRect();
    return {
      visible: Boolean(panel && panelRect.width > 0 && panelRect.height > 0),
      insideViewport: Boolean(panelRect && panelRect.left >= 0 && panelRect.right <= innerWidth && panelRect.bottom <= innerHeight),
      primaryBackground: primary ? getComputedStyle(primary).backgroundColor : null,
      swatchColor: swatch ? getComputedStyle(swatch).backgroundColor : null,
      hasError: Boolean(panel?.querySelector('.cam-error')),
    };
  })()`);
  assert(cam.visible && cam.insideViewport, "CAM panel is not visibly contained in the viewport.");
  assert(cam.primaryBackground, "CAM action styling did not resolve.");
  assert(cam.swatchColor && cam.swatchColor !== "rgba(0, 0, 0, 0)", "Toolpath sequence lacks a labelled operation swatch.");
  const camShot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/vectora-semantic-cam.png", Buffer.from(camShot.data, "base64"));

  await evaluate(`document.querySelector('.cam-panel > .cam-head [aria-label="Close panel"]').click()`);
  await wait(150);
  await evaluate(`document.querySelector('[aria-label="3D preview"]').click()`);
  await wait(1_200);
  const preview = await evaluate(`(() => {
    const modal = document.querySelector('.three-preview-modal');
    const shell = document.querySelector('.three-viewport-shell');
    const canvas = document.querySelector('.three-preview-canvas');
    const select = document.querySelector('.three-select-field select');
    select?.focus();
    const modalRect = modal?.getBoundingClientRect();
    return {
      visible: Boolean(modal && modalRect.width > 0 && modalRect.height > 0),
      insideViewport: Boolean(modalRect && modalRect.left >= 0 && modalRect.right <= innerWidth && modalRect.bottom <= innerHeight),
      shellBackground: shell ? getComputedStyle(shell).backgroundColor : null,
      canvasSize: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      focusBorder: select ? getComputedStyle(select).borderColor : null,
      error: document.querySelector('.three-preview-error')?.textContent ?? null,
    };
  })()`);
  assert(preview.visible && preview.insideViewport, "3D preview is not visibly contained in the viewport.");
  assert(preview.shellBackground === "rgb(243, 246, 250)", "3D preview background did not resolve from its semantic token.");
  assert(preview.canvasSize?.every((value) => value > 0), "3D preview canvas did not render at a visible size.");
  assert(!preview.error, `3D preview reported an error: ${preview.error}`);
  const previewShot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/vectora-semantic-3d.png", Buffer.from(previewShot.data, "base64"));
  assert(runtimeErrors.length === 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);

  console.log("Semantic color tokens, CAM operation swatches, viewport containment, and 3D preview rendering passed.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  socket.close();
}
