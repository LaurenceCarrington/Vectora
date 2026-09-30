import {test,expect,Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
const snap=(page:Page)=>page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
async function setup(page:Page){await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20.25,30.75,12,8],strokeColor:'white'}),'Reference');const a=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[70.5,80.25,20,16],strokeColor:'white'}),'Moving');e.select(a,true);});}
async function arrange(page:Page,name:string){await page.getByRole('button',{name:'Align and distribute',exact:true}).click();const b=page.locator('#selection-menu').getByRole('menuitem',{name,exact:true});await expect(b).toHaveCount(1);await b.click();await expect(page.locator('dialog[open]')).toHaveCount(0);}

for(const [name,x,y] of [['Align left',20.25,80.25],['Align centre',16.25,80.25],['Align right',12.25,80.25],['Align top',70.5,30.75],['Align middle',70.5,26.75],['Align bottom',70.5,22.75]] as const){
 test(`${name} uses the last selected reference, exact coordinates and one undo step`,async({page})=>{
  await setup(page);const before=await snap(page);await arrange(page,name);const after=await snap(page);const result=await page.evaluate(()=>{const e=(window as any).__vectora;return {bounds:e.objects.map((s:any)=>[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]),order:e.selectedItems.map((s:any)=>s.data.name)};});expect(result.bounds).toEqual([[20.25,30.75,12,8],[x,y,20,16]]);expect(result.order).toEqual(['Moving','Reference']);await expect(page.locator('#properties-panel')).toBeHidden();await page.keyboard.press('Control+z');expect(await snap(page)).toBe(before);await page.keyboard.press('Control+Shift+z');expect(await snap(page)).toBe(after);
 });
}

for(const [name,axis] of [['Distribute horizontally','x'],['Distribute vertically','y']] as const){
 test(`${name} spaces centres, keeps endpoints fixed and preserves the other axis`,async({page})=>{
  await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;for(const [i,r] of [[10,20,10,10],[33,38,6,14],[52,63,20,6],[99,110,12,10]].entries())e.addShape(new p.Path.Rectangle({insert:false,rectangle:r,strokeColor:'white'}),'Shape '+i);e.select(e.objects[2],true);e.select(e.objects[0],true);e.select(e.objects[1],true);});const before=await snap(page);await arrange(page,name);const centers=await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>[s.bounds.center.x,s.bounds.center.y]));expect(centers).toEqual(axis==='x'?[[15,25],[45,45],[75,66],[105,115]]:[[15,25],[36,55],[62,85],[105,115]]);await page.keyboard.press('Control+z');expect(await snap(page)).toBe(before);
 });
}

test('Repeated alignment is a no-op and Undo preserves the chosen reference for the next action',async({page})=>{
 await setup(page);const before=await snap(page);await arrange(page,'Align left');await arrange(page,'Align left');await page.keyboard.press('Control+z');expect(await snap(page)).toBe(before);await arrange(page,'Align top');expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.bounds.y))).toEqual([30.75,30.75]);expect(await page.evaluate(()=>(window as any).__vectora.selectedItems.at(-1).data.name)).toBe('Reference');
});

test('Alignment preserves editable text, arc controls, callout labels and layers',async({page})=>{
 await page.goto(DEV);const original=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{loadTextFont,createTextShape}=await import('/src/text.ts'),{createCircularArc}=await import('/src/arc.ts'),{createDimension,dimensionLabel}=await import('/src/dimensions.ts');await loadTextFont('lato');
  e.addShape(createTextShape({content:'Ab',sizeMM:8,fontId:'lato',transform:[1,0,0,1,20,25]}),'Text');const t=e.selected;
  e.addShape(createCircularArc({cx:50,cy:50,radius:10,start:0,sweep:180}),'Arc');e.moveSelectionToCutPath();const a=e.selected;
  e.setActiveLayer('artwork');e.addShape(createDimension({kind:'leader',points:[[80,20],[90,30],[110,30]],text:'Wide label',transform:[1,0,0,1,0,0]}),'Callout');const c=e.selected;
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[150,90,10,10],strokeColor:'white'}),'Reference');const r=e.selected;e.select(t);e.select(a,true);e.select(c,true);e.select(r,true);
  return e.selectedItems.map((s:any)=>{const label=dimensionLabel(s),bounds=label?s.bounds.unite(label.bounds):s.bounds;label?.remove();return {id:s.data.uid,x:bounds.x,role:s.data.role,data:structuredClone(s.data)};});
 });await page.getByRole('button',{name:'Properties',exact:true}).click();await arrange(page,'Align left');const result=await page.evaluate(async()=>{const e=(window as any).__vectora,{dimensionLabel}=await import('/src/dimensions.ts');return e.selectedItems.map((s:any)=>{const label=dimensionLabel(s),bounds=label?s.bounds.unite(label.bounds):s.bounds;label?.remove();return {id:s.data.uid,x:bounds.x,role:s.data.role,data:s.data};});});
 result.forEach((r:any,i:number)=>{expect(r.id).toBe(original[i].id);expect(r.role).toBe(original[i].role);expect(r.x).toBeCloseTo(150,8);});expect(result[0].data.text.content).toBe('Ab');expect(result[0].data.text.transform[4]).toBeCloseTo(original[0].data.text.transform[4]+150-original[0].x,8);expect(result[1].data.arc.cx).toBeCloseTo(50+150-original[1].x,8);expect(result[1].data.arc.radius).toBe(10);expect(result[2].data.dimension.text).toBe('Wide label');expect(result[2].data.dimension.transform[4]).toBeCloseTo(150-original[2].x,8);await expect(page.locator('#properties-panel')).toBeVisible();
});

test('Selection requirements and document limits prevent partial changes',async({page})=>{
 await setup(page);const menu=page.locator('#selection-menu');await expect(menu.getByRole('menuitem',{name:'Distribute horizontally',exact:true,includeHidden:true})).toBeDisabled();await page.evaluate(()=>{const e=(window as any).__vectora;e.setTextEditing(true);});await expect(menu.getByRole('menuitem',{name:'Align left',exact:true,includeHidden:true})).toBeDisabled();await page.evaluate(()=>{const e=(window as any).__vectora;e.setTextEditing(false);e.selected=e.objects[0];e.setTool('select');});await expect(menu.getByRole('menuitem',{name:'Align left',exact:true,includeHidden:true})).toBeDisabled();
 await page.evaluate(()=>{const e=(window as any).__vectora;e.objects[0].bounds.x=999988;e.select(e.objects[1]);e.select(e.objects[0],true);});const before=await snap(page);await arrange(page,'Align left');expect(await snap(page)).toBe(before);
});

test('Grouped arrangement actions work through search and keyboard and fit small screens',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Search tools',exact:true}).click();await page.getByRole('combobox',{name:'Search tools'}).fill('align right');await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.objects[1].bounds.right)).toBeCloseTo(32.25,8);await page.keyboard.press('Control+z');
 const menu=page.locator('#selection-menu');await page.getByRole('button',{name:'Align and distribute',exact:true}).click();for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);for(const size of [{width:390,height:700},{width:900,height:300}]){await page.setViewportSize(size);for(const name of ['Align left','Align centre','Align right','Align top','Align middle','Align bottom','Distribute horizontally','Distribute vertically'])await expect(menu.getByRole('menuitem',{name,exact:true})).toBeInViewport();}await page.screenshot({path:`test-results/arrange-${theme}.png`,scale:'css'});}
 expect(await menu.evaluate(el=>[...el.querySelectorAll('use')].map(n=>n.getAttribute('href')!).filter(h=>!document.querySelector(h)))).toEqual([]);await menu.getByRole('menuitem',{name:'Align top',exact:true}).focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.objects[1].bounds.top)).toBe(30.75);await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('Production alignment and the design reference expose all eight grouped controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');
 for(const [a,b] of [[[400,250],[500,350]],[[600,350],[750,480]]]){await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.locator('#primary-shapes-menu [data-shape="Rectangle"]').click();await page.mouse.move(a[0],a[1]);await page.mouse.down();await page.mouse.move(b[0],b[1],{steps:3});await page.mouse.up();}
 const reference=await page.locator('#field-x').inputValue();await page.keyboard.press('v');await page.mouse.move(350,200);await page.mouse.down();await page.mouse.move(800,530,{steps:3});await page.mouse.up();await expect(page.locator('#selection-menu .selection-count')).toHaveText('2 selected');await arrange(page,'Align left');await expect(page.locator('#field-x')).toHaveValue(reference);await page.screenshot({path:'test-results/arrange-production.png',scale:'css'});await page.keyboard.press('Control+z');await expect(page.locator('#selection-menu .selection-count')).toHaveText('2 selected');expect(await page.locator('#field-x').inputValue()).not.toBe(reference);
 await page.goto(DEV+'/reference/design-system.html');await expect(page.locator('#floating-menu [data-arrange]')).toHaveCount(8);expect(await page.locator('#floating-menu').evaluate(el=>[...el.querySelectorAll('use')].map(n=>n.getAttribute('href')!).filter(h=>!document.querySelector(h)))).toEqual([]);expect(errors).toEqual([]);
});

test('Alignment cannot move an arc centre outside the saved-document limits even if its visible curve fits',async({page})=>{
 await page.goto(DEV);await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{createCircularArc}=await import('/src/arc.ts');e.addShape(createCircularArc({cx:0,cy:0,radius:1000,start:178,sweep:1}),'Arc');const a=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[999990,20,1,1],strokeColor:'white'}),'Reference');const r=e.selected;e.select(a);e.select(r,true);});const before=await snap(page);await arrange(page,'Align left');expect(await snap(page)).toBe(before);
});
