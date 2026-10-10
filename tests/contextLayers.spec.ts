import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');}
async function openShape(page:Page){
 const point=await page.evaluate(()=>{const p=(window as any).__paper,v=p.view.projectToView(new p.Point(50,40));return {x:v.x,y:v.y};});
 await page.mouse.click(point.x,point.y,{button:'right'});
 return page.getByRole('menu',{name:'Selection actions',exact:true});
}

test('Smooth pop-out changes selected geometry live, preserves corners and endpoints and groups slider history',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;const path=new p.Path({insert:false,segments:[[40,40],[43,40.6],[46,39.4],[49,40.6],[52,40],[60,40],[60,60]],strokeColor:'#123456'});e.addShape(path,'Jagged');e.setLineWeight(.8);e.setLineDesign('dashed');e.setTool('select');});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 const menu=await openShape(page);await menu.getByRole('menuitem',{name:'Smooth',exact:true}).click();
 const popout=page.getByRole('dialog',{name:'Smooth selected objects',exact:true});await expect(popout).toBeVisible();
 expect(await popout.evaluate(el=>el.tagName)).toBe('DIV');expect(await popout.getAttribute('aria-modal')).not.toBe('true');
 const strength=popout.getByRole('slider',{name:'Smoothing strength'}),detail=popout.getByRole('slider',{name:'Detail reduction'});
 await expect(detail).toBeVisible();await expect(strength).toHaveValue('0');
 await strength.evaluate((el:HTMLInputElement)=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});
 const live=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {json:s.exportJSON({asString:true}),first:[s.firstSegment.point.x,s.firstSegment.point.y],last:[s.lastSegment.point.x,s.lastSegment.point.y],corners:s.segments.filter((v:any)=>v.point.equals([60,40])).map((v:any)=>[v.handleIn.length,v.handleOut.length]),closed:s.closed,dash:s.dashArray,weight:s.strokeWidth};});
 expect(live.first).toEqual([40,40]);expect(live.last).toEqual([60,60]);expect(live.corners).toHaveLength(1);expect(live.closed).toBe(false);expect(live.dash.length).toBeGreaterThan(0);expect(live.weight).toBe(.8);
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).not.toEqual(before);
 await strength.evaluate((el:HTMLInputElement)=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await strength.evaluate((el:HTMLInputElement)=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 const after=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await popout.getByRole('button',{name:'Close Smooth'}).click();await expect(popout).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after);
});

test('Smooth Escape cancels only an unfinished adjustment and Undo works from its sliders',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({insert:false,segments:[[40,40],[45,41],[50,39],[55,41],[60,40]]}),'Jagged');e.setTool('select');});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true}),strength=panel.getByRole('slider',{name:'Smoothing strength'});
 await strength.evaluate((el:HTMLInputElement)=>{el.value='60';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 const completed=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await strength.evaluate((el:HTMLInputElement)=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.keyboard.press('Escape');
 await expect(panel).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(completed);
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();await page.keyboard.press('Control+z');
 await expect(panel).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Smooth menu can move without changing geometry, retains placement during edits and cancels unfinished drags',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({insert:false,segments:[[40,40],[45,41],[50,39],[55,41],[60,40]]}),'Jagged');e.setTool('select');});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();
 const history=await page.evaluate(()=>(window as any).__vectora.captureSession().undo.length);
 const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true}),handle=panel.getByRole('button',{name:'Move Smooth menu',exact:true}),start=(await panel.boundingBox())!;
 await expect(handle).toBeVisible();const grip=(await handle.boundingBox())!,x=grip.x+grip.width/2,y=grip.y+grip.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+130,y-90,{steps:8});await page.mouse.up();let moved=(await panel.boundingBox())!;
 expect(moved.x).toBeCloseTo(start.x+130);expect(moved.y).toBeCloseTo(start.y-90);expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await handle.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');moved=(await panel.boundingBox())!;expect(moved.x).toBeCloseTo(start.x+132);expect(moved.y).toBeCloseTo(start.y-80);
 const next=(await handle.boundingBox())!;await page.mouse.move(next.x+20,next.y+10);await page.mouse.down();await page.mouse.move(2,2,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();await expect(panel).toBeVisible();expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x);expect((await panel.boundingBox())!.y).toBeCloseTo(moved.y);
 for(const event of ['pointercancel','lostpointercapture']){
  const grip=(await handle.boundingBox())!;await page.mouse.move(grip.x+20,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+70,grip.y+40,{steps:3});await handle.evaluate((el,event)=>el.parentElement!.dispatchEvent(new PointerEvent(event,{pointerId:1})),event);await page.mouse.up();await expect(panel).toBeVisible();expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x);expect((await panel.boundingBox())!.y).toBeCloseTo(moved.y);
 }
 expect(await page.evaluate(()=>(window as any).__vectora.captureSession().undo.length)).toBe(history);
 await panel.getByRole('slider',{name:'Smoothing strength'}).evaluate((el:HTMLInputElement)=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x);expect((await panel.boundingBox())!.y).toBeCloseTo(moved.y);const after=await page.evaluate(()=>(window as any).__vectora.snapshot());expect(after).not.toEqual(before);
 await panel.getByRole('button',{name:'Close Smooth',exact:true}).click();await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x);expect((await panel.boundingBox())!.y).toBeCloseTo(moved.y);
 await page.setViewportSize({width:420,height:450});await expect.poll(async()=>{const r=(await panel.boundingBox())!;return r.x>=0&&r.y>=0&&r.x+r.width<=420&&r.y+r.height<=450;}).toBe(true);await panel.getByRole('button',{name:'Close Smooth',exact:true}).click();
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Smooth design reference uses the same movable header and keyboard controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(DEV+'/reference/design-system.html');
 const panel=page.getByRole('dialog',{name:'Smooth selected objects specimen',exact:true}),handle=panel.getByRole('button',{name:'Move Smooth menu',exact:true});await handle.scrollIntoViewIfNeeded();const start=(await panel.boundingBox())!,grip=(await handle.boundingBox())!;
 await page.mouse.move(grip.x+20,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+120,grip.y-60,{steps:6});await page.mouse.up();await expect(panel).toHaveClass(/is-positioned/);expect((await panel.boundingBox())!.x).toBeCloseTo(start.x+100);
 const moved=(await panel.boundingBox())!;await handle.focus();await page.keyboard.press('Shift+ArrowLeft');expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x-10);await page.screenshot({path:'test-results/smooth-movable-reference.png'});
 await panel.getByRole('button',{name:'Close Smooth specimen',exact:true}).click();await expect(panel).toBeHidden();expect(errors).toEqual([]);
});

test('Smooth preserves transformed compound holes and styles, leaves unrelated objects alone and restores the baseline',async({page})=>{
 await ready(page);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;
  const outer=new p.Path({insert:false,closed:true,segments:[[40,30],[45,30.4],[50,29.5],[55,30.4],[60,30],[70,30],[70,65],[40,65]]});
  const hole=new p.Path.Circle({insert:false,center:[55,48],radius:6});hole.reverse();const shape=new p.CompoundPath({insert:false,children:[outer,hole],fillColor:'#64aab5',fillRule:'evenodd',opacity:.4});
  shape.applyMatrix=false;shape.rotate(24);shape.scale(1.3,.8);e.addShape(shape,'Compound');e.moveSelectionToLayer('cutline');const selected=e.selected;e.setLineWeight(.7);e.setLineDesign('dotted');e.addShape(new p.Path.Rectangle({rectangle:[100,35,20,20],insert:false}),'Unrelated');e.select(selected);e.setTool('select');
  const s=e.selected;return {snapshot:e.snapshot(),hole:s.children[1].exportJSON({asString:true}),other:e.objects.find((v:any)=>v.data.name==='Unrelated').exportJSON({asString:true}),style:JSON.stringify({stroke:s.strokeColor?.toCSS(true),fill:s.fillColor?.toCSS(true),weight:s.strokeWidth,scale:s.strokeScaling,dash:s.dashArray,cap:s.strokeCap,rule:s.fillRule,opacity:s.opacity,matrix:s.matrix.values}),data:JSON.stringify(s.data),first:s.children[0].localToGlobal(s.children[0].firstSegment.point).toString(),last:s.children[0].closed};});
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true});
 await panel.getByRole('slider',{name:'Smoothing strength'}).evaluate((el:HTMLInputElement)=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 const after=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {snapshot:e.snapshot(),hole:s.children[1].exportJSON({asString:true}),other:e.objects.find((v:any)=>v.data.name==='Unrelated').exportJSON({asString:true}),style:JSON.stringify({stroke:s.strokeColor?.toCSS(true),fill:s.fillColor?.toCSS(true),weight:s.strokeWidth,scale:s.strokeScaling,dash:s.dashArray,cap:s.strokeCap,rule:s.fillRule,opacity:s.opacity,matrix:s.matrix.values}),data:JSON.stringify(s.data),closed:s.children.map((p:any)=>p.closed)};});
 expect(after.snapshot).not.toEqual(before.snapshot);expect(after.hole).toBe(before.hole);expect(after.other).toBe(before.other);expect(after.style).toBe(before.style);expect(after.data).toBe(before.data);expect(after.closed).toEqual([true,true]);
 await panel.getByRole('slider',{name:'Smoothing strength'}).evaluate((el:HTMLInputElement)=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before.snapshot);
});

test('Smooth detail reduction removes noise, fits themes and narrow windows, and locked paths cannot be edited',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({insert:false,segments:Array.from({length:41},(_,i)=>[40+i,40+Math.sin(i)*.3])}),'Noise');e.setTool('select');});
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 const detail=panel.getByRole('slider',{name:'Detail reduction'});await detail.fill('0.5');await detail.dispatchEvent('input');await detail.dispatchEvent('change');
 expect(await page.evaluate(()=>(window as any).__vectora.selected.segments.length)).toBeLessThan(15);
 await detail.fill('0');await detail.dispatchEvent('input');await detail.dispatchEvent('change');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 for(const [theme,width] of [['light',1280],['dark',1280],['high-contrast',420]] as const){
  await page.setViewportSize({width,height:700});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;(window as any).__vectora.refreshTheme();},theme);await expect(panel).toBeVisible();const box=(await panel.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(700);await page.screenshot({path:`test-results/smooth-${theme}.png`});
 }
 await page.evaluate(()=>(window as any).__vectora.setLayerState('artwork','locked',true));await expect(panel).toBeHidden();await page.mouse.click(250,300,{button:'right'});await expect(page.getByRole('menuitem',{name:'Smooth',exact:true})).toBeDisabled();
});

test('Smooth keeps polygon corners, exact circular arcs and compound hole nesting',async({page})=>{
 await ready(page);
 const original=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;
  const outer=new p.Path({insert:false,closed:true,segments:Array.from({length:16},(_,i)=>{const radius=20+.12*Math.sin(i*3);return [50+radius*Math.cos(i*Math.PI/8),40+radius*Math.sin(i*Math.PI/8)];})});
  const hole=new p.Path.Circle({insert:false,center:[50,40],radius:19.2});hole.reverse();e.addShape(new p.CompoundPath({insert:false,children:[outer,hole],fillColor:'#123456',fillRule:'evenodd'}),'Ring');const ring=e.selected;
  const polygon=new p.Path.RegularPolygon({insert:false,center:[110,40],sides:8,radius:20});polygon.data.sides=8;e.addShape(polygon,'Polygon');const selected=e.selected;
  e.addShape(new p.Path.Arc({insert:false,from:[140,40],through:[150,30],to:[160,40]}),'Arc');e.selected.data.arc={cx:150,cy:40,radius:10,start:180,sweep:180};e.select(ring,true);e.select(selected,true);e.setTool('select');
  return {polygon:selected.exportJSON({asString:true}),arc:e.objects.find((s:any)=>s.data.name==='Arc').exportJSON({asString:true}),holes:[ring.contains([50,55]),ring.contains([50,59.6])],self:outer.getIntersections(outer).length};});
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true});
 await panel.getByRole('slider',{name:'Smoothing strength'}).evaluate((el:HTMLInputElement)=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,ring=e.objects.find((s:any)=>s.data.name==='Ring');return {polygon:e.objects.find((s:any)=>s.data.name==='Polygon').exportJSON({asString:true}),arc:e.objects.find((s:any)=>s.data.name==='Arc').exportJSON({asString:true}),holes:[ring.contains([50,55]),ring.contains([50,59.6])],self:ring.children[0].getIntersections(ring.children[0]).length};});
 expect(result.polygon).toBe(original.polygon);expect(result.arc).toBe(original.arc);expect(result.holes).toEqual(original.holes);expect(result.self).toBe(original.self);
});

test('Smooth preserves joined metadata-free circular arcs and saved small circles',async({page})=>{
 await ready(page);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,arc=new p.Path.Arc({insert:false,from:[40,40],through:[50,30],to:[60,40]}),circle=new p.Path.Circle({insert:false,center:[100.123456789123,70.123456789123],radius:.01});
  const saved=p.project.importJSON(circle.exportJSON({asString:true,precision:12}));saved.remove();circle.remove();e.addShape(new p.CompoundPath({insert:false,children:[arc,saved]}),'Precise contours');e.setTool('select');return e.snapshot();});
 await (await openShape(page)).getByRole('menuitem',{name:'Smooth',exact:true}).click();const panel=page.getByRole('dialog',{name:'Smooth selected objects',exact:true});
 for(const name of ['Smoothing strength','Detail reduction'])await panel.getByRole('slider',{name}).evaluate((el:HTMLInputElement)=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Smooth keeps a large joined object responsive without allocating every contour pair',async({page})=>{
 await ready(page);
 const timing=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;
  const circles=Array.from({length:3000},(_,i)=>new p.Path.Circle({insert:false,center:[40+(i%60)*2,40+Math.floor(i/60)*2],radius:.4}));
  const noise=new p.Path({insert:false,segments:Array.from({length:41},(_,i)=>[40+i,35+Math.sin(i)*.3])});e.addShape(new p.CompoundPath({insert:false,children:[...circles,noise]}),'Large joined object');e.setTool('select');
  const start=performance.now();e.smoothing.open({x:300,y:250});const open=performance.now()-start,topologySize=e.smoothing.sources[0].topology.length;
  const slider=document.querySelector('#smooth-strength') as HTMLInputElement;const updateStart=performance.now();slider.value='100';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));return {open,update:performance.now()-updateStart,topologySize};});
 expect(timing.topologySize).toBeLessThan(150000);expect(timing.open).toBeLessThan(1500);expect(timing.update).toBeLessThan(1500);
});

test('Context layer markers keep custom colours and follow appearance changes',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[40,30,30,25],insert:false}),'First');const first=e.selected,layer=e.addDocumentLayer('artwork',true);e.renameDocumentLayer(layer.data.documentId,'Custom ink');e.setDocumentLayerColour(layer.data.documentId,'#123456');e.select(first);});
 const menu=await openShape(page);await menu.getByRole('menuitem',{name:'Layer',exact:true}).click();const layers=menu.getByRole('menu',{name:'Move to layer'});
 for(const [theme,colour] of [['dark','rgb(255, 255, 255)'],['light','rgb(56, 56, 56)'],['high-contrast','rgb(56, 56, 56)']]){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;(window as any).__vectora.refreshTheme();},theme);
  await expect(layers.getByRole('menuitemradio',{name:'Artwork',exact:true}).locator('.layer-dot')).toHaveCSS('background-color',colour);
  await expect(layers.getByRole('menuitemradio',{name:'Custom ink',exact:true}).locator('.layer-dot')).toHaveCSS('background-color','rgb(18, 52, 86)');
 }
});

test('Context Layer lists document layers, protects blocked targets and moves the selection with undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[40,30,30,25],insert:false,strokeColor:'white'}),'First');const first=e.selected;e.addShape(new p.Path.Circle({center:[100,40],radius:10,insert:false,strokeColor:'white'}),'Second');e.select(first,true);e.setLayerState('engrave','locked',true);e.setLayerState('construction','visible',false);const custom=e.addDocumentLayer('artwork');custom.name='Custom <safe> layer';e.select(first);e.select(e.objects.find((s:any)=>s.data.name==='Second'),true);});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());const menu=await openShape(page);await menu.getByRole('menuitem',{name:'Layer',exact:true}).click();
 const layers=menu.getByRole('menu',{name:'Move to layer'});await expect(layers.getByRole('menuitemradio')).toHaveCount(6);
 await expect(layers.getByRole('menuitemradio',{name:'Artwork',exact:true})).toHaveAttribute('aria-checked','true');
 await expect(layers.getByRole('menuitemradio',{name:'Artwork',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Engrave Path',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Construction Path',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Custom <safe> layer',exact:true})).toBeEnabled();expect(await layers.locator('safe').count()).toBe(0);
 await layers.getByRole('menuitemradio',{name:'Cut Path',exact:true}).click();await expect(menu).toBeHidden();
 const state=await page.evaluate(()=>{const e=(window as any).__vectora;return {selection:e.selectedItems.length,objects:e.objects.map((s:any)=>({role:s.data.role,color:s.strokeColor.toCSS(true),name:s.data.name,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]}))};});
 expect(state.selection).toBe(2);expect(state.objects).toEqual([{role:'cutline',color:'#ff0000',name:'First',bounds:[40,30,30,25]},{role:'cutline',color:'#ff0000',name:'Second',bounds:[90,30,20,20]}]);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);expect(errors).toEqual([]);
});

test('Layer dropdown stays on canvas, scrolls long lists and supports keyboard access in Light mode',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('vectora.theme','light'));await ready(page);await page.setViewportSize({width:420,height:650});
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[40,30,30,25],insert:false,strokeColor:'#383838'}),'Rectangle');const selected=e.selected;for(let i=0;i<18;i++)e.addDocumentLayer('engrave');e.select(selected);});
 await page.mouse.click(350,500,{button:'right'});const menu=page.getByRole('menu',{name:'Selection actions',exact:true}),trigger=menu.getByRole('menuitem',{name:'Layer',exact:true});await trigger.focus();await page.keyboard.press('ArrowRight');
 const layers=menu.getByRole('menu',{name:'Move to layer'});await expect(layers).toBeVisible();await expect(layers.getByRole('menuitemradio',{name:'Cut Path',exact:true})).toBeFocused();
 let r=(await menu.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(64);expect(r.x+r.width).toBeLessThanOrEqual(376);expect(r.y).toBeGreaterThanOrEqual(88);expect(r.y+r.height).toBeLessThanOrEqual(602);
 await page.keyboard.press('End');await expect(layers.getByRole('menuitemradio',{name:'Engrave Path 19',exact:true})).toBeFocused();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.wheel(0,-100);await expect(menu).toBeVisible();await page.keyboard.press('ArrowLeft');await expect(layers).toBeHidden();await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await page.keyboard.press('Home');await page.screenshot({path:'test-results/context-layers-light.png'});await page.keyboard.press('Escape');await expect(layers).toBeHidden();await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await page.evaluate(()=>(window as any).__vectora.select(null));await page.mouse.click(350,500,{button:'right'});await expect(trigger).toBeDisabled();
});
