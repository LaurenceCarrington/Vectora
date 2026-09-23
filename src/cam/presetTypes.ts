import type { PocketStrategy } from "./pocketingEngine";
import type { CutLeadOptions } from "./leadGeometry";
/** Physical process settings, independent of the active document units. */
export interface ProcessSettings extends CutLeadOptions {
  /** Explicit spindle speed; never normalized as laser power. */
  readonly spindleRPM?: number;
  /** Physical motion rate in mm/min. Never store document units here. */
  readonly feedRate: number;
  /** Omitted only in legacy version-1 presets; the store normalizes them to mm/min. */
  readonly feedRateUnit?: "mm/min";
  /** Controller power in Vectora's normalized S0-S1000 range. */
  readonly power: number;
  readonly passes: number;
  readonly toolDiameter?: number;
  /** Pocket stepover as a percentage. */
  readonly stepover?: number;
  readonly strategy?: PocketStrategy;
  readonly depth?: number;
  readonly stepdown?: number;
  /** Vector-cut depth below the stock surface, in physical millimetres. */
  readonly cutDepth?: number;
}

export interface PocketProcessSettings extends ProcessSettings {
  readonly toolDiameter: number;
  readonly stepover: number;
  readonly strategy: PocketStrategy;
  readonly depth: number;
  readonly stepdown: number;
}

/** A reusable physical stock and process recipe. */
export interface MaterialPreset {
  readonly id: string;
  readonly name: string;
  readonly thicknessMm: number;
  readonly kerfMm: number;
  readonly cut?: ProcessSettings;
  readonly engrave?: ProcessSettings;
  readonly score?: ProcessSettings;
  readonly pocket?: PocketProcessSettings;
}

export type MaterialPresetDraft = Omit<MaterialPreset, "id"> & { readonly id?: string };
