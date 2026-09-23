// Run against an isolated Chrome profile and a local Vectora dev server.
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? 'http://127.0.0.1:9348';
const appOrigin = process.env.VECTORA_ORIGIN ?? 'http://127.0.0.1:4188/';
const tabs = await fetch(`${debugOrigin}/json`).then((response) => response.json());
const target = tabs.find((tab) => tab.type === 'page' && (tab.url === 'about:blank' || tab.url === appOrigin));
if (!target) throw new Error('Open about:blank in an isolated Chrome debugging profile.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  return result.result.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, description) => { if (!condition) throw new Error(description); };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: appOrigin });
  await wait(1_200);

  const storage = await evaluate(`(async () => {
    const store = await import('/src/recovery/recoveryStore.ts');
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { serializeVectoraDocument } = await import('/src/io/filePersistence.ts');
    await store.clearRecoveries();
    const source = documentModel.getDocument();
    const make = (id, version) => serializeVectoraDocument({ ...source, id, version, title: id });
    const slot = (version, snapshot) => ({ updatedAt: Date.now() + version, documentRevision: version, documentName: 'one.vectora', snapshot });
    await store.saveRecovery('test-one', slot(1, make('test-one', 1)));
    await store.saveRecovery('test-one', slot(2, make('test-one', 2)));
    await store.saveRecovery('test-two', slot(1, make('test-two', 1)));
    const updated = await store.getRecovery('test-one');
    const multiple = await store.listRecoveries();
    await store.saveRecovery('test-one', slot(3, '{broken json'));
    const fallback = await store.getRecovery('test-one');
    await store.saveRecovery('test-broken', slot(1, '{broken json'));
    const broken = await store.getRecovery('test-broken');
    const future = store.inspectRecovery({ documentId: 'future', schemaVersion: 999, current: slot(1, make('future', 1)) });
    const points = Array.from({length:20_000},(_,index)=>({x:index/10,y:Math.sin(index/10)}));
    const largeEntity = {id:'large-path',type:'polyline',layerId:source.activeLayerId,intent:'cut',visible:true,locked:false,
      style:{strokeColor:null,strokeWidth:1,fillColor:null,dashArray:[]},points,closed:false,
      bbox:{minX:0,minY:-1,maxX:2000,maxY:1}};
    const largeSource = serializeVectoraDocument({...source,id:'test-large',version:1,entities:new Map([['large-path',largeEntity]])});
    await store.saveRecovery('test-large',slot(1,largeSource));
    const large = await store.getRecovery('test-large');
    await store.deleteRecovery('test-one');
    const deleted = await store.getRecovery('test-one');
    await store.clearRecoveries();
    return { updated: updated?.documentRevision, count: multiple.length, fallback: fallback?.source,
      fallbackRevision: fallback?.documentRevision, broken: broken?.source, future: future.source,
      largePoints:large?.document?.entities?.[0]?.points?.length,deleted, cleared: (await store.listRecoveries()).length };
  })()`);
  assert(storage.updated === 2 && storage.count === 2, 'Save/update and multiple-document storage');
  assert(storage.fallback === 'previous' && storage.fallbackRevision === 2, 'Corrupt current falls back to previous');
  assert(storage.broken === 'corrupt' && storage.future === 'corrupt', 'Malformed and future schema remain nonfatal');
  assert(storage.largePoints === 20_000, 'Large vector snapshot survives IndexedDB round trip');
  assert(storage.deleted === null && storage.cleared === 0, 'Deletion and clearing');
  await send('Page.reload', { ignoreCache: true });
  await wait(1_000);

  const initial = await evaluate(`(async () => {
    const {documentModel}=await import('/src/document/DocumentModel.ts');
    const document=documentModel.getDocument();
    documentModel.addEntity({ id:'recovery-rectangle', type:'rectangle', layerId:document.activeLayerId,
      intent:'cut', visible:true, locked:false,
      style:{strokeColor:'#123456',strokeWidth:2,fillColor:'#f59338',dashArray:[]},
      origin:{x:10,y:20},width:30,height:40,cornerRadius:5,
      bbox:{minX:10,minY:20,maxX:40,maxY:60} });
    const { DEFAULT_RASTER_SETTINGS, encodeRgba } = await import('/src/cam/rasterCamEngine.ts');
    documentModel.addEntity({ id:'recovery-bitmap', type:'image', layerId:document.activeLayerId,
      intent:'raster', visible:true, locked:false,
      style:{strokeColor:null,strokeWidth:0,fillColor:null,dashArray:[]},
      origin:{x:70,y:20},right:{x:71,y:20},top:{x:70,y:21},
      pixelWidth:1,pixelHeight:1,rgba:encodeRgba([255,20,10,255]),raster:DEFAULT_RASTER_SETTINGS,
      bbox:{minX:70,minY:20,maxX:71,maxY:21} });
    return { id: documentModel.getDocument().id, version: documentModel.getDocument().version };
  })()`);
  await wait(3_500);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${initial.id}'))?.document?.entities?.[0]?.style?.fillColor})()`) === '#f59338', 'Debounced full document snapshot');

  await send('Page.reload', { ignoreCache: true });
  await wait(1_400);
  assert(await evaluate(`!!document.querySelector('.recovery-dialog')`), 'Reload offers local recovery');
  assert(await evaluate(`document.querySelector('.recovery-dialog').innerText.includes('recovery-rectangle')`) === false, 'Recovery chooser uses document name, not internal entity IDs');
  await evaluate(`document.querySelector('.recovery-dialog .primary').click()`);
  await wait(350);
  const restored = await evaluate(`(async()=>{const {documentModel}=await import('/src/document/DocumentModel.ts');const {filePersistence}=await import('/src/io/filePersistence.ts');const entity=documentModel.getDocument().entities.get('recovery-rectangle');const bitmap=documentModel.getDocument().entities.get('recovery-bitmap');return {id:documentModel.getDocument().id,fill:entity?.style.fillColor,radius:entity?.cornerRadius,bitmap:bitmap?.rgba,rasterFeed:bitmap?.raster.feedRate,dirty:filePersistence.isDirty()}})()`);
  assert(restored.id === initial.id && restored.fill === '#f59338' && restored.radius === 5 && restored.bitmap === '/xQK/w==' && restored.rasterFeed === 3000 && restored.dirty, 'Recovery restores geometry, image pixels, raster settings and unsaved state');

  const saved = await evaluate(`(async()=>{
    const {filePersistence}=await import('/src/io/filePersistence.ts');
    window.showSaveFilePicker=async()=>({name:'confirmed.vectora',createWritable:async()=>({write:async()=>{},close:async()=>{}})});
    const result=await filePersistence.save();
    return {status:result.status,dirty:filePersistence.isDirty()};
  })()`);
  await wait(150);
  assert(saved.status === 'saved' && !saved.dirty, 'Confirmed native save remains authoritative');
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return await getRecovery('${initial.id}')})()`) === null, 'Confirmed save clears stale recovery');

  await evaluate(`(async()=>{const {documentModel}=await import('/src/document/DocumentModel.ts');documentModel.updateEntity('recovery-rectangle',{width:31});})()`);
  await wait(3_500);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${initial.id}'))?.document?.entities?.[0]?.width})()`) === 31, 'Recovery restarts after subsequent edits');

  const cancelled = await evaluate(`(async()=>{const {filePersistence}=await import('/src/io/filePersistence.ts');window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')};return (await filePersistence.save(true)).status})()`);
  assert(cancelled === 'cancelled' && await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return !!(await getRecovery('${initial.id}'))})()`), 'Cancelled save preserves drawing and recovery');
  await evaluate(`(async()=>{const {filePersistence}=await import('/src/io/filePersistence.ts');filePersistence.markImported()})()`);

  await evaluate(`document.querySelector('[aria-label="File menu"]').click()`);
  await evaluate(`[...document.querySelectorAll('.file-menu .menu-row')].find(button=>button.innerText.includes('New document')).click()`);
  await wait(150);
  await evaluate(`document.querySelector('.unsaved-modal .primary').click()`);
  await wait(200);
  assert(await evaluate(`!!document.querySelector('.unsaved-modal')`), 'Cancelled Save and continue leaves the New prompt open');
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return !!(await getRecovery('${initial.id}'))})()`), 'Cancelled New save leaves recovery intact');
  await evaluate(`document.querySelector('.unsaved-modal footer button').click()`);

  const conflict = await evaluate(`(async()=>{
    const {documentModel}=await import('/src/document/DocumentModel.ts');
    window.recoveryPeer=new BroadcastChannel('vectora-recovery-owners');
    window.recoveryPeer.postMessage({tabId:'browser-smoke-peer',documentId:documentModel.getDocument().id,type:'claim'});
    await new Promise(resolve=>setTimeout(resolve,250));
    return document.body.innerText.includes('Local recovery is paused here');
  })()`);
  assert(conflict, 'Same-document tab ownership conflict detected');
  await evaluate(`(async()=>{const {documentModel}=await import('/src/document/DocumentModel.ts');documentModel.updateEntity('recovery-rectangle',{width:32})})()`);
  await wait(3_500);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${initial.id}'))?.document?.entities?.[0]?.width})()`) === 31, 'Conflict pauses writes');
  await evaluate(`window.recoveryPeer.postMessage({tabId:'browser-smoke-peer',documentId:'${initial.id}',type:'release'});window.recoveryPeer.close()`);
  await wait(3_500);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${initial.id}'))?.document?.entities?.[0]?.width})()`) === 32, 'Writes resume when conflict clears');

  await evaluate(`document.querySelector('[aria-label="File menu"]').click()`);
  await evaluate(`[...document.querySelectorAll('.file-menu .menu-row')].find(button=>button.innerText.includes('New document')).click()`);
  await wait(200);
  assert(await evaluate(`!!document.querySelector('.unsaved-modal')`), 'New document retains unsaved-change prompt');
  await evaluate(`document.querySelector('.unsaved-modal .danger-subtle').click()`);
  await wait(250);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return await getRecovery('${initial.id}')})()`) === null, 'Explicit discard removes abandoned recovery');
  assert(await evaluate(`(async()=>{const {filePersistence}=await import('/src/io/filePersistence.ts');return !filePersistence.isDirty()})()`), 'New document starts clean');

  const fallbackId = 'browser-fallback';
  await evaluate(`(async()=>{
    const store=await import('/src/recovery/recoveryStore.ts');
    const {documentModel}=await import('/src/document/DocumentModel.ts');
    const {serializeVectoraDocument}=await import('/src/io/filePersistence.ts');
    const source=documentModel.getDocument();
    await store.saveRecovery('${fallbackId}',{updatedAt:Date.now(),documentRevision:1,documentName:'fallback.vectora',snapshot:serializeVectoraDocument({...source,id:'${fallbackId}',version:1})});
    await store.saveRecovery('${fallbackId}',{updatedAt:Date.now()+1,documentRevision:2,documentName:'fallback.vectora',snapshot:'{broken'});
  })()`);
  await send('Page.reload', { ignoreCache: true });
  await wait(1_300);
  assert(await evaluate(`document.querySelector('.recovery-dialog')?.innerText.includes('previous valid copy')`), 'Startup offers previous valid copy when current is corrupt');
  await evaluate(`document.querySelector('.recovery-dialog .primary').click()`);
  await wait(150);
  assert(await evaluate(`(async()=>{const {documentModel}=await import('/src/document/DocumentModel.ts');const {filePersistence}=await import('/src/io/filePersistence.ts');return documentModel.getDocument().id==='${fallbackId}' && filePersistence.isDirty()})()`), 'Previous snapshot recovers as dirty');

  const storageFailure = await evaluate(`(async()=>{
    const {documentModel}=await import('/src/document/DocumentModel.ts');
    const original=indexedDB.open;
    indexedDB.open=()=>{throw new DOMException('Storage full','QuotaExceededError')};
    try {
      const layer=documentModel.getDocument().layers[0];
      documentModel.updateLayer(layer.id,{name:'Still editable without recovery'});
      await new Promise(resolve=>setTimeout(resolve,3300));
      return {warning:document.body.innerText.includes('Local recovery could not be updated'),layer:documentModel.getDocument().layers[0].name};
    } finally {indexedDB.open=original;}
  })()`);
  assert(storageFailure.warning && storageFailure.layer === 'Still editable without recovery', 'Quota failure warns without blocking editing');
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${fallbackId}'))?.source})()`) === 'previous', 'Failed write preserves previous valid recovery');

  await evaluate(`document.querySelector('[aria-label="Preferences"]').click()`);
  await wait(250);
  assert(await evaluate(`!!document.querySelector('[aria-label="Keep local recovery copies"]')`), 'Local recovery preference is available');
  await evaluate(`window.confirm=()=>true;[...document.querySelectorAll('.preferences-page button.danger-subtle')].find(button=>button.textContent.trim()==='Clear local data').click()`);
  await wait(200);
  assert(await evaluate(`(async()=>{const {listRecoveries}=await import('/src/recovery/recoveryStore.ts');const {documentModel}=await import('/src/document/DocumentModel.ts');return (await listRecoveries()).length===0 && documentModel.getDocument().layers[0].name==='Still editable without recovery'})()`), 'Clear recovery data leaves the in-memory drawing untouched');
  await evaluate(`document.querySelector('[aria-label="Keep local recovery copies"]').click()`);
  await evaluate(`(async()=>{const {documentModel}=await import('/src/document/DocumentModel.ts');const layer=documentModel.getDocument().layers[0];documentModel.updateLayer(layer.id,{name:'Recovery disabled'})})()`);
  await wait(3_300);
  assert(await evaluate(`(async()=>{const {listRecoveries}=await import('/src/recovery/recoveryStore.ts');return (await listRecoveries()).length===0})()`), 'Disabled recovery does not write snapshots');
  await evaluate(`document.querySelector('[aria-label="Keep local recovery copies"]').click()`);
  await wait(3_300);
  assert(await evaluate(`(async()=>{const {getRecovery}=await import('/src/recovery/recoveryStore.ts');return (await getRecovery('${fallbackId}'))?.document?.layers?.[0]?.name})()`) === 'Recovery disabled', 'Re-enabling recovery snapshots the current unsaved drawing');

  console.log('Recovery browser PASS: IndexedDB revisions, corrupt fallback, schema handling, reload/recover with bitmap, dirty state, confirmed/cancelled save, tab conflict, explicit discard, quota failure, clear-data UI, and enabled preference.');
} finally { socket.close(); }
