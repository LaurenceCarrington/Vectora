import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';

test('Dense dot grids retain one cached guide across panning and redraws',async({page})=>{
 await page.goto(DEV);
 const report=await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  e.setGridType('dot');e.setGridSpacing(10);p.view.zoom=.17;e.grid.update(p.view);p.view.update();
  const raster=e.grid.layer.firstChild,canvas=raster.canvas,start=performance.now();
  for(let i=0;i<20;i++){p.view.center=p.view.center.add([1,1]);e.grid.update(p.view);p.view.update();}
  const pan=(performance.now()-start)/20,redraw=performance.now();
  for(let i=0;i<20;i++){e.grid.update(p.view);e.grid.layer.opacity=i%2?.999:1;p.view.update();}
  const snap=e.grid.snap(new p.Point(23,37));
  return {items:e.grid.layer.children.length,kind:raster.className,reused:raster===e.grid.layer.firstChild&&canvas===raster.canvas,snap:[snap.x,snap.y],panMs:pan,redrawMs:(performance.now()-redraw)/20};
 });
 expect(report.items).toBe(1);expect(report.kind).toBe('Raster');expect(report.reused).toBe(true);expect(report.snap).toEqual([20,40]);
 console.log('Dense dot grid (ms/frame):', {pan:report.panMs,redraw:report.redrawMs});
});

for(const ratio of [1,2])test.describe(`Dot grid at pixel ratio ${ratio}`,()=>{
 test.use({deviceScaleFactor:ratio});
 test('Dots keep their colours, size and document alignment through zoom, pan and resize',async({page})=>{
  await page.goto(DEV);
  for(const theme of ['dark','light']){
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByRole('tab',{name:'Appearance',exact:true}).click();
   await page.locator(`[name="appearance-theme"][value="${theme}"]`).check();
   await page.keyboard.press('Escape');
   await page.setViewportSize(theme==='dark'?{width:1280,height:900}:{width:1013,height:713});
   await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,{gridMarks}=await import('/src/gridGeometry.ts');
    e.setGridType('dot');e.setGridSpacing(10);
    for(const zoom of [4,.37795,.17,.1,.037795,4]){
     p.view.zoom=zoom;p.view.center=new p.Point(-231.25,124.75);e.grid.update(p.view);p.view.update();
     const raster=e.grid.layer.firstChild,marks=gridMarks(p.view.bounds,zoom,{type:'dot',spacing:10,angle:15});
     if(raster.visible!==(marks.length>0))throw new Error('Density visibility changed');
     if(!marks.length)continue;
     const dpr=p.view.pixelRatio,canvas=raster.canvas,ctx=raster.context;
     if(canvas.width!==Math.ceil(p.view.viewSize.width*dpr)||canvas.height!==Math.ceil(p.view.viewSize.height*dpr))throw new Error('Incorrect resolution after resize');
     if(raster.bounds.topLeft.getDistance(p.view.bounds.topLeft)>1e-7)throw new Error('Grid image moved away from document bounds');
     const scratch=document.createElement('canvas').getContext('2d')!;
     for(const major of [false,true]){
      const mark=marks.find(m=>m.kind==='dot'&&m.major===major&&p.view.bounds.expand(-20/zoom).contains(new p.Point(m.center)));
      if(!mark||mark.kind!=='dot')continue;
      const point=p.view.projectToView(new p.Point(mark.center)),x=Math.floor(point.x*dpr),y=Math.floor(point.y*dpr);
      const actual=ctx.getImageData(x,y,1,1).data;
      scratch.fillStyle=getComputedStyle(document.documentElement).getPropertyValue(major?'--color-grid-major':'--color-grid-minor').trim();scratch.fillRect(0,0,1,1);
      const expected=scratch.getImageData(0,0,1,1).data;
      if(actual[3]<100||expected.slice(0,3).some((n,i)=>Math.abs(n-actual[i])>2))throw new Error('Dot colour or alignment changed');
      if(ctx.getImageData(x+4*dpr,y,1,1).data[3]!==0)throw new Error('Dot radius changed with zoom');
     }
    }
    e.setGridType('none');if(e.grid.layer.children.length)throw new Error('Cached dots remain in No grid');
    e.setGridType('square');if(e.grid.layer.children.some((i:any)=>i.className==='Raster'))throw new Error('Stale dot guide');
    e.setGridType('dot');
   });
  }
  await page.screenshot({path:`test-results/dot-grid-${ratio}x.png`});
 });
});
