/// <reference lib="webworker" />

import { traceBinaryImage } from "./autoTracer";
import { traceCenterlines } from "./centerlineTracer";
import { preprocessImageData } from "./imagePreprocess";
import type { VectorizerWorkerRequest, VectorizerWorkerResponse } from "./workerProtocol";

type WorkerScope = {
  onmessage: ((event: MessageEvent<VectorizerWorkerRequest>) => void) | null;
  postMessage(message: VectorizerWorkerResponse, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
let source: ImageData | null = null;
let sourceRevision = -1;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "set-source") {
    source = message.imageData;
    sourceRevision = message.revision;
    return;
  }

  try {
    if (!source || sourceRevision !== message.revision) throw new Error("The vectorizer source image is no longer available.");
    const startedAt = performance.now();
    const preprocessed = preprocessImageData(source, message.preprocess);
    const result = message.mode === "centerline"
      ? traceCenterlines(preprocessed.mask, preprocessed.width, preprocessed.height, {
          minimumPathLength: Math.max(2, message.trace.minimumPathArea ?? 2),
          ...(message.trace.simplifyTolerance === undefined
            ? {}
            : { simplifyTolerance: message.trace.simplifyTolerance }),
          ...(message.trace.maximumPaths === undefined
            ? {}
            : { maximumPaths: message.trace.maximumPaths }),
          ...(message.trace.maximumEdges === undefined
            ? {}
            : { maximumEdges: message.trace.maximumEdges }),
        })
      : (() => {
          const contours = traceBinaryImage(preprocessed.mask, preprocessed.width, preprocessed.height, message.trace);
          return message.mode === "fill"
            ? Object.freeze({ ...contours, mode: "fill" as const })
            : contours;
        })();
    const response: VectorizerWorkerResponse = {
      type: "result",
      requestId: message.requestId,
      revision: message.revision,
      preview: preprocessed.imageData,
      foregroundPixels: preprocessed.foregroundPixels,
      result,
      elapsedMs: performance.now() - startedAt,
    };
    scope.postMessage(response, [preprocessed.imageData.data.buffer]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      requestId: message.requestId,
      revision: message.revision,
      message: error instanceof Error ? error.message : "Image tracing failed.",
    });
  }
};

export {};
