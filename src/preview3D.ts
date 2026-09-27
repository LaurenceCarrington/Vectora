import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {CADEditor} from './editor';
import {buildPreviewModel,type PreviewModel} from './previewModel';
import {PREVIEW_MATERIALS,materialCanvas} from './previewMaterials';

export class Preview3D {
 private renderer:THREE.WebGLRenderer|null=null;
 private scene=new THREE.Scene();
 private camera=new THREE.PerspectiveCamera(38,1,.01,10000);
 private controls:OrbitControls|null=null;
 private model:PreviewModel|null=null;
 private assembly=new THREE.Group();
 private observer:ResizeObserver;
 private revision=0;
 private material=PREVIEW_MATERIALS[0] as typeof PREVIEW_MATERIALS[number];
 private thickness=3;
 private stage:HTMLElement;
 constructor(private dialog:HTMLDialogElement,private editor:CADEditor,private trigger:HTMLButtonElement){
  this.stage=this.get('[data-preview-stage]');
  this.observer=new ResizeObserver(()=>this.resize());
  this.get<HTMLButtonElement>('[data-preview-close]').onclick=()=>dialog.close();
  this.get<HTMLButtonElement>('[data-preview-reset]').onclick=()=>this.fit();
  this.get<HTMLButtonElement>('[data-preview-top]').onclick=()=>this.fit(true);
  this.get<HTMLSelectElement>('#preview-material').onchange=event=>{this.material=PREVIEW_MATERIALS.find(m=>m.id===(event.target as HTMLSelectElement).value)!;this.rebuild();};
  const thickness=this.get<HTMLInputElement>('#preview-thickness');thickness.oninput=()=>{
   const n=thickness.valueAsNumber,valid=Number.isFinite(n)&&n>=.1&&n<=100;thickness.setAttribute('aria-invalid',String(!valid));this.get('[data-preview-validation]').hidden=valid;
   if(valid){this.thickness=n;this.rebuild();this.fit(false);}
  };
  this.get<HTMLInputElement>('#preview-engraving').onchange=()=>this.rebuild();
  dialog.addEventListener('keydown',event=>{
   event.stopPropagation();if(event.target===this.renderer?.domElement){const delta=.12;if(event.key.toLowerCase()==='f')this.fit(false);else if(event.key==='ArrowLeft')this.orbit(-delta,0);else if(event.key==='ArrowRight')this.orbit(delta,0);else if(event.key==='ArrowUp')this.orbit(0,-delta);else if(event.key==='ArrowDown')this.orbit(0,delta);else if(event.key==='+'||event.key==='=')this.zoom(.85);else if(event.key==='-')this.zoom(1.15);else return;event.preventDefault();}
  });
  dialog.addEventListener('close',()=>{this.revision++;this.dispose();trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
 }
 private get<T extends HTMLElement=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 async open():Promise<void>{
  const revision=++this.revision;
  this.dialog.showModal();this.trigger.setAttribute('aria-expanded','true');this.get<HTMLButtonElement>('[data-preview-close]').focus();
  this.message('Preparing your design…');
  try{
   const model=await buildPreviewModel(this.editor.objects);if(revision!==this.revision||!this.dialog.open)return;
   this.model=model;if(!model){this.message('Nothing to preview yet','Move closed outlines to Cut Path or drawing paths to Engrave Path. Artwork and Construction Path stay in the editor.');return;}
   this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(getComputedStyle(this.stage).getPropertyValue('--preview-background').trim());this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
   const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','3D material preview. Drag to rotate, shift or right or middle-drag to pan, scroll or control-drag to zoom. Arrow keys rotate; plus and minus zoom; F fits the model.');canvas.setAttribute('role','img');
   canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(!this.dialog.open||this.renderer?.domElement!==canvas)return;this.message('3D preview was interrupted','Close and reopen the preview to try again.');});
   this.stage.replaceChildren(canvas);this.stage.setAttribute('aria-busy','false');
   this.scene=new THREE.Scene();this.scene.add(new THREE.HemisphereLight('#ffffff','#697481',2));
   const span=Math.max(model.bounds.width,model.bounds.height,10),light=new THREE.DirectionalLight('#fff3df',3.5);light.position.set(-span,span*2,span);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.1,far:span*6});light.shadow.bias=-.0001;this.scene.add(light);
   const fill=new THREE.DirectionalLight('#cfdeff',1.3);fill.position.set(span,span*.7,-span);this.scene.add(fill);
   const underside=new THREE.DirectionalLight('#e4eaff',2);underside.position.set(span,-span*2,-span);this.scene.add(underside);
   this.assembly=new THREE.Group();this.assembly.rotation.x=-Math.PI/2;this.scene.add(this.assembly);
   this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.controls.dampingFactor=.22;this.controls.zoomSpeed=.8;this.controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;this.navigationSensitivity();this.controls.minPolarAngle=.00001;this.controls.maxPolarAngle=Math.PI-.00001;this.controls.addEventListener('change',()=>this.render());
   // Keep modifier gestures familiar without changing OrbitControls internals.
   canvas.addEventListener('pointerdown',event=>{if(this.controls&&event.pointerType==='mouse')this.controls.mouseButtons.LEFT=event.ctrlKey||event.metaKey?THREE.MOUSE.DOLLY:THREE.MOUSE.ROTATE;},true);
   canvas.addEventListener('dblclick',()=>this.fit(false));
   this.renderer.setAnimationLoop(()=>this.controls?.update());
   this.observer.observe(this.stage);this.get('[data-preview-settings]').removeAttribute('inert');this.rebuild();this.resize();this.fit();
  }catch(error){if(revision!==this.revision||!this.dialog.open)return;this.dispose();this.message('Unable to show 3D preview',error instanceof Error?error.message:'Enable hardware acceleration and try again.');}
 }
 private message(title:string,detail=''):void{
  this.get('[data-preview-settings]').setAttribute('inert','');this.stage.replaceChildren();this.stage.setAttribute('aria-busy',String(title==='Preparing your design…'));
  const box=document.createElement('div');box.className='preview3d-empty';const heading=document.createElement('h3'),text=document.createElement('p');heading.textContent=title;text.textContent=detail;box.append(heading,text);this.stage.append(box);this.get('[data-preview-summary]').textContent='';this.get('[data-preview-note]').textContent='';
 }
 private clearMeshes(root:THREE.Object3D):void{
  const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();root.traverse(object=>{if(object instanceof THREE.DirectionalLight)object.shadow.dispose();if(object instanceof THREE.Mesh){object.geometry.dispose();for(const m of Array.isArray(object.material)?object.material:[object.material]){materials.add(m);if(m instanceof THREE.MeshStandardMaterial&&m.map)textures.add(m.map);}}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());root.clear();
 }
 private rebuild():void{
  const model=this.model;if(!model||!this.renderer)return;
  this.clearMeshes(this.assembly);
  const b=model.bounds,toPoints=(index:number)=>model.contours[index].points.map(p=>new THREE.Vector2(p.x-b.x-b.width/2,-(p.y-b.y-b.height/2)));
  const shapes:THREE.Shape[]=[];model.contours.forEach((_,i)=>{if(model.depths[i]%2)return;const shape=new THREE.Shape(toPoints(i));model.parents.forEach((parent,j)=>{if(parent===i)shape.holes.push(new THREE.Path(toPoints(j)));});shapes.push(shape);});
  const texture=new THREE.CanvasTexture(materialCanvas(model,this.material,this.get<HTMLInputElement>('#preview-engraving').checked));texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
  const backTexture=new THREE.CanvasTexture(materialCanvas(model,this.material,false));backTexture.colorSpace=THREE.SRGBColorSpace;backTexture.anisotropy=texture.anisotropy;
  const back=new THREE.MeshStandardMaterial({map:backTexture,side:THREE.BackSide,roughness:this.material.roughness,metalness:this.material.metalness,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const surface=new THREE.MeshStandardMaterial({map:texture,roughness:this.material.roughness,metalness:this.material.metalness,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const edges=new THREE.MeshStandardMaterial({color:this.material.edge,roughness:Math.min(1,this.material.roughness+.15),metalness:this.material.metalness});
  for(const shape of shapes){
   const solid=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:this.thickness,bevelEnabled:false,steps:1}),edges);solid.castShadow=true;solid.receiveShadow=true;this.assembly.add(solid);
   const geometry=new THREE.ShapeGeometry(shape),position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');for(let i=0;i<position.count;i++)uv.setXY(i,(position.getX(i)+b.width/2)/b.width,(position.getY(i)+b.height/2)/b.height);
   const face=new THREE.Mesh(geometry,surface);face.position.z=this.thickness;face.receiveShadow=true;this.assembly.add(face);
   const underside=new THREE.Mesh(geometry,back);underside.receiveShadow=true;this.assembly.add(underside);
  }
  this.get('[data-preview-summary]').textContent=`${Number(b.width.toFixed(2))} × ${Number(b.height.toFixed(2))} × ${this.thickness} mm · ${model.parts} ${model.parts===1?'piece':'pieces'} · ${model.holes} ${model.holes===1?'hole':'holes'}`;
  this.get('[data-preview-note]').textContent=[model.stock?'No closed cut outline: showing engraving on a fitted rectangular blank.':'Nested cut outlines create through-holes; separate outlines create separate pieces.',model.openCuts?`${model.openCuts} open cut ${model.openCuts===1?'path is':'paths are'} omitted. Close them to preview a cut-through shape.`:''].filter(Boolean).join(' ');
  this.render();
 }
 /** Fixed angular and distance-relative pan sensitivity across window sizes. */
 private navigationSensitivity():void {
  if(!this.controls)return;
  const height=this.stage.clientHeight;
  this.controls.rotateSpeed=height/720; // Half a degree per CSS pixel.
  this.controls.panSpeed=height*.001/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
 }
 private radius():number {const b=this.model!.bounds;return Math.hypot(b.width,b.height,this.thickness)/2;}
 private fitDistance():number {const fov=THREE.MathUtils.degToRad(this.camera.fov);return this.radius()/Math.sin(Math.min(fov,2*Math.atan(Math.tan(fov/2)*this.camera.aspect))/2)*1.2;}
 private resize():void{
  if(!this.renderer)return;const width=this.stage.clientWidth,height=this.stage.clientHeight;if(!width||!height)return;
  const oldFit=this.model?this.fitDistance():1;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.navigationSensitivity();
  // Keep the same zoom relative to a fitted view when the viewport changes shape.
  if(this.model&&this.controls){const offset=this.camera.position.clone().sub(this.controls.target);offset.multiplyScalar(this.fitDistance()/oldFit);this.camera.position.copy(this.controls.target).add(offset);}
  this.camera.updateProjectionMatrix();this.controls?.update();this.render();
 }
 private fit(top=true):void{
  if(!this.model||!this.controls)return;
  // Drain inertia before assigning an exact view, so Reset cannot drift afterwards.
  const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();
  const direction=top?new THREE.Vector3(0,1,.00001):this.camera.position.clone().sub(this.controls.target).normalize();
  this.controls.target.set(0,this.thickness/2,0);this.camera.up.set(0,1,0);
  this.camera.position.copy(this.controls.target).addScaledVector(direction,this.fitDistance());this.updateClipping();this.controls.update();this.controls.enableDamping=damping;this.render();
 }
 private orbit(theta:number,phi:number):void{
  if(!this.controls)return;
  this.controls.rotateLeft(-theta);this.controls.rotateUp(-phi);
 }
 /** Keep the camera outside the solid and fit its depth range to the whole model. */
 private updateClipping():void{
  if(!this.model||!this.controls)return;
  const radius=this.radius(),center=new THREE.Vector3(0,this.thickness/2,0),offset=this.camera.position.clone().sub(center),safe=radius*1.05;
  this.controls.minDistance=safe;this.controls.maxDistance=Math.max(radius*30,this.fitDistance()*5);
  if(offset.length()<safe){if(offset.lengthSq()===0)offset.set(0,0,1);this.camera.position.copy(center).add(offset.setLength(safe));this.camera.lookAt(this.controls.target);}
  const distance=this.camera.position.distanceTo(center);
  this.camera.near=Math.max(radius*1e-6,(distance-radius)*.25);this.camera.far=distance+radius*4;this.camera.updateProjectionMatrix();
 }
 private zoom(scale:number):void{if(!this.controls)return;const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*scale,this.controls.minDistance,this.controls.maxDistance));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
 private render():void{if(this.renderer&&this.dialog.open){this.updateClipping();this.renderer.render(this.scene,this.camera);}}
 private dispose():void{this.observer.disconnect();this.renderer?.setAnimationLoop(null);this.controls?.dispose();this.controls=null;this.clearMeshes(this.scene);this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer=null;this.model=null;this.stage.replaceChildren();}
}
