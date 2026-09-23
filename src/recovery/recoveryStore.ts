import { parseVectoraDocument } from "../io/filePersistence";
import type { DocumentReplacement } from "../document/DocumentModel";

export const RECOVERY_SCHEMA_VERSION = 1;
const DATABASE_NAME = "vectora-local-recovery";
const STORE_NAME = "documents";

export interface RecoverySnapshot {
  readonly updatedAt: number;
  readonly documentRevision: number;
  readonly documentName: string;
  readonly snapshot: string;
}

interface StoredRecovery {
  readonly documentId: string;
  readonly schemaVersion: number;
  readonly current: RecoverySnapshot;
  readonly previous?: RecoverySnapshot;
}

export interface RecoveryCandidate {
  readonly documentId: string;
  readonly documentName: string;
  readonly updatedAt: number;
  readonly documentRevision: number;
  readonly source: "current" | "previous" | "corrupt";
  readonly document: DocumentReplacement | null;
  readonly error?: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Recovery transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Recovery transaction was aborted."));
  });
  // A request can reject before its transaction settles; keep that later
  // transaction rejection observed while preserving it for callers that await.
  void done.catch(() => {});
  return done;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "documentId" });
    };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error("Recovery database could not be opened."));
    request.onblocked = () => { blocked = true; reject(new Error("Another tab is blocking the recovery database.")); };
  });
}

async function withDatabase<T>(run: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try { return await run(database); }
  finally { database.close(); }
}

function validSlot(value: unknown, documentId: string): RecoveryCandidate | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as Partial<RecoverySnapshot>;
  if (!Number.isFinite(slot.updatedAt) || !Number.isSafeInteger(slot.documentRevision) ||
    typeof slot.documentName !== "string" || typeof slot.snapshot !== "string") return null;
  try {
    const document = parseVectoraDocument(slot.snapshot);
    if (document.id !== documentId || document.version !== slot.documentRevision) return null;
    return { documentId, documentName: slot.documentName, updatedAt: slot.updatedAt!,
      documentRevision: slot.documentRevision!, source: "current", document };
  } catch { return null; }
}

export function inspectRecovery(value: unknown): RecoveryCandidate {
  const record = value && typeof value === "object" ? value as Partial<StoredRecovery> : {};
  const documentId = typeof record.documentId === "string" ? record.documentId : "";
  const bad = (error: string): RecoveryCandidate => ({ documentId, documentName: "Damaged local recovery",
    updatedAt: 0, documentRevision: 0, source: "corrupt", document: null, error });
  if (!documentId) return bad("The recovery record has no document ID.");
  if (record.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
    return bad(`Recovery schema version ${String(record.schemaVersion)} is not supported.`);
  }
  const current = validSlot(record.current, documentId);
  if (current) return current;
  const previous = validSlot(record.previous, documentId);
  if (previous) return { ...previous, source: "previous" };
  return bad("Neither local recovery copy can be read.");
}

export async function saveRecovery(documentId: string, slot: RecoverySnapshot): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(store.get(documentId)) as StoredRecovery | undefined;
    if (existing && existing.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
      transaction.abort();
      throw new RangeError(`Recovery schema version ${String(existing.schemaVersion)} is not supported.`);
    }
    const prior = existing?.schemaVersion === RECOVERY_SCHEMA_VERSION
      ? (validSlot(existing.current, documentId) ? existing.current : validSlot(existing.previous, documentId) ? existing.previous : undefined)
      : undefined;
    const previous = prior && prior.documentRevision !== slot.documentRevision
      ? prior
      : existing?.previous && validSlot(existing.previous, documentId) ? existing.previous : undefined;
    store.put({ documentId, schemaVersion: RECOVERY_SCHEMA_VERSION, current: slot, ...(previous ? { previous } : {}) } satisfies StoredRecovery);
    await done;
  });
}

export async function getRecovery(documentId: string): Promise<RecoveryCandidate | null> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(documentId));
    await done;
    return value === undefined ? null : inspectRecovery(value);
  });
}

export async function listRecoveries(): Promise<RecoveryCandidate[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const values = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return values.map(inspectRecovery).sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

export async function deleteRecovery(documentId: string): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(documentId);
    await done;
  });
}

export async function clearRecoveries(): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).clear();
    await done;
  });
}
