import * as THREE from "three";
import type { CadDocument, Layer, LineEntity, RectangleEntity } from "../src/document/types";
import { generateFlatpackBoxPanels } from "../src/geometry/generators/boxBuilder";
import { getBoxPanelTransform, identifyBoxAssemblies } from "../src/3d/boxFolder";
import {
  contourNodeToThreeShape,
  createBurnedMaterial,
  createExtrudedContourMesh,
  createExtrudedEntityMesh,
  createOpenCutDiagnosticMesh,
  createOpenCutWarningMaterial,
  createSurfaceEngravingMesh,
  createSurfacePathMesh,
  documentUnitToMillimetres,
  entityToThreeShape,
  findParentCutBoundary,
  groupPreviewEntities,
} from "../src/3d/threeEngine";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { buildContourHierarchy } from "../src/geometry/topology";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE, documentToMachineScale, PixelCalibrationRequiredError } from "../src/cam/gcodeCompiler";
import { buildManufacturingPlan, createDefaultProcesses } from "../src/cam/processModel";
import { optimizeToolpaths } from "../src/cam/optimizer";
import { useCamCalibrationStore } from "../src/store/useCamCalibrationStore";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string, tolerance = 1e-7): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const layer: Layer = {
  id: "box-layer",
  name: "Birch ply",
  intent: "cut",
  color: "#c78f4c",
  visible: true,
  locked: false,
  order: 0,
  material: { kind: "wood", thicknessMm: 3.2 },
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

const topologyOuter = rectangle("topology-outer", 0, 0, 100, 80);
const topologyHole = rectangle("topology-hole", 20, 20, 40, 30);
const topologyIsland = rectangle("topology-island", 30, 28, 10, 10);
const hierarchy = buildContourHierarchy([topologyOuter, topologyHole, topologyIsland]);
assert(hierarchy.nodes.length === 3, "Topology omitted a valid closed contour.");
assert(hierarchy.roots.length === 1, "Nested contours did not produce one topology root.");
assert(hierarchy.solidBoundaries.length === 2, "An even-depth island was not retained as a solid boundary.");
const outerNode = hierarchy.byEntityId.get(topologyOuter.id);
const holeNode = hierarchy.byEntityId.get(topologyHole.id);
const islandNode = hierarchy.byEntityId.get(topologyIsland.id);
assert(outerNode?.depth === 0 && outerNode.kind === "outer", "Outer topology depth is incorrect.");
assert(holeNode?.depth === 1 && holeNode.kind === "inner" && holeNode.parentId === topologyOuter.id, "Hole topology is incorrect.");
assert(islandNode?.depth === 2 && islandNode.kind === "outer" && islandNode.parentId === topologyHole.id, "Nested island topology is incorrect.");
assert(outerNode.holes.length === 1 && outerNode.holes[0]?.entityId === topologyHole.id, "Outer boundary did not own its immediate hole.");

const compoundShape = contourNodeToThreeShape(outerNode);
assert(compoundShape.holes.length === 1, "Compound THREE.Shape did not receive its cutout path.");
const extracted = compoundShape.extractPoints(4);
const faces = THREE.ShapeUtils.triangulateShape(extracted.shape, extracted.holes);
const vertices = [...extracted.shape, ...extracted.holes.flat()];
const topArea = faces.reduce((area, face) => {
  const a = vertices[face[0]!]!;
  const b = vertices[face[1]!]!;
  const c = vertices[face[2]!]!;
  return area + Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
}, 0);
close(topArea, 100 * 80 - 40 * 30, "Compound shape top-face area");
const compoundMaterials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
const compoundMesh = createExtrudedContourMesh(outerNode, 3, compoundMaterials);
assert(
  (compoundMesh.userData.holeEntityIds as readonly string[])[0] === topologyHole.id,
  "Extruded mesh did not retain hole provenance.",
);
compoundMesh.geometry.dispose();
for (const material of compoundMaterials) material.dispose();

const panels = generateFlatpackBoxPanels({
  width: 120,
  depth: 80,
  height: 60,
  materialThickness: 3.2,
  fingerWidth: 10,
  layerId: layer.id,
  idFactory: (prefix, index) => `${prefix}-${index}`,
});

assert(panels.length === 6, "The flatpack generator did not return six panels.");
const assembly = identifyBoxAssemblies(panels.map(({ entity }) => entity));
assert(assembly.length === 1, "A complete box layout was not recognized as one assembly.");
assert(assembly[0]!.panels.size === 6, "The recognized box assembly is missing panels.");

for (const panel of assembly[0]!.panels.keys()) {
  const folded = getBoxPanelTransform(panel, assembly[0]!.dimensions, 0);
  const exploded = getBoxPanelTransform(panel, assembly[0]!.dimensions, 1);
  const outwardDistance =
    (exploded.position[0] - folded.position[0]) * folded.normal[0] +
    (exploded.position[1] - folded.position[1]) * folded.normal[1] +
    (exploded.position[2] - folded.position[2]) * folded.normal[2];
  assert(outwardDistance > 0, `${panel} did not move outward in exploded view.`);
}

const front = panels.find(({ name }) => name === "front")!.entity;
assert(entityToThreeShape(front), "A closed generated panel could not be converted to THREE.Shape.");
const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
const mesh = createExtrudedEntityMesh(front, layer.material!.thicknessMm, materials);
assert(mesh, "A closed generated panel could not be extruded.");
mesh.geometry.computeBoundingBox();
const bounds = mesh.geometry.boundingBox;
assert(bounds, "Extruded panel geometry has no bounds.");
close(bounds.max.z - bounds.min.z, 3.2, "Extrusion thickness");
close(bounds.min.z, 0, "Extrusion starts at the material base");
close(bounds.max.z, 3.2, "Extrusion ends at the material top surface");
assert(mesh.geometry.getAttribute("position").count > 0, "Extrusion contains no vertices.");
mesh.geometry.dispose();
for (const material of materials) material.dispose();

const engraving: RectangleEntity = {
  ...rectangle("engraved-panel-mark", 12, 12, 24, 18),
  intent: "engrave",
};
const score: LineEntity = {
  id: "score-centerline",
  type: "line",
  layerId: layer.id,
  intent: "score",
  style,
  visible: true,
  locked: false,
  start: { x: 10, y: 55 },
  end: { x: 90, y: 55 },
  bbox: { minX: 10, minY: 55, maxX: 90, maxY: 55 },
};
const construction: LineEntity = {
  ...score,
  id: "construction-guide",
  intent: "construction",
};
const grouped = groupPreviewEntities([topologyOuter, engraving, score, construction]);
assert(grouped.cut.length === 1, "Cut intent was not isolated for solid topology.");
assert(grouped.engrave.length === 1, "Engrave intent was not isolated for surface rendering.");
assert(grouped.score.length === 1, "Score intent was not isolated for tube rendering.");
assert(
  [...grouped.cut, ...grouped.engrave, ...grouped.score].every((entity) => entity.id !== construction.id),
  "Construction geometry leaked into the 3D preview passes.",
);
assert(
  findParentCutBoundary(engraving, hierarchy.solidBoundaries)?.entityId === topologyOuter.id,
  "An engraving was not associated with its containing cut panel.",
);

const burned = createBurnedMaterial("wood");
const engravedMesh = createSurfaceEngravingMesh(engraving, 3.2, burned);
assert(engravedMesh, "A closed engraving did not produce shallow surface geometry.");
engravedMesh.geometry.computeBoundingBox();
const engravingBounds = engravedMesh.geometry.boundingBox;
assert(engravingBounds, "Engraving geometry has no bounds.");
close(engravingBounds.max.z - engravingBounds.min.z, 0.1, "Engraving depth");
close(engravedMesh.position.z, 3.21, "Engraving surface position");

const scoreMesh = createSurfacePathMesh(score, 3.2, burned);
assert(scoreMesh, "An open score entity did not produce TubeGeometry.");
assert(scoreMesh.geometry instanceof THREE.TubeGeometry, "Score geometry is not a THREE.TubeGeometry.");
close(scoreMesh.geometry.parameters.radius, 0.15, "Score tube radius");
close(scoreMesh.position.z, 3.25, "Score surface position");
engravedMesh.geometry.dispose();
scoreMesh.geometry.dispose();
burned.dispose();

const openCut: LineEntity = { ...score, id: "open-cut", intent: "cut" };
const warningMaterial = createOpenCutWarningMaterial();
const warningMesh = createOpenCutDiagnosticMesh(openCut, 3.2, warningMaterial);
assert(warningMesh, "An open cut did not produce diagnostic TubeGeometry.");
assert(warningMesh.geometry instanceof THREE.TubeGeometry, "Open-cut diagnostic is not TubeGeometry.");
assert(warningMesh.material === warningMaterial, "Open-cut diagnostic did not use its warning material.");
assert(warningMesh.userData.warning === "open-cut", "Open-cut diagnostic provenance was not retained.");
warningMesh.geometry.dispose();
warningMaterial.dispose();

close(documentUnitToMillimetres("mm"), 1, "Millimetre unit scale");
close(documentUnitToMillimetres("in"), 25.4, "Inch unit scale");
for (const pxPerMm of [2, 10, 96 / 25.4]) {
  const physicalScale = { pxPerMm };
  const scale = documentUnitToMillimetres("px", physicalScale);
  close(scale, documentToMachineScale("px", "mm", physicalScale), "Preview/compiler pixel scale agreement");
  close(scale, documentToMachineScale("px", "in", physicalScale) * 25.4, "Preview/inch compiler scale agreement");
  const material = new THREE.MeshStandardMaterial();
  const mesh = createExtrudedContourMesh(outerNode, 3.2, [material], scale);
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  close(size.x, 100 / pxPerMm, "Calibrated preview width", 1e-5);
  close(size.y, 80 / pxPerMm, "Calibrated preview height", 1e-5);
  close(size.z, 3.2, "Physical thickness remains millimetres", 1e-5);
  const pixelDocument: CadDocument = {
    id: "pixel-preview", version: 1, title: "Pixel preview", units: "px",
    activeLayerId: layer.id, layers: [layer], entities: new Map([[topologyOuter.id, topologyOuter]]), selection: new Set(),
  };
  const plan = optimizeToolpaths(buildManufacturingPlan(pixelDocument, { processes: createDefaultProcesses({ kerfWidth: 0 }) }));
  const gcode = compileGcode(plan, { ...DEFAULT_GRBL_LASER_PROFILE, decimalPlaces: 6 }, { physicalScale });
  const motion = gcode.split("\n").filter((line) => /^G[01]\s/.test(line));
  const xs = motion.flatMap((line) => [...line.matchAll(/\bX([-\d.]+)/g)].map((match) => Number(match[1])));
  const ys = motion.flatMap((line) => [...line.matchAll(/\bY([-\d.]+)/g)].map((match) => Number(match[1])));
  close(Math.max(...xs) - Math.min(...xs), size.x, "Emitted G-code/preview physical width", 1e-5);
  close(Math.max(...ys) - Math.min(...ys), size.y, "Emitted G-code/preview physical height", 1e-5);
  mesh.geometry.dispose();
  material.dispose();
}
for (const physicalScale of [undefined, { pxPerMm: 0 }, { pxPerMm: -1 }, { pxPerMm: NaN }, { pxPerMm: Infinity }]) {
  let error: unknown;
  try { documentUnitToMillimetres("px", physicalScale); } catch (cause) { error = cause; }
  assert(error instanceof PixelCalibrationRequiredError, "Preview silently accepted missing/invalid pixel calibration.");
}
useCamCalibrationStore.getState().setPxPerMmInput("fixture-a", "10");
assert(useCamCalibrationStore.getState().inputsByDocument["fixture-a"] === "10", "CAM calibration was not shared.");
assert(useCamCalibrationStore.getState().inputsByDocument["fixture-b"] === undefined, "Calibration leaked to another document.");

const document: CadDocument = {
  id: "three-preview-smoke",
  version: 1,
  title: "3D preview smoke",
  units: "mm",
  activeLayerId: layer.id,
  layers: [layer],
  entities: new Map(panels.map(({ entity }) => [entity.id, entity])),
  selection: new Set(),
};
const restored = parseVectoraDocument(serializeVectoraDocument(document));
assert(restored.layers[0]?.material?.kind === "wood", "Layer preview material was not persisted.");
close(restored.layers[0]!.material!.thicknessMm, 3.2, "Persisted layer thickness");
assert(restored.entities.every((entity) => entity.metadata?.kind === "box-panel"), "Box assembly metadata was not persisted.");
assert(identifyBoxAssemblies(restored.entities).length === 1, "Persisted box metadata no longer identifies an assembly.");

console.log("3D topology, intent passes, surface engraving, score tubes, compound holes, folding, and persistence checks passed.");
