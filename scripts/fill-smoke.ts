import { findFillTarget } from "../src/canvas/useFillTool";
import { documentModel } from "../src/document/DocumentModel";
import { UpdateEntitiesCommand, executeCommand, history, undo } from "../src/document/History";
import type { Entity, LineEntity, RectangleEntity } from "../src/document/types";
import { pointInClosedEntity } from "../src/geometry/HitTest";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { exportSvg } from "../src/io/svgParser";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

documentModel.resetDocument("mm");
history.clear();
const layerId = documentModel.getDocument().activeLayerId;
const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const rectangle: RectangleEntity = {
  id: "fill-rectangle",
  type: "rectangle",
  layerId,
  intent: "cut",
  style,
  visible: true,
  locked: false,
  origin: { x: 10, y: 10 },
  width: 40,
  height: 30,
  cornerRadius: 0,
  bbox: { minX: 10, minY: 10, maxX: 50, maxY: 40 },
};
const openLine: LineEntity = {
  id: "fill-open-line",
  type: "line",
  layerId,
  intent: "cut",
  style,
  visible: true,
  locked: false,
  start: { x: 60, y: 10 },
  end: { x: 90, y: 10 },
  bbox: { minX: 60, minY: 10, maxX: 90, maxY: 10 },
};
documentModel.replaceEntitySet([], [rectangle, openLine]);
const entities = documentModel.getVisibleEntities();
const target = findFillTarget({ x: 25, y: 20 }, entities);
assert(target?.id === rectangle.id, "Fill targeting did not find the closed shape interior.");
assert(pointInClosedEntity({ x: 25, y: 20 }, rectangle), "Rectangle interior was not fillable.");
assert(!pointInClosedEntity({ x: 70, y: 10 }, openLine), "An open path was treated as fillable.");
assert(findFillTarget({ x: 200, y: 200 }, entities) === null, "Empty canvas produced a fill target.");

const filled: Entity = { ...target, style: { ...target.style, fillColor: "#ff3366" } };
executeCommand(new UpdateEntitiesCommand([target], [filled], "Fill shape"));
assert(documentModel.getDocument().entities.get(target.id)?.style.fillColor === "#ff3366",
  "The undoable fill update did not reach the document model.");
assert(exportSvg(documentModel.getDocument()).includes('fill="#ff3366"'), "SVG export omitted the fill color.");
const restored = parseVectoraDocument(serializeVectoraDocument());
assert(restored.entities.find((entity) => entity.id === target.id)?.style.fillColor === "#ff3366",
  "Native document persistence lost the fill color.");
assert(undo(), "Fill update was not added to undo history.");
assert(documentModel.getDocument().entities.get(target.id)?.style.fillColor === null,
  "Undo did not restore the previous fill color.");

console.log("Closed-shape fill targeting, undo, rendering data, SVG export, and native persistence passed.");
