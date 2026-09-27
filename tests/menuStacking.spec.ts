import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';

test('Open menus stay above rails and docked panels and restore their stacking on close',async({page})=>{
 await page.goto(DEV);
 const file=page.getByRole('button',{name:'File',exact:true}),menu=page.locator('#primary-file-menu');
 await file.click();await expect(menu).toBeVisible();
 const hitsMenu=async(selector:string,x:number,y:number)=>page.evaluate(({selector,x,y})=>document.querySelector(selector)!.contains(document.elementFromPoint(x,y)),{selector,x,y});
 const box=(await menu.boundingBox())!,rail=(await page.locator('.left-toolbar').boundingBox())!;
 // The File dropdown overlaps the left rail, where its icons used to be hidden.
 const toolbar=(await page.locator('.top-toolbar').boundingBox())!;
 expect(box.x).toBe(toolbar.x);expect(box.y).toBe(toolbar.y+toolbar.height);
 const x=(box.x+rail.x+rail.width)/2,y=box.y+50;
 expect(x).toBeLessThan(rail.x+rail.width);expect(await hitsMenu('#primary-file-menu',x,y)).toBe(true);
 await page.screenshot({path:'test-results/file-menu-stacking.png'});
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 expect(await page.locator('.top-toolbar').evaluate(el=>getComputedStyle(el).zIndex)).toBe('4');
 // A drawing flyout must also cover the docked panel on a narrow screen.
 await page.setViewportSize({width:390,height:844});
 await file.click();
 const mobileMenu=(await menu.boundingBox())!,mobileToolbar=(await page.locator('.top-toolbar').boundingBox())!;
 expect(mobileMenu.x).toBe(mobileToolbar.x);expect(mobileMenu.y).toBe(mobileToolbar.y+mobileToolbar.height);
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Layers',exact:true}).click();await page.getByRole('button',{name:'Shapes',exact:true}).click();
 const shapes=page.locator('#primary-shapes-menu'),s=(await shapes.boundingBox())!,panel=(await page.locator('#primary-layers-panel').boundingBox())!;
 const overlapX=Math.max(s.x,panel.x)+20,overlapY=Math.max(s.y,panel.y)+50;
 expect(overlapX).toBeLessThan(Math.min(s.x+s.width,panel.x+panel.width));expect(await hitsMenu('#primary-shapes-menu',overlapX,overlapY)).toBe(true);
 await shapes.getByRole('menuitemradio',{name:/Rectangle/}).click();await expect(shapes).toBeHidden();expect(await page.locator('.left-toolbar').evaluate(el=>getComputedStyle(el).zIndex)).toBe('4');
 await expect(page.locator('#primary-layers-panel')).toBeVisible();
});
