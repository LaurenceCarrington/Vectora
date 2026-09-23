import fs from "node:fs";
// Use an isolated Chrome profile: this test imports bitmaps and changes its test document.
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9346";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin }); await wait(1600);

  await evaluate(`document.querySelector('[aria-label="Preferences"]').click()`); await wait(150);
  const preferenceText = await evaluate(`document.querySelector('.preferences-page').innerText`);
  assert(preferenceText.includes("Grid and snapping") && preferenceText.includes("Object snaps") && preferenceText.includes("Drawing behaviour"),
    "Clean workspace preference groups are missing");
  assert(!preferenceText.includes("CAM defaults") && !preferenceText.includes("Theme") && !preferenceText.includes("Performance"),
    "Removed CAM, theme, or performance settings remain in Preferences");
  assert(!await evaluate(`!!document.querySelector('.preferences-tabs')`), "Legacy preference tabs remain");
  await evaluate(`document.querySelector('.preferences-hub [aria-label="Close panel"]').click()`);
  await evaluate(`document.querySelector('[aria-label="Manufacture"]').click()`); await wait(250);

  const camText = () => evaluate(`document.querySelector('.cam-panel').innerText`);
  assert(await evaluate(`!!document.querySelector('.cam-defaults')`), "Manufacture is missing the relocated CAM defaults");
  assert(await evaluate(`[...document.querySelectorAll('.cam-accordion')].every(section => !section.open)`), "CAM accordions should start collapsed");
  await evaluate(`document.querySelector('.cam-defaults > summary').click()`); await wait(100);
  const defaultsText = await evaluate(`document.querySelector('.cam-defaults').innerText`);
  for (const label of ["Controller dialect", "Serial baud rate", "Machine bed", "Machine units", "Job origin", "Kerf width", "Cut feed", "Engrave feed", "Score feed", "Rapid feed"]) {
    assert(defaultsText.includes(label), `Missing relocated CAM setting: ${label}`);
  }
  await evaluate(`(() => {
    const choose=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');el.value=String(value);el.dispatchEvent(new Event('change',{bubbles:true}));};
    choose('Default serial baud rate',250000); choose('Job origin','center');
    choose('Default G-code dialect','marlin'); choose('Machine units','in');
    const setNumber=(label,value)=>{const input=[...document.querySelectorAll('.cam-defaults .cam-field')].find(el=>el.textContent.includes(label))?.querySelector('input');if(!input)throw new Error('Missing '+label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    setNumber('Bed width',600); setNumber('Bed height',400);
    setNumber('Cut feed',1300); setNumber('Engrave feed',2700);
    setNumber('Score feed',1900); setNumber('Rapid feed',7500);
  })()`); await wait(150);
  assert(await evaluate(`JSON.parse(localStorage.vectora_preferences).cam.defaultBaudRate===250000 && JSON.parse(localStorage.vectora_preferences).cam.machineBedWidthMm===600`), "Machine defaults did not persist");
  assert(!await evaluate(`!!document.querySelector('.cam-tabs')`), "Legacy CAM tabs remain");
  assert((await camText()).includes("250,000 baud"), "CAM did not inherit persisted baud rate");
  assert((await camText()).includes("MARLIN") && (await camText()).includes("600 × 400 mm"), "CAM did not inherit machine profile");
  assert((await camText()).includes("Material preset") && (await camText()).includes("Cutter library"), "Material/cutter block missing");
  assert((await camText()).includes("Cut feed") && (await camText()).includes("Leads and ramps") && (await camText()).includes("Holding tabs"), "Per-job process controls missing");
  const defaultsScreenshot=await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync("/tmp/vectora-manufacture-defaults.png",Buffer.from(defaultsScreenshot.data,"base64"));
  await evaluate(`document.querySelector('.cam-defaults > summary').click()`); await wait(80);
  assert(await evaluate(`[...document.querySelectorAll('.cam-accordion')].every(section => !section.open)`), "CAM accordions should start collapsed");
  assert(!(await camText()).includes("Apply pocket"), "Pocket settings shown without closed selection");

  await evaluate(`(async () => {
    const {documentModel}=await import('/src/document/DocumentModel.ts'); window.camDocument=documentModel;
    const doc=documentModel.getDocument();
    documentModel.addEntity({id:'cam-pref-rect',type:'rectangle',layerId:doc.activeLayerId,intent:'cut',visible:true,locked:false,
      style:{strokeColor:null,strokeWidth:1,fillColor:null,dashArray:[]},origin:{x:10,y:10},width:30,height:20,cornerRadius:0,
      bbox:{minX:10,minY:10,maxX:40,maxY:30}});
    documentModel.selectEntities(['cam-pref-rect']);
  })()`); await wait(200);
  assert((await camText()).includes("Apply pocket"), "Closed selection did not expose pocket settings");

  assert(await evaluate(`(() => {
    const body=document.querySelector('.cam-body'); body.scrollTop=body.scrollHeight;
    const panel=document.querySelector('.cam-panel').getBoundingClientRect();
    const output=document.querySelector('.cam-output-row').getBoundingClientRect();
    return output.bottom<=panel.bottom && output.top>panel.top
      && !!document.querySelector('.simulator-controls')
      && !!document.querySelector('.cam-output-row [aria-label="Direct stream"]')
      && document.querySelectorAll('.cam-output-row .cam-actions button').length===2
      && [...document.querySelectorAll('.cam-output-row .cam-actions button')].every(button=>button.checkVisibility());
  })()`), "CAM simulation and export output are not visible at the end of the settings scroll area");

  const screenshot=await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync("/tmp/vectora-cam-preferences.png",Buffer.from(screenshot.data,"base64"));

  await send("Emulation.setDeviceMetricsOverride", { width: 824, height: 600, deviceScaleFactor: 1, mobile: false });
  await wait(120);
  const compactLayout = await evaluate(`(() => {
    const bodyElement=document.querySelector('.cam-body'); bodyElement.scrollTop=bodyElement.scrollHeight;
    const panel=document.querySelector('.cam-panel').getBoundingClientRect();
    const body=bodyElement.getBoundingClientRect();
    const output=document.querySelector('.cam-output-row').getBoundingClientRect();
    return { bodyHeight: body.height, outputHeight: output.height, outputInside: output.bottom <= panel.bottom + 1 };
  })()`);
  assert(compactLayout.outputInside, "Compact CAM output row overflows the panel");
  assert(compactLayout.bodyHeight >= 180, `Compact CAM settings area is too short (${compactLayout.bodyHeight}px)`);
  assert(compactLayout.outputHeight <= 175, `Compact CAM output row is too tall (${compactLayout.outputHeight}px)`);
  const compactScreenshot=await send("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync("/tmp/vectora-cam-compact.png",Buffer.from(compactScreenshot.data,"base64"));
  assert(errors.length===0, `Runtime errors: ${JSON.stringify(errors)}`);
  console.log("PASS: persisted machine preferences, lean CAM layout, contextual pocketing, process controls, and visible output actions.");
} finally { await send("Target.closeTarget", {targetId:target.id}).catch(()=>{}); ws.close(); }
