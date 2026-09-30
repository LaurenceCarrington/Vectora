import paper from 'paper';
import {loadTextFont} from './text';
import {DocumentRecovery,type RecoveryData} from './documentRecovery';
import {DocumentName} from './documentName';
import {DocumentTabs} from './documentTabs';
import type {EditorSession} from './types';
import type {CADEditor} from './editor';
import {encodeDocument,decodeDocument,documentKey,MAX_DOCUMENT_BYTES} from './documentFormat';
import type {AlertKind} from './alerts';

type FileHandle={name:string;getFile:()=>Promise<File>;createWritable:()=>Promise<{write:(data:string)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>}>};
type PickerOptions={suggestedName?:string;multiple?:boolean;types:{description:string;accept:Record<string,string[]>}[]};
type FileWindow=Window&{showSaveFilePicker?:(options:PickerOptions)=>Promise<FileHandle>;showOpenFilePicker?:(options:PickerOptions)=>Promise<FileHandle[]>};
const pickerTypes=[{description:'Vectora document',accept:{'application/json':['.vectora']}}];
type DocumentTab={id:string;filename:string;handle:FileHandle|null;savedKey:string;renamed:boolean;dirty:boolean;state:EditorSession;contents:string};

export class DocumentFiles {
 private handle:FileHandle|null=null;
 private filename='Untitled.vectora';
 private savedKey:string;
 private busy=false;
 private renamed=false;
 private nameControl:DocumentName;
 private recovery:DocumentRecovery;
 private recoveryReady=false;
 private restoring=false;
 private changedDuringStartup=false;
 private timer:number|undefined;
 private draft:()=>RecoveryData['draft']=()=>undefined;
 private tabs:DocumentTab[]=[];
 private activeId:string=crypto.randomUUID();
 private tabBar:DocumentTabs;

 constructor(private editor:CADEditor,private dialog:HTMLDialogElement,private input:HTMLInputElement,private prepare:()=>boolean,private notify:(message:string,kind:AlertKind)=>void){
  this.savedKey=documentKey(editor);
  this.tabs=[{id:this.activeId,filename:this.filename,handle:null,savedKey:this.savedKey,renamed:false,dirty:false,state:editor.captureSession(),contents:encodeDocument(editor)}];
  this.tabBar=new DocumentTabs(document.querySelector<HTMLElement>('[data-document-tabs]')!,{select:id=>this.selectTab(id),close:id=>this.closeTab(id),create:()=>this.newDocument()});
  this.recovery=new DocumentRecovery(message=>this.notify(message,'warning'));
  this.nameControl=new DocumentName(document.querySelector<HTMLElement>('[data-document-name]')!,name=>{
   this.filename=name;this.handle=null;this.renamed=true;this.cache();
  },()=>{if(this.busy||!this.prepare())return false;this.editor.cancel();return true;},as=>{void this.save(as);});
  this.updateName();
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)void this.run(()=>this.load(file,null));});
  window.addEventListener('beforeunload',event=>{
   this.nameControl.commit();this.cache();
   // Browsers require a prior user interaction and supply their own confirmation wording.
   event.preventDefault();event.returnValue='';
  });
  window.addEventListener('pagehide',()=>this.cache());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')this.cache();});
  const schedule=()=>{if(this.timer===undefined)this.timer=window.setTimeout(()=>{this.timer=undefined;this.cache();},250);};
  editor.onDocumentChange=()=>this.cache();
  editor.canvas.addEventListener('pointerup',schedule);editor.canvas.addEventListener('wheel',schedule,{passive:true});
  document.querySelector('#inline-text')!.addEventListener('input',schedule);
  document.addEventListener('click',schedule);document.addEventListener('keyup',schedule);

 }
 private get activeTab():DocumentTab {return this.tabs.find(tab=>tab.id===this.activeId)!;}
 private renderTabs():void {
  this.tabBar.render(this.tabs.map(tab=>({id:tab.id,filename:tab.id===this.activeId?this.filename:tab.filename,dirty:tab.id===this.activeId?this.dirty||!!this.draft():tab.dirty})),this.activeId,this.busy);
 }
 private rememberActive():void {
  Object.assign(this.activeTab,{filename:this.filename,handle:this.handle,savedKey:this.savedKey,renamed:this.renamed,dirty:this.dirty,state:this.editor.captureSession(),contents:encodeDocument(this.editor)});
 }
 private prepareNavigation():boolean {
  this.nameControl.commit();if(!this.prepare())return false;this.editor.cancel();return true;
 }
 private activate(tab:DocumentTab):void {
  this.restoring=true;
  try{
   this.editor.loadSession(tab.state);this.activeId=tab.id;this.filename=tab.filename;this.handle=tab.handle;this.renamed=tab.renamed;
   this.savedKey=tab.savedKey||documentKey(this.editor);this.updateName();
  }finally{this.restoring=false;}
 }
 selectTab(id:string):Promise<void>{return this.run(async()=>{
  const tab=this.tabs.find(tab=>tab.id===id);if(!tab||id===this.activeId||!this.prepareNavigation())return;
  this.rememberActive();this.activate(tab);
 });}
 closeTab(id:string):Promise<void>{return this.run(async()=>{
  if(!this.prepareNavigation())return;this.rememberActive();
  const index=this.tabs.findIndex(tab=>tab.id===id),tab=this.tabs[index];if(!tab)return;
  if(tab.dirty&&await this.prompt('Close document?',`${tab.filename} has unsaved changes. Close without saving, or cancel to save it first.`,'Close without saving')===null)return;
  if(this.tabs.length===1){this.createBlank(false);return;}
  if(id===this.activeId)this.activate(this.tabs[index+1]??this.tabs[index-1]);
  this.tabs.splice(index,1);this.renderTabs();
 });}
 private createBlank(append=true):void {
  this.restoring=true;
  try{
   this.editor.newDocument();this.handle=null;this.renamed=false;this.savedKey=documentKey(this.editor);
   let number=1,name='Untitled.vectora';while(append&&this.tabs.some(tab=>tab.filename===name))name=`Untitled ${++number}.vectora`;
   this.filename=name;this.activeId=crypto.randomUUID();
   const tab:DocumentTab={id:this.activeId,filename:name,handle:null,savedKey:this.savedKey,renamed:false,dirty:false,state:this.editor.captureSession(),contents:encodeDocument(this.editor)};
   if(append)this.tabs.push(tab);else this.tabs=[tab];this.updateName();
  }finally{this.restoring=false;}
  this.editor.canvas.focus({preventScroll:true});
 }
 async restoreRecovery(draft:()=>RecoveryData['draft']):Promise<void>{
  this.draft=draft;
  const workspace=document.querySelector<HTMLElement>('#workspace')!;workspace.inert=true;
  try{
   const data=await this.recovery.read();
   if(data&&!this.changedDuringStartup){
    const records=Array.isArray(data.tabs)&&data.tabs.length?data.tabs:[{id:this.activeId,contents:data.contents,filename:data.filename,dirty:data.dirty}];
    const recovered:DocumentTab[]=[];
    for(const record of records){
     try{
      if(!record||typeof record.id!=='string'||!/^[-\w]{1,100}$/.test(record.id)||recovered.some(tab=>tab.id===record.id)||typeof record.filename!=='string'||record.filename.length>1000||typeof record.contents!=='string'||typeof record.dirty!=='boolean')throw new Error('Invalid document tab.');
      const loaded=await decodeDocument(record.contents);
      recovered.push({...record,handle:null,savedKey:'',renamed:record.dirty,state:{...loaded,undo:[],redo:[],tool:'select'}});
     }catch(error){this.notify(`Could not restore a document tab. ${error instanceof Error?error.message:String(error)}`,'warning');}
    }
    if(!recovered.length)throw new Error('No valid document tabs were found.');
    if(!this.changedDuringStartup){
     const active=recovered.find(tab=>tab.id===data.activeTabId)??recovered[0];
     this.activate(active);this.tabs=recovered;this.renderTabs();this.restoring=true;
     const pending=!data.activeTabId||active.id===data.activeTabId?data.draft:undefined;
     if(pending){
      if(typeof pending.content!=='string'||pending.content.length>500)throw new Error('The recovered text draft is invalid.');
      const source=pending.sourceId?this.editor.objects.find(item=>item.data.uid===pending.sourceId):undefined;
      if(pending.sourceId&&!source?.data.text)throw new Error('The recovered text object is missing.');
      if(!source&&(!Array.isArray(pending.point)||pending.point.length!==2||!pending.point.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6)))throw new Error('The recovered text position is invalid.');
      if(pending.content.trim()){
       await loadTextFont(source?.data.text.fontId??'lato');
       this.editor.saveText(pending.content,source?.data.text.sizeMM??10,source?null:new paper.Point(...pending.point!),source?.data.uid??null,source?.data.text.fontId??'lato');
      }else if(source){this.editor.select(source);this.editor.deleteSelection();}
      this.renamed=true;
     }
     this.rememberActive();this.renderTabs();
     this.notify(this.tabs.length===1?'Restored your last document from this browser.':`Restored ${this.tabs.length} document tabs from this browser.`,'information');
    }
   }
  }catch(error){this.notify(`Could not fully restore the browser copy. ${error instanceof Error?error.message:String(error)}`,'warning');}
  finally{this.restoring=false;this.recoveryReady=true;workspace.inert=false;if(this.changedDuringStartup)this.cache();}
 }
 private cache():void {
  if(this.restoring)return;
  if(!this.recoveryReady){this.changedDuringStartup=true;return;}
  if(this.editor.hasPendingGesture)return;
  const draft=this.draft();let contents=encodeDocument(this.editor);
  // Inline editing temporarily hides the original glyphs behind its textarea.
  if(draft?.sourceId){const data=JSON.parse(contents);for(const layer of data.layers)for(const object of layer.objects)if(object.data.uid===draft.sourceId)object.visible=true;contents=JSON.stringify(data);}
  this.activeTab.contents=contents;this.activeTab.filename=this.filename;this.activeTab.dirty=this.dirty||!!draft;
  this.renderTabs();
  this.recovery.write({contents,filename:this.filename,dirty:this.dirty||!!draft,draft,activeTabId:this.activeId,tabs:this.tabs.map(({id,filename,contents,dirty})=>({id,filename,contents,dirty}))});
 }
 private updateName():void {
  this.nameControl.setName(this.filename);
  this.renderTabs();
 }
 private get dirty():boolean{return this.renamed||documentKey(this.editor)!==this.savedKey;}
 private async run(action:()=>Promise<void>):Promise<void>{
  if(this.busy)return;this.busy=true;this.renderTabs();
  try{await action();}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))this.notify(error instanceof Error?error.message:String(error),'error');}
  finally{this.busy=false;this.renderTabs();this.cache();}
 }
 private prompt(title:string,message:string,confirm:string):Promise<string|null>{
  const form=this.dialog.querySelector('form')!;
  this.dialog.querySelector('[data-document-title]')!.textContent=title;this.dialog.querySelector('[data-document-message]')!.textContent=message;
  this.dialog.querySelector('[data-document-confirm]')!.textContent=confirm;
  this.dialog.returnValue='';this.dialog.showModal();this.dialog.querySelector<HTMLButtonElement>('[data-document-cancel]')!.focus();
  form.onsubmit=event=>{event.preventDefault();const submitter=(event as SubmitEvent).submitter as HTMLButtonElement|null;this.dialog.close(submitter?.value==='cancel'?'cancel':'confirm');};
  return new Promise(resolve=>this.dialog.addEventListener('close',()=>{resolve(this.dialog.returnValue==='confirm'?'confirm':null);this.editor.canvas.focus({preventScroll:true});},{once:true}));
 }
 save(as=false):Promise<void>{return this.run(async()=>{
  this.nameControl.commit();
  if(!this.prepare())return;
  const contents=encodeDocument(this.editor),key=documentKey(this.editor),api=window as FileWindow;
  if(new Blob([contents]).size>MAX_DOCUMENT_BYTES)throw new Error('This drawing is too large to save as a Vectora document (50 MB maximum).');
  if(api.showSaveFilePicker){
   const handle=as||!this.handle?await api.showSaveFilePicker({suggestedName:this.filename,types:pickerTypes}):this.handle;
   const writable=await handle.createWritable();try{await writable.write(contents);await writable.close();}catch(error){try{await writable.abort();}catch{/* The stream may already be closed. */}throw error;}
   this.handle=handle;this.filename=handle.name;this.savedKey=key;this.renamed=false;this.updateName();
   this.notify(`Saved ${this.filename}.`,'success');
  }else{
   const filename=this.filename;
   const url=URL.createObjectURL(new Blob([contents],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   // Downloads have no reliable completion/cancellation callback. Keep unsaved-change protection and do not claim success.
  }
 });}
 newDocument():Promise<void>{return this.run(async()=>{
  if(!this.prepareNavigation())return;
  this.rememberActive();this.createBlank();
 });}
 open():Promise<void>{
  if(this.busy||!this.prepare())return Promise.resolve();
  const api=window as FileWindow;
  if(!api.showOpenFilePicker){this.input.value='';this.input.click();return Promise.resolve();}
  return this.run(async()=>{const [handle]=await api.showOpenFilePicker!({multiple:false,types:pickerTypes});if(handle)await this.load(await handle.getFile(),handle);});
 }
 private async load(file:File,handle:FileHandle|null):Promise<void>{
  if(file.size>MAX_DOCUMENT_BYTES)throw new Error('Choose a Vectora document smaller than 50 MB.');
  const document=await decodeDocument(await file.text());
  if(!this.prepareNavigation())return;this.rememberActive();
  this.restoring=true;
  try{
   this.editor.loadDocument(document.snapshot,document.view);this.handle=handle;this.filename=file.name;this.savedKey=documentKey(this.editor);this.renamed=false;this.activeId=crypto.randomUUID();
   this.tabs.push({id:this.activeId,filename:this.filename,handle,savedKey:this.savedKey,renamed:false,dirty:false,state:this.editor.captureSession(),contents:encodeDocument(this.editor)});this.updateName();
  }finally{this.restoring=false;}
  this.notify(`Opened ${file.name}.`,'success');
 }
}
