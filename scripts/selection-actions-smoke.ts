import type { Layer, LineEntity, PolylineEntity, RectangleEntity } from "../src/document/types";
import { documentModel } from "../src/document/DocumentModel";
import { UpdateEntitiesCommand, executeCommand, history } from "../src/document/History";
import { nestEntities } from "../src/cam/nestingEngine";
import { buildContourHierarchy, signedPolygonArea } from "../src/geometry/topology";
import {
  applyBooleanOperation,
  entitiesToPolygons,
  excludeEntities,
  intersectEntities,
  subtractEntities,
  weldEntities,
} from "../src/geometry/operations/booleans";
import { joinPaths } from "../src/geometry/operations/join";
import { closePolyline } from "../src/geometry/operations/closePath";
import {
  applyKerfCompensation,
  CSS_PIXELS_PER_MILLIMETRE,
  millimetresToDocumentUnits,
} from "../src/geometry/operations/offset";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(action: () => unknown, message: string): void {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const cutLayer: Layer = {
  id: "cut",
  name: "Cut",
  intent: "cut",
  color: "#ef4444",
  visible: true,
  locked: false,
  order: 0,
};
const detailLayer: Layer = {
  ...cutLayer,
  id: "detail",
  name: "Detail",
  intent: "engrave",
  color: "#3b82f6",
  order: 1,
};
const resultLayer: Layer = {
  ...cutLayer,
  id: "result",
  name: "Boolean result",
  color: "#8b5cf6",
  order: 2,
};
const layers = [cutLayer, detailLayer, resultLayer] as const;
const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;

function rectangle(id: string, layerId: string, x: number, locked = false): RectangleEntity {
  return {
    id,
    type: "rectangle",
    layerId,
    intent: layerId === "detail" ? "engrave" : "cut",
    style,
    visible: true,
    locked,
    origin: { x, y: 0 },
    width: 10,
    height: 10,
    cornerRadius: 0,
    bbox: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
  };
}

const primary = rectangle("primary", "cut", 0);
const secondary = rectangle("secondary", "detail", 5);

documentModel.replaceDocument({
  title: "Selection order",
  units: "mm",
  activeLayerId: cutLayer.id,
  layers,
  entities: [primary, secondary],
});
documentModel.selectEntities([primary.id, secondary.id]);
documentModel.selectEntities([secondary.id, primary.id]);
assert(
  documentModel.getDocument().selection.values().next().value === secondary.id,
  "Reordering an unchanged selection did not update its primary subject.",
);

const result = applyBooleanOperation([primary, secondary], "union", {
  layers,
  resultLayerId: resultLayer.id,
});
assert(result.length === 1, "Boolean union did not produce the expected profile.");
assert(result[0]!.layerId === resultLayer.id, "Boolean output did not use the active result layer.");
assert(result[0]!.intent === primary.intent, "Boolean output did not preserve the primary intent.");
assert(result.every((entity) => entity.closed && entity.points.length >= 3), "Weld emitted an open or degenerate contour.");
assert(entitiesToPolygons([primary, secondary]).every((polygon) => polygon[0]?.at(0)?.[0] === polygon[0]?.at(-1)?.[0]), "Entity conversion did not close clipping rings.");

const apiOptions = { layers, resultLayerId: resultLayer.id } as const;
assert(weldEntities([primary, secondary], apiOptions).length === 1, "Weld API did not merge overlapping profiles.");
assert(intersectEntities([primary, secondary], apiOptions).length === 1, "Intersect API did not retain the overlap.");
assert(excludeEntities([primary, secondary], apiOptions).length === 2, "Exclude API did not emit the two XOR regions.");

const primaryDifference = applyBooleanOperation([primary, secondary], "difference", { layers });
const secondaryDifference = applyBooleanOperation([secondary, primary], "difference", { layers });
assert(primaryDifference[0]!.bbox.maxX <= 5.000001, "Subtract did not use the first entity as its primary subject.");
assert(secondaryDifference[0]!.bbox.minX >= 9.999999, "Cycling primary did not reverse the subtraction operand order.");
const zOrderedDifference = subtractEntities([primary, secondary], {
  layers,
  zOrder: [secondary.id, primary.id],
});
assert(zOrderedDifference[0]!.bbox.minX >= 9.999999, "Subtract did not use the bottom-most z-ordered entity as its subject.");
const cycledDifference = subtractEntities([primary, secondary], {
  layers,
  zOrder: [primary.id, secondary.id],
  primaryEntityId: secondary.id,
});
assert(cycledDifference[0]!.bbox.minX >= 9.999999, "An explicitly cycled primary did not override the default z-order subject.");

const outer = { ...primary, id: "outer", width: 20, height: 20, bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 } };
const inner = {
  ...secondary,
  id: "inner",
  layerId: cutLayer.id,
  intent: "cut" as const,
  origin: { x: 5, y: 5 },
  width: 5,
  height: 5,
  bbox: { minX: 5, minY: 5, maxX: 10, maxY: 10 },
};
const holedDifference = subtractEntities([inner, outer], {
  layers,
  zOrder: [outer.id, inner.id],
});
const hierarchy = buildContourHierarchy(holedDifference);
assert(holedDifference.length === 2, "Contained subtraction did not emit both exterior and hole contours.");
assert(hierarchy.nodes.some((node) => node.kind === "inner"), "Boolean hole winding/topology was not CAM-ready.");

const compoundInput = entitiesToPolygons([inner, outer]);
assert(compoundInput.length === 1 && compoundInput[0]!.length === 2, "Compound input did not nest the hole inside its shell.");
const island = { ...inner, id: "island", origin: { x: 6, y: 6 }, width: 2, height: 2 };
const islandInput = entitiesToPolygons([inner, island, outer]);
assert(islandInput.length === 2 && islandInput[0]!.length === 1 && islandInput[1]!.length === 2,
  "An island inside a hole did not become a separate material polygon.");
const materialArea = (entities: readonly Entity[]) => buildContourHierarchy(entities).nodes.reduce(
  (area, node) => area + (node.kind === "outer" ? 1 : -1) * Math.abs(signedPolygonArea(node.path)), 0,
);
assert(Math.abs(materialArea(weldEntities([outer, inner], { layers })) - 375) < 1e-7,
  "Weld did not reconstruct ungrouped compound input holes.");
const extension = { ...outer, id: "extension", origin: { x: 15, y: 0 }, width: 10, height: 20 };
const weldedCounter = weldEntities([...holedDifference, extension], { layers });
assert(Math.abs(materialArea(weldedCounter) - 475) < 1e-7, "Weld refilled an existing counter-hole.");
const secondCutter = { ...inner, id: "second-cutter", origin: { x: 12, y: 12 }, width: 2, height: 2 };
const repeatedSubtract = subtractEntities([...weldedCounter, secondCutter], { layers });
assert(Math.abs(materialArea(repeatedSubtract) - 471) < 1e-7, "Weld then Subtract refilled the original hole or ignored the new cutter.");
assert(buildContourHierarchy(repeatedSubtract).nodes.filter((node) => node.kind === "inner").length === 2,
  "Sequential subtraction did not preserve both holes.");
const cover = { ...outer, id: "cover", origin: { x: -1, y: -1 }, width: 30, height: 30 };
assert(Math.abs(materialArea(weldEntities([...holedDifference, cover], { layers })) - 900) < 1e-7,
  "Weld misclassified an independent enclosing solid as compound hole topology.");
assert(Math.abs(materialArea(intersectEntities([...holedDifference, cover], { layers })) - 375) < 1e-7,
  "Intersect refilled the subject's counter-hole.");
const disjoint = { ...inner, id: "disjoint", origin: { x: 30, y: 0 }, width: 2, height: 2 };
assert(Math.abs(materialArea(excludeEntities([...holedDifference, disjoint], { layers })) - 379) < 1e-7,
  "Exclude refilled the subject's counter-hole.");

assertThrows(
  () => applyBooleanOperation([{ ...primary, locked: true }, secondary], "union", { layers }),
  "Boolean operation accepted a locked entity.",
);
assertThrows(
  () => applyBooleanOperation([primary, secondary], "union", {
    layers: [{ ...cutLayer, locked: true }, detailLayer, resultLayer],
  }),
  "Boolean operation accepted an entity on a locked layer.",
);
assertThrows(
  () => applyKerfCompensation([{ ...primary, locked: true }], { units: "mm", layers }),
  "Offset operation accepted a locked entity.",
);
assertThrows(
  () => nestEntities([primary], {
    sheetWidth: 50,
    sheetHeight: 50,
    layers: [{ ...cutLayer, locked: true }, detailLayer, resultLayer],
  }),
  "Nesting accepted an entity on a locked layer.",
);

const inchDistance = millimetresToDocumentUnits(0.15, "in");
const pixelDistance = millimetresToDocumentUnits(0.15, "px");
assert(Math.abs(inchDistance - 0.15 / 25.4) < 1e-12, "Millimetre-to-inch offset conversion is incorrect.");
assert(Math.abs(pixelDistance - 0.15 * CSS_PIXELS_PER_MILLIMETRE) < 1e-12, "Millimetre-to-pixel offset conversion is incorrect.");

const inchOffset = applyKerfCompensation([primary], { units: "in", layers, joinStyle: "miter" });
assert(
  Math.abs(inchOffset[0]!.bbox.minX + inchDistance) < 2e-6,
  "Default kerf was not applied in converted inch document units.",
);

function line(
  id: string,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  layerId = cutLayer.id,
): LineEntity {
  return {
    id,
    type: "line",
    layerId,
    intent: "cut",
    style,
    visible: true,
    locked: false,
    start,
    end,
    bbox: {
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    },
  };
}

const joined = joinPaths([
  line("join-a", { x: 0, y: 0 }, { x: 10, y: 0 }),
  line("join-b", { x: 10, y: 10 }, { x: 10, y: 0 }),
  line("join-c", { x: 10, y: 10 }, { x: 0.04, y: 0.03 }),
]);
assert(joined.length === 1, "Three endpoint-connected segments were not welded into one chain.");
assert(joined[0]?.type === "polyline" && joined[0].closed, "A joined loop was not marked closed.");
assert(joined[0]?.id === "join-a" && joined[0].layerId === cutLayer.id, "Join did not preserve primary identity and layer.");
assert(joined[0]?.intent === "cut", "Join did not preserve manufacturing intent.");

const crossLayer = joinPaths([
  line("layer-a", { x: 0, y: 0 }, { x: 5, y: 0 }, cutLayer.id),
  line("layer-b", { x: 5, y: 0 }, { x: 10, y: 0 }, detailLayer.id),
]);
assert(crossLayer.length === 2, "Join incorrectly welded paths across different layers.");
assertThrows(
  () => joinPaths([{ ...line("locked-join", { x: 0, y: 0 }, { x: 1, y: 0 }), locked: true }]),
  "Join accepted a locked entity.",
);

const openPolyline: PolylineEntity = {
  id: "open-polyline",
  type: "polyline",
  layerId: cutLayer.id,
  intent: "cut",
  style,
  visible: true,
  locked: false,
  bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  segments: [
    { type: "cubic", cp1: { x: 3, y: 0 }, cp2: { x: 7, y: 0 } },
    { type: "line" },
  ],
  closed: false,
};
documentModel.replaceDocument({
  title: "Close path",
  units: "mm",
  activeLayerId: cutLayer.id,
  layers,
  entities: [openPolyline],
});
history.clear();
const closedPolyline = closePolyline(openPolyline);
assert(closedPolyline.closed, "Close path did not mark the polyline closed.");
assert(closedPolyline.segments?.length === 3, "Close path did not append the final segment.");
assert(closedPolyline.segments?.[0]?.type === "cubic", "Close path flattened an existing Bézier segment.");
executeCommand(new UpdateEntitiesCommand([openPolyline], [closedPolyline], "Close path"));
assert((documentModel.getDocument().entities.get(openPolyline.id) as PolylineEntity).closed, "Close path command did not commit.");
assert(history.undo(), "Close path command was not undoable.");
assert(!(documentModel.getDocument().entities.get(openPolyline.id) as PolylineEntity).closed, "Close path undo did not restore the open polyline.");
assert(history.redo(), "Close path command was not redoable.");
assert((documentModel.getDocument().entities.get(openPolyline.id) as PolylineEntity).closed, "Close path redo did not restore closure.");

console.log("Selection action Boolean, primary cycling, close-path, lock, unit, and nesting checks passed.");
