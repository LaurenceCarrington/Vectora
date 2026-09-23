const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9346";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated save-continuation test tab.");
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

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: appOrigin });
  await wait(1_200);
  const originalId = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const doc = documentModel.getDocument();
    documentModel.addEntity({
      id:'save-cancel-asset', type:'rectangle', layerId:doc.activeLayerId, intent:'cut', visible:true, locked:false,
      style:{strokeColor:null,strokeWidth:1,fillColor:'#e11d48',dashArray:[]}, origin:{x:0,y:0}, width:40,height:30,cornerRadius:0,
      bbox:{minX:0,minY:0,maxX:40,maxY:30}
    });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable:true, value:async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    return documentModel.getDocument().id;
  })()`);
  await evaluate(`document.querySelector('[aria-label="File menu"]').click()`);
  await evaluate(`[...document.querySelectorAll('.file-menu .menu-row')].find(button => button.textContent.includes('New document')).click()`);
  await wait(120);
  assert(await evaluate(`document.querySelector('.unsaved-modal') !== null`), "New document did not request an unsaved-changes decision.");
  assert(await evaluate(`document.querySelector('.unsaved-save-note')?.textContent.includes('cannot confirm it was saved')`),
    "The save decision did not explain that a browser download is unconfirmed.");
  await evaluate(`[...document.querySelectorAll('.unsaved-modal footer button')].find(button => button.textContent.includes('Save and continue')).click()`);
  await wait(180);
  const afterCancel = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { filePersistence } = await import('/src/io/filePersistence.ts');
    return {
      id: documentModel.getDocument().id,
      asset: documentModel.getDocument().entities.has('save-cancel-asset'),
      dirty: filePersistence.isDirty(),
      modal: document.querySelector('.unsaved-modal') !== null,
    };
  })()`);
  assert(afterCancel.id === originalId && afterCancel.asset && afterCancel.dirty && afterCancel.modal,
    "Cancelling the save removed or marked-clean the current drawing.");

  await evaluate(`Object.defineProperty(window, 'showSaveFilePicker', { configurable:true, value:undefined }); true`);
  await evaluate(`[...document.querySelectorAll('.unsaved-modal footer button')].find(button => button.textContent.includes('Save and continue')).click()`);
  await wait(180);
  const afterDownload = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { filePersistence } = await import('/src/io/filePersistence.ts');
    return { id:documentModel.getDocument().id, asset:documentModel.getDocument().entities.has('save-cancel-asset'), dirty:filePersistence.isDirty(), modal:document.querySelector('.unsaved-modal') !== null };
  })()`);
  assert(afterDownload.id === originalId && afterDownload.asset && afterDownload.dirty && afterDownload.modal,
    "An unconfirmed browser download replaced the current drawing.");

  await evaluate(`Object.defineProperty(window, 'showSaveFilePicker', { configurable:true, value:async () => ({
    name:'confirmed.vectora', createWritable:async () => ({ write:async () => {}, close:async () => {} })
  }) }); true`);
  await evaluate(`[...document.querySelectorAll('.unsaved-modal footer button')].find(button => button.textContent.includes('Save and continue')).click()`);
  await wait(650);
  const afterSave = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { id:documentModel.getDocument().id, asset:documentModel.getDocument().entities.has('save-cancel-asset'), modal:document.querySelector('.unsaved-modal') !== null };
  })()`);
  assert(afterSave.id !== originalId && !afterSave.asset && !afterSave.modal,
    `A confirmed save did not continue to the requested new document: ${JSON.stringify(afterSave)}`);
  assert(runtimeErrors.length === 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  console.log("Cancelled saves and unconfirmed downloads preserve the drawing; only confirmed writes continue replacement.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  socket.close();
}
