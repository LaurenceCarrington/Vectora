import type { ManufacturingIntent } from "../document/types";

/**
 * Semantic colors for renderers that cannot consume CSS custom properties.
 * Keep these values aligned with the matching --v-color-* tokens in
 * vectora-design-system.css. Physical preview materials intentionally live in
 * their own namespace: they describe stock, not UI or manufacturing state.
 */
export const vectoraRenderColors = Object.freeze({
  ui: Object.freeze({
    selection: "#1d4ed8",
    selectionFill: "rgb(29 78 216 / 10%)",
    selectionGuide: "rgb(29 78 216 / 72%)",
    selectionLabel: "rgb(29 78 216 / 94%)",
    snap: "#137a3a",
    surface: "#ffffff",
    danger: "#b42318",
  }),
  operation: Object.freeze({
    cut: "#2563eb",
    engrave: "#7c3aed",
    score: "#0f766e",
    pocket: "#0e7490",
    raster: "#8b451d",
    construction: "#b45309",
  } satisfies Readonly<Record<ManufacturingIntent, string>>),
  toolpath: Object.freeze({
    rapid: "#64748b",
    leadIn: "#0f766e",
    leadOut: "#c2410c",
    holdingTab: "#c2410c",
    head: "#b42318",
  }),
  machine: Object.freeze({
    position: "#c2410c",
    boundary: "#64748b",
  }),
  preview: Object.freeze({
    background: 0xf3f6fa,
    gridMajor: 0xb8c5d5,
    gridMinor: 0xdbe3ec,
    hemisphereGround: 0x718096,
    fillLight: 0xa9c9ff,
    openCut: 0xb42318,
    openCutEmissive: 0x6f130d,
  }),
  material: Object.freeze({
    woodFace: 0xf2d59c,
    woodEdge: 0x8b5e34,
    clearAcrylicFace: 0xbfe8ff,
    clearAcrylicEdge: 0x69bce8,
    darkAcrylicFace: 0x172033,
    darkAcrylicEdge: 0x070a10,
    aluminumFace: 0xb9c1ca,
    aluminumEdge: 0x737d88,
    cardboardFace: 0xb98b58,
    cardboardEdge: 0x765333,
    burnedWood: 0x352217,
    burnedMetal: 0x20262d,
    burnedAcrylic: 0x111827,
  }),
});

export const vectoraRenderOpacity = Object.freeze({
  plannedToolpath: 0.28,
  completedRapid: 0.72,
  completedToolpath: 0.96,
  previewGrid: 0.46,
  acrylicFace: 0.58,
  acrylicEdge: 0.72,
  darkAcrylicFace: 0.8,
  darkAcrylicEdge: 0.88,
});

export function colorForManufacturingIntent(intent: ManufacturingIntent): string {
  return vectoraRenderColors.operation[intent];
}
