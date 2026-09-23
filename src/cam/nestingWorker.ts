import { nestEntities, type NestingOptions } from "./nestingEngine";
import type { Entity } from "../document/types";

// A separate worker is created for each preview; terminating it cancels stale work.
self.onmessage = (event: MessageEvent<{ entities: readonly Entity[]; options: NestingOptions }>) => {
  try {
    const result = nestEntities(event.data.entities, event.data.options, (progress) => {
      self.postMessage({ type: "progress", progress });
    });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : "Nesting failed." });
  }
};
