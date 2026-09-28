import {GIFEncoder,quantize,applyPalette} from 'gifenc';
const gif=GIFEncoder();
self.onmessage=(event:MessageEvent<{pixels:Uint8ClampedArray;width:number;height:number;last:boolean}>)=>{
 try{
  const {pixels,width,height,last}=event.data,palette=quantize(pixels,256,{format:'rgb444'}),indexed=applyPalette(pixels,palette,'rgb444');
  gif.writeFrame(indexed,width,height,{palette,delay:80,repeat:0});
  if(last){gif.finish();const bytes=gif.bytes();self.postMessage({bytes}, {transfer:[bytes.buffer]});}else self.postMessage({ready:true});
 }catch(error){self.postMessage({error:String(error)});}
};
