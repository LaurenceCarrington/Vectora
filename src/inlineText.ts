import {artworkColor} from './shapeStyles';
import paper from 'paper';
import type { CADEditor } from './editor';
import type { Shape } from './types';
import { createTextShape, loadTextFont, textFont, textBaselineOffset, type TextData } from './text';

export class InlineText {
  private active:{point:paper.Point|null;source:Shape|null;data:TextData;ready:boolean;finishRequested?:boolean}|null=null;
  private caret=document.createElementNS('http://www.w3.org/2000/svg','svg');
  private caretLine=document.createElementNS('http://www.w3.org/2000/svg','path');
  private draftBounds:{key:string;bounds:paper.Rectangle}|null=null;
  constructor(private input:HTMLTextAreaElement,private editor:CADEditor){
    this.caret.classList.add('inline-text-caret');this.caret.setAttribute('aria-hidden','true');this.caret.style.display='none';
    this.caretLine.setAttribute('vector-effect','non-scaling-stroke');this.caret.append(this.caretLine);input.after(this.caret);
    input.addEventListener('input',()=>this.render());
    document.addEventListener('selectionchange',()=>{if(this.active)this.render();});
    input.addEventListener('keyup',()=>this.render());
    input.addEventListener('pointerup',()=>this.render());
    input.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();this.finish(true);}
      else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();this.finish();}
      else if(event.key==='Tab'){event.preventDefault();this.finish();}
    });
    document.addEventListener('pointerdown',event=>{
      if(this.active&&event.target!==input&&!this.finish(false,false)){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    window.addEventListener('blur',()=>this.finish(true));
    editor.onTextRequest=(point,source)=>{
      if(this.active&&!this.finish())return;
      editor.cancel();
      const data:TextData=source?.data.text?structuredClone(source.data.text):{content:'',sizeMM:10,fontId:'lato',transform:[1,0,0,1,point!.x,point!.y]};
      const active:NonNullable<InlineText['active']>={point,source,data,ready:false};this.active=active;
      if(source)source.visible=false;
      input.value=data.content;input.readOnly=false;input.hidden=false;editor.setTextEditing(true);this.render();input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
      Promise.all([loadTextFont(data.fontId),document.fonts.load(`16px "Vectora ${textFont(data.fontId).name}"`)])
        .then(()=>{if(this.active===active){active.ready=true;this.render();if(active.finishRequested!==undefined)this.finish(false,active.finishRequested);}})
        .catch(error=>{if(this.active===active){editor.onMessage((error as Error).message,true);this.finish(true);}});
    };
  }
  finish(cancel=false,focus=true):boolean {
    const active=this.active;if(!active)return true;
    if(!cancel&&!active.ready){active.finishRequested=focus;this.input.readOnly=true;return false;}
    if(active.source)active.source.visible=true;
    this.active=null;this.draftBounds=null;this.input.hidden=true;this.caret.style.display='none';this.editor.setTextEditing(false);
    try{
      if(!cancel&&this.input.value.trim()){
        if(!active.source||this.input.value!==active.data.content||!active.data.glyphContours)this.editor.saveText(this.input.value,active.data.sizeMM,active.point,active.source?.data.uid??null,active.data.fontId);
      }else if(!cancel&&active.source){
        this.editor.select(active.source);this.editor.deleteSelection();
      }
      if(focus)this.editor.canvas.focus({preventScroll:true});return true;
    }catch(error){
      this.active=active;active.finishRequested=undefined;if(active.source)active.source.visible=false;this.input.readOnly=false;this.input.hidden=false;this.editor.setTextEditing(true);this.input.focus({preventScroll:true});
      this.editor.onMessage((error as Error).message,true);return false;
    }
  }
  render():void {
    const active=this.active;if(!active)return;
    const {data}=active,size=data.sizeMM,font=textFont(data.fontId),zoom=paper.view.zoom;
    const matrix=new paper.Matrix(...data.transform),origin=paper.view.projectToView(matrix.transform(new paper.Point(0,textBaselineOffset(font.id,size))));
    const [a,b,c,d]=data.transform;
    Object.assign(this.input.style,{fontFamily:`"Vectora ${font.name}"`,fontSize:`${size}px`,lineHeight:'1.2',transform:`matrix(${a*zoom},${b*zoom},${c*zoom},${d*zoom},${origin.x},${origin.y})`});
    this.input.style.setProperty('--inline-text-color',(active.source?.fillColor??active.source?.strokeColor)?.toCSS(true)??artworkColor());
    const measure=document.createElement('canvas').getContext('2d')!;measure.font=`${size}px "Vectora ${font.name}"`;
    const lines=this.input.value.split('\n');
    this.input.style.width=`${Math.max(size*6,...lines.map(line=>measure.measureText(line).width+size))}px`;
    this.input.style.height=`${Math.max(1,lines.length)*size*1.2+size*0.2}px`;
    const key=JSON.stringify([this.input.value,data,active.ready]);
    if(this.draftBounds?.key!==key){
      // Use the same glyph geometry as the committed object, not the textarea's typing area.
      const empty=new paper.Path.Rectangle({rectangle:new paper.Rectangle(0,textBaselineOffset(font.id,size),size*0.5,size),insert:false});
      empty.transform(matrix);let bounds=empty.bounds.clone();empty.remove();
      if(active.ready&&this.input.value.trim()){
        try{const draft=createTextShape({...data,content:this.input.value});bounds=draft.bounds.clone();draft.remove();}
        catch{/* Keep typing possible while an unsupported character is being corrected. */}
      }
      this.draftBounds={key,bounds};
    }
    this.editor.setTextEditingBounds(this.draftBounds.bounds);
    const beforeCaret=this.input.value.slice(0,this.input.selectionStart).split('\n');
    const x=measure.measureText(beforeCaret.at(-1)!).width;
    const y=textBaselineOffset(font.id,size)+(beforeCaret.length-1)*size*1.2;
    const start=paper.view.projectToView(matrix.transform(new paper.Point(x,y)));
    const end=paper.view.projectToView(matrix.transform(new paper.Point(x,y+size)));
    this.caretLine.setAttribute('d',`M${start.x} ${start.y}L${end.x} ${end.y}`);
    this.caret.style.display=document.activeElement===this.input&&this.input.selectionStart===this.input.selectionEnd?'':'none';
  }
}
