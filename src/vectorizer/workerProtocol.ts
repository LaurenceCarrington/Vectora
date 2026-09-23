import type { AutoTraceOptions, AutoTraceResult } from "./autoTracer";
import type { CenterlineTraceResult } from "./centerlineTracer";
import type { ImagePreprocessOptions } from "./imagePreprocess";

export type VectorizerTraceMode = "outline" | "centerline" | "fill";
export type VectorizerTraceResult = AutoTraceResult | CenterlineTraceResult;

export type VectorizerWorkerRequest =
  | {
      readonly type: "set-source";
      readonly revision: number;
      readonly imageData: ImageData;
    }
  | {
      readonly type: "trace";
      readonly requestId: number;
      readonly revision: number;
      readonly mode: VectorizerTraceMode;
      readonly preprocess: ImagePreprocessOptions;
      readonly trace: AutoTraceOptions;
    };

export type VectorizerWorkerResponse =
  | {
      readonly type: "result";
      readonly requestId: number;
      readonly revision: number;
      readonly preview: ImageData;
      readonly foregroundPixels: number;
      readonly result: VectorizerTraceResult;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "error";
      readonly requestId: number;
      readonly revision: number;
      readonly message: string;
    };
