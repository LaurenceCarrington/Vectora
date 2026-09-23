import type { Entity, Point2D } from "../src/document/types";

class MockPath2D {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  roundRect(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
}
Object.defineProperty(globalThis, "Path2D", { configurable: true, value: MockPath2D });

const [
  { createDrawingEntity },
  { documentModel },
  { AddEntityCommand, TransformEntityCommand, executeCommand, history, redo, undo },
  { pointHitsEntity },
  { findObjectSnap },
  { pathCache },
  { translateEntities },
  { entityToEditablePolyline },
] = await Promise.all([
  import("../src/canvas/useCreationStateMachine"),
  import("../src/document/DocumentModel"),
  import("../src/document/History"),
  import("../src/geometry/HitTest"),
  import("../src/geometry/Snapping"),
  import("../src/renderer/PathCache"),
  import("../src/renderer/TransformOverlay"),
  import("../src/geometry/operations/pathConversion"),
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const origin = { x: 0, y: 0 } as const;
const current = { x: 40, y: 25 } as const;
const tools = ["line", "rectangle", "circle", "arc", "ellipse", "polygon"] as const;
const entities: Entity[] = [];

for (const tool of tools) {
  const entity = createDrawingEntity(`primitive-${tool}`, tool, origin, current);
  assert(entity, `${tool} creation returned no entity.`);
  assert(entity.type === tool, `${tool} creation returned ${entity.type}.`);
  assert(
    Number.isFinite(entity.bbox.minX) && Number.isFinite(entity.bbox.minY) &&
    Number.isFinite(entity.bbox.maxX) && Number.isFinite(entity.bbox.maxY) &&
    entity.bbox.maxX >= entity.bbox.minX && entity.bbox.maxY >= entity.bbox.minY,
    `${tool} has invalid bounds.`,
  );
  entities.push(entity);
  executeCommand(new AddEntityCommand(entity));
  assert(pathCache.prepare(documentModel.getDocument().entities.get(entity.id)!), `${tool} Path2D preparation failed.`);
}

assert(documentModel.getDocument().entities.size === tools.length, "Not all primitives were committed.");

const editableCandidates: Entity[] = [...entities];
for (const entity of editableCandidates) {
  const editable = entityToEditablePolyline(entity);
  assert(editable, `${entity.type} could not be converted for node editing.`);
  assert(editable.id === entity.id && editable.name === entity.name, `${entity.type} node conversion lost identity metadata.`);
  assert(editable.points.length >= 2, `${entity.type} node conversion has too few anchors.`);
  assert(editable.segments?.length === (editable.closed ? editable.points.length : editable.points.length - 1),
    `${entity.type} node conversion produced an invalid segment topology.`);
}
const editableCircle = entityToEditablePolyline(editableCandidates.find((entity) => entity.type === "circle")!);
assert(editableCircle?.points.length === 4 && editableCircle.segments?.every((segment) => segment.type === "cubic"),
  "Circle node conversion did not preserve a compact cubic curve.");
const editableEllipse = entityToEditablePolyline(entities.find((entity) => entity.type === "ellipse")!);
assert(editableEllipse?.points.length === 4 && editableEllipse.segments?.every((segment) => segment.type === "cubic"),
  "Ellipse node conversion did not preserve a compact cubic curve.");
for (const curveType of ["arc"] as const) {
  const editable = entityToEditablePolyline(editableCandidates.find((entity) => entity.type === curveType)!);
  assert(editable?.segments?.some((segment) => segment.type !== "line"),
    `${curveType} node conversion flattened its curve into straight segments.`);
}

for (const entity of entities) {
  let boundary: Point2D;
  let snapPoint: Point2D;
  switch (entity.type) {
    case "line": boundary = entity.start; snapPoint = entity.start; break;
    case "rectangle": boundary = entity.origin; snapPoint = entity.origin; break;
    case "circle": boundary = { x: entity.center.x + entity.radius, y: entity.center.y }; snapPoint = entity.center; break;
    case "arc": boundary = { x: entity.center.x + Math.cos(entity.startAngle) * entity.radius, y: entity.center.y + Math.sin(entity.startAngle) * entity.radius }; snapPoint = boundary; break;
    case "ellipse": boundary = { x: entity.cx + entity.rx, y: entity.cy }; snapPoint = { x: entity.cx, y: entity.cy }; break;
    case "polygon": boundary = { x: entity.cx + Math.cos(entity.rotation) * entity.radius, y: entity.cy + Math.sin(entity.rotation) * entity.radius }; snapPoint = boundary; break;
    default: throw new Error(`Unexpected primitive ${entity.type}.`);
  }
  assert(pointHitsEntity(boundary, entity, 0.5), `${entity.type} boundary hit test failed.`);
  assert(findObjectSnap({ cursor: snapPoint, zoom: 1, entities: [entity] }), `${entity.type} OSNAP extraction failed.`);
}

const translated = translateEntities(entities, { x: 100, y: -50 });
for (let index = 0; index < translated.length; index += 1) {
  const before = entities[index]!;
  const after = translated[index]!;
  assert(after.bbox.minX > before.bbox.minX, `${before.type} transform bounds did not move.`);
  assert(after.bbox.minY < before.bbox.minY, `${before.type} transform bounds did not move.`);
}

executeCommand(new TransformEntityCommand(entities, translated, "Move primitives"));
assert(documentModel.getDocument().entities.get(entities[0]!.id)!.bbox.minX === translated[0]!.bbox.minX, "Transform command did not apply.");
undo();
assert(documentModel.getDocument().entities.get(entities[0]!.id)!.bbox.minX === entities[0]!.bbox.minX, "Transform undo did not restore geometry.");
redo();
assert(documentModel.getDocument().entities.get(entities[0]!.id)!.bbox.minX === translated[0]!.bbox.minX, "Transform redo did not restore geometry.");
undo();

for (let index = 0; index < tools.length; index += 1) undo();
assert(documentModel.getDocument().entities.size === 0, "Primitive undo did not clear all additions.");
for (let index = 0; index < tools.length; index += 1) redo();
assert(documentModel.getDocument().entities.size === tools.length, "Primitive redo did not restore all additions.");
history.clear();

console.log("Primitive creation, curve-preserving node conversion, bounds, Path2D, hit-test, OSNAP, transform, undo, and redo checks passed.");
