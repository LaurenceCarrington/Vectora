import fs from "node:fs";
// Use an isolated Chrome profile: this test clears and edits vectora_tools localStorage.
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9344";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4184/";
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin }); await wait(1600);
  await evaluate(`localStorage.removeItem("vectora_tools")`);
  await send("Page.reload"); await wait(1600);
  const open = async () => { await evaluate(`document.querySelector('[aria-label="Manufacture"]').click()`); await wait(300); };
  const select = async value => { await evaluate(`(() => { const el=document.querySelector('[aria-label="Cutter"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true})); })()`); await wait(250); };
  const click = async label => { await evaluate(`[...document.querySelectorAll('.tool-library button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await wait(100); };
  const input = async (label,value) => { await evaluate(`(() => { const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true})); })()`); await wait(100); };
  // Machine defaults repeat labels such as Cut feed; inspect the active recipe instead.
  const field = async label => evaluate(`[...document.querySelectorAll('.cam-panel label.cam-field')].find(l=>!l.closest('.cam-defaults') && l.textContent.startsWith(${JSON.stringify(label)})).querySelector('input').value`);
  await open();
  await evaluate(`(async () => {
    const source=await (await fetch('/src/components/panels/CamPanel.tsx')).text();
    const url=source.split('from "').map(p=>p.split('"')[0]).find(p=>p.startsWith('/src/document/DocumentModel.ts'));
    const {documentModel}=await import(url); const doc=documentModel.getDocument();
    documentModel.addEntity({id:'tool-library-boundary',type:'rectangle',layerId:doc.activeLayerId,intent:'cut',visible:true,locked:false,
      style:{strokeColor:null,strokeWidth:1,fillColor:null,dashArray:[]},origin:{x:10,y:10},width:30,height:20,cornerRadius:0,
      bbox:{minX:10,minY:10,maxX:40,maxY:30}});
    documentModel.selectEntities(['tool-library-boundary']);
  })()`); await wait(200);
  await select('factory-endmill-1-4');
  assert(await field('Spindle speed')==='12000','RPM populated');
  assert(await field('Cut feed')==='1200','Cut feed populated');
  assert(await field('Engrave feed')==='1200','Engrave feed populated');
  assert(await field('Tool diameter')==='6.35','Pocket diameter populated');
  assert(await field('Kerf width')==='6.35','Kerf populated');
  assert(await field('Vector stepdown')==='2','Vector stepdown populated');
  assert(await field('Stepdown')==='2','Pocket stepdown populated');
  await click('Edit cutter');
  assert(await evaluate(`document.querySelector('[aria-label="Cutter name"]').disabled`),'Factories read-only');
  await click('Save a copy'); await input('Cutter name','Browser custom cutter');
  await input('Recommended rpm',18000); await input('Flutes',3); await input('Chip load',0.02);
  assert(await evaluate(`document.querySelector('[aria-label="Recommended feed"]').value`)==='1080','Forward recalculation');
  await input('Recommended feed',1350);
  assert(await evaluate(`document.querySelector('[aria-label="Chip load"]').value`)==='0.025','Reverse recalculation');
  await click('Save and apply');
  assert(await field('Cut feed')==='1350' && await field('Spindle speed')==='18000','Custom application');
  const id=await evaluate(`document.querySelector('[aria-label="Cutter"]').value`);
  assert(await evaluate(`JSON.parse(localStorage.getItem('vectora_tools')).tools.length` )===1,'Only custom tool persisted');
  await evaluate(`document.querySelector('.cam-panel > .cam-head [aria-label="Close panel"]').click()`);await wait(250);await open();
  assert(await evaluate(`document.querySelector('[aria-label="Cutter"]').value`)===id,'Selection retained across panel reopen');
  assert(await field('Cut feed')==='1350','Recipe retained across panel reopen');
  await send('Page.reload');await wait(1600);await open();await select(id);
  assert(await field('Spindle speed')==='18000','Library survives reload');
  await click('Edit cutter');await input('Cutter name','Renamed cutter');await click('Save and apply');
  assert(await evaluate(`JSON.parse(localStorage.getItem('vectora_tools')).tools[0].name`)==='Renamed cutter','CRUD update');
  await evaluate(`document.querySelector('.tool-library').scrollIntoView({block:'start'})`);await wait(200);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/vectora-tool-library.png',Buffer.from(screenshot.data,'base64'));
  await click('Delete cutter');assert(await evaluate(`JSON.parse(localStorage.getItem('vectora_tools')).tools.length`)===0,'CRUD delete');
  await select('factory-laser-1-5');await click('Edit cutter');await click('Save a copy');
  assert(await evaluate(`document.querySelector('[aria-label="Recommended rpm"]').disabled`),'Laser has no chip/rpm input');
  await input('Cutter name','Laser test');await click('Save and apply');
  assert(await field('Cut feed')==='1800','Laser independent feed');
  await click("Delete cutter");
  assert(errors.length===0,`Runtime exceptions: ${JSON.stringify(errors)}`);
  console.log('Browser PASS: tool selection, CAM parameter fields, factory protection, reciprocal calculator, custom CRUD, panel reopen and localStorage reload.');
} finally { ws.close(); await fetch(`${debugOrigin}/json/close/${target.id}`); }
