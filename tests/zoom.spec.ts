import {test,expect} from './fixtures';

test('Zoom percentage resets to 100% with mouse and keyboard without changing artwork or view centre',async({page})=>{
  await page.goto('http://127.0.0.1:5174');
  const before=await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,30,40],strokeColor:'#383838'}),'Rectangle');
    p.view.zoom=1;p.view.center=new p.Point(-50,120);e.setTool('select');
    return {document:e.snapshot(),center:p.view.center.toJSON(),undo:e.canUndo,redo:e.canRedo};
  });
  const reset=page.getByRole('button',{name:'Reset zoom to 100%',exact:true});
  await expect(reset).toHaveText('26%');await reset.click();
  await expect(page.locator('#view-status')).toHaveText('100% · Grid 10 mm');
  expect(await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {document:e.snapshot(),center:p.view.center.toJSON(),undo:e.canUndo,redo:e.canRedo};})).toEqual(before);
  expect(await page.evaluate(()=>(window as any).__paper.view.zoom)).toBeCloseTo(96/25.4,8);
  for(const key of ['Enter','Space']){
    await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=20;e.setTool('select');});
    await reset.focus();await page.keyboard.press(key);await expect(reset).toHaveText('100%');
    expect(await page.evaluate(()=>(window as any).__vectora.space)).toBe(false);
  }
  // A view reset must not consume an undo step.
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
});

test('Zoom reset stays centred and styled in the reference and narrow production canvas',async({page})=>{
  for(const url of ['http://127.0.0.1:5174/reference/design-system.html','http://127.0.0.1:4173']){
    await page.setViewportSize({width:420,height:700});await page.goto(url);
    const reset=page.getByRole('button',{name:'Reset zoom to 100%',exact:true});
    await reset.click();await expect(reset).toHaveText('100%');
    const alignment=await page.locator('.workspace-footer').evaluate(el=>{
      const box=el.getBoundingClientRect(),middle=el.children[1].getBoundingClientRect();
      return {centre:box.x+box.width/2,readout:middle.x+middle.width/2};
    });expect(alignment.readout).toBeCloseTo(alignment.centre,1);
  }
});
