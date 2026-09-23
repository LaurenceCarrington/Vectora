import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Image as ImageIcon, ScanLine, X } from "lucide-react";
import { documentModel } from "../../document/DocumentModel";
import { AddLayerWithEntitiesCommand, executeCommand } from "../../document/History";
import type { Layer } from "../../document/types";
import { useVectorStore } from "../../store/useVectorStore";
import { Tooltip } from "../ui/Tooltip";
import { formatCount } from "../ui/terminology";
import { vectoraRenderColors } from "../../design/vectoraRenderColors";
import {
  traceLoopToSvgPath,
  traceResultToPolylineEntities,
} from "../../vectorizer/autoTracer";
import {
  centerlinePathToSvgPath,
  centerlineResultToPolylineEntities,
} from "../../vectorizer/centerlineTracer";
import { decodeRasterFile } from "../../vectorizer/imagePreprocess";
import type {
  VectorizerWorkerRequest,
  VectorizerWorkerResponse,
  VectorizerTraceMode,
  VectorizerTraceResult,
} from "../../vectorizer/workerProtocol";

export interface VectorizerModalProps {
  readonly file: File | null;
  readonly onClose: () => void;
}

const TRACE_LAYER_DEFAULTS = Object.freeze({
  outline: Object.freeze({
    name: "Outline Trace",
    intent: "engrave",
    color: vectoraRenderColors.operation.engrave,
  }),
  centerline: Object.freeze({
    name: "Centreline trace",
    intent: "score",
    color: vectoraRenderColors.operation.score,
  }),
  fill: Object.freeze({
    name: "Filled trace",
    intent: "engrave",
    color: vectoraRenderColors.operation.engrave,
  }),
} as const satisfies Record<
  VectorizerTraceMode,
  Readonly<Pick<Layer, "name" | "intent" | "color">>
>);

function uniqueLayerId(): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `traced-image-${token}`;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="vectorizer-slider">
      <span><strong>{label}</strong><output>{value}</output></span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function VectorizerModal({ file, onClose }: VectorizerModalProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<ImageData | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [threshold, setThreshold] = useState(128);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [invert, setInvert] = useState(false);
  const [despeckleSize, setDespeckleSize] = useState(8);
  const [simplifyTolerance, setSimplifyTolerance] = useState(1.25);
  const [curveFitting, setCurveFitting] = useState(0.65);
  const [cornerSensitivity, setCornerSensitivity] = useState(0.55);
  const [insertionScale, setInsertionScale] = useState(0.25);
  const [showProcessed, setShowProcessed] = useState(true);
  const [traceMode, setTraceMode] = useState<VectorizerTraceMode>("outline");
  const [traceResult, setTraceResult] = useState<VectorizerTraceResult | null>(null);
  const [foregroundPixels, setForegroundPixels] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const sourceRevisionRef = useRef(0);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../../vectorizer/vectorizer.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<VectorizerWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestIdRef.current || response.revision !== sourceRevisionRef.current) return;
      setProcessing(false);
      if (response.type === "error") {
        setError(response.message);
        return;
      }
      setError(null);
      setTraceResult(response.result);
      setForegroundPixels(response.foregroundPixels);
      setElapsedMs(response.elapsedMs);
      const canvas = previewCanvasRef.current;
      if (canvas) {
        canvas.width = response.preview.width;
        canvas.height = response.preview.height;
        canvas.getContext("2d")?.putImageData(response.preview, 0, 0);
      }
    };
    worker.onerror = () => {
      setProcessing(false);
      setError("The image tracing worker stopped unexpectedly.");
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Invalidate an in-flight trace before beginning the asynchronous decode.
    // Otherwise an old worker response can become insertable under the new
    // file name while the replacement bitmap is still decoding.
    requestIdRef.current += 1;
    setSourceRevision(0);
    const canvas = previewCanvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (!file) {
      setSourceUrl(null);
      setSourceImage(null);
      setTraceResult(null);
      setProcessing(false);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSourceUrl(objectUrl);
    setSourceImage(null);
    setTraceResult(null);
    setProcessing(true);
    setError(null);
    let cancelled = false;
    void decodeRasterFile(file).then((imageData) => {
      if (cancelled) return;
      setSourceImage(imageData);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setProcessing(false);
      setError(reason instanceof Error ? reason.message : "The bitmap could not be decoded.");
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!sourceImage || !workerRef.current) return;
    const revision = sourceRevisionRef.current + 1;
    sourceRevisionRef.current = revision;
    const workerImage = new ImageData(
      new Uint8ClampedArray(sourceImage.data),
      sourceImage.width,
      sourceImage.height,
    );
    const message: VectorizerWorkerRequest = { type: "set-source", revision, imageData: workerImage };
    workerRef.current.postMessage(message, [workerImage.data.buffer]);
    setSourceRevision(revision);
  }, [sourceImage]);

  useEffect(() => {
    if (!sourceImage || sourceRevision === 0 || !workerRef.current) return;
    const timeout = window.setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setProcessing(true);
      const message: VectorizerWorkerRequest = {
        type: "trace",
        requestId,
        revision: sourceRevision,
        mode: traceMode,
        preprocess: { threshold, brightness, contrast, invert, despeckleSize },
        trace: {
          simplifyTolerance,
          curveFitting,
          cornerSensitivity,
          minimumPathArea: Math.max(2, despeckleSize),
          maximumPaths: 5_000,
        },
      };
      workerRef.current?.postMessage(message);
    }, 90);
    return () => window.clearTimeout(timeout);
  }, [
    brightness,
    contrast,
    cornerSensitivity,
    curveFitting,
    despeckleSize,
    invert,
    simplifyTolerance,
    sourceImage,
    sourceRevision,
    threshold,
    traceMode,
  ]);

  const previewPath = useMemo(
    () => traceResult
      ? traceResult.mode === "centerline"
        ? traceResult.paths.map(centerlinePathToSvgPath).join(" ")
        : traceResult.loops.map(traceLoopToSvgPath).join(" ")
      : "",
    [traceResult],
  );
  const pathCount = traceResult?.mode === "centerline"
    ? traceResult.paths.length
    : traceResult?.loops.length ?? 0;
  const selectTraceMode = (mode: VectorizerTraceMode) => {
    if (mode === traceMode) return;
    requestIdRef.current += 1;
    setTraceResult(null);
    setProcessing(true);
    setTraceMode(mode);
  };

  const insertVectors = () => {
    if (!traceResult || pathCount === 0) return;
    if (!Number.isFinite(insertionScale) || insertionScale <= 0) {
      setError("Insertion scale must be greater than zero.");
      return;
    }
    try {
      const document = documentModel.getDocument();
      const layerId = uniqueLayerId();
      const layerDefaults = TRACE_LAYER_DEFAULTS[traceResult.mode];
      const layer: Layer = {
        id: layerId,
        ...layerDefaults,
        visible: true,
        locked: false,
        order: Math.max(-1, ...document.layers.map((candidate) => candidate.order)) + 1,
      };
      const viewport = useVectorStore.getState().viewport;
      const entityOptions = {
        layerId,
        intent: layer.intent,
        origin: { x: -viewport.x / viewport.zoom, y: viewport.y / viewport.zoom },
        scale: insertionScale,
        curveSteps: 5,
        strokeWidth: traceResult.mode === "fill" ? 0 : 1,
        fillColor: traceResult.mode === "fill" ? layer.color : null,
      } as const;
      const tracedEntities = traceResult.mode === "centerline"
        ? centerlineResultToPolylineEntities(traceResult, entityOptions)
        : traceResultToPolylineEntities(traceResult, entityOptions);
      // Normalize at the persistence boundary as well as at tracer creation.
      // This prevents a future tracer default or active Cut layer from leaking
      // into imported raster geometry.
      const entities = tracedEntities.map((entity) => ({
        ...entity,
        layerId: layer.id,
        intent: layer.intent,
      }));
      if (entities.length === 0) return;
      executeCommand(new AddLayerWithEntitiesCommand(
        layer,
        entities,
        traceResult.mode === "centerline"
          ? "Insert centreline trace"
          : traceResult.mode === "fill"
            ? "Insert filled trace"
            : "Insert outline trace",
      ));
      useVectorStore.getState().setActiveTool("select");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The traced vectors could not be inserted.");
    }
  };

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          className="vectorizer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.section
            className="vectorizer-modal surface"
            role="dialog"
            aria-modal="true"
            aria-label="Trace image"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="vectorizer-head">
              <div>
                <span className="eyebrow">Raster to vector</span>
                <h2>Trace image</h2>
                <p>{file.name}</p>
              </div>
              <Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip>
            </header>

            <div className="vectorizer-body">
              <section className="vectorizer-column">
                <div className="vectorizer-pane-head">
                  <span><ImageIcon size={15} /> Input</span>
                  <div className="vectorizer-view-toggle">
                    <button className={!showProcessed ? "is-active" : ""} onClick={() => setShowProcessed(false)}>Original</button>
                    <button className={showProcessed ? "is-active" : ""} onClick={() => setShowProcessed(true)}>Binary</button>
                  </div>
                </div>
                <div className="vectorizer-preview raster-preview">
                  {sourceUrl && <img className={showProcessed ? "is-hidden" : ""} src={sourceUrl} alt="Original bitmap" />}
                  <canvas ref={previewCanvasRef} className={!showProcessed ? "is-hidden" : ""} aria-label="Preprocessed bitmap preview" />
                  {!sourceImage && !error && <span className="vectorizer-loading">Decoding image…</span>}
                </div>
                <div className="vectorizer-controls">
                  <Slider label="Threshold" value={threshold} min={0} max={255} onChange={setThreshold} />
                  <Slider label="Brightness" value={brightness} min={-100} max={100} onChange={setBrightness} />
                  <Slider label="Contrast" value={contrast} min={-100} max={100} onChange={setContrast} />
                  <Slider label="Noise reduction" value={despeckleSize} min={0} max={64} onChange={setDespeckleSize} />
                  <label className="vectorizer-check">
                    <input type="checkbox" checked={invert} onChange={(event) => setInvert(event.target.checked)} />
                    <span>Invert colours</span>
                  </label>
                </div>
              </section>

              <section className="vectorizer-column">
                <div className="vectorizer-pane-head">
                  <span>
                    <ScanLine size={15} />
                    Vector preview
                    <small>{processing ? "Tracing…" : formatCount(pathCount, "path")}</small>
                  </span>
                  <div className="vectorizer-view-toggle vectorizer-trace-toggle" role="group" aria-label="Trace mode">
                    <button className={traceMode === "outline" ? "is-active" : ""} onClick={() => selectTraceMode("outline")}>Outline</button>
                    <button className={traceMode === "centerline" ? "is-active" : ""} onClick={() => selectTraceMode("centerline")}>Centreline</button>
                    <button className={traceMode === "fill" ? "is-active" : ""} onClick={() => selectTraceMode("fill")}>Fill</button>
                  </div>
                </div>
                <div className="vectorizer-preview vector-preview">
                  {traceResult && pathCount > 0 ? (
                    <svg viewBox={`0 0 ${traceResult.width} ${traceResult.height}`} aria-label="Generated vector path preview">
                      <defs>
                        <pattern id="vectorizer-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                          <path d="M24 0H0V24" fill="none" stroke="var(--v-color-grid-minor)" strokeWidth="1" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#vectorizer-grid)" />
                      <path
                        d={previewPath}
                        fill={traceMode === "fill" ? TRACE_LAYER_DEFAULTS.fill.color : "none"}
                        fillRule="evenodd"
                        stroke={traceMode === "fill" ? "none" : TRACE_LAYER_DEFAULTS[traceMode].color}
                        strokeWidth="1.35"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : (
                    <span className="vectorizer-loading">{processing ? traceMode === "centerline" ? "Tracing centreline…" : traceMode === "fill" ? "Building filled shapes…" : "Finding contours…" : "No traceable paths"}</span>
                  )}
                </div>
                <div className="vectorizer-controls vector-controls">
                  <Slider label="Path simplification" value={simplifyTolerance} min={0} max={5} step={0.05} onChange={setSimplifyTolerance} />
                  {traceMode !== "centerline" && <Slider label="Curve fitting" value={curveFitting} min={0} max={1} step={0.05} onChange={setCurveFitting} />}
                  {traceMode !== "centerline" && <Slider label="Corner sensitivity" value={cornerSensitivity} min={0} max={1} step={0.05} onChange={setCornerSensitivity} />}
                  <label className="vectorizer-scale">
                    <span>Insertion scale</span>
                    <span><input type="number" min="0.01" step="0.05" value={insertionScale} onChange={(event) => setInsertionScale(Number(event.target.value))} /> {documentModel.getDocument().units}/px</span>
                  </label>
                </div>
              </section>
            </div>

            <footer className="vectorizer-footer">
              <div className={error ? "vectorizer-status is-error" : "vectorizer-status"}>
                {error ?? `${foregroundPixels.toLocaleString()} source pixels · ${traceResult?.pointCount.toLocaleString() ?? 0} ${traceMode === "centerline" ? "skeleton nodes" : "fitted points"} · ${Math.round(elapsedMs)} ms`}
              </div>
              <div>
                <button onClick={onClose}>Cancel</button>
                <button className="primary" disabled={processing || Boolean(error) || pathCount === 0 || !Number.isFinite(insertionScale) || insertionScale <= 0} onClick={insertVectors}>
                  Insert vectors
                </button>
              </div>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
