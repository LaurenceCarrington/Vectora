import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function point(page:any,x:number,y:number){return page.evaluate(([x,y]:number[])=>{const p=(window as any).__paper.view.projectToView(new (window as any).__paper.Point(x,y));return {x:p.x,y:p.y};},[x,y]);}
async function click(page:any,x:number,y:number){const p=await point(page,x,y);await page.mouse.click(p.x,p.y);}
async function tool(page:any,name:string){await page.getByRole('button',{name:'Dimensions and callouts',exact:true}).click();await page.getByRole('menuitemradio',{name,exact:false}).click();}
async function labels(page:any){return page.evaluate(async()=>{const {dimensionLayout}=await import('/src/dimensions.ts');return (window as any).__vectora.objects.filter((s:any)=>s.data.dimension).map((s:any)=>dimensionLayout(s.data.dimension).label);});}
test.beforeEach(async({page})=>{await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.snappingEnabled=false;p.view.center=new p.Point(100,80);});});
test('Dimension tools measure aligned, horizontal and vertical distances with undo and cancellation',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#cad-canvas').focus();await page.keyboard.press('d');
  await click(page,40,40);await click(page,70,80);await click(page,90,45);
  expect(await labels(page)).toEqual(['50 mm']);await expect(page.locator('#properties-panel')).toBeHidden();
  await tool(page,'Linear dimension');await click(page,40,40);await click(page,70,80);await click(page,55,110);
  expect(await labels(page)).toEqual(['50 mm','30 mm']);
  await tool(page,'Linear dimension');await click(page,40,40);await click(page,70,80);await click(page,110,60);
  expect(await labels(page)).toEqual(['50 mm','30 mm','40 mm']);
  await page.keyboard.press('Control+z');expect(await labels(page)).toEqual(['50 mm','30 mm']);await page.keyboard.press('Control+Shift+z');expect(await labels(page)).toHaveLength(3);
  await page.keyboard.press('d');await click(page,30,30);await page.keyboard.press('Escape');expect(await labels(page)).toHaveLength(3);
  await page.keyboard.press('k');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('dissect-delete');await page.keyboard.press('Shift+k');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('line-delete');
  expect(errors).toEqual([]);
});
test('Radial and diameter dimensions read circles and arcs and reject ellipses',async({page})=>{
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Circle({center:[80,70],radius:20,insert:false}),'Circle');e.addShape(new p.Path.Ellipse({rectangle:[130,50,40,20],insert:false}),'Ellipse');});
  await tool(page,'Radial dimension');await click(page,100,70);await click(page,120,95);expect(await labels(page)).toEqual(['R 20 mm']);
  await tool(page,'Diameter dimension');await click(page,60,70);await click(page,45,105);expect(await labels(page)).toEqual(['R 20 mm','Ø 40 mm']);
  await tool(page,'Radial dimension');await click(page,170,60);await expect(page.locator('.toast-warning')).toContainText('circle or circular arc');expect(await labels(page)).toHaveLength(2);
  const arc=await page.evaluate(async()=>{const {circleAt}=await import('/src/dimensions.ts');const p=(window as any).__paper,e=(window as any).__vectora;const a=new p.Path.Arc({from:[30,40],through:[40,30],to:[50,40],insert:false});a.data.arc={cx:40,cy:40,radius:10,start:180,sweep:180};e.addShape(a,'Arc');const picked=circleAt(e.objects,new p.Point(40,30),1);return picked?.radius;});expect(arc).toBe(10);
});
test('Leader callouts edit text, survive duplication and export as annotations without cut geometry',async({page})=>{
  await tool(page,'Leader callout');await click(page,60,60);await click(page,85,40);await click(page,110,40);
  const form=page.getByRole('form',{name:'Leader callout text'});await expect(form).toBeVisible();await form.getByRole('textbox').fill('Apply vinyl here');await form.getByRole('button',{name:'Done'}).click();
  expect(await labels(page)).toEqual(['Apply vinyl here']);
  const labelPoint=await page.evaluate(async()=>{const {dimensionLabel}=await import('/src/dimensions.ts'),e=(window as any).__vectora,p=(window as any).__paper,label=dimensionLabel(e.selected)!,point=p.view.projectToView(label.bounds.center);label.remove();return {x:point.x,y:point.y};});await page.mouse.dblclick(labelPoint.x,labelPoint.y);await form.getByRole('textbox').fill('Cut carefully');await form.getByRole('button',{name:'Done'}).click();expect(await labels(page)).toEqual(['Cut carefully']);
  await page.evaluate(()=>(window as any).__vectora.duplicateSelection());expect(await labels(page)).toEqual(['Cut carefully','Cut carefully']);
  const report=await page.evaluate(async()=>{const e=(window as any).__vectora,{exportDXF}=await import('/src/exportDXF.ts');let cutError='';try{exportDXF(e.objects);}catch(error){cutError=(error as Error).message;}return {dxf:exportDXF(e.objects,true),cutError,nodeEditable:e.canJoinSelection,explode:e.canExplodeSelection,cut:e.canMoveSelectionToCutPath};});
  expect(report.dxf).toContain('8\nANNOTATIONS\n');expect(report.dxf.match(/0\nTEXT\n/g)).toHaveLength(2);expect(report.dxf).toContain('1\nCut carefully\n');expect(report.cutError).toContain('no cut lines');expect(report.explode).toBe(false);expect(report.cut).toBe(false);
  await page.keyboard.press('Control+z');expect(await labels(page)).toHaveLength(1);await page.keyboard.press('Control+z');expect(await labels(page)).toEqual(['Apply vinyl here']);
  await tool(page,'Leader callout');await click(page,50,100);await click(page,80,90);await click(page,110,90);await form.getByRole('textbox').fill('Cancel me');await page.keyboard.press('Escape');expect(await labels(page)).toEqual(['Apply vinyl here']);
  await page.screenshot({path:'test-results/dimensions-callout.png'});
});
test('Dimension labels remain accurate through transforms and the toolbar matches the reference',async({page})=>{
  await page.keyboard.press('d');await click(page,40,40);await click(page,90,40);await click(page,65,65);
  const report=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{dimensionLayout}=await import('/src/dimensions.ts');const before=dimensionLayout(e.selected.data.dimension).label;e.duplicateSelection();e.flipSelection('horizontal');const after=dimensionLayout(e.selected.data.dimension).label;return {before,after,position:e.selected.data.dimension.transform,labels:e.overlays.children.filter((s:any)=>s instanceof p.PointText).map((s:any)=>s.content)};});
  expect(report.before).toBe('50 mm');expect(report.after).toBe('50 mm');expect(report.labels).toContain('50 mm');
  await tool(page,'Aligned dimension');await page.getByRole('button',{name:'Dimensions and callouts',exact:true}).click();await expect(page.locator('#primary-dimensions-menu [role=menuitemradio]')).toHaveCount(5);
  await page.screenshot({path:'test-results/dimensions-menu.png'});
});

test('Dimension placement snaps to millimetres and its pop-out fits a short narrow viewport',async({page})=>{
  await page.evaluate(()=>(window as any).__vectora.setSnappingEnabled(true));
  await page.keyboard.press('d');await click(page,40.4,40.3);await click(page,70.2,80.4);await click(page,95,50);
  expect(await labels(page)).toEqual(['50 mm']);
  expect(await page.evaluate(()=>(window as any).__vectora.selected.data.dimension.points.slice(0,2))).toEqual([[40,40],[70,80]]);
  await page.setViewportSize({width:420,height:600});
  await page.getByRole('button',{name:'Dimensions and callouts',exact:true}).click();
  const box=(await page.locator('#primary-dimensions-menu').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(24);expect(box.y).toBeGreaterThanOrEqual(24);expect(box.x+box.width).toBeLessThanOrEqual(396);expect(box.y+box.height).toBeLessThanOrEqual(576);
  await page.keyboard.press('End');await expect(page.getByRole('menuitemradio',{name:'Leader callout',exact:true})).toBeFocused();await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('leader');
  await page.getByRole('button',{name:'Dimensions and callouts',exact:true}).click();await page.screenshot({path:'test-results/dimensions-small-screen.png'});
});
