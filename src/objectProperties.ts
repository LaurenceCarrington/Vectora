import {bindLength,setLength,readLength} from './measurementDisplay';
import {generalPreferences,UNIT_NAMES} from './generalPreferences';
import {unitScale} from './canvasSize';
import {preciseGeometry,type PreciseProperty} from './shapeProperties';
import {CREATION_NAMES} from './shapeCreation';
import type {CADEditor} from './editor';
/** Shares compact creation fields while retaining bounds for arbitrary geometry. */
export class ObjectProperties {
 private measurement:'radius'|'diameter'='radius';
 private signature='';
 private readonly position:HTMLElement;
 private readonly details:HTMLDetailsElement;
 private readonly bounds:HTMLElement;
 private readonly dimensionFields:HTMLElement[];
 private readonly rotation:HTMLElement;
 private readonly arc:HTMLElement;
 constructor(private host:HTMLElement,private editor:CADEditor,private report:(message:string)=>void){
  const find=<T extends HTMLElement>(selector:string)=>host.querySelector<T>(selector)!;
  this.position=find('#property-position-fields');this.details=find('#shape-bounds-details');this.bounds=find('#property-bounds-fields');
  this.dimensionFields=['width','height'].map(key=>find(`#field-${key}`).closest<HTMLElement>('.number-field')!);this.rotation=find('.rotation-field');this.arc=find('#arc-controls');this.details.before(this.arc);
  for(const key of ['radius','length','angle','count'] as const){
   const input=find<HTMLInputElement>(`#shape-${key}`);if(key==='radius'||key==='length')bindLength(input);input.addEventListener('change',()=>{
    try{
     if(!input.value.trim())throw new Error('Enter a number.');
     const value=(key==='radius'||key==='length'?readLength(input):input.valueAsNumber)/(key==='radius'&&this.measurement==='diameter'?2:1);
     editor.setPreciseProperty(key as PreciseProperty,value);input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');
    }catch(error){input.setAttribute('aria-invalid','true');input.closest('.number-shell')!.classList.add('is-invalid');report(error instanceof Error?error.message:String(error));}
   });
  }
  find<HTMLSelectElement>('#shape-measurement').onchange=event=>{this.measurement=(event.target as HTMLSelectElement).value as 'radius'|'diameter';this.render(true);};
 }
 render(forceMeasurement=false):void {
  const find=<T extends HTMLElement>(selector:string)=>this.host.querySelector<T>(selector)!,selected=this.editor.selected,geometry=preciseGeometry(selected);
  const signature=`${selected?.data.uid??''}:${geometry?.kind??''}`;
  if(signature!==this.signature){this.signature=signature;this.measurement='radius';find<HTMLSelectElement>('#shape-measurement').value='radius';this.details.open=false;}
  find('#properties-edit-title').textContent=geometry?`Edit ${CREATION_NAMES[geometry.kind]}`:this.editor.selectedItems.length>1?'Edit selection':`Edit ${selected?.data.name??'object'}`;
  find('#property-coordinate-help').textContent=geometry?(geometry.kind==='line'?'X/Y is the start point. Angles run clockwise.':'X/Y is the centre. Angles run clockwise.'):'X/Y is the top-left of the bounds. Dimensions are axis-aligned.';
  this.details.hidden=!geometry;
  for(const field of [...this.dimensionFields,this.rotation]){const target=geometry?this.bounds:this.position;if(field.parentElement!==target)target.append(field);}
  find('#shape-properties').hidden=!geometry||geometry.kind==='arc';find('#shape-measurement-field').hidden=geometry?.kind!=='circle';
  const diameter=this.measurement==='diameter',countName=geometry?.kind==='star'?'Points':'Sides';
  find('#shape-radius-label').textContent=diameter?'Diameter':'Radius';find('#shape-radius').previousElementSibling!.textContent=diameter?'Ø':'R';find('#shape-count-label').textContent=countName;
  for(const key of ['radius','length','angle','count'] as const){
   const input=find<HTMLInputElement>(`#shape-${key}`),visible=geometry?.kind!=='arc'&&geometry?.[key]!==undefined;
   input.closest<HTMLElement>('[data-precise-field]')!.hidden=!visible;
   input.disabled=!this.editor.canFlipSelection;
   input.setAttribute('aria-label',key==='radius'?`${diameter?'Diameter':'Radius'} (${UNIT_NAMES[generalPreferences.value.units]})`:key==='count'?countName:key==='length'?`Length (${UNIT_NAMES[generalPreferences.value.units]})`:'Angle (degrees)');
   if(key==='radius'){input.dataset.lengthMin=diameter?'0.002':'0.001';input.min=String((diameter?.002:.001)/unitScale[generalPreferences.value.units]);}
   if(document.activeElement!==input||forceMeasurement&&key==='radius'){if(key==='radius'||key==='length')setLength(input,visible?geometry![key]!*(key==='radius'&&diameter?2:1):null,key==='length'?'Length':diameter?'Diameter':'Radius',forceMeasurement);else input.value=visible?String(Number(geometry![key]!.toFixed(6))):'';input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');}
  }
  if(geometry)for(const key of ['x','y'] as const){const input=find<HTMLInputElement>(`#field-${key}`);input.disabled=!this.editor.canFlipSelection;if(document.activeElement!==input)setLength(input,geometry[key],key==='x'?'X position':'Y position');}
  find('#property-rotation-label').textContent=this.editor.selectedItems.length>1?'Rotate by angle':'Rotation';
 }
}
