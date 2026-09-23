import { parseSvg, exportSvg } from "../src/io/svgParser";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { entitiesToPolygons, weldEntities, subtractEntities } from "../src/geometry/operations/booleans";
import { buildContourHierarchy } from "../src/geometry/topology";
import type { CadDocument, Entity, PolylineEntity } from "../src/document/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, got ${actual}`);
}
const rectSvg = (attributes: string) => parseSvg(`<svg ${attributes}><rect x="10" y="20" width="100" height="50"/></svg>`);
const scaled = rectSvg('width="200mm" height="100mm" viewBox="10 20 100 50"');
assert(scaled.units === "mm", "Physical width did not select millimetres.");
close(scaled.entities[0]!.bbox.minX, 0, "viewBox origin x");
close(scaled.entities[0]!.bbox.maxY, 0, "viewBox origin y");
close(scaled.entities[0]!.bbox.maxX, 200, "Physical width");
close(scaled.entities[0]!.bbox.minY, -100, "Physical height");
const inches = rectSvg('width="2in" height="25.4mm" viewBox="10 20 100 50"');
assert(inches.units === "in", "Inch viewport unit lost.");
close(inches.entities[0]!.bbox.maxX, 2, "Mixed physical viewport widths");
close(inches.entities[0]!.bbox.minY, -1, "Mixed physical viewport heights");
const meet = rectSvg('width="200mm" height="200mm" viewBox="10 20 100 50"');
close(meet.entities[0]!.bbox.maxY, -50, "Default meet vertical alignment");
close(meet.entities[0]!.bbox.minY, -150, "Default meet height");
const none = rectSvg('width="200mm" height="200mm" viewBox="10 20 100 50" preserveAspectRatio="none"');
close(none.entities[0]!.bbox.minY, -200, "Independent viewBox scaling");
const slice = rectSvg('width="200mm" height="200mm" viewBox="10 20 100 50" preserveAspectRatio="xMaxYMin slice"');
close(slice.entities[0]!.bbox.minX, -200, "Slice alignment");
close(slice.entities[0]!.bbox.maxX, 200, "Slice scale");
const noViewBox = parseSvg('<svg width="100mm" height="100mm"><rect width="96" height="96"/></svg>');
close(noViewBox.entities[0]!.bbox.maxX, 25.4, "CSS user units without viewBox");
const centimetres = parseSvg('<svg width="2.54cm" height="72pt" viewBox="0 0 96 96"><rect width="96" height="96"/></svg>');
close(centimetres.entities[0]!.bbox.maxX, 25.4, "cm/pt conversion");
const transformed = parseSvg('<svg width="100mm" height="100mm" viewBox="0 0 1000 1000"><g transform="translate(100 200)"><path d="M0 0 C10 20 30 40 50 60"/></g></svg>');
const curve = transformed.entities[0] as PolylineEntity;
close(curve.points[0]!.x, 10, "Viewport/group transform composition");
assert(curve.segments?.[0]?.type === "cubic", "Cubic was flattened.");
close(curve.segments[0].cp1.y, -22, "Control point physical scaling");

const selfClosingGroup = parseSvg('<svg><g transform="translate(50 0)"/><line x1="0" y1="0" x2="10" y2="0"/></svg>');
close(selfClosingGroup.entities[0]!.bbox.minX, 0, "Self-closing group leaked its transform into a sibling");
const annotationNesting = parseSvg('<svg><g data-vectora-type="leader" data-arrow-x="0" data-arrow-y="0" data-elbow-x="1" data-elbow-y="1" data-text-x="2" data-text-y="2" data-text="Nested"><g><path d="M0 0 L2 2"/></g><path d="M3 3 L4 4"/></g><line x1="10" y1="0" x2="20" y2="0"/></svg>');
assert(annotationNesting.entities.length === 2 && annotationNesting.entities[0]!.type === "leader" && annotationNesting.entities[1]!.type === "line", "Nested annotation graphics escaped the ignored group.");
const escaped = parseSvg('<svg><title>Cut &amp; Engrave</title><g data-name="A &amp; B"><text data-vectora-type="text" data-text="1 &lt; 2 &amp;&amp; 3 &gt; 2" x="0" y="0" font-size="12"/></g></svg>');
assert(escaped.title === "Cut & Engrave" && escaped.layers[0]!.name === "A & B", "XML entities were not decoded in SVG metadata.");
assert(escaped.entities[0]!.type === "text" && escaped.entities[0].text === "1 < 2 && 3 > 2", "XML entities were not decoded in text attributes.");
const largeArc = parseSvg('<svg width="2000mm" height="1000mm" viewBox="0 0 2000 1000"><path d="M0 1000 A1000 1000 0 0 1 2000 1000"/></svg>');
assert(largeArc.entities[0]!.type === "polyline" && largeArc.entities[0].points.length > 25, "Large SVG arcs retained the inaccurate fixed 24-segment tessellation.");

const imported = parseSvg('<svg width="20mm" height="20mm" viewBox="0 0 20 20"><path d="M0 0 H20 V20 H0 Z m5 5 h5 v5 h-5 z M12 12 Q14 14 16 12 M1 1 L2 2"/></svg>');
assert(imported.entities.length === 4, "Multiple movetos did not produce distinct entities.");
const paths = imported.entities as readonly PolylineEntity[];
assert(paths[0]!.closed && paths[1]!.closed && !paths[2]!.closed && !paths[3]!.closed, "Subpath closure leaked.");
assert(new Set(paths.map((path) => path.id)).size === 4, "Subpath IDs are not unique.");
assert(new Set(paths.map((path) => path.compoundId)).size === 1, "Subpath source relationship lost.");
close(paths[1]!.points[0]!.x, 5, "Relative moveto after Z");
close(paths[1]!.points[0]!.y, -5, "Relative moveto after Z uses contour start");
assert(paths[2]!.points.length === 2 && paths[2]!.segments?.[0]?.type === "quadratic", "Subpath native curve lost or connected.");
const solids: readonly Entity[] = paths.slice(0, 2);
assert(entitiesToPolygons(solids)[0]!.length === 2, "SVG counter did not become a clipping hole.");
const extension = { ...paths[0]!, id: "extension", compoundId: "extension", points: [{ x: 15, y: 0 }, { x: 25, y: 0 }, { x: 25, y: -20 }, { x: 15, y: -20 }] };
const welded = weldEntities([...solids, extension], { layers: imported.layers });
assert(buildContourHierarchy(welded).nodes.some((node) => node.kind === "inner"), "Weld refilled imported SVG counter.");
const cutter = { ...paths[1]!, id: "cutter", compoundId: "cutter", points: [{ x: 12, y: -12 }, { x: 14, y: -12 }, { x: 14, y: -14 }, { x: 12, y: -14 }] };
const subtracted = subtractEntities([...welded, cutter], { layers: imported.layers });
assert(buildContourHierarchy(subtracted).nodes.filter((node) => node.kind === "inner").length === 2, "SVG Weld/Subtract counter topology lost.");

const explicitClose = parseSvg('<svg><path d="M0 0 L10 0 L10 10 Q0 10 0 0 Z M20 20 L30 30 Z L40 40"/></svg>');
const closedCurve = explicitClose.entities[0] as PolylineEntity;
assert(closedCurve.points.length === 3 && closedCurve.segments?.length === 3 && closedCurve.segments[2]?.type === "quadratic", "Explicit closing curve acquired a duplicate node or lost its controls.");
const afterClose = explicitClose.entities[2] as PolylineEntity;
assert(!afterClose.closed && afterClose.points[0]!.x === 20, "Drawing after Z did not start a distinct open subpath.");
const implicitLines = parseSvg('<svg><path d="M1 1 2 2 3 1 m10 10 1 0"/></svg>');
assert(implicitLines.entities.length === 2 && (implicitLines.entities[0] as PolylineEntity).points.length === 3, "Implicit lineto pairs were split incorrectly.");

const document: CadDocument = { id: "svg-fixture", version: 1, title: "SVG regression", units: "mm", activeLayerId: imported.layers[0]!.id, layers: imported.layers, entities: new Map(subtracted.map((entity) => [entity.id, entity])), selection: new Set() };
const native = parseVectoraDocument(serializeVectoraDocument(document));
assert([...native.entities.values()].every((entity) => entity.compoundId === subtracted[0]!.compoundId), "Native persistence lost compound relationships.");
const roundTrip = parseSvg(exportSvg(native));
assert(roundTrip.entities.every((entity) => entity.compoundId === subtracted[0]!.compoundId), "SVG export lost compound relationships.");
close(roundTrip.entities[0]!.bbox.minX, subtracted[0]!.bbox.minX, "Export/import CAD origin x");
close(roundTrip.entities[0]!.bbox.minY, subtracted[0]!.bbox.minY, "Export/import CAD origin y");
assert(buildContourHierarchy(roundTrip.entities).nodes.filter((node) => node.kind === "inner").length === 2, "SVG round trip lost counter topology.");
for (const source of ['<svg viewBox="0 0 0 10"/>', '<svg><path d="M0 0 L10"/></svg>']) {
  let threw = false;
  try { parseSvg(source); } catch { threw = true; }
  assert(threw, "Invalid viewport/path data was silently accepted.");
}
console.log("SVG physical scaling, group state, XML decoding, native subpaths, compound Booleans and persistence checks passed.");
