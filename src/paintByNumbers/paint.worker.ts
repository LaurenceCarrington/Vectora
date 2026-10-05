import {processPaint} from './process';
self.onmessage=event=>{
 const {source,settings,revision,requestId}=event.data;
 try{self.postMessage({revision,requestId,result:processPaint(source,settings)});}
 catch(error){self.postMessage({revision,requestId,error:error instanceof Error?error.message:'Could not generate colouring regions.'});}
};
