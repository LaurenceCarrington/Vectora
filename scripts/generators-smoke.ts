import { generateFlatpackBox, getFlatpackBoxLayoutSize } from "../src/geometry/generators/boxBuilder";
import { generateGearWithHoles } from "../src/geometry/generators/gearGenerator";
import { generateLivingHinge } from "../src/geometry/generators/livingHinge";
import { generateMountingPlate } from "../src/geometry/generators/mountingPlate";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const gear = generateGearWithHoles({
  toothCount: 20,
  module: 2,
  boreDiameter: 8,
  boltHoleCount: 4,
  boltHoleDiameter: 3,
  boltCircleDiameter: 24,
});
assert(gear.length === 6, "Gear generator did not create the outline, bore, and four bolt holes.");
assert(gear[0]!.type === "polyline" && gear.slice(1).every((entity) => entity.type === "circle"),
  "Gear cutouts are not represented as independent closed contours.");
assert(new Set(gear.map((entity) => entity.compoundId)).size === 1, "Gear profile and cutouts are not grouped as one part.");
let rejectedInvalidGear = false;
try {
  generateGearWithHoles({ toothCount: 12, module: 1, boreDiameter: 4, boltHoleCount: 6, boltHoleDiameter: 4, boltCircleDiameter: 12 });
} catch {
  rejectedInvalidGear = true;
}
assert(rejectedInvalidGear, "Gear generator accepted bolt holes outside its root diameter.");

const closedBox = generateFlatpackBox({ width: 80, depth: 60, height: 50, materialThickness: 3, fingerWidth: 10 });
const openBox = generateFlatpackBox({ width: 80, depth: 60, height: 50, materialThickness: 3, fingerWidth: 10, design: "open-top" });
const dividedTray = generateFlatpackBox({
  width: 80,
  depth: 60,
  height: 50,
  materialThickness: 3,
  fingerWidth: 10,
  design: "divider-tray",
  dividerCount: 2,
});
assert(closedBox.length === 6, "Closed box did not retain six panels.");
assert(openBox.length === 5 && !openBox.some((entity) => entity.name?.includes("Top Panel")), "Open-top box still contains a lid.");
assert(dividedTray.filter((entity) => entity.name?.startsWith("Box Divider ")).length === 2,
  "Divided tray did not generate both internal dividers.");
assert(dividedTray.some((entity) => entity.name?.includes("Bottom Slot")), "Divided tray is missing bottom engagement slots.");
const traySize = getFlatpackBoxLayoutSize({
  width: 80, depth: 60, height: 50, materialThickness: 3, fingerWidth: 10, design: "divider-tray", dividerCount: 2,
});
assert(traySize.height > 50 + 60 + 10, "Divided tray layout did not reserve a row for divider panels.");

const plate = generateMountingPlate({
  width: 100,
  height: 70,
  cornerRadius: 6,
  centerHoleDiameter: 20,
  mountingHoleLayout: "four",
  mountingHoleDiameter: 5,
  holeInset: 10,
});
assert(plate.length === 6, "Mounting plate did not create its outline, centre hole, and four mounting holes.");
assert(plate[0]!.type === "rectangle" && plate.slice(1).every((entity) => entity.type === "circle"),
  "Mounting plate geometry has unexpected entity types.");

const insetHinge = generateLivingHinge({
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  pattern: "straight",
  spacing: 8,
  cutLength: 24,
  edgeInset: 10,
});
assert(insetHinge.length > 0 && insetHinge.every((entity) => entity.bbox.minX >= 10 && entity.bbox.maxX <= 90),
  "Living-hinge edge margin was not applied.");

console.log("Expanded gear, flatpack box, mounting plate, and living-hinge generators passed.");
