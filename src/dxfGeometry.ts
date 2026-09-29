import {createTextShape,isStrokeFont} from './text';
import {flattenInDocument} from './geometry';
import type {Shape} from './types';

/** Both DXF formats share the same document-space curve tolerance and font geometry. */
export function exportContours(object:Shape){
 if(!object.data.text||!isStrokeFont(object.data.text.fontId))return flattenInDocument(object);
 const strokes=createTextShape(object.data.text,true);
 try{return flattenInDocument(strokes);}finally{strokes.remove();}
}
