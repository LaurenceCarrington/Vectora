import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';

test('Endpoint arc keeps its endpoints at minor, semicircle and major sweeps in both directions',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,{createEndpointArc}=await import('/src/arc.ts'),rows=[];
  for(const angle of [30,90,180,270,-30,-90,-180,-270]){
   const from=new p.Point(12,-8),to=new p.Point(42,32),delta=to.subtract(from),normal=new p.Point(-delta.y,delta.x).normalize();
   const pointer=from.add(to).divide(2).add(normal.multiply(-delta.length/2*Math.tan(angle*Math.PI/720)));
   const arc=createEndpointArc(from,to,pointer),data=arc.data.arc;
   rows.push({angle,sweep:data.sweep,startError:arc.firstSegment.point.getDistance(from),endError:arc.lastSegment.point.getDistance(to),closed:arc.closed,finite:arc.segments.every((s:any)=>Number.isFinite(s.point.x)&&Number.isFinite(s.point.y))});arc.remove();
  }
  let rejected=false;try{createEndpointArc(new p.Point(0,0),new p.Point(0,0),new p.Point(10,10));}catch{rejected=true;}
  return {rows,rejected};
 });
 for(const row of result.rows){expect(row.sweep).toBeCloseTo(row.angle,6);expect(row.startError).toBeLessThan(1e-7);expect(row.endError).toBeLessThan(1e-7);expect(row.closed).toBe(false);expect(row.finite).toBe(true);}expect(result.rejected).toBe(true);
});

test('Start–end arc previews its angle, snaps a semicircle and commits one editable arc with undo',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;p.view.zoom=5;p.view.center=new p.Point(0,0);e.setTool('select');});
 await page.getByRole('button',{name:'Arcs',exact:true}).click();await page.keyboard.press('End');await expect(page.getByRole('menuitemradio',{name:'Start–end arc',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('#tool-status')).toContainText('Click start');
 await page.mouse.click(440,450);await expect(page.locator('#tool-status')).toContainText('Click end');await page.mouse.click(640,450);await page.mouse.move(540,353);
 await expect(page.locator('#tool-status')).toContainText('180°');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
 await page.screenshot({path:'test-results/endpoint-arc-preview.png'});await page.mouse.click(540,353);
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {arc:s.data.arc,ends:[s.firstSegment.point.toJSON(),s.lastSegment.point.toJSON()],tool:e.tool,count:e.objects.length,snapshot:e.snapshot()};});
 expect(result.arc.radius).toBeCloseTo(20,6);expect(result.arc.sweep).toBe(180);expect(result.ends[0][1]).toBeCloseTo(-40,6);expect(result.ends[1][1]).toBeCloseTo(0,6);expect(result.count).toBe(1);expect(result.tool).toBe('select');await expect(page.locator('#properties-panel')).toBeVisible();
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(result.snapshot);
 if(await page.locator('#properties-panel').isHidden())await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#arc-controls')).toBeVisible();await expect(page.locator('#arc-sweep')).toHaveValue('180');
});

test('Start–end arc steps back, cancels safely and applies Shift angle snapping',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;p.view.zoom=5;p.view.center=new p.Point(0,0);e.setTool('arc-endpoints');});
 await page.mouse.click(440,450);await page.mouse.click(640,450);await page.keyboard.press('Backspace');await expect(page.locator('#tool-status')).toContainText('Click end');await page.mouse.click(640,450);await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
 await page.mouse.click(440,450);await page.mouse.click(440,450);await expect(page.locator('#tool-status')).toContainText('Click end');await page.mouse.click(640,450);await page.mouse.click(540,450);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
 await page.keyboard.down('Shift');await page.mouse.move(540,421);await expect(page.locator('#tool-status')).toContainText('60°');await page.mouse.click(540,421);await page.keyboard.up('Shift');expect(await page.evaluate(()=>(window as any).__vectora.selected.data.arc.sweep)).toBe(60);
});
