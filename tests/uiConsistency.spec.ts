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
