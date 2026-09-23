import type { ManufacturingIntent } from "../../document/types";

export const MANUFACTURING_INTENT_LABELS: Readonly<Record<ManufacturingIntent, string>> = {
  cut: "Cut",
  engrave: "Vector engrave",
  raster: "Raster engrave",
  score: "Score",
  pocket: "Pocket",
  construction: "Construction",
};

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
