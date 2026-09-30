import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function open(page:Page,tab='Gradient'){
 await page.goto(DEV);await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');
 await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();await page.getByRole('tab',{name:tab,exact:true}).click();
}
test('Gradient swatches open independent internal pickers with colour, opacity and undo',async({page})=>{
 await open(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,30]}),'Box');e.fillAt(new p.Point(25,35));});
 const stop=page.getByRole('button',{name:'Choose stop 1 colour',exact:true});await stop.click();
 const picker=page.getByRole('dialog',{name:'Stop 1 colour',exact:true});await expect(picker).toBeVisible();
 await picker.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#12AB34');await picker.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');
 await picker.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).fill('40');await picker.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).press('Enter');
 expect(await page.evaluate(()=>(window as any).__vectora.selected.data.fillPaint.stops)).toEqual([{colour:'#12AB34',offset:0,opacity:.4},{colour:'#0000FF',offset:1,opacity:1}]);
 await picker.press('Escape');await expect(picker).toBeHidden();await expect(stop).toBeFocused();await expect(page.locator('#colour-panel')).toBeVisible();
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.data.fillPaint.stops[0].opacity)).toBe(1);
 await page.getByRole('button',{name:'Choose stop 2 colour',exact:true}).click();const second=page.getByRole('dialog',{name:'Stop 2 colour',exact:true});await expect(second.getByRole('textbox',{name:'Hex colour',exact:true})).toHaveValue('#0000FF');
 await second.getByRole('button',{name:'#00FFFF',exact:true}).click();await page.getByRole('tab',{name:'Pattern',exact:true}).click();await expect(second).toBeHidden();
});
test('Pattern foreground and background pickers respect transparency and stay on screen',async({page})=>{
 await open(page,'Pattern');const background=page.getByRole('button',{name:'Choose background colour',exact:true});await expect(background).toBeDisabled();
 await page.getByRole('checkbox',{name:'Transparent background',exact:true}).uncheck();
 for(const target of ['Foreground','Background']){
  await page.getByRole('button',{name:`Choose ${target.toLowerCase()} colour`,exact:true}).click();const picker=page.getByRole('dialog',{name:`${target} colour`,exact:true});
  await picker.getByRole('textbox',{name:'Hex colour',exact:true}).fill(target==='Foreground'?'#AABBCC':'#112233');await picker.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');
  await picker.press('Escape');
 }
 expect(await page.evaluate(()=>(window as any).__vectora.fillPaint)).toMatchObject({foreground:'#AABBCC',background:'#112233',transparent:false});
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:650});await background.click();const picker=page.getByRole('dialog',{name:'Background colour',exact:true});const rect=(await picker.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(rect.y+rect.height).toBeLessThanOrEqual(650);
  await page.screenshot({path:`test-results/paint-picker-${width}.png`});await picker.press('Escape');
 }
 await background.click();await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('.colour-popover')).toBeHidden();
});

test('Picker drag commits once and both themes and the reference share the pop-out',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,30]}),'Box');e.fillAt(new p.Point(25,35));});
 const state=()=>page.evaluate(()=>(window as any).__vectora.selected.data.fillPaint.stops[0].colour);
 const before=await state();await page.getByRole('button',{name:'Choose stop 1 colour',exact:true}).click();const picker=page.getByRole('dialog',{name:'Stop 1 colour',exact:true});
 const plane=picker.locator('.colour-plane'),rect=(await plane.boundingBox())!;
 await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.3,rect.y+rect.height*.6,{steps:10});await page.mouse.up();expect(await state()).not.toBe(before);
 await picker.press('Escape');await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await state()).toBe(before);
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';(window as any).__vectora.refreshTheme();});await page.getByRole('button',{name:'Choose stop 1 colour',exact:true}).click();await page.screenshot({path:'test-results/paint-picker-light.png'});
 // Saved swatches increase the picker height; it must still fit in a short window.
 await page.setViewportSize({width:600,height:450});await picker.getByRole('button',{name:'Save colour swatch',exact:true}).click();
 await expect.poll(async()=>{const r=(await picker.boundingBox())!;return r.y+r.height;}).toBeLessThanOrEqual(450);
 await picker.getByRole('button',{name:'Close colour picker',exact:true}).click();
 const ref=await context.newPage();await ref.goto(DEV+'/reference/design-system.html');await ref.getByRole('button',{name:'Fill & appearance',exact:true}).click();await ref.getByRole('tab',{name:'Gradient',exact:true}).click();await ref.getByRole('button',{name:'Choose stop 1 colour',exact:true}).click();await expect(ref.getByRole('dialog',{name:'Stop 1 colour',exact:true})).toBeVisible();await ref.close();expect(errors).toEqual([]);
});
