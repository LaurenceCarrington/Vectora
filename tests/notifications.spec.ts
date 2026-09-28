import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
test('Notifications retain every message behind the badge without taking focus',async({page})=>{
 await page.goto(DEV);const bell=page.getByRole('button',{name:'Notifications',exact:true}),panel=page.locator('#notifications-panel'),cards=page.locator('#toast-stack .toast-card');
 await expect(bell.locator('.notification-badge')).toBeHidden();await bell.click();await expect(panel).toContainText('No notifications yet.');await page.keyboard.press('Escape');await expect(bell).toBeFocused();
 await page.locator('#cad-canvas').focus();await page.evaluate(()=>{for(const kind of ['success','warning','error','information'])(window as any).__vectora.onMessage(kind,kind);(window as any).__vectora.onMessage('Another error','error');});
 await expect(panel).toBeHidden();await expect(bell.locator('.notification-badge')).toHaveText('5');await expect(page.locator('#cad-canvas')).toBeFocused();
 await page.clock.install();await page.clock.fastForward(60000);await expect(cards).toHaveCount(5);
 await bell.click();await expect(cards.first()).toContainText('Another error');
 for(const [kind,icon] of [['success','check'],['warning','warning'],['error','error'],['information','info']])await expect(page.locator(`#toast-stack .toast-${kind} .toast-icon use`).first()).toHaveAttribute('href',`#i-${icon}`);
 await cards.first().getByRole('button').click();await expect(bell.locator('.notification-badge')).toHaveText('4');await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(bell).toBeFocused();
 await bell.click();await expect(cards).toHaveCount(4);await page.mouse.click(500,300);await expect(panel).toBeHidden();
});
test('Notification history evicts the oldest at 15 and preserves keyboard focus',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{for(let i=1;i<=15;i++)(window as any).__vectora.onMessage('Message '+i,'information');});
 const bell=page.getByRole('button',{name:'Notifications',exact:true}),cards=page.locator('#toast-stack .toast-card');await bell.click();await cards.last().getByRole('button').focus();
 await page.evaluate(()=>(window as any).__vectora.onMessage('Message 16','information'));await expect(cards).toHaveCount(15);await expect(cards.first()).toContainText('Message 16');await expect(cards.last()).toContainText('Message 2');await expect(bell.locator('.notification-badge')).toHaveText('15');await expect(page.getByRole('button',{name:'Close notifications',exact:true})).toBeFocused();
 for(let i=0;i<15;i++)await cards.first().getByRole('button').click();
 await expect(bell.locator('.notification-badge')).toBeHidden();await expect(page.locator('[data-notifications-empty]')).toBeVisible();await expect(page.getByRole('button',{name:'Close notifications',exact:true})).toBeFocused();
});
test('Notification pop-out is flush with the right rail, bounded, scrollable and safe for message text',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{for(let i=0;i<18;i++)(window as any).__vectora.onMessage('<img src=x onerror=alert(1)> '+ 'Long message '.repeat(20),'error');});
 const bell=page.getByRole('button',{name:'Notifications',exact:true}),panel=page.locator('#notifications-panel');await bell.click();
 for(const viewport of [{width:1280,height:900},{width:420,height:600}]){
  await page.setViewportSize(viewport);const rail=(await page.locator('.right-toolbar').boundingBox())!,b=(await bell.boundingBox())!,p=(await panel.boundingBox())!;
  expect(b.y+b.height).toBeGreaterThan(rail.y+rail.height-10);expect(p.x+p.width).toBeCloseTo(rail.x,0);expect(p.x).toBeGreaterThanOrEqual(0);expect(p.y).toBeGreaterThanOrEqual(rail.y);expect(p.y+p.height).toBeLessThanOrEqual(rail.y+rail.height+1);
  await expect(panel.locator('img')).toHaveCount(0);expect(await page.locator('#toast-stack').evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 }
 await page.screenshot({path:'test-results/notifications-narrow.png'});
});
test('Production and reference expose the same notification menu',async({page})=>{
 for(const url of ['http://127.0.0.1:4173','http://127.0.0.1:5174/reference/design-system.html']){
  await page.goto(url);
  if(url.includes('reference'))await page.locator('[data-toast-show="error"]').click();
  else {await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export SVG',exact:true}).click();}
  const bell=page.getByRole('button',{name:'Notifications',exact:true});await expect(bell.locator('.notification-badge')).toHaveText('1');await expect(page.locator('#notifications-panel')).toBeHidden();await bell.click();await expect(page.locator('#notifications-panel .toast-error')).toBeVisible();
  if(!url.includes('reference'))await page.screenshot({path:'test-results/notifications-desktop.png',scale:'css'});
  await page.getByRole('button',{name:'Close notifications',exact:true}).click();await expect(bell).toBeFocused();
 }
});
