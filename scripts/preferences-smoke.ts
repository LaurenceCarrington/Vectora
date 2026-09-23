import type { LineEntity } from "../src/document/types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const storage = new MemoryStorage();
storage.setItem("vectora_preferences", JSON.stringify({
  drafting: {
    osnapEnabledTypes: ["endpoint", "invalid", "endpoint"],
    osnapRadiusPx: 500,
    angleSnapDeg: -2,
    gridStyle: "triangles",
    defaultUnits: "yards",
    decimalPrecision: 9,
  },
  canvas: { themeMode: "dark-cad", cursorStyle: "crosshair", showFpsOverlay: true },
  cam: {
    defaultKerfMm: 0.2,
    defaultFeedRate: 1_250,
    defaultCutFeedRate: 1_300,
    defaultEngraveFeedRate: 2_700,
    defaultScoreFeedRate: 1_900,
    defaultRapidFeedRate: 7_500,
    defaultGcodeDialect: "marlin",
    defaultBaudRate: 250_000,
    machineBedWidthMm: 600,
    machineBedHeightMm: 400,
    machineUnits: "in",
    jobOrigin: "center",
  },
}));
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { addEventListener: () => undefined },
});

const [
  { useVectorStore, DEFAULT_PREFERENCES, gridSizeInDocumentUnits, normalizePreferences },
  {
    findObjectSnap,
    getWorldGridSpacing,
    resolveDraftingSnap,
    snapWorldCoordinate,
    snapWorldDeltaToGrid,
    snapWorldPointToGrid,
  },
] = await Promise.all([
  import("../src/store/useVectorStore"),
  import("../src/geometry/Snapping"),
]);

let preferences = useVectorStore.getState().preferences;
assert(preferences.canvas.themeMode === "dark-cad", "Stored theme did not hydrate.");
assert(preferences.drafting.osnapRadiusPx === 40, "OSNAP radius was not clamped.");
assert(preferences.drafting.angleSnapDeg === 1, "Angle snap was not clamped.");
assert(preferences.drafting.decimalPrecision === 4, "Decimal precision was not clamped.");
assert(preferences.drafting.defaultUnits === "mm", "Invalid units did not fall back.");
assert(preferences.drafting.gridStyle === "lines", "Invalid grid style did not fall back.");
assert(preferences.drafting.gridVisible, "Missing grid visibility did not default to visible.");
const legacyHiddenGrid = normalizePreferences({ drafting: { gridStyle: "none", snapToGrid: true } });
assert(legacyHiddenGrid.drafting.gridStyle === "lines" && !legacyHiddenGrid.drafting.gridVisible && legacyHiddenGrid.drafting.snapToGrid,
  "Legacy hidden-grid preferences lost independent snapping during migration.");
assert(preferences.drafting.osnapEnabledTypes.length === 1 && preferences.drafting.osnapEnabledTypes[0] === "endpoint", "OSNAP types were not sanitized.");
assert(preferences.cam.defaultCutFeedRate === 1_300 && preferences.cam.defaultFeedRate === 1_300, "Cut feed preference did not hydrate with its compatibility alias.");
assert(preferences.cam.defaultEngraveFeedRate === 2_700 && preferences.cam.defaultScoreFeedRate === 1_900 && preferences.cam.defaultRapidFeedRate === 7_500, "Process feed defaults did not hydrate.");
assert(preferences.cam.defaultBaudRate === 250_000 && preferences.cam.defaultGcodeDialect === "marlin", "Controller defaults did not hydrate.");
assert(preferences.cam.machineBedWidthMm === 600 && preferences.cam.machineBedHeightMm === 400, "Machine bed defaults did not hydrate.");
assert(preferences.cam.machineUnits === "in" && preferences.cam.jobOrigin === "center", "Machine coordinate defaults did not hydrate.");

const originalGridSizeMm = preferences.drafting.gridSize;
useVectorStore.getState().updateDraftingPreferences({ defaultUnits: "in" });
preferences = useVectorStore.getState().preferences;
assert(preferences.drafting.defaultUnits === "in", "Default document units were not updated.");
assert(Math.abs(preferences.drafting.gridSize - originalGridSizeMm / 25.4) < 1e-9, "Grid spacing was not converted to inches.");
assert(Math.abs(gridSizeInDocumentUnits(preferences.drafting, "mm") - originalGridSizeMm) < 1e-9, "Grid spacing did not resolve back into active document units.");
assert(Math.abs(getWorldGridSpacing() - originalGridSizeMm) < 1e-9, "Live grid spacing did not resolve in document/world units.");

useVectorStore.getState().updateDraftingPreferences({ gridSize: 10 / 25.4 });
const snapped = snapWorldPointToGrid({ x: 14.9, y: -15.1 });
assert(snapped.x === 10 && snapped.y === -20, "Grid snapping did not round pure world coordinates to the configured lattice.");
assert(snapWorldCoordinate(-0.1) === 0, "Grid snapping exposed a negative-zero origin.");

// Moving must quantize the displacement, not the absolute mouse coordinate.
// The arbitrary point at which the user grabbed the object must not alter the
// object's phase relative to the global grid lattice.
const snappedMove = snapWorldDeltaToGrid({ x: 26.6 - 3.4, y: 28.1 - 7.2 });
assert(snappedMove.x === 20 && snappedMove.y === 20, "Move translation did not preserve grid alignment.");
assert(10 + snappedMove.x === 30 && 20 + snappedMove.y === 40, "Moving an aligned object shifted it off-grid.");

// A snapped world point and its rendered grid line must resolve to the same
// CSS and backing-buffer coordinate under arbitrary pan, zoom, and DPR.
const viewport = { x: 37.25, y: -18.5, zoom: 1.75 };
const canvas = { width: 1_137, height: 743, dpr: 2 };
const originX = canvas.width / 2 + viewport.x;
const originY = canvas.height / 2 + viewport.y;
const screenStep = getWorldGridSpacing() * viewport.zoom;
const offsetX = ((originX % screenStep) + screenStep) % screenStep;
const offsetY = ((originY % screenStep) + screenStep) % screenStep;
const snappedScreenX = originX + snapped.x * viewport.zoom;
const snappedScreenY = originY - snapped.y * viewport.zoom;
const xGridIndex = Math.round((snappedScreenX - offsetX) / screenStep);
const yGridIndex = Math.round((snappedScreenY - offsetY) / screenStep);
assert(Math.abs(snappedScreenX - (offsetX + xGridIndex * screenStep)) < 1e-9, "Pan/zoom shifted snapped X away from its rendered grid line.");
assert(Math.abs(snappedScreenY - (offsetY + yGridIndex * screenStep)) < 1e-9, "Pan/zoom shifted snapped Y away from its rendered grid line.");
assert(
  snappedScreenX * canvas.dpr === (offsetX + xGridIndex * screenStep) * canvas.dpr,
  "DPR scaling shifted geometry away from the rendered grid.",
);

const snapStyle = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const offGridLine: LineEntity = {
  id: "off-grid-endpoint",
  type: "line",
  layerId: "layer",
  intent: "construction",
  style: snapStyle,
  bbox: { minX: 3, minY: 3, maxX: 6, maxY: 3.0001 },
  visible: true,
  locked: false,
  start: { x: 3, y: 3 },
  end: { x: 6, y: 3 },
};
const gridAuthoritative = resolveDraftingSnap({
  cursor: offGridLine.start,
  zoom: 1,
  entities: [offGridLine],
});
assert(gridAuthoritative.point.x === 0 && gridAuthoritative.point.y === 0, "An off-grid OSNAP candidate overrode Grid Snap.");
assert(gridAuthoritative.snap === null, "An off-grid object candidate was incorrectly advertised as acquired.");

const onGridLine: LineEntity = {
  ...offGridLine,
  id: "on-grid-endpoint",
  bbox: { minX: 10, minY: 10, maxX: 13, maxY: 10.0001 },
  start: { x: 10, y: 10 },
  end: { x: 13, y: 10 },
};
const compatibleObjectSnap = resolveDraftingSnap({
  cursor: onGridLine.start,
  zoom: 1,
  entities: [onGridLine],
});
assert(compatibleObjectSnap.point.x === 10 && compatibleObjectSnap.point.y === 10, "An on-grid endpoint was not acquired.");
assert(compatibleObjectSnap.snap?.type === "endpoint", "A grid-compatible OSNAP candidate lost its snap identity.");

useVectorStore.getState().updateDraftingPreferences({
  osnapEnabledTypes: ["midpoint"],
  osnapRadiusPx: 4,
  gridVisible: false,
  gridStyle: "isometric",
});
const persisted = JSON.parse(storage.getItem("vectora_preferences") ?? "null") as { drafting?: { osnapRadiusPx?: number; gridStyle?: string; gridVisible?: boolean } } | null;
assert(persisted?.drafting?.osnapRadiusPx === 4, "Preference updates were not persisted.");
assert(persisted?.drafting?.gridStyle === "isometric", "Grid style was not persisted.");
assert(persisted?.drafting?.gridVisible === false, "Grid visibility was not persisted separately from style.");

const line: LineEntity = {
  id: "snap-line",
  type: "line",
  layerId: "layer",
  intent: "construction",
  style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
  visible: true,
  locked: false,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};
assert(findObjectSnap({ cursor: { x: 1, y: 0 }, zoom: 1, entities: [line] }) === null, "Disabled endpoint OSNAP was still acquired.");
assert(findObjectSnap({ cursor: { x: 50, y: 2 }, zoom: 1, entities: [line] })?.type === "midpoint", "Enabled midpoint OSNAP was not acquired.");

useVectorStore.getState().updateDraftingPreferences({ osnapEnabledTypes: ["endpoint"] });
assert(findObjectSnap({ cursor: { x: 5, y: 0 }, zoom: 1, entities: [line] }) === null, "Custom OSNAP radius was ignored.");
assert(findObjectSnap({ cursor: { x: 3, y: 0 }, zoom: 1, entities: [line] })?.type === "endpoint", "Endpoint inside the custom pickup radius was missed.");

useVectorStore.getState().resetPreferences();
preferences = useVectorStore.getState().preferences;
assert(preferences.drafting.osnapRadiusPx === DEFAULT_PREFERENCES.drafting.osnapRadiusPx, "Reset did not restore drafting defaults.");
assert(preferences.canvas.themeMode === "light-glass", "Reset did not restore the default theme.");
assert(preferences.cam.defaultBaudRate === 115_200 && preferences.cam.machineBedWidthMm === 300, "Reset did not restore machine defaults.");

console.log("Preference hydration, validation, persistence, reset, OSNAP filtering, and pickup-radius checks passed.");
