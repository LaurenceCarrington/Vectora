import {test as base,type Page} from '@playwright/test';
export * from '@playwright/test';
/** Existing editor tests start with an infinite workspace. Exercise the real
 * setup buttons; canvasSize.spec.ts uses the base fixture to test setup itself. */
export const test=base.extend({
 context:async({context},use)=>{
  await context.addInitScript(()=>{
   // Legacy geometry fixtures explicitly use Dark; dedicated theme tests cover
   // the real Light default and saved user preferences without this override.
   if(!localStorage.getItem('vectora.theme'))localStorage.setItem('vectora.theme','dark');
   new MutationObserver(()=>{
    const dialog=document.querySelector<HTMLDialogElement>('#new-document-dialog[open]');
    if(!dialog||!['startup','new'].includes(dialog.dataset.mode??''))return;
    dialog.querySelector<HTMLButtonElement>('[data-canvas-preset="infinite"]')!.click();
    dialog.querySelector<HTMLButtonElement>('[data-setup-create]')!.click();
   }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  });
  const prepare=(page:Page)=>{
   const goto=page.goto.bind(page);
   page.goto=async(...args)=>{
    const response=await goto(...args);
    if(/^http:\/\/127\.0\.0\.1:(5174|4173)\/?(?:$|index\.html)/.test(page.url()))await page.waitForFunction(()=>{const workspace=document.querySelector('#workspace');return workspace&&!workspace.hasAttribute('inert');});
    return response;
   };
  };
  context.on('page',prepare);context.pages().forEach(prepare);
  await use(context);
 }
});
