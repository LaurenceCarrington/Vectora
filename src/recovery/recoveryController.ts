import { documentModel, type DocumentChange } from "../document/DocumentModel";
import { filePersistence, serializeVectoraDocument } from "../io/filePersistence";
import { clearRecoveries, deleteRecovery, saveRecovery } from "./recoveryStore";

const PREFERENCE_KEY = "vectora-local-recovery-enabled";
const DEBOUNCE_MS = 3_000;
const HEARTBEAT_MS = 2_000;
const PEER_TIMEOUT_MS = 7_000;

export type RecoveryStatus = "idle" | "pending" | "writing" | "saved" | "unavailable" | "conflict";
export interface RecoveryState {
  readonly enabled: boolean;
  readonly status: RecoveryStatus;
  readonly conflict: boolean;
}

type PeerMessage = { readonly tabId: string; readonly documentId: string; readonly type: "claim" | "heartbeat" | "release" };

class RecoveryController {
  private state: RecoveryState = Object.freeze({ enabled: this.readEnabled(), status: "idle", conflict: false });
  private listeners = new Set<() => void>();
  private warning: ((message: string) => void) | null = null;
  private warned = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private documentId = documentModel.getDocument().id;
  private peers = new Map<string, { documentId: string; seenAt: number }>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribeDocument: (() => void) | null = null;
  private unsubscribePersistence: (() => void) | null = null;
  private lastSavedAt: string | null = filePersistence.getSnapshot().savedAt;

  getSnapshot = (): RecoveryState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(next: RecoveryState): void {
    if (next.enabled === this.state.enabled && next.status === this.state.status && next.conflict === this.state.conflict) return;
    this.state = Object.freeze(next);
    for (const listener of this.listeners) listener();
  }

  private readEnabled(): boolean {
    try { return localStorage.getItem(PREFERENCE_KEY) !== "false"; }
    catch { return true; }
  }

  private fail(error: unknown): void {
    console.error("Local recovery could not be updated.", error);
    this.publish({ ...this.state, status: "unavailable" });
    if (!this.warned) {
      this.warned = true;
      this.warning?.("Local recovery could not be updated. Save your project manually to avoid losing changes.");
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation);
    this.queue = next.catch((error: unknown) => this.fail(error));
    return next;
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.generation += 1;
  }

  private hasConflict(): boolean {
    const now = Date.now();
    for (const [id, peer] of this.peers) if (now - peer.seenAt > PEER_TIMEOUT_MS) this.peers.delete(id);
    return [...this.peers.values()].some((peer) => peer.documentId === this.documentId);
  }

  private updateConflict(): void {
    const conflict = this.hasConflict();
    const wasConflicted = this.state.conflict;
    this.publish({ ...this.state, conflict, status: conflict ? "conflict" : this.state.status === "conflict" ? "idle" : this.state.status });
    if (conflict && !wasConflicted) this.warning?.("This drawing is open in another Vectora tab. Local recovery is paused here to avoid overwriting its copy.");
    if (!conflict && wasConflicted && filePersistence.isDirty()) this.schedule();
  }

  private announce(type: PeerMessage["type"] = "heartbeat", documentId = this.documentId): void {
    this.channel?.postMessage({ tabId: this.tabId, documentId, type } satisfies PeerMessage);
  }

  private setActiveDocument(documentId: string): void {
    if (documentId === this.documentId) return;
    this.announce("release");
    this.cancelPending();
    this.documentId = documentId;
    this.updateConflict();
    this.announce("claim");
  }

  private schedule(): void {
    if (!this.started || !this.state.enabled || this.state.conflict || !filePersistence.isDirty()) return;
    this.cancelPending();
    const generation = this.generation;
    const documentId = this.documentId;
    this.publish({ ...this.state, status: "pending" });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(async () => {
        if (generation !== this.generation || !this.state.enabled || this.hasConflict() ||
          documentModel.getDocument().id !== documentId || !filePersistence.isDirty()) return;
        this.publish({ ...this.state, status: "writing" });
        const document = documentModel.getDocument();
        const revision = filePersistence.getContentRevision();
        const snapshot = serializeVectoraDocument(document);
        await saveRecovery(documentId, {
          updatedAt: Date.now(), documentRevision: document.version,
          documentName: filePersistence.getSnapshot().fileName ?? `${document.title}.vectora`, snapshot,
        });
        if (generation === this.generation) this.publish({ ...this.state, status: "saved" });
        if (documentModel.getDocument().id === documentId && filePersistence.isDirty() &&
          filePersistence.getContentRevision() !== revision && this.timer === null) this.schedule();
      }).catch(() => { /* fail() already reported the storage error. */ });
    }, DEBOUNCE_MS);
  }

  start(warn: (message: string) => void): void {
    if (this.started) return;
    this.started = true;
    this.warning = warn;
    this.documentId = documentModel.getDocument().id;
    this.unsubscribeDocument = documentModel.subscribe((document, change: DocumentChange) => {
      if (change.type === "selection-changed") return;
      if (change.type === "document-replaced") this.setActiveDocument(document.id);
      // FilePersistence is another document subscriber. Let it update dirty state first.
      queueMicrotask(() => this.schedule());
    });
    this.unsubscribePersistence = filePersistence.subscribe(() => {
      const persistence = filePersistence.getSnapshot();
      if (persistence.savedAt && persistence.savedAt !== this.lastSavedAt && !persistence.dirty) {
        this.cancelPending();
        const savedDocumentId = documentModel.getDocument().id;
        void this.enqueue(() => deleteRecovery(savedDocumentId)).catch(() => { /* fail() reported it. */ });
        this.publish({ ...this.state, status: "idle" });
      } else if (persistence.dirty) this.schedule();
      else this.cancelPending();
      this.lastSavedAt = persistence.savedAt;
    });
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("vectora-recovery-owners");
      this.channel.onmessage = (event: MessageEvent<PeerMessage>) => {
        const message = event.data;
        if (!message || typeof message.tabId !== "string" || message.tabId === this.tabId || typeof message.documentId !== "string") return;
        if (message.type === "release") this.peers.delete(message.tabId);
        else if (message.type === "heartbeat" || message.type === "claim") {
          this.peers.set(message.tabId, { documentId: message.documentId, seenAt: Date.now() });
          if (message.type === "claim") this.announce();
        }
        this.updateConflict();
      };
      this.announce("claim");
      this.heartbeatTimer = setInterval(() => { this.announce(); this.updateConflict(); }, HEARTBEAT_MS);
    }
    if (filePersistence.isDirty()) this.schedule();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.cancelPending();
    this.announce("release");
    this.channel?.close();
    this.channel = null;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.unsubscribeDocument?.();
    this.unsubscribePersistence?.();
    this.unsubscribeDocument = this.unsubscribePersistence = null;
    this.warning = null;
  }

  setEnabled(enabled: boolean): void {
    try { localStorage.setItem(PREFERENCE_KEY, String(enabled)); }
    catch (error) { console.warn("Recovery preference could not be stored.", error); }
    if (!enabled) this.cancelPending();
    this.publish({ ...this.state, enabled, status: "idle" });
    if (enabled) this.schedule();
  }

  /** Called only after a New/Open transition actually replaced the old drawing. */
  abandon(documentId: string): Promise<void> {
    return this.enqueue(() => deleteRecovery(documentId));
  }

  clearAll(): Promise<void> {
    this.cancelPending();
    this.publish({ ...this.state, status: "idle" });
    return this.enqueue(() => clearRecoveries());
  }
}

export const recoveryController = new RecoveryController();
