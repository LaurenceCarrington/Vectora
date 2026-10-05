import {generalPreferences,UNIT_NAMES} from './generalPreferences';
import {unitScale} from './canvasSize';
export function displayDecimals(annotation=false):number {return generalPreferences.value.decimals==='auto'?(annotation?2:6):generalPreferences.value.decimals;}
export function formatLength(mm:number,decimals=displayDecimals()):string {return String(Number((mm/unitScale[generalPreferences.value.units]).toFixed(decimals)));}
export function lengthLabel(mm:number):string {return `${formatLength(mm,displayDecimals(true))} ${generalPreferences.value.units}`;}
/** Retain the underlying value so merely visiting a rounded field cannot edit it. */
export function readLength(input:HTMLInputElement):number {
 if(!input.value.trim())return NaN;
 return input.value===input.dataset.lengthDisplay?Number(input.dataset.lengthMM):input.valueAsNumber*Number(input.dataset.lengthScale??1);
}
export function setLength(input:HTMLInputElement,mm:number|null,label?:string,force=false):void {
 if(document.activeElement===input&&!force)return;
 const unit=generalPreferences.value.units,scale=unitScale[unit];
 input.dataset.lengthMM=mm===null?'NaN':String(mm);input.dataset.lengthScale=String(scale);
 input.value=mm===null?'':formatLength(mm);input.dataset.lengthDisplay=input.value;
 const suffix=input.parentElement?.querySelector('.number-unit');if(suffix)suffix.textContent=unit;
 if(label){input.dataset.lengthLabel=label;input.setAttribute('aria-label',`${label} (${UNIT_NAMES[unit]})`);}
 for(const key of ['min','max'] as const)if(input.dataset[`length${key==='min'?'Min':'Max'}`])input[key]=String(Number(input.dataset[`length${key==='min'?'Min':'Max'}`])/scale);
}
export function bindLength(input:HTMLInputElement,label?:string):void {
 if(input.dataset.lengthBound)return;input.dataset.lengthBound='true';
 if(input.min)input.dataset.lengthMin=input.min;if(input.max)input.dataset.lengthMax=input.max;
 if(label)input.dataset.lengthLabel=label;
 input.addEventListener('focus',()=>{const mm=readLength(input),scale=Number(input.dataset.lengthScale??1);if(Number.isFinite(mm)){input.value=String(mm/scale);input.dataset.lengthDisplay=input.value;input.dataset.lengthMM=String(mm);input.select();}});
 input.addEventListener('input',()=>{const mm=readLength(input);input.dataset.lengthMM=String(mm);input.dataset.lengthDisplay=input.value;});
 input.addEventListener('blur',()=>{const mm=readLength(input);if(Number.isFinite(mm)&&input.getAttribute('aria-invalid')!=='true')setLength(input,mm,input.dataset.lengthLabel);});
}
