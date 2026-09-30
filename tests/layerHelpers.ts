import type {Page} from '@playwright/test';

/** Transfer the current selection through the visible Layers UI. */
export async function dragSelectionToLayer(page:Page,name='Cut Path') {
  const panel=page.locator('#primary-layers-panel');
  const sourceLayer=await page.evaluate(()=>(window as any).__vectora.selected.layer.data.documentId);
  const expand=panel.locator(`[data-layer-id="${sourceLayer}"] [data-layer-action="expand"]`);
  if(await expand.getAttribute('aria-expanded')==='false')await expand.click();
  const source=panel.locator('.layer-object[aria-pressed="true"]').first();
  await source.dragTo(panel.locator('.layer-select').filter({has:page.getByText(name,{exact:true})}));
}
