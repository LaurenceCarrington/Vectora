import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');}
async function open(page:Page){await page.getByRole('button',{name:'Colour',exact:true}).click();}
async function paint(page:Page,hex:string){const field=page.getByRole('textbox',{name:'Hex colour',exact:true});await field.fill(hex);await field.press('Enter');}
async function shape(page:Page){await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,30,40],strokeColor:e.drawingColor,strokeWidth:1.5}),'Rectangle');});}
const state=(page:Page)=>page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {stroke:s?.strokeColor?.toCSS(true),fill:s?.fillColor?.toCSS(true),opacity:s?.opacity,fillColour:e.fillColor,fillOpacity:e.fillOpacity,noFill:e.noFill};});
test('Colour docks alongside the canvas, toggles with other panels and closes with Escape',async({page})=>{
 await ready(page);await open(page);await expect(page.getByRole('region',{name:'Colour',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Colour',exact:true})).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('#colour-panel')).toBeHidden();await open(page);await expect(page.locator('#primary-layers-panel')).toBeHidden();
 await page.getByRole('textbox',{name:'Hex colour',exact:true}).focus();await page.keyboard.press('Escape');await expect(page.locator('#colour-panel')).toBeHidden();await expect(page.getByRole('button',{name:'Colour',exact:true})).toBeFocused();
});
test('Colour and opacity edit artwork with undo and survive themes and document roundtrips',async({page})=>{
 await ready(page);await shape(page);await open(page);await paint(page,'#8235DC');expect((await state(page)).stroke).toBe('#8235dc');expect((await state(page)).fill).toBeUndefined();
 await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).fill('40');await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).press('Enter');expect((await state(page)).opacity).toBe(.4);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).opacity).toBe(1);expect((await state(page)).stroke).toBe('#8235dc');
 await paint(page,'#FFFFFF');await page.evaluate(()=>{document.documentElement.dataset.theme='light';(window as any).__vectora.refreshTheme();});expect((await state(page)).stroke).toBe('#ffffff');
 const result=await page.evaluate(async()=>{const {encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);const e=(window as any).__vectora;const d=await decodeDocument(encodeDocument(e));e.loadDocument(d.snapshot,d.view);return e.objects[0].strokeColor.toCSS(true);});expect(result).toBe('#ffffff');
});
test('Picker controls fill opacity and leaves operation colours intact',async({page})=>{
 await ready(page);await shape(page);await page.evaluate(()=>(window as any).__vectora.moveSelectionToLayer('cutline'));await open(page);await paint(page,'#22AA88');expect((await state(page)).stroke).toBe('#ff0000');expect((await state(page)).fillColour).toBe('#22AA88');
 await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).fill('50');await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).press('Enter');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setActiveLayer('artwork');e.fillAt(new p.Point(25,35));});expect((await state(page)).fill).toBe('#22aa88');expect((await state(page)).opacity).toBe(.5);
});

test('A colour-area drag commits once, keyboard controls work and invalid hex is harmless',async({page})=>{
 await ready(page);await shape(page);await open(page);await paint(page,'#8235DC');const before=await state(page);
 const plane=page.locator('.colour-plane'),r=(await plane.boundingBox())!;await page.mouse.move(r.x+r.width*.7,r.y+r.height*.2);await page.mouse.down();await page.mouse.move(r.x+r.width*.3,r.y+r.height*.6,{steps:12});await page.mouse.up();expect((await state(page)).stroke).not.toBe(before.stroke);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).stroke).toBe(before.stroke);
 await plane.focus();await page.keyboard.press('ArrowLeft');expect((await state(page)).stroke).not.toBe(before.stroke);await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).stroke).toBe(before.stroke);
 await paint(page,'nonsense');await expect(page.locator('#colour-error')).toBeVisible();expect((await state(page)).stroke).toBe(before.stroke);
 await page.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#1A2B3C');await page.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');await expect(page.locator('#colour-error')).toBeHidden();
 await page.getByRole('button',{name:'Save colour swatch',exact:true}).click();await paint(page,'#987654');await page.getByRole('button',{name:'#1A2B3C · 100%',exact:true}).click();expect((await state(page)).stroke).toBe('#1a2b3c');
});

test('Explicit white exports unchanged while ordinary artwork exports black',async({page})=>{
 await ready(page);await shape(page);await open(page);await paint(page,'#FFFFFF');await shape(page);
 const colours=await page.evaluate(async()=>{const e=(window as any).__vectora,{exportSVG}=await import('/src/exportSVG.ts' as string);const svg=new DOMParser().parseFromString(exportSVG(e.objects),'image/svg+xml');return [...svg.querySelectorAll('path')].map(p=>p.getAttribute('stroke'));});expect(colours).toEqual(['#ffffff','#000000']);
});

test('Colour updates a multi-selection together and does not edit hidden or locked artwork',async({page})=>{
 await ready(page);await shape(page);await shape(page);await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0],true);});await open(page);await paint(page,'#2568A0');
 expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.strokeColor.toCSS(true)))).toEqual(['#2568a0','#2568a0']);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.objects.every((s:any)=>!s.data.customColour))).toBe(true);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.objects[0].locked=true;e.objects[1].visible=false;});await paint(page,'#554433');expect(await page.evaluate(()=>(window as any).__vectora.objects.every((s:any)=>!s.data.customColour))).toBe(true);
});

test('The picker matches the reference, fits both themes and remains usable on narrow screens',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await open(page);await paint(page,'#8235DC');
 await page.screenshot({path:'test-results/colour-panel-dark.png'});
 const style=()=>page.locator('#colour-panel').evaluate(el=>({background:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width}));const dark=await style();
 const ref=await context.newPage();ref.on('pageerror',e=>errors.push(e.message));await ref.goto(DEV+'/reference/design-system.html');await ref.getByRole('button',{name:'Colour',exact:true}).click();await expect(ref.locator('#colour-panel')).toBeVisible();expect(await ref.locator('#colour-panel').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(dark.background);await ref.close();
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';(window as any).__vectora.refreshTheme();});expect((await style()).background).not.toBe(dark.background);await page.screenshot({path:'test-results/colour-panel-light.png'});
 for(const width of [600,375]){await page.setViewportSize({width,height:700});const rect=await page.locator('#colour-panel').boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(44);expect(rect!.x+rect!.width).toBeLessThanOrEqual(width-44);await expect(page.locator('#colour-hex')).toBeVisible();const overflow=await page.locator('.colour-panel-body').evaluate(el=>el.scrollWidth>el.clientWidth);expect(overflow).toBe(false);}
 expect(errors).toEqual([]);
});

test('Repainting a region uses the new colour and No fill enables region clearing',async({page})=>{
 await ready(page);await shape(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setFillColor('#112233');e.fillAt(new p.Point(25,35));});await open(page);await paint(page,'#445566');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setFillColor('#778899');e.fillAt(new p.Point(25,35));});expect((await state(page)).fill).toBe('#778899');
 await page.getByRole('button',{name:'No fill',exact:true}).click();expect((await state(page)).noFill).toBe(true);await expect(page.locator('.colour-none')).toHaveAttribute('aria-pressed','true');
});

test('Production colour panel runs without errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await open(page);await paint(page,'#123ABC');await expect(page.getByRole('spinbutton',{name:'Red',exact:true})).toHaveValue('18');await expect(page.getByRole('spinbutton',{name:'Green',exact:true})).toHaveValue('58');await expect(page.getByRole('spinbutton',{name:'Blue',exact:true})).toHaveValue('188');expect(errors).toEqual([]);
});

test('Join and Explode retain explicit white and opacity in Light mode',async({page})=>{
 await ready(page);await shape(page);await shape(page);const result=await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0],true);e.setPaint('#FFFFFF',.4,true);e.joinSelection();document.documentElement.dataset.theme='light';e.refreshTheme();const joined={colour:e.selected.strokeColor.toCSS(true),opacity:e.selected.opacity};e.explodeSelection();return {joined,paths:e.selectedItems.map((p:any)=>({colour:p.strokeColor.toCSS(true),opacity:p.opacity}))};});expect(result.joined).toEqual({colour:'#ffffff',opacity:.4});expect(result.paths).toEqual([{colour:'#ffffff',opacity:.4},{colour:'#ffffff',opacity:.4}]);
});
