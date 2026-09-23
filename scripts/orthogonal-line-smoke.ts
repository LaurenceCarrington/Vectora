import type { ArcEntity, Entity, LineEntity, PolylineEntity, SegmentEntity } from "../src/document/types";

const [{ calculateEntityBounds, documentModel }, { EntitySpatialIndex }, snappingModule] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/geometry/SpatialIndex"),
  import("../src/geometry/Snapping"),
]);
const { findObjectSnap, snapshotSnapPoint } = snappingModule;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const layerId = documentModel.getActiveLayer().id;

function makeLine(id: string, start: LineEntity["start"], end: LineEntity["end"]): LineEntity {
  const source: LineEntity = {
    id,
    type: "line",
    layerId,
    intent: "cut",
    style,
    visible: true,
    locked: false,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    start,
    end,
  };
  return { ...source, bbox: calculateEntityBounds(source) };
}

const horizontal = documentModel.addEntity(makeLine("horizontal-regression", { x: -300, y: 256 }, { x: 600, y: 256 }));
const vertical = documentModel.addEntity(makeLine("vertical-regression", { x: 50, y: -100 }, { x: 50, y: 100 }));
assert(horizontal.bbox.maxY > horizontal.bbox.minY, "Horizontal line retained a zero-height bounding box.");
assert(vertical.bbox.maxX > vertical.bbox.minX, "Vertical line retained a zero-width bounding box.");

const index = new EntitySpatialIndex(256);
const rawDegenerate = {
  ...horizontal,
  id: "raw-degenerate",
  bbox: { minX: -300, minY: 256, maxX: 600, maxY: 256 },
} satisfies LineEntity;
index.insert(rawDegenerate);
const indexed: Entity[] = [];
index.query({ minX: 500, minY: 255.9, maxX: 501, maxY: 256.1 }, indexed);
assert(indexed.some((entity) => entity.id === rawDegenerate.id), "Spatial hash skipped a degenerate horizontal line.");

const secondHorizontal = makeLine("second-horizontal", { x: 0, y: 100 }, { x: 100, y: 100 });
const firstSnap = findObjectSnap({
  cursor: { x: 50, y: 0 },
  zoom: 1,
  thresholdPx: 0.01,
  enabledTypes: ["midpoint"],
  entities: [makeLine("first-horizontal", { x: 0, y: 0 }, { x: 100, y: 0 })],
});
assert(firstSnap?.type === "midpoint", "First line midpoint was not extracted.");
const ownedFirstAnchor = snapshotSnapPoint(firstSnap);
const secondSnap = findObjectSnap({
  cursor: { x: 50, y: 100 },
  zoom: 1,
  thresholdPx: 0.01,
  enabledTypes: ["midpoint"],
  entities: [secondHorizontal],
});
assert(secondSnap?.type === "midpoint", "Second line midpoint was not extracted.");
assert(ownedFirstAnchor.x === 50 && ownedFirstAnchor.y === 0, "A later OSNAP query mutated the first owned anchor.");
const ownedSecondAnchor = snapshotSnapPoint(secondSnap);
const connectingLine = makeLine("midpoint-connector", ownedFirstAnchor, ownedSecondAnchor);
const committedConnector = documentModel.addEntity(connectingLine);
assert(committedConnector.start.y === 0 && committedConnector.end.y === 100, "Midpoint connector collapsed during insertion.");
assert(committedConnector.bbox.maxX > committedConnector.bbox.minX, "Orthogonal connector was not padded on its flat axis.");

const polyline: PolylineEntity = {
  id: "midpoint-polyline",
  type: "polyline",
  layerId,
  intent: "score",
  style,
  visible: true,
  locked: false,
  bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
  closed: false,
};
const arc: ArcEntity = {
  id: "midpoint-arc",
  type: "arc",
  layerId,
  intent: "score",
  style,
  visible: true,
  locked: false,
  bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  center: { x: 0, y: 0 },
  radius: 10,
  startAngle: 0,
  endAngle: Math.PI / 2,
  counterClockwise: false,
};
const segment: SegmentEntity = {
  id: "midpoint-segment",
  type: "segment",
  layerId,
  intent: "score",
  style,
  visible: true,
  locked: false,
  bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  cx: 0,
  cy: 0,
  radius: 10,
  startAngle: 0,
  endAngle: Math.PI / 2,
};
for (const [entity, cursor] of [
  [polyline, { x: 10, y: 5 }],
  [arc, { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 }],
  [segment, { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 }],
] as const) {
  const snap = findObjectSnap({ cursor, zoom: 1, thresholdPx: 0.01, enabledTypes: ["midpoint"], entities: [entity] });
  assert(snap?.type === "midpoint", `${entity.type} midpoint was not extracted.`);
  assert(Number.isFinite(snap.point.x) && Number.isFinite(snap.point.y), `${entity.type} midpoint was not finite.`);
}

console.log("Orthogonal bounds, spatial indexing, owned midpoint anchors, and midpoint extraction checks passed.");
