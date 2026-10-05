import paper from 'paper';
import type {CADEditor} from './editor';
/** Capture visible document ink without grid, boundary guides or editor handles.
 * Restore every visibility flag synchronously, even if readback fails. */
export function captureArtwork(editor:CADEditor):HTMLCanvasElement {
 if(editor.hasPendingGesture||editor.textEditing)throw new Error('Finish or cancel the current drawing or edit before picking a colour.');
 const documents=new Set<paper.Layer>(editor.documentLayers),layers=paper.project.layers.filter(layer=>!documents.has(layer)),visibility=layers.map(layer=>layer.visible);
 const snapshot=document.createElement('canvas');snapshot.width=editor.canvas.width;snapshot.height=editor.canvas.height;
 try{
  layers.forEach(layer=>layer.visible=false);paper.view.update();
  const context=snapshot.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Canvas colour sampling is unavailable.');context.drawImage(editor.canvas,0,0);
 }finally{layers.forEach((layer,i)=>layer.visible=visibility[i]);paper.view.update();}
 return snapshot;
}
