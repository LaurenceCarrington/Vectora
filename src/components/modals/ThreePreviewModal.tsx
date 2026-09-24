import { DEFAULT_POCKET_SETTINGS, usePocketSettingsStore } from "../../store/usePocketSettingsStore";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Box, Download, Rotate3D, X } from "lucide-react";
import { documentUnitToMillimetres, ThreePreviewEngine, type ThreePreviewStats } from "../../3d/threeEngine";
import { documentModel } from "../../document/DocumentModel";
import type { PreviewMaterialKind } from "../../document/types";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { formatCount } from "../ui/terminology";
import { useCamCalibrationStore } from "../../store/useCamCalibrationStore";

const MATERIALS: readonly { readonly value: PreviewMaterialKind; readonly label: string }[] = [
  { value: "wood", label: "Birch plywood" },
  { value: "clear-acrylic", label: "Clear acrylic" },
  { value: "dark-acrylic", label: "Dark acrylic" },
  { value: "cardboard", label: "Cardboard" },
  { value: "aluminum", label: "Anodised aluminium" },
];

const EMPTY_STATS: ThreePreviewStats = Object.freeze({
  closedProfiles: 0,
  surfaceFeatures: 0,
  openCutPaths: 0,
  assemblies: 0,
  triangles: 0,
});

function firstBoxThickness(document: ReturnType<typeof documentModel.getDocument>): number | null {
  for (const entity of document.entities.values()) {
    if (entity.metadata?.kind === "box-panel") return entity.metadata.materialThickness;
  }
  return null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ThreePreviewModal({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const documentSnapshot = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const pocket = usePocketSettingsStore((state) => state.byDocument[documentSnapshot.id] ?? DEFAULT_POCKET_SETTINGS);
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ThreePreviewEngine | null>(null);
  const openCutWarningShownRef = useRef(false);
  const activeLayer = documentSnapshot.layers.find((layer) => layer.id === documentSnapshot.activeLayerId);
  const generatedBoxThickness = firstBoxThickness(documentSnapshot);
  const calibrationInput = useCamCalibrationStore((state) => state.inputsByDocument[documentSnapshot.id] ?? "");
  const pxPerMm = Number(calibrationInput);
  const physicalScale = useMemo(() => (
    Number.isFinite(pxPerMm) && pxPerMm > 0 ? { pxPerMm } : undefined
  ), [pxPerMm]);
  const unitScale = documentSnapshot.units !== "px" || physicalScale
    ? documentUnitToMillimetres(documentSnapshot.units, physicalScale) : null;
  const [material, setMaterial] = useState<PreviewMaterialKind>(activeLayer?.material?.kind ?? "wood");
  const [thickness, setThickness] = useState(
    activeLayer?.material?.thicknessMm ??
    (generatedBoxThickness && unitScale ? generatedBoxThickness * unitScale : 3),
  );
  const [exploded, setExploded] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stats, setStats] = useState<ThreePreviewStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const layerThickness = activeLayer?.material?.thicknessMm;
    if (layerThickness !== undefined && Number.isFinite(layerThickness) && layerThickness > 0) {
      setThickness(layerThickness);
    } else if (generatedBoxThickness && unitScale) {
      setThickness(generatedBoxThickness * unitScale);
    }
  }, [activeLayer?.id, activeLayer?.material?.thicknessMm, generatedBoxThickness, unitScale]);

  useEffect(() => {
    if (!open || !viewportRef.current) return;
    try {
      const engine = new ThreePreviewEngine(viewportRef.current);
      engineRef.current = engine;
      engine.setAutoRotate(autoRotate);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WebGL could not start on this device.");
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!open || !engine) return;
    try {
      const nextStats = engine.setDocument(documentSnapshot, {
        material,
        thicknessMm: thickness,
        pocketDepthMm: pocket.depth,
        pocketToolDiameterMm: pocket.toolDiameter,
        explodedFactor: exploded,
        ...(physicalScale ? { physicalScale } : {}),
      });
      setStats(nextStats);
      if (nextStats.openCutPaths > 0 && !openCutWarningShownRef.current) {
        toast.error("Open cut paths cannot form solid material and are highlighted in red.", 7_000);
        openCutWarningShownRef.current = true;
      } else if (nextStats.openCutPaths === 0) {
        openCutWarningShownRef.current = false;
      }
      setError(null);
    } catch (cause) {
      setStats(EMPTY_STATS);
      setError(cause instanceof Error ? cause.message : "The 3D model could not be built.");
    }
  }, [documentSnapshot, material, open, thickness, physicalScale, pocket]);

  useEffect(() => {
    engineRef.current?.setExplodedFactor(exploded);
  }, [exploded]);

  useEffect(() => {
    engineRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  const exportModel = (format: "stl" | "obj") => {
    try {
      const blob = engineRef.current?.exportModel(format);
      if (!blob) throw new Error("The 3D preview is not ready.");
      const safeTitle = documentSnapshot.title.trim().replace(/[^a-z0-9_-]+/gi, "-") || "vectora-model";
      downloadBlob(blob, `${safeTitle}.${format}`);
      toast.success(`Exported ${format.toUpperCase()} model.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The 3D model could not be exported.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="three-preview-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.section
            className="three-preview-modal surface"
            role="dialog"
            aria-modal="true"
            aria-label="3D preview"
            initial={{ opacity: 0, y: 18, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="three-preview-head">
              <div><span className="eyebrow">Visual assembly</span><h2>3D preview</h2></div>
              <div className="three-preview-summary">
                <span>{formatCount(stats.closedProfiles, "cut profile")}</span>
                <span>{formatCount(stats.surfaceFeatures, "surface feature")}</span>
                {stats.openCutPaths > 0 && <span>{formatCount(stats.openCutPaths, "open cut")}</span>}
                <i />
                <span>{stats.assemblies} box {stats.assemblies === 1 ? "assembly" : "assemblies"}</span>
              </div>
              <Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip>
            </header>
            <div className="three-preview-body">
              <div className="three-viewport-shell">
                <div ref={viewportRef} className="three-viewport" />
                <div className="three-viewport-hint"><Rotate3D size={14} /> Drag to orbit · scroll to zoom · right-drag to pan</div>
                {error && <div className="three-preview-error"><strong>Preview unavailable</strong><span>{error}</span></div>}
                {!error && stats.triangles === 0 && (
                  <div className="three-preview-empty"><Box size={28} /><strong>No preview geometry</strong><span>Add a cut, vector engrave, or score path to build a 3D preview.</span></div>
                )}
              </div>
              <aside className="three-controls">
                <div className="three-controls-scroll">
                <p className="three-preview-limit-note">Visual guide only. This is not a complete stock-removal simulation or a machine-job check; review Manufacture before cutting.</p>
                <section>
                  <span className="three-section-label">Material</span>
                  <label className="three-select-field">
                    <span>Surface</span>
                    <select value={material} onChange={(event) => setMaterial(event.target.value as PreviewMaterialKind)}>
                      {MATERIALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                </section>
                <section>
                  <div className="three-control-heading"><span>Thickness</span><output>{thickness.toFixed(1)} mm</output></div>
                  <input type="range" min="1" max="25" step="0.5" value={thickness} onChange={(event) => setThickness(Number(event.target.value))} aria-label="Material thickness in millimetres" />
                </section>
                <section className={!stats.assemblies ? "is-disabled" : ""}>
                  <div className="three-control-heading"><span>Exploded assembly</span><output>{Math.round(exploded * 100)}%</output></div>
                  <input type="range" min="0" max="1" step="0.01" value={exploded} disabled={!stats.assemblies} onChange={(event) => setExploded(Number(event.target.value))} aria-label="Exploded assembly percentage" />
                  {!stats.assemblies && <small>Available for complete six-panel box layouts.</small>}
                </section>
                {[...documentSnapshot.entities.values()].some((entity) => entity.intent === "raster") && <p className="cam-pocket-help">Raster engrave uses a power-map surface preview. Images without a containing cut profile use an inferred flat backing; no stock removal is simulated.</p>}
                {[...documentSnapshot.entities.values()].some((entity) => entity.intent === "pocket") && <section>
                  <div className="three-control-heading"><span>Pocket depth</span><output>{pocket.depth} mm</output></div>
                  <small>Set pocket depth in Manufacture. Pockets without a containing cut outline use an inferred rectangular stock blank.</small>
                </section>}
                <label className="three-toggle-row">
                  <span><strong>Auto-rotate</strong><small>Continuously orbit the model</small></span>
                  <input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />
                  <i />
                </label>
                </div>
                <section className="three-export-section">
                  <span className="three-section-label">Export model</span>
                  <div>
                    <button disabled={!stats.triangles} onClick={() => exportModel("stl")}><Download size={15} /> Export STL</button>
                    <button disabled={!stats.triangles} onClick={() => exportModel("obj")}><Download size={15} /> Export OBJ</button>
                  </div>
                </section>
                <div className="three-preview-note"><i /> Geometry exports in millimetres</div>
              </aside>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
