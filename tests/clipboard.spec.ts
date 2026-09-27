import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');}
async function count(page:Page){return page.evaluate(()=>(window as any).__vectora.objects.length);}

test('Keyboard clipboard preserves a group independently of its source, with one-step undo and repeated offsets',async({page})=>{
 await ready(page);
 const original=await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const curve=new p.Path({segments:[[30,30],[55,45],[70,30]],insert:false});curve.segments[1].handleIn=[-7,-9];curve.segments[1].handleOut=[8,6];e.addShape(curve,'Curve');
  const circle=new p.Path.Circle({center:[90,40],radius:10,insert:false});e.addShape(circle,'Circle');e.select(curve,true);
  return e.selectedItems.map((s:any)=>({uid:s.data.uid,name:s.data.name,x:s.bounds.x,y:s.bounds.y,width:s.bounds.width,height:s.bounds.height}));
 });
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+c');expect(await count(page)).toBe(2);
 await page.keyboard.press('Delete');expect(await count(page)).toBe(0);
 await page.keyboard.press('Control+v');expect(await count(page)).toBe(2);
 const pasted=await page.evaluate(()=>{const e=(window as any).__vectora;return e.selectedItems.map((s:any)=>({uid:s.data.uid,name:s.data.name,x:s.bounds.x,y:s.bounds.y,width:s.bounds.width,height:s.bounds.height}));});
 for(let i=0;i<original.length;i++){
  expect(pasted[i].uid).not.toBe(original[i].uid);expect(pasted[i].name).toBe(original[i].name);
  expect(pasted[i].x).toBeCloseTo(original[i].x+10,9);expect(pasted[i].y).toBeCloseTo(original[i].y+10,9);
  expect(pasted[i].width).toBeCloseTo(original[i].width,9);expect(pasted[i].height).toBeCloseTo(original[i].height,9);
 }
 await page.keyboard.press('Control+z');expect(await count(page)).toBe(0);await page.keyboard.press('Control+Shift+z');expect(await count(page)).toBe(2);
 await page.keyboard.press('Meta+v');expect(await count(page)).toBe(4);
 expect(await page.evaluate(()=>(window as any).__vectora.selectedItems[0].bounds.x)).toBeCloseTo(original[0].x+20,9);
 // A new copy replaces the clipboard, including on macOS shortcuts.
 await page.keyboard.press('Meta+c');await page.keyboard.press('Meta+v');expect(await count(page)).toBe(6);
});

test('Right-click selects objects, preserves multiselection, pastes at canvas coordinates and clamps its menu',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.snappingEnabled=false;e.addShape(new p.Path.Rectangle({rectangle:[40,25,30,25],insert:false}),'First');e.addShape(new p.Path.Circle({center:[105,40],radius:12,insert:false}),'Second');});
 const menu=page.getByRole('menu',{name:'Selection actions',exact:true});
 const screen=await page.evaluate(()=>{const p=(window as any).__paper,r=document.querySelector('canvas')!.getBoundingClientRect(),v=p.view.projectToView(new p.Point(50,35));return {x:r.left+v.x,y:r.top+v.y};});
 await page.mouse.click(screen.x,screen.y,{button:'right'});await expect(menu).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__vectora.selected.data.name)).toBe('First');await expect(menu.getByRole('menuitem',{name:'Paste',exact:true})).toBeDisabled();
 await menu.getByRole('menuitem',{name:'Copy',exact:true}).click();await expect(menu).toBeHidden();
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[1],true);});
 await page.mouse.click(screen.x,screen.y,{button:'right'});expect(await page.evaluate(()=>(window as any).__vectora.selectedItems.length)).toBe(2);
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setActiveLayer('engrave');p.view.zoom=5;p.view.center=new p.Point(120,80);e.refreshTheme();});
 const target={x:1190,y:800};
 const expected=await page.evaluate(({x,y})=>{const p=(window as any).__paper,r=document.querySelector('canvas')!.getBoundingClientRect(),v=p.view.viewToProject(new p.Point(x-r.left,y-r.top));return {x:v.x,y:v.y};},target);
 await page.mouse.click(target.x,target.y,{button:'right'});await expect(menu).toBeVisible();
 const r=(await menu.boundingBox())!;expect(r.x+r.width).toBeLessThanOrEqual(1236);expect(r.y+r.height).toBeLessThanOrEqual(852);
 // Menu is above the canvas, supports keyboard navigation, and stays compact.
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await expect(menu.getByRole('menuitem',{name:'Paste',exact:true})).toBeFocused();
 await page.screenshot({path:'test-results/clipboard-context-menu.png'});await page.keyboard.press('Enter');
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {x:s.bounds.center.x,y:s.bounds.center.y,name:s.data.name,role:s.data.role,color:s.strokeColor.toCSS(true)};});
 expect(result.x).toBeCloseTo(expected.x,8);expect(result.y).toBeCloseTo(expected.y,8);expect(result.name).toBe('First');expect(result.role).toBe('engrave');expect(result.color.toLowerCase()).toBe('#0000ff');
 await page.mouse.click(900,550,{button:'right'});await expect(menu).toBeVisible();await page.keyboard.press('c');await expect(menu).toBeHidden();
 await page.mouse.click(900,550,{button:'right'});await expect(menu).toBeHidden();
});

test('Clipboard preserves editable text, arc geometry and dimensions, including after a new document',async({page})=>{
 await ready(page);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {loadTextFont}=await import('/src/text.ts' as string),{createCircularArc}=await import('/src/arc.ts' as string),{createDimension}=await import('/src/dimensions.ts' as string);
  await loadTextFont();e.saveText('Oo',10,new p.Point(35,35),null,'lato');const text=e.selected;
  e.addShape(createCircularArc({cx:80,cy:50,radius:10,start:0,sweep:120}),'Arc');const arc=e.selected;
  const d={kind:'dimension-linear',points:[[25,70],[65,70],[65,80]],transform:[1,0,0,1,0,0]};e.addShape(createDimension(d),'Dimension');const dimension=e.selected;
  e.select(text,true);e.select(arc,true);
  const old=[text,arc,dimension].map(s=>structuredClone(s.data));e.copySelection();e.newDocument();e.pasteSelection();
  return {old,items:e.selectedItems.map((s:any)=>structuredClone(s.data)),count:e.objects.length};
 });
 expect(result.count).toBe(3);
 for(const old of result.old){const copy=result.items.find((s:any)=>s.name===old.name)!;expect(copy.uid).not.toBe(old.uid);
  if(old.text){expect(copy.text.content).toBe('Oo');expect(copy.text.transform[4]).toBeCloseTo(old.text.transform[4]+10);expect(copy.text.transform[5]).toBeCloseTo(old.text.transform[5]+10);}
  if(old.arc){expect(copy.arc.cx).toBe(old.arc.cx+10);expect(copy.arc.cy).toBe(old.arc.cy+10);expect(copy.arc.sweep).toBe(old.arc.sweep);}
  if(old.dimension){expect(copy.dimension.transform).toEqual([1,0,0,1,10,10]);}
 }
});

test('Paste rejects locked layers atomically, snaps context placement, and leaves native text shortcuts alone',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Circle({center:[60,45],radius:8,insert:false}),'Circle');e.copySelection();e.setActiveLayer('cutline');e.cutlines.locked=true;});
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+v');expect(await count(page)).toBe(1);
 await expect(page.getByText('Show and unlock Cut Path before drawing.',{exact:true})).toBeVisible();
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.cutlines.locked=false;e.snappingEnabled=true;e.grid.setType('square');e.pasteSelection(new p.Point(113,67));});
 expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return [s.bounds.center.x,s.bounds.center.y,s.data.role];})).toEqual([110,70,'cutline']);
 const title=page.getByRole('textbox',{name:'Project name'});await title.click();await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');expect(await count(page)).toBe(2);await page.keyboard.press('Escape');
 await page.evaluate(()=>{const e=(window as any).__vectora;e.setTool('text');});await page.mouse.click(700,400);await page.keyboard.type('Hello');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');expect(await count(page)).toBe(2);await page.keyboard.press('Escape');
});
