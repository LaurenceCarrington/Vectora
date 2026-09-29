import {test,expect} from '@playwright/test';

const DEV='http://127.0.0.1:5174';

test('laser settings are document history with exact defaults and new-document reset',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(()=>{
  const editor=(window as any).__vectora;
  const initial=structuredClone(editor.laserJobSettings);
  editor.setLaserJobSettings({bedWidthMM:600,bedHeightMM:400,kerfMM:0.18,order:'cut-engrave'});
  const changed=structuredClone(editor.laserJobSettings);
  editor.undo();const undone=structuredClone(editor.laserJobSettings);
  editor.redo();const redone=structuredClone(editor.laserJobSettings);
  editor.newDocument();const fresh=structuredClone(editor.laserJobSettings);
  return {initial,changed,undone,redone,fresh};
 });
 expect(result).toEqual({
  initial:{bedWidthMM:300,bedHeightMM:200,kerfMM:0,order:'engrave-cut'},
  changed:{bedWidthMM:600,bedHeightMM:400,kerfMM:0.18,order:'cut-engrave'},
  undone:{bedWidthMM:300,bedHeightMM:200,kerfMM:0,order:'engrave-cut'},
  redone:{bedWidthMM:600,bedHeightMM:400,kerfMM:0.18,order:'cut-engrave'},
  fresh:{bedWidthMM:300,bedHeightMM:200,kerfMM:0,order:'engrave-cut'}
 });
});

test('preflight finds open and duplicate cuts while accepting open engraving',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const editor=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  editor.newDocument();editor.setActiveLayer('cutline');
  editor.addShape(new p.Path({insert:false,segments:[[0,0],[20,0]]}),'Open cut');
  editor.addShape(new p.Path({insert:false,closed:true,segments:[[10,10],[20,10],[20,20],[10,20]]}),'Original');
  editor.addShape(new p.Path({insert:false,closed:true,segments:[[20,20],[20,10],[10,10],[10,20]]}),'Reversed duplicate');
  editor.addShape(new p.Path({insert:false,closed:true,segments:[[11,10],[21,10],[21,20],[11,20]]}),'Overlap only');
  editor.setActiveLayer('engrave');editor.addShape(new p.Path({insert:false,segments:[[0,30],[20,30]]}),'Open engraving');
  editor.setLayerState('cutline','visible',false);editor.setLayerState('cutline','locked',true);
  const before=JSON.stringify(editor.snapshot());
  const report=analyzeLaserJob(editor.objects,editor.laserJobSettings);
  return {codes:report.issues.map((issue:any)=>issue.code),paths:report.paths.length,cut:report.paths.filter((path:any)=>path.role==='cutline').length,engrave:report.paths.filter((path:any)=>path.role==='engrave').length,complete:report.complete,unchanged:before===JSON.stringify(editor.snapshot())};
 });
 expect(result.complete).toBe(true);expect(result.unchanged).toBe(true);
 expect(result.paths).toBe(5);expect(result.cut).toBe(4);expect(result.engrave).toBe(1);
 expect(result.codes.filter((code:string)=>code==='open-cut')).toHaveLength(1);
 expect(result.codes.filter((code:string)=>code==='duplicate-cut')).toHaveLength(1);
});

test('preflight compares true-size bed extents including kerf and warns about fill-only engraving',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const editor=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  editor.newDocument();const empty=analyzeLaserJob(editor.objects,editor.laserJobSettings);
  editor.setActiveLayer('cutline');editor.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,99.8,40]}),'Almost fits');
  editor.setActiveLayer('engrave');const fill=new p.Path.Rectangle({insert:false,rectangle:[10,10,20,20],fillColor:'#0000ff'});fill.data.rasterTrace={mode:'fill'};editor.addShape(fill,'Filled engraving');
  const report=analyzeLaserJob(editor.objects,{bedWidthMM:100,bedHeightMM:100,kerfMM:0.4,order:'engrave-cut'});
  return {empty:empty.issues.map((x:any)=>x.code),issues:report.issues.map((x:any)=>x.code),width:report.bounds.width,engraveLength:report.engraveLengthMM};
 });
 expect(result.empty).toContain('empty-job');expect(result.issues).toContain('bed-too-small');expect(result.issues).toContain('filled-engrave');
 expect(result.width).toBeCloseTo(99.8);expect(result.engraveLength).toBeCloseTo(80);
});

test('degenerate cuts and excessive segments prevent an all-clear result without hanging',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const editor=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  editor.newDocument();editor.setActiveLayer('cutline');editor.addShape(new p.Path({insert:false,closed:true,segments:[[0,0],[10,0],[20,0]]}),'Flat contour');
  const degenerate=analyzeLaserJob(editor.objects,editor.laserJobSettings);
  const dense=new p.Path({insert:false,closed:false,segments:Array.from({length:20001},(_,i)=>[i/100,50])});dense.data={uid:'dense',name:'Dense cut',role:'cutline'};editor.cutlines.addChild(dense);
  const start=performance.now(),large=analyzeLaserJob(editor.objects,editor.laserJobSettings),elapsed=performance.now()-start;
  return {degenerate:degenerate.issues.map((x:any)=>x.code),large:large.issues.map((x:any)=>x.code),complete:large.complete,elapsed};
 });
 expect(result.degenerate).toContain('degenerate-cut');expect(result.complete).toBe(false);expect(result.large).toContain('analysis-limit');expect(result.elapsed).toBeLessThan(1500);
});

test('laser dialog previews true-size operations, stages and visual kerf without editing paths',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(()=>{const editor=(window as any).__vectora,p=(window as any).__paper;editor.newDocument();editor.setActiveLayer('cutline');editor.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,10,100,50]}),'Cut panel');editor.setActiveLayer('engrave');editor.addShape(new p.Path({insert:false,segments:[[20,20],[80,20]]}),'Engrave line');});
 const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.objects.map((item:any)=>item.exportJSON())));
 const trigger=page.getByRole('button',{name:'Laser preflight',exact:true});await trigger.click();
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});await expect(dialog).toBeVisible();
 await expect(dialog.locator('[data-laser-bed-width]')).toHaveValue('300');await expect(dialog.locator('[data-laser-bed-height]')).toHaveValue('200');
 await expect(dialog.locator('.laser-bed')).toHaveAttribute('width','300');await expect(dialog.locator('.laser-bed')).toHaveAttribute('height','200');
 await expect(dialog.locator('.laser-operation-path[data-operation="cutline"]')).toHaveCount(1);
 await expect(dialog.locator('.laser-operation-path[data-operation="engrave"]')).toHaveCount(1);
 expect(await dialog.locator('[data-laser-stage] option').allTextContents()).toEqual(['All operations','Step 1 · Engrave','Step 2 · Cut']);
 await dialog.locator('[data-laser-order]').selectOption('cut-engrave');
 expect(await dialog.locator('[data-laser-stage] option').allTextContents()).toEqual(['All operations','Step 1 · Cut','Step 2 · Engrave']);
 await dialog.screenshot({path:'test-results/laser-preflight-dark.png'});
 await dialog.locator('[data-laser-kerf]').fill('0.2');await dialog.locator('[data-laser-kerf]').dispatchEvent('change');
 await expect(dialog.locator('[data-kerf-band]')).toHaveAttribute('stroke-width','0.2');
 await dialog.locator('[data-laser-stage]').selectOption('cutline');await expect(dialog.locator('.laser-operation-path[data-operation="engrave"]')).toHaveClass(/is-dimmed/);
 await dialog.locator('[data-laser-kerf-overlay]').uncheck();await expect(dialog.locator('[data-kerf-band]')).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.objects.map((item:any)=>item.exportJSON())))).toBe(before);
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
});

test('laser warnings focus paths and invalid settings do not overwrite saved values',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const editor=(window as any).__vectora,p=(window as any).__paper;editor.newDocument();editor.setActiveLayer('cutline');editor.addShape(new p.Path({insert:false,segments:[[5,5],[25,5]]}),'Open cut');});
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Laser preflight'});
 await expect(dialog.getByText(/open; the cut may not separate/)).toBeVisible();await dialog.getByRole('button',{name:/Open cut is open/}).click();
 await expect(dialog.locator('.laser-operation-path.is-highlighted')).toHaveCount(1);
 await dialog.locator('[data-laser-bed-width]').fill('0');await dialog.locator('[data-laser-bed-width]').dispatchEvent('change');
 await expect(dialog.locator('[data-laser-bed-width]')).toHaveAttribute('aria-invalid','true');
 expect(await page.evaluate(()=>(window as any).__vectora.laserJobSettings.bedWidthMM)).toBe(300);
});

test('laser preview opens from search, fits narrow screens and reports incomplete analysis',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const editor=(window as any).__vectora,p=(window as any).__paper;editor.newDocument();const dense=new p.Path({insert:false,segments:Array.from({length:20001},(_,i)=>[i/100,10])});dense.data={uid:'dense',name:'Dense',role:'cutline'};editor.cutlines.addChild(dense);});
 await page.setViewportSize({width:390,height:650});await page.getByRole('button',{name:'Search tools'}).click();const search=page.getByRole('dialog',{name:'Search tools'});await search.getByRole('combobox').fill('laser preflight');await search.getByRole('option',{name:/Laser preflight/}).click();
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('too many path segments');
 const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(650);
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');await page.evaluate(()=>{localStorage.setItem('vectora.theme','light');});await page.reload();
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();await expect(dialog).toHaveCSS('background-color','rgb(245, 246, 248)');await dialog.screenshot({path:'test-results/laser-preflight-light-narrow.png'});
});
