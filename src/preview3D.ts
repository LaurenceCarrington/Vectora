import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {CADEditor} from './editor';
import {buildPreviewModel,type PreviewModel} from './previewModel';
import {PREVIEW_MATERIALS} from './previewMaterials';
import {disposeObjects,makeAssembly,sceneFloor,type PreviewPart,type PreviewSheet,type SurfaceSettings} from './previewEffects';

export class Preview3D {
 private sheets:PreviewSheet[]=[];
 private parts:PreviewPart[]=[];
 private bounds:PreviewModel['bounds']={x:0,y:0,width:1,height:1};
 private surfaceTimer=0;
 private restoreTimer=0;
 private modelRevision=0;
 private exporting=false;
 private worker:Worker|null=null;
 private cancelExport:(()=>void)|null=null;
 private floor=new THREE.Group();
 private guides=new THREE.Group();
 private rebuildCount=0;
 private worldBox=new THREE.Box3();
 private renderer:THREE.WebGLRenderer|null=null;
 private scene=new THREE.Scene();
 private camera=new THREE.PerspectiveCamera(38,1,.01,10000);
 private controls:OrbitControls|null=null;
 private model:PreviewModel|null=null;
 private assembly=new THREE.Group();
 private gridRadius=0;
 private environmentMap:THREE.WebGLRenderTarget|null=null;
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
  this.get<HTMLButtonElement>('[data-preview-fit-bed]').onclick=()=>{if(!this.controls||!this.model)return;this.get<HTMLInputElement>('#preview-bed').checked=true;this.positionParts();const radius=Math.hypot(this.number('bed-width',600),this.number('bed-height',400),this.thickness)/2;this.fit();const distance=this.fitDistance()*Math.max(1,radius/this.radius());this.controls.maxDistance=Math.max(this.controls.maxDistance,distance*2);this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0,distance,.00001));this.controls.update();this.render();};
  this.get<HTMLButtonElement>('[data-preview-back]').onclick=()=>this.viewDirection(new THREE.Vector3(0,-1,.00001));
  this.get<HTMLButtonElement>('[data-preview-iso]').onclick=()=>this.viewDirection(new THREE.Vector3(1,1,1).normalize());
  this.dialog.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input=>input.addEventListener('input',()=>{const output=input.parentElement?.querySelector('output');if(output)output.value=input.value;}));
  this.get<HTMLSelectElement>('#preview-material').onchange=()=>{
   this.material=PREVIEW_MATERIALS.find(m=>m.id===this.value('material'))!;
   this.get<HTMLInputElement>('#preview-edge').value=this.material.edge;
   this.get<HTMLInputElement>('#preview-frost').checked=this.material.id==='acrylic';const transmission=this.get<HTMLInputElement>('#preview-transmission');transmission.value=this.material.id==='glass'?'.95':'.7';transmission.dispatchEvent(new Event('input'));
   for(const key of ['roughness','metalness'] as const){const input=this.get<HTMLInputElement>('#preview-'+key);input.value=String(this.material[key]);input.dispatchEvent(new Event('input'));}
   this.materialFields();this.scheduleSurface();
  };
  for(const id of ['thickness','depth'])this.get<HTMLInputElement>('#preview-'+id).oninput=()=>{
   const input=this.get<HTMLInputElement>('#preview-'+id),n=input.valueAsNumber,valid=input.validity.valid&&Number.isFinite(n)&&n>=.1&&n<=100;
   input.setAttribute('aria-invalid',String(!valid));this.get('[data-preview-validation]').hidden=valid;
   if(valid){this.thickness=n;this.get<HTMLInputElement>('#preview-thickness').value=String(n);this.get<HTMLInputElement>('#preview-depth').value=String(n);this.get<HTMLOutputElement>('[for="preview-depth"]').value=String(n);this.positionParts();}
  };
  for(const id of ['engraving','burn','edge','grain','transmission','ior','frost','glow','roughness','metalness','finish','border','border-width','print','kerf','kerf-width']){
   this.get<HTMLInputElement>('#preview-'+id).addEventListener('input',()=>this.scheduleSurface());
  }
  for(const id of ['explode','explode-axis'])this.get('#preview-'+id).addEventListener('input',()=>this.positionParts());
  this.get('#preview-stack').addEventListener('change',()=>{this.rebuild();this.fit(false);});
  this.get<HTMLButtonElement>('[data-preview-add-sheet]').onclick=()=>void this.addSheet();
  this.get('#preview-detail').addEventListener('change',()=>void this.changeDetail());
  for(const id of ['environment','quality','shadows','grid','units','bed','bed-width','bed-height','dimensions'])this.get('#preview-'+id).addEventListener('input',()=>{
   if(id==='quality'){this.setResolution(false);this.scheduleSurface();}if(id==='bed-width'||id==='bed-height')this.get<HTMLSelectElement>('#preview-bed-preset').value='custom';this.updateScene();this.positionParts();
  });
  this.get('#preview-bed-preset').addEventListener('change',()=>{const [w,h]=this.value('bed-preset').split('x').map(Number);if(w&&h){this.get<HTMLInputElement>('#preview-bed-width').value=String(w);this.get<HTMLInputElement>('#preview-bed-height').value=String(h);}this.updateScene();this.positionParts();});
  this.get('#preview-autorotate').addEventListener('change',()=>{if(this.controls){this.controls.autoRotate=this.checked('autorotate');if(this.controls.autoRotate&&this.controls.getPolarAngle()<.1)this.viewDirection(new THREE.Vector3(1,1,1).normalize());}});
  this.get<HTMLButtonElement>('[data-preview-png]').onclick=()=>void this.exportImage(false);
  this.get<HTMLButtonElement>('[data-preview-gif]').onclick=()=>void this.exportImage(true);
  this.materialFields();
  dialog.addEventListener('keydown',event=>{
   event.stopPropagation();if(event.target===this.renderer?.domElement){const delta=.12;if(event.key.toLowerCase()==='f')this.fit(false);else if(event.key==='ArrowLeft')this.orbit(-delta,0);else if(event.key==='ArrowRight')this.orbit(delta,0);else if(event.key==='ArrowUp')this.orbit(0,-delta);else if(event.key==='ArrowDown')this.orbit(0,delta);else if(event.key==='+'||event.key==='=')this.zoom(.85);else if(event.key==='-')this.zoom(1.15);else return;event.preventDefault();}
  });
  dialog.addEventListener('close',()=>{this.revision++;this.dispose();trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
 }
 private value(id:string):string{return this.get<HTMLInputElement>('#preview-'+id).value;}
 private checked(id:string):boolean{return this.get<HTMLInputElement>('#preview-'+id).checked;}
 private number(id:string,fallback=0):number {const input=this.get<HTMLInputElement>('#preview-'+id),n=input.valueAsNumber;return input.validity.valid&&Number.isFinite(n)?n:fallback;}
 private materialFields():void {this.dialog.querySelectorAll<HTMLElement>('[data-material-options]').forEach(el=>el.hidden=!el.dataset.materialOptions!.split(' ').includes(this.material.id));}
 private scheduleSurface():void {window.clearTimeout(this.surfaceTimer);this.surfaceTimer=window.setTimeout(()=>{this.surfaceTimer=0;this.rebuild();},100);}
 private tolerance():number{return this.value('detail')==='high'?.03:this.value('detail')==='draft'?.3:.1;}
 private get<T extends HTMLElement=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 async open():Promise<void>{
  const revision=++this.revision;
  this.dialog.showModal();this.trigger.setAttribute('aria-expanded','true');this.get<HTMLButtonElement>('[data-preview-close]').focus();
  this.message('Preparing your design…');
  try{
   const model=await buildPreviewModel(this.editor.objects,{tolerance:this.tolerance()})??await buildPreviewModel(this.editor.objects,{tolerance:this.tolerance(),shapesAsCuts:true});if(revision!==this.revision||!this.dialog.open)return;
   this.model=model;this.sheets=[];this.sheetControls();this.shapeChoices();if(!model){this.message('Nothing to preview yet','Move closed outlines to Cut Path or drawing paths to Engrave Path. Artwork and Construction Path stay in the editor.');return;}
   this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.setResolution(false);this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.9;this.renderer.setClearColor(getComputedStyle(this.stage).getPropertyValue('--preview-background').trim(),1);this.renderer.shadowMap.enabled=false;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
   const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','3D material preview. Drag to rotate, shift or right or middle-drag to pan, scroll or control-drag to zoom. Arrow keys rotate; plus and minus zoom; F fits the model.');canvas.setAttribute('role','img');
   canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(!this.dialog.open||this.renderer?.domElement!==canvas)return;this.message('Preview was interrupted','Close and reopen the preview to try again.');});
   this.stage.replaceChildren(canvas);this.stage.setAttribute('aria-busy','false');
   this.scene=new THREE.Scene();const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(this.renderer);this.environmentMap=pmrem.fromScene(environment,.04);this.scene.environment=this.environmentMap.texture;this.scene.environmentIntensity=.4;environment.dispose();pmrem.dispose();this.scene.add(new THREE.HemisphereLight('#ffffff','#697481',2));
   const span=Math.max(model.bounds.width,model.bounds.height,10),light=new THREE.DirectionalLight('#fff3df',3.5);light.position.set(-span,span*2,span);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.1,far:span*6});light.shadow.bias=-.0001;this.scene.add(light);
   const fill=new THREE.DirectionalLight('#cfdeff',1.3);fill.position.set(span,span*.7,-span);this.scene.add(fill);
   const underside=new THREE.DirectionalLight('#e4eaff',2);underside.position.set(span,-span*2,-span);this.scene.add(underside);
   this.assembly=new THREE.Group();this.assembly.rotation.x=-Math.PI/2;this.scene.add(this.assembly);this.addGrid(span);
   this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.controls.dampingFactor=.22;this.controls.zoomSpeed=.8;this.controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;this.navigationSensitivity();this.controls.minPolarAngle=.00001;this.controls.maxPolarAngle=Math.PI-.00001;this.controls.addEventListener('change',()=>this.render());this.controls.autoRotate=this.checked('autorotate');this.controls.autoRotateSpeed=1.5;
   this.controls.addEventListener('start',()=>{clearTimeout(this.restoreTimer);this.setResolution(true);});this.controls.addEventListener('end',()=>{this.restoreTimer=window.setTimeout(()=>{this.setResolution(false);this.render();},180);});
   // Keep modifier gestures familiar without changing OrbitControls internals.
   canvas.addEventListener('pointerdown',event=>{if(this.controls&&event.pointerType==='mouse')this.controls.mouseButtons.LEFT=event.ctrlKey||event.metaKey?THREE.MOUSE.DOLLY:THREE.MOUSE.ROTATE;},true);
   canvas.addEventListener('dblclick',()=>this.fit(false));
   let last=performance.now();this.renderer.setAnimationLoop(()=>{const now=performance.now(),delta=Math.min(.1,(now-last)/1000);last=now;if(!this.exporting&&!document.hidden&&this.controls&&(this.controls.enableDamping||this.controls.autoRotate))this.controls.update(delta);});
   this.observer.observe(this.stage);this.get('[data-preview-settings]').removeAttribute('inert');this.rebuild();this.updateScene();this.resize();this.fit();
  }catch(error){if(revision!==this.revision||!this.dialog.open)return;this.dispose();this.message('Unable to show preview',error instanceof Error?error.message:'Enable hardware acceleration and try again.');}
 }
 private message(title:string,detail=''):void{
  this.get('[data-preview-settings]').setAttribute('inert','');this.stage.replaceChildren();this.stage.setAttribute('aria-busy',String(title==='Preparing your design…'));
  const box=document.createElement('div');box.className='preview3d-empty';const heading=document.createElement('h3'),text=document.createElement('p');heading.textContent=title;text.textContent=detail;box.append(heading,text);this.stage.append(box);this.get('[data-preview-summary]').textContent='';this.get('[data-preview-note]').textContent='';
 }
 private clearMeshes(root:THREE.Object3D):void{disposeObjects(root);}
 /** A real XZ work plane: visible through cut-outs, with no solid floor hiding the underside. */
 private addGrid(span:number):void {
  const style=getComputedStyle(this.stage),colour=(token:string)=>style.getPropertyValue(token).trim();
  const step=this.value('units')==='in'?25.4*2**Math.floor(Math.log2(span/254)):10**Math.floor(Math.log10(span/10));
  const divisions=Math.ceil(span*6/step/10)*10,size=divisions*step;
  this.gridRadius=Math.SQRT2*size/2;
  const grid=new THREE.Group();grid.name='preview-grid';grid.position.y=-Math.max(.01,span*.0005);
  for(const [count,token] of [[divisions,'--preview-grid-minor'],[divisions/5,'--preview-grid-major']] as const){
   const lines=new THREE.GridHelper(size,count,colour('--preview-grid-axis'),colour(token));
   lines.material.transparent=true;lines.material.opacity=.65;lines.material.depthWrite=false;lines.material.toneMapped=false;
   grid.add(lines);
  }
  this.scene.add(grid);
 }
 private activeSheets():PreviewSheet[]{return this.checked('stack')&&this.sheets.length?this.sheets:[{name:'Design',model:this.model!,offset:0,ids:[]}];}
 private surfaceSettings():SurfaceSettings{return {grain:this.number('grain'),burn:this.checked('burn'),edge:this.value('edge'),transmission:this.number('transmission'),ior:this.number('ior',1.5),frost:this.checked('frost'),glow:this.checked('glow'),roughness:this.number('roughness',.36),metalness:this.number('metalness',.7),finish:this.value('finish'),border:this.value('border'),borderWidth:this.number('border-width',2),print:this.checked('print'),engraving:this.checked('engraving'),quality:this.value('quality'),kerf:this.checked('kerf'),kerfWidth:this.number('kerf-width',.2)};}
 private rebuild():void{
  if(!this.model||!this.renderer)return;
  clearTimeout(this.surfaceTimer);this.rebuildCount++;
  const sheets=this.activeSheets(),boxes=sheets.map(s=>s.model.bounds),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  this.bounds={x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
  const built=makeAssembly(sheets,this.bounds,this.material,this.surfaceSettings());
  this.clearMeshes(this.assembly);this.assembly.add(built.root);this.parts=built.parts;
  this.positionParts();
  this.get('[data-preview-note]').textContent=[sheets.some(s=>s.model.stock)?'No closed cut outline: showing engraving on a fitted rectangular blank.':'Nested outlines form through-holes. Preview changes never edit your drawing.',...sheets.filter(s=>s.model.openCuts).map(s=>`${s.name}: ${s.model.openCuts} open cut paths omitted.`)].join(' ');
 }
 private positionParts():void {
  if(!this.model||!this.parts.length)return;
  const amount=this.number('explode')/100,axis=this.value('explode-axis'),span=Math.max(this.bounds.width,this.bounds.height);
  this.parts.forEach((part,i)=>{
   for(const m of [part.face.material,part.back.material,...(Array.isArray(part.solid.material)?part.solid.material:[part.solid.material])])if(m instanceof THREE.MeshPhysicalMaterial)m.thickness=this.thickness;part.solid.scale.z=this.thickness;part.face.position.z=this.thickness;part.kerf.position.z=this.thickness+.01;
   const direction=axis==='x'?new THREE.Vector3(Math.sign(part.center.x)|| (i%2?1:-1),0,0):axis==='y'?new THREE.Vector3(0,Math.sign(part.center.y)||(i%2?1:-1),0):axis==='z'?new THREE.Vector3(0,0,i+1):part.center.clone().normalize();
   if(direction.lengthSq()===0)direction.set(Math.cos(i*2.4),Math.sin(i*2.4),0);
   part.group.position.copy(direction.multiplyScalar(span*.45*amount));part.group.position.z+=part.offset;
  });
  this.assembly.updateMatrixWorld(true);this.worldBox.makeEmpty();for(const part of this.parts)this.worldBox.union(new THREE.Box3().setFromObject(part.solid));if(this.material.id==='sticker'&&this.value('border')!=='none'){const edge=this.number('border-width',2);this.worldBox.min.x-=edge;this.worldBox.max.x+=edge;this.worldBox.min.z-=edge;this.worldBox.max.z+=edge;}this.updateGuides();
  const size=this.assemblyBox().getSize(new THREE.Vector3()),sheets=this.activeSheets(),pieces=sheets.reduce((n,s)=>n+s.model.parts,0),holes=sheets.reduce((n,s)=>n+s.model.holes,0);
  this.get('[data-preview-summary]').textContent=`${this.measure(size.x)} × ${this.measure(size.z)} × ${this.measure(size.y)} ${this.value('units')} · ${pieces} ${pieces===1?'piece':'pieces'} · ${holes} ${holes===1?'hole':'holes'}`;
  this.render();
 }
 private assemblyBox():THREE.Box3 {return this.worldBox;}
 private measure(mm:number):string{return Number((mm/(this.value('units')==='in'?25.4:this.value('units')==='cm'?10:1)).toFixed(this.value('units')==='in'?3:2)).toString();}
 private setResolution(moving:boolean):void {if(this.renderer&&!this.exporting)this.renderer.setPixelRatio(moving||this.value('quality')==='draft'?1:Math.min(devicePixelRatio,this.value('quality')==='high'?2:1.5));}
 private shapeChoices():void {
  const list=this.get('[data-preview-shapes]');list.replaceChildren();
  for(const item of this.editor.objects.filter(i=>i.visible&&i.layer.visible&&!i.data.dimension&&i.data.role!=='construction')){
   const label=document.createElement('label');label.className='preview3d-check';const input=document.createElement('input');input.type='checkbox';input.value=item.data.uid;input.checked=this.editor.selectedItems.includes(item);label.append(input,document.createTextNode(item.data.name??'Shape'));list.append(label);
  }
 }
 private sheetControls():void {
  const list=this.get('[data-preview-sheets]');list.replaceChildren();
  this.sheets.forEach((sheet,i)=>{
   const row=document.createElement('div');row.className='preview-sheet-row';const name=document.createElement('span');name.textContent=sheet.name;
   const offset=document.createElement('input');offset.type='number';offset.className='number-input';offset.min='0';offset.max='1000';offset.step='.1';offset.value=String(sheet.offset);offset.setAttribute('aria-label',`${sheet.name} Z offset in mm`);
   offset.oninput=()=>{if(offset.validity.valid&&Number.isFinite(offset.valueAsNumber)){sheet.offset=offset.valueAsNumber;this.parts.filter(p=>p.sheet===i).forEach(p=>p.offset=sheet.offset);this.positionParts();}};
   const remove=document.createElement('button');remove.type='button';remove.className='panel-icon';remove.setAttribute('aria-label',`Remove ${sheet.name}`);remove.textContent='×';remove.onclick=()=>{this.modelRevision++;this.sheets.splice(i,1);this.sheetControls();this.rebuild();};row.append(name,offset,remove);list.append(row);
  });
 }
 private async addSheet():Promise<void>{
  const status=this.get('[data-preview-sheet-status]'),button=this.get<HTMLButtonElement>('[data-preview-add-sheet]');
  if(this.sheets.length>=8){status.textContent='Up to 8 sheets per preview.';return;}
  const ids=[...this.dialog.querySelectorAll<HTMLInputElement>('[data-preview-shapes] input:checked')].map(i=>i.value),objects=this.editor.objects.filter(i=>ids.includes(i.data.uid));
  if(!objects.length){status.textContent='Choose at least one shape.';return;}
  const revision=this.revision,operation=++this.modelRevision;button.disabled=true;
  try{
   const model=await buildPreviewModel(objects,{shapesAsCuts:true,tolerance:this.tolerance()});if(revision!==this.revision)return;if(operation!==this.modelRevision){status.textContent='Preview changed. Add the sheet again when ready.';return;}
   if(!model)throw new Error('Choose closed shapes or engrave paths.');
   if([model,...this.sheets.map(s=>s.model)].reduce((n,m)=>n+m.contours.reduce((a,c)=>a+c.points.length,0),0)>120000)throw new Error('This assembly is too detailed. Use fewer shapes or lower curve detail.');
   this.sheets.push({name:this.value('sheet-name').trim()||`Sheet ${this.sheets.length+1}`,model,ids,offset:this.sheets.length*(this.thickness+1)});this.get<HTMLInputElement>('#preview-stack').checked=true;
   this.get<HTMLInputElement>('#preview-sheet-name').value=`Sheet ${this.sheets.length+1}`;this.sheetControls();this.rebuild();this.fit(false);status.textContent='Sheet added. Z offsets are in millimetres.';
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);}finally{button.disabled=false;}
 }
 private async changeDetail():Promise<void>{
  const revision=++this.modelRevision,session=this.revision,status=this.get('[data-preview-export-status]');
  try{
   const model=await buildPreviewModel(this.editor.objects,{tolerance:this.tolerance()})??await buildPreviewModel(this.editor.objects,{tolerance:this.tolerance(),shapesAsCuts:true});
   const sheets:PreviewSheet[]=[];for(const sheet of this.sheets){const next=await buildPreviewModel(this.editor.objects.filter(i=>sheet.ids.includes(i.data.uid)),{tolerance:this.tolerance(),shapesAsCuts:true});if(next)sheets.push({...sheet,model:next});}
   if(revision!==this.modelRevision||session!==this.revision)return;if(!model)throw new Error('No closed material remains at this curve detail.');if(sheets.reduce((n,s)=>n+s.model.contours.reduce((a,c)=>a+c.points.length,0),0)>120000)throw new Error('Use fewer sheets or a lower curve detail.');this.model=model;this.sheets=sheets;this.rebuild();
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
 }
 private updateScene():void {
  if(!this.model||!this.renderer)return;
  this.floor.removeFromParent();disposeObjects(this.floor);
  const span=Math.max(this.bounds.width,this.bounds.height,10);this.floor=sceneFloor(span,this.value('environment'),this.value('shadows'));this.scene.add(this.floor);
  this.renderer.shadowMap.enabled=this.value('shadows')==='soft';this.scene.traverse(o=>{if(o instanceof THREE.DirectionalLight){o.shadow.mapSize.set(this.value('quality')==='high'?2048:1024,this.value('quality')==='high'?2048:1024);o.shadow.needsUpdate=true;}});
  const grid=this.scene.getObjectByName('preview-grid');if(grid){grid.removeFromParent();disposeObjects(grid);}this.addGrid(span);this.scene.getObjectByName('preview-grid')!.visible=this.checked('grid');
  this.renderer.setClearColor(this.value('environment')==='room'?'#b4b8bd':getComputedStyle(this.stage).getPropertyValue('--preview-background').trim(),1);
  this.updateGuides();this.render();
 }
 private updateGuides():void {
  if(!this.model)return;this.guides.removeFromParent();disposeObjects(this.guides);this.guides=new THREE.Group();this.guides.name='preview-guides';this.scene.add(this.guides);
  const box=this.assemblyBox(),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),bedWidth=this.number('bed-width',600),bedHeight=this.number('bed-height',400);
  const fits=size.x<=bedWidth&&size.z<=bedHeight;
  if(this.checked('bed')){
   const points:number[]=[],line=(x1:number,z1:number,x2:number,z2:number)=>points.push(x1,-.02,z1,x2,-.02,z2),w=bedWidth/2,h=bedHeight/2;
   line(-w,-h,w,-h);line(w,-h,w,h);line(w,h,-w,h);line(-w,h,-w,-h);
   const step=this.value('units')==='in'?25.4:Math.max(10,10**Math.floor(Math.log10(Math.max(w,h)/20)));
   for(let x=-w,n=0;x<=w&&n<1000;x+=step,n++)line(x,h,x,h-(n%5?2:5));for(let z=-h,n=0;z<=h&&n<1000;z+=step,n++)line(-w,z,-w+(n%5?2:5),z);
   const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));this.guides.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:fits?'#57b7d3':'#ff765f',transparent:true,opacity:.85})));
   this.get('[data-preview-checks]').textContent=`${fits?'Fits':'Exceeds'} ${this.measure(bedWidth)} × ${this.measure(bedHeight)} ${this.value('units')} bed${fits?'':'. Reduce the design or use a larger bed'}.`;
  }else this.get('[data-preview-checks]').textContent='';
  const label=this.get('[data-preview-dimensions]');label.hidden=!this.checked('dimensions');
  if(this.checked('dimensions')){this.guides.add(new THREE.Box3Helper(box,0x57b7d3));label.textContent=`W ${this.measure(size.x)} × H ${this.measure(size.z)} × D ${this.measure(size.y)} ${this.value('units')}`;}
  // Bed is centred on the sheet assembly; offsets stay local to preview sheets.
  if(this.checked('bed')&&this.guides.children[0])this.guides.children[0].position.set(center.x,0,center.z);
 }
 private viewDirection(direction:THREE.Vector3):void {if(!this.controls||!this.model)return;const auto=this.controls.autoRotate;this.controls.autoRotate=false;this.fit();this.camera.position.copy(this.controls.target).addScaledVector(direction,this.fitDistance());this.controls.update();this.controls.autoRotate=auto;this.render();}
 /** Fixed angular and distance-relative pan sensitivity across window sizes. */
 private navigationSensitivity():void {
  if(!this.controls)return;
  const height=this.stage.clientHeight;
  this.controls.rotateSpeed=height/720; // Half a degree per CSS pixel.
  this.controls.panSpeed=height*.001/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
 }
 private radius():number {return Math.max(.01,this.assemblyBox().getSize(new THREE.Vector3()).length()/2);}
 private fitDistance():number {const fov=THREE.MathUtils.degToRad(this.camera.fov);return this.radius()/Math.sin(Math.min(fov,2*Math.atan(Math.tan(fov/2)*this.camera.aspect))/2)*1.2;}
 private resize():void{
  if(!this.renderer||this.exporting)return;const width=this.stage.clientWidth,height=this.stage.clientHeight;if(!width||!height)return;
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
  this.controls.target.copy(this.assemblyBox().getCenter(new THREE.Vector3()));this.camera.up.set(0,1,0);
  this.camera.position.copy(this.controls.target).addScaledVector(direction,this.fitDistance());this.updateClipping();this.controls.update();this.controls.enableDamping=damping;this.render();
 }
 private orbit(theta:number,phi:number):void{
  if(!this.controls)return;
  this.controls.rotateLeft(-theta);this.controls.rotateUp(-phi);this.controls.update();
 }
 /** Keep the camera outside the solid and fit its depth range to the whole model. */
 private updateClipping():void{
  if(!this.model||!this.controls)return;
  const radius=this.radius(),center=this.assemblyBox().getCenter(new THREE.Vector3()),offset=this.camera.position.clone().sub(center),safe=radius*1.05;
  this.controls.minDistance=safe;this.controls.maxDistance=Math.max(radius*30,this.fitDistance()*5,this.checked('bed')?Math.hypot(this.number('bed-width',600),this.number('bed-height',400))*5:0);
  if(offset.length()<safe){if(offset.lengthSq()===0)offset.set(0,0,1);this.camera.position.copy(center).add(offset.setLength(safe));this.camera.lookAt(this.controls.target);}
  const distance=this.camera.position.distanceTo(center);
  this.camera.near=Math.max(radius*1e-6,(distance-radius)*.25);this.camera.far=distance+Math.max(radius*4,this.gridRadius*1.1,this.checked('bed')?Math.hypot(this.number('bed-width',600),this.number('bed-height',400)):0);this.camera.updateProjectionMatrix();
 }
 private zoom(scale:number):void{if(!this.controls)return;const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*scale,this.controls.minDistance,this.controls.maxDistance));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
 private render():void{if(this.renderer&&this.dialog.open&&!this.exporting){this.updateClipping();this.floor.visible=this.camera.position.y>=0;this.renderer.render(this.scene,this.camera);}}
 private async exportImage(animated:boolean):Promise<void>{
  const renderer=this.renderer,controls=this.controls;if(!renderer||!controls||this.exporting)return;
  // Finish a pending material edit before freezing this export's scene.
  if(this.surfaceTimer){clearTimeout(this.surfaceTimer);this.surfaceTimer=0;this.rebuild();}
  const session=this.revision,status=this.get('[data-preview-export-status]'),size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio(),position=this.camera.position.clone(),quaternion=this.camera.quaternion.clone(),aspect=this.camera.aspect,auto=controls.autoRotate;
  const grid=this.scene.getObjectByName('preview-grid'),visibility=[this.floor,this.guides,grid].map(o=>o?.visible),background=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  const settings=this.get('[data-preview-settings]'),viewTools=this.get('.preview-view-tools');
  this.exporting=true;controls.enabled=false;controls.autoRotate=false;settings.setAttribute('inert','');viewTools.setAttribute('inert','');
  try{
   const requested=animated?Math.min(1,480/Math.max(size.x,size.y)):Number(this.value('export-scale'));
   const scale=Math.min(requested,4096/Math.max(size.x,size.y),Math.sqrt(12000000/(size.x*size.y)),renderer.capabilities.maxTextureSize/Math.max(size.x,size.y));
   const width=Math.max(1,Math.round(size.x*scale)),height=Math.max(1,Math.round(size.y*scale));
   renderer.setPixelRatio(1);renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:animated})!;
   let blob:Blob;
   if(animated){
    this.worker=new Worker(new URL('./previewGif.worker.ts',import.meta.url),{type:'module'});
    const offset=position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);if(spherical.phi<.15||spherical.phi>Math.PI-.15)spherical.phi=Math.PI/3;
    let bytes:Uint8Array<ArrayBuffer>|undefined;
    for(let frame=0;frame<36;frame++){
     if(session!==this.revision)throw new DOMException('Export cancelled','AbortError');
     status.textContent=`Creating turntable… ${frame+1} / 36`;
     this.camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(spherical.radius,spherical.phi,spherical.theta+frame*Math.PI*2/36)));this.camera.lookAt(controls.target);this.floor.visible=this.camera.position.y>=0;
     renderer.render(this.scene,this.camera);context.drawImage(renderer.domElement,0,0);const pixels=context.getImageData(0,0,width,height).data;
     const reply=await new Promise<{bytes?:Uint8Array<ArrayBuffer>}>((resolve,reject)=>{
      this.cancelExport=()=>reject(new DOMException('Export cancelled','AbortError'));
      this.worker!.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data);
      this.worker!.onerror=event=>reject(new Error(event.message||'GIF encoding failed'));
      this.worker!.postMessage({pixels,width,height,last:frame===35},[pixels.buffer]);
     });bytes=reply.bytes;
    }
    if(!bytes)throw new Error('GIF encoding returned no image.');blob=new Blob([bytes],{type:'image/gif'});
   }else{
    status.textContent='Creating PNG…';
    if(this.checked('transparent')){renderer.setClearAlpha(0);for(const o of [this.floor,this.guides,grid])if(o)o.visible=false;}
    renderer.render(this.scene,this.camera);context.drawImage(renderer.domElement,0,0);
    blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image capture failed.')),'image/png'));
   }
   if(session!==this.revision)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`vectora-preview.${animated?'gif':'png'}`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=`${animated?'GIF':'PNG'} ready · ${width} × ${height} px`;
  }catch(error){if(session===this.revision)status.textContent=error instanceof Error?error.message:String(error);}
  finally{
   this.worker?.terminate();this.worker=null;this.cancelExport=null;this.exporting=false;settings.removeAttribute('inert');viewTools.removeAttribute('inert');
   if(this.renderer===renderer){renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);renderer.setClearColor(background,alpha);this.camera.position.copy(position);this.camera.quaternion.copy(quaternion);this.camera.aspect=aspect;this.camera.updateProjectionMatrix();controls.enabled=true;controls.autoRotate=auto;[this.floor,this.guides,grid].forEach((o,i)=>{if(o)o.visible=visibility[i]??true;});this.resize();this.render();}
  }
 }
 private dispose():void{clearTimeout(this.surfaceTimer);clearTimeout(this.restoreTimer);this.cancelExport?.();this.worker?.terminate();this.worker=null;this.parts=[];this.modelRevision++;this.observer.disconnect();this.renderer?.setAnimationLoop(null);this.controls?.dispose();this.controls=null;this.clearMeshes(this.scene);this.environmentMap?.dispose();this.environmentMap=null;this.renderer?.dispose();this.renderer?.forceContextLoss();this.renderer=null;this.gridRadius=0;this.model=null;this.stage.replaceChildren();}
}
