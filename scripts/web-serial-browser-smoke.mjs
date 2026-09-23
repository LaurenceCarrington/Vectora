import fs from 'node:fs';
// Run only against an isolated Chrome debugging profile (see WEB_SERIAL_VERIFICATION.md).
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? 'http://127.0.0.1:9338';
const appOrigin = process.env.VECTORA_ORIGIN ?? 'http://127.0.0.1:4178/';
const tabs = await fetch(`${debugOrigin}/json`).then(r=>r.json());
const target = tabs.find(t=>t.type==='page' && (t.url===appOrigin || t.url==='about:blank'));
if (!target) throw new Error('Open about:blank in an isolated Chrome debugging profile.');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let id = 0; const pending = new Map(); const errors=[];
ws.addEventListener('message', event=>{const msg=JSON.parse(event.data); if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails); if(msg.id) { const req=pending.get(msg.id); pending.delete(msg.id); msg.error?req.reject(new Error(JSON.stringify(msg.error))):req.resolve(msg.result); }});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw new Error(m);};
try {
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:appOrigin}); await wait(1800);
await evaluate(`(async()=>{const {useVectorStore}=await import('/src/store/useVectorStore.ts');useVectorStore.getState().updateCamPreferences({defaultGcodeDialect:'grbl',defaultBaudRate:115200});})()`);
await wait(200);
await evaluate(`document.querySelector('[aria-label="Manufacture"]').click()`);await wait(350);
assert(await evaluate(`!!document.querySelector('[aria-label="Machine control"]')`),'Machine panel opens');
await evaluate(`Object.defineProperty(navigator,'serial',{configurable:true,value:undefined}); document.querySelector('.machine-connect').click()`); await wait(100);
assert(await evaluate(`document.body.innerText.includes('Web Serial is unavailable')`),'Unsupported browser toast');
await evaluate(`(async()=>{
const {documentModel}=await import('/src/document/DocumentModel.ts');
const doc=documentModel.getDocument();
documentModel.addEntity({id:'serial-browser-rect',type:'rectangle',layerId:doc.activeLayerId,intent:'cut',visible:true,locked:false,style:{strokeColor:null,strokeWidth:1,fillColor:null,dashArray:[]},origin:{x:10,y:10},width:30,height:20,cornerRadius:0,bbox:{minX:10,minY:10,maxX:40,maxY:30}});
const {useMachineStore}=await import('/src/store/useMachineStore.ts');window.machineStore=useMachineStore;
class Port extends EventTarget {
  writes=[]; closeCount=0; mode='Idle'; autoAck=true;
  async open() { this.readable=new ReadableStream({start:c=>this.input=c});this.writable=new WritableStream({write:bytes=>{
    const command=new TextDecoder().decode(bytes);this.writes.push(command);
    if(command==='?') this.emit('<'+this.mode+'|MPos:15,16,0|WCO:5,6,0|FS:100,0|Ov:100,100,100>\\n');
    else if(command==='$$\\n') this.emit('$13=0\\nok\\n');
    else if(command==='!') this.mode='Hold:0';
    else if(command==='~') this.mode='Run';
    else if(command==='\\x18') {this.mode='Idle';this.emit("Grbl 1.1h ['$' for help]\\n");}
    else if(this.autoAck) this.emit('ok\\n');
  }});}
  emit(text){this.input.enqueue(new TextEncoder().encode(text));}
  async close(){if(this.readable.locked||this.writable.locked)throw new Error('leaked lock');this.closeCount++;}
}
window.fakePort=new Port();
class Serial extends EventTarget {async requestPort(){return window.fakePort;}async getPorts(){return [window.fakePort];}}
Object.defineProperty(navigator,'serial',{configurable:true,value:new Serial()});
})();`);
await evaluate(`document.querySelector('.machine-connect').click()`); await wait(2000);
assert(await evaluate(`window.machineStore.getState().ready`),'Machine synchronized in browser');
assert(await evaluate(`window.machineStore.getState().workPositionKnown && window.machineStore.getState().workPosition.x===10`),'Machine position updates');
assert(await evaluate(`!!document.querySelector('[aria-label="Emergency stop"]')`),'Global emergency stop available');
const runDisabled=await evaluate(`document.querySelector('.machine-stream-actions .primary').disabled`);
assert(!runDisabled,'Validated CAM plan can run');
await evaluate(`document.querySelector('.machine-stream-actions .primary').click()`); await wait(500);
assert(await evaluate(`window.machineStore.getState().jobStatus==='complete'`),'UI job streams and waits for idle');
assert(await evaluate(`window.fakePort.writes.some(line=>line.startsWith('G1 '))`),'Compiled motion reaches fake USB');
assert(await evaluate(`!!window.machineStore.getState().jobTransform`),'Job captures canvas transform');
await evaluate(`document.querySelector('.cam-panel').scrollTop=0`);
await wait(100);
const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/vectora-machine-panel.png',Buffer.from(screenshot.data,'base64'));
// Keep a job in flight and confirm topbar hold and unmount cancellation.
await evaluate(`window.fakePort.autoAck=false; document.querySelector('.machine-stream-actions .primary').click()`);await wait(50);
assert(await evaluate(`window.fakePort.closeCount===0 && window.machineStore.getState().connectionStatus==='connected' && window.machineStore.getState().jobStatus==='streaming'`),'CAM interaction preserves USB and active streaming');
await evaluate(`document.querySelector('[aria-label="Feed hold"]').click()`);await wait(250);
assert(await evaluate(`window.machineStore.getState().jobStatus==='paused'`),'Global hold pauses streaming');
await evaluate(`document.querySelector('.cam-panel > .cam-head [aria-label="Close panel"]').click()`); await wait(500);
assert(await evaluate(`window.fakePort.closeCount===1 && window.machineStore.getState().connectionStatus==='disconnected'`),'CAM unmount stops and releases USB');
assert(await evaluate(`window.fakePort.writes.includes('\\x18')`),'Unmount requests controller stop');
assert(errors.length===0,`Runtime errors: ${JSON.stringify(errors)}`);
console.log('Browser PASS: CAM entry, unsupported toast, mock USB connection, machine position, compiled job streaming, live transform, global hold, and unmount cleanup. Screenshot: /tmp/vectora-machine-panel.png');
} finally {ws.close();}
