import { useSyncExternalStore } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { documentModel } from "../../document/DocumentModel";
import type { ImageEntity } from "../../document/types";
import { executeCommand, UpdateEntitiesCommand } from "../../document/History";
import { validateRasterSettings, type RasterSettings } from "../../cam/rasterCamEngine";
import { importRasterImage } from "../../io/rasterImport";
import { useVectorStore } from "../../store/useVectorStore";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { formatCount } from "../ui/terminology";
import { CamNumber } from "./CamNumber";

interface RasterPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenCam: () => void;
}

export function RasterPanel({ open, ...props }: RasterPanelProps) {
  return <AnimatePresence>{open && <RasterPanelContent {...props} />}</AnimatePresence>;
}

function RasterPanelContent({ onClose, onOpenCam }: Omit<RasterPanelProps, "open">) {
  const snapshot = useSyncExternalStore(
    (notify) => documentModel.subscribe(() => notify()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const position = useVectorStore((state) => state.panelPositions.raster);
  const setPanelPosition = useVectorStore((state) => state.setPanelPosition);
  const dragControls = useDragControls();
  const selectedImages = [...snapshot.selection].map((id) => snapshot.entities.get(id))
    .filter((entity): entity is ImageEntity => entity?.type === "image");
  const rasterTargets = selectedImages.filter((entity) => !entity.locked && !snapshot.layers.find((layer) => layer.id === entity.layerId)?.locked);
  const raster = rasterTargets[0]?.raster;
  const updateRaster = (patch: Partial<RasterSettings>) => {
    if (!rasterTargets.length) return;
    try {
      const next = rasterTargets.map((image) => ({ ...image, intent: "raster" as const, raster: { ...image.raster, ...patch } }));
      next.forEach((image) => validateRasterSettings(image.raster));
      executeCommand(new UpdateEntitiesCommand(rasterTargets, next, "Raster engrave settings"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check the raster settings.");
    }
  };

  return (
    <motion.section className="utility-panel surface cam-panel raster-panel" role="dialog" aria-label="Raster engrave"
      style={{ x: position.x, y: position.y }}
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
      drag dragControls={dragControls} dragListener={false} dragMomentum={false}
      onDragEnd={(_event, info) => setPanelPosition("raster", { x: position.x + info.offset.x, y: position.y + info.offset.y })}
      onPointerDown={(event) => {
        event.stopPropagation();
        if ((event.target as Element).closest(".drag-handle")) dragControls.start(event);
      }}>
      <header className="cam-head drag-handle">
        <div><span className="eyebrow">Bitmap to laser</span><h2>Raster engrave</h2></div>
        <Tooltip content="Close panel" placement="left"><button type="button" className="panel-close" aria-label="Close panel"
          onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={20} /></button></Tooltip>
      </header>
      <div className="cam-body cam-tab-panel">
      <div className="cam-section">
        <div className="cam-section-title"><span>Bitmap source</span></div>
        <label className="cam-select cam-raster-import"><span>Import photo</span><input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) void importRasterImage(file).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The image could not be imported."));
        }} /></label>
        <p className="cam-pocket-help">Import PNG, JPEG, or WebP artwork for direct laser engraving.</p>
      </div>

      <div className="cam-section">
        <div className="cam-section-title"><span>Raster engrave</span><small>Direct bitmap</small></div>

        {raster ? <>
          <button type="button" className="cam-primary" onClick={() => updateRaster({})}>Apply raster engrave</button>
          <p className="cam-pocket-help">Editing {formatCount(rasterTargets.length, "selected image")}. Values show the first image. Settings are saved with the drawing.</p>
          <label className="cam-select"><span>Algorithm</span><select value={raster.algorithm} onChange={(event) => updateRaster({ algorithm: event.target.value as RasterSettings["algorithm"] })}>
            <option value="floyd-steinberg">Floyd-Steinberg</option><option value="jarvis-judice-ninke">Jarvis-Judice-Ninke</option><option value="threshold">Simple threshold</option>
          </select></label>
          <label className="cam-select"><span>Scan axis</span><select value={raster.scanAngle} onChange={(event) => updateRaster({ scanAngle: Number(event.target.value) as 0 | 90 })}>
            <option value={0}>Horizontal · X / 0°</option><option value={90}>Vertical · Y / 90°</option>
          </select></label>
          <label className="cam-tab-toggle cam-tab-fields"><span><strong>Bidirectional scan</strong><small>Alternate scan direction on successive rows</small></span><input type="checkbox" checked={raster.bidirectional} onChange={(event) => updateRaster({ bidirectional: event.target.checked })} /></label>
          <div className="cam-fields-grid">
            <CamNumber label="Resolution" value={raster.dpi} min={1} max={2540} suffix="DPI" onChange={(dpi) => updateRaster({ dpi })} />
            <CamNumber label="Line interval" value={Number((25.4 / raster.dpi).toFixed(6))} min={0.01} step={0.01} suffix="mm" onChange={(interval) => updateRaster({ dpi: 25.4 / interval })} />
            <CamNumber label="Overscan" value={raster.overscan} min={0} step={0.5} suffix="mm" onChange={(overscan) => updateRaster({ overscan })} />
            <CamNumber label="Minimum burn power" value={raster.minPower} min={0} max={raster.maxPower - 1} suffix="S" onChange={(minPower) => updateRaster({ minPower })} />
            <CamNumber label="Maximum burn power" value={raster.maxPower} min={raster.minPower + 1} max={1000} suffix="S" onChange={(maxPower) => updateRaster({ maxPower })} />
            <CamNumber label="Power levels" value={raster.levels} min={2} max={256} suffix="#" onChange={(levels) => updateRaster({ levels })} />
            <CamNumber label="Contrast" value={raster.contrast} min={0} max={10} step={0.1} suffix="×" onChange={(contrast) => updateRaster({ contrast })} />
            <CamNumber label="Gamma" value={raster.gamma} min={0.1} max={10} step={0.1} suffix="γ" onChange={(gamma) => updateRaster({ gamma })} />
            <CamNumber label="Threshold" disabled={raster.levels !== 2} value={raster.threshold} min={0} max={255} suffix="grey" onChange={(threshold) => updateRaster({ threshold })} />
            <CamNumber label="Raster feed" value={raster.feedRate} min={1} suffix="mm/min" onChange={(feedRate) => updateRaster({ feedRate })} />
          </div>
          <p className="cam-pocket-help">White pixels and overscan use S0. Scan axes follow image rotation. GRBL output requires laser mode ($32=1); overscan must fit inside the bed. The preview shows the dithered power map.</p>
        </> : <p className="cam-pocket-help">{selectedImages.length ? "Unlock the selected bitmap or its layer to edit raster engraving settings." : "Import or select a bitmap on the canvas to configure raster engraving."}</p>}
      </div>
      </div>
      <footer className="cam-actions">
        <button type="button" className="primary" onClick={onOpenCam}>Open Manufacture</button>
      </footer>
      <div className="drag-note"><i /> Drag header to move</div>
    </motion.section>
  );
}
