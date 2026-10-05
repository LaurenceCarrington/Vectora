/** Local working documents. IndexedDB handles large drawings; the journal
 * covers an immediate refresh before an asynchronous database write completes. */
export interface RecoveryTab {id:string;contents:string;filename:string;dirty:boolean}
export interface RecoveryData {contents:string;filename:string;dirty:boolean;draft?:{content:string;sourceId:string|null;point:[number,number]|null};tabs?:RecoveryTab[];activeTabId?:string}
interface RecoveryRecord {version:1;time:number;id:string;data:RecoveryData}
const JOURNAL='vectora.recovery.pending';
function storageData(data:RecoveryData):RecoveryData {
 return Array.isArray(data.tabs)&&data.tabs.some(tab=>tab?.id===data.activeTabId&&tab?.contents===data.contents)?{...data,contents:''}:data;
}
function record(value:unknown):RecoveryRecord|null {
 if(!value||typeof value!=='object')return null;
 const r=value as RecoveryRecord,d=r.data;
 // Current tab contents already live in the tab list. Reconstitute the legacy
 // top-level alias when reading compact records, including older single-tab data.
 if(d?.contents===''&&Array.isArray(d.tabs)&&typeof d.activeTabId==='string'){
  const active=d.tabs.find(tab=>tab?.id===d.activeTabId);if(typeof active?.contents==='string')d.contents=active.contents;
 }
 return r.version===1&&Number.isFinite(r.time)&&typeof r.id==='string'&&d&&typeof d.contents==='string'&&typeof d.filename==='string'&&d.filename.length<=1000&&typeof d.dirty==='boolean'?r:null;
}
export class DocumentRecovery {
 private database:Promise<IDBDatabase>;
 private connection:IDBDatabase|null=null;
 private last='';
 private bytes=0;
 get usageBytes():number{return this.bytes;}
 private usage(bytes:number):void {this.bytes=bytes;window.dispatchEvent(new Event('vectora-recovery-change'));}
 private time=0;
 private warned=false;
 get needsRetry():boolean{return this.last==='';}
 constructor(private warn:(message:string)=>void){
  this.database=new Promise((resolve,reject)=>{
   const request=indexedDB.open('vectora-recovery',1),timer=setTimeout(()=>reject(new Error('Browser storage did not respond.')),4000);
   request.onupgradeneeded=()=>request.result.createObjectStore('documents');
   request.onsuccess=()=>{clearTimeout(timer);this.connection=request.result;request.result.onversionchange=()=>{request.result.close();this.connection=null;};resolve(request.result);};
   request.onerror=request.onblocked=()=>{clearTimeout(timer);reject(request.error??new Error('Browser storage is unavailable.'));};
  });
  // Storage may be disabled; the synchronous journal can still work.
  void this.database.catch(()=>{});
 }
 async read():Promise<RecoveryData|null>{
  let journal:RecoveryRecord|null=null,stored:RecoveryRecord|null=null;
  try{journal=record(JSON.parse(localStorage.getItem(JOURNAL)??'null'));}catch{/* Try the database. */}
  try{const db=await this.database;stored=record(await new Promise((resolve,reject)=>{const request=db.transaction('documents').objectStore('documents').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}));}catch{/* A journal survives failed database writes. */}
  const latest=journal&&(!stored||journal.time>=stored.time)?journal:stored;
  this.time=latest?.time??0;
  if(latest){this.usage(new Blob([JSON.stringify({...latest,data:storageData(latest.data)})]).size);this.last=JSON.stringify(storageData(latest.data));return latest.data;}return null;
 }
 write(data:RecoveryData):void {
  const compact=storageData(data);
  const content=JSON.stringify(compact);if(content===this.last)return;
  this.last=content;this.time=Math.max(Date.now(),this.time+1);
  const current:RecoveryRecord={version:1,time:this.time,id:crypto.randomUUID(),data:compact},serialized=JSON.stringify(current),bytes=new Blob([serialized]).size;let journal=false;
  try{localStorage.setItem(JOURNAL,serialized);journal=true;this.usage(bytes);}catch{/* Large drawings use IndexedDB. */}
  const store=(db:IDBDatabase)=>new Promise<void>((resolve,reject)=>{
   const transaction=db.transaction('documents','readwrite');transaction.objectStore('documents').put(current,'current');
   transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error);
  });
  // Start a ready database transaction now, including during beforeunload.
  // A deferred Promise callback may never run once navigation starts, and large
  // drawings can exceed the synchronous journal's localStorage quota.
  void (this.connection?store(this.connection):this.database.then(store)).then(()=>{
   if(current.time===this.time)this.usage(bytes);
   try{if(record(JSON.parse(localStorage.getItem(JOURNAL)??'null'))?.id===current.id)localStorage.removeItem(JOURNAL);}catch{/* Keep the journal if cleanup is unavailable. */}
  }).catch(()=>{
   if(!journal){this.last='';if(!this.warned){this.warned=true;this.warn('Browser recovery could not be saved. Use Save to keep a copy of your drawing.');}}
  });
 }
}
