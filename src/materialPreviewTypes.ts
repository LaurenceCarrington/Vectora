export interface PreviewPoint {
    x: number;
    y: number;
}
export type PreviewLoop = PreviewPoint[];
export interface PreviewMark {
    contours: {
        points: PreviewLoop;
        closed: boolean;
    }[];
    filled: boolean;
    evenOdd: boolean;
    width: number;
    role: 'vector' | 'raster' | 'cut';
    path: string;
}
export interface MaterialPreviewInput {
    cuts: PreviewLoop[];
    marks: PreviewMark[];
    artworkSVG: string | null;
}
export interface ProcessSettings {
    thickness: number;
    vectorDepth: number;
    rasterDepth: number;
    openCutDepth: number;
}
export interface PreviewRegion {
    outer: PreviewLoop;
    holes: PreviewLoop[];
}
export interface PreviewVolume {
    bottom: number;
    top: number;
    regions: PreviewRegion[];
    topRegions?: PreviewRegion[];
}
export interface MaterialPreviewModel {
    volumes: PreviewVolume[];
    regions: PreviewRegion[];
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    pieces: number;
    holes: number;
    stock: boolean;
    openCuts: number;
}
