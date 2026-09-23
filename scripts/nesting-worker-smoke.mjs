import { Worker } from 'node:worker_threads';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const asset = readdirSync('dist/assets').find((name) => /^nestingWorker-.*\.js$/.test(name));
const bundle = pathToFileURL(`${process.cwd()}/dist/assets/${asset}`).href;
const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  globalThis.self = globalThis;
  self.postMessage = (message) => parentPort.postMessage(message);
  import(${JSON.stringify(bundle)}).then(() => {
    parentPort.on('message', (data) => self.onmessage({ data }));
    parentPort.postMessage({ type: 'ready' });
  });
`, { eval: true });
const layers = [{ id: 'cut', name: 'Cut', locked: false }];
const rect = (id, x) => ({ id, type: 'polyline', layerId: 'cut', intent: 'cut', visible: true, locked: false, closed: true,
  style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
  points: [{x,y:0},{x:x+18,y:0},{x:x+18,y:18},{x,y:18}], bbox:{minX:x,minY:0,maxX:x+18,maxY:18} });
const request = { entities: [rect('a',100),rect('b',150)], options: { sheetWidth:20,sheetHeight:20,margin:1,spacing:2,layers } };
let progress = [];
let gotResult = false;
const timeout = setTimeout(() => { worker.terminate(); throw new Error('Worker timed out'); }, 5000);
worker.on('error', (error) => { throw error; });
worker.on('message', async (message) => {
  if (message.type === 'ready') worker.postMessage(request);
  if (message.type === 'progress') progress.push(message.progress.completed);
  if (message.type === 'result') {
    if (message.result.sheets.length !== 2 || progress.join(',') !== '0,1,2') throw new Error('Bundled worker layout/progress failed');
    gotResult = true;
    worker.postMessage({ ...request, options: { ...request.options, sheetWidth: 1 } });
  }
  if (message.type === 'error') {
    if (!gotResult || !message.error.includes('usable nesting area')) throw new Error(`Unexpected error: ${message.error}`);
    clearTimeout(timeout);
    await worker.terminate();
    console.log('Production nesting worker: actual worker-thread execution, multi-sheet result, progress, and validation errors passed.');
  }
});
