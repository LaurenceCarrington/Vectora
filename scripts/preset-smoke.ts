import type { MaterialPreset } from "../src/cam/presetTypes";

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

function expectThrow(operation: () => unknown, message: string): void {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(message);
}

const hydratedPreset: MaterialPreset = {
  id: "saved-maple",
  name: "4mm Maple",
  thicknessMm: 4,
  kerfMm: 0.17,
  cut: { feedRate: 700, power: 950, passes: 2 },
};
const storage = new MemoryStorage();
storage.setItem("vectora_cam_presets", JSON.stringify({
  version: 1,
  customPresets: [
    hydratedPreset,
    { ...hydratedPreset, id: "factory-birch-plywood-3mm-laser" },
    { ...hydratedPreset, id: "invalid", cut: { feedRate: 0, power: 4_000, passes: 0 } },
  ],
}));
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const [{ usePresetStore, FACTORY_MATERIAL_PRESETS }, { createDefaultProcesses }] = await Promise.all([
  import("../src/store/usePresetStore"),
  import("../src/cam/processModel"),
]);

assert(usePresetStore.getState().presets.length === FACTORY_MATERIAL_PRESETS.length + 1, "Preset hydration did not retain exactly one valid custom preset.");
assert(FACTORY_MATERIAL_PRESETS.every(Object.isFrozen), "Factory presets are not immutable.");
assert(usePresetStore.getState().presets.find((preset) => preset.id === hydratedPreset.id)?.cut?.feedRateUnit === "mm/min", "Legacy preset hydration did not normalize physical feed units.");
expectThrow(
  () => usePresetStore.getState().addPreset({ ...hydratedPreset, id: "wrong-units", cut: { feedRate: 700, feedRateUnit: "in/min" as "mm/min", power: 950, passes: 2 } }),
  "Preset store accepted a feed rate with incompatible physical units.",
);
expectThrow(
  () => usePresetStore.getState().updatePreset(FACTORY_MATERIAL_PRESETS[0]!.id, { name: "Changed" }),
  "Factory preset update was allowed.",
);
expectThrow(
  () => usePresetStore.getState().deletePreset(FACTORY_MATERIAL_PRESETS[0]!.id),
  "Factory preset deletion was allowed.",
);

const added = usePresetStore.getState().addPreset({
  name: "3mm Test Stock",
  thicknessMm: 3,
  kerfMm: 0.14,
  cut: { feedRate: 820, power: 900, passes: 3 },
  engrave: { feedRate: 2_100, power: 300, passes: 2 },
  score: { feedRate: 1_600, power: 180, passes: 1 },
});
assert(usePresetStore.getState().applyPreset(added.id).id === added.id, "Preset apply did not return the selected preset.");
assert(usePresetStore.getState().activePresetId === added.id, "Preset apply did not update activePresetId.");

const updated = usePresetStore.getState().updatePreset(added.id, { kerfMm: 0.19 });
assert(updated.kerfMm === 0.19, "Custom preset update failed.");
const persisted = JSON.parse(storage.getItem("vectora_cam_presets") ?? "null") as { customPresets?: MaterialPreset[] } | null;
assert(persisted?.customPresets?.some((preset) => preset.id === added.id && preset.kerfMm === 0.19), "Custom preset was not persisted.");

const processes = createDefaultProcesses({
  cutFeedRate: added.cut!.feedRate,
  cutPower: added.cut!.power,
  cutPasses: added.cut!.passes,
  engraveFeedRate: added.engrave!.feedRate,
  engravePower: added.engrave!.power,
  engravePasses: added.engrave!.passes,
  scoreFeedRate: added.score!.feedRate,
  scorePower: added.score!.power,
  scorePasses: added.score!.passes,
});
assert(processes.find((process) => process.id === "vector-cut")?.passes === 3, "Cut passes did not reach the process model.");
assert(processes.find((process) => process.id === "vector-engrave")?.passes === 2, "Engrave passes did not reach the process model.");

assert(usePresetStore.getState().deletePreset(added.id), "Custom preset deletion failed.");
assert(usePresetStore.getState().activePresetId === null, "Deleting the active preset did not clear its selection.");
assert(!usePresetStore.getState().presets.some((preset) => preset.id === added.id), "Deleted preset remains in the store.");

console.log("CAM preset hydration, immutability, validation, CRUD, apply, persistence, and process propagation checks passed.");
