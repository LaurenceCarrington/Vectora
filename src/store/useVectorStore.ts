import { create } from "zustand";
import type { BezierNodeType, DocumentUnits } from "../document/types";

export type ToolId =
  | "select"
  | "node-edit"
  | "line"
  | "pen"
  | "erase"
  | "fill"
  | "rectangle"
  | "circle"
  | "ellipse"
  | "polygon"
  | "arc"
  | "text"
  | "dimension"
  | "linear-dimension"
  | "radial-dimension"
  | "diameter-dimension"
  | "leader"
  | "measure";

export type OsnapType = "endpoint" | "midpoint" | "center" | "intersection";
export type GridStyle = "lines" | "dots" | "isometric";
export type CursorStyle = "default" | "crosshair";
export type ThemeMode = "light-glass" | "dark-cad" | "high-contrast";
export type DefaultGcodeDialect = "grbl" | "marlin";
export type MachineUnits = "mm" | "in";
export type JobOrigin = "lower-left" | "center" | "document";

export interface DraftingPreferences {
  readonly snapToGrid: boolean;
  readonly gridVisible: boolean;
  readonly gridSize: number;
  readonly gridStyle: GridStyle;
  readonly osnapEnabledTypes: readonly OsnapType[];
  readonly osnapRadiusPx: number;
  readonly angleSnapDeg: number;
  readonly defaultUnits: DocumentUnits;
  readonly decimalPrecision: number;
}

export interface CanvasPreferences {
  readonly cursorStyle: CursorStyle;
  readonly showFpsOverlay: boolean;
  readonly themeMode: ThemeMode;
}

export interface CamPreferences {
  readonly defaultKerfMm: number;
  /** @deprecated Compatibility alias for defaultCutFeedRate. */
  readonly defaultFeedRate: number;
  readonly defaultCutFeedRate: number;
  readonly defaultEngraveFeedRate: number;
  readonly defaultScoreFeedRate: number;
  readonly defaultRapidFeedRate: number;
  readonly defaultGcodeDialect: DefaultGcodeDialect;
  readonly defaultBaudRate: number;
  readonly machineBedWidthMm: number;
  readonly machineBedHeightMm: number;
  readonly machineUnits: MachineUnits;
  readonly jobOrigin: JobOrigin;
}

export interface VectorPreferences {
  readonly drafting: DraftingPreferences;
  readonly canvas: CanvasPreferences;
  readonly cam: CamPreferences;
}

export const VECTORA_PREFERENCES_STORAGE_KEY = "vectora_preferences";
export const ALL_OSNAP_TYPES: readonly OsnapType[] = Object.freeze([
  "endpoint",
  "midpoint",
  "center",
  "intersection",
]);

const MILLIMETRES_PER_UNIT: Readonly<Record<DocumentUnits, number>> = Object.freeze({
  mm: 1,
  in: 25.4,
  // CSS pixels are the application's physical pixel reference for file and
  // CAM unit conversion (96 px = 1 inch).
  px: 25.4 / 96,
});

/** Converts a scalar distance without changing the underlying physical size. */
export function convertDocumentUnitLength(
  value: number,
  fromUnits: DocumentUnits,
  toUnits: DocumentUnits,
): number {
  if (!Number.isFinite(value)) return value;
  return value * MILLIMETRES_PER_UNIT[fromUnits] / MILLIMETRES_PER_UNIT[toUnits];
}

/** Resolves the stored grid preference into the active document coordinate system. */
export function gridSizeInDocumentUnits(
  drafting: Pick<DraftingPreferences, "gridSize" | "defaultUnits">,
  documentUnits: DocumentUnits,
): number {
  return convertDocumentUnitLength(drafting.gridSize, drafting.defaultUnits, documentUnits);
}

export const DEFAULT_PREFERENCES: VectorPreferences = Object.freeze({
  drafting: Object.freeze({
    snapToGrid: true,
    gridVisible: true,
    gridSize: 24,
    gridStyle: "lines",
    osnapEnabledTypes: ALL_OSNAP_TYPES,
    osnapRadiusPx: 10,
    angleSnapDeg: 15,
    defaultUnits: "mm",
    decimalPrecision: 2,
  }),
  canvas: Object.freeze({
    cursorStyle: "default",
    showFpsOverlay: false,
    themeMode: "light-glass",
  }),
  cam: Object.freeze({
    defaultKerfMm: 0.15,
    defaultFeedRate: 900,
    defaultCutFeedRate: 900,
    defaultEngraveFeedRate: 2_400,
    defaultScoreFeedRate: 1_800,
    defaultRapidFeedRate: 6_000,
    defaultGcodeDialect: "grbl",
    defaultBaudRate: 115_200,
    machineBedWidthMm: 300,
    machineBedHeightMm: 200,
    machineUnits: "mm",
    jobOrigin: "lower-left",
  }),
});

export type PanelId = "preferences" | "layers" | "cam" | "raster" | "properties" | "selectionActions";
type ToggleablePanelId = "preferences" | "layers" | "properties";
export type Point = { x: number; y: number };
export type Viewport = Point & { zoom: number };
export interface NodeEditSelection {
  readonly entityId: string;
  readonly vertexIndex: number;
  readonly nodeType: BezierNodeType;
}
type PanelPosition = Record<PanelId, Point>;

interface VectorState {
  activeTool: ToolId;
  fillBucketColor: string;
  viewport: Viewport;
  preferences: VectorPreferences;
  fileMenuOpen: boolean;
  selectMenuOpen: boolean;
  lineMenuOpen: boolean;
  shapeMenuOpen: boolean;
  commandPaletteOpen: boolean;
  preferencesOpen: boolean;
  layersOpen: boolean;
  propertiesOpen: boolean;
  temporaryPanActive: boolean;
  canvasPanning: boolean;
  nodeEditSelection: NodeEditSelection | null;
  panelPositions: PanelPosition;
  setActiveTool: (tool: ToolId) => void;
  setFillBucketColor: (color: string) => void;
  setViewport: (viewport: Viewport) => void;
  updateDraftingPreferences: (updates: Partial<DraftingPreferences>) => void;
  updateCanvasPreferences: (updates: Partial<CanvasPreferences>) => void;
  updateCamPreferences: (updates: Partial<CamPreferences>) => void;
  replacePreferences: (preferences: VectorPreferences) => void;
  resetPreferences: () => void;
  toggleOsnapType: (type: OsnapType) => void;
  /** Compatibility actions used by the telemetry and grid engine. */
  setSnapToGrid: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  setFileMenuOpen: (open: boolean) => void;
  setSelectMenuOpen: (open: boolean) => void;
  setLineMenuOpen: (open: boolean) => void;
  setShapeMenuOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTemporaryPanActive: (active: boolean) => void;
  setCanvasPanning: (panning: boolean) => void;
  setNodeEditSelection: (selection: NodeEditSelection | null) => void;
  togglePanel: (panel: ToggleablePanelId, open?: boolean) => void;
  setPanelPosition: (panel: PanelId, position: Point) => void;
  zoomBy: (factor: number) => void;
  resetViewport: () => void;
}

const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const OSNAP_TYPE_SET = new Set<string>(ALL_OSNAP_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function normalizePreferences(value: unknown): VectorPreferences {
  const root = isRecord(value) ? value : {};
  const drafting = isRecord(root.drafting) ? root.drafting : {};
  const canvas = isRecord(root.canvas) ? root.canvas : {};
  const cam = isRecord(root.cam) ? root.cam : {};
  const osnapTypes = Array.isArray(drafting.osnapEnabledTypes)
    ? [...new Set(drafting.osnapEnabledTypes.filter(
        (type): type is OsnapType => typeof type === "string" && OSNAP_TYPE_SET.has(type),
      ))]
    : [...DEFAULT_PREFERENCES.drafting.osnapEnabledTypes];
  const units = drafting.defaultUnits;
  const gridStyle = drafting.gridStyle;
  const cursorStyle = canvas.cursorStyle;
  const themeMode = canvas.themeMode;
  const dialect = cam.defaultGcodeDialect;
  const machineUnits = cam.machineUnits;
  const jobOrigin = cam.jobOrigin;
  const legacyCutFeed = finiteInRange(cam.defaultFeedRate, DEFAULT_PREFERENCES.cam.defaultCutFeedRate, 1, 100_000);
  const defaultCutFeedRate = Math.round(finiteInRange(cam.defaultCutFeedRate, legacyCutFeed, 1, 100_000));

  return Object.freeze({
    drafting: Object.freeze({
      snapToGrid: typeof drafting.snapToGrid === "boolean" ? drafting.snapToGrid : DEFAULT_PREFERENCES.drafting.snapToGrid,
      // Older preferences stored "none" as a grid style. Preserve that hidden
      // display state while restoring a usable lattice for independent snap.
      gridVisible: typeof drafting.gridVisible === "boolean" ? drafting.gridVisible : gridStyle !== "none",
      gridSize: finiteInRange(drafting.gridSize, DEFAULT_PREFERENCES.drafting.gridSize, 0.01, 10_000),
      gridStyle: gridStyle === "lines" || gridStyle === "dots" || gridStyle === "isometric"
        ? gridStyle
        : DEFAULT_PREFERENCES.drafting.gridStyle,
      osnapEnabledTypes: Object.freeze(osnapTypes),
      osnapRadiusPx: finiteInRange(drafting.osnapRadiusPx, DEFAULT_PREFERENCES.drafting.osnapRadiusPx, 2, 40),
      angleSnapDeg: finiteInRange(drafting.angleSnapDeg, DEFAULT_PREFERENCES.drafting.angleSnapDeg, 1, 90),
      defaultUnits: units === "mm" || units === "in" || units === "px" ? units : DEFAULT_PREFERENCES.drafting.defaultUnits,
      decimalPrecision: Math.round(finiteInRange(drafting.decimalPrecision, DEFAULT_PREFERENCES.drafting.decimalPrecision, 0, 4)),
    }),
    canvas: Object.freeze({
      cursorStyle: cursorStyle === "default" || cursorStyle === "crosshair" ? cursorStyle : DEFAULT_PREFERENCES.canvas.cursorStyle,
      showFpsOverlay: typeof canvas.showFpsOverlay === "boolean" ? canvas.showFpsOverlay : DEFAULT_PREFERENCES.canvas.showFpsOverlay,
      themeMode: themeMode === "light-glass" || themeMode === "dark-cad" || themeMode === "high-contrast"
        ? themeMode
        : DEFAULT_PREFERENCES.canvas.themeMode,
    }),
    cam: Object.freeze({
      defaultKerfMm: finiteInRange(cam.defaultKerfMm, DEFAULT_PREFERENCES.cam.defaultKerfMm, 0, 10),
      defaultFeedRate: defaultCutFeedRate,
      defaultCutFeedRate,
      defaultEngraveFeedRate: Math.round(finiteInRange(cam.defaultEngraveFeedRate, DEFAULT_PREFERENCES.cam.defaultEngraveFeedRate, 1, 100_000)),
      defaultScoreFeedRate: Math.round(finiteInRange(cam.defaultScoreFeedRate, DEFAULT_PREFERENCES.cam.defaultScoreFeedRate, 1, 100_000)),
      defaultRapidFeedRate: Math.round(finiteInRange(cam.defaultRapidFeedRate, DEFAULT_PREFERENCES.cam.defaultRapidFeedRate, 1, 100_000)),
      defaultGcodeDialect: dialect === "grbl" || dialect === "marlin" ? dialect : DEFAULT_PREFERENCES.cam.defaultGcodeDialect,
      defaultBaudRate: Math.round(finiteInRange(cam.defaultBaudRate, DEFAULT_PREFERENCES.cam.defaultBaudRate, 1_200, 2_000_000)),
      machineBedWidthMm: finiteInRange(cam.machineBedWidthMm, DEFAULT_PREFERENCES.cam.machineBedWidthMm, 1, 100_000),
      machineBedHeightMm: finiteInRange(cam.machineBedHeightMm, DEFAULT_PREFERENCES.cam.machineBedHeightMm, 1, 100_000),
      machineUnits: machineUnits === "mm" || machineUnits === "in" ? machineUnits : DEFAULT_PREFERENCES.cam.machineUnits,
      jobOrigin: jobOrigin === "lower-left" || jobOrigin === "center" || jobOrigin === "document" ? jobOrigin : DEFAULT_PREFERENCES.cam.jobOrigin,
    }),
  });
}

function loadPreferences(): VectorPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const value = localStorage.getItem(VECTORA_PREFERENCES_STORAGE_KEY);
    return value ? normalizePreferences(JSON.parse(value) as unknown) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function withDrafting(state: VectorState, updates: Partial<DraftingPreferences>): Pick<VectorState, "preferences"> {
  const previous = state.preferences.drafting;

  // gridSize is expressed in the selected default unit. Convert its numeric
  // value when the unit changes so a 24 mm grid becomes 0.94488 in rather than
  // being silently reinterpreted as 24 inches.
  const convertedGridSize = updates.defaultUnits
    && updates.defaultUnits !== previous.defaultUnits
    && updates.gridSize === undefined
    ? convertDocumentUnitLength(previous.gridSize, previous.defaultUnits, updates.defaultUnits)
    : undefined;
  const nextUpdates: Partial<DraftingPreferences> = convertedGridSize === undefined
    ? updates
    : { ...updates, gridSize: convertedGridSize };

  return {
    preferences: normalizePreferences({
      ...state.preferences,
      drafting: { ...previous, ...nextUpdates },
    }),
  };
}

export const useVectorStore = create<VectorState>((set) => ({
  activeTool: "select",
  fillBucketColor: "#3b82f6",
  viewport: INITIAL_VIEWPORT,
  preferences: loadPreferences(),
  fileMenuOpen: false,
  selectMenuOpen: false,
  lineMenuOpen: false,
  shapeMenuOpen: false,
  commandPaletteOpen: false,
  preferencesOpen: false,
  layersOpen: false,
  propertiesOpen: false,
  temporaryPanActive: false,
  canvasPanning: false,
  nodeEditSelection: null,
  panelPositions: {
    preferences: { x: 0, y: 0 },
    layers: { x: 0, y: 0 },
    cam: { x: 0, y: 0 },
    raster: { x: 0, y: 0 },
    properties: { x: 0, y: 0 },
    selectionActions: { x: 0, y: 0 },
  },
  setActiveTool: (activeTool) => set((state) => ({
    activeTool,
    nodeEditSelection: activeTool === "select" || activeTool === "node-edit" ? state.nodeEditSelection : null,
  })),
  setFillBucketColor: (fillBucketColor) => set({ fillBucketColor }),
  setViewport: (viewport) => set({ viewport }),
  updateDraftingPreferences: (updates) => set((state) => withDrafting(state, updates)),
  updateCanvasPreferences: (updates) => set((state) => ({
    preferences: normalizePreferences({ ...state.preferences, canvas: { ...state.preferences.canvas, ...updates } }),
  })),
  updateCamPreferences: (updates) => set((state) => {
    const synchronized = updates.defaultFeedRate !== undefined && updates.defaultCutFeedRate === undefined
      ? { ...updates, defaultCutFeedRate: updates.defaultFeedRate }
      : updates;
    return { preferences: normalizePreferences({ ...state.preferences, cam: { ...state.preferences.cam, ...synchronized } }) };
  }),
  replacePreferences: (preferences) => set({ preferences: normalizePreferences(preferences) }),
  resetPreferences: () => set({ preferences: DEFAULT_PREFERENCES }),
  toggleOsnapType: (type) => set((state) => {
    const enabled = state.preferences.drafting.osnapEnabledTypes;
    return withDrafting(state, {
      osnapEnabledTypes: enabled.includes(type)
        ? enabled.filter((candidate) => candidate !== type)
        : [...enabled, type],
    });
  }),
  setSnapToGrid: (snapToGrid) => set((state) => withDrafting(state, { snapToGrid })),
  setGridSize: (gridSize) => set((state) => withDrafting(state, { gridSize })),
  setFileMenuOpen: (fileMenuOpen) => set({ fileMenuOpen }),
  setSelectMenuOpen: (selectMenuOpen) => set({ selectMenuOpen }),
  setLineMenuOpen: (lineMenuOpen) => set({ lineMenuOpen }),
  setShapeMenuOpen: (shapeMenuOpen) => set({ shapeMenuOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setTemporaryPanActive: (temporaryPanActive) => set({ temporaryPanActive }),
  setCanvasPanning: (canvasPanning) => set({ canvasPanning }),
  setNodeEditSelection: (nodeEditSelection) => set((state) => {
    const current = state.nodeEditSelection;
    if (current === nodeEditSelection || (
      current && nodeEditSelection &&
      current.entityId === nodeEditSelection.entityId &&
      current.vertexIndex === nodeEditSelection.vertexIndex &&
      current.nodeType === nodeEditSelection.nodeType
    )) return state;
    return { nodeEditSelection };
  }),
  togglePanel: (panel, open) => set((state) => {
    if (panel === "preferences") {
      return { preferencesOpen: open ?? !state.preferencesOpen };
    }
    if (panel === "layers") {
      const layersOpen = open ?? !state.layersOpen;
      return {
        layersOpen,
        propertiesOpen: layersOpen ? false : state.propertiesOpen,
      };
    }
    const propertiesOpen = open ?? !state.propertiesOpen;
    return {
      propertiesOpen,
      layersOpen: propertiesOpen ? false : state.layersOpen,
    };
  }),
  setPanelPosition: (panel, position) => set((state) => ({
    panelPositions: { ...state.panelPositions, [panel]: position },
  })),
  zoomBy: (factor) => set((state) => ({
    viewport: {
      ...state.viewport,
      zoom: Math.min(4, Math.max(0.2, state.viewport.zoom * factor)),
    },
  })),
  resetViewport: () => set({ viewport: INITIAL_VIEWPORT }),
}));

if (typeof window !== "undefined") {
  useVectorStore.subscribe((state, previous) => {
    if (state.preferences === previous.preferences) return;
    try {
      localStorage.setItem(VECTORA_PREFERENCES_STORAGE_KEY, JSON.stringify(state.preferences));
    } catch {
      // Storage may be unavailable in privacy mode; live preferences still work.
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== VECTORA_PREFERENCES_STORAGE_KEY) return;
    if (event.newValue === null) {
      useVectorStore.getState().resetPreferences();
      return;
    }
    try {
      useVectorStore.getState().replacePreferences(normalizePreferences(JSON.parse(event.newValue) as unknown));
    } catch {
      // Ignore malformed values written by older or external clients.
    }
  });
}
