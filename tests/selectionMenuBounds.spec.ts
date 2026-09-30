import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';

test('Selection menu and grip stay reachable at every canvas edge and after layout changes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[20,20,30,30],insert:false}),'Rectangle');});
 const menu=page.locator('#selection-menu'),grip=page.getByRole('button',{name:'Move selection menu',exact:true});
 const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
 async function reachable(){
  await expect.poll(()=>menu.evaluate(el=>{
   const r=el.getBoundingClientRect(),g=el.querySelector('.drag-handle')!.getBoundingClientRect();
   const header=document.querySelector('.top-toolbar')!.getBoundingClientRect(),left=document.querySelector('.ruler-left')!.getBoundingClientRect(),right=document.querySelector('.right-toolbar')!.getBoundingClientRect(),bottom=document.querySelector('.ruler-bottom')!.getBoundingClientRect();
   const hit=document.elementFromPoint(g.x+g.width/2,g.y+g.height/2);
   return r.left>=left.right&&r.right<=right.left+.01&&r.top>=header.bottom&&r.bottom<=bottom.top+.01&&!!hit?.closest('.drag-handle');
  })).toBe(true);
 }
 for(const [x,y] of [[-100,-100],[1500,-100],[1500,1200],[-100,1200]]){
  const r=(await grip.boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:4});await page.mouse.up();await reachable();
 }
 await grip.focus();for(let i=0;i<160;i++)await page.keyboard.press('Shift+ArrowRight');for(let i=0;i<100;i++)await page.keyboard.press('Shift+ArrowUp');await reachable();
 await page.getByRole('button',{name:'Properties',exact:true}).click();await reachable();
 const panel=(await page.locator('#properties-panel').boundingBox())!,r=(await menu.boundingBox())!;expect(r.x+r.width).toBeLessThanOrEqual(panel.x);
 await page.setViewportSize({width:390,height:750});await reachable();await expect(menu).toHaveClass(/is-over-dock/);
 await page.getByRole('button',{name:'Properties',exact:true}).click();await reachable();
 const start=(await grip.boundingBox())!;await page.mouse.move(start.x+10,start.y+10);await page.mouse.down();await page.mouse.move(380,700);
 await page.setViewportSize({width:320,height:550});await page.mouse.up();await reachable();
 await page.screenshot({path:'test-results/selection-menu-bounded.png'});
 await page.setViewportSize({width:1280,height:900});await reachable();
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);
 expect(errors).toEqual([]);
});
