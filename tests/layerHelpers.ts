import type {Page} from '@playwright/test';

/** Transfer the current selection through the visible Layers UI. */
export async function dragSelectionToLayer(page:Page,name='Cut Path') {
  const panel=page.locator('#primary-layers-panel');
  const source=panel.locator('.layer-object[aria-pressed="true"]').first();
  // Production deliberately has no editor debug hook. Reveal selected rows
  // using the same expanders available to a user, including mixed selections.
  while(!await source.count()){
    const expand=panel.locator('[data-layer-action="expand"][aria-expanded="false"]').first();
    if(!await expand.count())throw new Error('No selected object is available in Layers.');
    await expand.click();
  }
  await source.dragTo(panel.locator('.layer-select').filter({has:page.getByText(name,{exact:true})}));
}
