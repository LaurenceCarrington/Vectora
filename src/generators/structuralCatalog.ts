import type {Field,Profile} from './catalog';
export type StructuralFamily='box'|'hinge'|'packaging'|'framework';
const n=(key:string,label:string,value:number,min:number,max:number,step=.1,unit='mm'):Field=>({key,label,value,min,max,step,unit});
const width=n('width','Width',120,10,2000),depth=n('depth','Depth',80,10,2000),height=n('height','Height',60,10,2000),thickness=n('thickness','Sheet thickness',3,.5,30,.05),gap=n('gap','Layout gap',8,1,100),fit=n('fit','Joint clearance',.1,0,2,.01);
const box=[{...width,label:'Outside width'},{...depth,label:'Outside depth'},{...height,label:'Outside height'},thickness,n('finger','Target finger width',10,1,100),fit,gap];
const tabs=[width,height,{...depth,label:'Receiver depth',value:60},thickness,n('tab','Tab width',12,2,100),n('count','Tab count',2,2,12,1,''),fit,gap];
const hinge=[width,height,n('margin','Solid margin',6,1,100),n('spacing','Column spacing',3,.3,50),n('length','Slit length',18,1,200),n('bridge','Bridge length',3,.3,30),n('kerf','Expected cut width',.2,0,3,.01)];
const carton=[{...width,label:'Panel width',value:80},{...depth,label:'Panel depth',value:40},{...height,label:'Body height',value:100},n('glue','Glue tab width',15,2,80),n('slot','Flap separation',1,.2,10),n('clearance','Flap shortfall',.5,0,10,.05)];
const truss=[{...width,label:'Overall span',value:240},{...height,label:'Overall height',value:60},n('bays','Bays',8,2,40,1,''),n('member','Member width',5,.5,50)];
export const STRUCTURAL_CATALOG:Record<StructuralFamily,{title:string;icon:string;profiles:Profile[]}>= {
 box:{title:'Box & finger joints',icon:'box-net',profiles:[
  {id:'finger-box',label:'Closed finger-jointed box · 6 panels',description:'Outside dimensions. Complementary joints on all twelve edges; front/back panels own the corner blocks. Finger widths adjust evenly along each edge.',fields:box},
  {id:'open-box',label:'Open finger-jointed box · 5 panels',description:'Open-top box with complementary bottom and vertical joints. Outside height includes the base thickness.',fields:box},
  {id:'tab-slot',label:'Interlocking tabs · joint pair',description:'An upright panel with projecting tabs and a receiver plate with matching through-slots. Clearance enlarges the slots.',fields:tabs},
  {id:'t-slot',label:'T-slot fastener · joint pair',description:'Interlocking tabs plus an open T-shaped nut pocket and a matching bolt hole in the receiver. Enter your measured bolt and nut dimensions.',fields:[...tabs,n('bolt','Bolt diameter',3,1,20),n('nut','Nut across flats',5.5,2,40),n('nutHeight','Nut thickness',2.4,.5,20),n('setback','Nut setback',12,3,100)]}
 ]},
 hinge:{title:'Flexure & living hinge',icon:'hinge-pattern',profiles:[
  {id:'hinge-vertical',label:'Staggered slits · vertical',description:'Alternating slit columns inside a solid border. Expected cut width checks remaining bridges; it does not offset the toolpaths.',fields:hinge},
  {id:'hinge-horizontal',label:'Staggered slits · horizontal',description:'The staggered pattern is rotated inside the same panel dimensions. Column spacing and slit length follow the rotated pattern.',fields:hinge},
  {id:'hinge-slots',label:'Staggered rounded slots',description:'Closed capsule slots with alternating bridges and a solid border. Slot width controls the removed area; expected cut width checks the remaining webs.',fields:[...hinge,n('slotWidth','Slot width',.8,.2,10)]}
 ]},
 packaging:{title:'Packaging & die-cut nets',icon:'package-net',profiles:[
  {id:'tuck-carton',label:'Reverse-tuck folding carton',description:'Crease-to-crease panel dimensions. Opposite-end tuck flaps, side dust flaps and a glue seam. Blue dashed lines are folds inserted on Engrave Path.',fields:[...carton,n('tuck','Tuck tongue length',15,2,100)]},
  {id:'shipping-carton',label:'Slotted shipping carton',description:'Four body panels and equal-depth closure flaps for a taped corrugated-style carton. Crease dimensions; board caliper and crease allowances are not automatic.',fields:carton},
  {id:'glue-tray',label:'Fold-up glued tray',description:'A central base, four walls and four corner glue tabs. Dimensions are between crease lines; blue dashed folds go to Engrave Path.',fields:[{...width,label:'Base width'},{...depth,label:'Base depth'},{...height,label:'Wall height',value:30},n('glue','Corner glue tab',12,2,80),n('slot','Corner relief',1,.2,10)]}
 ]},
 framework:{title:'Truss & framework',icon:'truss',profiles:[
  ...['warren','pratt','howe'].map(id=>({id,label:`${id[0].toUpperCase()+id.slice(1)} truss · cut profile`,description:'A single flat profile with connected chords, webs and internal cut-outs. Member width sets the perpendicular web thickness. Geometry only; no load calculation.',fields:truss})),
  {id:'frame-grid',label:'Rectangular framework',description:'A connected rectangular lattice with equally spaced openings and constant member width. Overall dimensions include the outside frame.',fields:[width,{...height,value:120},n('columns','Columns',4,1,30,1,''),n('rows','Rows',3,1,30,1,''),n('member','Member width',6,.5,50)]}
 ]}
};
