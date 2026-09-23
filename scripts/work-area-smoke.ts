import { defaultWorkArea, documentModel } from "../src/document/DocumentModel";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

documentModel.resetDocument("mm");
const initial = documentModel.getDocument();
assert(initial.workArea?.enabled === false && initial.workArea.width === 300 && initial.workArea.height === 200,
  "New millimetre documents did not receive the disabled default work area.");

let changeType: string | null = null;
const unsubscribe = documentModel.subscribe((_document, change) => { changeType = change.type; });
const versionBefore = initial.version;
documentModel.setWorkArea({ enabled: true, width: 240, height: 160 });
const enabled = documentModel.getDocument();
assert(changeType === "work-area-changed", "Work-area changes did not publish a document change.");
assert(enabled.version === versionBefore + 1, "Work-area changes did not increment the document version.");
assert(enabled.workArea?.enabled && enabled.workArea.width === 240 && enabled.workArea.height === 160,
  "Work-area dimensions were not stored on the document.");

const restored = parseVectoraDocument(serializeVectoraDocument(enabled));
assert(restored.workArea?.enabled && restored.workArea.width === 240 && restored.workArea.height === 160,
  "Native Vectora persistence lost the work-area boundary.");
documentModel.replaceDocument(restored);
assert(documentModel.getDocument().workArea?.width === 240, "Document replacement did not restore its work area.");

const legacy = JSON.parse(serializeVectoraDocument(enabled)) as { document: { workArea?: unknown } };
delete legacy.document.workArea;
const legacyReplacement = parseVectoraDocument(JSON.stringify(legacy));
assert(legacyReplacement.workArea === undefined, "Legacy files unexpectedly synthesized persisted work-area data.");
documentModel.replaceDocument(legacyReplacement);
assert(documentModel.getDocument().workArea?.enabled === false,
  "Opening a legacy file did not supply a safe disabled work-area default.");

const stable = documentModel.getDocument().workArea;
let rejected = false;
try {
  documentModel.setWorkArea({ enabled: true, width: 0, height: 100 });
} catch {
  rejected = true;
}
assert(rejected && documentModel.getDocument().workArea === stable, "Invalid work-area dimensions mutated the document.");
assert(defaultWorkArea("in").width === 12 && defaultWorkArea("px").width === 1_120,
  "Unit-specific work-area defaults are not practical for new documents.");
unsubscribe();

console.log("Document work-area validation, change events, defaults, and native persistence passed.");
