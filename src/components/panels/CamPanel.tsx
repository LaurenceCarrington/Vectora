import { ToolLibrary } from "./ToolLibrary";
import { useToolStore, type ToolDefinition } from "../../cam/toolStore";
import { CamNumber } from "./CamNumber";
import { validateRasterSettings, type RasterSettings } from "../../cam/rasterCamEngine";
import type { ImageEntity } from "../../document/types";
import { DEFAULT_LEAD_PANEL_SETTINGS, useLeadSettingsStore } from "../../store/useLeadSettingsStore";
import { resolveCutLeadSettings, type LeadSettings, type LeadType } from "../../cam/leadGeometry";
import { DEFAULT_POCKET_SETTINGS, usePocketSettingsStore } from "../../store/usePocketSettingsStore";
import { entityToClosedPath } from "../../geometry/operations/pathConversion";
import { executeCommand, UpdateEntitiesCommand } from "../../document/History";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, type PanInfo, useDragControls } from "framer-motion";
import { AlertTriangle, BookmarkPlus, ChevronDown, Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { toolpathSimulator, type SimulationSpeed } from "../../cam/ToolpathSimulator";
import {
  compileGcode,
  validatePreflight,
  DEFAULT_GRBL_LASER_PROFILE,
  DEFAULT_MARLIN_LASER_PROFILE,
  type GcodeCompileOptions,
  type MachineProfile,
  type PixelPhysicalScale,
} from "../../cam/gcodeCompiler";
import { optimizeToolpaths, type OptimizedManufacturingPlan } from "../../cam/optimizer";
import { buildManufacturingPlan, createDefaultProcesses, toolProcessDefaults } from "../../cam/processModel";
import { documentModel } from "../../document/DocumentModel";
import { mmPerUnit } from "../../cam/physicalUnits";
import { useCamCalibrationStore } from "../../store/useCamCalibrationStore";
import { isFactoryPresetId, usePresetStore } from "../../store/usePresetStore";
import { DEFAULT_PREFERENCES, useVectorStore } from "../../store/useVectorStore";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { formatCount, MANUFACTURING_INTENT_LABELS } from "../ui/terminology";
import { MachineControlPanel } from "./MachineControlPanel";

export interface CamPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenRaster?: () => void;
}

function formatSimulationTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

const LEAD_TYPE_LABELS: Readonly<Record<LeadType, string>> = {
  none: "None",
  arc: "Arc",
  line: "Line",
  ramp: "Ramp",
};

function downloadText(source: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function CamPanel({ open, onClose, onOpenRaster }: CamPanelProps) {
  return <AnimatePresence>{open && <CamPanelContent onClose={onClose} {...(onOpenRaster ? { onOpenRaster } : {})} />}</AnimatePresence>;
}

function CamPanelContent({ onClose, onOpenRaster }: Pick<CamPanelProps, "onClose" | "onOpenRaster">) {
  const documentSnapshot = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const simulation = useSyncExternalStore(
    toolpathSimulator.subscribe,
    toolpathSimulator.getSnapshot,
    toolpathSimulator.getSnapshot,
  );
  const position = useVectorStore((state) => state.panelPositions.cam);
  const setPanelPosition = useVectorStore((state) => state.setPanelPosition);
  const presets = usePresetStore((state) => state.presets);
  const activePresetId = usePresetStore((state) => state.activePresetId);
  const applyStoredPreset = usePresetStore((state) => state.applyPreset);
  const clearAppliedPreset = usePresetStore((state) => state.clearAppliedPreset);
  const addPreset = usePresetStore((state) => state.addPreset);
  const dragControls = useDragControls();
  const selectedTool = useToolStore(state => state.selectedByDocument[documentSnapshot.id] ?? null);
  const [spindleRPM, setSpindleRPM] = useState(selectedTool?.recommendedRPM || 0);
  const [vectorStepdownMm, setVectorStepdownMm] = useState(selectedTool?.maxStepdown || 0.5);
  const camDefaults = useVectorStore((state) => state.preferences.cam);
  const updateCamDefaults = useVectorStore((state) => state.updateCamPreferences);
  const leadPanel = useLeadSettingsStore((state) => state.byDocument[documentSnapshot.id] ?? DEFAULT_LEAD_PANEL_SETTINGS);
  const updateLeadStore = useLeadSettingsStore((state) => state.update);
  const updateLead = (which: "leadIn" | "leadOut", patch: Partial<LeadSettings>) => {
    const settings = { ...leadPanel[which], ...patch };
    if (patch.leadType === "line" || patch.leadType === "ramp") settings.leadAngle = Math.min(settings.leadAngle, 90);
    updateLeadStore(documentSnapshot.id, { [which]: settings });
    if (patch.leadType === "ramp") setMachineMode("spindle");
    setPresetCustomized(true);
  };
  const pocket = usePocketSettingsStore((state) => state.byDocument[documentSnapshot.id] ?? DEFAULT_POCKET_SETTINGS);
  const updatePocketSettings = usePocketSettingsStore((state) => state.update);
  const [machineMode, setMachineMode] = useState<MachineProfile["mode"]>(
    selectedTool ? (selectedTool.type === "laser" ? "laser" : "spindle") : leadPanel.leadIn.leadType === "ramp" || [...documentSnapshot.entities.values()].some((entity) => entity.intent === "pocket") ? "spindle" : "laser",
  );
  const updatePocket = (settings: Parameters<typeof updatePocketSettings>[1]) => {
    updatePocketSettings(documentSnapshot.id, settings);
    setPresetCustomized(true);
  };
  const pocketTargets = useMemo(() => [...documentSnapshot.selection].map((id) => documentSnapshot.entities.get(id)!).filter(Boolean), [documentSnapshot]);
  const rasterTargets = pocketTargets.filter((entity): entity is ImageEntity => entity.type === "image" && !entity.locked && !documentSnapshot.layers.find((layer) => layer.id === entity.layerId)?.locked);
  const selectedRasterCount = pocketTargets.filter((entity) => entity.type === "image").length;
  const updateRaster = (patch: Partial<RasterSettings>) => {
    try {
      const next = rasterTargets.map((image) => ({ ...image, intent: "raster" as const, raster: { ...image.raster, ...patch } }));
      next.forEach((image) => validateRasterSettings(image.raster));
      executeCommand(new UpdateEntitiesCommand(rasterTargets, next, "Raster engrave settings"));
      setMachineMode("laser");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Check the raster settings."); }
  };
  // Flatten closed boundaries only when selection/document changes, not on simulation ticks.
  const showPocketSection = useMemo(() => pocketTargets.length > 0 && pocketTargets.every((entity) => entityToClosedPath(entity) !== null), [pocketTargets]);
  const canPocketSelection = showPocketSection && pocketTargets.every((entity) =>
    !entity.locked && !documentSnapshot.layers.find((layer) => layer.id === entity.layerId)?.locked);
  const applyPocketIntent = () => {
    if (!canPocketSelection) return;
    executeCommand(new UpdateEntitiesCommand(pocketTargets, pocketTargets.map((entity) => ({ ...entity, intent: "pocket" as const })), "Set operation to Pocket"));
    setMachineMode("spindle");
  };
  const [cutFeedRateMm, setCutFeedRateMm] = useState(selectedTool?.recommendedFeed ?? camDefaults.defaultCutFeedRate);
  const [cutPower, setCutPower] = useState(1_000);
  const [cutPasses, setCutPasses] = useState(1);
  const [engraveFeedRateMm, setEngraveFeedRateMm] = useState(selectedTool?.recommendedFeed ?? camDefaults.defaultEngraveFeedRate);
  const [engravePower, setEngravePower] = useState(350);
  const [engravePasses, setEngravePasses] = useState(1);
  const [scoreFeedRateMm, setScoreFeedRateMm] = useState(selectedTool?.recommendedFeed ?? camDefaults.defaultScoreFeedRate);
  const [scorePower, setScorePower] = useState(220);
  const [scorePasses, setScorePasses] = useState(1);
  const [kerfMm, setKerfMm] = useState(selectedTool?.diameter ?? camDefaults.defaultKerfMm);
  const rapidFeedRate = camDefaults.defaultRapidFeedRate / (camDefaults.machineUnits === "in" ? 25.4 : 1);
  const dialect = camDefaults.defaultGcodeDialect;
  const machineUnits = camDefaults.machineUnits;
  const originAlignment = camDefaults.jobOrigin;
  const [holdingTabsEnabled, setHoldingTabsEnabled] = useState(false);
  const [holdingTabWidthMm, setHoldingTabWidthMm] = useState(1.5);
  const bedWidthMm = camDefaults.machineBedWidthMm;
  const bedHeightMm = camDefaults.machineBedHeightMm;
  const [holdingTabCount, setHoldingTabCount] = useState(4);
  const [showTabsOnCanvas, setShowTabsOnCanvas] = useState(true);
  const pxPerMmInput = useCamCalibrationStore((state) => state.inputsByDocument[documentSnapshot.id] ?? "");
  const setCalibrationInput = useCamCalibrationStore((state) => state.setPxPerMmInput);
  const setPxPerMmInput = (input: string) => setCalibrationInput(documentSnapshot.id, input);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [presetCustomized, setPresetCustomized] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  const selectCutter = (tool: ToolDefinition | null) => {
    try {
      if (!tool) { useToolStore.getState().selectTool(documentSnapshot.id, null); return; }
      const defaults = toolProcessDefaults(tool);
      setCutFeedRateMm(defaults.cutFeedRate!); setEngraveFeedRateMm(defaults.engraveFeedRate!); setScoreFeedRateMm(defaults.scoreFeedRate!);
      setKerfMm(defaults.kerfWidth!); setSpindleRPM(tool.recommendedRPM);
      setMachineMode(tool.type === "laser" ? "laser" : "spindle");
      if (tool.type !== "laser") {
        setVectorStepdownMm(tool.maxStepdown);
        updatePocketSettings(documentSnapshot.id, { toolDiameter: tool.diameter, stepoverPct: tool.defaultStepover * 100, stepdown: tool.maxStepdown, feedRate: tool.recommendedFeed });
      } else {
        if (leadPanel.leadIn.leadType === "ramp") updateLeadStore(documentSnapshot.id, { leadIn: { ...leadPanel.leadIn, leadType: "none" } });
        if (rasterTargets.length) updateRaster({ feedRate: tool.recommendedFeed });
      }
      useToolStore.getState().selectTool(documentSnapshot.id, tool);
      setPresetCustomized(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "The cutter could not be applied."); }
  };

  const activeLayer = documentSnapshot.layers.find((layer) => layer.id === documentSnapshot.activeLayerId);
  const materialThickness = activeLayer?.material?.thicknessMm ?? 3;
  const selectedPreset = activePresetId
    ? presets.find((preset) => preset.id === activePresetId) ?? null
    : null;

  const pxPerMm = Number(pxPerMmInput);
  const requiresPixelCalibration = documentSnapshot.units === "px";
  const pixelCalibrationValid = !requiresPixelCalibration || (
    pxPerMmInput.trim().length > 0 && Number.isFinite(pxPerMm) && pxPerMm > 0
  );
  const physicalScale = useMemo<PixelPhysicalScale | undefined>(() => (
    pixelCalibrationValid && requiresPixelCalibration ? { pxPerMm } : undefined
  ), [pixelCalibrationValid, pxPerMm, requiresPixelCalibration]);
  // Keep controls physically stable across document unit/calibration changes.
  // Uncalibrated pixel documents display mm/min until a scale is supplied.
  const physicalFactor = pixelCalibrationValid ? mmPerUnit(documentSnapshot.units, physicalScale) : 1;
  const feedUnitLabel = pixelCalibrationValid ? documentSnapshot.units : "mm";
  const cutFeedRate = cutFeedRateMm / physicalFactor;
  const engraveFeedRate = engraveFeedRateMm / physicalFactor;
  const scoreFeedRate = scoreFeedRateMm / physicalFactor;
  const setCutFeedRate = (value: number) => setCutFeedRateMm(value * physicalFactor);
  const setEngraveFeedRate = (value: number) => setEngraveFeedRateMm(value * physicalFactor);
  const setScoreFeedRate = (value: number) => setScoreFeedRateMm(value * physicalFactor);
  const kerfWidth = requiresPixelCalibration ? kerfMm : kerfMm / physicalFactor;
  const setKerfWidth = (value: number) => setKerfMm(requiresPixelCalibration ? value : value * physicalFactor);
  const holdingTabWidth = requiresPixelCalibration ? holdingTabWidthMm : holdingTabWidthMm / physicalFactor;
  const setHoldingTabWidth = (value: number) => setHoldingTabWidthMm(requiresPixelCalibration ? value : value * physicalFactor);
  const kerfWidthInDocumentUnits = kerfMm / physicalFactor;
  const holdingTabWidthInDocumentUnits = holdingTabWidthMm / physicalFactor;
  const compileOptions = useMemo<GcodeCompileOptions>(() => ({
    holdingTabs: holdingTabsEnabled ? { tabWidth: holdingTabWidthInDocumentUnits, tabCount: holdingTabCount } : false,
    ...(physicalScale ? { physicalScale } : {}),
  }), [holdingTabsEnabled, holdingTabWidthInDocumentUnits, holdingTabCount, physicalScale]);
  const machineProfile = useMemo<MachineProfile>(() => {
    const base = dialect === "grbl" ? DEFAULT_GRBL_LASER_PROFILE : DEFAULT_MARLIN_LASER_PROFILE;
    const factor = machineUnits === "in" ? 25.4 : 1;
    const bedWidth = bedWidthMm / factor;
    const bedHeight = bedHeightMm / factor;
    return { ...base, mode: machineMode, safeZ: 5 / factor, stockSurfaceZ: 0, workZ: -leadPanel.cutDepthMm / factor, plungeRate: 300 / factor, units: machineUnits, originAlignment, rapidFeedRate, bedWidth, bedHeight,
      origin: originAlignment === "center" ? { x: bedWidth / 2, y: bedHeight / 2 } : { x: 0, y: 0 } };
  }, [leadPanel.cutDepthMm, bedHeightMm, bedWidthMm, dialect, machineMode, machineUnits, originAlignment, rapidFeedRate]);

  const result = useMemo((): { plan: OptimizedManufacturingPlan | null; error: string | null } => {
    try {
      const processes = createDefaultProcesses({
        ...(selectedTool ? { tool: selectedTool } : {}),
        ...(machineMode === "spindle" && spindleRPM > 0 ? { spindleRPM, vectorDepth: leadPanel.cutDepthMm / physicalFactor, vectorStepdown: vectorStepdownMm / physicalFactor } : {}),
        leadIn: leadPanel.leadIn, leadOut: leadPanel.leadOut,
        cutFeedRate,
        cutPower,
        cutPasses,
        kerfWidth: kerfWidthInDocumentUnits,
        pocket: { ...pocket, toolDiameter: pocket.toolDiameter / physicalFactor,
          depth: pocket.depth / physicalFactor, stepdown: pocket.stepdown / physicalFactor, feedRate: pocket.feedRate / physicalFactor },
        engraveFeedRate,
        engravePower,
        engravePasses,
        scoreFeedRate,
        scorePower,
        scorePasses,
      });
      return {
        plan: optimizeToolpaths(buildManufacturingPlan(documentSnapshot, { processes, ...(physicalScale ? { physicalScale } : {}) })),
        error: null,
      };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : "Manufacturing paths could not be calculated.",
      };
    }
  }, [selectedTool, spindleRPM, vectorStepdownMm, machineMode, leadPanel, pocket, physicalScale, physicalFactor, cutFeedRate, cutPasses, cutPower, documentSnapshot, engraveFeedRate, engravePasses, engravePower, kerfWidthInDocumentUnits, scoreFeedRate, scorePasses, scorePower]);

  const preflight = useMemo(() => result.plan && pixelCalibrationValid
    ? validatePreflight(result.plan, machineProfile, compileOptions)
    : null, [machineProfile, compileOptions, pixelCalibrationValid, result.plan]);
  const preflightMessage = preflight?.errors.map((error) => error.message).join("\n") ?? "";
  useEffect(() => {
    if (preflightMessage) toast.error(preflightMessage);
  }, [preflightMessage]);

  useEffect(() => {
    if (!result.plan || !pixelCalibrationValid || preflight?.hasCriticalErrors) {
      toolpathSimulator.pause();
      toolpathSimulator.setPlan(null);
      setSimulationError(null);
      return;
    }
    try {
      toolpathSimulator.setPlan(result.plan, {
        rapidFeedRate,
        headStyle: machineMode,
        machineProfile,
        machineUnits,
        holdingTabs: holdingTabsEnabled
          ? { tabWidth: holdingTabWidthInDocumentUnits, tabCount: holdingTabCount }
          : false,
        showHoldingTabs: holdingTabsEnabled && showTabsOnCanvas,
        ...(physicalScale ? { physicalScale } : {}),
      });
      setSimulationError(null);
    } catch (error) {
      toolpathSimulator.setPlan(null);
      setSimulationError(error instanceof Error ? error.message : "The simulation could not be prepared.");
    }
    return () => {
      toolpathSimulator.pause();
      toolpathSimulator.setPlan(null);
    };
  }, [
    machineMode,
    machineProfile,
    holdingTabCount,
    holdingTabWidth,
    holdingTabWidthInDocumentUnits,
    holdingTabsEnabled,
    machineUnits,
    physicalScale,
    pixelCalibrationValid,
    rapidFeedRate,
    preflight,
    result.plan,
    showTabsOnCanvas,
  ]);

  const downloadGcode = (extension: "gcode" | "nc") => {
    if (!result.plan || !pixelCalibrationValid) return;
    try {
      const report = validatePreflight(result.plan, machineProfile, compileOptions);
      if (report.hasCriticalErrors) {
        toast.error(report.errors.map((error) => error.message).join("\n"));
        return;
      }
      const source = compileGcode(result.plan, machineProfile, {
        holdingTabs: holdingTabsEnabled
          ? { tabWidth: holdingTabWidthInDocumentUnits, tabCount: holdingTabCount }
          : false,
        ...(physicalScale ? { physicalScale } : {}),
      });
      const safeTitle = documentSnapshot.title.trim().replace(/[^a-z0-9_-]+/gi, "-") || "vectora-job";
      downloadText(source, `${safeTitle}.${extension}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "G-code could not be generated.");
    }
  };

  const toolpathCount = result.plan?.toolpaths.length ?? 0;
  const unconvertedTextCount = useMemo(() => {
    const visibleLayers = new Set(documentSnapshot.layers.filter((layer) => layer.visible).map((layer) => layer.id));
    return [...documentSnapshot.entities.values()].filter((entity) =>
      entity.type === "text" && entity.visible && entity.intent !== "construction" && visibleLayers.has(entity.layerId)).length;
  }, [documentSnapshot]);
  const cutCount = result.plan?.toolpaths.filter((path) => path.processType === "vector-cut").length ?? 0;
  const pocketCount = result.plan?.toolpaths.filter((path) => path.processType === "pocket").length ?? 0;
  const engraveCount = toolpathCount - cutCount - pocketCount;
  const outputBlocked = !result.plan || toolpathCount === 0 || !pixelCalibrationValid || !!preflight?.hasCriticalErrors;
  const outputUnitLabel = machineUnits === "mm" ? "millimetres · G21" : "inches · G20";

  const markPresetCustomized = () => {
    if (activePresetId) setPresetCustomized(true);
  };

  const updateActiveLayerThickness = (thicknessMm: number) => {
    if (!activeLayer || !Number.isFinite(thicknessMm) || thicknessMm <= 0) return;
    if (Math.abs(materialThickness - thicknessMm) < 1e-9 && activeLayer.material) return;
    documentModel.updateLayer(activeLayer.id, {
      material: {
        kind: activeLayer.material?.kind ?? "wood",
        thicknessMm,
      },
    });
  };

  const applyMaterialPreset = (presetId: string) => {
    try {
      const preset = applyStoredPreset(presetId);
      useToolStore.getState().selectTool(documentSnapshot.id, null);
      setSpindleRPM(preset.cut?.spindleRPM ?? preset.pocket?.spindleRPM ?? preset.engrave?.spindleRPM ?? 0);
      if (preset.cut?.stepdown) setVectorStepdownMm(preset.cut.stepdown);
      if (preset.cut?.spindleRPM || preset.pocket?.spindleRPM || preset.engrave?.spindleRPM) setMachineMode("spindle");
      else setMachineMode("laser");
      if (preset.cut) {
        setCutFeedRateMm(preset.cut.feedRate);
        setCutPower(preset.cut.power);
        setCutPasses(preset.cut.passes);
        const leads = resolveCutLeadSettings(preset.cut);
        updateLeadStore(documentSnapshot.id, { ...leads, cutDepthMm: preset.cut.cutDepth ?? 1 });
        if (leads.leadIn.leadType === "ramp") setMachineMode("spindle");
      }
      if (preset.pocket) {
        updatePocketSettings(documentSnapshot.id, { toolDiameter: preset.pocket.toolDiameter, stepoverPct: preset.pocket.stepover,
          strategy: preset.pocket.strategy, depth: preset.pocket.depth, stepdown: preset.pocket.stepdown,
          feedRate: preset.pocket.feedRate, power: preset.pocket.power });
        setMachineMode("spindle");
      }
      if (preset.engrave) {
        setEngraveFeedRateMm(preset.engrave.feedRate);
        setEngravePower(preset.engrave.power);
        setEngravePasses(preset.engrave.passes);
      }
      if (preset.score) {
        setScoreFeedRateMm(preset.score.feedRate);
        setScorePower(preset.score.power);
        setScorePasses(preset.score.passes);
      }
      setKerfMm(preset.kerfMm);
      updateActiveLayerThickness(preset.thicknessMm);
      setPresetCustomized(false);
      setSavePresetOpen(false);
      toast.success(`Preset applied: ${preset.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The material preset could not be applied.");
    }
  };

  const saveCurrentPreset = () => {
    const name = newPresetName.trim();
    if (!name) {
      toast.error("Enter a name for the material preset.");
      return;
    }
    try {
      const milling = machineMode === "spindle" && spindleRPM > 0 ? { spindleRPM } : {};
      const preset = addPreset({
        name,
        thicknessMm: materialThickness,
        kerfMm,
        cut: { ...milling, ...(spindleRPM > 0 ? { stepdown: vectorStepdownMm } : {}), feedRate: cutFeedRateMm, power: cutPower, passes: cutPasses, leadIn: leadPanel.leadIn, leadOut: leadPanel.leadOut, cutDepth: leadPanel.cutDepthMm },
        engrave: { ...milling, feedRate: engraveFeedRateMm, power: engravePower, passes: engravePasses },
        score: { ...milling, feedRate: scoreFeedRateMm, power: scorePower, passes: scorePasses },
        ...(pocketCount ? { pocket: { ...milling, toolDiameter: pocket.toolDiameter, stepover: pocket.stepoverPct ?? 60, strategy: pocket.strategy,
          depth: pocket.depth, stepdown: pocket.stepdown, feedRate: pocket.feedRate, power: pocket.power, passes: Math.ceil(pocket.depth / pocket.stepdown) } } : {}),
      });
      applyStoredPreset(preset.id);
      setPresetCustomized(false);
      setSavePresetOpen(false);
      setNewPresetName("");
      toast.success(`Preset saved: ${preset.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The material preset could not be saved.");
    }
  };

  const onDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setPanelPosition("cam", { x: position.x + info.offset.x, y: position.y + info.offset.y });
  };

  return (
    <motion.section
      className="utility-panel surface cam-panel"
      role="dialog"
      aria-label="Manufacture"
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
        if ((event.target as Element).closest(".drag-handle")) dragControls.start(event);
      }}
    >
      <header className="cam-head drag-handle">
        <div><span className="eyebrow">Manufacturing</span><h2>Manufacture</h2></div>
        <Tooltip content="Close panel" placement="left">
          <button
            className="panel-close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="Close panel"
          ><X size={20} /></button>
        </Tooltip>
      </header>

      <div className="cam-body">
      <MachineControlPanel view="setup"
        plan={result.plan}
        profile={machineProfile}
        options={{
          holdingTabs: holdingTabsEnabled
            ? { tabWidth: holdingTabWidthInDocumentUnits, tabCount: holdingTabCount }
            : false,
          ...(physicalScale ? { physicalScale } : {}),
        }}
        outputBlocked={outputBlocked}
        estimatedSeconds={simulation.duration}
        displayUnits={feedUnitLabel}
        mmPerDisplayUnit={physicalFactor}
        baudRate={camDefaults.defaultBaudRate}
      />
      <div className="cam-profile-summary" aria-label="Active machine defaults">
        <span>{dialect.toUpperCase()}</span><i />
        <span>{outputUnitLabel}</span><i />
        <span>{bedWidthMm} × {bedHeightMm} mm</span>
      </div>

      <details className="cam-section cam-accordion cam-defaults" aria-label="Machine and CAM defaults">
        <summary><span>Machine and CAM defaults</span><small>Controller, bed and feeds</small><ChevronDown size={15} /></summary>
        <div className="cam-accordion-content">
          <div className="cam-section-title"><span>Controller and output</span><small>Saved on this device</small></div>
          <label className="cam-select">
            <span>Controller dialect</span>
            <select aria-label="Default G-code dialect" value={camDefaults.defaultGcodeDialect} onChange={(event) => updateCamDefaults({ defaultGcodeDialect: event.currentTarget.value as typeof camDefaults.defaultGcodeDialect })}>
              <option value="grbl">GRBL</option>
              <option value="marlin">Marlin</option>
            </select>
          </label>
          <label className="cam-select">
            <span>Serial baud rate</span>
            <select aria-label="Default serial baud rate" value={camDefaults.defaultBaudRate} onChange={(event) => updateCamDefaults({ defaultBaudRate: Number(event.currentTarget.value) })}>
              {[9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000].map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()}</option>)}
            </select>
          </label>
          <label className="cam-select">
            <span>Machine units</span>
            <select aria-label="Machine units" value={camDefaults.machineUnits} onChange={(event) => updateCamDefaults({ machineUnits: event.currentTarget.value as typeof camDefaults.machineUnits })}>
              <option value="mm">Millimetres · G21</option>
              <option value="in">Inches · G20</option>
            </select>
          </label>
          <label className="cam-select">
            <span>Job origin</span>
            <select aria-label="Job origin" value={camDefaults.jobOrigin} onChange={(event) => updateCamDefaults({ jobOrigin: event.currentTarget.value as typeof camDefaults.jobOrigin })}>
              <option value="lower-left">Lower left</option>
              <option value="center">Centre</option>
              <option value="document">Document zero</option>
            </select>
          </label>

          <div className="cam-section-title cam-defaults-subhead"><span>Machine bed</span><small>Millimetres</small></div>
          <div className="cam-fields-grid">
            <CamNumber label="Bed width" value={camDefaults.machineBedWidthMm} min={1} max={100000} suffix="mm" onChange={(machineBedWidthMm) => updateCamDefaults({ machineBedWidthMm })} />
            <CamNumber label="Bed height" value={camDefaults.machineBedHeightMm} min={1} max={100000} suffix="mm" onChange={(machineBedHeightMm) => updateCamDefaults({ machineBedHeightMm })} />
          </div>

          <div className="cam-section-title cam-defaults-subhead"><span>Process defaults</span><small>New sessions</small></div>
          <div className="cam-fields-grid">
            <CamNumber label="Kerf width" value={camDefaults.defaultKerfMm} min={0} max={10} step={0.01} suffix="mm" onChange={(defaultKerfMm) => updateCamDefaults({ defaultKerfMm })} />
            <CamNumber label="Rapid feed" value={camDefaults.defaultRapidFeedRate} min={1} max={100000} step={10} suffix="mm/min" onChange={(defaultRapidFeedRate) => updateCamDefaults({ defaultRapidFeedRate: Math.round(defaultRapidFeedRate) })} />
            <CamNumber label="Cut feed" value={camDefaults.defaultCutFeedRate} min={1} max={100000} step={10} suffix="mm/min" onChange={(defaultCutFeedRate) => updateCamDefaults({ defaultCutFeedRate: Math.round(defaultCutFeedRate), defaultFeedRate: Math.round(defaultCutFeedRate) })} />
            <CamNumber label="Engrave feed" value={camDefaults.defaultEngraveFeedRate} min={1} max={100000} step={10} suffix="mm/min" onChange={(defaultEngraveFeedRate) => updateCamDefaults({ defaultEngraveFeedRate: Math.round(defaultEngraveFeedRate) })} />
            <CamNumber label="Score feed" value={camDefaults.defaultScoreFeedRate} min={1} max={100000} step={10} suffix="mm/min" onChange={(defaultScoreFeedRate) => updateCamDefaults({ defaultScoreFeedRate: Math.round(defaultScoreFeedRate) })} />
          </div>
          <button className="cam-reset-defaults" type="button" onClick={() => updateCamDefaults(DEFAULT_PREFERENCES.cam)}><RotateCcw size={13} /> Reset CAM defaults</button>
        </div>
      </details>

      {requiresPixelCalibration && (
        <section className={`cam-calibration ${pixelCalibrationValid ? "is-valid" : "is-required"}`} role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Physical calibration required</strong>
            <p>Pixel coordinates cannot be sent safely to a machine until their real-world scale is known.</p>
            <label>
              <span>Pixels per millimetre</span>
              <span className="cam-calibration-input">
                <input
                  type="number"
                  min="0.000001"
                  step="0.0001"
                  inputMode="decimal"
                  value={pxPerMmInput}
                  placeholder="3.7795"
                  onChange={(event) => setPxPerMmInput(event.target.value)}
                />
                <small>px/mm</small>
              </span>
            </label>
            {pixelCalibrationValid && (
              <small className="cam-calibration-result">
                {pxPerMm.toFixed(4)} px/mm · {(pxPerMm * 25.4).toFixed(2)} px/in · 1 px = {(1 / pxPerMm).toFixed(4)} mm
              </small>
            )}
          </div>
        </section>
      )}

      <section className="cam-profile">
        <div className="cam-profile-heading">
          <span>Material preset</span>
          <small className={selectedPreset && !presetCustomized ? "is-preset" : "is-custom"}>
            {selectedPreset && !presetCustomized ? (isFactoryPresetId(selectedPreset.id) ? "Factory" : "Saved") : "Custom"}
          </small>
        </div>
        <label className="cam-profile-select">
          <span className="sr-only">Material preset</span>
          <select
            value={activePresetId ?? ""}
            onChange={(event) => {
              const id = event.target.value;
              if (!id) {
                clearAppliedPreset();
                setPresetCustomized(false);
                return;
              }
              applyMaterialPreset(id);
            }}
          >
            <option value="">Custom settings</option>
            <optgroup label="Factory presets">
              {presets.filter((preset) => isFactoryPresetId(preset.id)).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </optgroup>
            {presets.some((preset) => !isFactoryPresetId(preset.id)) && (
              <optgroup label="My presets">
                {presets.filter((preset) => !isFactoryPresetId(preset.id)).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="cam-profile-meta">
          <CamNumber
            label="Material thickness"
            value={materialThickness}
            min={0.1}
            max={1_000}
            step={0.1}
            suffix="mm"
            onChange={(value) => {
              updateActiveLayerThickness(value);
              markPresetCustomized();
            }}
          />
          <Tooltip content="Save material preset" placement="left">
            <button
              className="cam-save-preset"
              type="button"
              aria-label="Save material preset"
              onClick={() => setSavePresetOpen((value) => !value)}
            >
              <BookmarkPlus size={16} />
            </button>
          </Tooltip>
        </div>
        <AnimatePresence initial={false}>
          {savePresetOpen && (
            <motion.div
              className="cam-preset-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <input
                type="text"
                value={newPresetName}
                maxLength={80}
                autoFocus
                placeholder="Preset name"
                aria-label="New material preset name"
                onChange={(event) => setNewPresetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveCurrentPreset();
                  if (event.key === "Escape") setSavePresetOpen(false);
                }}
              />
              <button type="button" onClick={saveCurrentPreset}>Save preset</button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      <ToolLibrary selected={selectedTool} onSelect={selectCutter} />

      <div className="cam-section">
        <div className="cam-section-title"><span>Process parameters</span><small>{feedUnitLabel}/min</small></div>
        <div className="cam-fields-grid">
          {machineMode === "spindle" && <>
            <CamNumber label="Spindle speed" value={spindleRPM} min={1} max={1000000} suffix="rpm" onChange={setSpindleRPM} />
            <CamNumber label="Vector stepdown" value={vectorStepdownMm} min={0.001} step={0.1} suffix="mm" onChange={setVectorStepdownMm} />
          </>}
          <CamNumber label="Cut feed" value={cutFeedRate} min={0.001} step={0.001} suffix={`${feedUnitLabel}/min`} onChange={(value) => { setCutFeedRate(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Cut power" value={cutPower} min={0} max={1000} suffix="S" onChange={(value) => { setCutPower(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Cut passes" value={machineMode === "spindle" && spindleRPM > 0 ? Math.ceil(leadPanel.cutDepthMm / vectorStepdownMm) : cutPasses} min={1} max={1000} suffix="#" onChange={(value) => { setCutPasses(Math.max(1, Math.round(value))); markPresetCustomized(); }} />
          <CamNumber label="Engrave feed" value={engraveFeedRate} min={0.001} step={0.001} suffix={`${feedUnitLabel}/min`} onChange={(value) => { setEngraveFeedRate(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Engrave power" value={engravePower} min={0} max={1000} suffix="S" onChange={(value) => { setEngravePower(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Engrave passes" value={machineMode === "spindle" && spindleRPM > 0 ? Math.ceil(leadPanel.cutDepthMm / vectorStepdownMm) : engravePasses} min={1} max={1000} suffix="#" onChange={(value) => { setEngravePasses(Math.max(1, Math.round(value))); markPresetCustomized(); }} />
          <CamNumber label="Score feed" value={scoreFeedRate} min={0.001} step={0.001} suffix={`${feedUnitLabel}/min`} onChange={(value) => { setScoreFeedRate(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Score power" value={scorePower} min={0} max={1000} suffix="S" onChange={(value) => { setScorePower(value); markPresetCustomized(); }} />
          <CamNumber disabled={machineMode === "spindle" && spindleRPM > 0} label="Score passes" value={machineMode === "spindle" && spindleRPM > 0 ? Math.ceil(leadPanel.cutDepthMm / vectorStepdownMm) : scorePasses} min={1} max={1000} suffix="#" onChange={(value) => { setScorePasses(Math.max(1, Math.round(value))); markPresetCustomized(); }} />
          <CamNumber label="Kerf width" value={kerfWidth} min={0} step={0.01} suffix={requiresPixelCalibration ? "mm" : documentSnapshot.units} onChange={(value) => { setKerfWidth(value); markPresetCustomized(); }} />
        </div>
      </div>

      <details className="cam-section cam-accordion">
        <summary><span>Leads and ramps</span><small>{`${LEAD_TYPE_LABELS[leadPanel.leadIn.leadType]} / ${LEAD_TYPE_LABELS[leadPanel.leadOut.leadType]}`}</small><ChevronDown size={15} /></summary>
        <div className="cam-accordion-content">
        {(["leadIn", "leadOut"] as const).map((which) => {
          const lead = leadPanel[which];
          const label = which === "leadIn" ? "Lead-in" : "Lead-out";
          return <div key={which}>
            <label className="cam-select"><span>{label} type</span><select value={lead.leadType} onChange={(event) => updateLead(which, { leadType: event.target.value as LeadType })}>
              <option value="none">None</option><option value="arc">Tangent arc</option><option value="line">Straight line</option>
              {which === "leadIn" && <option value="ramp">Linear Z ramp</option>}
            </select></label>
            <div className="cam-fields-grid">
              <CamNumber label={`${label} length`} value={lead.leadLength} min={0.001} step={0.1} suffix="mm" disabled={lead.leadType === "none"} onChange={(leadLength) => updateLead(which, { leadLength })} />
              <CamNumber label={`${label} angle`} value={lead.leadAngle} min={1} max={lead.leadType === "arc" ? 180 : 90} suffix="°" disabled={lead.leadType === "none"} onChange={(leadAngle) => updateLead(which, { leadAngle })} />
              {lead.leadType === "ramp" && <CamNumber label="Ramp slope limit" value={lead.rampAngle} min={0.1} max={45} step={0.1} suffix="°" onChange={(rampAngle) => updateLead(which, { rampAngle })} />}
            </div>
          </div>;
        })}
        {machineMode === "spindle" && <CamNumber label="Vector cut depth" value={leadPanel.cutDepthMm} min={0.001} step={0.1} suffix="mm" onChange={(cutDepthMm) => { updateLeadStore(documentSnapshot.id, { cutDepthMm }); markPresetCustomized(); }} />}
        <p className="cam-pocket-help">Arc length follows the curve. Straight leads use the entry/exit angle; ramps extend the requested run as needed to stay below the slope limit. Teal marks entry; orange arrows mark exit.</p>
        </div>
      </details>

      <details className="cam-section cam-accordion">
        <summary><span>Holding tabs</span><small>{holdingTabsEnabled ? `${holdingTabCount} per path` : "Off"}</small><ChevronDown size={15} /></summary>
        <div className="cam-accordion-content">
        <label className="cam-tab-toggle">
          <span><strong>Bridge cut profiles</strong><small>Keep parts attached to the sheet during cutting</small></span>
          <input type="checkbox" checked={holdingTabsEnabled} onChange={(event) => setHoldingTabsEnabled(event.target.checked)} />
        </label>
        <label className="cam-tab-toggle cam-show-tabs">
          <span><strong>Show tabs on canvas</strong><small>Preview every laser-off bridge location</small></span>
          <input
            type="checkbox"
            checked={showTabsOnCanvas}
            disabled={!holdingTabsEnabled}
            onChange={(event) => setShowTabsOnCanvas(event.target.checked)}
          />
        </label>
        <div className="cam-fields-grid cam-tab-fields">
          <CamNumber label="Tab width" value={holdingTabWidth} min={0.01} step={0.1} suffix={requiresPixelCalibration ? "mm" : documentSnapshot.units} disabled={!holdingTabsEnabled} onChange={setHoldingTabWidth} />
          <CamNumber label="Tabs / path" value={holdingTabCount} min={1} step={1} suffix="#" disabled={!holdingTabsEnabled} onChange={(value) => setHoldingTabCount(Math.max(1, Math.round(value)))} />
        </div>
        </div>
      </details>

      {selectedRasterCount > 0 && (
        <div className="cam-section cam-context-action">
          <div className="cam-section-title"><span>Raster engrave</span><small>{selectedRasterCount} selected</small></div>
          <p className="cam-pocket-help">Bitmap preprocessing and scan parameters are managed in the Raster engrave panel.</p>
          <button type="button" className="cam-primary" onClick={onOpenRaster}>Open raster settings</button>
        </div>
      )}

      {showPocketSection && (
      <div className="cam-section">
        <div className="cam-section-title"><span>Pocket</span><small>2.5D · Spindle</small></div>
        <button type="button" className="cam-primary" disabled={!canPocketSelection} onClick={applyPocketIntent}>Apply pocket</button>
        <p className="cam-pocket-help">Select closed boundaries and their islands. Nested contours alternate cleared regions and islands; enclosed cut contours are also preserved.</p>
        <div className="cam-fields-grid">
          <CamNumber label="Tool diameter" value={pocket.toolDiameter} min={0.001} step={0.1} suffix="mm" onChange={(toolDiameter) => updatePocket({ toolDiameter })} />
          <CamNumber label="Stepover" value={pocket.stepoverPct ?? 60} min={1} max={80} suffix="%" onChange={(stepoverPct) => updatePocket({ stepoverPct })} />
          <CamNumber label="Pocket depth" value={pocket.depth} min={0.001} step={0.1} suffix="mm" onChange={(depth) => updatePocket({ depth })} />
          <CamNumber label="Stepdown" value={pocket.stepdown} min={0.001} step={0.1} suffix="mm" onChange={(stepdown) => updatePocket({ stepdown })} />
          <CamNumber label="Pocket feed" value={pocket.feedRate} min={1} suffix="mm/min" onChange={(feedRate) => updatePocket({ feedRate })} />
          <CamNumber disabled={spindleRPM > 0} label="Spindle power" value={pocket.power} min={1} max={1000} suffix="S" onChange={(power) => updatePocket({ power })} />
        </div>
        <label className="cam-select"><span>Strategy</span><select value={pocket.strategy} onChange={(event) => updatePocket({ strategy: event.target.value as typeof pocket.strategy })}>
          <option value="concentric">Concentric</option><option value="linear">Linear zigzag</option>
        </select></label>
      </div>
      )}

      <div className="cam-section simulator-controls">
        <div className="cam-section-title"><span>Simulation</span><small>{formatSimulationTime(simulation.duration)}</small></div>
        <div className="simulator-row">
          <Tooltip content={!pixelCalibrationValid ? "Set pixel scale" : simulation.status === "playing" ? "Pause simulation" : "Play simulation"} placement="top">
            <button
              className="simulator-play"
              disabled={outputBlocked}
              onClick={() => {
                if (!result.plan) return;
                const report = validatePreflight(result.plan, machineProfile, compileOptions);
                if (report.hasCriticalErrors) toast.error(report.errors.map((error) => error.message).join("\n"));
                else toolpathSimulator.toggle();
              }}
              aria-label={simulation.status === "playing" ? "Pause simulation" : "Play simulation"}
            >
              {simulation.status === "playing" ? <Pause size={16} /> : <Play size={16} />}
            </button>
          </Tooltip>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(simulation.progress * 1000)}
            disabled={outputBlocked}
            onChange={(event) => toolpathSimulator.seek(Number(event.target.value) / 1000)}
            aria-label="Simulation position"
          />
          <span className="simulator-time">{formatSimulationTime(simulation.currentTime)}</span>
        </div>
        <div className="speed-buttons" aria-label="Simulation speed">
          {([1, 2, 5] as const).map((speed: SimulationSpeed) => (
            <button
              key={speed}
              className={simulation.speed === speed ? "is-active" : ""}
              disabled={outputBlocked}
              onClick={() => toolpathSimulator.setSpeed(speed)}
            >{speed}×</button>
          ))}
        </div>
      </div>

      {toolpathCount > 0 && <details className="cam-section cam-accordion">
        <summary><span>Toolpath sequence</span><small>{formatCount(toolpathCount, "path")}</small><ChevronDown size={15} /></summary>
        <ol className="cam-toolpath-list">
          {result.plan?.toolpaths.slice(0, 100).map((path) => (
            <li key={path.id}><i className="cam-toolpath-swatch" style={{ backgroundColor: path.color }} aria-hidden="true" />
              <strong>{documentSnapshot.entities.get(path.sourceEntityId)?.name ?? path.sourceIntent}</strong>
              <span>{MANUFACTURING_INTENT_LABELS[path.sourceIntent]} · {path.passes} pass{path.passes === 1 ? "" : "es"} · {path.closed ? "closed" : "open"}</span>
            </li>
          ))}
        </ol>
        {toolpathCount > 100 && <p className="cam-pocket-help">Showing the first 100 of {toolpathCount} paths in execution order. Exports include all paths.</p>}
      </details>}

      {preflightMessage && <div className="cam-error" role="alert">{preflightMessage}</div>}
      {result.error && <div className="cam-error">{result.error}</div>}
      {simulationError && <div className="cam-error">{simulationError}</div>}
      {unconvertedTextCount > 0 && <p className="cam-empty" role="note">{formatCount(unconvertedTextCount, "editable text object")} {unconvertedTextCount === 1 ? "is" : "are"} excluded from toolpaths. Select {unconvertedTextCount === 1 ? "it" : "them"} and choose Convert to paths in the selection toolbar before manufacturing.</p>}
      {!result.error && toolpathCount === 0 && <div className="cam-empty">Add visible cut, vector engrave, score, or pocket geometry to create a job.</div>}

      <div className="cam-summary">
        <span><strong>{toolpathCount}</strong> {toolpathCount === 1 ? "toolpath" : "toolpaths"}</span><i />
        <span>{cutCount} {cutCount === 1 ? "cut" : "cuts"}</span>
        <span className="cam-summary-sep">·</span>
        <span>{engraveCount} {engraveCount === 1 ? "mark" : "marks"}</span>
        <span className="cam-summary-sep">·</span>
        <span>{pocketCount} {pocketCount === 1 ? "pocket" : "pockets"}</span>
      </div>

      <div className="cam-output-row">
        <MachineControlPanel view="output"
          plan={result.plan}
          profile={machineProfile}
          options={{
            holdingTabs: holdingTabsEnabled
              ? { tabWidth: holdingTabWidthInDocumentUnits, tabCount: holdingTabCount }
              : false,
            ...(physicalScale ? { physicalScale } : {}),
          }}
          outputBlocked={outputBlocked}
          estimatedSeconds={simulation.duration}
          displayUnits={feedUnitLabel}
          mmPerDisplayUnit={physicalFactor}
          baudRate={camDefaults.defaultBaudRate}
        />

        <div className="cam-actions">
          <button disabled={outputBlocked} onClick={() => downloadGcode("nc")}>Export NC</button>
          <button className="primary" disabled={outputBlocked} onClick={() => downloadGcode("gcode")}>
            <Download size={15} /> Export G-code
          </button>
        </div>
      </div>

      </div>

      <div className="drag-note"><i /> Drag header to move</div>
    </motion.section>
  );
}
