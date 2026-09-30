import {GRID_TYPES,type GridConfig,type GridType} from './gridGeometry';
export const GRID_ANGLES=[5,10,15,20,30,45,60,90];
export const DEFAULT_GRID:GridConfig={type:'square',spacing:10,angle:15};
export function validateGridSettings(value:unknown):GridConfig {
 if(value===undefined)return {...DEFAULT_GRID};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid grid settings.');
 const grid=value as Record<string,unknown>;
 if(!GRID_TYPES.includes(grid.type as GridType))throw new Error('Choose a valid grid pattern.');
 if(typeof grid.spacing!=='number'||!Number.isFinite(grid.spacing)||grid.spacing<.1||grid.spacing>1000)throw new Error('Enter a grid size from 0.1 to 1000 mm.');
 if(typeof grid.angle!=='number'||!GRID_ANGLES.includes(grid.angle))throw new Error('Choose a radial angle from the list.');
 return {type:grid.type as GridType,spacing:grid.spacing,angle:grid.angle};
}
