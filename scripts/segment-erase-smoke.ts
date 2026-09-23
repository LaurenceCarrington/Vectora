import type { ArcEntity, CircleEntity, EntityStyle, LineEntity, PolylineEntity } from "../src/document/types";

class MockPath2D {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
}
Object.defineProperty(globalThis, "Path2D", { configurable: true, value: MockPath2D });

const [{ calculateEntityBounds, documentModel }, { ReplaceEntitySetCommand, executeCommand, history, redo, undo }, { deleteSegment }, { hitTestEntitySegment }] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/document/History"),
  import("../src/geometry/operations/segmentErase"),
  import("../src/geometry/HitTest"),
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const style: EntityStyle = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] };
documentModel.resetDocument();
history.clear();
const layerId = documentModel.getActiveLayer().id;

const closedCandidate: PolylineEntity = {
  id: "closed",
  name: "Curved square",
  type: "polyline",
  layerId,
  intent: "cut",
  style: { ...style, fillColor: "#dbeafe" },
  bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  visible: true,
  locked: false,
  points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  segments: [
    { type: "line" },
    { type: "cubic", cp1: { x: 25, y: 5 }, cp2: { x: 25, y: 15 } },
    { type: "quadratic", cp1: { x: 10, y: 25 } },
    { type: "line" },
  ],
  nodeTypes: ["corner", "smooth", "smooth", "corner"],
  closed: true,
};
const closed = { ...closedCandidate, bbox: calculateEntityBounds(closedCandidate) } as PolylineEntity;
const opened = deleteSegment(closed, 0);
assert(opened.length === 1 && opened[0]?.type === "polyline" && !opened[0].closed, "Closed path did not become one open path.");
assert(opened[0].style.fillColor === null, "Fractured path retained a fill that would visually close the erased gap.");
assert(opened[0].points[0]?.x === 20 && opened[0].points.at(-1)?.x === 0, "Closed-path anchors were not rotated around the erased gap.");
assert(opened[0].segments?.[0]?.type === "cubic" && opened[0].segments[1]?.type === "quadratic", "Closed-path erase flattened retained curves.");

const openCandidate: PolylineEntity = {
  ...closed,
  id: "open",
  name: "Open curve",
  points: [...closed.points, { x: -10, y: 10 }],
  segments: [
    { type: "line" },
    { type: "cubic", cp1: { x: 25, y: 5 }, cp2: { x: 25, y: 15 } },
    { type: "quadratic", cp1: { x: 10, y: 25 } },
    { type: "line" },
  ],
  nodeTypes: ["corner", "smooth", "smooth", "corner", "corner"],
  closed: false,
};
const open = { ...openCandidate, bbox: calculateEntityBounds(openCandidate) } as PolylineEntity;
const split = deleteSegment(open, 1);
assert(split.length === 2 && split.every((entity) => entity.type === "polyline" && !entity.closed), "Middle erase did not split an open path.");
assert(split[1]?.type === "polyline" && split[1].segments?.[0]?.type === "quadratic", "Open-path split flattened the retained curve.");
assert(split.every((entity) => entity.layerId === layerId && entity.intent === "cut"), "Split paths lost layer or intent.");

const lineCandidate: LineEntity = {
  id: "line", type: "line", layerId, intent: "cut", style,
  bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, visible: true, locked: false,
  start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
};
const line = { ...lineCandidate, bbox: calculateEntityBounds(lineCandidate) } as LineEntity;
assert(deleteSegment(line, 0).length === 0, "Standalone line was not deleted as one segment.");

const arcCandidate: ArcEntity = {
  id: "arc", type: "arc", layerId, intent: "score", style,
  bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, visible: true, locked: false,
  center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: false,
};
const arc = { ...arcCandidate, bbox: calculateEntityBounds(arcCandidate) } as ArcEntity;
assert(deleteSegment(arc, 0).length === 0, "Standalone arc was not deleted as one segment.");

const circleCandidate: CircleEntity = {
  id: "circle", type: "circle", layerId, intent: "cut", style,
  bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, visible: true, locked: false,
  center: { x: 50, y: 50 }, radius: 20,
};
const circle = { ...circleCandidate, bbox: calculateEntityBounds(circleCandidate) } as CircleEntity;
const hit = hitTestEntitySegment({ x: 50 + Math.SQRT1_2 * 20, y: 50 + Math.SQRT1_2 * 20 }, circle, 0.2);
assert(hit?.entityId === circle.id && hit.segmentIndex === 0, "Circle segment hit did not resolve the expected quadrant.");
assert(hitTestEntitySegment(circle.center, circle, 1) === null, "Filled-shape interior was incorrectly treated as an erasable segment.");

documentModel.addEntity(closed);
executeCommand(new ReplaceEntitySetCommand([closed], opened, "Erase segment"));
assert(documentModel.getDocument().entities.get(closed.id)?.type === "polyline" && !(documentModel.getDocument().entities.get(closed.id) as PolylineEntity).closed,
  "Segment erase history command did not apply.");
undo();
assert((documentModel.getDocument().entities.get(closed.id) as PolylineEntity).closed, "Segment erase undo did not restore the closed path.");
redo();
assert(!(documentModel.getDocument().entities.get(closed.id) as PolylineEntity).closed, "Segment erase redo did not restore the gap.");

console.log("Segment hit testing, closed opening, open splitting, Bézier preservation, and reversible erase checks passed.");
