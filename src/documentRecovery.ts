/** Local working documents. IndexedDB handles large drawings; the journal
 * covers an immediate refresh before an asynchronous database write completes. */
export interface RecoveryTab {id:string;contents:string;filename:string;dirty:boolean}
export interface RecoveryData {contents:string;filename:string;dirty:boolean;draft?:{content:string;sourceId:string|null;point:[number,number]|null};tabs?:RecoveryTab[];activeTabId?:string}
interface RecoveryRecord {version:1;time:number;id:string;data:RecoveryData}
const JOURNAL='vectora.recovery.pending';
function record(value:unknown):RecoveryRecord|null {
 if(!value||typeof value!=='object')return null;
 const r=value as RecoveryRecord,d=r.data;
 return r.version===1&&Number.isFinite(r.time)&&typeof r.id==='string'&&d&&typeof d.contents==='string'&&typeof d.filename==='string'&&d.filename.length<=1000&&typeof d.dirty==='boolean'?r:null;
}
export class DocumentRecovery {
 private database:Promise<IDBDatabase>;
 private last='';
 private time=0;
 private warned=false;
 constructor(private warn:(message:string)=>void){
  this.database=new Promise((resolve,reject)=>{
   const request=indexedDB.open('vectora-recovery',1),timer=setTimeout(()=>reject(new Error('Browser storage did not respond.')),4000);
   request.onupgradeneeded=()=>request.result.createObjectStore('documents');
   request.onsuccess=()=>{clearTimeout(timer);request.result.onversionchange=()=>request.result.close();resolve(request.result);};
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
  if(latest){this.last=JSON.stringify(latest.data);return latest.data;}return null;
 }
 write(data:RecoveryData):void {
  const content=JSON.stringify(data);if(content===this.last)return;
  this.last=content;this.time=Math.max(Date.now(),this.time+1);
  const current:RecoveryRecord={version:1,time:this.time,id:crypto.randomUUID(),data};let journal=false;
  try{localStorage.setItem(JOURNAL,JSON.stringify(current));journal=true;}catch{/* Large drawings use IndexedDB. */}
  void this.database.then(db=>new Promise<void>((resolve,reject)=>{
   const transaction=db.transaction('documents','readwrite');transaction.objectStore('documents').put(current,'current');
   transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error);
  })).then(()=>{
   try{if(record(JSON.parse(localStorage.getItem(JOURNAL)??'null'))?.id===current.id)localStorage.removeItem(JOURNAL);}catch{/* Keep the journal if cleanup is unavailable. */}
  }).catch(()=>{
   if(!journal){this.last='';if(!this.warned){this.warned=true;this.warn('Browser recovery could not be saved. Use Save to keep a copy of your drawing.');}}
  });
 }
}
