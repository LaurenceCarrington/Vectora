import {test,expect} from './fixtures';
import {mixedDrawing} from './mixedDrawingHelpers';
import {mkdir,writeFile} from 'node:fs/promises';

for(const count of [2500,5000,10000])test(`Mixed drawing benchmark: ${count} objects`,async({page},testInfo)=>{
 test.setTimeout(120_000);
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,count);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 await page.evaluate(()=>{
  const e=(window as any).__vectora,stats:any={phase:'',phases:{}};(window as any).__mixedPerf=stats;
  for(const name of ['snapshot','hitObject','drawOverlay','changed','onChange','onDocumentChange']){
   const original=e[name];e[name]=function(...args:any[]){const start=performance.now();try{return original.apply(this,args);}finally{if(stats.phase){const phase=stats.phases[stats.phase]??={methods:{},events:[]};const entry=phase.methods[name]??={ms:0,calls:0};entry.ms+=performance.now()-start;entry.calls++;}}};
  }
  let start=0;for(const name of ['pointerdown','pointermove','pointerup']){
   e.canvas.addEventListener(name,()=>{start=performance.now();},{capture:true});
   e.canvas.addEventListener(name,()=>{if(stats.phase)(stats.phases[stats.phase]??={methods:{},events:[]}).events.push({type:name,ms:performance.now()-start});});
  }
 });
 await cdp.send('Profiler.start');
 const phase=async(name:string)=>page.evaluate(name=>{(window as any).__mixedPerf.phase=name;},name);
 const point=async(index:number,corner=false)=>page.evaluate(({index,corner})=>{
  const e=(window as any).__vectora,p=(window as any).__paper,b=e.objects[index].bounds;
  const v=p.view.projectToView(corner?b.bottomRight:b.center),r=e.canvas.getBoundingClientRect();return {x:r.x+v.x,y:r.y+v.y};
 },{index,corner});
 const mid=Math.floor(count/200)*100+50;
 await phase('click');const at=await point(mid);await page.mouse.click(at.x,at.y);
 expect(await page.evaluate(()=>(window as any).__vectora.selectedItems.map((s:any)=>s.data.uid))).toEqual([`mixed-${mid}`]);
 await phase('single drag');await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+30,at.y+20,{steps:8});await page.mouse.up();
 await phase('');const moved=await page.evaluate(()=>(window as any).__vectora.snapshot().artwork);
 await phase('undo');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await phase('redo');await page.getByRole('button',{name:'Redo',exact:true}).click();
 await phase('');expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(moved);
 const sizeBefore=await page.evaluate(mid=>{const b=(window as any).__vectora.objects[mid].bounds;return[b.width,b.height];},mid);
 await phase('resize');const corner=await point(mid,true);await page.mouse.move(corner.x,corner.y);await page.mouse.down();await page.mouse.move(corner.x+20,corner.y+15,{steps:8});await page.mouse.up();
 await phase('');const sizeAfter=await page.evaluate(mid=>{const b=(window as any).__vectora.objects[mid].bounds;return[b.width,b.height];},mid);expect(sizeAfter[0]).toBeGreaterThan(sizeBefore[0]);expect(sizeAfter[1]).toBeGreaterThan(sizeBefore[1]);
 await phase('');await page.evaluate(()=>{const e=(window as any).__vectora;e.selection=[];e.changed();});
 // Select a central band, keeping the marquee clear of both rails and the floating menu.
 const empty=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,near=p.view.viewToProject([480,300]),world=new p.Point(Math.floor(near.x/12)*12+10,Math.floor(near.y/12)*12+10),v=p.view.projectToView(world),r=e.canvas.getBoundingClientRect();return {x:v.x+r.x,y:v.y+r.y,empty:!e.hitObject(world)};});expect(empty.empty).toBe(true);
 await phase('marquee');await page.mouse.move(empty.x,empty.y);await page.mouse.down();await page.mouse.move(empty.x+310,empty.y+250,{steps:8});await page.mouse.up();
 const groupCount=await page.evaluate(()=>(window as any).__vectora.selectedItems.length);expect(groupCount).toBeGreaterThan(20);
 await phase('');const groupBefore=await page.evaluate(()=>(window as any).__vectora.snapshot().artwork);
 const groupPoint=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,v=p.view.projectToView(e.selectedItems[0].bounds.center),r=e.canvas.getBoundingClientRect();return{x:v.x+r.x,y:v.y+r.y};});
 await phase('group drag');await page.mouse.move(groupPoint.x,groupPoint.y);await page.mouse.down();await page.mouse.move(groupPoint.x+20,groupPoint.y+10,{steps:8});await page.mouse.up();
 await phase('');expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).not.toBe(groupBefore);
 await phase('group undo');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await phase('');expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(groupBefore);
 const {profile}=await cdp.send('Profiler.stop');await mkdir(testInfo.outputDir,{recursive:true});const profilePath=testInfo.outputPath('mixed-drawing.cpuprofile');await writeFile(profilePath,JSON.stringify(profile));await testInfo.attach('mixed-drawing.cpuprofile',{path:profilePath,contentType:'application/json'});
 const report=await page.evaluate(()=>(window as any).__mixedPerf.phases);
 console.log('MIXED_DRAWING_PROFILE',JSON.stringify({count,groupCount,phases:report}));
 const timingsPath=testInfo.outputPath('timings.json');await writeFile(timingsPath,JSON.stringify({count,groupCount,phases:report},null,2));await testInfo.attach('timings.json',{path:timingsPath,contentType:'application/json'});
 const weights=new Map<number,number>();profile.samples?.forEach((id:number,i:number)=>weights.set(id,(weights.get(id)??0)+(profile.timeDeltas?.[i]??0)));
 const hot=profile.nodes.map((n:any)=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').pop(),ms:(weights.get(n.id)??0)/1000})).sort((a:any,b:any)=>b.ms-a.ms).slice(0,12);
 console.log('MIXED_CPU_HOTSPOTS',JSON.stringify({count,hot}));await cdp.detach();
});
