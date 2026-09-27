import type {Page} from '@playwright/test';

/** Transfer the current selection through the visible Layers UI. */
export async function dragSelectionToLayer(page:Page,name='Cut Path') {
  const panel=page.locator('#primary-layers-panel');
  const source=panel.locator('.layer-object[aria-pressed="true"]').first();
  const expand=source.locator('xpath=ancestor::*[@data-layer-id]').locator('[data-layer-action="expand"]');
  if(await expand.getAttribute('aria-expanded')==='false')await expand.click();
  await source.dragTo(panel.locator('.layer-select').filter({has:page.getByText(name,{exact:true})}));
}
