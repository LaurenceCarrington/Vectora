import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
const types=['square','isometric','polar','hexagonal','triangular','dot'];
async function drag(page:any,from:number[],to:number[]){
 const coords=await page.evaluate(({from,to}:any)=>{const p=(window as any).__paper,r=document.querySelector('#cad-canvas')!.getBoundingClientRect();return [from,to].map((a:number[])=>{const q=p.view.projectToView(new p.Point(a));return {x:q.x+r.x,y:q.y+r.y};});},{from,to});
 await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y,{steps:3});await page.mouse.up();
}

test('Every pattern snaps to its nearest visible intersections or vertices',async({page})=>{
 await page.goto(DEV);
 const report=await page.evaluate(async()=>{
  const {snapGridPoint,gridMarks,GRID_TYPES}=await import('/src/gridGeometry.ts');
  const reports=[];
  for(const type of GRID_TYPES){
   const config={type,spacing:10,angle:30},points:{x:number;y:number}[]=[];
   for(let i=-12;i<=12;i++)for(let j=-12;j<=12;j++){
    if(type==='square'||type==='dot')points.push({x:i*10,y:j*10});
    if(type==='triangular')points.push({x:10*i+5*j,y:Math.sqrt(3)*5*j});
    if(type==='isometric')points.push({x:Math.sqrt(3)*5*i,y:5*i+10*j});
    if(type==='hexagonal')for(let k=0;k<6;k++)points.push({x:15*i+10*Math.cos(k*Math.PI/3),y:Math.sqrt(3)*10*(j+i/2)+10*Math.sin(k*Math.PI/3)});
   }
   if(type==='polar')for(let radius=0;radius<=100;radius+=10)for(let degrees=0;degrees<360;degrees+=30)points.push({x:radius*Math.cos(degrees*Math.PI/180),y:radius*Math.sin(degrees*Math.PI/180)});
   const marks=gridMarks({left:-100,right:100,top:-100,bottom:100},4,config);
   for(let i=0;i<40;i++){
    const p={x:Math.sin(i*2.71)*35,y:Math.cos(i*1.31)*35},q=snapGridPoint(p,config);
    const actual=Math.hypot(p.x-q.x,p.y-q.y),nearest=Math.min(...points.map(c=>Math.hypot(p.x-c.x,p.y-c.y)));
    if(Math.abs(actual-nearest)>1e-7)throw new Error(`${type}: not nearest`);
    const same=snapGridPoint(q,config);if(Math.hypot(q.x-same.x,q.y-same.y)>1e-7)throw new Error(`${type}: not stable`);
    const hits=marks.filter(m=>{
     if(m.kind==='dot')return Math.hypot(q.x-m.center.x,q.y-m.center.y)<1e-7;
     if(m.kind==='circle')return Math.abs(Math.hypot(q.x,q.y)-m.radius)<1e-7;
     const dx=m.b.x-m.a.x,dy=m.b.y-m.a.y,t=((q.x-m.a.x)*dx+(q.y-m.a.y)*dy)/(dx*dx+dy*dy);
     return t>=-1e-7&&t<=1+1e-7&&Math.abs(dx*(q.y-m.a.y)-dy*(q.x-m.a.x))<1e-6;
    }).length;
    if(hits<(type==='dot'?1:2))throw new Error(`${type}: snap point not on rendered grid`);
   }
   reports.push({type,count:marks.length});
  }
  return reports;
 });
 expect(report).toHaveLength(6);
});

test('Grid settings persist and each pattern controls drawing, movement and nodes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
 for(const type of types){
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Grid',exact:true}).click();
  await page.locator('#pref-grid-type').selectOption(type);
  if(type==='polar'){await expect(page.locator('#pref-grid-angle-field')).toBeVisible();await page.locator('#pref-grid-angle').selectOption('30');}
  else await expect(page.locator('#pref-grid-angle-field')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const e=(window as any).__vectora;e.newDocument();e.setTool('line');});
  const expected=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return [[21,32],[63,54]].map(a=>{const q=e.grid.snap(new p.Point(a));return [q.x,q.y];});});
  await drag(page,[21,32],[63,54]);
  const actual=await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>[s.point.x,s.point.y]));
  for(let i=0;i<2;i++)for(let j=0;j<2;j++)expect(actual[i][j]).toBeCloseTo(expected[i][j],6);
  await page.evaluate(()=>(window as any).__vectora.setTool('select'));
  const move=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,b=e.selected.bounds;const start=b.center,end=start.add([17,23]),target=e.grid.snap(b.topLeft.add([17,23]));return {from:[start.x,start.y],to:[end.x,end.y],target:[target.x,target.y]};});
  await drag(page,move.from,move.to);
  const position=await page.evaluate(()=>{const b=(window as any).__vectora.selected.bounds;return [b.left,b.top];});
  position.forEach((n:number,i:number)=>expect(n).toBeCloseTo(move.target[i],6));
  await page.evaluate(()=>(window as any).__vectora.setTool('nodes'));
  const node=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=e.selected.segments[0].point,b=a.add([-13,18]),snap=e.grid.snap(b);return {from:[a.x,a.y],to:[b.x,b.y],target:[snap.x,snap.y]};});
  await drag(page,node.from,node.to);
  const nodePosition=await page.evaluate(()=>{const a=(window as any).__vectora.selected.segments[0].point;return [a.x,a.y];});
  nodePosition.forEach((n:number,i:number)=>expect(n).toBeCloseTo(node.target[i],6));
  await page.screenshot({path:`test-results/grid-${type}.png`});
 }
 await page.reload();await expect(page.locator('#grid-status')).toHaveText('Dot (Step) 10 mm');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Grid',exact:true}).click();
 await expect(page.locator('#pref-grid-type')).toHaveValue('dot');await expect(page.locator('#pref-grid-angle')).toHaveValue('30');
 await page.locator('#pref-grid-type').selectOption('polar');await page.screenshot({path:'test-results/grid-types-settings.png'});
 expect(errors).toEqual([]);
});

test('Patterns remain fixed and bounded at extreme zoom and never export',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{GRID_TYPES}=await import('/src/gridGeometry.ts'),{exportDXF}=await import('/src/exportDXF.ts');
  const before=JSON.stringify(e.snapshot());
  for(const type of GRID_TYPES)for(const spacing of [.1,10,1000])for(const zoom of [.1,1,100]){
   e.setGridType(type);e.setGridSpacing(spacing);p.view.zoom=zoom;p.view.center=new p.Point(-230.5,124.25);e.setTool('select');
   if(e.grid.spacingMM!==spacing||e.grid.layer.children.length>30000)throw new Error('Unbounded or changing grid');
  }
  if(JSON.stringify(e.snapshot())!==before)throw new Error('Grid settings changed document');
  e.setGridSpacing(10);p.view.zoom=4;e.setGridType('hexagonal');
  e.addShape(new p.Path.Rectangle({rectangle:[0,0,10,10],insert:false}),'Rectangle');
  const dxf=exportDXF([...e.grid.layer.children,...e.objects],true);if((dxf.match(/LWPOLYLINE/g)||[]).length!==1)throw new Error('Grid exported');
 });
});


test('Reference grid previews match the available controls in both themes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(DEV+'/reference/design-system.html');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 for(const theme of ['light','dark']){
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.locator(`[name="appearance-theme"][value="${theme}"]`).check();
  await page.getByRole('tab',{name:'Grid',exact:true}).click();
  for(const type of types){
   await page.locator('#pref-grid-type').selectOption(type);
   expect(await page.locator('.grid-demo').evaluate(el=>el.childElementCount)).toBeGreaterThan(10);
  }
 }
 await page.locator('#pref-grid-type').selectOption('polar');await page.locator('#pref-grid-angle').selectOption('45');
 await expect(page.locator('#pref-grid-angle-field')).toBeVisible();
 await page.setViewportSize({width:390,height:750});
 expect(await page.locator('#preferences-shell').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(errors).toEqual([]);
});
