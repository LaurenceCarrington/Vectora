import type paper from 'paper';
export type Shape = paper.Path | paper.CompoundPath;
export type ToolName = 'fill' | 'dimension-aligned' | 'dimension-linear' | 'dimension-radial' | 'dimension-diameter' | 'leader' | 'select' | 'nodes' | 'text' | 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'polyline' | 'freehand' | 'arc' | 'arc-three-point' | 'arc-endpoints' | 'dissect-delete' | 'line-delete';
export type ObjectRole = 'artwork' | 'cutline' | 'engrave' | 'construction';
export interface Vertex { x: number; y: number }
export interface Contour { points: Vertex[]; closed: boolean }
export interface DocumentSnapshot { activeLayerId?:string; artwork: string; cutlines: string; selected: string | null; selectedIds?: string[]; layers?: string }
