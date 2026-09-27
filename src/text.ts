import {artworkColor} from './shapeStyles';
import paper from 'paper';
import { transformDimension } from './dimensions';
import type { Font, PathCommand } from 'opentype.js';
import type { Shape } from './types';

export interface TextFontDefinition {id:string;name:string;file:string;group:string;strokeFile?:string}
export const TEXT_FONTS:readonly TextFontDefinition[]=[
  {id:'lato',name:'Lato',file:'Lato-Regular.ttf',group:'General'},
  {id:'pt-serif',name:'PT Serif',file:'PTSerif-Regular.ttf',group:'General'},
  {id:'space-mono',name:'Space Mono',file:'SpaceMono-Regular.ttf',group:'General'},
  {id:'hershey',name:'Hershey Sans 1-stroke',file:'HersheySans1-Display.ttf',strokeFile:'HersheySans1.json',group:'Single-line / engraving'},
  {id:'relief-single-line',name:'Relief Single Line',file:'ReliefSingleLineOutline-Regular.otf',strokeFile:'ReliefSingleLineSVG-Regular.json',group:'Single-line / engraving'},
  {id:'free-mono',name:'FreeMono',file:'FreeMono.ttf',group:'Technical / CAD'},
  {id:'inter',name:'Inter',file:'Inter-Regular.ttf',group:'Technical / CAD'},
  {id:'jetbrains-mono',name:'JetBrains Mono',file:'JetBrainsMono-Regular.ttf',group:'Technical / CAD'},
  {id:'oswald',name:'Oswald',file:'Oswald-Regular.ttf',group:'Display'},
  {id:'montserrat',name:'Montserrat',file:'Montserrat-Regular.ttf',group:'Display'},
  {id:'bebas-neue',name:'Bebas Neue',file:'BebasNeue-Regular.ttf',group:'Display'},
  {id:'allerta-stencil',name:'Allerta Stencil',file:'AllertaStencil-Regular.ttf',group:'Stencil'},
  {id:'saira-stencil-one',name:'Saira Stencil One',file:'SairaStencilOne-Regular.ttf',group:'Stencil'},
];
interface StrokeFont {unitsPerEm:number;ascender:number;glyphs:Record<string,{path:string;advance:number}>}
const strokeFonts=new Map<string,StrokeFont>();
export function isStrokeFont(id?:string):boolean {return !!textFont(id).strokeFile;}
export interface TextData { content:string; sizeMM:number; fontId?:string; glyphContours?:number[]; glyphLabels?:string[]; transform:[number,number,number,number,number,number] }
const fonts=new Map<string,Font>(),pending=new Map<string,Promise<void>>();
export function textFont(id='lato'){return TEXT_FONTS.find(font=>font.id===id)??TEXT_FONTS[0];}
export function textBaselineOffset(id:string,size:number):number {const font=fonts.get(id);return font?(font.ascender/font.unitsPerEm-1)*size:0;}
export function loadTextFont(id='lato'):Promise<void> {
  if(fonts.has(id))return Promise.resolve();
  const existing=pending.get(id);if(existing)return existing;
  const request=(async()=>{
    const response=await fetch(`${import.meta.env.BASE_URL}fonts/${textFont(id).file}`);
    if(!response.ok)throw new Error('Could not load the text font. Try again.');
    const {parse}=await import('opentype.js'),font=parse(await response.arrayBuffer()),strokeFile=textFont(id).strokeFile;
    if(strokeFile){const strokes=await fetch(`${import.meta.env.BASE_URL}fonts/${strokeFile}`);if(!strokes.ok)throw new Error('Could not load the engraving font. Try again.');strokeFonts.set(id,await strokes.json());}
    fonts.set(id,font);
  })().finally(()=>pending.delete(id));pending.set(id,request);return request;
}
function glyphShape(commands:PathCommand[]):paper.CompoundPath {
  const pathData=commands.map(c=>{
    switch(c.type){
      case 'M':case 'L':return `${c.type}${c.x} ${c.y}`;
      case 'C':return `C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}`;
      case 'Q':return `Q${c.x1} ${c.y1} ${c.x} ${c.y}`;
      case 'Z':return 'Z';
    }
  }).join(' ');
  const shape=new paper.CompoundPath({insert:false,pathData});
  // TrueType contours are implicitly closed; parsers can omit the Z commands.
  for(const contour of shape.children as paper.Path[]){
    if(!contour.closed&&contour.segments.length>1&&contour.firstSegment.point.getDistance(contour.lastSegment.point)<1e-12){
      contour.firstSegment.handleIn=contour.lastSegment.handleIn.clone();contour.removeSegment(contour.segments.length-1);
    }
    contour.closed=true;
  }
  return shape;
}
export function createTextShape(data:TextData,forConversion=false):paper.CompoundPath {
  const fontId=data.fontId??'lato',font=fonts.get(fontId);
  if(!font)throw new Error('The text font is still loading. Try again.');
  const strokes=forConversion?strokeFonts.get(fontId):undefined;
  if(!data.content.trim()||data.content.length>500)throw new Error('Enter between 1 and 500 characters.');
  if(!Number.isFinite(data.sizeMM)||data.sizeMM<0.1||data.sizeMM>1000)throw new Error('Font size must be between 0.1 and 1000 mm.');
  for(const char of data.content)if(!'\n\r\t'.includes(char)&&!font.charToGlyphIndex(char))throw new Error(`${textFont(fontId).name} does not include “${char}”. Choose another character or font.`);
  const shape=new paper.CompoundPath({insert:false,fillColor:artworkColor(),strokeColor:null,strokeWidth:1.5,strokeScaling:false});
  const glyphContours:number[]=[],glyphLabels:string[]=[];
  data.content.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n').forEach((line,i)=>{
    const characters=Array.from(line),glyphs=characters.map(char=>font.charToGlyph(char));
    let x=0;const y=(font.ascender/font.unitsPerEm+i*1.2)*data.sizeMM,scale=data.sizeMM/font.unitsPerEm;
    // Use one glyph per character with pair kerning, without ligature substitutions.
    glyphs.forEach((glyph,index)=>{
      let letter:paper.CompoundPath;
      if(strokes){
        const stroke=strokes.glyphs[characters[index]];
        if(!stroke){shape.remove();throw new Error(`${textFont(fontId).name} has no single-line path for “${characters[index]}”. Choose another character or font.`);}
        letter=new paper.CompoundPath({insert:false,pathData:stroke.path});
        const strokeScale=data.sizeMM/strokes.unitsPerEm;
        letter.transform(new paper.Matrix(strokeScale,0,0,-strokeScale,x,y));
      }else letter=glyphShape(glyph.getPath(x,y,data.sizeMM,undefined,font).commands);
      if(letter.children.length){
        glyphContours.push(letter.children.length);glyphLabels.push(characters[index]);
        shape.addChildren(letter.removeChildren());
      }
      letter.remove();
      x+=(glyph.advanceWidth??0)*scale;
      if(index+1<glyphs.length)x+=font.getKerningValue(glyph,glyphs[index+1])*scale;
    });
  });
  if(!shape.children.length){shape.remove();throw new Error('Enter text with visible characters.');}
  shape.transform(new paper.Matrix(...data.transform));
  shape.data.text={...structuredClone(data),fontId,glyphContours,glyphLabels};return shape;
}
export function transformText(item:Shape,matrix:paper.Matrix):void {
  transformDimension(item,matrix);
  const text=item.data.text as TextData|undefined;if(!text)return;
  const transform=new paper.Matrix(...text.transform);transform.prepend(matrix);
  item.data.text={...structuredClone(text),transform:transform.values};
}
