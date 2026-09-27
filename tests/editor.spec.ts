import {dragSelectionToLayer} from './layerHelpers';
import { test, expect } from '@playwright/test';
const DEV='http://127.0.0.1:5174';
const PREVIEW='http://127.0.0.1:4173';
async function draw(page:any,tool='r') {
  // Freeform workflow fixtures deliberately opt out of the default snapping.
  const snap=page.getByRole('button',{name:'Snapping',exact:true});
  if(await snap.getAttribute('aria-pressed')==='true')await snap.click();
  await page.locator('#cad-canvas').focus();await page.keyboard.press(tool);
  await page.mouse.move(280,270);await page.mouse.down();await page.mouse.move(580,440,{steps:5});await page.mouse.up();
  await expect(page.locator('#properties-panel')).toBeHidden();
  await page.getByRole('button',{name:'Properties',exact:true}).click();
}
test('geometry, topology, transforms, history and DXF acceptance',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const report=await page.evaluate(async()=>{
    const paper=(window as any).__paper;
    const {createStickerOutline,initializeClipper}=await import('/src/clipperService.ts');
    await initializeClipper();
    const {exportDXF}=await import('/src/exportDXF.ts');
    const {flattenInDocument}=await import('/src/geometry.ts');
    const editor=(window as any).__vectora;
    const assert=(value:boolean,message:string)=>{if(!value)throw new Error(message);};
    const near=(a:number,b:number,t=0.001)=>Math.abs(a-b)<=t;
    const rect=new paper.Path.Rectangle({rectangle:new paper.Rectangle(10,20,100,50),insert:false,fillColor:'white'});
    editor.addShape(rect,'Rectangle');
    const original=rect.exportJSON();const outline=createStickerOutline(rect,3);
    assert(near(outline.bounds.width,106,0.13)&&near(outline.bounds.height,56,0.13),'outline bounds');
    assert(rect.exportJSON()===original,'outline changed source');
    const dxf=exportDXF([rect],true);assert(dxf.includes('$INSUNITS\n70\n4\n')&&dxf.includes('AC1015')&&dxf.includes('90\n4\n70\n1\n'),'DXF metadata/closed rectangle');
    paper.view.zoom=0.25;paper.view.center=new paper.Point(-1234,5678);
    assert(exportDXF([rect],true)===dxf,'viewport changed DXF');
    assert(dxf.includes('10\n110\n20\n-70\n'),'dimensions/origin/Y conversion');
    assert(rect.exportJSON()===original,'export changed source');
    assert(exportDXF([outline]).match(/LWPOLYLINE/g)?.length===1,'overlay exported');
    editor.setProperty('x',40);editor.setProperty('width',150);
    const moved=createStickerOutline(editor.selected,3);
    assert(near(moved.bounds.x,37,0.13)&&near(moved.bounds.width,156,0.13),'moved/resized outline');
    editor.undo();assert(near(editor.selected.bounds.width,100),'undo width');editor.redo();assert(near(editor.selected.bounds.width,150),'redo width');
    editor.deleteSelection();assert(editor.objects.length===0,'delete');editor.undo();assert(editor.objects.length===1,'undo delete');
    const circle=new paper.Path.Circle({center:[0,0],radius:25,insert:false});
    const circleJSON=circle.exportJSON();const circular=createStickerOutline(circle,3);
    const points=flattenInDocument(circular)[0].points;
    assert(points.length>40,'circle too coarse');
    let radialError=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];for(const t of [0,.5,1])radialError=Math.max(radialError,Math.abs(Math.hypot(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)-28));}
    assert(radialError<0.07,'circle approximation error '+radialError);assert(circle.exportJSON()===circleJSON,'circle changed');
    const outer=new paper.Path.Rectangle({rectangle:[0,0,100,80],insert:false}),hole=new paper.Path.Circle({center:[40,40],radius:10,insert:false});hole.reverse();
    const island=new paper.Path.Rectangle({rectangle:[150,0,20,20],insert:false});
    const compound=new paper.CompoundPath({insert:false,children:[outer,hole,island]});
    const multi=createStickerOutline(compound,3);assert(flattenInDocument(multi).length===2,'holes or disconnected contours');
    const transformed=new paper.Path.Rectangle({rectangle:[0,0,10,20],insert:false});transformed.applyMatrix=false;transformed.scale(2,3);const group=new paper.Group({insert:false,children:[transformed],applyMatrix:false});group.translate([50,60]);group.rotate(30);
    const before=group.exportJSON();const transformedPoints=flattenInDocument(transformed)[0].points;
    assert(near(Math.hypot(transformedPoints[0].x-transformedPoints[1].x,transformedPoints[0].y-transformedPoints[1].y),60) || near(Math.hypot(transformedPoints[0].x-transformedPoints[1].x,transformedPoints[0].y-transformedPoints[1].y),20),'ancestor transform');
    createStickerOutline(transformed,3);transformed.data.role='artwork';exportDXF([transformed],true);delete transformed.data.role;assert(group.exportJSON()===before,'ancestor source mutated');
    for(const bad of [new paper.Path({insert:false,segments:[[0,0],[10,10],[10,0],[0,10]],closed:true}),new paper.Path({insert:false,segments:[[0,0],[10,0]],closed:false}),new paper.Path({insert:false,segments:[[0,0],[0,0],[0,0]],closed:true})]){let failed=false;try{createStickerOutline(bad,3);}catch{failed=true;}assert(failed,'invalid contour accepted');}
    const open=new paper.Path({insert:false,segments:[[0,0],[0,0],[10,0]],closed:false,data:{role:'artwork'}});const openDXF=exportDXF([open],true);assert(openDXF.includes('90\n2\n70\n0\n'),'open/duplicate vertices');
    let noCuts=false;try{exportDXF([rect]);}catch{noCuts=true;}assert(noCuts,'empty export');
    for(let i=0;i<100;i++)createStickerOutline(circle,3).remove();
    return {rectangle:[outline.bounds.width,outline.bounds.height],radialError,vertices:points.length};
  });
  console.log(report);expect(errors).toEqual([]);
});
for(const [name,url] of [['development',DEV],['production',PREVIEW]])test(`${name}: real pointer/keyboard workflow and WASM`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await draw(page);
  await expect(page.locator('#workspace')).toHaveCSS('background-color','rgb(32, 34, 38)');
  if(name==='development')expect(await page.evaluate(()=>(window as any).__vectora.selected.strokeColor.toCSS(true))).toBe('#ffffff');
  await page.screenshot({path:`test-results/${name}-dark-artwork.png`});
  for(const [field,value] of [['x','10'],['y','20'],['width','100'],['height','50']]){await page.locator('#field-'+field).fill(value);await page.locator('#field-'+field).press('Tab');}
  await expect(page.locator('#field-width')).toHaveValue('100');
  await page.locator('#create-outline').click();await expect(page.locator('#selection-name')).toContainText('Sticker outline');
  expect(Number(await page.locator('#field-width').inputValue())).toBeCloseTo(106,1);
  await page.locator('[aria-label="Undo"]').click();await expect(page.locator('#selection-name')).toContainText('Rectangle');
  await page.locator('[aria-label="Redo"]').click();await expect(page.locator('#selection-name')).toContainText('Sticker outline');
  const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
  await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('Escape');
  await page.mouse.move(400,350);await page.mouse.wheel(0,-200);
  await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(450,400);await page.mouse.up();await page.keyboard.up('Space');
  await page.screenshot({path:`test-results/${name}.png`});expect(errors).toEqual([]);
});
test('drawing cancellation, transformations, shortcut focus, responsive canvas',async({page})=>{
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await draw(page);
  await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('v');
  const before=await page.evaluate(()=> (window as any).__vectora.snapshot().artwork);
  await page.mouse.move(420,350);await page.mouse.down();await page.mouse.move(460,390);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=> (window as any).__vectora.snapshot().artwork)).toBe(before);
  await page.mouse.move(420,350);await page.mouse.down();await page.mouse.move(460,390);await page.mouse.up();
  const moved=await page.evaluate(()=> (window as any).__vectora.snapshot().artwork);expect(moved).not.toBe(before);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=> (window as any).__vectora.snapshot().artwork)).toBe(before);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=> (window as any).__vectora.snapshot().artwork)).toBe(moved);
  await page.keyboard.press('r');await page.mouse.move(250,500);await page.mouse.down();await page.mouse.move(400,600);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=> (window as any).__vectora.objects.length)).toBe(1);
  if(await page.locator('#properties-panel').isHidden())await page.locator('[aria-label="Properties"]').click();await expect(page.locator('#field-width')).toBeVisible();const originalWidth=await page.evaluate(()=>(window as any).__vectora.selected.bounds.width);await page.locator('#field-width').fill('-1');await page.locator('#field-width').press('Tab');await expect(page.locator('#field-width')).toHaveAttribute('aria-invalid','true');expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBe(originalWidth);await page.locator('#field-width').fill(String(originalWidth));await page.locator('#field-width').press('Tab');await page.locator('#field-width').focus();await page.keyboard.press('Backspace');expect(await page.evaluate(()=> (window as any).__vectora.objects.length)).toBe(1);
  await page.setViewportSize({width:650,height:750});await expect.poll(async()=> (await page.locator('#cad-canvas').boundingBox())?.width).toBe(650);
});
test('resize handles, aspect ratio, circle, pointer capture and focus loss',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await draw(page);await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('v');
  const initial=await page.evaluate(()=>{const e=(window as any).__vectora;return {width:e.selected.bounds.width,height:e.selected.bounds.height,json:e.snapshot().artwork};});
  await page.mouse.move(580,440);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(650,550,{steps:6});await page.mouse.up();await page.keyboard.up('Shift');
  const resized=await page.evaluate(()=>{const e=(window as any).__vectora;return {width:e.selected.bounds.width,height:e.selected.bounds.height,json:e.snapshot().artwork};});
  expect(resized.width).toBeGreaterThan(initial.width);expect(resized.width/resized.height).toBeCloseTo(initial.width/initial.height,6);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(initial.json);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(resized.json);
  if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();
  await page.mouse.move(400,350);await page.mouse.down();await page.mouse.move(450,400);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(resized.json);
  await page.locator('#cad-canvas').focus();await page.keyboard.press('c');await page.mouse.move(300,600);await page.mouse.down();await page.mouse.move(340,630);await page.mouse.up();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return e.selected.bounds.width/e.selected.bounds.height;})).toBeCloseTo(1,8);
  if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await page.mouse.move(600,600);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(500,650);await page.mouse.up();await page.keyboard.up('Shift');
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return e.selected.bounds.width/e.selected.bounds.height;})).toBeCloseTo(1,8);
  const count=await page.evaluate(()=>(window as any).__vectora.objects.length);
  if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await page.mouse.click(250,500);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(count);
  await page.mouse.move(300,650);await page.mouse.down();await page.mouse.move(4,880);await page.mouse.up();
  await page.keyboard.press('v');await page.mouse.click(1000,800); // Empty canvas beside the floating menu.
  expect(await page.evaluate(()=>(window as any).__vectora.selected)).toBeNull();expect(errors).toEqual([]);
});
test('initialization failure and empty export produce useful feedback',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*.wasm',route=>route.abort());await page.goto(DEV);
  await expect(page.locator('#wasm-status')).toHaveText('Outline engine unavailable. Reload to retry.');
  await page.locator('[aria-label="Properties"]').click();await expect(page.locator('#properties-empty')).toBeVisible();await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export DXF',exact:true}).click();
  await page.locator('#export-dxf').click();await expect(page.locator('.toast-error .toast-copy p')).toContainText('There are no cut lines');expect(errors).toEqual([]);
});
test('reference component styles and geometry match at the same viewport',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');
  const styles=async()=>page.evaluate(()=>{
    return ['.top-toolbar','.left-toolbar','.right-toolbar','.tool','.brand','[for="field-x"]'].map(selector=>{
      const element=document.querySelector(selector)!;const css=getComputedStyle(element);return {background:css.backgroundColor,color:css.color,font:css.fontFamily,fontSize:css.fontSize,borderRadius:css.borderRadius,padding:css.padding,width:selector==='.top-toolbar'?'fill':css.width,height:selector==='.left-toolbar'||selector==='.right-toolbar'?'fill':css.height};
    });
  });
  const reference=await styles();await page.screenshot({path:'test-results/reference.png'});
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');const app=await styles();
  // Both the app and reference start with Properties closed.
  expect(app.slice(0,5)).toEqual(reference.slice(0,5));
  await draw(page);await page.screenshot({path:'test-results/properties.png',animations:'disabled'});
  const fields=await styles();expect(fields[5]).toEqual(reference[5]);
});
test('cursor anchored zoom, middle-button pan, and high DPI preserve geometry',async({page})=>{
  await page.goto(DEV);await draw(page);await page.locator('#close-properties').click();
  const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {geometry:e.snapshot().artwork,anchor:p.view.viewToProject(new p.Point(400,350)).toJSON(),center:p.view.center.toJSON(),ratio:p.view.pixelRatio};});
  expect(before.ratio).toBe(2);
  await page.mouse.move(400,350);await page.mouse.wheel(0,-400);
  await expect.poll(async()=>page.locator('#view-status').textContent()).not.toContain('100%');
  const anchor=await page.evaluate(()=>{const p=(window as any).__paper;return p.view.viewToProject(new p.Point(400,350)).toJSON();});
  expect(anchor).toEqual(before.anchor);
  await page.mouse.move(400,350);await page.mouse.down({button:'middle'});await page.mouse.move(480,410);await page.mouse.up({button:'middle'});
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(before.geometry);
  expect(await page.evaluate(()=>(window as any).__paper.view.center.toJSON())).not.toEqual(before.center);
});
test('millimetre grid stays aligned at every zoom and never exports',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const report=await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    const {exportDXF}=await import('/src/exportDXF.ts');
    const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
    const initial=e.snapshot();const rows=[];
    for(const [zoom,spacing] of [[96/25.4,10],[1,50],[0.1,500],[100,1]]){
      p.view.zoom=zoom;p.view.center=new p.Point(-12.345,8.765);e.setTool('select');
      assert(e.grid.spacingMM===spacing,'wrong millimetre interval');
      const vertical=e.grid.layer.children.filter((line:any)=>line.segments[0].point.x===line.segments[1].point.x);
      assert(vertical.length>1&&e.grid.layer.children.length<1000,'unexpected grid density');
      const bounds=p.view.bounds;
      for(const line of e.grid.layer.children){
        const a=line.segments[0].point,b=line.segments[1].point;
        const isVertical=a.x===b.x;
        const position=isVertical?a.x:a.y;
        assert(Math.abs(position/spacing-Math.round(position/spacing))<1e-8,'grid drifted off document mm');
        assert(isVertical?Math.abs(a.y-bounds.top)<1e-8&&Math.abs(b.y-bounds.bottom)<1e-8:Math.abs(a.x-bounds.left)<1e-8&&Math.abs(b.x-bounds.right)<1e-8,'grid fails to cover viewport');
      }
      const a=vertical[0].segments[0].point,b=vertical[1].segments[0].point;
      const screenDistance=p.view.projectToView(b).x-p.view.projectToView(a).x;
      assert(Math.abs(screenDistance-spacing*zoom)<1e-7,'screen grid disagrees with mm scale');
      rows.push({zoom,spacing,screenDistance});
    }
    assert(JSON.stringify(e.snapshot())===JSON.stringify(initial),'grid changed history or artwork');
    p.view.zoom=96/25.4;p.view.center=new p.Point(100,70);e.setTool('select');
    const rect=new p.Path.Rectangle({rectangle:[10,20,100,50],insert:false,fillColor:'white'});e.addShape(rect,'Rectangle');
    const dxf=exportDXF([...e.grid.layer.children,...e.objects,...e.overlays.children],true);
    assert((dxf.match(/LWPOLYLINE/g)||[]).length===1,'grid or selection leaked into DXF');
    assert(e.grid.layer.locked&&e.grid.layer.guide,'grid must be non-interactive');
    return rows;
  });
  console.log('Grid verification:',report);
  await expect(page.locator('#view-status')).toHaveText('100% · Grid 10 mm');
  await expect(page.locator('#properties-panel')).toBeHidden();await page.screenshot({path:'test-results/millimetre-grid.png',animations:'disabled'});
  expect(errors).toEqual([]);
});
test('snap to grid draws, moves, resizes and preserves exact numeric edits',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const snap=page.getByRole('button',{name:'Snapping',exact:true});
  await expect(snap).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=24;p.view.center=new p.Point(-20,-2);(window as any).__vectora.setTool('rectangle');});
  async function docDrag(from:number[],to:number[],shift=false){
    const coords=await page.evaluate(({from,to})=>{const p=(window as any).__paper,r=document.querySelector('#cad-canvas')!.getBoundingClientRect();return [from,to].map(a=>{const q=p.view.projectToView(new p.Point(a));return {x:q.x+r.x,y:q.y+r.y};});},{from,to});
    if(shift)await page.keyboard.down('Shift');
    await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y,{steps:4});await page.mouse.up();
    if(shift)await page.keyboard.up('Shift');
  }
  async function bounds(){return page.evaluate(()=>{const b=(window as any).__vectora.selected.bounds;return [b.x,b.y,b.width,b.height].map((n:number)=>Math.round(n*1e6)/1e6);});}
  async function closePanel(){if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();}
  await docDrag([-25.3,-16.2],[-8.7,-5.6]);expect(await bounds()).toEqual([-25,-16,16,10]);
  await closePanel();await page.keyboard.press('v');
  await docDrag([-20,-12],[-17.2,-8.6]);expect(await bounds()).toEqual([-22,-13,16,10]);
  await page.keyboard.press('Control+z');expect(await bounds()).toEqual([-25,-16,16,10]);
  await page.keyboard.press('Control+Shift+z');expect(await bounds()).toEqual([-22,-13,16,10]);
  await docDrag([-6,-3],[-1.6,1.6]);expect(await bounds()).toEqual([-22,-13,20,15]);
  await docDrag([-2,2],[1.6,5.8],true);
  const constrained=await bounds();expect(constrained[2]/constrained[3]).toBeCloseTo(20/15,5);
  await closePanel();await page.keyboard.press('c');await docDrag([-25.2,15.1],[-12.8,15]);expect(await bounds()).toEqual([-37,3,24,24]);
  await expect(page.locator('#properties-panel')).toBeHidden();await page.getByRole('button',{name:'Properties',exact:true}).click();
  await page.locator('#field-x').fill('-37.25');await page.locator('#field-x').press('Tab');expect((await bounds())[0]).toBe(-37.25);
  // Typing S in a field cannot toggle snapping; clicking an off-grid object cannot move it.
  await page.locator('#field-x').focus();await page.keyboard.press('s');await expect(snap).toHaveAttribute('aria-pressed','true');
  await closePanel();await page.keyboard.press('v');await docDrag([-25.25,15],[-25.25,15]);expect((await bounds())[0]).toBe(-37.25);
  await page.keyboard.press('s');await expect(snap).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('r');await docDrag([-26.3,-20.2],[-15.1,-8.9]);for(const [index,value] of [-26.3,-20.2,11.2,11.3].entries())expect((await bounds())[index]).toBeCloseTo(value,3);
  await closePanel();await page.keyboard.press('s');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=5;p.view.center=new p.Point(-120,-40);(window as any).__vectora.setTool('rectangle');});
  await expect(snap).toHaveAttribute('title',/Snapping.*On/);
  await docDrag([-170.7,-80.2],[-90.1,-40.7]);expect(await bounds()).toEqual([-170,-80,80,40]);
  await page.screenshot({path:'test-results/snap-to-grid.png',animations:'disabled'});expect(errors).toEqual([]);
});
test('production snap toggle and shortcut work without altering existing artwork',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await draw(page);
  const before=await page.locator('#field-width').inputValue();
  await page.getByRole('button',{name:'Snapping',exact:true}).click();
  await expect(page.getByRole('button',{name:'Snapping',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#field-width')).toHaveValue(before);
  await page.locator('#cad-canvas').focus();await page.keyboard.press('s');
  await expect(page.getByRole('button',{name:'Snapping',exact:true})).toHaveAttribute('aria-pressed','false');
});
test('Layers matches reference and controls real objects, visibility, locking and docking',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  async function panelStyles(){return page.locator('#primary-layers-panel').evaluate(panel=>['.layers-header','.layer-heading','.layer-row','.layer-dot','.layer-footer'].map(selector=>{
    const style=getComputedStyle(panel.querySelector(selector)!);
    return [style.height,style.padding,style.gap,style.borderRadius,style.backgroundColor,style.fontSize];
  }));}
  await page.goto(DEV+'/reference/design-system.html');
  await page.locator('[aria-controls="primary-layers-panel"]').click();
  const reference=await panelStyles();
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await draw(page);await page.locator('#create-outline').click();
  await page.getByRole('button',{name:'Layers',exact:true}).click();
  const panel=page.locator('#primary-layers-panel');
  await expect(panel).toBeVisible();expect(await panelStyles()).toEqual(reference);
  const box=(await panel.boundingBox())!;expect(box.width).toBe(300);expect(box.y).toBe(88);expect(box.height).toBe(784);
  await expect(panel.locator('[data-layer-count]')).toHaveText('4');
  await expect(panel.getByRole('button',{name:'Add layer',exact:true})).toBeEnabled();
  await expect(panel.getByRole('button',{name:'Delete selected layer'})).toBeEnabled();
  await panel.getByRole('button',{name:'Expand Artwork',exact:true}).click();
  await panel.getByRole('button',{name:'Expand Cut Path',exact:true}).click();
  await panel.getByRole('button',{name:'Rectangle',exact:true}).click();
  await expect(panel).toBeVisible();await expect(page.locator('#properties-panel')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__vectora.selected.data.name)).toBe('Rectangle');
  await panel.getByRole('button',{name:'Hide Artwork',exact:true}).click();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return [e.artwork.visible,e.selected];})).toEqual([false,null]);
  await expect(panel.getByRole('button',{name:'Rectangle',exact:true})).toBeDisabled();
  const exported=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts');return exportDXF((window as any).__vectora.objects,true);});
  expect((exported.match(/LWPOLYLINE/g)||[]).length).toBe(2);
  await panel.getByRole('button',{name:'Show Artwork',exact:true}).click();
  await panel.getByRole('button',{name:'Rectangle',exact:true}).click();
  await panel.getByRole('button',{name:'Lock Artwork',exact:true}).click();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return [e.artwork.locked,e.selected];})).toEqual([true,null]);
  await expect(panel.getByRole('button',{name:'Rectangle',exact:true})).toBeDisabled();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('v');await page.mouse.click(420,350);
  expect(await page.evaluate(()=>(window as any).__vectora.selected)).toBeNull();
  await page.keyboard.press('r');await page.mouse.move(250,550);await page.mouse.down();await page.mouse.move(400,650);await page.mouse.up();
  await expect(page.locator('.toast-warning .toast-copy p')).toHaveText('Show and unlock Artwork before drawing.');
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
  await panel.getByRole('button',{name:'Unlock Artwork',exact:true}).click();
  await panel.getByRole('button',{name:'Rectangle',exact:true}).click();
  const header=panel.locator('.layer-heading'),headerBox=(await header.boundingBox())!;
  await page.mouse.move(headerBox.x+20,headerBox.y+20);await page.mouse.down();await page.mouse.move(headerBox.x-100,headerBox.y+90);await page.mouse.up();
  expect(await panel.boundingBox()).toEqual(box);
  await page.screenshot({path:'test-results/layers-panel.png',animations:'disabled'});
  await page.setViewportSize({width:650,height:750});
  await expect.poll(async()=>{const b=(await panel.boundingBox())!;return b.x+b.width===606&&b.y===88&&b.y+b.height===750;}).toBe(true);
  await panel.getByRole('button',{name:'Close Layers panel'}).focus();await page.keyboard.press('Escape');await expect(panel).toBeHidden();
  await expect(page.getByRole('button',{name:'Layers',exact:true})).toBeFocused();expect(errors).toEqual([]);
});
test('ellipse and regular polygon support millimetre snapping, sides, cancellation, history and outlines',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=10;p.view.center=new p.Point(0,0);(window as any).__vectora.setTool('ellipse');});
  async function coords(points:number[][]){return page.evaluate(points=>{const p=(window as any).__paper;return points.map(a=>{const q=p.view.projectToView(new p.Point(a));return {x:q.x,y:q.y};});},points);}
  async function drag(from:number[],to:number[],shift=false){const [a,b]=await coords([from,to]);if(shift)await page.keyboard.down('Shift');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();if(shift)await page.keyboard.up('Shift');}
  async function close(){if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();}
  async function shape(){return page.evaluate(()=>{const s=(window as any).__vectora.selected;return {name:s.data.name,sides:s.data.sides,closed:s.closed,fill:s.fillColor,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height],points:s.segments.map((v:any)=>[v.point.x,v.point.y])};});}
  // Reverse-direction bounds and snapping use the same millimetres as rectangles.
  await drag([-13,-11],[-36,-24]);let s=await shape();expect(s.name).toBe('Ellipse');expect(s.bounds).toEqual([-35,-25,20,15]);expect(s.fill).toBeNull();expect(s.closed).toBe(true);
  await close();await page.keyboard.press('e');await drag([-35,5],[-20,15],true);s=await shape();expect(s.bounds[2]).toBeCloseTo(s.bounds[3],8);
  await close();await page.getByRole('button',{name:'Shapes',exact:true}).click();
  await page.locator('#primary-shapes-menu').screenshot({path:'test-results/shape-menu.png'});
  await page.getByRole('menuitemradio',{name:'Polygon',exact:true}).click();
  await page.keyboard.press('ArrowDown');
  const [a,b]=await coords([[-20,0],[-8,3]]);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);
  await page.keyboard.press('ArrowUp');await page.keyboard.down('Shift');await page.mouse.up();await page.keyboard.up('Shift');
  s=await shape();expect(s.name).toBe('Polygon');expect(s.sides).toBe(6);expect(s.points.length).toBe(6);expect(s.closed).toBe(true);expect(s.fill).toBeNull();
  const radii=s.points.map(([x,y]:number[])=>Math.hypot(x+20,y));for(const radius of radii)expect(radius).toBeCloseTo(10,8);
  const lengths=s.points.map((p:number[],i:number)=>Math.hypot(p[0]-s.points[(i+1)%6][0],p[1]-s.points[(i+1)%6][1]));for(const length of lengths)expect(length).toBeCloseTo(lengths[0],8);
  expect(Math.atan2(s.points[0][1],s.points[0][0]+20)*180/Math.PI).toBeCloseTo(15,8);
  const polygon=await page.evaluate(()=>(window as any).__vectora.snapshot().artwork);
  await page.locator('[aria-label="Undo"]').click();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
  await page.locator('[aria-label="Redo"]').click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(polygon);
  await close();await page.keyboard.press('y');await page.mouse.move(200,550);await page.mouse.down();await page.mouse.move(300,650);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(polygon);
  // A click near a grid-cell corner must not create a polygon without a drag.
  await page.mouse.click(689,499);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);
  // Every new closed shape can produce an outline and enter the millimetre DXF pipeline.
  const report=await page.evaluate(async()=>{const e=(window as any).__vectora;const {exportDXF}=await import('/src/exportDXF.ts');const source=e.snapshot().artwork;for(const item of [...e.artwork.children]){e.select(item);e.outline(3);}return {sourceUnchanged:source===e.snapshot().artwork,cuts:e.cutlines.children.length,dxf:exportDXF(e.objects,true)};});
  expect(report.sourceUnchanged).toBe(true);expect(report.cuts).toBe(3);expect((report.dxf.match(/LWPOLYLINE/g)||[]).length).toBe(6);
  await close();await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();
  await expect(page.locator('.layer-object').filter({hasText:'Ellipse'})).toHaveCount(2);await expect(page.locator('.layer-object').filter({hasText:'Polygon'})).toHaveCount(1);
  await page.screenshot({path:'test-results/ellipse-polygon.png',animations:'disabled'});expect(errors).toEqual([]);
});
test('production ellipse and polygon menu tools draw and export',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  for(const [name,start,end] of [['Ellipse',[240,400],[460,500]],['Polygon',[400,650],[480,650]]] as const){
    if(await page.locator('#properties-panel').isVisible())await page.locator('#close-properties').click();
    await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.getByRole('menuitemradio',{name,exact:true}).click();
    await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:4});await page.mouse.up();
    await expect(page.locator('#properties-panel')).toBeHidden();
    await page.getByRole('button',{name:'Properties',exact:true}).click();
    await expect(page.locator('#selection-name')).toContainText(name);
  }
  await page.locator('#create-outline').click();const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});
test('marquee selection moves, resizes and deletes shapes together with atomic undo',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=1;p.view.center=new p.Point(640,450);
    for(const [name,rectangle,cut] of [['A',[250,300,80,60],false],['B',[400,320,80,60],false],['C',[500,400,60,40],false],['Cut',[350,280,30,30],true]]){
      const item=new p.Path.Rectangle({rectangle,insert:false,strokeColor:cut?'red':'#383838',strokeWidth:1.5,strokeScaling:false});if(cut)item.data.role='cutline';e.addShape(item,name);
    }e.setLayerState('cutline','locked',true);e.select(null);e.setTool('select');
  });
  const selected=()=>page.evaluate(()=>(window as any).__vectora.selectedItems.map((s:any)=>s.data.name).sort());
  const geometry=()=>page.evaluate(()=>(window as any).__vectora.snapshot().artwork);
  async function drag(a:number[],b:number[],shift=false){if(shift)await page.keyboard.down('Shift');await page.mouse.move(a[0],a[1]);await page.mouse.down();await page.mouse.move(b[0],b[1],{steps:5});await page.mouse.up();if(shift)await page.keyboard.up('Shift');}
  const original=await geometry();
  // Full enclosure in either direction, with no geometry mutation or auto-open.
  await drag([580,420],[200,250]);expect(await selected()).toEqual(['A','B']);expect(await geometry()).toBe(original);await expect(page.locator('#properties-panel')).toBeHidden();
  await expect(page.locator('#tool-status')).toHaveText('Select · V · 2 selected');
  await page.screenshot({path:'test-results/multiple-selection.png'});
  await drag([280,330],[320,360]);
  const moved=await page.evaluate(()=>{const e=(window as any).__vectora;return e.selectedItems.map((s:any)=>[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]);});
  expect(moved).toEqual([[300,350,80,60],[450,370,80,60]]);
  await page.keyboard.press('Control+z');expect(await geometry()).toBe(original);expect(await selected()).toEqual(['A','B']);
  await page.keyboard.press('Control+Shift+z');expect(await geometry()).not.toBe(original);await page.keyboard.press('Control+z');
  await page.keyboard.press('s');await drag([480,380],[595,420],true);
  const ratio=await page.evaluate(()=>{const b=(window as any).__vectora.selectionBounds;return b.width/b.height;});expect(ratio).toBeCloseTo(230/80,8);
  await page.keyboard.press('Control+z');expect(await geometry()).toBe(original);
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('2 objects selected · Combined bounds');await expect(page.locator('#create-outline')).toBeDisabled();
  await page.locator('#field-x').fill('251.25');await page.locator('#field-x').press('Tab');
  expect(await page.evaluate(()=>(window as any).__vectora.selectedItems.map((s:any)=>s.bounds.x))).toEqual([251.25,401.25]);
  await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await geometry()).toBe(original);
  await page.keyboard.press('Delete');expect(await selected()).toEqual([]);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
  await page.keyboard.press('Control+z');expect(await selected()).toEqual(['A','B']);expect(await geometry()).toBe(original);
  await drag([490,390],[570,460],true);expect(await selected()).toEqual(['A','B','C']);
  await page.keyboard.down('Shift');await page.mouse.click(280,330);await page.keyboard.up('Shift');expect(await selected()).toEqual(['B','C']);
  // Cancellation restores the original selection and geometry.
  await page.mouse.move(600,500);await page.mouse.down();await page.mouse.move(200,250);await page.screenshot({path:'test-results/marquee-preview.png'});await page.keyboard.press('Escape');await page.mouse.up();expect(await selected()).toEqual(['B','C']);expect(await geometry()).toBe(original);
  await page.mouse.move(430,350);await page.mouse.down();await page.mouse.move(460,370);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect(await selected()).toEqual(['B','C']);expect(await geometry()).toBe(original);
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('cutline','locked',false);e.setLayerState('cutline','visible',false);e.select(null);});
  await drag([200,250],[580,460]);expect(await selected()).toEqual(['A','B','C']);
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('cutline','visible',true);e.select(null);});await drag([200,250],[580,460]);expect(await selected()).toEqual(['A','B','C','Cut']);
  // Selection decorations never become artwork or DXF entities.
  const exported=await page.evaluate(async()=>{const e=(window as any).__vectora,{exportDXF}=await import('/src/exportDXF.ts');return exportDXF([...e.objects,...e.overlays.children],true);});expect((exported.match(/LWPOLYLINE/g)||[]).length).toBe(4);
  await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();await expect(page.locator('.layer-object[aria-pressed="true"]:visible')).toHaveCount(3);
  await page.getByRole('button',{name:'Lock Artwork',exact:true}).click();expect(await selected()).toEqual(['Cut']);expect(errors).toEqual([]);
});
test('moving selected artwork to Cut Path preserves geometry, selection, styling and export with undo',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await draw(page);
  await page.locator('#create-outline').click();await page.locator('#close-properties').click();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('c');await page.mouse.move(300,600);await page.mouse.down();await page.mouse.move(350,620);await page.mouse.up();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();await page.getByRole('button',{name:'Circle',exact:true}).click({modifiers:['Shift']});
  const before=await page.evaluate(async()=>{const e=(window as any).__vectora,{flattenInDocument}=await import('/src/geometry.ts');return {snapshot:e.snapshot(),objects:e.artwork.children.map((s:any)=>({id:s.data.uid,name:s.data.name,geometry:flattenInDocument(s),bounds:s.bounds.toJSON()})),color:e.cutlines.children[0].strokeColor.toCSS(true)};});
  await expect(page.locator('[data-move-to-cut],.layer-selection-actions')).toHaveCount(0);
  await page.getByRole('button',{name:'Lock Cut Path',exact:true}).click();
  await page.getByRole('button',{name:'Unlock Cut Path',exact:true}).click();await page.getByRole('button',{name:'Hide Cut Path',exact:true}).click();
  await page.getByRole('button',{name:'Show Cut Path',exact:true}).click();await dragSelectionToLayer(page);
  const after=await page.evaluate(async()=>{const e=(window as any).__vectora,{flattenInDocument}=await import('/src/geometry.ts'),{exportDXF}=await import('/src/exportDXF.ts');return {art:e.artwork.children.length,cuts:e.cutlines.children.length,objects:e.selectedItems.map((s:any)=>({id:s.data.uid,name:s.data.name,geometry:flattenInDocument(s),bounds:s.bounds.toJSON()})),styles:e.selectedItems.map((s:any)=>({role:s.data.role,color:s.strokeColor.toCSS(true),fill:s.fillColor,width:s.strokeWidth,scaling:s.strokeScaling})),dxf:exportDXF(e.objects),snapshot:e.snapshot()};});
  expect(after.art).toBe(0);expect(after.cuts).toBe(3);expect(after.objects).toEqual(before.objects);
  for(const style of after.styles)expect(style).toEqual({role:'cutline',color:before.color,fill:null,width:1.5,scaling:false});
  expect((after.dxf.match(/LWPOLYLINE/g)||[]).length).toBe(3);expect(after.dxf.match(/8\nARTWORK\n/)).toBeNull();
  await expect(page.locator('#properties-panel')).toBeHidden();await expect(page.locator('#layer-objects-cutline')).toBeVisible();
  await page.screenshot({path:'test-results/move-to-cut.png'});
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before.snapshot);
  await expect(page.locator('[data-layer-id="artwork"] .layer-row')).toHaveClass(/is-selected/);
  await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after.snapshot);
  await page.getByRole('button',{name:'Properties',exact:true}).click();const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');expect(errors).toEqual([]);
});
test('production artwork can become a cut path without creating an outline',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await draw(page);
  const width=await page.locator('#field-width').inputValue();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);
  await expect(page.locator('[data-layer-id="artwork"] .layer-meta')).toHaveText('0 objects');await expect(page.locator('[data-layer-id="cutline"] .layer-meta')).toHaveText('1 object');
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Rectangle · Cut Path');await expect(page.locator('#field-width')).toHaveValue(width);
  const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});
test('line drawing supports snapped axis-aligned paths, endpoint editing and cut export',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=10;p.view.center=new p.Point(0,0);});
  const coords=(points:number[][])=>page.evaluate(points=>{const p=(window as any).__paper;return points.map(a=>{const q=p.view.projectToView(new p.Point(a));return [q.x,q.y];});},points);
  async function drag(from:number[],to:number[],shift=false){const [a,b]=await coords([from,to]);if(shift)await page.keyboard.down('Shift');await page.mouse.move(a[0],a[1]);await page.mouse.down();await page.mouse.move(b[0],b[1],{steps:4});await page.mouse.up();if(shift)await page.keyboard.up('Shift');}
  const shape=()=>page.evaluate(()=>{const s=(window as any).__vectora.selected;return {name:s.data.name,closed:s.closed,fill:s.fillColor,points:s.segments.map((v:any)=>[v.point.x,v.point.y]),bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]};});
  await page.getByRole('button',{name:'Lines',exact:true}).click();await expect(page.locator('#primary-lines-menu')).toBeVisible();
  await page.locator('#primary-lines-menu').screenshot({path:'test-results/lines-menu.png'});
  await page.getByRole('menuitemradio',{name:'Line',exact:true}).click();await drag([-34,-17],[-12,-17]);
  expect(await shape()).toEqual({name:'Line',closed:false,fill:null,points:[[-35,-15],[-10,-15]],bounds:[-35,-15,25,0]});
  await expect(page.locator('#properties-panel')).toBeHidden();await page.getByRole('button',{name:'Properties',exact:true}).click();
  await expect(page.locator('#field-height')).toHaveValue('0');await expect(page.locator('#field-height')).toBeDisabled();await expect(page.locator('#create-outline')).toBeDisabled();
  await page.locator('#field-x').fill('-35.25');await page.locator('#field-x').press('Tab');expect((await shape()).bounds).toEqual([-35.25,-15,25,0]);
  await page.locator('#field-width').fill('30');await page.locator('#field-width').press('Tab');expect((await shape()).bounds).toEqual([-35.25,-15,30,0]);
  await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
  await page.keyboard.press('v');await drag([-10,-15],[-10,0]);expect((await shape()).points).toEqual([[-35,-15],[-10,0]]);
  await page.keyboard.press('Control+z');expect((await shape()).bounds).toEqual([-35,-15,25,0]);
  await page.keyboard.press('l');await drag([-20,0],[-20,15]);expect((await shape()).bounds).toEqual([-20,0,0,15]);
  await page.keyboard.press('l');await drag([-5,-20],[15,-5],true);const s=await shape();expect(Math.abs((s.points[1][1]-s.points[0][1])/(s.points[1][0]-s.points[0][0]))).toBeCloseTo(1,8);
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);
  const report=await page.evaluate(async()=>{const e=(window as any).__vectora,{exportDXF}=await import('/src/exportDXF.ts');return {role:e.selected.data.role,dxf:exportDXF(e.objects),color:e.selected.strokeColor.toCSS(true)};});
  expect(report.role).toBe('cutline');expect(report.color.toLowerCase()).toBe('#ff0000');expect(report.dxf).toContain('90\n2\n70\n0\n');
  await page.screenshot({path:'test-results/line-tools.png'});expect(errors).toEqual([]);
});
test('polyline commits only clicked points, cancels safely, selects by stroke and preserves open DXF paths',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=10;p.view.center=new p.Point(0,0);(window as any).__vectora.setTool('polyline');});
  const coords=(a:number[])=>page.evaluate(a=>{const p=(window as any).__paper,q=p.view.projectToView(new p.Point(a));return [q.x,q.y];},a);
  async function click(a:number[],double=false){const q=await coords(a);if(double)await page.mouse.dblclick(q[0],q[1]);else await page.mouse.click(q[0],q[1]);}
  const state=()=>page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {count:e.objects.length,selection:s?.data.name??null,points:s?.segments.map((v:any)=>[v.point.x,v.point.y]),closed:s?.closed,fill:s?.fillColor};});
  await click([-31,-11]);await click([-9,-11]);await click([-9,11]);await click([-9,11]);
  expect((await state()).count).toBe(0);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.some((s:any)=>s.data.role==='artwork'))).toBe(false);
  const hover=await coords([5,20]);await page.mouse.move(hover[0],hover[1]);await page.screenshot({path:'test-results/polyline-preview.png'});await page.keyboard.press('Enter');
  expect(await state()).toEqual({count:1,selection:'Polyline',points:[[-30,-10],[-10,-10],[-10,10]],closed:false,fill:null});
  await page.keyboard.press('Control+z');expect((await state()).count).toBe(0);await page.keyboard.press('Control+Shift+z');expect((await state()).count).toBe(1);
  await click([-35,15]);await click([-20,15]);await click([-15,25],true);expect((await state()).count).toBe(2);expect((await state()).points).toHaveLength(3);
  const saved=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await click([5,5]);await click([10,15]);await page.keyboard.press('Backspace');await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(saved);
  await click([5,5]);await click([10,15]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(saved);
  await click([5,5]);await page.keyboard.press('v');expect((await state()).count).toBe(2);
  // The implied closing triangle is not a selectable fill on an open path.
  await click([-17,-3]);expect((await state()).selection).toBeNull();await click([-20,-10]);expect((await state()).selection).toBe('Polyline');
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#create-outline')).toBeDisabled();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);
  const dxf=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts');return exportDXF((window as any).__vectora.objects);});expect(dxf).toContain('90\n3\n70\n0\n');
  await page.getByRole('button',{name:'Lock Artwork',exact:true}).click();await page.locator('#cad-canvas').focus();await page.keyboard.press('p');await click([5,5]);await expect(page.locator('.toast-warning .toast-copy p')).toHaveText('Show and unlock Artwork before drawing.');expect((await state()).count).toBe(2);expect(errors).toEqual([]);
});
test('production Lines menu supports keyboard selection and polyline DXF download',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.getByRole('button',{name:'Lines',exact:true}).click();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'Polyline',exact:true})).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.locator('#primary-lines-menu')).toBeHidden();await expect(page.getByRole('button',{name:'Lines',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.mouse.click(260,350);await page.mouse.click(430,350);await page.mouse.click(430,500);await page.keyboard.press('Enter');await expect(page.locator('#properties-panel')).toBeHidden();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Polyline · Cut Path');
  const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
  await page.getByRole('button',{name:'Lines',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('#primary-lines-menu')).toBeHidden();await expect(page.getByRole('button',{name:'Lines',exact:true})).toBeFocused();
});
async function arcSetup(page:any){
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const p=(window as any).__paper;p.view.zoom=10;p.view.center=new p.Point(0,0);(window as any).__vectora.setTool('arc');});
}
async function arcDrag(page:any,from:number[],to:number[],cancel=false){
  const points=await page.evaluate(([from,to]:number[][])=>{const p=(window as any).__paper;return [from,to].map(a=>{const q=p.view.projectToView(new p.Point(a));return [q.x,q.y];});},[from,to]);
  await page.mouse.move(...points[0]);await page.mouse.down();await page.mouse.move(...points[1],{steps:6});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
const arcState=(page:any)=>page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {arc:e.selectedArc,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height],closed:s.closed,fill:s.fillColor,tool:e.tool,snapshot:e.snapshot(),color:s.strokeColor.toCSS(true)};});
test('Arc creates an exact snapped semicircle in one drag, with editable circular handles',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await arcSetup(page);
  await arcDrag(page,[1,1],[21,1]);const original=await arcState(page);
  expect(original.arc).toEqual({cx:0,cy:0,radius:20,start:180,sweep:180});expect(original.tool).toBe('select');expect(original.closed).toBe(false);expect(original.fill).toBeNull();
  for(const [i,n] of [-20,-20,40,20].entries())expect(original.bounds[i]).toBeCloseTo(n,7);
  await expect(page.locator('#properties-panel')).toBeHidden();
  // Radius diamond changes radius alone; endpoints change sweep and orientation independently.
  await arcDrag(page,[0,-20],[0,-31]);expect((await arcState(page)).arc.radius).toBe(30);
  await arcDrag(page,[30,0],[1,30]);expect((await arcState(page)).arc.sweep).toBe(270);
  await arcDrag(page,[-30,0],[0,-30]);expect((await arcState(page)).arc.start).toBe(-90);expect((await arcState(page)).arc.sweep).toBe(270);
  await arcDrag(page,[0,0],[11,6]);expect((await arcState(page)).arc).toMatchObject({cx:10,cy:5,radius:30,sweep:270});
  const moved=await arcState(page);await arcDrag(page,[10,5],[20,10],true);expect((await arcState(page)).snapshot).toEqual(moved.snapshot);
  await page.keyboard.press('Control+z');expect((await arcState(page)).arc.cx).toBe(0);await page.keyboard.press('Control+Shift+z');expect((await arcState(page)).snapshot).toEqual(moved.snapshot);
  await page.getByRole('button',{name:'Properties',exact:true}).click();await page.locator('#arc-radius').fill('12.345');await page.locator('#arc-radius').press('Tab');expect((await arcState(page)).arc.radius).toBe(12.345);
  await page.locator('#arc-start').fill('180');await page.locator('#arc-start').press('Tab');
  await page.getByRole('button',{name:'Semicircle 180°',exact:true}).click();expect((await arcState(page)).arc.sweep).toBe(180);
  await page.getByRole('button',{name:'Flip arc',exact:true}).click();expect((await arcState(page)).arc.sweep).toBe(-180);
  await page.locator('#field-width').fill('80');await page.locator('#field-width').press('Tab');const scaled=await arcState(page);expect(scaled.arc.radius).toBeCloseTo(40,6);expect(scaled.bounds[3]).toBeCloseTo(40,6);
  await page.locator('#arc-sweep').fill('0');await page.locator('#arc-sweep').press('Tab');await expect(page.locator('#arc-sweep')).toHaveAttribute('aria-invalid','true');expect((await arcState(page)).snapshot).toEqual(scaled.snapshot);
  await page.locator('#arc-sweep').fill('180');await page.locator('#arc-sweep').press('Tab');
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);expect((await arcState(page)).color.toLowerCase()).toBe('#ff0000');
  const dxf=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts');return exportDXF((window as any).__vectora.objects);});expect(dxf).toMatch(/90\n\d+\n70\n0\n/);
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#create-outline')).toBeDisabled();await page.screenshot({path:'test-results/arc-controls.png'});expect(errors).toEqual([]);
});
test('Arc drafts cancel safely, angular snapping and group transforms preserve valid geometry',async({page})=>{
  await arcSetup(page);await arcDrag(page,[0,0],[20,0],true);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await page.mouse.move(640,450);await page.mouse.down();await page.mouse.move(840,450);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await arcDrag(page,[0,0],[20,0]);
  await page.keyboard.down('Shift');await arcDrag(page,[20,0],[15,-13]);await page.keyboard.up('Shift');expect((await arcState(page)).arc.sweep).toBe(135);
  const result=await page.evaluate(async()=>{
    const p=(window as any).__paper,e=(window as any).__vectora,{createCircularArc}=await import('/src/arc.ts');
    const q=createCircularArc({cx:0,cy:0,radius:10,start:0,sweep:90}),major=createCircularArc({cx:0,cy:0,radius:10,start:0,sweep:-270});
    const lengths=[q.length,major.length];q.remove();major.remove();
    const arc=e.selected,rect=new p.Path.Rectangle({rectangle:[30,0,10,10],insert:false});e.addShape(rect,'Rectangle');e.select(arc,true);
    const before=e.snapshot();e.setProperty('x',10);e.setProperty('width',120);const converted=!e.objects.find((x:any)=>x.data.name==='Arc').data.arc;e.undo();e.undo();return {lengths,converted,before,after:e.snapshot()};
  });expect(result.lengths[0]).toBeCloseTo(Math.PI*5,1);expect(result.lengths[1]).toBeCloseTo(Math.PI*15,1);expect(result.converted).toBe(true);expect(result.after.artwork).toEqual(result.before.artwork);expect(result.after.cutlines).toEqual(result.before.cutlines);expect([...result.after.selectedIds].sort()).toEqual([...result.before.selectedIds].sort());
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('artwork','locked',true);e.setTool('arc');});await page.mouse.click(300,350);await expect(page.locator('.toast-warning .toast-copy p')).toHaveText('Show and unlock Artwork before drawing.');
});
test('production Arc menu draws and exports a semicircle with exact controls',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.getByRole('button',{name:'Arcs',exact:true}).click();await expect(page.getByRole('menuitemradio',{name:'Centre arc',exact:true})).toBeFocused();await page.keyboard.press('Enter');
  await page.mouse.move(440,500);await page.mouse.down();await page.mouse.move(590,500,{steps:5});await page.mouse.up();await expect(page.locator('#properties-panel')).toBeHidden();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Arc · Cut Path');await expect(page.locator('#arc-sweep')).toHaveValue('180');
  await page.locator('#arc-radius').fill('25');await page.locator('#arc-radius').press('Tab');await expect(page.locator('#field-width')).toHaveValue('50');await expect(page.locator('#field-height')).toHaveValue('25');
  const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});

test('Three-point arc restores snapped drawing, validation, cancellation, history and cut export',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await arcSetup(page);
  const coords=(a:number[])=>page.evaluate(a=>{const p=(window as any).__paper,q=p.view.projectToView(new p.Point(a));return [q.x,q.y];},a);
  async function click(a:number[]){const q=await coords(a);await page.mouse.click(q[0],q[1]);}
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Shift+a');
  await expect(page.locator('#tool-status')).toHaveText('Three-point arc · ⇧ A · Click start');
  await expect(page.getByRole('button',{name:'Arcs',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Shapes',exact:true})).toHaveAttribute('aria-pressed','false');
  await click([-31,1]);await expect(page.locator('#tool-status')).toContainText('Click curve point');
  await click([-30,0]);await expect(page.locator('.toast-error .toast-copy p')).toHaveText('Choose three different points for the arc.');
  await click([-14,-16]);await click([0,-30]);await expect(page.locator('.toast-error .toast-copy p')).toContainText('cannot lie on a straight line');
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await click([1,1]);const arc=await arcState(page);expect(arc.arc).toBeNull();expect(arc.closed).toBe(false);expect(arc.fill).toBeNull();
  for(const [i,n] of [-30,-15,30,15].entries())expect(arc.bounds[i]).toBeCloseTo(n,7);
  await expect(page.locator('#properties-panel')).toBeHidden();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+Shift+z');expect((await arcState(page)).snapshot).toEqual(arc.snapshot);
  await click([5,5]);await click([10,10]);await page.keyboard.press('Backspace');await expect(page.locator('#tool-status')).toContainText('Click curve point');await page.keyboard.press('Escape');expect((await arcState(page)).snapshot).toEqual(arc.snapshot);
  await click([5,5]);await page.keyboard.press('a');expect((await arcState(page)).snapshot).toEqual(arc.snapshot);await expect(page.locator('#tool-status')).toContainText('Centre arc · A');
  await page.keyboard.press('Shift+a');await click([5,5]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect((await arcState(page)).snapshot).toEqual(arc.snapshot);
  await click([5,5]);await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();await page.getByRole('button',{name:'Arc',exact:true}).click();expect((await arcState(page)).snapshot).toEqual(arc.snapshot);
  await dragSelectionToLayer(page);expect((await arcState(page)).color.toLowerCase()).toBe('#ff0000');
  const dxf=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts');return exportDXF((window as any).__vectora.objects);});expect(dxf).toMatch(/90\n\d+\n70\n0\n/);expect(errors).toEqual([]);
});
test('Arcs pop-out matches the reference, supports keyboard selection and both production tools',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');await page.locator('.left-toolbar [data-arc-trigger]').click();
  const menuStyle=()=>page.locator('#primary-arcs-menu').evaluate(el=>{const c=getComputedStyle(el);return {background:c.backgroundColor,color:c.color,width:c.width,padding:c.padding,borderRadius:c.borderRadius};});const reference=await menuStyle();
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.getByRole('button',{name:'Shapes',exact:true}).click();expect(await page.locator('#primary-shapes-menu [data-shape="Arc"]').count()).toBe(0);
  await page.getByRole('button',{name:'Arcs',exact:true}).click();await expect(page.locator('#primary-shapes-menu')).toBeHidden();expect(await menuStyle()).toEqual(reference);
  await page.screenshot({path:'test-results/arcs-menu.png'});
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitemradio',{name:'Three-point arc',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#primary-arcs-menu')).toBeHidden();await expect(page.locator('#tool-status')).toContainText('Three-point arc');
  await page.mouse.click(260,500);await page.mouse.click(410,350);await page.mouse.click(560,500);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Arc · Artwork');await expect(page.locator('#arc-controls')).toBeHidden();
  await page.getByRole('button',{name:'Arcs',exact:true}).click();await page.keyboard.press('Home');await expect(page.getByRole('menuitemradio',{name:'Centre arc',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#primary-arcs-menu')).toBeHidden();await expect(page.getByRole('button',{name:'Arcs',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Arcs',exact:true}).click();await page.getByRole('menuitemradio',{name:'Centre arc',exact:true}).click();await expect(page.locator('#tool-status')).toContainText('Centre arc');
});

test('Dissect delete previews only the bounded section, preserves cut style and undoes atomically',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(DEV);
  const before=await page.evaluate(()=>{
    const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=10;p.view.center=new p.Point(0,0);
    const target=new p.Path({segments:[[-30,0],[30,0]],insert:false,strokeColor:'#FF0000',strokeWidth:1.5,strokeScaling:false,data:{role:'cutline'}});e.addShape(target,'Line');
    for(const x of [-10,10])e.addShape(new p.Path({segments:[[x,-20],[x,20]],insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Line');
    e.setLayerState('artwork','locked',true);e.setTool('dissect-delete');return e.snapshot();
  });
  await page.mouse.move(640,450);
  const preview=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),lengths:e.overlays.children.filter((p:any)=>p.data.role==='delete-preview').map((p:any)=>p.length)};});expect(preview.snapshot).toEqual(before);expect(preview.lengths).toHaveLength(1);expect(preview.lengths[0]).toBeCloseTo(20,6);
  await page.screenshot({path:'test-results/dissect-delete-preview.png'});await page.mouse.click(640,450);
  const trimmed=await page.evaluate(async()=>{const e=(window as any).__vectora,{pathsOf}=await import('/src/geometry.ts'),{exportDXF}=await import('/src/exportDXF.ts');const shape=e.cutlines.children[0];return {count:e.objects.length,lengths:pathsOf(shape).map((p:any)=>p.length),closed:pathsOf(shape).map((p:any)=>p.closed),color:shape.strokeColor.toCSS(true),snapshot:e.snapshot(),dxf:exportDXF(e.objects)};});
  expect(trimmed.count).toBe(3);expect(trimmed.lengths).toHaveLength(2);for(const length of trimmed.lengths)expect(length).toBeCloseTo(20,8);expect(trimmed.closed).toEqual([false,false]);expect(trimmed.color.toLowerCase()).toBe('#ff0000');expect((trimmed.dxf.match(/LWPOLYLINE/g)||[]).length).toBe(2);
  await expect(page.locator('#properties-panel')).toBeHidden();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(trimmed.snapshot);
  await page.evaluate(()=>(window as any).__vectora.setLayerState('cutline','locked',true));await page.mouse.click(440,450);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);expect(errors).toEqual([]);
});
test('Dissect geometry handles closed curves, self crossings, transformed paths and anchor boundaries',async({page})=>{
  await page.goto(DEV);
  const result=await page.evaluate(async()=>{
    const p=(window as any).__paper,{createDeletePlan,disposeDeletePlan}=await import('/src/deletion.ts');
    const layer=new p.Layer(),circle=new p.Path.Circle({center:[0,0],radius:10}),axis=new p.Path({segments:[[0,-20],[0,20]]});
    const original=circle.exportJSON(),plan=createDeletePlan([circle,axis],new p.Point(7,-7),.5,'dissect-delete')!;
    const circular={remaining:plan.remaining!.length,closed:plan.remaining![0].closed,curved:plan.remaining![0].hasHandles(),removed:plan.preview[0].length,length:plan.remaining![0].length,sourceUnchanged:circle.exportJSON()===original};disposeDeletePlan(plan);
    axis.visible=false; // API expects layer visibility, so put the boundary in a hidden layer.
    const hidden=new p.Layer();hidden.addChild(axis);hidden.visible=false;
    const unbroken=createDeletePlan([circle,axis],new p.Point(7,-7),.5,'dissect-delete')!;const withoutBoundary={removed:unbroken.preview[0].length,remaining:unbroken.remaining![0].length};disposeDeletePlan(unbroken);
    layer.activate();
    const line=new p.Path({segments:[[0,0],[10,0]],applyMatrix:false});line.scale(3);line.translate([100,40]);
    const barrier=new p.Path({segments:[[105,20],[105,60]]});
    const transformed=createDeletePlan([line,barrier],new p.Point(95,40),.5,'dissect-delete')!;
    const transformedLengths=[transformed.preview[0].length,transformed.remaining![0].length];disposeDeletePlan(transformed);
    const bow=new p.Path({segments:[[-10,-10],[10,10],[-10,10],[10,-10]]});
    const self=createDeletePlan([bow],new p.Point(0,10),.5,'dissect-delete')!;const selfParts=self.remaining!.length;disposeDeletePlan(self);
    layer.remove();hidden.remove();return {circular,withoutBoundary,transformedLengths,selfParts};
  });
  expect(result.circular.remaining).toBe(1);expect(result.circular.closed).toBe(false);expect(result.circular.curved).toBe(true);expect(result.circular.length).toBeCloseTo(Math.PI*15,1);expect(result.circular.removed).toBeCloseTo(Math.PI*5,1);expect(result.circular.sourceUnchanged).toBe(true);expect(result.withoutBoundary.removed).toBeCloseTo(Math.PI*5,1);expect(result.withoutBoundary.remaining).toBeCloseTo(Math.PI*15,1);expect(result.transformedLengths).toEqual([15,15]);expect(result.selfParts).toBe(2);
});
test('Trimming arcs and compound contours clears stale controls and preserves untouched geometry',async({page})=>{
  await page.goto(DEV);
  await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{createCircularArc}=await import('/src/arc.ts');p.view.zoom=10;p.view.center=new p.Point(0,0);const arc=createCircularArc({cx:0,cy:0,radius:20,start:180,sweep:180});arc.strokeColor=new p.Color('#383838');arc.strokeWidth=1.5;e.addShape(arc,'Arc');e.addShape(new p.Path({segments:[[0,-30],[0,10]],insert:false,strokeColor:'#383838'}),'Line');e.setTool('dissect-delete');});
  await page.mouse.click(499,309);
  const arc=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0];return {name:s.data.name,arc:s.data.arc??null,curved:s.hasHandles(),closed:s.closed,length:s.length};});expect(arc.name).toBe('Trimmed path');expect(arc.arc).toBeNull();expect(arc.curved).toBe(true);expect(arc.closed).toBe(false);expect(arc.length).toBeCloseTo(Math.PI*10,1);
  const compound=await page.evaluate(async()=>{
    const p=(window as any).__paper,e=(window as any).__vectora;e.setTool('select');e.objects.forEach((s:any)=>s.remove());
    const shape=new p.CompoundPath({insert:false,children:[new p.Path.Circle({center:[0,0],radius:10,insert:false}),new p.Path.Circle({center:[30,0],radius:5,insert:false})],strokeColor:'#383838',strokeWidth:1.5});e.addShape(shape,'Sticker outline');e.addShape(new p.Path({segments:[[0,-20],[0,20]],insert:false,strokeColor:'#383838'}),'Line');e.setTool('dissect-delete');return shape.children[1].exportJSON();
  });
  await page.mouse.click(711,379);
  const after=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0];return {count:s.children.length,open:s.children[0].closed,untouched:s.children[1].exportJSON(),canOutline:e.canOutlineSelection};});expect(after.count).toBe(2);expect(after.open).toBe(false);
  // Style is inherited from the compound; compare the retained curve geometry, not its parent link.
  expect(JSON.parse(after.untouched)[1].segments).toEqual(JSON.parse(compound)[1].segments);
});
test('Delete menu matches reference and Line delete only removes clicked visible unlocked outlines',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');await page.locator('.left-toolbar [data-delete-trigger]').click();
  const style=()=>page.locator('#primary-delete-menu').evaluate(el=>{const c=getComputedStyle(el);return [c.backgroundColor,c.color,c.width,c.padding,c.borderRadius];});const reference=await style();
  await page.goto(DEV);await draw(page);await page.locator('#close-properties').click();await page.getByRole('button',{name:'Delete tools',exact:true}).click();expect(await style()).toEqual(reference);await page.screenshot({path:'test-results/delete-menu.png'});
  await page.keyboard.press('End');await expect(page.getByRole('menuitemradio',{name:'Line delete',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#primary-delete-menu')).toBeHidden();
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await page.mouse.click(400,350);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  await page.mouse.move(400,270);expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.filter((p:any)=>p.data.role==='delete-preview').length)).toBe(1);await page.mouse.click(400,270);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  await page.evaluate(()=>(window as any).__vectora.setLayerState('artwork','locked',true));await page.mouse.click(400,270);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.goto(PREVIEW);await draw(page);await page.locator('#close-properties').click();await page.locator('#cad-canvas').focus();await page.keyboard.press('Shift+k');await expect(page.locator('#tool-status')).toContainText('Line delete');await page.mouse.click(400,270);await page.keyboard.press('Control+z');await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Rectangle · Artwork');
});

test('Freehand follows the pointer, smooths an open stroke and supports history, cut export and deletion',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.getByRole('button',{name:'Lines',exact:true}).click();await page.keyboard.press('End');await expect(page.getByRole('menuitemradio',{name:'Freehand',exact:true})).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Lines',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#tool-status')).toContainText('Freehand · F');
  const samples=Array.from({length:61},(_,i)=>[281+i*5,351+Math.sin(i/60*Math.PI*2)*65]);
  await page.mouse.move(samples[0][0],samples[0][1]);await page.mouse.down();for(const [x,y] of samples.slice(1))await page.mouse.move(x,y);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.screenshot({path:'test-results/freehand-preview.png'});await page.mouse.up();
  const result=await page.evaluate(samples=>{
    const e=(window as any).__vectora,p=(window as any).__paper,s=e.selected,screen=(point:any)=>{const v=p.view.projectToView(point);return [v.x,v.y];};
    return {name:s.data.name,closed:s.closed,fill:s.fillColor,segments:s.segments.length,curved:s.hasHandles(),first:screen(s.firstSegment.point),last:screen(s.lastSegment.point),error:Math.max(...samples.map((a:number[])=>{const point=p.view.viewToProject(new p.Point(a));return s.getNearestPoint(point).getDistance(point)*p.view.zoom;})),snapshot:e.snapshot()};
  },samples);
  expect(result.name).toBe('Freehand');expect(result.closed).toBe(false);expect(result.fill).toBeNull();expect(result.curved).toBe(true);expect(result.segments).toBeLessThan(30);expect(result.error).toBeLessThan(2);
  for(const [i,n] of samples[0].entries())expect(result.first[i]).toBeCloseTo(n,6);for(const [i,n] of samples.at(-1)!.entries())expect(result.last[i]).toBeCloseTo(n,6);
  await expect(page.locator('#properties-panel')).toBeHidden();await expect(page.getByRole('button',{name:'Snapping',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(result.snapshot);
  await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();await expect(page.locator('#layer-objects-artwork .layer-object use')).toHaveAttribute('href','#i-freehand');await dragSelectionToLayer(page);
  const dxf=await page.evaluate(async()=>{const e=(window as any).__vectora,{exportDXF}=await import('/src/exportDXF.ts');return {text:exportDXF(e.objects),color:e.selected.strokeColor.toCSS(true)};});expect(dxf.color.toLowerCase()).toBe('#ff0000');expect(dxf.text).toMatch(/90\n\d+\n70\n0\n/);
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#create-outline')).toBeDisabled();await page.locator('#close-properties').click();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Shift+k');await page.mouse.click(...samples[20] as [number,number]);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);expect(errors).toEqual([]);
});
test('Freehand ignores taps, accepts flat strokes and cancels drafts without changing existing objects',async({page})=>{
  await page.goto(DEV);await page.locator('#cad-canvas').focus();await page.keyboard.press('f');await page.mouse.click(300,300);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await page.mouse.move(281,351);await page.mouse.down();await page.mouse.move(581,351,{steps:30});await page.mouse.up();
  const saved=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),height:e.selected.bounds.height,length:e.selected.length};});expect(saved.height).toBe(0);expect(saved.length).toBeGreaterThan(0);
  for(const action of ['Escape','v','blur','pointercancel']){
    await page.locator('#cad-canvas').focus();await page.keyboard.press('f');await page.mouse.move(310,460);await page.mouse.down();await page.mouse.move(500,550,{steps:8});
    if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else if(action==='pointercancel')await page.locator('#cad-canvas').dispatchEvent('pointercancel');else await page.keyboard.press(action);
    await page.mouse.up();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(saved.snapshot);
  }
  await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora,point=p.view.viewToProject(new p.Point(431,351));e.addShape(new p.Path({segments:[[point.x,point.y-20],[point.x,point.y+20]],insert:false,strokeColor:'#383838'}),'Line');e.setTool('dissect-delete');});
  await page.mouse.click(350,351);expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.name)).toBe('Trimmed path');
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('artwork','locked',true);e.setTool('freehand');});await page.mouse.move(300,400);await page.mouse.down();await page.mouse.move(500,500);await page.mouse.up();await expect(page.locator('.toast-warning .toast-copy p')).toHaveText('Show and unlock Artwork before drawing.');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});
test('production Freehand menu matches the reference and draws an exportable stroke',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');await page.locator('.left-toolbar [data-line-trigger]').click();
  const style=()=>page.locator('#primary-lines-menu').evaluate(el=>{const c=getComputedStyle(el);return [c.backgroundColor,c.width,c.padding,el.querySelectorAll('[role="menuitemradio"]').length];});const reference=await style();
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.getByRole('button',{name:'Lines',exact:true}).click();expect(await style()).toEqual(reference);await page.screenshot({path:'test-results/freehand-menu.png'});await page.getByRole('menuitemradio',{name:'Freehand',exact:true}).click();
  await page.mouse.move(300,350);await page.mouse.down();await page.mouse.move(380,450,{steps:12});await page.mouse.move(460,340,{steps:12});await page.mouse.move(540,430,{steps:12});await page.mouse.up();await expect(page.locator('#properties-panel')).toBeHidden();
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Freehand · Cut Path');const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});

test('Rotation handle turns selected geometry with Shift snapping, cancellation and atomic history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(DEV);
  const original=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=5;p.view.center=new p.Point(0,0);e.addShape(new p.Path.Rectangle({rectangle:[-20,-10,40,20],insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');e.setTool('select');return e.snapshot();});
  const position=()=>page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,h=e.overlays.children.find((s:any)=>s.data.control==='rotate'),point=p.view.projectToView(h.position),center=p.view.projectToView(e.selectionBounds.center);return {point:[point.x,point.y],center:[center.x,center.y]};});
  let handle=await position();await page.mouse.move(...handle.point as [number,number]);await page.mouse.down();const radius=handle.center[1]-handle.point[1];await page.keyboard.down('Shift');await page.mouse.move(handle.center[0]+radius,handle.center[1]+3,{steps:12});await page.mouse.up();await page.keyboard.up('Shift');
  const rotated=await page.evaluate(()=>{const e=(window as any).__vectora;return {angle:e.selectionRotation,bounds:[e.selectionBounds.width,e.selectionBounds.height],snapshot:e.snapshot()};});expect(rotated.angle).toBe(90);expect(rotated.bounds[0]).toBeCloseTo(20,7);expect(rotated.bounds[1]).toBeCloseTo(40,7);await expect(page.locator('#properties-panel')).toBeHidden();
  await page.screenshot({path:'test-results/rotation-handle.png'});await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(original);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(rotated.snapshot);
  for(const action of ['Escape','blur']){handle=await position();await page.mouse.move(...handle.point as [number,number]);await page.mouse.down();await page.mouse.move(handle.center[0]-100,handle.center[1],{steps:5});if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else await page.keyboard.press(action);await page.mouse.up();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(rotated.snapshot);}
  await page.getByRole('button',{name:'Properties',exact:true}).click();await page.locator('#field-rotation').fill('32.5');await page.locator('#field-rotation').press('Tab');expect(await page.evaluate(()=>(window as any).__vectora.selectionRotation)).toBe(32.5);await expect(page.locator('#field-rotation')).toHaveValue('32.5');
  const exact=await page.evaluate(()=>(window as any).__vectora.snapshot());await page.locator('#field-rotation').fill('');await page.locator('#field-rotation').press('Tab');await expect(page.locator('#field-rotation')).toHaveAttribute('aria-invalid','true');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(exact);expect(errors).toEqual([]);
});
test('Group rotation preserves spacing, cut style, circular arc metadata and DXF geometry',async({page})=>{
  await page.goto(DEV);
  const result=await page.evaluate(async()=>{
    const p=(window as any).__paper,e=(window as any).__vectora,{createCircularArc}=await import('/src/arc.ts'),{exportDXF}=await import('/src/exportDXF.ts');
    const arc=createCircularArc({cx:20,cy:20,radius:10,start:180,sweep:180});arc.strokeColor=new p.Color('#383838');arc.strokeWidth=1.5;arc.strokeScaling=false;e.addShape(arc,'Arc');e.moveSelectionToCutPath();
    e.setRotation(45);const turned=e.selected;const radiusError=Math.max(...Array.from({length:50},(_,i)=>Math.abs(turned.getPointAt(turned.length*i/49).getDistance(new p.Point(turned.data.arc.cx,turned.data.arc.cy))-10)));const single={start:turned.data.arc.start,sweep:turned.data.arc.sweep,radius:turned.data.arc.radius,center:[turned.data.arc.cx,turned.data.arc.cy],radiusError};
    const rect=new p.Path.Rectangle({rectangle:[-30,-10,20,10],insert:false,strokeColor:'#383838',strokeWidth:1.5});e.addShape(rect,'Rectangle');e.select(turned,true);
    const before=e.snapshot(),pivot=e.selectionBounds.center.clone(),centers=e.selectedItems.map((s:any)=>s.position.clone()),arcCenter=new p.Point(turned.data.arc.cx,turned.data.arc.cy);e.setRotation(90);
    const geometryErrors=e.selectedItems.map((s:any,i:number)=>s.position.getDistance(centers[i].rotate(90,pivot))),rotatedArc=e.objects.find((s:any)=>s.data.arc),expectedCenter=arcCenter.rotate(90,pivot);
    const group={errors:geometryErrors,arcError:new p.Point(rotatedArc.data.arc.cx,rotatedArc.data.arc.cy).getDistance(expectedCenter),start:rotatedArc.data.arc.start,color:rotatedArc.strokeColor.toCSS(true),dxf:exportDXF(e.objects),snapshot:e.snapshot()};e.undo();const restored=e.snapshot();e.redo();const redone=e.snapshot();return {single,group,before,restored,redone};
  });
  expect(result.single).toMatchObject({start:225,sweep:180,radius:10,center:[20,20]});expect(result.single.radiusError).toBeLessThan(.004);
  for(const error of result.group.errors)expect(error).toBeLessThan(.00001);expect(result.group.arcError).toBeLessThan(.00001);expect(result.group.start).toBe(315);expect(result.group.color.toLowerCase()).toBe('#ff0000');expect(result.group.dxf).toMatch(/90\n\d+\n70\n0\n/);
  expect(result.restored.artwork).toEqual(result.before.artwork);expect(result.restored.cutlines).toEqual(result.before.cutlines);expect(result.redone.cutlines).toEqual(result.group.snapshot.cutlines);
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Rotate selection by (degrees)',exact:true})).toHaveValue('0');await page.locator('#field-rotation').fill('15');await page.locator('#field-rotation').press('Tab');await expect(page.locator('#field-rotation')).toHaveValue('0');
});
test('production numeric rotation supports flat lines and DXF export without changing layers',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.getByRole('button',{name:'Snapping',exact:true}).click();await page.locator('#cad-canvas').focus();await page.keyboard.press('l');await page.mouse.move(300,350);await page.mouse.down();await page.mouse.move(500,350);await page.mouse.up();
  await page.getByRole('button',{name:'Properties',exact:true}).click();const length=Number(await page.locator('#field-width').inputValue());await page.locator('#field-rotation').fill('90');await page.locator('#field-rotation').press('Tab');expect(Number(await page.locator('#field-width').inputValue())).toBeCloseTo(0,6);expect(Number(await page.locator('#field-height').inputValue())).toBeCloseTo(length,6);
  await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#field-rotation')).toHaveValue('90');await expect(page.locator('#selection-name')).toHaveText('Line · Cut Path');const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});

test('Properties empty state matches the reference and follows selection while preserving File export',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');
  const appearance=(selector:string)=>page.locator(selector).evaluate(el=>{const c=getComputedStyle(el);return [c.color,c.padding,c.gap,c.textAlign,getComputedStyle(el.querySelector('p')!).color];});const reference=await appearance('#example-properties-empty');
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.getByRole('button',{name:'Properties',exact:true}).click();
  await expect(page.locator('#properties-empty')).toBeVisible();await expect(page.locator('#field-width')).toBeHidden();await expect(page.locator('#export-dxf')).toBeHidden();expect(await appearance('#properties-empty')).toEqual(reference);await page.screenshot({path:'test-results/properties-empty.png'});
  await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await page.mouse.move(280,300);await page.mouse.down();await page.mouse.move(500,450,{steps:5});await page.mouse.up();await expect(page.locator('#properties-empty')).toBeHidden();await expect(page.locator('#field-width')).toBeVisible();
  await page.keyboard.press('Delete');await expect(page.locator('#properties-empty')).toBeVisible();await expect(page.locator('#field-width')).toBeHidden();await page.keyboard.press('Control+z');await expect(page.locator('#field-width')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#properties-empty')).toBeVisible();await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export DXF',exact:true}).click();await expect(page.locator('#export-dxf')).toBeVisible();await expect(page.locator('#properties-empty')).toBeHidden();await page.locator('#include-artwork').check();const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
  await page.locator('#close-properties').click();await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#properties-empty')).toBeVisible();await expect(page.locator('#export-dxf')).toBeHidden();
});

test('Dissect breaks an unbroken outline edge by edge and preserves connected cut paths with undo',async({page})=>{
  await page.goto(DEV);const before=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=5;p.view.center=new p.Point(0,0);e.addShape(new p.Path.Rectangle({rectangle:[-20,-10,40,20],insert:false,strokeColor:'#FF0000',strokeWidth:1.5,strokeScaling:false,data:{role:'cutline'}}),'Rectangle');e.setTool('dissect-delete');return e.snapshot();});
  await page.mouse.move(640,400);const preview=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),length:e.overlays.children.find((s:any)=>s.data.role==='delete-preview')?.length};});expect(preview.snapshot).toEqual(before);expect(preview.length).toBeCloseTo(40,7);await page.screenshot({path:'test-results/dissect-outline-edge.png'});
  await page.mouse.click(640,400);const after=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0];return {isPath:s instanceof (window as any).__paper.Path,closed:s.closed,length:s.length,color:s.strokeColor.toCSS(true),role:s.data.role,snapshot:e.snapshot()};});expect(after.isPath).toBe(true);expect(after.closed).toBe(false);expect(after.length).toBeCloseTo(80,7);expect(after.color.toLowerCase()).toBe('#ff0000');expect(after.role).toBe('cutline');
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after.snapshot);
  await page.mouse.click(740,450);expect(await page.evaluate(()=>(window as any).__vectora.objects[0].length)).toBeCloseTo(60,7);await page.mouse.click(640,500);expect(await page.evaluate(()=>(window as any).__vectora.objects[0].length)).toBeCloseTo(20,7);await page.mouse.click(540,450);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await expect(page.locator('#toast-stack')).toBeHidden();
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects[0].length)).toBeCloseTo(20,7);
});
test('production Dissect deletes a polygon side without crossing lines',async({page})=>{
  await page.goto(PREVIEW);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.getByRole('button',{name:'Snapping',exact:true}).click();await page.locator('#cad-canvas').focus();await page.keyboard.press('y');await page.mouse.move(420,400);await page.mouse.down();await page.mouse.move(520,400);await page.mouse.up();await page.keyboard.press('k');await page.mouse.move(420,313.39746);await page.mouse.click(420,313.39746);await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#selection-name')).toHaveText('Trimmed path · Artwork');await expect(page.locator('#create-outline')).toBeDisabled();await page.locator('#include-artwork').check();const download=page.waitForEvent('download');await page.locator('#export-dxf').click();expect((await download).suggestedFilename()).toBe('vectora.dxf');
});

test('floating selection menu follows selection and supports bounded accessible movement',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');
  const specimen=page.locator('#floating-menu');
  const componentStyle=(element:Element)=>{const s=getComputedStyle(element);return {background:s.backgroundColor,color:s.color,padding:s.padding,gap:s.gap,borderRadius:s.borderRadius};};
  const referenceStyle=await specimen.evaluate(componentStyle);
  await page.locator('#floating-selection-demo').uncheck();await expect(specimen).toBeHidden();
  await page.locator('#floating-selection-demo').check();await expect(specimen).toBeVisible();
  await page.goto(DEV);
  await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const menu=page.getByRole('group',{name:'Floating selection menu',exact:true});
  await expect(menu).toBeHidden();
  await page.evaluate(()=>{
    const editor=(window as any).__vectora,paper=(window as any).__paper;
    editor.addShape(new paper.Path.Rectangle({rectangle:[-60,-30,40,30],insert:false}),'Rectangle');
    editor.addShape(new paper.Path.Circle({center:[35,0],radius:20,insert:false}),'Circle');
    editor.select(editor.objects[0]);editor.select(editor.objects[1],true);
  });
  await expect(menu).toBeVisible();await expect(menu.locator('.selection-count')).toHaveText('2 selected');
  expect(await menu.evaluate(componentStyle)).toEqual(referenceStyle);
  await page.screenshot({path:'test-results/floating-selection-default.png'});
  await expect(page.locator('#properties-panel')).toBeHidden();
  for(const name of ['Close path','Nest'])await expect(menu.getByRole('button',{name,exact:true})).toBeDisabled();
  await expect(menu.getByRole('button',{name:'Join',exact:true})).toBeEnabled();
  const initial=(await menu.boundingBox())!;
  expect(Math.abs(initial.x+initial.width/2-640)).toBeLessThanOrEqual(1);
  const geometry=await page.evaluate(()=>(window as any).__vectora.snapshot().artwork);
  const grip=menu.getByRole('button',{name:'Move selection menu'});
  await grip.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowUp');
  const nudged=(await menu.boundingBox())!;
  expect(nudged.x).toBe(initial.x-2);expect(nudged.y).toBe(initial.y-10);
  const handle=(await grip.boundingBox())!;
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+100,handle.y-100,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
  expect(await menu.boundingBox()).toEqual(nudged);
  await expect(menu.locator('.selection-count')).toHaveText('2 selected');
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(8,100,{steps:4});await page.mouse.up();
  const moved=(await menu.boundingBox())!;expect(moved.x).toBe(16);
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(geometry);
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0]);});
  await expect(menu.locator('.selection-count')).toHaveText('1 selected');
  const restored=(await menu.boundingBox())!;expect(restored.x).toBe(moved.x);expect(restored.y).toBe(moved.y);
  await page.evaluate(()=>{(window as any).__vectora.setLayerState('artwork','locked',true);});
  await expect(menu).toBeHidden();
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('artwork','locked',false);e.select(e.objects[0]);});
  await page.setViewportSize({width:390,height:750});
  await expect(menu).toBeVisible();
  await expect.poll(async()=>{const b=(await menu.boundingBox())!;return b.x>=16&&b.x+b.width<=374&&b.y>=16&&b.y+b.height<=734;}).toBe(true);
  await page.screenshot({path:'test-results/floating-selection-mobile.png'});
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[1],true);});
  await page.screenshot({path:'test-results/floating-selection-menu.png'});
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Delete');await expect(menu).toBeHidden();
});

test('rotation handle stays fixed above the top centre for shapes, curves, groups and flat lines',async({page})=>{
  await page.goto(DEV);
  for(const fixture of ['rectangle','curve','group','line'])for(const zoom of [2,8]){
    const start=await page.evaluate(async({fixture,zoom})=>{
      const e=(window as any).__vectora,p=(window as any).__paper;
      e.select(null);e.artwork.removeChildren();e.cutlines.removeChildren();p.view.zoom=zoom;p.view.center=new p.Point(0,0);
      const add=(path:any,name:string)=>{path.strokeColor='#383838';path.strokeWidth=1.5;path.strokeScaling=false;e.addShape(path,name);};
      if(fixture==='curve'){
        const {createArc}=await import('/src/arc.ts');add(createArc(new p.Point(-20,20),new p.Point(15,5),new p.Point(20,-20)),'Arc');
      }else if(fixture==='line')add(new p.Path({insert:false,segments:[[-25,0],[25,0]]}),'Line');
      else{
        add(new p.Path.Rectangle({rectangle:[-25,-10,50,20],insert:false}),'Rectangle');
        if(fixture==='group'){const first=e.selected;add(new p.Path.Circle({center:[35,20],radius:8,insert:false}),'Circle');e.select(first,true);}
      }
      e.setTool('select');const knob=e.overlays.children.find((item:any)=>item.data.control==='rotate');
      const center=p.view.projectToView(e.selectionBounds.center),point=p.view.projectToView(knob.position);
      return {x:point.x,y:point.y,cx:center.x,cy:center.y,radius:point.getDistance(center)};
    },{fixture,zoom});
    const check=async()=>{
      const geometry=await page.evaluate(()=>{
        const e=(window as any).__vectora,p=(window as any).__paper,b=e.selectionBounds;
        const stem=e.overlays.children.find((item:any)=>item.data.control==='rotation-stem'),knob=e.overlays.children.find((item:any)=>item.data.control==='rotate');
        const a=stem.firstSegment.point,k=knob.position;
        return {topCenterError:a.getDistance(b.topCenter),horizontalOffset:Math.abs(k.x-a.x),above:k.y<a.y,edgeError:Math.min(Math.abs(a.x-b.left),Math.abs(a.x-b.right),Math.abs(a.y-b.top),Math.abs(a.y-b.bottom)),inBounds:b.expand(1e-7).contains(a),outside:!b.contains(k),gap:stem.length*p.view.zoom,joined:stem.lastSegment.point.getDistance(k)};
      });
      expect(geometry.topCenterError).toBeLessThan(1e-7);expect(geometry.horizontalOffset).toBeLessThan(1e-7);expect(geometry.above).toBe(true);expect(geometry.inBounds).toBe(true);expect(geometry.edgeError).toBeLessThan(1e-7);expect(geometry.outside).toBe(true);expect(geometry.gap).toBeCloseTo(28,6);expect(geometry.joined).toBeLessThan(1e-7);
    };
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    for(const degrees of [15,45,90,135,180,225,270,315]){
      const angle=degrees*Math.PI/180;
      await page.mouse.move(start.cx+start.radius*Math.sin(angle),start.cy-start.radius*Math.cos(angle));await check();
      if(fixture==='curve'&&zoom===8&&degrees===45)await page.screenshot({path:'test-results/rotation-connected.png'});
    }
    await page.mouse.up();await check();
  }
});

test('duplicate button copies selection below bounds with independent metadata and atomic undo',async({page})=>{
  await page.goto(DEV);
  const button=page.getByRole('button',{name:'Duplicate selection',exact:true});
  await expect(button).toBeHidden();
  const before=await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    const {createCircularArc}=await import('/src/arc.ts');
    p.view.zoom=5;p.view.center=new p.Point(0,0);
    e.addShape(new p.Path.Rectangle({rectangle:[-40,-25,25,20],insert:false}),'Rectangle');
    e.setRotation(30);const rectangle=e.selected;
    e.addShape(createCircularArc({cx:20,cy:0,radius:15,start:0,sweep:180}),'Arc');
    e.moveSelectionToCutPath();e.select(rectangle,true);
    return e.snapshot();
  });
  await expect(button).toBeVisible();
  const anchor=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=p.view.projectToView(e.selectionBounds.bottomCenter);return {x:a.x,y:a.y};});
  const box=(await button.boundingBox())!;expect(box.width).toBe(28);expect(box.height).toBe(28);expect(box.x+14).toBeCloseTo(anchor.x,1);expect(box.y+14).toBeCloseTo(anchor.y+28,1);
  await button.click();
  await expect(page.locator('#properties-panel')).toBeHidden();
  const after=await page.evaluate(()=>{
    const e=(window as any).__vectora;
    return {snapshot:e.snapshot(),count:e.objects.length,selected:e.selectedItems.map((x:any)=>({uid:x.data.uid,role:x.data.role,arc:x.data.arc,rotation:x.data.rotationDegrees,color:x.strokeColor?.toCSS(true),fill:x.fillColor})),originals:[e.artwork.children[0],e.cutlines.children[0]].map((x:any)=>({uid:x.data.uid,arc:x.data.arc})),offsets:[e.artwork,e.cutlines].map((l:any)=>{const d=l.children[1].bounds.center.subtract(l.children[0].bounds.center);return [d.x,d.y];})};
  });
  expect(after.count).toBe(4);expect(new Set([...after.selected,...after.originals].map(x=>x.uid)).size).toBe(4);
  for(const offset of after.offsets){expect(offset[0]).toBeCloseTo(10,8);expect(offset[1]).toBeCloseTo(10,8);}
  const arc=after.selected.find(x=>x.role==='cutline')!;
  expect(arc.arc.cx).toBe(30);expect(arc.arc.cy).toBe(10);expect(arc.color.toLowerCase()).toBe('#ff0000');expect(arc.fill).toBeNull();
  expect(after.originals[1].arc.cx).toBe(20);expect(after.originals[1].arc.cy).toBe(0);
  expect(after.selected.find(x=>x.role==='artwork')!.rotation).toBe(30);
  const normalized=(snapshot:any)=>({...snapshot,selectedIds:[...snapshot.selectedIds].sort()});
  await page.keyboard.press('Control+z');expect(normalized(await page.evaluate(()=>(window as any).__vectora.snapshot()))).toEqual(normalized(before));
  await page.keyboard.press('Control+Shift+z');expect(normalized(await page.evaluate(()=>(window as any).__vectora.snapshot()))).toEqual(normalized(after.snapshot));
  await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.cutlines.children[1]);});
  await button.focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(5);
  await page.screenshot({path:'test-results/duplicate-selection.png'});
  await page.evaluate(()=>{(window as any).__vectora.select(null);});await expect(button).toBeHidden();
});

test('duplicate appears after drawing and its connector stays behind the resize handle',async({page})=>{
  await page.goto(DEV);
  const button=page.getByRole('button',{name:'Duplicate selection',exact:true});
  await page.locator('#cad-canvas').focus();await page.keyboard.press('r');
  await page.mouse.move(400,320);await page.mouse.down();await page.mouse.move(650,520);
  await expect(button).toBeHidden();await page.mouse.up();await expect(button).toBeVisible();
  const result=await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,b=e.selectionBounds;
    const stem=e.overlays.children.find((item:any)=>item.data.control==='duplicate-stem');
    const handle=e.overlays.children.find((item:any)=>item.bounds.center.getDistance(b.bottomCenter)<1e-7&&item.fillColor?.toCSS(true)==='#ffffff');
    return {tool:e.tool,behind:stem.index<handle.index,gap:stem.length*p.view.zoom,anchor:stem.firstSegment.point.getDistance(b.bottomCenter),cssStem:getComputedStyle(document.querySelector('#duplicate-selection')!,'::before').display};
  });
  expect(result).toMatchObject({tool:'rectangle',behind:true,anchor:0,cssStem:'none'});expect(result.gap).toBeCloseTo(28,8);
  await page.screenshot({path:'test-results/duplicate-created-shape.png'});
  await button.click();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
  await expect(button).toBeVisible();await expect(page.locator('#properties-panel')).toBeHidden();
  await page.locator('#cad-canvas').focus();await page.keyboard.press('k');await expect(button).toBeHidden();
});

test('Close path connects nearest endpoints into one outline with atomic history and closed DXF',async({page})=>{
  await page.goto(DEV);
  const close=page.getByRole('button',{name:'Close path',exact:true});
  const before=await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    for(const segments of [[[0,0],[20,0]],[[20,20],[20,0]],[[0,20],[20,20]]])e.addShape(new p.Path({segments,insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Line');
    const items=[...e.objects];e.select(items[2]);e.select(items[0],true);e.select(items[1],true);
    return e.snapshot();
  });
  await expect(close).toBeEnabled();await close.click();
  await expect(close).toBeDisabled();await expect(page.locator('#properties-panel')).toBeHidden();
  const after=await page.evaluate(async()=>{
    const e=(window as any).__vectora,s=e.selected;
    const {exportDXF}=await import('/src/exportDXF.ts');
    return {count:e.objects.length,closed:s.closed,length:s.length,area:Math.abs(s.area),segments:s.segments.length,fill:s.fillColor,dxf:exportDXF(e.objects,true),snapshot:e.snapshot()};
  });
  expect(after).toMatchObject({count:1,closed:true,length:80,area:400,segments:4,fill:null});
  expect(after.dxf).toContain('70\n1\n');
  const normalized=(s:any)=>({...s,selectedIds:[...s.selectedIds].sort()});
  await page.keyboard.press('Control+z');expect(normalized(await page.evaluate(()=>(window as any).__vectora.snapshot()))).toEqual(normalized(before));
  await expect(close).toBeEnabled();await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after.snapshot);
});

test('Close path preserves an exact cut arc and connects gaps without grid rounding',async({page})=>{
  await page.goto(DEV);
  const close=page.getByRole('button',{name:'Close path',exact:true});
  const before=await page.evaluate(async()=>{
    const e=(window as any).__vectora;
    const {createCircularArc}=await import('/src/arc.ts');
    e.addShape(createCircularArc({cx:30.125,cy:35.375,radius:15.25,start:20,sweep:180}),'Arc');e.moveSelectionToCutPath();
    const s=e.selected;return {curves:s.curves.map((c:any)=>c.values),length:s.length,gap:s.firstSegment.point.getDistance(s.lastSegment.point)};
  });
  await expect(close).toBeEnabled();await close.focus();await page.keyboard.press('Space');
  const result=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {curves:s.curves.slice(0,-1).map((c:any)=>c.values),length:s.length,closed:s.closed,arc:s.data.arc??null,role:s.data.role,color:s.strokeColor.toCSS(true),canOutline:e.canOutlineSelection};});
  expect(result.curves).toEqual(before.curves);expect(result.length).toBeCloseTo(before.length+before.gap,8);
  expect(result).toMatchObject({closed:true,arc:null,role:'cutline',color:'#ff0000',canOutline:true});
  await expect(close).toBeDisabled();await page.screenshot({path:'test-results/close-path.png'});
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({segments:[[0.125,0.375],[20.125,0.375]],insert:false}),'Line');});
  await expect(close).toBeDisabled();
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;const a=e.selected;e.addShape(new p.Path({segments:[[20.625,1.125],[21.625,20.875],[0.25,20.875]],insert:false}),'Polyline');e.select(a,true);});
  await expect(close).toBeEnabled();await close.click();
  const points=await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>[s.point.x,s.point.y]));
  const expected=[[0.125,0.375],[20.125,0.375],[20.625,1.125],[21.625,20.875],[0.25,20.875]];
  expect(points[0][0]===expected[0][0]?points:[...points].reverse()).toEqual(expected);
});

test('Close path preserves compound closed contours and refuses to merge different layers',async({page})=>{
  await page.goto(DEV);const close=page.getByRole('button',{name:'Close path',exact:true});
  await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.CompoundPath({insert:false,children:[new p.Path({insert:false,segments:[[0,0],[20,0],[20,20]]}),new p.Path.Circle({insert:false,center:[10,10],radius:2})]}),'Compound');
  });
  await close.click();
  expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {count:s.children.length,closed:s.children.every((p:any)=>p.closed),holeArea:Math.abs(s.children[0].area)};})).toMatchObject({count:2,closed:true});
  await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.Path({segments:[[30,0],[40,0],[40,20]],insert:false}),'Polyline');e.moveSelectionToCutPath();const a=e.selected;
    e.addShape(new p.Path({segments:[[0,0],[10,0],[10,20]],insert:false}),'Polyline');e.select(a,true);
  });
  await expect(close).toBeDisabled();
});

test('Join preserves contours as one selectable, transformable, duplicable object with undo',async({page})=>{
  await page.goto(DEV);const join=page.getByRole('button',{name:'Join',exact:true});
  const before=await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    const {createCircularArc}=await import('/src/arc.ts');
    p.view.zoom=5;p.view.center=new p.Point(0,0);
    e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-40,-20,20,20],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');
    e.addShape(new p.Path.Circle({insert:false,center:[5,-10],radius:8,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Circle');
    const arc=createCircularArc({cx:30,cy:5,radius:10,start:0,sweep:180});arc.strokeColor='#383838';arc.strokeWidth=1.5;arc.strokeScaling=false;e.addShape(arc,'Arc');
    const objects=[...e.objects];e.select(objects[0]);for(const o of objects.slice(1))e.select(o,true);
    return {snapshot:e.snapshot(),curves:objects.map((o:any)=>o.curves.map((c:any)=>c.values)),closed:objects.map((o:any)=>o.closed)};
  });
  await expect(join).toBeEnabled();await join.click();await expect(join).toBeDisabled();
  await expect(page.locator('#selection-menu .selection-count')).toHaveText('1 selected');await expect(page.locator('#properties-panel')).toBeHidden();
  const joined=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {snapshot:e.snapshot(),count:e.objects.length,curves:s.children.map((p:any)=>p.curves.map((c:any)=>c.values)),closed:s.children.map((p:any)=>p.closed),fill:s.fillColor,arc:s.data.arc??null};});
  expect(joined.count).toBe(1);expect(joined.curves).toEqual(before.curves);expect(joined.closed).toEqual(before.closed);expect(joined.fill).toBeNull();expect(joined.arc).toBeNull();
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before.snapshot);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(joined.snapshot);
  const point=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.select(null);const v=p.view.projectToView(new p.Point(-30,-10));return {x:v.x,y:v.y};});
  await page.mouse.click(point.x,point.y);await expect(page.locator('#selection-menu .selection-count')).toHaveText('1 selected');
  const transformed=await page.evaluate(()=>{
    const e=(window as any).__vectora;
    const points=()=>e.selected.children.flatMap((p:any)=>p.segments.map((s:any)=>[s.point.x,s.point.y]));
    const original=points(),x=e.selectionBounds.x;e.setProperty('x',x+7.125);const moved=points(),bounds=e.selectionBounds.clone();
    e.setProperty('width',bounds.width*2);const scaled=points(),pivot=e.selectionBounds.center;e.setRotation(90);const rotated=points();
    return {original,moved,scaled,rotated,x:bounds.x,pivot:[pivot.x,pivot.y]};
  });
  transformed.original.forEach((p:number[],i:number)=>{
    expect(transformed.moved[i][0]).toBeCloseTo(p[0]+7.125,8);expect(transformed.moved[i][1]).toBeCloseTo(p[1],8);
    expect(transformed.scaled[i][0]).toBeCloseTo(transformed.x+(transformed.moved[i][0]-transformed.x)*2,8);
    expect(transformed.rotated[i][0]).toBeCloseTo(transformed.pivot[0]-(transformed.scaled[i][1]-transformed.pivot[1]),8);
    expect(transformed.rotated[i][1]).toBeCloseTo(transformed.pivot[1]+(transformed.scaled[i][0]-transformed.pivot[0]),8);
  });
  await page.getByRole('button',{name:'Duplicate selection',exact:true}).click();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {count:e.objects.length,parts:e.selected.children.length};})).toEqual({count:2,parts:3});
  await page.keyboard.press('Delete');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  const exported=await page.evaluate(async()=>{const e=(window as any).__vectora;e.select(e.objects[0]);e.moveSelectionToCutPath();const {exportDXF}=await import('/src/exportDXF.ts');return {dxf:exportDXF(e.objects),role:e.selected.data.role,color:e.selected.strokeColor.toCSS(true),children:e.selected.children.length};});
  expect(exported).toMatchObject({role:'cutline',color:'#ff0000',children:3});expect(exported.dxf.match(/LWPOLYLINE/g)).toHaveLength(3);
  await page.screenshot({path:'test-results/joined-shape.png'});
});

test('Join combines existing joined shapes and rejects single or mixed-layer selections',async({page})=>{
  await page.goto(DEV);const join=page.getByRole('button',{name:'Join',exact:true});
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,20,20]}),'Rectangle');});
  await expect(join).toBeDisabled();
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=e.selected;e.addShape(new p.Path.Circle({insert:false,center:[30,10],radius:5}),'Circle');e.select(a,true);});
  await join.focus();await page.keyboard.press('Space');await expect(join).toBeDisabled();
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=e.selected;e.addShape(new p.Path({insert:false,segments:[[40,0],[40,20]]}),'Line');e.select(a,true);});
  await join.click();expect(await page.evaluate(()=>(window as any).__vectora.selected.children.length)).toBe(3);
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.moveSelectionToCutPath();const a=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[50,0,20,20]}),'Rectangle');e.select(a,true);});
  await expect(join).toBeDisabled();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});


async function typeCanvasText(page:any,content:string){
  await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(380,330);
  const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});await expect(input).toBeVisible();
  await input.fill(content);await input.press('Control+Enter');await expect(input).toBeHidden();
}

test('Inline text converts every contour separately and undo restores editable text',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'BOi\nText');
  await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#properties-panel')).toBeHidden();
  const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),curves:e.selected.children.map((p:any)=>p.curves.map((c:any)=>c.values))};});
  const convert=page.getByRole('button',{name:'Convert to path',exact:true});await expect(convert).toBeVisible();await convert.click();
  await expect(convert).toBeHidden();await expect(page.locator('#selection-menu .selection-count')).toHaveText(`${before.curves.length} selected`);
  const after=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{exportDXF}=await import('/src/exportDXF.ts');return {count:e.objects.length,snapshot:e.snapshot(),text:e.objects.some((s:any)=>s.data.text),curves:e.objects.flatMap((s:any)=>(s instanceof p.Path?[s]:s.children).map((path:any)=>path.curves.map((c:any)=>c.values))),parts:e.objects.map((s:any)=>s instanceof p.Path?1:s.children.length),dxf:exportDXF(e.objects,true)};});
  expect(after.count).toBe(before.curves.length);expect(after.text).toBe(false);expect(after.curves).toEqual(before.curves);expect(after.parts).toEqual(Array(before.curves.length).fill(1));
  expect(after.dxf.match(/LWPOLYLINE/g)).toHaveLength(before.curves.length);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before.snapshot);await expect(convert).toBeVisible();
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after.snapshot);
  const click=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.select(null);const first=e.objects[0],v=p.view.projectToView(first.segments[0].point);return {x:v.x,y:v.y,others:e.objects.slice(1).map((s:any)=>s.exportJSON())};});
  await page.mouse.click(click.x,click.y);await expect(page.locator('#selection-menu .selection-count')).toHaveText('1 selected');
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('x',e.selectionBounds.x+8);});
  expect(await page.evaluate(()=>(window as any).__vectora.objects.slice(1).map((s:any)=>s.exportJSON()))).toEqual(click.others);
  await page.screenshot({path:'test-results/text-individual-letters.png'});
});

test('Text Properties changes font and size while inline edits preserve transforms and cut style',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'AbO');
  await page.getByRole('button',{name:'Properties',exact:true}).click();
  const font=page.getByRole('combobox',{name:'Font',exact:true});await expect(font).toHaveValue('lato');
  for(const id of ['pt-serif','space-mono']){
    await font.selectOption(id);await expect.poll(()=>page.evaluate(()=>(window as any).__vectora.selected.data.text.fontId)).toBe(id);
  }
  await page.locator('#text-property-size').fill('15');await page.locator('#text-property-size').press('Enter');await page.locator('#text-properties').getByRole('heading',{name:'Text',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__vectora.selected.data.text.sizeMM)).toBe(15);
  const transformed=await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('x',e.selectionBounds.x+13.125);e.setProperty('width',e.selectionBounds.width*1.6);e.setProperty('height',e.selectionBounds.height*0.8);e.setRotation(37);e.duplicateSelection();e.moveSelectionToCutPath();return {matrix:e.selected.data.text.transform,curves:e.selected.children.map((p:any)=>p.curves.map((c:any)=>c.values))};});
  await page.getByRole('button',{name:'Edit text',exact:true}).click();const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});await expect(input).toHaveValue('AbO');
  await input.fill('AbO ');await input.press('Control+Enter');await expect(input).toBeHidden();
  const edited=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {curves:s.children.map((p:any)=>p.curves.map((c:any)=>c.values)),text:s.data.text,color:s.fillColor.toCSS(true),role:s.data.role};});
  expect(edited.text.transform).toEqual(transformed.matrix);expect(edited.text.fontId).toBe('space-mono');expect(edited.role).toBe('cutline');expect(edited.color).toBe('#ff0000');
  edited.curves.forEach((path:number[][],i:number)=>path.forEach((curve:number[],j:number)=>curve.forEach((value:number,k:number)=>expect(value).toBeCloseTo(transformed.curves[i][j][k],8))));
  await page.screenshot({path:'test-results/text-font-properties.png'});
});

test('Inline text supports double-click, outside commit, cancellation and isolated typing',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'Original');
  const original=await page.evaluate(()=>(window as any).__vectora.snapshot());
  const center=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,v=p.view.projectToView(e.selected.bounds.center);return {x:v.x,y:v.y};});
  await page.mouse.dblclick(center.x,center.y);const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});await expect(input).toHaveValue('Original');
  await input.fill('rvca text\nNext line');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('select');
  await page.screenshot({path:'test-results/inline-text.png'});
  await input.press('Escape');await expect(input).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(original);
  await page.mouse.dblclick(center.x,center.y);await input.fill('Outside');await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(input).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__vectora.selected.data.text.content)).toBe('Outside');
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.selected.data.text.content)).toBe('Original');
});

test('Text converts dotted letters and ligature pairs separately, and production fonts load',async({page})=>{
  await page.goto(PREVIEW);await typeCanvasText(page,'fi BO');
  await page.getByRole('button',{name:'Properties',exact:true}).click();await page.getByRole('combobox',{name:'Font',exact:true}).selectOption('pt-serif');
  await expect(page.getByRole('combobox',{name:'Font',exact:true})).toHaveValue('pt-serif');
  // The font selection is applied asynchronously; wait for the text control to settle.
  await page.getByRole('button',{name:'Edit text',exact:true}).click();await expect(page.getByRole('textbox',{name:'Edit text on canvas',exact:true})).toHaveCSS('font-family','"Vectora PT Serif"');
  await page.getByRole('textbox',{name:'Edit text on canvas',exact:true}).press('Control+Enter');
  await page.getByRole('button',{name:'Convert to path',exact:true}).click();await expect(page.locator('#selection-menu .selection-count')).toHaveText('8 selected');
  await page.locator('#include-artwork').check();const pending=page.waitForEvent('download');await page.locator('#export-dxf').click();const download=await pending;
  const stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();
  const entities=text.split('LWPOLYLINE\n').slice(1);expect(entities.length).toBeGreaterThan(4);for(const entity of entities)expect(entity).toContain('70\n1\n');
});

test('Typing uses the object selection frame and a constant-width blue caret',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'Text');
  const readFrame=()=>page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    const border=e.overlays.children.find((item:any)=>item.data.control==='selection-border');
    const handles=e.overlays.children.filter((item:any)=>item.data.control==='selection-handle');
    return {bounds:[border.bounds.x,border.bounds.y,border.bounds.width,border.bounds.height],stroke:border.strokeWidth*p.view.zoom,color:border.strokeColor.toCSS(true),dash:border.dashArray.map((n:number)=>n*p.view.zoom),handles:handles.map((h:any)=>({size:h.bounds.width*p.view.zoom,fill:h.fillColor.toCSS(true),color:h.strokeColor.toCSS(true)}))};
  });
  // Reopening transformed cut text must preserve its exact selected bounds and neutral controls.
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setRotation(25);e.moveSelectionToCutPath();});
  const selected=await readFrame();
  await page.evaluate(()=>{const e=(window as any).__vectora;e.onTextRequest(null,e.selected);});
  const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});
  await expect.poll(async()=>{const frame=await readFrame();return frame.bounds.every((n:number,i:number)=>Math.abs(n-selected.bounds[i])<1e-8);}).toBe(true);
  await expect(input).toHaveCSS('outline-style','none');
  const caret=page.locator('.inline-text-caret');
  await expect(caret).toBeVisible();await expect(caret).toHaveCSS('stroke','rgb(82, 185, 223)');
  await expect(caret).toHaveCSS('stroke-width','1px');
  await expect(caret.locator('path')).toHaveAttribute('vector-effect','non-scaling-stroke');
  await input.fill('Text\nNew line');
  await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom*=1.5;e.onChange();});
  const typing=await readFrame();expect(typing.handles).toHaveLength(8);
  typing.handles.forEach(h=>{expect(h.size).toBeCloseTo(8);expect(h.fill).toBe('#ffffff');expect(h.color).toBe('#52b9df');});
  expect(typing.stroke).toBeCloseTo(1);typing.dash.forEach(n=>expect(n).toBeCloseTo(4));
  await input.press('ArrowLeft');await expect(caret).toBeVisible();
  await input.press('Shift+ArrowLeft');await expect(caret).toBeHidden();
  await input.press('ArrowRight');await expect(caret).toBeVisible();
  await page.screenshot({path:'test-results/inline-text-selection.png'});
  await input.press('Control+Enter');await expect(caret).toBeHidden();
  expect(await readFrame()).toEqual(typing);
});


test('Editable text is filled until Convert to path creates individual unfilled outlines',async({page})=>{
  await page.goto(DEV);
  await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(380,330);
  const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});
  await input.fill('BO');await expect(input).toHaveCSS('color','rgb(255, 255, 255)');await expect(input).toHaveCSS('-webkit-text-stroke-width','0px');
  await page.screenshot({path:'test-results/plain-text-typing.png'});
  await input.press('Control+Enter');await expect(input).toBeHidden();
  const style=()=>page.evaluate(()=>{const e=(window as any).__vectora;return e.objects.map((s:any)=>({fill:s.fillColor?.toCSS(true)??null,stroke:s.strokeColor?.toCSS(true)??null,text:!!s.data.text}));});
  expect(await style()).toEqual([{fill:'#ffffff',stroke:null,text:true}]);
  const original=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await page.screenshot({path:'test-results/plain-text-selected.png'});
  await page.getByRole('button',{name:'Convert to path',exact:true}).click();
  expect(await style()).toEqual(Array(5).fill({fill:null,stroke:'#ffffff',text:false}));
  await page.screenshot({path:'test-results/plain-text-converted.png'});
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(original);
  await page.evaluate(()=>{const e=(window as any).__vectora;e.moveSelectionToCutPath();e.onTextRequest(null,e.selected);});
  await expect(input).toHaveCSS('color','rgb(255, 0, 0)');await input.fill('BOB');await input.press('Control+Enter');await expect(input).toBeHidden();
  expect(await style()).toEqual([{fill:'#ff0000',stroke:null,text:true}]);
  await page.getByRole('button',{name:'Convert to path',exact:true}).click();
  expect(await style()).toEqual(Array(8).fill({fill:null,stroke:'#ff0000',text:false}));
});

test('Converted O inner contour and detached i dot can be selected and moved independently',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'Oi');
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('width',e.selectionBounds.width*3);e.setProperty('height',e.selectionBounds.height*3);e.setRotation(18);});
  await page.getByRole('button',{name:'Convert to path',exact:true}).click();
  await expect(page.locator('#selection-menu .selection-count')).toHaveText('4 selected');
  for(const letter of ['O','i']){
    const target=await page.evaluate((letter)=>{
      const e=(window as any).__vectora,p=(window as any).__paper;e.select(null);
      const paths=e.objects.filter((s:any)=>s.data.name.startsWith(`Letter ${letter} ·`));
      const item=paths.sort((a:any,b:any)=>Math.abs(a.area)-Math.abs(b.area))[0];
      const point=p.view.projectToView(item.getPointAt(item.length/3));
      return {uid:item.data.uid,x:point.x,y:point.y,others:e.objects.filter((s:any)=>s!==item).map((s:any)=>s.exportJSON())};
    },letter);
    await page.mouse.click(target.x,target.y);
    expect(await page.evaluate(()=>(window as any).__vectora.selected?.data.uid)).toBe(target.uid);
    await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('x',e.selectionBounds.x+20);});
    expect(await page.evaluate((uid)=>(window as any).__vectora.objects.filter((s:any)=>s.data.uid!==uid).map((s:any)=>s.exportJSON()),target.uid)).toEqual(target.others);
  }
  await page.screenshot({path:'test-results/text-separate-contours.png'});
});

test('Selection flip buttons mirror a mixed selection exactly with atomic undo and redo',async({page})=>{
  await page.goto(DEV);await expect(page.locator('#selection-menu')).toBeHidden();
  await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,{createCircularArc}=await import('/src/arc.ts');
    const triangle=new p.Path({segments:[[20,20],[60,30],[30,60]],closed:true,insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});e.addShape(triangle,'Triangle');
    const arc=createCircularArc({cx:90,cy:50,radius:20,start:25,sweep:210});e.addShape(arc,'Arc');e.moveSelectionToCutPath();e.select(triangle,true);
  });
  const state=()=>page.evaluate(()=>{const e=(window as any).__vectora,snapshot=e.snapshot();snapshot.selectedIds.sort();return {snapshot,pivot:[e.selectionBounds.center.x,e.selectionBounds.center.y],items:e.objects.map((s:any)=>({uid:s.data.uid,role:s.data.role,stroke:s.strokeColor?.toCSS(true),arc:s.data.arc,points:s.segments.map((seg:any)=>[seg.point.x,seg.point.y,seg.handleIn.x,seg.handleIn.y,seg.handleOut.x,seg.handleOut.y])}))};});
  for(const axis of ['horizontal','vertical']){
    const before=await state();const button=page.getByRole('button',{name:`Flip ${axis}`,exact:true});await expect(button).toBeEnabled();await button.click();
    const after=await state(),component=axis==='horizontal'?0:1;
    after.items.forEach((item:any,i:number)=>{
      expect(item.uid).toBe(before.items[i].uid);expect(item.role).toBe(before.items[i].role);expect(item.stroke).toBe(before.items[i].stroke);
      item.points.forEach((point:number[],j:number)=>point.forEach((n,k)=>{
        const original=before.items[i].points[j][k];
        expect(n).toBeCloseTo(k%2===component?(k<2?2*before.pivot[component]-original:-original):original,8);
      }));
      if(item.arc){expect(item.arc.sweep).toBe(-before.items[i].arc.sweep);expect(item.arc.radius).toBe(before.items[i].arc.radius);}
    });
    await expect(page.locator('#selection-menu .selection-count')).toHaveText('2 selected');await expect(page.locator('#properties-panel')).toBeHidden();
    await page.keyboard.press('Control+z');expect((await state()).snapshot).toEqual(before.snapshot);
    await page.keyboard.press('Control+Shift+z');expect((await state()).snapshot).toEqual(after.snapshot);
    await button.click();const twice=await state();twice.items.forEach((item:any,i:number)=>item.points.forEach((point:number[],j:number)=>point.forEach((n,k)=>expect(n).toBeCloseTo(before.items[i].points[j][k],8))));
  }
  await page.screenshot({path:'test-results/selection-flips.png'});
});

test('Flipped text stays editable and converts without losing its mirrored contours',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'AbO');
  for(const axis of ['horizontal','vertical'])await page.getByRole('button',{name:`Flip ${axis}`,exact:true}).click();
  const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {matrix:e.selected.data.text.transform,curves:e.selected.children.map((s:any)=>s.curves.map((c:any)=>c.values))};});
  await page.evaluate(()=>{const e=(window as any).__vectora;e.onTextRequest(null,e.selected);});
  for(const axis of ['horizontal','vertical'])await expect(page.getByRole('button',{name:`Flip ${axis}`,exact:true})).toBeDisabled();
  const input=page.getByRole('textbox',{name:'Edit text on canvas',exact:true});await input.fill('AbO ');await input.press('Control+Enter');await expect(input).toBeHidden();
  const after=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {matrix:s.data.text.transform,curves:s.children.map((p:any)=>p.curves.map((c:any)=>c.values))};});
  expect(after.matrix).toEqual(before.matrix);
  after.curves.forEach((path:number[][],i:number)=>path.forEach((curve:number[],j:number)=>curve.forEach((n,k)=>expect(n).toBeCloseTo(before.curves[i][j][k],8))));
  await page.getByRole('button',{name:'Convert to path',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.curves.map((c:any)=>c.values)))).toEqual(after.curves);
});

async function nodePosition(page:any,index:number,part='point',object=0,contour=0){
  return page.evaluate(({index,part,object,contour})=>{const e=(window as any).__vectora,p=(window as any).__paper,owner=e.objects[object],path=owner instanceof p.Path?owner:owner.children[contour],segment=path.segments[index],point=path.localToGlobal(part==='point'?segment.point:segment.point.add(segment[part])),screen=p.view.projectToView(point);return {x:screen.x,y:screen.y};},{index,part,object,contour});
}

test('Node tool adds exact curve points, moves and deletes nodes, adjusts tangents and cancels drags',async({page})=>{
  await page.goto(DEV);await page.getByRole('button',{name:'Snapping',exact:true}).click();
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,path=new p.Path({insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});path.moveTo([25,30]);path.cubicCurveTo([50,10],[80,70],[110,40]);path.lineTo([150,60]);e.addShape(path,'Curve');});
  await page.getByRole('button',{name:'Node editing',exact:true}).click();
  await expect(page.getByRole('button',{name:'Node editing',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.filter((s:any)=>s.data.control==='node').length)).toBe(3);
  const curve=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,path=e.objects[0],point=p.view.projectToView(path.curves[0].getPointAtTime(0.5));return {x:point.x,y:point.y,samples:Array.from({length:31},(_,i)=>{const q=path.curves[0].getPointAtTime(i/30);return [q.x,q.y];})};});
  await page.mouse.dblclick(curve.x,curve.y);
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].segments.length)).toBe(4);
  const error=await page.evaluate(samples=>{const e=(window as any).__vectora,p=(window as any).__paper;return Math.max(...samples.map(coords=>{const q=new p.Point(coords);return e.objects[0].getNearestPoint(q).getDistance(q);}));},curve.samples);expect(error).toBeLessThan(1e-6);
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
  const node=await nodePosition(page,1);await page.mouse.move(node.x,node.y);await page.mouse.down();await page.mouse.move(node.x+45,node.y+30,{steps:4});await page.mouse.up();
  const moved=await page.evaluate(()=>(window as any).__vectora.snapshot());expect(moved).not.toEqual(before);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(moved);
  const position=await nodePosition(page,1);await page.mouse.click(position.x,position.y);
  const anchor=await page.evaluate(()=>(window as any).__vectora.objects[0].segments[1].point.toJSON());
  const handle=await nodePosition(page,1,'handleOut');await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+20,handle.y-35,{steps:4});await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].segments[1].point.toJSON())).toEqual(anchor);
  const beforeCancel=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await page.mouse.move(position.x,position.y);await page.mouse.down();await page.mouse.move(position.x-30,position.y+50);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(beforeCancel);
  await page.mouse.click(position.x,position.y);await page.keyboard.press('Delete');expect(await page.evaluate(()=>(window as any).__vectora.objects[0].segments.length)).toBe(3);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(beforeCancel);
  await expect(page.locator('#properties-panel')).toBeHidden();
});

test('Node context menu changes point type and splits open and closed paths with undo',async({page})=>{
  await page.goto(DEV);
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({segments:[[30,30],[70,60],[120,30]],insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Polyline');});
  await page.getByRole('button',{name:'Node editing',exact:true}).click();let point=await nodePosition(page,1);
  await page.mouse.click(point.x,point.y,{button:'right'});await expect(page.getByRole('menu',{name:'Node actions',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Smooth node',exact:true}).click();
  expect(await page.evaluate(()=>{const s=(window as any).__vectora.objects[0].segments[1];return s.handleIn.length>0&&s.handleOut.length>0&&Math.abs(s.handleIn.cross(s.handleOut))<1e-8;})).toBe(true);
  await page.mouse.click(point.x,point.y,{button:'right'});await page.screenshot({path:'test-results/node-context-menu.png'});await page.getByRole('menuitem',{name:'Corner node',exact:true}).click();
  expect(await page.evaluate(()=>{const s=(window as any).__vectora.objects[0].segments[1];return s.handleIn.isZero()&&s.handleOut.isZero();})).toBe(true);
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await page.mouse.click(point.x,point.y,{button:'right'});await page.getByRole('menuitem',{name:'Split path',exact:true}).click();
  const split=await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>({closed:s.closed,length:s.segments.length,points:s.segments.map((n:any)=>[n.point.x,n.point.y])})));
  expect(split).toEqual([{closed:false,length:2,points:[[30,30],[70,60]]},{closed:false,length:2,points:[[70,60],[120,30]]}]);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  await page.evaluate(()=>{const e=(window as any).__vectora;e.selected.closed=true;e.moveSelectionToCutPath();});
  point=await nodePosition(page,1);await page.mouse.click(point.x,point.y,{button:'right'});await page.getByRole('menuitem',{name:'Split path',exact:true}).click();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0];return {count:e.objects.length,closed:s.closed,nodes:s.segments.length,ends:s.firstSegment.point.equals(s.lastSegment.point),role:s.data.role,color:s.strokeColor.toCSS(true)};})).toEqual({count:1,closed:false,nodes:4,ends:true,role:'cutline',color:'#ff0000'});
});

test('Node edits preserve joined contours, snap anchors and remove stale arc controls',async({page})=>{
  await page.goto(DEV);
  await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,{createCircularArc}=await import('/src/arc.ts');
    const arc=createCircularArc({cx:60,cy:60,radius:25,start:180,sweep:180});e.addShape(arc,'Arc');
  });
  await page.getByRole('button',{name:'Node editing',exact:true}).click();
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot()),point=await nodePosition(page,1);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+28,point.y+24);await page.mouse.up();
  expect(await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0],q=s.segments[1].point;return {arc:!!s.data.arc,x:q.x/e.grid.spacingMM,y:q.y/e.grid.spacingMM};})).toEqual({arc:false,x:7,y:4});
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,arc=e.objects[0];
    e.addShape(new p.Path({insert:false,segments:[[110,40],[135,60],[155,40]],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Line');e.select(arc,true);e.joinSelection();e.moveSelectionToCutPath();
  });
  const untouched=await page.evaluate(()=>(window as any).__vectora.selected.children[0].exportJSON());
  const middle=await nodePosition(page,1,'point',0,1);await page.mouse.click(middle.x,middle.y,{button:'right'});await page.getByRole('menuitem',{name:'Split path',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].children[0].exportJSON())).toEqual(untouched);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.every((s:any)=>s.data.role==='cutline'&&s.strokeColor.toCSS(true)==='#ff0000'))).toBe(true);
  await page.evaluate(()=>(window as any).__vectora.setLayerState('cutline','locked',true));
  const locked=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await page.mouse.click(middle.x,middle.y);await page.keyboard.press('Delete');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(locked);
});

test('Node editing protects editable text and handles endpoint deletion and split menu dismissal',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'BO');
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await page.getByRole('button',{name:'Node editing',exact:true}).click();await page.keyboard.press('Delete');
  expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.filter((s:any)=>s.data.control==='node').length)).toBe(0);
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({insert:false,segments:[[100,50],[140,80]],strokeColor:'#383838',strokeWidth:1.5}),'Line');});
  const endpoint=await nodePosition(page,0,'point',1);await page.mouse.click(endpoint.x,endpoint.y,{button:'right'});
  await expect(page.getByRole('menuitem',{name:'Split path',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Node actions',exact:true})).toBeHidden();
  await page.mouse.click(endpoint.x,endpoint.y);await page.keyboard.press('Delete');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});

test('Explode separates transformed joined contours without changing geometry, layers or other selections',async({page})=>{
  await page.goto(DEV);
  await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    const circle=new p.Path.Circle({center:[45,45],radius:20,insert:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});e.addShape(circle,'Circle');
    const curve=new p.Path({insert:false,segments:[new p.Segment([80,30],null,[25,0]),new p.Segment([110,70],[-20,0],null)],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});e.addShape(curve,'Curve');e.select(circle,true);e.joinSelection();e.moveSelectionToCutPath();
    const joined=e.selected;joined.applyMatrix=false;joined.rotate(27);joined.scale(1.3,0.8);
    const line=new p.Path({insert:false,segments:[[20,90],[70,110]],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});e.addShape(line,'Untouched line');e.select(joined,true);
  });
  const before=await page.evaluate(async()=>{const e=(window as any).__vectora,{documentPath}=await import('/src/deletion.ts'),compound=e.cutlines.children[0],snapshot=e.snapshot();snapshot.selectedIds.sort();return {snapshot,untouched:e.artwork.children[0].exportJSON(),paths:compound.children.map((c:any)=>{const p=documentPath(c),result={closed:p.closed,curves:p.curves.map((c:any)=>c.values)};p.remove();return result;})};});
  const explode=page.getByRole('button',{name:'Explode',exact:true});await expect(explode).toBeEnabled();await explode.click();
  const after=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,snapshot=e.snapshot();snapshot.selectedIds.sort();return {snapshot,untouched:e.artwork.children[0].exportJSON(),paths:e.cutlines.children.map((s:any)=>({closed:s.closed,curves:s.curves.map((c:any)=>c.values)})),valid:e.cutlines.children.every((s:any)=>s instanceof p.Path&&!s.data.joined&&!s.fillColor&&s.strokeColor.toCSS(true)==='#ff0000'),ids:e.objects.map((s:any)=>s.data.uid)};});
  expect(after.paths).toEqual(before.paths);expect(after.untouched).toEqual(before.untouched);expect(after.valid).toBe(true);expect(new Set(after.ids).size).toBe(3);
  await expect(page.locator('#selection-menu .selection-count')).toHaveText('3 selected');await expect(explode).toBeDisabled();await expect(page.locator('#properties-panel')).toBeHidden();
  await page.screenshot({path:'test-results/explode-selection.png'});
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>{const s=(window as any).__vectora.snapshot();s.selectedIds.sort();return s;})).toEqual(before.snapshot);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>{const s=(window as any).__vectora.snapshot();s.selectedIds.sort();return s;})).toEqual(after.snapshot);
});

test('Explode leaves editable text unchanged and separates compound inner outlines',async({page})=>{
  await page.goto(DEV);await typeCanvasText(page,'O');const explode=page.getByRole('button',{name:'Explode',exact:true});await expect(explode).toBeDisabled();
  const text=await page.evaluate(()=>(window as any).__vectora.selected.exportJSON());
  await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper,text=e.selected;
    const shape=new p.CompoundPath({insert:false,children:[new p.Path.Circle({center:[100,60],radius:22,insert:false}),new p.Path.Circle({center:[100,60],radius:12,insert:false})],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false});e.addShape(shape,'Ring');e.select(text,true);
  });
  await explode.click();expect(await page.evaluate(()=>(window as any).__vectora.objects[0].exportJSON())).toEqual(text);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);await expect(explode).toBeDisabled();
  const outer=await page.evaluate(()=>(window as any).__vectora.objects[1].exportJSON());
  await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[2]);e.setProperty('x',e.selectionBounds.x+15);});
  expect(await page.evaluate(()=>(window as any).__vectora.objects[1].exportJSON())).toEqual(outer);
});

test('Editor alerts use design-system cards with semantic icons, stacking and dismissal',async({page})=>{
  await page.goto(DEV);await page.clock.install();await page.locator('#cad-canvas').focus();
  await page.evaluate(()=>{const e=(window as any).__vectora;e.onMessage('Outline created.','success');e.onMessage('Unlock Artwork before drawing.','warning');e.onMessage('Export failed.',true);e.onMessage('Choose a path.');});
  const stack=page.getByRole('region',{name:'Alerts',exact:true});await expect(stack.locator('.toast-card')).toHaveCount(4);await expect(page.locator('#cad-canvas')).toBeFocused();
  for(const [kind,icon] of [['success','check'],['warning','warning'],['error','error'],['information','info']])await expect(stack.locator(`.toast-${kind} .toast-icon use`)).toHaveAttribute('href',`#i-${icon}`);
  const metrics=await stack.evaluate(element=>{const box=element.getBoundingClientRect(),card=element.querySelector('.toast-card')!,style=getComputedStyle(card),gutter=parseFloat(getComputedStyle(element).padding);return {right:innerWidth-box.right+gutter,bottom:innerHeight-box.bottom+gutter,width:box.width-gutter*2,padding:style.padding,borderRadius:style.borderRadius,bg:style.backgroundColor,gap:getComputedStyle(element).gap};});
  expect(metrics).toEqual({right:24,bottom:24,width:440,padding:'8px 12px',borderRadius:'0px',bg:'rgb(42, 43, 46)',gap:'8px'});
  await page.clock.fastForward(1000);await expect(stack.locator('.toast-card')).toHaveCount(4);
  await page.evaluate(()=>(window as any).__vectora.onMessage('Latest export error.',true));await expect(stack.locator('.toast-card')).toHaveCount(4);await expect(stack.locator('.toast-card').last()).toHaveAttribute('data-toast-kind','error');
  await expect(page.locator('#toast-error-announcement')).toHaveAttribute('role','alert');await expect(page.locator('#toast-error-announcement')).toContainText('Latest export error.');
  await expect(page.locator('#toast-announcement')).toHaveAttribute('role','status');
  await page.screenshot({path:'test-results/editor-alerts.png',animations:'disabled'});
  await stack.getByRole('button',{name:'Dismiss error alert',exact:true}).focus();await page.keyboard.press('Escape');await expect(stack.locator('.toast-error')).toHaveCount(0);await expect(page.locator('#cad-canvas')).toBeFocused();
  for(const kind of ['success','warning','information'])await stack.getByRole('button',{name:`Dismiss ${kind} alert`,exact:true}).click();await expect(stack).toBeHidden();
});

test('Alert cards remain within narrow screens and treat messages as plain text',async({page})=>{
  await page.setViewportSize({width:420,height:600});await page.goto(DEV);
  await page.evaluate(()=>(window as any).__vectora.onMessage('<img src=x onerror=alert(1)> '+ 'Long message '.repeat(12),true));
  const card=page.locator('.toast-error');await expect(card.locator('img')).toHaveCount(0);await expect(card.locator('p')).toContainText('<img src=x');
  await card.evaluate(element=>element.getAnimations().forEach(animation=>animation.finish()));
  const box=(await card.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(16);expect(box.x+box.width).toBeLessThanOrEqual(404);expect(box.y+box.height).toBeLessThanOrEqual(584);
  await card.getByRole('button',{name:'Dismiss error alert',exact:true}).click();await expect(card).toHaveCount(0);
});


test('Alerts auto-dismiss after five seconds, restart on update and cancel stale timers',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(DEV);await page.clock.install({time:new Date('2026-09-26T12:00:00Z')});await page.clock.pauseAt(new Date('2026-09-26T12:00:01Z'));await page.locator('#cad-canvas').focus();
  await page.evaluate(()=>{const e=(window as any).__vectora;for(const kind of ['success','warning','error','information'])e.onMessage(kind,kind);});
  const cards=page.locator('.toast-stack .toast-card');await expect(cards).toHaveCount(4);
  await page.clock.runFor(4000);await expect(cards).toHaveCount(4);
  await page.evaluate(()=>(window as any).__vectora.onMessage('Updated error','error'));
  await page.clock.runFor(999);await expect(cards).toHaveCount(4);
  await page.clock.runFor(1);await expect(cards).toHaveCount(1);await expect(cards).toContainText('Updated error');await expect(page.locator('#cad-canvas')).toBeFocused();
  await page.clock.runFor(3999);await expect(cards).toHaveCount(1);await page.getByRole('button',{name:'Dismiss error alert',exact:true}).focus();
  await page.clock.runFor(1);await expect(cards).toHaveCount(0);await expect(page.locator('#cad-canvas')).toBeFocused();
  await page.evaluate(()=>(window as any).__vectora.onMessage('Old error','error'));await page.clock.runFor(2000);await page.getByRole('button',{name:'Dismiss error alert',exact:true}).click();
  await page.evaluate(()=>(window as any).__vectora.onMessage('New error','error'));await page.clock.runFor(3000);await expect(cards).toContainText('New error');await page.clock.runFor(2000);await expect(cards).toHaveCount(0);
});


test('Notifications animate in and out and an update during exit revives the card',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(DEV);await page.clock.install({time:new Date('2026-09-26T12:00:00Z')});await page.clock.pauseAt(new Date('2026-09-26T12:00:01Z'));
  await page.evaluate(()=>(window as any).__vectora.onMessage('First message','information'));
  const card=page.locator('.toast-information');await expect(card).toHaveCSS('animation-name','toast-in');await expect(card).toHaveCSS('animation-duration','0.24s');
  await page.clock.runFor(5000);await expect(card).toHaveClass(/is-leaving/);await expect(card).toHaveCSS('animation-name','toast-out');await expect(card).toHaveCSS('animation-duration','0.18s');await expect(card).toHaveAttribute('inert','');
  await page.clock.runFor(90);await page.evaluate(()=>(window as any).__vectora.onMessage('Updated while leaving','information'));await expect(card).not.toHaveClass(/is-leaving/);await expect(card).not.toHaveAttribute('inert','');
  await page.clock.runFor(90);await expect(card).toHaveCount(1);await expect(card).toContainText('Updated while leaving');
  await page.clock.runFor(4910);await expect(card).toHaveClass(/is-leaving/);await page.clock.runFor(179);await expect(card).toHaveCount(1);await page.clock.runFor(1);await expect(card).toHaveCount(0);
  await page.evaluate(()=>(window as any).__vectora.onMessage('Manual dismissal','information'));await card.getByRole('button').dispatchEvent('click');await expect(card).toHaveClass(/is-leaving/);await page.clock.runFor(180);await expect(card).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>(window as any).__vectora.onMessage('Reduced motion','information'));await expect(card).toHaveCSS('animation-name','none');await card.getByRole('button').click();await expect(card).toHaveCount(0);
});

test('Notification animation never scrolls or clips a stack that fits the viewport',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(DEV);
  const frames=await page.evaluate(()=>{
    const editor=(window as any).__vectora,stack=document.querySelector<HTMLElement>('.toast-stack')!;
    editor.onMessage('There are no cut lines. Create a Sticker Outline or enable “Include artwork”.','error');
    const card=stack.querySelector<HTMLElement>('.toast-card')!,animation=card.getAnimations()[0];animation.pause();
    return [0,60,120,180,240].map(time=>{animation.currentTime=time;const box=card.getBoundingClientRect(),clip=stack.getBoundingClientRect();return {time,scrollTop:stack.scrollTop,top:box.top-clip.top,bottom:clip.bottom-box.bottom};});
  });
  for(const frame of frames){expect(frame.scrollTop,`scroll at ${frame.time}ms`).toBe(0);expect(frame.top,`top at ${frame.time}ms`).toBeGreaterThanOrEqual(0);expect(frame.bottom,`bottom at ${frame.time}ms`).toBeGreaterThanOrEqual(0);}
});
