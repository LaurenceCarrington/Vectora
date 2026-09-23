import assert from "node:assert/strict";
import { documentModel } from "../src/document/DocumentModel";
import { AddEntitiesCommand, executeCommand, history, redo, undo } from "../src/document/History";
import { createDrawingEntity, createDimensionEntity, createLeaderEntity, createPolylineEntity, createTextEntity } from "../src/canvas/useCreationStateMachine";
import { DEFAULT_RASTER_SETTINGS, encodeRgba } from "../src/cam/rasterCamEngine";
import type { Entity, ImageEntity } from "../src/document/types";
import { copySelectedObjects, OBJECT_CLIPBOARD_PREFIX, prepareObjectPaste } from "../src/io/objectClipboard";

documentModel.resetDocument();
history.clear();
const layerId = documentModel.getActiveLayer().id;
const tools = ["line", "rectangle", "circle", "arc", "ellipse", "polygon"] as const;
const originals: Entity[] = tools.map(tool => createDrawingEntity(tool, tool, { x: 0, y: 0 }, { x: 50, y: 30 })!);
const curve = createPolylineEntity("curve", [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }])!;
const common = { layerId, intent: "cut" as const, visible: true, locked: false, style: curve.style, bbox: curve.bbox };
originals.push(
  { ...common, id: "quadrant", type: "quadrant", cx: 0, cy: 0, radius: 10, quadrantIndex: 1 },
  { ...common, id: "semicircle", type: "semicircle", cx: 0, cy: 0, radius: 10, startAngle: 0 },
  { ...common, id: "segment", type: "segment", cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: 1 },
  { ...common, id: "star", type: "star", cx: 0, cy: 0, innerRadius: 5, outerRadius: 10, points: 5, rotation: 0 },
  { ...common, id: "cloud", type: "cloud", points: curve.points, arcRadius: 2 },
);
originals.push({ ...curve, compoundId: "hole-set", dxfGroup: "insert-set", segments: [
  { type: "cubic", cp1: { x: 2, y: 5 }, cp2: { x: 6, y: 10 } }, { type: "line" },
], nodeTypes: ["corner", "smooth", "corner"], style: { ...curve.style, fillColor: "#ff00ff", strokeColor: "#123456" } });
originals.push({ ...curve, id: "hole", compoundId: "hole-set", dxfGroup: "insert-set" });
originals.push(createTextEntity("text", { x: 10, y: 10 }, layerId, "Copied text")!);
const dimension = createDimensionEntity("dimension", "aligned", { x: 0, y: 0 }, { x: 50, y: 30 }, { x: 20, y: 40 })!;
originals.push({ ...dimension, references: {
  start: { entityId: "line", mode: "path", parameter: 0 }, end: { entityId: "not-copied", mode: "path", parameter: 1 },
} });
originals.push(createLeaderEntity("leader", { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 8, y: 4 })!);
const image: ImageEntity = {
  id: "image", name: "Image", type: "image", layerId, intent: "raster", visible: true, locked: false,
  origin: { x: 0, y: 0 }, right: { x: 2, y: 0 }, top: { x: 0, y: 2 }, pixelWidth: 1, pixelHeight: 1,
  rgba: encodeRgba([200, 50, 100, 255]), raster: DEFAULT_RASTER_SETTINGS,
  style: curve.style, bbox: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
};
originals.push(image);
documentModel.replaceEntitySet([], originals);
assert.equal(copySelectedObjects(), null);
documentModel.selectEntities(originals.map(entity => entity.id));
const source = copySelectedObjects()!;
const before = JSON.stringify([...documentModel.getDocument().entities.values()]);
const copies = prepareObjectPaste(source, documentModel.getDocument(), { x: 16, y: -16 }, { x: 0, y: 0 });
assert.equal(copies.length, originals.length);
for (const [index, copy] of copies.entries()) {
  assert.notEqual(copy.id, originals[index]!.id);
  assert.equal(copy.type, originals[index]!.type);
  assert.deepEqual(copy.style, originals[index]!.style);
  assert.equal(copy.layerId, originals[index]!.layerId);
}
const copiedCurve = copies.find(entity => entity.id !== "curve" && entity.type === "polyline" && entity.nodeTypes)!;
assert(copiedCurve.type === "polyline");
assert.deepEqual(copiedCurve.points[0], { x: 16, y: -16 });
assert.deepEqual(copiedCurve.segments?.[0], { type: "cubic", cp1: { x: 18, y: -11 }, cp2: { x: 22, y: -6 } });
assert.notEqual(copiedCurve.compoundId, "hole-set");
assert.equal(copiedCurve.compoundId, copies.filter(entity => entity.type === "polyline")[1]!.compoundId);
assert.notEqual(copiedCurve.dxfGroup, "insert-set");
const copiedDimension = copies.find(entity => entity.type === "dimension")!;
assert(copiedDimension.type === "dimension");
assert.equal(copiedDimension.references?.start?.entityId, copies.find(entity => entity.type === "line")!.id);
assert.equal(copiedDimension.references?.end, undefined);
const copiedImage = copies.find(entity => entity.type === "image")!;
assert(copiedImage.type === "image");
assert.equal(copiedImage.rgba, image.rgba);
assert.deepEqual(copiedImage.origin, { x: 16, y: -16 });
executeCommand(new AddEntitiesCommand(copies, "Paste objects"));
assert.equal(documentModel.getDocument().selection.size, originals.length);
assert(undo());
assert.equal(JSON.stringify([...documentModel.getDocument().entities.values()]), before);
assert(redo());
assert.equal(documentModel.getDocument().entities.size, originals.length * 2);
assert.notEqual(prepareObjectPaste(source, documentModel.getDocument(), { x: 32, y: -32 }, { x: 0, y: 0 })[0]!.id, copies[0]!.id);
documentModel.updateLayer(layerId, { locked: true });
assert.throws(() => prepareObjectPaste(source, documentModel.getDocument(), { x: 0, y: 0 }, { x: 0, y: 0 }), /Cannot paste/);
documentModel.updateLayer(layerId, { locked: false, visible: false });
assert.throws(() => prepareObjectPaste(source, documentModel.getDocument(), { x: 0, y: 0 }, { x: 0, y: 0 }), /Cannot paste/);
documentModel.resetDocument("in");
const crossDocument = prepareObjectPaste(source, documentModel.getDocument(), { x: 0, y: 0 }, { x: 0, y: 0 });
const rectangle = crossDocument.find(entity => entity.type === "rectangle")!;
assert(rectangle.type === "rectangle");
assert(Math.abs(rectangle.width - 50 / 25.4) < 1e-9);
assert(crossDocument.every(entity => entity.layerId === documentModel.getActiveLayer().id));
executeCommand(new AddEntitiesCommand(crossDocument, "Paste objects"));
assert.equal(documentModel.getDocument().entities.size, originals.length);
const saved = JSON.stringify([...documentModel.getDocument().entities.values()]);
assert.throws(() => prepareObjectPaste(OBJECT_CLIPBOARD_PREFIX + "invalid", documentModel.getDocument(), { x: 0, y: 0 }, { x: 0, y: 0 }));
assert.equal(JSON.stringify([...documentModel.getDocument().entities.values()]), saved);
console.log("Clipboard: all 16 entity types, curves, style, raster pixels, fresh IDs/groups, dimension bindings, units, locks, atomic failure and undo/redo passed.");
