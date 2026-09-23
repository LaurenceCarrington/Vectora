import { exportDxf, parseDxf } from "../src/io/dxfSerializer";
import { evaluatePolylineSegment } from "../src/geometry/bezier";
import { bulgeToArc } from "../src/io/dxfGeometry";
import { documentModel } from "../src/document/DocumentModel";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import type { CadDocument, Entity, Layer, PolylineEntity, DimensionEntity } from "../src/document/types";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function near(a: number, b: number, message: string, tolerance = 1e-9) { assert(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`); }
function point(a: { x: number; y: number }, b: { x: number; y: number }, message: string) { near(a.x, b.x, `${message} x`); near(a.y, b.y, `${message} y`); }
const tag = (code: number, value: string | number) => `${code}\n${value}\n`;
const tags = (pairs: readonly (readonly [number, string | number])[]) => pairs.map(([c, v]) => tag(c, v)).join("");
const xy = (points: readonly (readonly [number, number])[]) => points.map(([x, y]) => tag(10, x) + tag(20, y)).join("");
function drawing(entities: string, units = 4, tables = "", blocks = "") {
  return tags([[0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, units], [0, "ENDSEC"], [0, "SECTION"], [2, "TABLES"]]) + tables + tags([[0, "ENDSEC"], [0, "SECTION"], [2, "BLOCKS"]]) + blocks + tags([[0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"]]) + entities + tags([[0, "ENDSEC"], [0, "EOF"]]);
}
const layer: Layer = { id: "cut", name: "Laser cut", intent: "cut", color: "#d12345", visible: true, locked: false, order: 0 };
const base = { layerId: layer.id, intent: "engrave" as const, visible: true, locked: false, style: { strokeColor: "#a034ed", strokeWidth: 0.7, fillColor: null, dashArray: [2, 1, 0, 1] }, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
const curve: PolylineEntity = { ...base, id: "curve", type: "polyline", points: [{ x: 1e-12, y: 2 }, { x: 10, y: 2 }, { x: 20, y: 5 }, { x: 25, y: 4 }], closed: false, segments: [{ type: "cubic", cp1: { x: 2, y: 12 }, cp2: { x: 8, y: -7 } }, { type: "quadratic", cp1: { x: 15, y: 14 } }, { type: "line" }] };
function doc(entities: readonly Entity[], units: CadDocument["units"] = "mm", layers = [layer]): CadDocument { return { id: "test", version: 1, title: "DXF hardening", units, activeLayerId: layers[0]!.id, layers, entities: new Map(entities.map(e => [e.id, e])), selection: new Set() }; }
const exported = exportDxf(doc([curve]));
assert(exported.includes("\nAC1014\n") && exported.includes("\nSPLINE\n"), "R14 must export SPLINE");
const imported = parseDxf(exported);
assert(!imported.warnings.length, `Unexpected warnings: ${imported.warnings}`);
const native = imported.entities[0];
assert(native?.type === "polyline" && native.segments?.length === 3, "Native spline segments missing");
near(native.points[0]!.x, 1e-12, "Small coordinates survive", 1e-20);
for (let i = 0; i < 3; i++) for (const t of [0, 0.17, 0.5, 0.83, 1]) point(evaluatePolylineSegment(native.points[i]!, native.points[i + 1]!, native.segments[i]!, t), evaluatePolylineSegment(curve.points[i]!, curve.points[i + 1]!, curve.segments![i]!, t), "Exact mixed Bézier round trip");
assert(native.intent === "engrave" && native.style.strokeColor === base.style.strokeColor && native.style.strokeWidth === 0.7, "Entity styles/intents lost");
assert(JSON.stringify(native.style.dashArray) === JSON.stringify(base.style.dashArray), "Dash pattern lost");
assert(imported.layers.find(l => l.name === layer.name)?.color === layer.color, "Custom layer color lost");
const closed = parseDxf(exportDxf(doc([{ ...curve, closed: true, segments: [...curve.segments!, { type: "quadratic", cp1: { x: 8, y: 25 } }] }]))).entities[0];
assert(closed?.type === "polyline" && closed.closed && closed.points.length === 4 && closed.segments?.length === 4, "Closed spline seam lost");
const r12Warnings: string[] = [];
const r12 = exportDxf(doc([curve]), { version: "R12", onWarning: w => r12Warnings.push(w) });
assert(!r12.includes("\nSPLINE\n") && r12.includes("\nPOLYLINE\n") && r12Warnings.length === 1, "R12 fallback must be explicit");
assert(parseDxf(r12).entities.length === 1, "R12 regression");

function spline(degree: number, knots: readonly number[], controls: readonly (readonly [number, number])[], flags = 8, extra = "") {
  return tags([[0, "SPLINE"], [71, degree], [70, flags], [72, knots.length], [73, controls.length]]) + knots.map(k => tag(40, k)).join("") + extra + xy(controls);
}
const bezier = parseDxf(drawing(spline(3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [1, 3], [2, 3], [3, 0]]))).entities[0];
assert(bezier?.type === "polyline" && bezier.segments?.[0]?.type === "cubic", "Cubic fixture failed");
point(bezier.segments[0].cp1, { x: 1, y: 3 }, "Cubic control 1"); point(bezier.segments[0].cp2, { x: 2, y: 3 }, "Cubic control 2");
// Independent Cox–de Boor basis reference tests nonuniform and repeated knots.
function basis(i: number, degree: number, t: number, knots: readonly number[]): number {
  if (!degree) return knots[i]! <= t && t < knots[i + 1]! ? 1 : 0;
  const a = knots[i + degree]! - knots[i]!; const b = knots[i + degree + 1]! - knots[i + 1]!;
  return (a ? (t - knots[i]!) / a * basis(i, degree - 1, t, knots) : 0) + (b ? (knots[i + degree + 1]! - t) / b * basis(i + 1, degree - 1, t, knots) : 0);
}
for (const knots of [[0, 0, 0, 0, 0.2, 0.7, 1, 1, 1, 1], [0, 0, 0, 0, 0.4, 0.4, 1, 1, 1, 1], [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]]) {
  const controls = [[0, 0], [1, 4], [2, -2], [4, 6], [7, 2], [9, 0]] as const;
  const result = parseDxf(drawing(spline(3, knots, controls)));
  const path = result.entities[0];
  assert(path?.type === "polyline" && path.segments, `Nonuniform spline failed: ${result.warnings}`);
  let segment = 0;
  for (let k = 3; k < controls.length; k++) {
    if (knots[k] === knots[k + 1]) continue;
    for (const u of [0.12, 0.35, 0.67, 0.93]) {
      const t = knots[k]! + (knots[k + 1]! - knots[k]!) * u;
      const expected = controls.reduce((v, c, i) => ({ x: v.x + c[0] * basis(i, 3, t, knots), y: v.y + c[1] * basis(i, 3, t, knots) }), { x: 0, y: 0 });
      point(evaluatePolylineSegment(path.points[segment]!, path.points[segment + 1]!, path.segments[segment]!, u), expected, "Nonuniform span");
    }
    segment++;
  }
}
const discontinuous = parseDxf(drawing(spline(3, [0,0,0,0,1,1,1,1,2,2,2,2], [[0,0],[1,1],[2,1],[3,0],[10,0],[11,1],[12,1],[13,0]])));
assert(discontinuous.entities.length === 2, "Discontinuous splines must not be bridged");
const periodic = parseDxf(drawing(spline(3, [-3,-2,-1,0,1,2,3,4,5,6,7], [[0,0],[2,0],[2,2],[0,2],[0,0],[2,0],[2,2]], 11)));
assert(periodic.entities[0]?.type === "polyline" && periodic.entities[0].closed, `Periodic spline: ${periodic.warnings}`);

for (const bulge of [1, -1, Math.tan(Math.PI / 8), -2, 0.000001]) {
  const arc = bulgeToArc({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
  point({ x: arc.center.x + arc.radius * Math.cos(arc.endAngle), y: arc.center.y + arc.radius * Math.sin(arc.endAngle) }, { x: 10, y: 0 }, "Bulge endpoint");
  near(arc.endAngle - arc.startAngle, 4 * Math.atan(bulge), "Bulge signed sweep");
  assert(arc.counterClockwise === (bulge < 0), "Bulge orientation");
}
const bulged = tags([[0, "LWPOLYLINE"], [90, 3], [70, 1], [10, 0], [20, 0], [42, 1], [10, 10], [20, 0], [10, 10], [20, 10], [42, -0.5]]);
const arcs = parseDxf(drawing(bulged));
assert(arcs.entities.length === 3 && arcs.entities.filter(e => e.type === "arc").length === 2, "Closing bulge or straight edge lost");
const firstArc = arcs.entities[0]; assert(firstArc?.type === "arc", "Expected exact arc"); near(firstArc.radius, 5, "Semicircle radius"); point(firstArc.center, { x: 5, y: 0 }, "Semicircle center");
const classical = tags([[0,"POLYLINE"],[70,1],[0,"VERTEX"],[10,0],[20,0],[42,1],[0,"VERTEX"],[10,10],[20,0],[42,-1],[0,"SEQEND"]]);
assert(parseDxf(drawing(classical)).entities.filter(e => e.type === "arc").length === 2, "Classic POLYLINE bulges lost");
const arcRoundTrip = parseDxf(exportDxf(doc(arcs.entities, arcs.units, [...arcs.layers])));
assert(arcRoundTrip.entities.length === 3 && !arcRoundTrip.warnings.length, "Bulge exact arc BLOCK round trip");

const line = tags([[0, "LINE"], [10, 1], [20, 2], [11, 2], [21, 4]]);
for (const [unit, expected] of [[1,25.4],[2,304.8],[4,1],[5,10],[6,1000],[13,0.001],[21,1200000/3937]]) {
  const result = parseDxf(drawing(line, unit), { units: "mm" }); const e = result.entities[0]; assert(e?.type === "line", "Scaled line missing"); near(e.start.x, expected!, "Unit scale"); near(e.end.y, expected! * 4, "Unit end scale");
}
assert(parseDxf(drawing(line, 1)).units === "in", "Inches must remain inches by default");
const inchCurve = parseDxf(exportDxf(doc([curve], "in")), { units: "mm" }).entities[0];
assert(inchCurve?.type === "polyline" && inchCurve.segments?.[0]?.type === "cubic", "Scaled curve missing"); near(inchCurve.segments[0].cp1.y, 12 * 25.4, "Control points scale");

const block = tags([[0,"BLOCK"],[2,"PART"],[10,1],[20,2]]) + line + tags([[0,"ENDBLK"]]);
const insert = tags([[0,"INSERT"],[2,"PART"],[10,100],[20,50],[41,2],[42,3],[50,90]]);
const blockResult = parseDxf(drawing(insert, 4, "", block));
const inserted = blockResult.entities[0]; assert(inserted?.type === "line", `Block failed: ${blockResult.warnings}`);
point(inserted.start, { x: 100, y: 50 }, "INSERT base point"); point(inserted.end, { x: 94, y: 52 }, "INSERT scale then rotation"); assert(inserted.dxfGroup, "INSERT grouping missing");
const nestedBlock = block + tags([[0,"BLOCK"],[2,"OUTER"],[10,0],[20,0]]) + insert + tags([[0,"ENDBLK"]]);
const nested = parseDxf(drawing(tags([[0,"INSERT"],[2,"OUTER"],[10,7],[20,9]]),4,"",nestedBlock)).entities[0];
assert(nested?.type === "line", "Nested block missing"); point(nested.start, { x: 107, y: 59 }, "Nested composition");
const array = parseDxf(drawing(insert + tag(70, 2) + tag(71, 2) + tag(44, 10) + tag(45, 20), 4, "", block));
assert(array.entities.length === 4 && new Set(array.entities.map(e => e.dxfGroup)).size === 4, "MINSERT instances need independent groups");
const cycle = tags([[0,"BLOCK"],[2,"CYCLE"],[0,"INSERT"],[2,"CYCLE"],[0,"ENDBLK"]]);
assert(parseDxf(drawing(tags([[0,"INSERT"],[2,"CYCLE"]]), 4, "", cycle)).warnings.some(w => w.includes("Cyclic")), "Cycle guard missing");
const assembly = { ...curve, metadata: { kind: "box-panel" as const, assemblyId: "finger-box", panel: "front" as const, width: 100, height: 80, depth: 50, materialThickness: 3 } };
const assemblyDxf = exportDxf(doc([assembly, { ...curve, id: "second", compoundId: "pair" }, { ...curve, id: "third", compoundId: "pair" }]));
assert(assemblyDxf.split("\nINSERT\n").length === 3 && parseDxf(assemblyDxf).entities.length === 3, "Assembly/compound BLOCK export");

const dimensions: DimensionEntity[] = (["linear", "aligned", "radial", "diameter"] as const).map((dimensionKind, i) => ({ ...base, id: `dim-${i}`, type: "dimension", dimensionKind, startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 }, textPosition: { x: 5, y: 15 }, arrowSize: 2.75, value: dimensionKind === "diameter" ? 20 : 10, precision: 4, prefix: "pre", suffix: "mm" }));
export const verificationDxf = exportDxf(doc([
  curve, { ...assembly, id: "assembly" }, ...dimensions,
  { ...base, id: "audit-arc", type: "arc", center: { x: 50, y: 50 }, radius: 10, startAngle: 0, endAngle: Math.PI * 1.5, counterClockwise: false },
  { ...base, id: "audit-rectangle", type: "rectangle", origin: { x: 20, y: 20 }, width: 10, height: 5, cornerRadius: 0 },
  { ...base, id: "audit-text", type: "text", x: 10, y: 10, text: "DXF audit", fontFamily: "STANDARD", fontSize: 3 },
]));
const annotationDxf = exportDxf(doc(dimensions));
assert(annotationDxf.includes("\nDIMSTYLE\n") && annotationDxf.includes("\nBLOCK_RECORD\n") && annotationDxf.includes("\nSOLID\n"), "Dimension tables/render blocks missing");
const annotationImport = parseDxf(annotationDxf);
assert(!annotationImport.warnings.length && annotationImport.entities.length === 4, `Dimension roundtrip: ${annotationImport.warnings}`);
for (let i = 0; i < 4; i++) {
  const d = annotationImport.entities[i]; assert(d?.type === "dimension", "Dimension missing"); const original = dimensions[i]!;
  assert(d.dimensionKind === original.dimensionKind && d.precision === 4 && d.prefix === "pre" && d.suffix === "mm", "Dimension style lost"); near(d.arrowSize, 2.75, "DIMASZ"); near(d.value, original.value, "Dimension measurement"); point(d.startPoint, original.startPoint, "Dimension definition center/start"); point(d.endPoint, original.endPoint, "Dimension definition end");
}
const externalStyle = tags([[0,"DIMSTYLE"],[2,"FINE"],[41,0.1],[40,2],[271,5],[3,"<>cm"]]);
const externalDim = tags([[0,"DIMENSION"],[70,1],[3,"FINE"],[13,0],[23,0],[14,3],[24,4],[10,0],[20,5]]);
const dimension = parseDxf(drawing(externalDim,5,externalStyle)).entities[0]; assert(dimension?.type === "dimension", "External dimension missing"); near(dimension.value, 50, "Missing measurement fallback and cm scaling"); near(dimension.arrowSize,2,"DIMASZ DIMSCALE units"); assert(dimension.precision === 5 && dimension.suffix === "mm", "External DIMSTYLE");

const aciTable = tags([[0,"LTYPE"],[2,"DASHED"],[49,2],[49,-1],[0,"LAYER"],[2,"Custom"],[62,142],[6,"DASHED"],[70,4]]);
const colored = parseDxf(drawing(line + tag(8,"Custom"),4,aciTable));
const coloredLayer = colored.layers.find(l => l.name === "Custom")!; assert(coloredLayer.dxfAci === 142 && coloredLayer.locked && colored.entities[0]!.style.dashArray.length === 2, "ACI/linetype import");
const coloredAgain = parseDxf(exportDxf(doc(colored.entities,colored.units,[...colored.layers]))); assert(coloredAgain.layers.find(l => l.name === "Custom")?.dxfAci === 142, "ACI export drift");
documentModel.replaceDocument({ title: "DXF persistence", layers: colored.layers, entities: [{ ...colored.entities[0]!, dxfGroup: "persisted" }], units: colored.units });
const saved = parseVectoraDocument(serializeVectoraDocument(documentModel.getDocument()));
assert(saved.entities[0]?.dxfGroup === "persisted" && saved.layers.find(l => l.name === "Custom")?.dxfLineType === "DASHED", "Native persistence drops DXF metadata");
documentModel.resetDocument();

const rational = spline(3,[0,0,0,0,1,1,1,1],[[0,0],[1,1],[2,1],[3,0]],12,[1,2,2,1].map(w => tag(41,w)).join(""));
const bad = parseDxf(drawing(rational + tags([[0,"ALIEN"],[10,0]]) + tags([[0,"CIRCLE"],[40,"NaN"]]) + line));
assert(bad.entities.length === 1 && bad.warnings.length === 3, "Bad/unknown records must warn and retain valid siblings");
const binary = parseDxf("AutoCAD Binary DXF\r\n\x1a\0garbage"); assert(!binary.entities.length && binary.warnings[0]?.includes("ASCII"), "Binary actionable warning");
assert(parseDxf("garbage").warnings.length === 1, "Invalid document warning");
const malformed = parseDxf(drawing(tags([[0,"LINE"],[10,"bad"],[20,0],[11,1],[21,1]]) + line));
assert(malformed.entities.length === 1 && malformed.warnings.length === 1, "Invalid coordinates must not corrupt valid siblings");
assert(parseDxf(drawing(line).replace("10\n1", "10bad\n1")).warnings.some(w => w.includes("group-code")), "Malformed group codes must warn");
const reflectedArc = parseDxf(drawing(tags([[0,"ARC"],[10,5],[20,0],[40,5],[50,0],[51,90],[230,-1]]))).entities[0];
assert(reflectedArc?.type === "arc" && reflectedArc.counterClockwise && reflectedArc.center.x === -5, "Negative extrusion must reflect the arc");
const changedUnits = parseDxf(annotationDxf, { units: "in" }).entities[0];
assert(changedUnits?.type === "dimension" && changedUnits.suffix === "in", "Dimension suffix must track converted physical units");
near(changedUnits.value, 10 / 25.4, "Converted dimension measurement");
assert(parseDxf(drawing(line).replace(/\n/g,"\r\n")).entities.length === 1 && parseDxf("\uFEFF" + drawing(line)).entities.length === 1, "CRLF/BOM");
console.log("DXF hardening passed: exact spline spans, bulges, units, blocks, dimension styles, persistence and diagnostics.");
