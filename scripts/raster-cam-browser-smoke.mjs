import fs from "node:fs";
// Use an isolated Chrome profile: this test imports bitmaps and changes its test document.
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9342";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4182/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated test tab.");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map(), errors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
  if (!message.id) return;
  const request = pending.get(message.id); pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (v, message) => { if (!v) throw new Error(message); };
try {
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin }); await wait(1800);
  await evaluate(`document.querySelector('[aria-label="Raster engrave"]').click()`); await wait(300);
  for (const [mime, extension] of [["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]]) {
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,32,16);
      ctx.fillStyle = 'black'; ctx.fillRect(0,0,12,16); ctx.fillRect(24,0,8,8);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, ${JSON.stringify(mime)}));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'raster-test.${extension}', {type:${JSON.stringify(mime)}}));
      const input = document.querySelector('.cam-panel input[type=file]'); input.files = transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(700);
  }
  const count = await evaluate(`(async () => {const camSource=await (await fetch('/src/components/panels/CamPanel.tsx')).text(); const moduleUrl=camSource.split('from \"').map(p=>p.split('\"')[0]).find(p=>p.startsWith('/src/document/DocumentModel.ts')); const {documentModel}=await import(moduleUrl); window.rasterDocument = documentModel; return [...documentModel.getDocument().entities.values()].filter(e=>e.type==='image').length;})()`);
  if (count !== 3) console.log(await evaluate(`document.body.innerText`));
  assert(count === 3, `PNG/JPEG/WebP import failed: expected 3 images, found ${count}`);
  assert(await evaluate(`document.body.innerText.includes('Apply raster engrave')`), "Image selection did not expose raster controls");
  await evaluate(`(() => { const select=[...document.querySelectorAll('.cam-panel label')].find(l=>l.textContent.startsWith('Algorithm')).querySelector('select'); select.value='jarvis-judice-ninke'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait(500);
  assert(await evaluate(`[...window.rasterDocument.getDocument().entities.values()].filter(e=>e.type==='image').at(-1).raster.algorithm === 'jarvis-judice-ninke'`), "Algorithm control did not update the selected image");
  await evaluate(`(() => { const select=[...document.querySelectorAll('.cam-panel label')].find(l=>l.textContent.startsWith('Scan axis')).querySelector('select'); select.value='90'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait(300);
  assert(await evaluate(`[...window.rasterDocument.getDocument().entities.values()].filter(e=>e.type==='image').at(-1).raster.scanAngle === 90`), "Vertical scan selection failed");
  await evaluate(`const input=[...document.querySelectorAll('.cam-panel label.cam-field')].find(l=>l.textContent.startsWith('Resolution')).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'127'); input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait(400);
  assert(await evaluate(`[...window.rasterDocument.getDocument().entities.values()].filter(e=>e.type==='image').at(-1).raster.dpi === 127`), "DPI control failed");
  const generated = await evaluate(`(async () => {
    const {buildManufacturingPlan}=await import('/src/cam/processModel.ts'); const {optimizeToolpaths}=await import('/src/cam/optimizer.ts');
    const {compileGcode,DEFAULT_GRBL_LASER_PROFILE}=await import('/src/cam/gcodeCompiler.ts');
    const plan=optimizeToolpaths(buildManufacturingPlan(window.rasterDocument.getDocument()));
    const code=compileGcode(plan,DEFAULT_GRBL_LASER_PROFILE); return {count:plan.toolpaths.length,modulated:/G1 X[^\\n]+ S1000/.test(code)};
  })()`);
  assert(generated.count === 3 && generated.modulated, "Imported bitmaps did not compile to scanline G-code");
  await evaluate(`document.querySelector('.raster-panel [aria-label="Close panel"]').click()`); await wait(250);
  await evaluate(`document.querySelector('[aria-label="Raster engrave"]').click()`); await wait(300);
  assert(await evaluate(`[...document.querySelectorAll('.cam-panel label')].find(l=>l.textContent.startsWith('Algorithm')).querySelector('select').value === 'jarvis-judice-ninke'`), "Settings were lost when CAM reopened");
  await evaluate(`(async()=>{const camSource=await (await fetch('/src/components/panels/CamPanel.tsx')).text(); const moduleUrl=camSource.split('from \"').map(p=>p.split('\"')[0]).find(p=>p.startsWith('/src/store/useVectorStore.ts')); const {useVectorStore}=await import(moduleUrl); useVectorStore.getState().setViewport({x:-180,y:120,zoom:5}); const section=[...document.querySelectorAll('.cam-section')].find(s=>s.textContent.includes('Direct bitmap')); section.scrollIntoView({block:'start'});})()`); await wait(300);
  const screenshot = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/vectora-raster-cam.png", Buffer.from(screenshot.data, "base64"));
  await evaluate(`document.querySelector('[aria-label="3D preview"]').click()`); await wait(1800);
  assert(await evaluate(`!!document.querySelector('.three-viewport canvas') && !document.querySelector('.three-preview-error')`), "Raster 3D preview failed");
  assert(await evaluate(`document.querySelector('.three-preview-summary').textContent.includes('3 surface features')`), "3D preview omitted imported raster surfaces");
  const threeScreenshot = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/vectora-raster-3d.png", Buffer.from(threeScreenshot.data, "base64"));
  assert(errors.length === 0, `Browser runtime exceptions: ${JSON.stringify(errors)}`);
  console.log("Browser PASS: PNG/JPEG/WebP import, raster selection, algorithm/DPI/direction controls, panel reopen, G-code generation, canvas rendering and 3D surfaces. Screenshot: /tmp/vectora-raster-cam.png");
} finally { await send("Target.closeTarget", { targetId: target.id }).catch(() => {}); ws.close(); }
