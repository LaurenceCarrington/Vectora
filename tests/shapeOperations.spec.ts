import {test,expect,Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function setup(page:Page){await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('cutline');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,20,20]}),'Base');const base=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[30,20,20,20]}),'Cutter');e.select(base,true);});}
async function apply(page:Page,operation='Weld'){const button=page.locator('#selection-menu').getByRole('button',{name:operation,exact:true});await expect(button).toHaveCount(1);await button.click();await expect(page.locator('dialog[open]')).toHaveCount(0);}
const snapshot=(page:Page)=>page.evaluate(()=>JSON.stringify({...((window as any).__vectora.snapshot()),selectedIds:[...(window as any).__vectora.snapshot().selectedIds].sort()}));

for(const [operation,area,bounds] of [['Weld',600,[20,20,30,20]],['Subtract',200,[20,20,10,20]],['Intersect',200,[30,20,10,20]]] as const){
 test(`${operation} uses drawing order, creates exact closed geometry and is one undo step`,async({page})=>{
  await setup(page);const before=await snapshot(page);await apply(page,operation);
  const result=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {count:e.objects.length,area:Math.abs(s.area),bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height],closed:s.closed,fill:s.fillColor,color:s.strokeColor.toCSS(true),role:s.data.role};});expect(result.area).toBeCloseTo(area,8);expect({...result,area:undefined}).toEqual({count:1,area:undefined,bounds,closed:true,fill:null,color:'#ff0000',role:'cutline'});await expect(page.locator('#properties-panel')).toBeHidden();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
 });
}

test('Subtract retains curved holes, style, document round-trip and vector export',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,60,40]}),'Panel');const base=e.selected;base.data.regionFill=true;base.data.regionFillColor='#00ffff';base.fillColor='#00ffff';base.strokeColor=null;e.addShape(new p.Path.Circle({insert:false,center:[35,40],radius:5}),'Hole A');const a=e.selected;e.addShape(new p.Path.Circle({insert:false,center:[65,40],radius:5}),'Hole B');e.select(a,true);e.select(base,true);});await apply(page,'Subtract');
 const result=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.selected,{exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts'),{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');const r={contours:s.children.length,curves:s.children.flatMap((c:any)=>c.curves).filter((c:any)=>!c.isStraight()).length,holes:[s.contains(new p.Point(35,40)),s.contains(new p.Point(65,40))],solid:s.contains(new p.Point(50,40)),fill:s.fillColor.toCSS(true),svg:exportSVG(e.objects),dxf:exportDXF(e.objects,true),json:s.exportJSON({precision:12})};const doc=await decodeDocument(encodeDocument(e));e.loadDocument(doc.snapshot,doc.view);return {...r,loaded:e.objects[0].exportJSON({precision:12})};});expect(result.contours).toBe(3);expect(result.curves).toBe(8);expect(result.holes).toEqual([false,false]);expect(result.solid).toBe(true);expect(result.fill).toBe('#00ffff');expect(result.svg).toMatch(/d="[^"]*[cC]/);expect(result.dxf).toContain('LWPOLYLINE');expect(JSON.parse(result.loaded)).toEqual(JSON.parse(result.json));
});



test('Eligibility excludes open paths, editable text, mixed layers and locked objects',async({page})=>{
 await setup(page);const button=page.locator('#selection-menu [data-shape-operation="weld"]');await expect(button).toBeEnabled();
 await page.evaluate(()=>{const e=(window as any).__vectora;e.objects[1].closed=false;e.select(e.objects[0]);e.select(e.objects[1],true);});await expect(button).toBeDisabled();
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora;const a=e.objects[0],b=e.objects[1];e.artwork.addChild(b);e.select(a);e.select(b,true);});await expect(button).toBeDisabled();
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('cutline','locked',true);});await expect(button).toBeDisabled();
 await page.goto(DEV);await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{loadTextFont,createTextShape}=await import('/src/text.ts');e.newDocument();await loadTextFont('lato');e.addShape(createTextShape({content:'O',sizeMM:20,fontId:'lato',transform:[1,0,0,1,30,40]}),'Text');const t=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,40,40]}),'Box');e.select(t,true);});await expect(button).toBeDisabled();
});



test('Compound holes and affine transforms are intersected in document coordinates',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;const ring=new p.CompoundPath({insert:false,children:[new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40]}),new p.Path.Rectangle({insert:false,rectangle:[10,10,20,20]})],fillRule:'evenodd',strokeColor:'white'});ring.applyMatrix=false;ring.matrix=new p.Matrix(2,0,0,.5,20,20);e.addShape(ring,'Frame');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,60,20],strokeColor:'white'}),'Mask');e.select(ring,true);});await apply(page,'Intersect');
 const r=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.selected;return {area:Math.abs(s.area),inside:[[30,30],[50,30],[90,30],[50,22]].map(q=>s.contains(new p.Point(q))),bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]};});expect(r.area).toBeCloseTo(800,8);expect(r.inside).toEqual([true,false,false,true]);expect(r.bounds).toEqual([20,20,60,20]);
});

test('The result preserves the bottom shape opacity and stroke styling',async({page})=>{
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,s=e.objects[0];s.opacity=.25;s.strokeWidth=2;s.strokeCap='round';s.dashArray=[2,3];e.select(e.objects[1]);e.select(s,true);});await apply(page);expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {opacity:s.opacity,width:s.strokeWidth,cap:s.strokeCap,dash:s.dashArray};})).toEqual({opacity:.25,width:2,cap:'round',dash:[2,3]});
});





test('Production selection menu performs Weld and the reference renders matching controls',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');
 for(const [a,b] of [[[400,250],[550,400]],[[475,325],[625,475]]]){await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.locator('#primary-shapes-menu [data-shape="Rectangle"]').click();await page.mouse.move(a[0],a[1]);await page.mouse.down();await page.mouse.move(b[0],b[1],{steps:3});await page.mouse.up();}await page.keyboard.press('v');await page.mouse.move(350,200);await page.mouse.down();await page.mouse.move(680,510,{steps:3});await page.mouse.up();await expect(page.locator('.selection-count')).toHaveText('2 selected');await apply(page);await expect(page.locator('.selection-count')).toHaveText('1 selected');await page.keyboard.press('Control+z');await expect(page.locator('.selection-count')).toHaveText('2 selected');
 await page.goto(DEV+'/reference/design-system.html');await expect(page.locator('#floating-menu [data-shape-operation]')).toHaveCount(3);expect(await page.locator('#floating-menu').evaluate(el=>[...el.querySelectorAll('use')].map(n=>n.getAttribute('href')!).filter(h=>!document.querySelector(h)))).toEqual([]);expect(errors).toEqual([]);
});


test('Direct actions remain atomic for empty or excessive results',async({page})=>{
 await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora;e.objects[1].translate([60,0]);e.select(e.objects[0]);e.select(e.objects[1],true);});const before=await snapshot(page);await apply(page,'Intersect');expect(await snapshot(page)).toBe(before);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
 await apply(page,'Weld');expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {area:Math.round(Math.abs(s.area)),contours:s.children.length};})).toEqual({area:800,contours:2});await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.addGeneratedShapes(Array.from({length:101},(_,i)=>({shape:new p.Path.Circle({insert:false,center:[20+i*2,30],radius:2}),name:'Circle'})));});const complex=await snapshot(page);await apply(page);expect(await snapshot(page)).toBe(complex);
});

test('Search and keyboard activate direct actions; all icons remain reachable on narrow screens',async({page})=>{
 await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'Search tools',exact:true}).click();await page.getByRole('combobox',{name:'Search tools'}).fill('subtract');await page.keyboard.press('Enter');expect(await page.evaluate(()=>Math.round(Math.abs((window as any).__vectora.selected.area)))).toBe(200);await expect(page.locator('dialog[open]')).toHaveCount(0);await page.keyboard.press('Control+z');
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);for(const size of [{width:390,height:700},{width:900,height:300}]){await page.setViewportSize(size);for(const name of ['Weld','Subtract','Intersect'])await expect(page.locator('#selection-menu').getByRole('button',{name,exact:true})).toBeInViewport();}}
 const menu=page.locator('#selection-menu');expect(await menu.evaluate(el=>[...el.querySelectorAll('use')].map(n=>n.getAttribute('href')!).filter(h=>!document.querySelector(h)))).toEqual([]);await menu.getByRole('button',{name:'Intersect',exact:true}).focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);expect(await page.evaluate(()=>Math.round(Math.abs((window as any).__vectora.selected.area)))).toBe(200);await expect(page.locator('dialog[open]')).toHaveCount(0);expect(errors).toEqual([]);
});
