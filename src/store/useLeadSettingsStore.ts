import { create } from "zustand";
import { resolveCutLeadSettings, type CutLeadSettings } from "../cam/leadGeometry";

export interface LeadPanelSettings extends CutLeadSettings { readonly cutDepthMm: number }
export const DEFAULT_LEAD_PANEL_SETTINGS: LeadPanelSettings = Object.freeze({ ...resolveCutLeadSettings(), cutDepthMm: 1 });
/** Physical settings retained across CAM panel close/reopen, scoped to a document. */
export const useLeadSettingsStore = create<{
  readonly byDocument: Readonly<Record<string, LeadPanelSettings>>;
  readonly update: (documentId: string, settings: Partial<LeadPanelSettings>) => void;
}>((set) => ({ byDocument: {}, update: (documentId, settings) => set((state) => ({
  byDocument: { ...state.byDocument, [documentId]: Object.freeze({ ...(state.byDocument[documentId] ?? DEFAULT_LEAD_PANEL_SETTINGS), ...settings }) },
})) }));
