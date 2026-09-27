import {processRaster} from './rasterTrace';
let source:ImageData|null=null,revision=-1;
self.onmessage=event=>{
  const message=event.data;
  if(message.type==='source'){source=message.imageData;revision=message.revision;return;}
  try{
    if(!source||revision!==message.revision)throw new Error('The source image is no longer available.');
    const started=performance.now(),response=processRaster(source,message.mode,message.settings);
    self.postMessage({...response,revision,requestId:message.requestId,elapsedMs:performance.now()-started},{transfer:[response.preview.data.buffer]});
  }catch(error){self.postMessage({revision,requestId:message.requestId,error:error instanceof Error?error.message:'Unable to trace this image.'});}
};
