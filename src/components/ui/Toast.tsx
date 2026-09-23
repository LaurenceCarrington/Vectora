import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { Tooltip } from "./Tooltip";

export type ToastTone = "error" | "warning" | "info" | "success";

export interface ToastOptions {
  readonly tone?: ToastTone;
  readonly durationMs?: number;
}

export interface ToastMessage {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
}

type ToastListener = () => void;

const DEFAULT_DURATION_MS = 4_500;
const MAX_VISIBLE_TOASTS = 4;

let sequence = 0;
let snapshot: readonly ToastMessage[] = Object.freeze([]);
const listeners = new Set<ToastListener>();
const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    globalThis.clearTimeout(timer);
    timers.delete(id);
  }
  const next = snapshot.filter((item) => item.id !== id);
  if (next.length === snapshot.length) return;
  snapshot = Object.freeze(next);
  emit();
}

function show(message: string, options: ToastOptions = {}): string {
  const normalized = message.trim();
  if (!normalized) throw new RangeError("A toast message cannot be empty.");
  const id = `toast-${Date.now().toString(36)}-${sequence.toString(36)}`;
  sequence += 1;
  const item = Object.freeze({
    id,
    message: normalized,
    tone: options.tone ?? "info",
  });
  snapshot = Object.freeze([...snapshot, item].slice(-MAX_VISIBLE_TOASTS));
  emit();

  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  if (durationMs > 0) {
    timers.set(id, globalThis.setTimeout(() => dismiss(id), durationMs));
  }
  return id;
}

export const toast = Object.freeze({
  show,
  dismiss,
  error: (message: string, durationMs?: number) => show(message, {
    tone: "error",
    ...(durationMs === undefined ? {} : { durationMs }),
  }),
  warning: (message: string, durationMs?: number) => show(message, {
    tone: "warning",
    ...(durationMs === undefined ? {} : { durationMs }),
  }),
  info: (message: string, durationMs?: number) => show(message, {
    tone: "info",
    ...(durationMs === undefined ? {} : { durationMs }),
  }),
  success: (message: string, durationMs?: number) => show(message, {
    tone: "success",
    ...(durationMs === undefined ? {} : { durationMs }),
  }),
  subscribe(listener: ToastListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): readonly ToastMessage[] {
    return snapshot;
  },
});

const ICONS = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
} as const;

export function ToastViewport() {
  const messages = useSyncExternalStore(
    toast.subscribe,
    toast.getSnapshot,
    toast.getSnapshot,
  );

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {messages.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <motion.div
              key={item.id}
              className={`vectora-toast is-${item.tone}`}
              role={item.tone === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 18, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 460, damping: 34 }}
            >
              <span className="toast-icon" aria-hidden="true"><Icon size={17} /></span>
              <span className="toast-copy">{item.message}</span>
              <Tooltip content="Dismiss" placement="left">
                <button type="button" onClick={() => toast.dismiss(item.id)} aria-label="Dismiss notification">
                  <X size={15} />
                </button>
              </Tooltip>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
