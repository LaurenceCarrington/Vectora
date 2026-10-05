import {buildCreationShape,creationFields,creationKind,CREATION_NAMES,CreationError,type CreationKind} from './shapeCreation';
import type {LineDesign} from './lineAppearance';
import type {Shape,ToolName} from './types';
interface CreationContext {tool:ToolName;selection:string;pending:boolean;centre:{x:number;y:number};sides:number;points:number;layer:{name:string;colour:string;error?:string}}
interface CreationModel {context():CreationContext;insert(shape:Shape,name:string):void;cancel():void}
/** Draft fields live outside document geometry and reuse the Properties design tokens. */
export class ObjectCreation {
 readonly element=document.createElement('form');
 private kind:CreationKind|null=null;
 private tool:ToolName='select';
 private selection='';
 private resumeTool:ToolName|null=null;
 private measurement:'radius'|'diameter'='radius';
 private inputs=new Map<string,HTMLInputElement>();
 private error:HTMLElement|null=null;
 private destination:HTMLElement|null=null;
 private submitButton:HTMLButtonElement|null=null;
 constructor(host:HTMLElement,private model:CreationModel){
  this.element.className='object-creation';this.element.hidden=true;this.element.noValidate=true;host.prepend(this.element);
  this.element.onsubmit=event=>{event.preventDefault();event.stopPropagation();this.submit();};
  this.element.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.stop();model.cancel();}};
 }
 get active():boolean {return this.kind!==null;}
 start(tool:ToolName):void {
  this.resumeTool=null;
  const kind=creationKind(tool);if(!kind){this.stop();return;}
  const context=this.model.context();this.kind=kind;this.tool=tool;this.selection=context.selection;this.measurement='radius';this.inputs.clear();
  this.element.replaceChildren();this.element.hidden=false;this.element.setAttribute('aria-label',`Create ${CREATION_NAMES[kind]}`);
  const heading=document.createElement('h3');heading.textContent=`Create ${CREATION_NAMES[kind]}`;this.element.append(heading);
  const hint=document.createElement('p');hint.className='subtext';hint.textContent=kind==='line'?'X/Y is the start point. Angles run clockwise.':kind==='rectangle'||kind==='ellipse'||kind==='heart'?'X/Y is the top-left corner.':'X/Y is the centre. Angles run clockwise.';this.element.append(hint);
  const grid=document.createElement('div');grid.className='number-grid creation-fields';this.element.append(grid);
  for(const field of creationFields(kind,context.centre,context.sides,context.points)){
   const wrapper=document.createElement('div');wrapper.className=`creation-field${field.key==='weight'?' creation-full-width':''}`;
   const id=`${this.element.parentElement!.id||'creation'}-new-${field.key}`;
   wrapper.innerHTML=`<label class="creation-label" for="${id}">${field.label}</label><div class="number-shell"><span class="number-prefix">${field.prefix}</span><input class="number-input" id="${id}" type="number" step="${field.integer?'1':'any'}" aria-label="${field.name}" aria-invalid="false"><span class="number-unit">${field.unit}</span></div>`;
   const input=wrapper.querySelector('input')!;input.value=String(Number(field.value.toFixed(6)));if(field.min!==undefined)input.min=String(field.min);if(field.max!==undefined)input.max=String(field.max);input.required=true;
   input.oninput=()=>{input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');if(this.error&&!this.model.context().layer.error)this.error.hidden=true;};
   this.inputs.set(field.key,input);grid.append(wrapper);
  }
  const styles=document.createElement('div');styles.className='creation-field creation-full-width';styles.innerHTML='<label class="creation-label">Line style<select class="number-input" aria-label="Line style"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="dash-dot">Dash-dot</option></select></label>';grid.insertBefore(styles,grid.querySelector('.creation-full-width'));
  if(kind==='circle'){
   const wrapper=document.createElement('label');wrapper.className='creation-measurement';wrapper.innerHTML='<span class="creation-label">Measurement</span><select class="number-input" aria-label="Circle measurement"><option value="radius">Radius</option><option value="diameter">Diameter</option></select>';this.element.insertBefore(wrapper,grid);
   const select=wrapper.querySelector('select')!;select.onchange=()=>{
    const next=select.value as 'radius'|'diameter',input=this.inputs.get('radius')!,value=input.valueAsNumber;
    if(Number.isFinite(value)&&next!==this.measurement)input.value=String(value*(next==='diameter'?2:.5));this.measurement=next;
    input.setAttribute('aria-label',`${next==='radius'?'Radius':'Diameter'} (millimetres)`);input.closest('.creation-field')!.querySelector('.creation-label')!.textContent=next==='radius'?'Radius':'Diameter';input.previousElementSibling!.textContent=next==='radius'?'R':'Ø';
   };
  }
  this.destination=document.createElement('p');this.destination.className='subtext creation-destination';this.element.append(this.destination);
  this.error=document.createElement('p');this.error.className='creation-error';this.error.setAttribute('role','status');this.error.hidden=true;this.element.append(this.error);
  this.submitButton=document.createElement('button');this.submitButton.type='submit';this.submitButton.className='button creation-submit';this.submitButton.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-plus"/></svg>Add to canvas';this.element.append(this.submitButton);
  const note=document.createElement('p');note.className='subtext';note.textContent='You can also draw directly on the canvas. Typed values are exact and bypass snapping.';this.element.append(note);this.sync();
 }
 sync():boolean {
  const context=this.model.context();
  if(!this.kind){
   if(this.resumeTool!==context.tool){this.resumeTool=null;return false;}
   if(context.selection)return false;
   this.start(context.tool);return this.active;
  }
  if(context.tool!==this.tool){this.stop();return false;}
  if(!context.pending&&context.selection&&context.selection!==this.selection){
   this.stop();this.resumeTool=context.tool;return false;
  }
  this.destination!.textContent=`Destination: ${context.layer.name}`;this.submitButton!.disabled=!!context.layer.error||context.pending;
  if(context.layer.error){this.error!.textContent=context.layer.error;this.error!.hidden=false;this.error!.dataset.destinationError='true';}
  else if(this.error!.dataset.destinationError){this.error!.hidden=true;delete this.error!.dataset.destinationError;}
  return true;
 }
 stop():void {this.resumeTool=null;this.kind=null;this.element.hidden=true;}
 private submit():void {
  if(!this.kind)return;const context=this.model.context();if(context.pending||context.layer.error){this.sync();return;}
  let shape:Shape|undefined;
  try{
   const values=Object.fromEntries([...this.inputs].map(([key,input])=>[key,input.value.trim()?input.valueAsNumber:NaN]));
   const style=this.element.querySelector<HTMLSelectElement>('[aria-label="Line style"]')!.value as LineDesign;
   shape=buildCreationShape(this.kind,values,this.measurement,style,context.layer.colour);
   this.model.insert(shape,CREATION_NAMES[this.kind]);this.stop();
  }catch(error){
   shape?.remove();this.error!.textContent=error instanceof Error?error.message:'Could not add the object.';this.error!.hidden=false;
   const input=error instanceof CreationError&&error.field?this.inputs.get(error.field):null;
   if(input){input.setAttribute('aria-invalid','true');input.closest('.number-shell')!.classList.add('is-invalid');input.focus();}
  }
 }
}
