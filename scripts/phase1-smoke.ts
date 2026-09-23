import type { Entity, Layer } from "../src/document/types";

const [documentModule, persistenceModule, historyModule] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/io/filePersistence"),
  import("../src/document/History"),
]);
const { DocumentModel, documentModel, DocumentLockError } = documentModule;
const { createPolylineEntity } = await import("../src/canvas/useCreationStateMachine");

const {
  AddEntityCommand,
  AddLayerCommand,
  DeleteLayerCommand,
  EraseEntitiesCommand,
  DeleteEntityCommand,
  ToggleLayerStateCommand,
  UpdateEntitiesCommand,
  executeCommand,
  History,
  history,
  redo,
  undo,
} = historyModule;
const { filePersistence, parseVectoraDocument, serializeVectoraDocument } = persistenceModule;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertLockError(action: () => unknown, message: string): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof DocumentLockError, `${message} (unexpected error type)`);
    return;
  }
  throw new Error(message);
}

function line(id: string, layer: Layer): Entity {
  return {
    id,
    type: "line",
    layerId: layer.id,
    intent: layer.intent,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    visible: true,
    locked: false,
    start: { x: 0, y: 0 },
    end: { x: 20, y: 10 },
  };
}

documentModel.resetDocument();
history.clear();
filePersistence.markClean("phase-1.vectora");
assert(!filePersistence.getSnapshot().dirty, "A newly marked document should be clean.");

const phaseLayer: Layer = {
  id: "phase-1-layer",
  name: "Phase 1",
  intent: "engrave",
  color: "#7c3aed",
  visible: true,
  locked: false,
  order: 10,
};
executeCommand(new AddLayerCommand(phaseLayer));
assert(documentModel.getDocument().activeLayerId === phaseLayer.id, "A new layer was not made active.");
assert(filePersistence.getSnapshot().dirty, "Adding a layer did not mark the document dirty.");
const polyline = createPolylineEntity("phase-1-polyline", [
  { x: 0, y: 0 },
  { x: 12, y: 4 },
  { x: 24, y: 0 },
]);
assert(polyline?.type === "polyline", "Polyline creation did not produce a typed entity.");
assert(polyline.layerId === phaseLayer.id, "Polyline creation ignored the active layer.");
undo();
assert(!documentModel.getDocument().layers.some((layer) => layer.id === phaseLayer.id), "Layer undo failed.");
redo();
assert(documentModel.getDocument().activeLayerId === phaseLayer.id, "Layer redo failed.");

const first = line("phase-1-line", phaseLayer);
executeCommand(new AddEntityCommand(first));
documentModel.clearSelection();
const dirtyBeforeSelection = filePersistence.getSnapshot().dirty;
const versionBeforeSelection = documentModel.getDocument().version;
documentModel.selectEntities([first.id]);
assert(filePersistence.getSnapshot().dirty === dirtyBeforeSelection, "Selection changed persistence dirty state.");
assert(documentModel.getDocument().version === versionBeforeSelection, "Transient selection invalidated the persisted/CAM document version.");

const encoded = serializeVectoraDocument();
const decoded = parseVectoraDocument(encoded);
const rawFile = JSON.parse(encoded) as { document: Record<string, unknown> };
const beforeRoundTrip = documentModel.getDocument();
assert(decoded.id === beforeRoundTrip.id, "Native persistence lost the document id.");
assert(decoded.version === beforeRoundTrip.version, "Native persistence lost the document version.");
assert(decoded.activeLayerId === phaseLayer.id, "Native persistence lost the active layer.");
assert(decoded.entities.length === beforeRoundTrip.entities.size, "Native persistence changed entity count.");
assert(!("selection" in rawFile.document), "Transient selection leaked into the native file.");
assert(encoded.endsWith("\n"), "Native serialization is not stable, formatted JSON.");

let rejectedInvalidSchema = false;
try {
  parseVectoraDocument(encoded.replace('"schemaVersion": 1', '"schemaVersion": 99'));
} catch {
  rejectedInvalidSchema = true;
}
assert(rejectedInvalidSchema, "Native persistence accepted an unsupported schema version.");

for (const [property, value] of [["sides", 10_001], ["points", 5_001]] as const) {
  const malicious = JSON.parse(encoded) as { document: { entities: Array<Record<string, unknown>> } };
  malicious.document.entities = [{
    ...malicious.document.entities[0],
    type: property === "sides" ? "polygon" : "star",
    cx: 0, cy: 0, radius: 10, innerRadius: 5, outerRadius: 10, rotation: 0,
    [property]: value,
  }];
  let rejected = false;
  try { parseVectoraDocument(JSON.stringify(malicious)); } catch { rejected = true; }
  assert(rejected, `Native persistence accepted an excessive regular-shape ${property} count.`);
}

const failingUndo = new History();
failingUndo.executeCommand({ label: "Fail undo", execute() {}, undo() { throw new Error("undo failed"); } });
try { failingUndo.undo(); } catch { /* expected */ }
assert(failingUndo.getSnapshot().canUndo && !failingUndo.getSnapshot().canRedo, "A failed undo corrupted the history cursor.");
let redoExecutions = 0;
const failingRedo = new History();
failingRedo.executeCommand({ label: "Fail redo", execute() { if (redoExecutions++ > 0) throw new Error("redo failed"); }, undo() {} });
failingRedo.undo();
try { failingRedo.redo(); } catch { /* expected */ }
assert(!failingRedo.getSnapshot().canUndo && failingRedo.getSnapshot().canRedo, "A failed redo corrupted the history cursor.");

const originalConsoleError = console.error;
let reportedListenerFailures = 0;
console.error = () => { reportedListenerFailures += 1; };
try {
  const isolatedHistory = new History();
  let laterHistoryListenerRan = false;
  isolatedHistory.subscribe(() => { throw new Error("broken history subscriber"); });
  isolatedHistory.subscribe(() => { laterHistoryListenerRan = true; });
  isolatedHistory.executeCommand({ label: "Listener isolation", execute() {}, undo() {} });
  assert(laterHistoryListenerRan && isolatedHistory.getSnapshot().canUndo, "A failing history listener interrupted committed history state.");

  const isolatedModel = new DocumentModel(documentModel.getDocument());
  let laterDocumentListenerRan = false;
  isolatedModel.subscribe(() => { throw new Error("broken document subscriber"); });
  isolatedModel.subscribe(() => { laterDocumentListenerRan = true; });
  isolatedModel.selectEntities([]);
  assert(laterDocumentListenerRan && isolatedModel.getDocument().selection.size === 0, "A failing document listener interrupted a committed mutation.");
} finally {
  console.error = originalConsoleError;
}
assert(reportedListenerFailures === 2, "Subscriber failures were not reported exactly once per committed change.");

let savedSource = "";
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    showSaveFilePicker: async () => { throw new Error("picker I/O failed"); },
  },
});
let unexpectedPickerFailureRejected = false;
try { await filePersistence.save(true); } catch { unexpectedPickerFailureRejected = true; }
assert(unexpectedPickerFailureRejected, "An unexpected save-picker failure was silently treated as a download save.");

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    showSaveFilePicker: async () => ({
      name: "phase-1-native.vectora",
      getFile: async () => { throw new Error("Not needed by the save smoke test."); },
      createWritable: async () => ({
        write: async (data: Blob) => { savedSource = await data.text(); },
        close: async () => undefined,
      }),
    }),
  },
});
const saveResult = await filePersistence.save(true);
assert(saveResult.status === "saved" && saveResult.usedFileSystemAccess, "Native writable-handle save failed.");
assert(parseVectoraDocument(savedSource).entities.length === beforeRoundTrip.entities.size, "Writable-handle save produced invalid data.");
assert(!filePersistence.getSnapshot().dirty, "Successful native save did not mark the document clean.");
Reflect.deleteProperty(globalThis, "window");

documentModel.replaceDocument(decoded);
filePersistence.markClean("phase-1.vectora");
assert(documentModel.getDocument().id === decoded.id, "Native import did not restore document identity.");
assert(documentModel.getDocument().version === decoded.version, "Native import did not restore document version.");
assert(!filePersistence.getSnapshot().dirty, "Native import should be clean after marking the load complete.");

const erased = documentModel.getDocument().entities.get(first.id);
assert(erased, "Round-trip line is missing.");
const selectionBefore = [...documentModel.getDocument().selection];
documentModel.removeEntity(erased.id);
history.clear();
history.recordExecutedCommand(new EraseEntitiesCommand([erased], selectionBefore));
undo();
assert(documentModel.getDocument().entities.has(erased.id), "Erase undo did not restore geometry.");
redo();
assert(!documentModel.getDocument().entities.has(erased.id), "Erase redo did not remove geometry.");
undo();

const targetLayer = documentModel.getDocument().layers.find((layer) => layer.id !== phaseLayer.id);
assert(targetLayer, "A migration target layer is required.");
executeCommand(new DeleteLayerCommand(phaseLayer.id, { kind: "migrate", targetLayerId: targetLayer.id }));
assert(!documentModel.getDocument().layers.some((layer) => layer.id === phaseLayer.id), "Layer delete failed.");
assert(documentModel.getDocument().entities.get(first.id)?.layerId === targetLayer.id, "Layer migration failed.");
undo();
assert(documentModel.getDocument().layers.some((layer) => layer.id === phaseLayer.id), "Layer-delete undo did not restore the layer.");
assert(documentModel.getDocument().entities.get(first.id)?.layerId === phaseLayer.id, "Layer-delete undo did not restore entity ownership.");
redo();
assert(documentModel.getDocument().entities.get(first.id)?.layerId === targetLayer.id, "Layer-delete redo did not remigrate geometry.");
undo();
executeCommand(new DeleteLayerCommand(phaseLayer.id, { kind: "delete-contents" }));
assert(!documentModel.getDocument().entities.has(first.id), "Delete-with-layer retained contained geometry.");
undo();
assert(documentModel.getDocument().entities.get(first.id)?.layerId === phaseLayer.id, "Delete-with-layer undo did not restore geometry.");

const unlockedLayer: Layer = {
  id: "lock-test-open",
  name: "Editable",
  intent: "cut",
  color: "#3b82f6",
  visible: true,
  locked: false,
  order: 0,
};
const lockedLayer: Layer = {
  ...unlockedLayer,
  id: "lock-test-locked",
  name: "Locked layer",
  locked: true,
  order: 1,
};
const entityLocked = { ...line("entity-locked", unlockedLayer), locked: true } satisfies Entity;
const layerLocked = line("layer-locked", lockedLayer);
const editable = line("editable", unlockedLayer);
documentModel.replaceDocument({
  title: "Lock safety",
  units: "mm",
  activeLayerId: unlockedLayer.id,
  layers: [unlockedLayer, lockedLayer],
  entities: [entityLocked, layerLocked, editable],
});
history.clear();

assertLockError(
  () => documentModel.removeEntity(entityLocked.id),
  "DocumentModel deleted an entity-level locked entity.",
);
assertLockError(
  () => documentModel.updateEntity(layerLocked.id, { visible: false }),
  "DocumentModel updated an entity on a locked layer.",
);
assertLockError(
  () => documentModel.replaceEntities([{ ...entityLocked, start: { x: 5, y: 5 } }]),
  "DocumentModel batch-updated a locked entity.",
);
assertLockError(
  () => documentModel.replaceEntitySet([editable.id, entityLocked.id], []),
  "DocumentModel accepted an atomic deletion containing a locked entity.",
);
assert(documentModel.getDocument().entities.has(editable.id), "A rejected batch partially deleted editable geometry.");
assertLockError(
  () => documentModel.addEntity(line("locked-destination", lockedLayer)),
  "DocumentModel added geometry to a locked layer.",
);
assertLockError(
  () => new UpdateEntitiesCommand(
    [entityLocked],
    [{ ...entityLocked, end: { x: 40, y: 20 } }],
    "Attempt locked update",
  ),
  "UpdateEntitiesCommand accepted locked geometry.",
);

const filteredDelete = new DeleteEntityCommand([entityLocked.id, layerLocked.id, editable.id]);
assert(filteredDelete.blockedCount === 2, "DeleteEntityCommand did not identify both lock sources.");
assert(!filteredDelete.isEmpty, "DeleteEntityCommand discarded an editable entity from a mixed selection.");
executeCommand(filteredDelete);
assert(!documentModel.getDocument().entities.has(editable.id), "Mixed delete did not remove editable geometry.");
assert(documentModel.getDocument().entities.has(entityLocked.id), "Mixed delete removed entity-locked geometry.");
assert(documentModel.getDocument().entities.has(layerLocked.id), "Mixed delete removed layer-locked geometry.");
undo();
assert(documentModel.getDocument().entities.has(editable.id), "Mixed delete undo did not restore editable geometry.");

const lockedOnlyDelete = new DeleteEntityCommand([entityLocked.id, layerLocked.id]);
assert(lockedOnlyDelete.isEmpty && lockedOnlyDelete.blockedCount === 2, "Locked-only deletion was not a safe no-op.");

const lateLockDelete = new DeleteEntityCommand([editable.id]);
documentModel.updateLayer(unlockedLayer.id, { locked: true });
lateLockDelete.execute();
assert(documentModel.getDocument().entities.has(editable.id), "Delete command ignored a lock applied after construction.");
documentModel.updateLayer(unlockedLayer.id, { locked: false });

history.clear();
executeCommand(new ToggleLayerStateCommand(lockedLayer.id, "locked"));
assert(!documentModel.getLayer(lockedLayer.id)?.locked, "Layer unlock command did not apply.");
undo();
assert(documentModel.getLayer(lockedLayer.id)?.locked, "Layer lock undo did not restore the previous value.");
redo();
assert(!documentModel.getLayer(lockedLayer.id)?.locked, "Layer lock redo was not deterministic.");

executeCommand(new ToggleLayerStateCommand(unlockedLayer.id, "visible"));
assert(!documentModel.getLayer(unlockedLayer.id)?.visible, "Layer visibility command did not apply.");
undo();
assert(documentModel.getLayer(unlockedLayer.id)?.visible, "Layer visibility undo did not restore the previous value.");
redo();
assert(!documentModel.getLayer(unlockedLayer.id)?.visible, "Layer visibility redo was not deterministic.");

const groupedOpenLayer = documentModel.getEntitiesForLayer(unlockedLayer.id);
assert(groupedOpenLayer.map((entity) => entity.id).join(",") === `${entityLocked.id},${editable.id}`, "Layer entity grouping lost insertion/z-order.");
assert(groupedOpenLayer.every((entity) => entity.name === "Line"), "DocumentModel did not assign default entity names.");
documentModel.setSelection([editable.id]);
assert(documentModel.getDocument().selection.has(editable.id), "Tree selection did not synchronize with the document selection.");

let treeEntity = documentModel.getDocument().entities.get(editable.id)!;
executeCommand(new UpdateEntitiesCommand(
  [treeEntity],
  [{ ...treeEntity, name: "Outline", visible: false }],
  "Update entity tree state",
));
treeEntity = documentModel.getDocument().entities.get(editable.id)!;
assert(treeEntity.name === "Outline" && !treeEntity.visible, "Entity tree state command did not apply name and visibility.");
undo();
treeEntity = documentModel.getDocument().entities.get(editable.id)!;
assert(treeEntity.name === "Line" && treeEntity.visible, "Entity tree state undo did not restore name and visibility.");
redo();
treeEntity = documentModel.getDocument().entities.get(editable.id)!;
assert(treeEntity.name === "Outline" && !treeEntity.visible, "Entity tree state redo was not deterministic.");

executeCommand(new UpdateEntitiesCommand([treeEntity], [{ ...treeEntity, locked: true }], "Lock Outline"));
assert(documentModel.getDocument().entities.get(editable.id)?.locked, "Entity lock command did not apply.");
undo();
assert(!documentModel.getDocument().entities.get(editable.id)?.locked, "Entity lock undo could not explicitly unlock the entity.");
redo();
assert(documentModel.getDocument().entities.get(editable.id)?.locked, "Entity lock redo was not deterministic.");
undo();

const namedRoundTrip = parseVectoraDocument(serializeVectoraDocument());
assert(namedRoundTrip.entities.find((entity) => entity.id === editable.id)?.name === "Outline", "Native persistence lost a custom entity name.");

history.clear();
documentModel.resetDocument();
filePersistence.markClean();

console.log("Phase 1 native persistence, dirty state, active layers, erase history, and layer history checks passed.");
