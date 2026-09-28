import * as THREE from 'three';
import type {PreviewModel} from './previewModel';
import {materialCanvas,type PreviewMaterial} from './previewMaterials';
export interface PreviewSheet {name:string;model:PreviewModel;offset:number;ids:string[]}
export interface SurfaceSettings {grain:number;burn:boolean;edge:string;transmission:number;ior:number;frost:boolean;glow:boolean;roughness:number;metalness:number;finish:string;border:string;borderWidth:number;print:boolean;engraving:boolean;quality:string;kerf:boolean;kerfWidth:number}
export interface PreviewPart {group:THREE.Group;solid:THREE.Mesh;face:THREE.Mesh;back:THREE.Mesh;kerf:THREE.Group;center:THREE.Vector3;sheet:number;offset:number}
export function disposeObjects(root:THREE.Object3D):void {
 const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),geometries=new Set<THREE.BufferGeometry>();
 root.traverse(object=>{if(object instanceof THREE.DirectionalLight)object.shadow.dispose();if(object instanceof THREE.Mesh||object instanceof THREE.Line||object instanceof THREE.LineSegments){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);}}});
 geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());root.clear();
}
/** Tool-width ribbons in document units, independent of screen resolution. */
export function ribbon(points:THREE.Vector2[],width:number,color:string,opacity=.55):THREE.Mesh {
 const positions:number[]=[];
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)continue;
  const x=-dy/length*width/2,y=dx/length*width/2;
  positions.push(a.x+x,a.y+y,0,a.x-x,a.y-y,0,b.x+x,b.y+y,0,b.x+x,b.y+y,0,a.x-x,a.y-y,0,b.x-x,b.y-y,0);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false}));
}
export function makeAssembly(sheets:PreviewSheet[],bounds:PreviewModel['bounds'],material:PreviewMaterial,s:SurfaceSettings):{root:THREE.Group;parts:PreviewPart[]} {
 const root=new THREE.Group(),parts:PreviewPart[]=[];
 sheets.forEach((sheet,si)=>{
  const model=sheet.model,b=model.bounds,size=s.quality==='draft'?512:s.quality==='high'?1536:1024;
  const makeTexture=(engraving:boolean,print:boolean)=>{const t=new THREE.CanvasTexture(materialCanvas(model,material,engraving,{grainAngle:s.grain,size,print}));t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
  const transparent=['acrylic','glass'].includes(material.id),sticker=material.id==='sticker',metal=['aluminium','steel'].includes(material.id);
  const roughness=transparent?(s.frost?.55:.06):metal?s.roughness:sticker?(s.finish==='matte'?.8:.16):material.roughness;
  const surface=new THREE.MeshPhysicalMaterial({map:makeTexture(s.engraving,sticker&&s.print),roughness,metalness:metal?s.metalness:material.metalness,transmission:transparent?s.transmission:0,transparent,opacity:transparent?1-s.transmission*.55:1,ior:s.ior,thickness:2,clearcoat:sticker&&s.finish!=='matte'?1:0,iridescence:sticker&&s.finish==='holographic'?1:0,iridescenceIOR:1.4,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const back=surface.clone();back.map=makeTexture(false,false);back.side=THREE.BackSide;back.iridescence=0;
  const edges=new THREE.MeshPhysicalMaterial({color:s.burn&&['plywood','mdf','leather'].includes(material.id)?s.edge:material.base,roughness,metalness:metal?s.metalness:material.metalness,transmission:transparent?s.transmission*.7:0,transparent,opacity:transparent?1-s.transmission*.4:1,ior:s.ior,thickness:2,emissive:transparent&&s.glow?material.base:'#000000',emissiveIntensity:.45});
  const invisible=new THREE.MeshBasicMaterial({visible:false});
  const toPoints=(index:number)=>model.contours[index].points.map(p=>new THREE.Vector2(p.x-bounds.x-bounds.width/2,-(p.y-bounds.y-bounds.height/2)));
  model.contours.forEach((_,i)=>{
   if(model.depths[i]%2)return;
   const points=toPoints(i),shape=new THREE.Shape(points),loops=[points];
   model.parents.forEach((parent,j)=>{if(parent===i){const hole=toPoints(j);shape.holes.push(new THREE.Path(hole));loops.push(hole);}});
   const group=new THREE.Group();root.add(group);
   const solid=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false,steps:1}),[invisible,edges]);solid.castShadow=true;solid.receiveShadow=true;group.add(solid);
   const geometry=new THREE.ShapeGeometry(shape),position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
   for(let n=0;n<position.count;n++)uv.setXY(n,(position.getX(n)+bounds.x+bounds.width/2-b.x)/b.width,(-position.getY(n)+bounds.y+bounds.height/2-b.y)/-b.height+1);
   const face=new THREE.Mesh(geometry,surface),underside=new THREE.Mesh(geometry,back);face.receiveShadow=underside.receiveShadow=true;face.castShadow=underside.castShadow=true;group.add(face,underside);
   const kerf=new THREE.Group();kerf.name='kerf-band';kerf.visible=s.kerf;
   for(const loop of loops)kerf.add(ribbon(loop,s.kerfWidth,'#ff805b',.65));group.add(kerf);
   if(sticker&&s.border!=='none'&&s.borderWidth>0){const border=new THREE.Group();border.name='sticker-border';for(const loop of loops)border.add(ribbon(loop,s.borderWidth*2,s.border==='white'?'#ffffff':'#bdefff',s.border==='white'?1:.2));face.add(border);border.position.z=-.002;}
   const box=new THREE.Box2().setFromPoints(points),center2=box.getCenter(new THREE.Vector2());
   parts.push({group,solid,face,back:underside,kerf,center:new THREE.Vector3(center2.x,center2.y,0),sheet:si,offset:sheet.offset});
  });
 });
 return {root,parts};
}
export function sceneFloor(span:number,environment:string,shadows:string):THREE.Group {
 const group=new THREE.Group();group.name='preview-floor';
 if(environment!=='studio'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;ctx.fillStyle=environment==='desktop'?'#b39470':'#c3c2be';ctx.fillRect(0,0,256,256);
  if(environment==='desktop')for(let y=0;y<256;y+=4){ctx.strokeStyle=y%12?'#97795633':'#e0c9a344';ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(80,y+3,170,y-4,256,y+1);ctx.stroke();}
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(4,4);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(span*6,span*6),new THREE.MeshStandardMaterial({map,roughness:.9,side:THREE.FrontSide}));floor.rotation.x=-Math.PI/2;floor.position.y=-.1;floor.receiveShadow=shadows==='soft';group.add(floor);
 }else if(shadows==='soft'){
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(span*6,span*6),new THREE.ShadowMaterial({opacity:.25}));floor.rotation.x=-Math.PI/2;floor.position.y=-.1;floor.receiveShadow=true;group.add(floor);
 }
 if(shadows==='flat'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!,gradient=ctx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'#00000040');gradient.addColorStop(1,'#00000000');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(span*1.8,span*1.8),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.05;group.add(shadow);
 }
 return group;
}
