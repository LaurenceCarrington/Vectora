import { create } from "zustand";

export type CutterType = "endmill" | "ballnose" | "vbit" | "laser";
export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: CutterType;
  readonly diameter: number;
  readonly flutes: number;
  readonly angle: number;
  readonly maxStepdown: number;
  /** Fraction, not a percentage. */
  readonly defaultStepover: number;
  readonly recommendedFeed: number;
  readonly recommendedRPM: number;
  readonly chipLoad: number;
}
export type ToolDraft = Omit<ToolDefinition, "id"> & { readonly id?: string };
export const TOOL_STORAGE_KEY = "vectora_tools";

/** mm/min = revolutions/min * teeth/revolution * mm/tooth. */
export function calculateFeedRate(rpm: number, flutes: number, chipLoad: number): number {
  if (!Number.isFinite(rpm) || rpm <= 0 || !Number.isInteger(flutes) || flutes < 1 || !Number.isFinite(chipLoad) || chipLoad <= 0) throw new RangeError("Spindle speed, flute count and chip load must be greater than zero.");
  const feed = rpm * flutes * chipLoad;
  if (!Number.isFinite(feed)) throw new RangeError("Calculated feed is too large.");
  return feed;
}
export function calculateChipLoad(feed: number, rpm: number, flutes: number): number {
  if (!Number.isFinite(feed) || feed <= 0) throw new RangeError("Feed must be positive.");
  return feed / calculateFeedRate(rpm, flutes, 1);
}

/** Editing feed solves chip load; editing any other cutting input solves feed. */
export function recalculateTool<T extends Omit<ToolDefinition, "id">>(tool: T, changed: "recommendedFeed" | "recommendedRPM" | "flutes" | "chipLoad"): T {
  if (tool.type === "laser") return { ...tool, flutes: 0, recommendedRPM: 0, chipLoad: 0, maxStepdown: 0, angle: 0 };
  return changed === "recommendedFeed"
    ? { ...tool, chipLoad: calculateChipLoad(tool.recommendedFeed, tool.recommendedRPM, tool.flutes) }
    : { ...tool, recommendedFeed: calculateFeedRate(tool.recommendedRPM, tool.flutes, tool.chipLoad) };
}
export function validateTool(tool: ToolDefinition): ToolDefinition {
  if (typeof tool.id !== "string" || !tool.id.trim() || tool.id.length > 120 || typeof tool.name !== "string" || !tool.name.trim() || tool.name.length > 120) throw new TypeError("Tool id and name are required (maximum 120 characters).");
  if (!["endmill", "ballnose", "vbit", "laser"].includes(tool.type)) throw new TypeError("Unknown cutter type.");
  const values = [tool.diameter, tool.flutes, tool.angle, tool.maxStepdown, tool.defaultStepover, tool.recommendedFeed, tool.recommendedRPM, tool.chipLoad];
  if (!values.every(Number.isFinite)) throw new TypeError("Cutter dimensions and cutting parameters must be finite.");
  if (tool.diameter <= 0 || tool.diameter > 1000 || tool.recommendedFeed <= 0 || tool.recommendedFeed > 1_000_000 || tool.defaultStepover < 0 || tool.defaultStepover > 1) throw new RangeError("Invalid diameter, feed or stepover fraction.");
  if (tool.type === "laser") {
    if (tool.flutes !== 0 || tool.recommendedRPM !== 0 || tool.chipLoad !== 0 || tool.maxStepdown !== 0 || tool.angle !== 0) throw new RangeError("Lasers use zero flutes, rpm, chip load, angle and stepdown.");
  } else {
    if (!Number.isInteger(tool.flutes) || tool.flutes < 1 || tool.flutes > 100 || tool.recommendedRPM <= 0 || tool.recommendedRPM > 1_000_000 || tool.maxStepdown <= 0 || tool.maxStepdown > 1000) throw new RangeError("Check the flute count, rpm and maximum stepdown.");
    const feed = calculateFeedRate(tool.recommendedRPM, tool.flutes, tool.chipLoad);
    if (Math.abs(feed - tool.recommendedFeed) > 1e-6 * Math.max(1, feed)) throw new RangeError("Feed must equal rpm × flutes × chip load.");
    if (tool.type === "vbit" ? tool.angle <= 0 || tool.angle >= 180 : tool.angle !== 0) throw new RangeError("V-bits require an included angle between 0° and 180°; other cutters use zero.");
  }
  return Object.freeze({ id: tool.id.trim(), name: tool.name.trim(), type: tool.type, diameter: tool.diameter, flutes: tool.flutes, angle: tool.angle, maxStepdown: tool.maxStepdown,
    defaultStepover: tool.defaultStepover, recommendedFeed: tool.recommendedFeed, recommendedRPM: tool.recommendedRPM, chipLoad: tool.chipLoad });
}
// Editable copies are starting examples, not material-specific manufacturer recipes.
export const FACTORY_TOOLS: readonly ToolDefinition[] = Object.freeze([
  validateTool({ id: "factory-endmill-1-8", name: '1/8" Flat End Mill', type: "endmill", diameter: 3.175, flutes: 2, angle: 0, maxStepdown: 1, defaultStepover: 0.6, recommendedFeed: 600, recommendedRPM: 12000, chipLoad: 0.025 }),
  validateTool({ id: "factory-endmill-1-4", name: '1/4" Flat End Mill', type: "endmill", diameter: 6.35, flutes: 2, angle: 0, maxStepdown: 2, defaultStepover: 0.6, recommendedFeed: 1200, recommendedRPM: 12000, chipLoad: 0.05 }),
  validateTool({ id: "factory-vbit-60", name: "60° V-Carve Bit", type: "vbit", diameter: 6, flutes: 2, angle: 60, maxStepdown: 0.5, defaultStepover: 0.3, recommendedFeed: 480, recommendedRPM: 12000, chipLoad: 0.02 }),
  validateTool({ id: "factory-ballnose-3", name: "3mm Ball Nose", type: "ballnose", diameter: 3, flutes: 2, angle: 0, maxStepdown: 0.5, defaultStepover: 0.3, recommendedFeed: 480, recommendedRPM: 12000, chipLoad: 0.02 }),
  validateTool({ id: "factory-laser-1-5", name: "1.5mm Laser Diode", type: "laser", diameter: 1.5, flutes: 0, angle: 0, maxStepdown: 0, defaultStepover: 0.6, recommendedFeed: 1800, recommendedRPM: 0, chipLoad: 0 }),
]);
export const isFactoryToolId = (id: string): boolean => FACTORY_TOOLS.some(tool => tool.id === id);
export interface ToolStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface ToolState {
  readonly selectedByDocument: Readonly<Record<string, ToolDefinition | null>>;
  selectTool(documentId: string, tool: ToolDefinition | null): void;
  readonly tools: readonly ToolDefinition[];
  readonly storageError: string | null;
  addTool(draft: ToolDraft): ToolDefinition;
  updateTool(id: string, patch: Partial<Omit<ToolDefinition, "id">>): ToolDefinition;
  deleteTool(id: string): boolean;
}
function browserStorage(): ToolStorage | undefined {
  // Resolve storage lazily so blocked browser storage is reported on save.
  return typeof window === "undefined" ? undefined : {
    getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value),
  };
}
export function createToolStore(storage: ToolStorage | undefined = browserStorage()) {
  let custom: ToolDefinition[] = [];
  let storageError: string | null = null;
  try {
    const data: unknown = JSON.parse(storage?.getItem(TOOL_STORAGE_KEY) ?? "null");
    if (data && typeof data === "object" && "version" in data && data.version === 1 && "tools" in data && Array.isArray(data.tools)) {
      const ids = new Set(FACTORY_TOOLS.map(t => t.id));
      for (const candidate of data.tools.slice(0, 1000)) {
        try { const tool = validateTool(candidate); if (!ids.has(tool.id)) { ids.add(tool.id); custom.push(tool); } } catch { /* Retain other valid records. */ }
      }
    }
  } catch { storageError = "Saved cutters could not be read. Cutters remain available for this session."; }
  return create<ToolState>((set, get) => {
    const commit = (tools: readonly ToolDefinition[]) => {
      let error: string | null = null;
      try { storage?.setItem(TOOL_STORAGE_KEY, JSON.stringify({ version: 1, tools: tools.filter(t => !isFactoryToolId(t.id)) })); }
      catch { error = "Cutters could not be saved to browser storage. Changes are available for this session only."; }
      const ids = new Set(tools.map(tool => tool.id));
      set(state => ({ tools: Object.freeze([...tools]), storageError: error,
        selectedByDocument: Object.fromEntries(Object.entries(state.selectedByDocument).map(([id, tool]) => [id, tool && ids.has(tool.id) ? tool : null])) }));
    };
    return {
      tools: Object.freeze([...FACTORY_TOOLS, ...custom]), storageError,
      selectedByDocument: {},
      selectTool(documentId, tool) { set(state => ({ selectedByDocument: { ...state.selectedByDocument, [documentId]: tool ? validateTool(tool) : null } })); },
      addTool(draft) {
        const tool = validateTool({ ...draft, id: draft.id ?? globalThis.crypto.randomUUID() });
        if (get().tools.some(t => t.id === tool.id)) throw new Error("A tool with this id already exists.");
        if (get().tools.length >= FACTORY_TOOLS.length + 1000) throw new RangeError("The library supports up to 1000 custom tools.");
        commit([...get().tools, tool]); return tool;
      },
      updateTool(id, patch) {
        if (isFactoryToolId(id)) throw new Error("Factory cutters are read-only. Save a copy to customise it.");
        const current = get().tools.find(t => t.id === id);
        if (!current) throw new Error("Tool does not exist.");
        const changed = patch.recommendedFeed !== undefined && patch.chipLoad === undefined && patch.recommendedRPM === undefined && patch.flutes === undefined ? "recommendedFeed" : "chipLoad";
        const tool = validateTool(recalculateTool({ ...current, ...patch, id }, changed));
        commit(get().tools.map(t => t.id === id ? tool : t)); return tool;
      },
      deleteTool(id) {
        if (isFactoryToolId(id)) throw new Error("Factory cutters cannot be deleted.");
        if (!get().tools.some(t => t.id === id)) return false;
        commit(get().tools.filter(t => t.id !== id)); return true;
      },
    };
  });
}
export const useToolStore = createToolStore();
