import { validatePocketSettings } from "../cam/pocketingEngine";
import { resolveCutLeadSettings } from "../cam/leadGeometry";
import { create } from "zustand";
import type { MaterialPreset, MaterialPresetDraft, ProcessSettings } from "../cam/presetTypes";

export const CAM_PRESET_STORAGE_KEY = "vectora_cam_presets";
const STORAGE_VERSION = 1;

function freezeProcess(settings: ProcessSettings, label: string): ProcessSettings {
  if (settings.spindleRPM !== undefined && (!Number.isFinite(settings.spindleRPM) || settings.spindleRPM <= 0 || settings.spindleRPM > 1_000_000)) throw new RangeError("Spindle rpm must be positive.");
  if (settings.stepdown !== undefined && (!Number.isFinite(settings.stepdown) || settings.stepdown <= 0)) throw new RangeError("Stepdown must be positive.");
  if (settings.feedRateUnit !== undefined && settings.feedRateUnit !== "mm/min") {
    throw new TypeError(`${label} preset feed rate must use mm/min.`);
  }
  if (!Number.isFinite(settings.feedRate) || settings.feedRate <= 0) {
    throw new RangeError(`${label} feed rate in mm/min must be greater than zero.`);
  }
  if (!Number.isFinite(settings.power) || settings.power < 0 || settings.power > 1_000) {
    throw new RangeError(`${label} power must be between 0 and 1000.`);
  }
  if (!Number.isInteger(settings.passes) || settings.passes < 1 || settings.passes > 1_000) {
    throw new RangeError(`${label} passes must be an integer between 1 and 1000.`);
  }
  if (label === "Pocket") validatePocketSettings({ toolDiameter: settings.toolDiameter!, stepoverPct: settings.stepover!, strategy: settings.strategy!, depth: settings.depth!, stepdown: settings.stepdown! });
  const leads = label === "Cut" && (settings.leadIn || settings.leadOut || settings.leadType !== undefined)
    ? resolveCutLeadSettings(settings) : null;
  if (settings.cutDepth !== undefined && (!Number.isFinite(settings.cutDepth) || settings.cutDepth <= 0)) throw new RangeError("Cut depth must be positive.");
  return Object.freeze({
    ...(settings.spindleRPM !== undefined ? { spindleRPM: settings.spindleRPM } : {}),
    ...(settings.stepdown !== undefined ? { stepdown: settings.stepdown } : {}),
    ...(leads ? { ...leads, ...(settings.leadType !== undefined ? { leadType: settings.leadType, leadLength: settings.leadLength ?? 3,
      leadAngle: settings.leadAngle ?? 90, rampAngle: settings.rampAngle ?? 3 } : {}) } : {}),
    ...(settings.cutDepth !== undefined ? { cutDepth: settings.cutDepth } : {}),
    ...(label === "Pocket" ? { toolDiameter: settings.toolDiameter!, stepover: settings.stepover ?? 60, strategy: settings.strategy!, depth: settings.depth!, stepdown: settings.stepdown! } : {}),
    feedRate: settings.feedRate,
    feedRateUnit: "mm/min",
    power: settings.power,
    passes: settings.passes,
  });
}

function freezePreset(preset: MaterialPreset): MaterialPreset {
  const id = preset.id.trim();
  const name = preset.name.trim();
  if (!id) throw new TypeError("Preset id cannot be empty.");
  if (!name) throw new TypeError("Preset name cannot be empty.");
  if (!Number.isFinite(preset.thicknessMm) || preset.thicknessMm <= 0 || preset.thicknessMm > 1_000) {
    throw new RangeError("Material thickness must be greater than zero and no more than 1000 mm.");
  }
  if (!Number.isFinite(preset.kerfMm) || preset.kerfMm < 0 || preset.kerfMm > 100) {
    throw new RangeError("Kerf must be between 0 and 100 mm.");
  }
  if (!preset.cut && !preset.engrave && !preset.score && !preset.pocket) {
    throw new RangeError("A material preset must define at least one process.");
  }
  return Object.freeze({
    id,
    name,
    thicknessMm: preset.thicknessMm,
    kerfMm: preset.kerfMm,
    ...(preset.cut ? { cut: freezeProcess(preset.cut, "Cut") } : {}),
    ...(preset.engrave ? { engrave: freezeProcess(preset.engrave, "Engrave") } : {}),
    ...(preset.pocket ? { pocket: freezeProcess(preset.pocket, "Pocket") as import("../cam/presetTypes").PocketProcessSettings } : {}),
    ...(preset.score ? { score: freezeProcess(preset.score, "Score") } : {}),
  });
}

export const FACTORY_MATERIAL_PRESETS: readonly MaterialPreset[] = Object.freeze([
  freezePreset({
    id: "factory-birch-plywood-3mm-laser",
    name: "3mm Birch Plywood (Laser)",
    thicknessMm: 3,
    kerfMm: 0.15,
    cut: { feedRate: 900, power: 1_000, passes: 1 },
    engrave: { feedRate: 2_400, power: 350, passes: 1 },
    score: { feedRate: 1_800, power: 220, passes: 1 },
  }),
  freezePreset({
    id: "factory-clear-acrylic-5mm-laser",
    name: "5mm Clear Acrylic (Laser)",
    thicknessMm: 5,
    kerfMm: 0.2,
    cut: { feedRate: 500, power: 1_000, passes: 2 },
    engrave: { feedRate: 1_600, power: 320, passes: 1 },
    score: { feedRate: 1_300, power: 200, passes: 1 },
  }),
]);

const FACTORY_IDS = new Set(FACTORY_MATERIAL_PRESETS.map((preset) => preset.id));

export function isFactoryPresetId(id: string): boolean {
  return FACTORY_IDS.has(id);
}

interface PersistedPresetState {
  readonly version: number;
  readonly customPresets: readonly MaterialPreset[];
}

interface PresetState {
  readonly presets: readonly MaterialPreset[];
  readonly activePresetId: string | null;
  addPreset(preset: MaterialPresetDraft): MaterialPreset;
  updatePreset(id: string, updates: Partial<Omit<MaterialPreset, "id">>): MaterialPreset;
  deletePreset(id: string): boolean;
  applyPreset(id: string): MaterialPreset;
  clearAppliedPreset(): void;
}

function createPresetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readCustomPresets(): readonly MaterialPreset[] {
  if (typeof localStorage === "undefined") return Object.freeze([]);
  try {
    const parsed = JSON.parse(localStorage.getItem(CAM_PRESET_STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return Object.freeze([]);
    const record = parsed as Partial<PersistedPresetState>;
    if (record.version !== STORAGE_VERSION || !Array.isArray(record.customPresets)) return Object.freeze([]);
    const custom: MaterialPreset[] = [];
    const ids = new Set<string>(FACTORY_IDS);
    for (const candidate of record.customPresets) {
      try {
        const preset = freezePreset(candidate);
        if (ids.has(preset.id)) continue;
        ids.add(preset.id);
        custom.push(preset);
      } catch {
        // Ignore malformed or obsolete entries without discarding valid presets.
      }
    }
    return Object.freeze(custom);
  } catch {
    return Object.freeze([]);
  }
}

const initialCustomPresets = readCustomPresets();

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: Object.freeze([...FACTORY_MATERIAL_PRESETS, ...initialCustomPresets]),
  activePresetId: null,

  addPreset: (draft) => {
    const preset = freezePreset({ ...draft, id: draft.id?.trim() || createPresetId() });
    if (get().presets.some((candidate) => candidate.id === preset.id)) {
      throw new Error(`Preset "${preset.id}" already exists.`);
    }
    set((state) => ({ presets: Object.freeze([...state.presets, preset]) }));
    return preset;
  },

  updatePreset: (id, updates) => {
    if (isFactoryPresetId(id)) throw new Error("Factory presets are read-only.");
    const current = get().presets.find((preset) => preset.id === id);
    if (!current) throw new Error(`Preset "${id}" does not exist.`);
    const next = freezePreset({ ...current, ...updates, id });
    set((state) => ({
      presets: Object.freeze(state.presets.map((preset) => preset.id === id ? next : preset)),
    }));
    return next;
  },

  deletePreset: (id) => {
    if (isFactoryPresetId(id)) throw new Error("Factory presets cannot be deleted.");
    if (!get().presets.some((preset) => preset.id === id)) return false;
    set((state) => ({
      presets: Object.freeze(state.presets.filter((preset) => preset.id !== id)),
      activePresetId: state.activePresetId === id ? null : state.activePresetId,
    }));
    return true;
  },

  applyPreset: (id) => {
    const preset = get().presets.find((candidate) => candidate.id === id);
    if (!preset) throw new Error(`Preset "${id}" does not exist.`);
    set({ activePresetId: id });
    return preset;
  },

  clearAppliedPreset: () => set({ activePresetId: null }),
}));

if (typeof window !== "undefined") {
  usePresetStore.subscribe((state, previous) => {
    if (state.presets === previous.presets) return;
    const payload: PersistedPresetState = {
      version: STORAGE_VERSION,
      customPresets: state.presets.filter((preset) => !isFactoryPresetId(preset.id)),
    };
    try {
      localStorage.setItem(CAM_PRESET_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Presets remain usable for the session when storage is unavailable.
    }
  });
}
