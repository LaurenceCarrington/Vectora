import type { DocumentUnits } from "../document/types";
import { documentToMachineScale, type PixelPhysicalScale } from "./gcodeCompiler";

/** Millimetres per native document unit; pixels require explicit calibration. */
export function mmPerUnit(units: DocumentUnits, calibration?: PixelPhysicalScale): number {
  return documentToMachineScale(units, "mm", calibration);
}
