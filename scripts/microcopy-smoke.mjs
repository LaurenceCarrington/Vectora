import fs from "node:fs";

const files = [
  "src/components/VectoraWorkspace.tsx",
  "src/components/modals/PreferencesModal.tsx",
  "src/components/modals/ThreePreviewModal.tsx",
  "src/components/modals/VectorizerModal.tsx",
  "src/components/panels/CamPanel.tsx",
  "src/components/panels/LayersPanel.tsx",
  "src/components/panels/MachineControlPanel.tsx",
  "src/components/panels/PropertyInspector.tsx",
  "src/components/panels/RasterPanel.tsx",
  "src/components/panels/ToolLibrary.tsx",
];

const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const terminology = fs.readFileSync("src/components/ui/terminology.ts", "utf8");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const label of [
  "Manufacture",
  "Manufacturing",
  "Vector engrave",
  "Raster engrave",
  "Material preset",
  "Cutter library",
  "3D preview",
  "Object snap radius",
  "Export G-code",
]) {
  assert(source.includes(label) || terminology.includes(label), `Canonical label is missing: ${label}`);
}

for (const legacy of [
  "Select / Transform",
  "Node Edit",
  "Segment Eraser",
  "CAM / Manufacturing",
  "Bitmap & Raster Engrave",
  "Manufacturing setup",
  "MATERIAL PROFILE",
  "POCKET CLEAR",
  "Raster Engrave selected images",
  "Invert colors",
  "Centerline Trace",
  "image(s)",
]) {
  assert(!source.includes(legacy), `Legacy UI copy remains: ${legacy}`);
}

for (const intent of ["cut", "engrave", "raster", "score", "pocket", "construction"]) {
  assert(new RegExp(`\\b${intent}:\\s*\"`).test(terminology), `Manufacturing operation label is not centralised: ${intent}`);
}

assert(terminology.includes("count === 1"), "Count formatting must preserve singular grammar.");
assert(!/<button[^>]*\btitle=/s.test(source), "A button still uses a native title tooltip.");

for (const [limit, copy] of [
  ["work-area guide", "does not stop drawing outside the border"],
  ["DXF fill loss", "DXF exports outlines but not fill colors"],
  ["bitmap vector export", "SVG and DXF cannot include embedded bitmaps"],
  ["live text in CAM", "excluded from toolpaths"],
  ["unconfirmed browser download", "cannot confirm it was saved"],
  ["3D preview simulation", "not a complete stock-removal simulation"],
]) {
  assert(source.includes(copy), `User-facing guidance is missing: ${limit}`);
}

console.log("Microcopy terminology, limitation guidance, count grammar, and native-tooltip checks passed.");
