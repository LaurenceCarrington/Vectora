import { readFileSync } from "node:fs";
import { parse } from "opentype.js";
import { createTextEntity } from "../src/canvas/useCreationStateMachine";
import { calculateEntityBounds, documentModel } from "../src/document/DocumentModel";
import { ReplaceEntitySetCommand, executeCommand, history, undo } from "../src/document/History";
import type { TextEntity } from "../src/document/types";
import { convertTextToPaths } from "../src/geometry/operations/textToPath";
import { exportDxf, parseDxf } from "../src/io/dxfSerializer";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { exportSvg, parseSvg } from "../src/io/svgParser";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const bytes = readFileSync("node_modules/typeface-roboto/files/roboto-latin-400.woff");
const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const font = parse(fontBuffer);
const dropped = createTextEntity("text-smoke", { x: 15, y: 20 }, undefined, "OO");
assert(dropped, "The Text tool did not create a default text entity on the active layer.");
const source: TextEntity = { ...dropped, name: "Test text" };
const text = { ...source, bbox: calculateEntityBounds(source) };
const committed = documentModel.addEntity(text);
const nativeRoundTrip = parseVectoraDocument(serializeVectoraDocument(documentModel.getDocument()));
assert(nativeRoundTrip.entities[0]?.type === "text", "Native persistence did not retain the text entity.");
const svgRoundTrip = parseSvg(exportSvg(documentModel.getDocument()));
assert(svgRoundTrip.entities[0]?.type === "text" && svgRoundTrip.entities[0].text === "OO", "SVG persistence did not retain live text.");
const dxfRoundTrip = parseDxf(exportDxf(documentModel.getDocument()));
assert(dxfRoundTrip.entities[0]?.type === "text" && dxfRoundTrip.entities[0].text === "OO", "DXF persistence did not retain live text.");
const contours = await convertTextToPaths(committed, { font });
assert(contours.length >= 4, "The two O glyphs did not retain outer and inner contours.");
assert(contours.every((entity) => entity.closed && entity.points.length >= 3), "Text conversion emitted an open or empty contour.");
assert(contours.every((entity) => entity.layerId === text.layerId && entity.intent === text.intent), "Text conversion lost layer or intent inheritance.");
executeCommand(new ReplaceEntitySetCommand([committed], contours, "Convert text to paths"));
assert(!documentModel.getDocument().entities.has(text.id), "Replacement retained the live text entity.");
assert(documentModel.getDocument().selection.size === contours.length, "Converted contours were not selected.");
undo();
assert(documentModel.getDocument().entities.get(text.id)?.type === "text", "Undo did not restore live text.");
history.clear();

console.log(`Text schema, native/SVG/DXF persistence, ${contours.length} closed OpenType contours, inheritance, replacement, and undo checks passed.`);
