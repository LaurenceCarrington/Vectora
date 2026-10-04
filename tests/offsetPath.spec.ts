import {test,expect,Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function setup(page:Page){await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('cutline');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,40,30]}),'Panel');});}
const snapshot=(page:Page)=>page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
async function open(page:Page){await page.locator('[data-offset-open]').click();await expect(page.getByRole('dialog',{name:'Offset path',exact:true})).toBeVisible();}

test('Live offset preserves the original, creates on its layer and supports one-step undo',async({page})=>{
 await setup(page);const before=await snapshot(page);await open(page);await page.getByLabel('Distance', {exact:true}).fill('2.5');await page.getByLabel('Corners',{exact:true}).selectOption('sharp');expect(await snapshot(page)).toBe(before);
 await page.getByRole('button',{name:'Create offset',exact:true}).click();const result=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {count:e.objects.length,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height].map(n=>Number(n.toFixed(8))),layer:s.layer.data.documentId,fill:s.fillColor,color:s.strokeColor.toCSS(true),original:[e.objects[0].bounds.x,e.objects[0].bounds.width]};});expect(result).toEqual({count:2,bounds:[17.5,17.5,45,35],layer:'cutline',fill:null,color:'#ff0000',original:[20,40]});await expect(page.locator('#properties-panel')).toBeHidden();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});

test('Inward offsets preserve nested holes, support transformed contours and fail safely on collapse',async({page})=>{
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();const ring=new p.CompoundPath({insert:false,children:[new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40]}),new p.Path.Rectangle({insert:false,rectangle:[10,10,20,20]})],fillRule:'evenodd'});ring.applyMatrix=false;ring.matrix=new p.Matrix(2,0,0,1,20,20);e.addShape(ring,'Frame');});const before=await snapshot(page);await open(page);await page.getByLabel('Direction',{exact:true}).selectOption('inward');await page.getByLabel('Corners',{exact:true}).selectOption('sharp');await page.getByLabel('Distance',{exact:true}).fill('30');await expect(page.getByRole('button',{name:'Create offset'})).toBeDisabled();expect(await snapshot(page)).toBe(before);await page.getByLabel('Distance',{exact:true}).fill('2');await page.getByRole('button',{name:'Create offset'}).click();const r=await page.evaluate(()=>{const s=(window as any).__vectora.selected,p=(window as any).__paper;return {bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height].map(n=>Number(n.toFixed(8))),contours:s.children.length,inside:[[23,40],[39,40],[60,40]].map(q=>s.contains(new p.Point(q)))};});expect(r).toEqual({bounds:[22,22,76,36],contours:2,inside:[true,false,false]});
});

test('Round, sharp and bevel joins have distinct correct corner geometry',async({page})=>{
 await setup(page);const r=await page.evaluate(async()=>{const {createPathOffset,initializeClipper}=await import('/src/clipperService.ts');await initializeClipper();const e=(window as any).__vectora;return ['round','sharp','bevel'].map(corners=>{const s=createPathOffset(e.selected,{distance:2,direction:'outward',corners} as any);const value={area:Number(Math.abs(s.area).toFixed(8)),points:s.segments.length};s.remove();return value;});});expect(r[0].area).toBeCloseTo(1200+280+Math.PI*4,0);expect(r[1]).toEqual({area:1496,points:4});expect(r[2]).toEqual({area:1488,points:8});
});

test('Cancel, invalid input and unavailable selections never change the document',async({page})=>{
 await setup(page);const before=await snapshot(page);await open(page);await page.getByLabel('Distance',{exact:true}).fill('0');await expect(page.getByRole('button',{name:'Create offset'})).toBeDisabled();await page.keyboard.press('Escape');expect(await snapshot(page)).toBe(before);await open(page);await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await snapshot(page)).toBe(before);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.selected.closed=false;e.select(e.selected);});await expect(page.locator('[data-offset-open]')).toBeDisabled();
});

test('Select path picks a source on the canvas without moving it, then returns to Offset path',async({page})=>{
 await setup(page);
 const target=await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const first=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[100,20,40,30]}),'Second panel');
  const point=p.view.projectToView(first.bounds.topCenter),rect=e.canvas.getBoundingClientRect();
  return {x:rect.left+point.x,y:rect.top+point.y};
 });
 const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.objects.map((item:any)=>item.exportJSON())));
 await open(page);await page.getByRole('button',{name:'Select path'}).click();
 await expect(page.locator('#offset-dialog')).toBeHidden();
 await page.mouse.click(target.x,target.y);
 await expect(page.locator('#offset-dialog')).toBeVisible();
 await expect(page.locator('[data-offset-source]')).toContainText('Panel');
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.objects.map((item:any)=>item.exportJSON())))).toBe(before);
 await page.getByRole('button',{name:'Create offset'}).click();
 expect(await page.evaluate(()=>Number((window as any).__vectora.selected.bounds.x.toFixed(2)))).toBe(18);
});

test('Offset path opens without a selection and Escape cancels Select path mode',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).__vectora.select(null));
 await page.getByRole('button',{name:'Search tools'}).click();await page.getByRole('combobox',{name:'Search tools'}).fill('offset path');await page.keyboard.press('Enter');
 await expect(page.locator('#offset-dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Create offset'})).toBeDisabled();
 await page.getByRole('button',{name:'Select path'}).click();await page.keyboard.press('Escape');
 await expect(page.locator('#offset-dialog')).toBeHidden();
 const target=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,r=e.canvas.getBoundingClientRect(),q=p.view.projectToView(e.objects[0].bounds.topCenter);return {x:r.left+q.x,y:r.top+q.y};});
 await page.mouse.click(target.x,target.y);await expect(page.locator('#offset-dialog')).toBeHidden();
});

test('Cancelling Select path keeps the previous selection',async({page})=>{
 await setup(page);
 const selected=await page.evaluate(()=>(window as any).__vectora.selected.data.uid);
 await open(page);await page.getByRole('button',{name:'Select path'}).click();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>(window as any).__vectora.selected.data.uid)).toBe(selected);
});

test('Context menu omits Offset path; tool search and responsive panel remain available',async({page})=>{
 await setup(page);const pt=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,r=e.canvas.getBoundingClientRect(),q=p.view.projectToView(e.selected.bounds.center);return {x:r.left+q.x,y:r.top+q.y};});await page.mouse.click(pt.x,pt.y,{button:'right'});const menu=page.getByRole('menu',{name:'Selection actions',exact:true});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Offset path',exact:true})).toHaveCount(0);await expect(menu.getByRole('menuitem',{name:'Copy',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await expect(menu.getByRole('menuitem',{name:'Layer',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await page.getByRole('button',{name:'Search tools',exact:true}).click();await page.getByRole('combobox',{name:'Search tools'}).fill('offset path');await page.keyboard.press('Enter');await expect(page.locator('#offset-dialog')).toBeVisible();
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);for(const size of [{width:390,height:700},{width:900,height:350}]){await page.setViewportSize(size);await expect(page.getByRole('button',{name:'Create offset'})).toBeInViewport();const b=await page.locator('#offset-dialog').boundingBox();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.y).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(size.width);await page.screenshot({path:`test-results/offset-${theme}-${size.width}.png`});}}
});

test('Joined unfilled contours retain holes, while filled nonzero compounds retain their solid area',async({page})=>{
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,40,40]}),'Outer');const outer=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[30,30,20,20]}),'Inner');e.select(outer,true);e.joinSelection();});
 await open(page);await page.getByLabel('Corners',{exact:true}).selectOption('sharp');await page.getByRole('button',{name:'Create offset'}).click();expect(await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {count:e.selected.children.length,hole:e.selected.contains(new p.Point(40,40))};})).toEqual({count:2,hole:false});
 const solid=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{createPathOffset}=await import('/src/clipperService.ts');const source=e.objects[0];source.fillColor='red';source.fillRule='nonzero';const result=createPathOffset(source,{distance:2,direction:'outward',corners:'sharp'});const inside=result.contains(new p.Point(40,40));result.remove();return inside;});expect(solid).toBe(true);
});

test('Multiple layers offset atomically, remain exportable and survive saving',async({page})=>{
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=e.selected;e.setActiveLayer('engrave');e.addShape(new p.Path.Circle({insert:false,center:[90,40],radius:10}),'Circle');e.select(a,true);});const before=await snapshot(page);await open(page);await page.getByRole('button',{name:'Create offset'}).click();
 const r=await page.evaluate(async()=>{const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts'),{exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts');const layers=e.selectedItems.map((s:any)=>s.layer.data.documentId).sort(),json=encodeDocument(e),svg=exportSVG(e.objects),dxf=exportDXF(e.objects,true),count=e.objects.length;const parsed=await decodeDocument(json);return {layers,count,svg,dxf,saved:JSON.stringify(parsed.snapshot).includes('offset')};});expect(r.layers).toEqual(['cutline','engrave']);expect(r.count).toBe(4);expect(r.saved).toBe(true);expect(r.svg).toContain('<path');expect(r.dxf).toContain('LWPOLYLINE');await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);
 await open(page);await page.getByLabel('Direction',{exact:true}).selectOption('inward');await page.getByLabel('Distance',{exact:true}).fill('11');await expect(page.getByRole('button',{name:'Create offset'})).toBeDisabled();expect(await snapshot(page)).toBe(before);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#offset-dialog')).not.toBeVisible();expect(await snapshot(page)).toBe(before);expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.some((c:any)=>c.data.role==='offset-preview'))).toBe(false);
});

test('Offsets reject coordinate overflow and bevel acute corners with a single straight edge',async({page})=>{
 await setup(page);const result=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{createPathOffset,initializeClipper}=await import('/src/clipperService.ts');await initializeClipper();const triangle=new p.Path({insert:false,closed:true,segments:[[0,0],[40,0],[20,2]]});e.addShape(triangle,'Triangle');const bevel=createPathOffset(triangle,{distance:2,direction:'outward',corners:'bevel'});const points=bevel.segments.length;bevel.remove();e.newDocument();e.addShape(new p.Path.Rectangle({insert:false,rectangle:[999990,20,9,20]}),'Limit');let error='';try{createPathOffset(e.selected,{distance:5,direction:'outward',corners:'sharp'});}catch(e){error=(e as Error).message;}return {points,error};});expect(result.points).toBe(6);expect(result.error).toContain('coordinate range');
});

test('Production Offset action and design-system specimen use matching accessible controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.locator('#primary-shapes-menu [data-shape="Rectangle"]').click();await page.mouse.move(400,250);await page.mouse.down();await page.mouse.move(550,400,{steps:3});await page.mouse.up();await open(page);await page.getByRole('button',{name:'Create offset'}).click();await expect(page.locator('.selection-count')).toHaveText('1 selected');await page.keyboard.press('Control+z');await expect(page.locator('.selection-count')).toHaveText('1 selected');
 await page.goto(DEV+'/reference/design-system.html');await page.locator('#floating-menu [data-offset-open]').click();await expect(page.getByRole('dialog',{name:'Offset path',exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByLabel('Corners',{exact:true})).toBeVisible();await page.keyboard.press('Escape');expect(errors).toEqual([]);
});
