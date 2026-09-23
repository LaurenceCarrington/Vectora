import { documentModel } from "../src/document/DocumentModel";
import { ReplaceEntitySetCommand, history } from "../src/document/History";
import type { Entity, Layer, Point2D, RectangleEntity } from "../src/document/types";
import { generateFlatpackBox } from "../src/geometry/generators/boxBuilder";
import { generateGear, generateGearGeometry } from "../src/geometry/generators/gearGenerator";
import { generateLivingHinge } from "../src/geometry/generators/livingHinge";
import { applyBooleanOperation } from "../src/geometry/operations/booleans";
import { applyKerfCompensation } from "../src/geometry/operations/offset";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const layer: Layer = {
  id: "cut",
  name: "Cut",
  intent: "cut",
  color: "#ff0000",
  visible: true,
  locked: false,
  order: 0,
};
const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const rectangle = (id: string, x: number, y: number, width: number, height: number): RectangleEntity => ({
  id,
  type: "rectangle",
  layerId: layer.id,
  intent: "cut",
  style,
  visible: true,
  locked: false,
  origin: { x, y },
  width,
  height,
  cornerRadius: 0,
  bbox: { minX: x, minY: y, maxX: x + width, maxY: y + height },
});
const first = rectangle("first", 0, 0, 10, 10);
const second = rectangle("second", 5, 0, 10, 10);

for (const pattern of ["straight", "lattice", "wave"] as const) {
  const hinge = generateLivingHinge({
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
    pattern,
    spacing: 8,
    cutLength: 24,
  });
  assert(hinge.length > 0, `${pattern} living hinge generated no cut geometry.`);
}

const gear = generateGear({ toothCount: 20, module: 2 });
const gearGeometry = generateGearGeometry({ toothCount: 20, module: 2 });
assert(gear.closed && gear.points.length > 200, "Involute gear profile is incomplete.");
assert(Math.abs(gearGeometry.pitchDiameter - 40) < 1e-9, "Gear pitch diameter is incorrect.");
assert(Math.abs(gearGeometry.outsideDiameter - 44) < 1e-9, "Gear outside diameter is incorrect.");

const panels = generateFlatpackBox({
  width: 80,
  depth: 60,
  height: 50,
  materialThickness: 3,
  fingerWidth: 10,
});
assert(panels.length === 6, "Flatpack box did not create six panels.");
assert(panels.every((panel) => panel.closed && panel.points.length > 12), "A box panel has an invalid finger-joint outline.");

const offset = applyKerfCompensation([first], { distance: 1, units: "mm", layers: [layer], joinStyle: "miter" });
assert(offset.length === 1, "Rectangle offset did not produce one contour.");
assert(offset[0]!.bbox.minX < -0.99 && offset[0]!.bbox.maxX > 10.99, "Positive offset did not expand the profile.");

function area(path: readonly Point2D[]): number {
  let result = 0;
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index]!;
    const next = path[(index + 1) % path.length]!;
    result += current.x * next.y - next.x * current.y;
  }
  return Math.abs(result / 2);
}

const union = applyBooleanOperation([first, second], "union", { layers: [layer] });
const intersection = applyBooleanOperation([first, second], "intersection", { layers: [layer] });
const difference = applyBooleanOperation([first, second], "difference", { layers: [layer] });
assert(Math.abs(union.reduce((sum, entity) => sum + area(entity.points), 0) - 150) < 1e-6, "Boolean union area is incorrect.");
assert(Math.abs(intersection.reduce((sum, entity) => sum + area(entity.points), 0) - 50) < 1e-6, "Boolean intersection area is incorrect.");
assert(Math.abs(difference.reduce((sum, entity) => sum + area(entity.points), 0) - 50) < 1e-6, "Boolean difference area is incorrect.");

documentModel.replaceDocument({ title: "Milestone 4", units: "mm", layers: [layer], entities: [first, second] });
history.clear();
history.executeCommand(new ReplaceEntitySetCommand([first, second], union, "Combine paths"));
assert(documentModel.getDocument().entities.size === union.length, "Boolean history command did not commit output geometry.");
assert(history.undo(), "Boolean history command could not be undone.");
assert(documentModel.getDocument().entities.size === 2, "Undo did not restore Boolean source geometry.");
assert(history.redo(), "Boolean history command could not be redone.");

console.log("Milestone 4 generators, polygon Boolean/Clipper2 offset operations, and reversible command checks passed.");
