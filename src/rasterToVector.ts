import paper from 'paper';
import type {CADEditor} from './editor';
import type {Shape} from './types';
import {DEFAULT_TRACE_SETTINGS,traceSVGPath,type RasterTraceSettings,type TraceMode,type TraceResult} from './rasterTrace';

export class RasterToVector {
  private source:ImageData|null=null;
  private result:TraceResult|null=null;
  private worker:Worker|null=null;
  private revision=0;
  private requestId=0;
  private debounce:ReturnType<typeof setTimeout>|undefined;
  private mode:TraceMode='outline';
  private settings={...DEFAULT_TRACE_SETTINGS};
  private filename='';
  private showBinary=true;
  private input:HTMLInputElement;
  private scale:HTMLInputElement;
  private add:HTMLButtonElement;
  private status:HTMLElement;
  private error:HTMLElement;
  private svg:SVGSVGElement;
  private sourceCanvas:HTMLCanvasElement;
  private binaryCanvas:HTMLCanvasElement;
  constructor(private dialog:HTMLDialogElement,private editor:CADEditor,trigger:HTMLButtonElement,private beforeOpen:()=>void){
    this.input=this.get('#raster-file');this.scale=this.get('#raster-scale');this.add=this.get('#raster-add');this.status=this.get('#raster-status');this.error=this.get('#raster-error');this.svg=this.get('#raster-vector');this.sourceCanvas=this.get('#raster-source');this.binaryCanvas=this.get('#raster-binary');
    trigger.addEventListener('click',()=>this.open());this.get<HTMLButtonElement>('#raster-input').onclick=()=>this.input.click();
    this.input.onchange=()=>{const file=this.input.files?.[0];if(file)void this.load(file);this.input.value='';};
    dialog.querySelectorAll<HTMLButtonElement>('[data-raster-close]').forEach(button=>button.onclick=()=>dialog.close());
    dialog.querySelectorAll<HTMLInputElement>('[name="raster-mode"]').forEach(input=>input.onchange=()=>{this.mode=input.value as TraceMode;this.updateMode();this.trace();});
    dialog.querySelectorAll<HTMLInputElement>('[data-trace-setting]').forEach(input=>input.oninput=()=>{const key=input.dataset.traceSetting as Exclude<keyof RasterTraceSettings,'invert'>;this.settings[key]=input.valueAsNumber;this.updateSlider(input);this.trace();});
    this.get<HTMLInputElement>('#raster-invert').onchange=event=>{this.settings.invert=(event.target as HTMLInputElement).checked;this.trace();};
    dialog.querySelectorAll<HTMLButtonElement>('[data-raster-view]').forEach(button=>button.onclick=()=>{this.showBinary=button.dataset.rasterView==='binary';this.updateInputView();});
    this.scale.oninput=()=>this.updateAdd();this.add.onclick=()=>this.insert();
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Tab'){
      const targets=[...dialog.querySelectorAll<HTMLElement>('button,input,[tabindex]')].filter(element=>!element.matches(':disabled,[hidden]')&&element.tabIndex>=0&&element.getClientRects().length>0),first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }});
    dialog.addEventListener('close',()=>{this.stop();this.source=null;this.result=null;document.querySelector<HTMLButtonElement>('[data-image-trigger]')?.focus({preventScroll:true});});
  }
  private get<T extends Element=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
  private stop():void{this.revision++;this.requestId++;clearTimeout(this.debounce);this.worker?.terminate();this.worker=null;}
  private open():void{
    if(this.dialog.open)return;this.beforeOpen();this.stop();this.source=null;this.result=null;this.filename='';this.mode='outline';this.settings={...DEFAULT_TRACE_SETTINGS};this.showBinary=true;
    this.get<HTMLInputElement>('[value="outline"]').checked=true;this.scale.value='0.25';this.get<HTMLInputElement>('#raster-invert').checked=false;
    this.dialog.querySelectorAll<HTMLInputElement>('[data-trace-setting]').forEach(input=>{input.value=String(this.settings[input.dataset.traceSetting as Exclude<keyof RasterTraceSettings,'invert'>]);this.updateSlider(input);});
    this.binaryCanvas.width=0;this.get('#raster-filename').textContent='Choose an image to trace.';this.get('#raster-detail').textContent='Images are processed on your device.';
    this.status.textContent='Choose an image to begin.';this.get('#raster-vector-surface').setAttribute('aria-busy','false');this.error.hidden=true;this.updateMode();this.updateInputView();this.clearPreview('No traceable paths');this.updateAdd();this.dialog.showModal();this.get<HTMLButtonElement>('#raster-input').focus();
  }
  private updateSlider(input:HTMLInputElement):void{
    this.get(`#${input.id}-value`).textContent=input.value;
    input.style.setProperty('--range-progress',`${(input.valueAsNumber-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);
  }
  private updateMode():void{this.dialog.querySelectorAll<HTMLElement>('[data-curve-control]').forEach(element=>element.hidden=this.mode==='centerline');}
  private updateInputView():void{
    this.get('#raster-input').setAttribute('aria-label',this.source?'Replace image':'Choose an image');
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-raster-view]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.rasterView==='binary')===this.showBinary)));
    this.sourceCanvas.hidden=!this.source||this.showBinary;this.binaryCanvas.hidden=!this.source||!this.showBinary||this.binaryCanvas.width===0;this.get('#raster-empty').hidden=!!this.source;
  }
  private clearPreview(message:string):void{this.svg.setAttribute('hidden','');this.get('#raster-vector-empty').hidden=false;this.get('#raster-vector-empty').textContent=message;this.get('#raster-path-count').textContent='';}
  private async load(file:File):Promise<void>{
    this.stop();const revision=this.revision;this.source=null;this.result=null;this.binaryCanvas.width=0;this.updateAdd();this.error.hidden=true;this.updateInputView();this.clearPreview('Decoding image…');this.status.textContent='Loading image…';
    let bitmap:ImageBitmap|undefined;
    try{
      if(file.size>20*1024*1024)throw new Error('Choose an image smaller than 20 MB.');
      if(!(/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)||/^image\/(png|jpeg|webp|gif|bmp|x-ms-bmp)$/.test(file.type))||file.type==='image/svg+xml')throw new Error('Choose a PNG, JPG, WebP, GIF or BMP image.');
      bitmap=await createImageBitmap(file);if(revision!==this.revision||!this.dialog.open)return;
      if(bitmap.width*bitmap.height>40_000_000)throw new Error('Choose an image with fewer than 40 million pixels.');
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=this.sourceCanvas;
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d',{willReadFrequently:true})!;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);this.source=context.getImageData(0,0,canvas.width,canvas.height);this.filename=file.name;
      this.get('#raster-filename').textContent=file.name;this.get('#raster-detail').textContent=`${canvas.width} × ${canvas.height} trace pixels${scale<1?' · Scaled to 1600px':''} · Processed locally`;
      this.updateInputView();this.startWorker();this.trace();
    }catch(error){if(revision===this.revision)this.fail(error instanceof Error?error.message:'This image could not be opened.');}
    finally{bitmap?.close();}
  }
  private startWorker():void{
    const worker=new Worker(new URL('./rasterTrace.worker.ts',import.meta.url),{type:'module'});this.worker=worker;
    worker.onmessage=event=>{
      const response=event.data;if(response.revision!==this.revision||response.requestId!==this.requestId||!this.dialog.open)return;
      if(response.error){this.fail(response.error);return;}
      this.result=response.result;const result=this.result!,paths=result.paths,path=this.svg.querySelector('path')!;
      this.binaryCanvas.width=response.preview.width;this.binaryCanvas.height=response.preview.height;this.binaryCanvas.getContext('2d')!.putImageData(response.preview,0,0);this.updateInputView();
      this.svg.setAttribute('viewBox',`0 0 ${result.width} ${result.height}`);this.svg.style.aspectRatio=`${result.width} / ${result.height}`;
      path.setAttribute('d',traceSVGPath(paths));path.setAttribute('fill',result.mode==='fill'?this.editor.drawingColor:'none');path.setAttribute('stroke',result.mode==='fill'?'none':this.editor.drawingColor);
      this.svg.toggleAttribute('hidden',!paths.length);this.get('#raster-vector-empty').hidden=!!paths.length;this.get('#raster-vector-empty').textContent='No traceable paths';this.get('#raster-vector-surface').setAttribute('aria-busy','false');this.get('#raster-path-count').textContent=`${paths.length} ${paths.length===1?'path':'paths'}`;
      this.status.textContent=paths.length?`${result.foregroundPixels.toLocaleString()} source pixels · ${result.pointCount.toLocaleString()} ${result.mode==='centerline'?'skeleton nodes':'fitted points'} · ${Math.round(response.elapsedMs)} ms`:'No traceable paths. Adjust the image settings or choose another image.';
      this.updateAdd();
    };
    worker.onerror=event=>{if(this.worker!==worker)return;event.preventDefault();worker.terminate();this.worker=null;this.fail('The trace could not finish. Choose the image again to retry.');};
    const imageData=new ImageData(new Uint8ClampedArray(this.source!.data),this.source!.width,this.source!.height);worker.postMessage({type:'source',revision:this.revision,imageData},[imageData.data.buffer]);
  }
  private trace():void{
    // Invalidate immediately, before the debounce, so old results cannot be inserted under new settings.
    clearTimeout(this.debounce);const requestId=++this.requestId;this.result=null;this.error.hidden=true;this.updateAdd();if(!this.source||!this.worker)return;
    this.status.textContent='Tracing…';this.get('#raster-vector-surface').setAttribute('aria-busy','true');this.get('#raster-path-count').textContent='Tracing…';
    if(this.svg.hasAttribute('hidden'))this.clearPreview('Tracing…');
    this.debounce=setTimeout(()=>this.worker?.postMessage({type:'trace',revision:this.revision,requestId,mode:this.mode,settings:{...this.settings}}),90);
  }
  private fail(message:string):void{this.result=null;this.status.textContent='';this.error.hidden=false;this.error.textContent=message;this.get('#raster-vector-surface').setAttribute('aria-busy','false');this.clearPreview('No traceable paths');this.updateAdd();}
  private updateAdd():void{
    const valid=this.scale.validity.valid&&Number.isFinite(this.scale.valueAsNumber);this.scale.setAttribute('aria-invalid',String(!valid));this.add.disabled=!valid||!this.result?.paths.length;
    this.get('#raster-size').textContent=this.source&&valid?`${Number((this.source.width*this.scale.valueAsNumber).toFixed(2))} × ${Number((this.source.height*this.scale.valueAsNumber).toFixed(2))} mm`:'';
  }
  private insert():void{
    if(!this.result?.paths.length||this.add.disabled)return;
    const result=this.result,scale=this.scale.valueAsNumber,origin=paper.view.center.subtract(new paper.Point(result.width*scale/2,result.height*scale/2));
    // Preserve the original fitted cubic segments as native Paper.js curves.
    const paths=result.paths.map(trace=>{const path=new paper.Path({insert:false,pathData:trace.svg});path.scale(scale,new paper.Point(0,0));path.translate(origin);return path;});
    const items:Shape[]=result.mode==='fill'?[new paper.CompoundPath({insert:false,children:paths,fillRule:'evenodd'})]:paths;
    items.forEach(item=>{item.fillColor=result.mode==='fill'?new paper.Color(this.editor.drawingColor):null;item.strokeColor=result.mode==='fill'?null:new paper.Color(this.editor.drawingColor);item.strokeWidth=1.5;item.strokeScaling=false;item.strokeCap='round';item.strokeJoin='round';item.data.rasterTrace={mode:result.mode,settings:{...this.settings},sourceName:this.filename};});
    try{this.editor.addTracedShapes(items,`Trace · ${this.filename}`);this.editor.setTool('select');this.dialog.close();this.editor.canvas.focus({preventScroll:true});}
    catch(error){items.forEach(item=>item.remove());this.error.hidden=false;this.error.textContent=(error as Error).message;}
  }
}
