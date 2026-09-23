import { AnimatePresence, motion, type PanInfo, useDragControls } from "framer-motion";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { defaultWorkArea, documentModel } from "../../document/DocumentModel";
import {
  ALL_OSNAP_TYPES,
  DEFAULT_PREFERENCES,
  gridSizeInDocumentUnits,
  useVectorStore,
  type OsnapType,
} from "../../store/useVectorStore";
import { Tooltip } from "../ui/Tooltip";
import { recoveryController } from "../../recovery/recoveryController";
import { toast } from "../ui/Toast";

const OSNAP_LABELS: Readonly<Record<OsnapType, { readonly title: string; readonly description: string }>> = {
  endpoint: { title: "Endpoint", description: "Vertices and line or arc ends" },
  midpoint: { title: "Midpoint", description: "Halfway points on segments and arcs" },
  center: { title: "Centre", description: "Circle, arc, and radial centres" },
  intersection: { title: "Intersection", description: "Line-line and line-circle crossings" },
};

function Toggle({ checked, label, onChange }: { readonly checked: boolean; readonly label: string; readonly onChange: () => void }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    ><i /></button>
  );
}

function Setting({ title, description, children }: { readonly title: string; readonly description: string; readonly children: ReactNode }) {
  return (
    <div className="preference-setting">
      <div><h3>{title}</h3><p>{description}</p></div>
      <div className="preference-control">{children}</div>
    </div>
  );
}

function NumberInput({ value, min, max, step = 1, suffix, label, disabled = false, onChange }: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="preference-number">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}

function RangeInput({ value, min, max, step = 1, suffix, label, onChange }: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix: string;
  readonly label: string;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="preference-range">
      <span className="sr-only">{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
      <output>{value}{suffix === "°" || suffix === "%" ? "" : " "}{suffix}</output>
    </label>
  );
}

function SectionHeading({ label, title, description }: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="preference-section-head">
      <span>{label}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function PreferencesModal({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const preferences = useVectorStore((state) => state.preferences);
  const updateDrafting = useVectorStore((state) => state.updateDraftingPreferences);
  const updateCanvas = useVectorStore((state) => state.updateCanvasPreferences);
  const toggleOsnapType = useVectorStore((state) => state.toggleOsnapType);
  const position = useVectorStore((state) => state.panelPositions.preferences);
  const setPosition = useVectorStore((state) => state.setPanelPosition);
  const dragControls = useDragControls();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const documentSnapshot = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const recovery = useSyncExternalStore(recoveryController.subscribe, recoveryController.getSnapshot, recoveryController.getSnapshot);
  const documentUnits = documentSnapshot.units;
  const workArea = documentSnapshot.workArea ?? defaultWorkArea(documentUnits);
  const gridUnits = preferences.drafting.defaultUnits;
  const gridInputStep = gridUnits === "in" ? 0.01 : gridUnits === "px" ? 1 : 0.1;
  const gridInputMinimum = gridUnits === "px" ? 1 : 0.01;
  const activeDocumentGridSize = gridSizeInDocumentUnits(preferences.drafting, documentUnits);
  const activeDocumentGridDescription = documentUnits === gridUnits
    ? `Distance between grid lines and snap points in ${gridUnits}.`
    : `Stored in ${gridUnits}; currently ${activeDocumentGridSize.toFixed(documentUnits === "in" ? 3 : 2)} ${documentUnits} in this document.`;

  const resetWorkspacePreferences = () => {
    updateDrafting(DEFAULT_PREFERENCES.drafting);
    updateCanvas({ cursorStyle: DEFAULT_PREFERENCES.canvas.cursorStyle });
  };

  const onDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setPosition("preferences", { x: position.x + info.offset.x, y: position.y + info.offset.y });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="preferences-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.aside
            className="preferences-hub surface"
            role="dialog"
            aria-modal="true"
            ref={dialogRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "Tab") {
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
                )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!first) {
                  event.preventDefault();
                } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
            aria-labelledby="preferences-title"
            style={{ x: position.x, y: position.y }}
            initial={{ opacity: 0, scale: 0.97, y: position.y + 8 }}
            animate={{ opacity: 1, scale: 1, y: position.y }}
            exit={{ opacity: 0, scale: 0.97, y: position.y + 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragElastic={0}
            onDragEnd={onDragEnd}
            onPointerDown={(event) => {
              event.stopPropagation();
              if ((event.target as Element).closest(".preferences-drag-handle")) dragControls.start(event);
            }}
          >
            <header className="preferences-head preferences-drag-handle">
              <div><span className="eyebrow">Workspace</span><h2 id="preferences-title">Preferences</h2></div>
              <Tooltip content="Close panel" placement="left"><button className="panel-close" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip>
            </header>

            <div className="preferences-layout">
              <section className="preferences-page" aria-label="Workspace preferences">
                <SectionHeading label="Drafting" title="Grid and snapping" description="Set up the precision aids used while drawing, measuring, and transforming." />
                <Setting title="Show grid" description="Show or hide the drafting grid without changing snapping."><Toggle checked={preferences.drafting.gridVisible} label="Show grid" onChange={() => updateDrafting({ gridVisible: !preferences.drafting.gridVisible })} /></Setting>
                <Setting title="Snap to grid" description="Align positions to the grid, even when it is hidden."><Toggle checked={preferences.drafting.snapToGrid} label="Snap to grid" onChange={() => updateDrafting({ snapToGrid: !preferences.drafting.snapToGrid })} /></Setting>
                <Setting title="Grid spacing" description={activeDocumentGridDescription}><NumberInput label={`Grid spacing in ${gridUnits}`} value={preferences.drafting.gridSize} min={gridInputMinimum} max={10000} step={gridInputStep} suffix={gridUnits} onChange={(gridSize) => updateDrafting({ gridSize })} /></Setting>
                <Setting title="Grid style" description="Choose the grid's appearance and snapping lattice."><div className="preference-segmented" role="radiogroup" aria-label="Canvas grid style">{(["lines", "dots", "isometric"] as const).map((style) => <button type="button" role="radio" aria-checked={preferences.drafting.gridStyle === style} className={preferences.drafting.gridStyle === style ? "is-active" : ""} key={style} onClick={() => updateDrafting({ gridStyle: style })}>{style}</button>)}</div></Setting>

                <SectionHeading label="Workspace" title="Work area" description="A visual guide only: it does not stop drawing outside the border, crop exports, or set the machine bed." />
                <Setting title="Show work area" description="Display a non-printing border from the document origin at 0, 0."><Toggle checked={workArea.enabled} label="Show work area boundary" onChange={() => documentModel.setWorkArea({ ...workArea, enabled: !workArea.enabled })} /></Setting>
                <Setting title="Work area size" description={`Width and height in this document's ${documentUnits} units.`}>
                  <div className="preference-dimensions">
                    <NumberInput label="Work area width" value={workArea.width} min={documentUnits === "px" ? 1 : 0.01} max={1_000_000} step={documentUnits === "in" ? 0.1 : 1} suffix={`W ${documentUnits}`} disabled={!workArea.enabled} onChange={(width) => documentModel.setWorkArea({ ...workArea, width })} />
                    <NumberInput label="Work area height" value={workArea.height} min={documentUnits === "px" ? 1 : 0.01} max={1_000_000} step={documentUnits === "in" ? 0.1 : 1} suffix={`H ${documentUnits}`} disabled={!workArea.enabled} onChange={(height) => documentModel.setWorkArea({ ...workArea, height })} />
                  </div>
                </Setting>

                <SectionHeading label="Precision" title="Object snaps" description="Choose which geometric points Vectora can acquire and how close the pointer must be." />
                <div className="preference-group preference-group-cards">
                  <div className="preference-group-head"><span>Snap modes</span><small>{preferences.drafting.osnapEnabledTypes.length} of {ALL_OSNAP_TYPES.length} enabled</small></div>
                  <div className="osnap-grid">
                    {ALL_OSNAP_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type}
                        className={preferences.drafting.osnapEnabledTypes.includes(type) ? "is-active" : ""}
                        aria-pressed={preferences.drafting.osnapEnabledTypes.includes(type)}
                        onClick={() => toggleOsnapType(type)}
                      ><i /><span><strong>{OSNAP_LABELS[type].title}</strong><small>{OSNAP_LABELS[type].description}</small></span></button>
                    ))}
                  </div>
                </div>
                <Setting title="Acquisition radius" description="Screen-space distance used to acquire object snap points."><RangeInput label="Object snap radius" value={preferences.drafting.osnapRadiusPx} min={2} max={40} suffix="px" onChange={(osnapRadiusPx) => updateDrafting({ osnapRadiusPx })} /></Setting>

                <SectionHeading label="Input" title="Drawing behaviour" description="Control angular constraints, pointer guidance, units, and numeric display." />
                <Setting title="Angle snap" description="Rotation increment used while holding Shift. Isometric mode uses 30° increments."><RangeInput label="Angle snap" value={preferences.drafting.angleSnapDeg} min={1} max={90} suffix="°" onChange={(angleSnapDeg) => updateDrafting({ angleSnapDeg })} /></Setting>
                <Setting title="Cursor" description="Use the system pointer or a full-canvas CAD crosshair."><div className="preference-segmented" role="radiogroup" aria-label="Canvas cursor style">{(["default", "crosshair"] as const).map((style) => <button type="button" role="radio" aria-checked={preferences.canvas.cursorStyle === style} className={preferences.canvas.cursorStyle === style ? "is-active" : ""} key={style} onClick={() => updateCanvas({ cursorStyle: style })}>{style}</button>)}</div></Setting>
                <Setting title="Default units" description="Units assigned to new documents and used for the grid-spacing preference."><div className="preference-segmented" role="radiogroup" aria-label="Default document units">{(["mm", "in", "px"] as const).map((unit) => <button type="button" role="radio" aria-checked={preferences.drafting.defaultUnits === unit} className={preferences.drafting.defaultUnits === unit ? "is-active" : ""} key={unit} onClick={() => updateDrafting({ defaultUnits: unit })}>{unit}</button>)}</div></Setting>
                <Setting title="Decimal precision" description="Coordinate and dimension display precision."><NumberInput label="Decimal precision" value={preferences.drafting.decimalPrecision} min={0} max={4} suffix="places" onChange={(decimalPrecision) => updateDrafting({ decimalPrecision: Math.round(decimalPrecision) })} /></Setting>

                <SectionHeading label="Privacy" title="Local recovery" description="Emergency copies stay in this browser profile. They are not saved project files or cloud backups." />
                <Setting title="Keep recovery copies" description="Automatically keep unsaved drawing copies on this device after editing pauses."><Toggle checked={recovery.enabled} label="Keep local recovery copies" onChange={() => recoveryController.setEnabled(!recovery.enabled)} /></Setting>
                <Setting title="Recovery data" description="Remove local unsaved copies without changing this drawing or saved project files."><button className="danger-subtle" onClick={() => {
                  if (!window.confirm("Remove all local recovery copies from this browser? This cannot be undone. The current drawing and saved files will not be deleted.")) return;
                  void recoveryController.clearAll().then(() => toast.info("Local recovery copies cleared.")).catch(() => toast.error("Local recovery copies could not be cleared."));
                }}>Clear local data</button></Setting>
                <p className="preference-recovery-note"><strong>Stored on this device only.</strong> Clearing browser data, changing browser profile or computer, device loss, and storage failure can remove these copies. Save a Vectora project file for a durable copy.</p>
              </section>
            </div>

            <footer className="preferences-footer">
              <span><i /> {recovery.status === "saved" ? "Recovery copy stored locally · project still unsaved" : recovery.status === "writing" ? "Updating local recovery…" : recovery.status === "conflict" ? "Recovery paused · another tab has this drawing" : recovery.status === "unavailable" ? "Local recovery unavailable" : "Preferences save automatically on this device"}</span>
              <div><button type="button" onClick={resetWorkspacePreferences}><RotateCcw size={13} /> Reset preferences</button></div>
            </footer>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
