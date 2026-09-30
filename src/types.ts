import type paper from 'paper';
import type {CanvasSize} from './canvasSize';
export type Shape = paper.Path | paper.CompoundPath;
export type ToolName = 'fill' | 'dimension-aligned' | 'dimension-linear' | 'dimension-radial' | 'dimension-diameter' | 'leader' | 'select' | 'nodes' | 'text' | 'rectangle' | 'circle' | 'ellipse' | 'polygon' | 'star' | 'heart' | 'line' | 'polyline' | 'freehand' | 'arc' | 'arc-three-point' | 'arc-endpoints' | 'dissect-delete' | 'line-delete';
export type ObjectRole = 'artwork' | 'cutline' | 'engrave' | 'construction';
export interface Vertex { x: number; y: number }
export interface Contour { points: Vertex[]; closed: boolean }
export interface DocumentSnapshot { canvasSize?:CanvasSize; activeLayerId?:string; artwork: string; cutlines: string; selected: string | null; selectedIds?: string[]; layers?: string }
export interface EditorSession {
  snapshot:DocumentSnapshot;
  view:{zoom:number;center:[number,number]};
  undo:{before:DocumentSnapshot;after:DocumentSnapshot}[];
  redo:{before:DocumentSnapshot;after:DocumentSnapshot}[];
  tool:ToolName;
}
