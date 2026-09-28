import {STRUCTURAL_CATALOG,type StructuralFamily} from './structuralCatalog';
export type Family='gear'|'drive'|'fastener'|'cam'|StructuralFamily;
export type Values=Record<string,number|string>;
export interface Field {key:string;label:string;unit:string;value:number;min:number;max:number;step:number}
export interface Profile {id:string;label:string;description:string;fields:Field[]}
const n=(key:string,label:string,value:number,min:number,max:number,step=.1,unit='mm'):Field=>({key,label,value,min,max,step,unit});
const teeth=n('teeth','Teeth',24,12,160,1,''),bore=n('bore','Bore diameter',5,0,500),pitch=n('pitch','Pitch',5,.1,50),moduleField=n('module','Module',2,.1,20),pressure=n('pressure','Pressure angle',20,14.5,30,.5,'°');
const gearFields=[teeth,moduleField,pressure,bore,n('backlash','Pitch-circle backlash',0,0,10,.01)];
const threadFields=[n('diameter','Major diameter',8,.5,200),n('pitch','Pitch',1.25,.1,20,.05),n('length','Thread length',30,1,500),n('depth','Radial thread depth',.65,.01,20,.01),n('angle','Included angle',60,30,90,1,'°')];
export const CATALOG:Record<Family,{title:string;icon:string;profiles:Profile[]}>= {
 ...STRUCTURAL_CATALOG,
 gear:{title:'Involute gear',icon:'gear',profiles:[
 {id:'spur',label:'Spur gear',description:'Involute tooth flanks with radial root connections. Closed transverse outline.',fields:gearFields},
 {id:'helical',label:'Helical · transverse section',description:'Normal module and pressure angle converted to a transverse section. No helix or axial geometry.',fields:[...gearFields,n('helix','Helix angle',20,0,45,1,'°')]},
 {id:'bevel',label:'Bevel · outer-end approximation',description:'Virtual-spur / back-cone approximation projected to the outer end. Not a spherical involute or a 3D bevel tooth.',fields:[...gearFields,n('cone','Pitch cone angle',45,10,70,1,'°')]},
 {id:'rack',label:'Rack & pinion',description:'Spur pinion and straight-sided rack at a common pitch line. Two independently editable parts.',fields:[...gearFields,n('rackTeeth','Rack teeth',12,2,80,1,''),n('base','Rack backing depth',6,.2,100)]}]},
 drive:{title:'Sprocket & timing pulley',icon:'circle',profiles:[
 {id:'sprocket',label:'Sprocket · custom roller seats',description:'Circular roller seats and outer lands. Simplified editable profile; no standard-specific entry flanks.',fields:[{...teeth,value:20},n('pitch','Chain pitch',12.7,1,50,.1),n('roller','Roller diameter',7.75,.1,40,.05),n('clearance','Roller clearance',.15,0,3,.05),n('tip','Tip above pitch circle',1.5,.1,10),bore]},
 ...['trapezoid','round'].map(id=>({id,label:`Timing pulley · custom ${id==='round'?'rounded':'trapezoidal'}`,description:'Editable groove dimensions. A custom profile, not an HTD, GT or other belt-standard tooth form.',fields:[teeth,pitch,n('offset','Pitch-line offset',.5,0,10,.05),n('depth','Groove depth',1.2,.05,20,.05),n('width','Groove opening',2.4,.1,30),...(id==='trapezoid'?[n('flank','Flank angle',20,0,45,1,'°')]:[]),bore]}))]},
 fastener:{title:'Thread & fastener',icon:'line',profiles:[
 {id:'thread',label:'External thread · axial section',description:'Custom symmetric V-thread section with equal crest/root flats. Opposite sides are offset by half a pitch.',fields:threadFields},
 {id:'bolt',label:'Hex bolt · side silhouette',description:'Custom thread section and rectangular side silhouette of the hex head. Not an ISO fastener specification.',fields:[...threadFields,n('across','Head across flats',13,1,300),n('head','Head height',5,.1,100)]},
 {id:'nut',label:'Hex nut · top view',description:'Hexagonal outline with a circular bore. Internal threads are not depicted in this top view.',fields:[n('across','Across flats',13,1,300),n('bore','Bore diameter',8,.1,250)]},
 {id:'washer',label:'Washer · top view',description:'Two concentric circles defining the outside edge and bore.',fields:[n('diameter','Outside diameter',20,1,500),n('bore','Bore diameter',8,.1,499)]}]},
 cam:{title:'Cam profile',icon:'arc',profiles:['cycloidal','harmonic','polynomial'].map(id=>({id,label:id==='cycloidal'?'Cycloidal motion':id==='harmonic'?'Simple harmonic motion':'3–4–5 polynomial motion',description:'Radial cam for an inline translating follower. Set roller radius to zero for a knife-edge follower.',fields:[n('base','Base radius',20,1,250),n('lift','Follower lift',10,.1,200),n('rise','Rise angle',120,5,350,1,'°'),n('dwell','High dwell',60,0,350,1,'°'),n('return','Return angle',120,5,350,1,'°'),n('roller','Roller radius',0,0,50),bore]}))}
};
export function defaults(profile:Profile):Values{return Object.fromEntries(profile.fields.map(f=>[f.key,f.value]));}
