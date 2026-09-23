import { create } from "zustand";
import type { PocketSettings } from "../cam/pocketingEngine";

/** Physical mm settings shared by CAM and 3D, scoped to the document session. */
export interface PhysicalPocketSettings extends PocketSettings { readonly feedRate: number; readonly power: number }
export const DEFAULT_POCKET_SETTINGS: PhysicalPocketSettings = Object.freeze({
  toolDiameter: 3, stepoverPct: 60, strategy: "concentric", depth: 1, stepdown: 0.5, feedRate: 600, power: 1000,
});
export const usePocketSettingsStore = create<{
  readonly byDocument: Readonly<Record<string, PhysicalPocketSettings>>;
  readonly update: (documentId: string, settings: Partial<PhysicalPocketSettings>) => void;
}>((set) => ({ byDocument: {}, update: (documentId, settings) => set((state) => ({
  byDocument: { ...state.byDocument, [documentId]: Object.freeze({ ...(state.byDocument[documentId] ?? DEFAULT_POCKET_SETTINGS), ...settings }) },
})) }));
