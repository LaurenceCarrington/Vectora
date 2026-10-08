import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';

async function mismatchedFonts(page:Page){
 return page.evaluate(()=>{
  const family=getComputedStyle(document.body).fontFamily;
  return [...document.querySelectorAll<HTMLElement>('button,input,select,textarea,output,.number-unit,.number-prefix,kbd,.canvas-ruler text')]
   .filter(el=>el.id!=='inline-text')
   .flatMap(el=>getComputedStyle(el).fontFamily===family?[]:[{element:el.id||el.className||el.tagName,font:getComputedStyle(el).fontFamily}]);
 });
}

for(const theme of ['dark','light','high-contrast']){
 test(`${theme} uses one UI font across editor fields, menus and generated dialogs`,async({page})=>{
  await page.goto(DEV);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();
  await page.locator(`[name="appearance-theme"][value="${theme}"]`).check();
  expect(await mismatchedFonts(page)).toEqual([]);
  const fields=await page.evaluate(()=>({
   numericSize:getComputedStyle(document.querySelector('#field-width')!).fontSize,
   selectBackground:getComputedStyle(document.querySelector('#field-line-style')!).backgroundColor,
   numericBackground:getComputedStyle(document.querySelector('#field-line-weight')!.closest('.number-shell')!).backgroundColor,
  }));
  expect(fields.numericSize).toBe('13px');
  expect(fields.selectBackground).toBe(fields.numericBackground);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Generators',exact:true}).click();
  await page.getByRole('menuitem',{name:'Involute gear',exact:true}).click();
  expect(await mismatchedFonts(page)).toEqual([]);
  await page.locator('#generator-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('#generator-dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Material & process preview'});
  await expect(dialog).toBeVisible();
  expect(await mismatchedFonts(page)).toEqual([]);
  const colours=await page.evaluate(()=>{
   const root=getComputedStyle(document.documentElement);
   return {foreground:root.getPropertyValue('--preview-foreground').trim(),uiForeground:root.getPropertyValue('--menu-foreground').trim(),muted:root.getPropertyValue('--preview-muted').trim(),uiMuted:root.getPropertyValue('--menu-muted').trim()};
  });
  expect(colours.foreground).toBe(colours.uiForeground);expect(colours.muted).toBe(colours.uiMuted);
  const previewFields=await dialog.evaluate(el=>({
   selectBackground:getComputedStyle(el.querySelector('[data-preview-material]')!).backgroundColor,
   numericBackground:getComputedStyle(el.querySelector('.number-shell')!).backgroundColor,
  }));
  expect(previewFields.selectBackground).toBe(previewFields.numericBackground);
 });
}

for(const theme of ['light','dark','high-contrast']){
 test(`${theme} shares dialog titles, commit actions, field borders and focus treatment`,async({page})=>{
  await page.goto(DEV);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.locator(`[name="appearance-theme"][value="${theme}"]`).check();
  await expect(page.locator('.preferences-header h2')).toHaveCSS('font-size','24px');
  await page.getByRole('tab',{name:'Snapping',exact:true}).click();await page.locator('#pref-snapping').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(page.locator('#pref-snapping')).toBeFocused();
  await expect(page.locator('#pref-snapping + .toggle-track')).toHaveCSS('outline-offset',theme==='high-contrast'?'-3px':'-2px');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[30,30,60,40]}),'Consistency rectangle');});
  const rgb=(hex:string)=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
  const token=async(locator:any,name:string)=>rgb(await locator.evaluate((el:Element,name:string)=>getComputedStyle(el).getPropertyValue(name).trim(),name));
  await page.locator('[data-offset-open]').click();const offset=page.locator('#offset-dialog');
  await expect(offset.locator('select').first()).toHaveCSS('border-top-color',await token(offset,'--field-border'));
  const create=offset.locator('[data-offset-create]');await expect(create).toBeEnabled();await expect(create).toHaveCSS('background-color',await token(create,'--primary-background'));
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Pattern',exact:true}).click();const apply=page.locator('[data-pattern-apply]');await expect(apply).toBeEnabled();await expect(apply).toHaveCSS('background-color',await token(apply,'--primary-background'));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Generators',exact:true}).click();await page.getByRole('menuitem',{name:'Involute gear',exact:true}).click();await expect(page.locator('.generator-header h2')).toHaveCSS('font-size','24px');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Images',exact:true}).click();await page.getByRole('menuitem',{name:'Raster to vector',exact:true}).click();const cancel=page.locator('#raster-dialog .raster-cancel');await expect(cancel).toHaveCSS('background-color',await token(cancel,'--button-background'));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.locator('#material-preview-dialog .export-header h2')).toHaveCSS('font-size','24px');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Help',exact:true}).click();await expect(page.locator('.help-header h2')).toHaveCSS('font-size','24px');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Layers',exact:true}).click();const layers=page.locator('#primary-layers-panel');await layers.getByRole('button',{name:'Add layer',exact:true}).click();await layers.getByRole('menuitem',{name:'Artwork',exact:true}).click();await layers.locator('.layer-select[aria-pressed="true"] .layer-name').dblclick();const name=layers.getByRole('textbox',{name:'Layer name',exact:true});await name.fill('');await name.press('Enter');await expect(name).toHaveAttribute('aria-invalid','true');await expect(name).toHaveCSS('border-top-color',await token(name,'--color-danger'));await name.press('Escape');
 });
}

test('narrow workspaces use a consistent compact title scale across large dialogs',async({page})=>{
 await page.setViewportSize({width:390,height:750});await page.goto(DEV);
 const check=async(selector:string)=>{await expect(page.locator(selector)).toHaveCSS('font-size','20px');await page.keyboard.press('Escape');};
 await page.getByRole('button',{name:'Settings',exact:true}).click();await check('.preferences-header h2');
 await page.getByRole('button',{name:'Generators',exact:true}).click();await page.getByRole('menuitem',{name:'Involute gear',exact:true}).click();await check('.generator-header h2');
 await page.getByRole('button',{name:'Images',exact:true}).click();await page.getByRole('menuitem',{name:'Raster to vector',exact:true}).click();await check('.raster-header h2');
 await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export…',exact:true}).click();await check('#export-dialog .export-header h2');
 await page.getByRole('button',{name:'Preview',exact:true}).click();await check('#material-preview-dialog .export-header h2');
 await page.getByRole('button',{name:'Help',exact:true}).click();await check('.help-header h2');
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await expect(page.locator('.new-document-dialog .export-header h2')).toHaveCSS('font-size','20px');
});
