import type paper from 'paper';
export type Shape = paper.Path | paper.CompoundPath;
export type ToolName = 'fill' | 'dimension-aligned' | 'dimension-linear' | 'dimension-radial' | 'dimension-diameter' | 'leader' | 'select' | 'nodes' | 'text' | 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'line' | 'polyline' | 'freehand' | 'arc' | 'arc-three-point' | 'dissect-delete' | 'line-delete';
export type ObjectRole = 'artwork' | 'cutline' | 'engrave' | 'construction';
export interface Vertex { x: number; y: number }
export interface Contour { points: Vertex[]; closed: boolean }
export interface DocumentSnapshot { artwork: string; cutlines: string; selected: string | null; selectedIds?: string[]; layers?: string }
