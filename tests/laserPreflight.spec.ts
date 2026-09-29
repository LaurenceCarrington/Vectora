import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

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
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('too many contours or path segments');
 const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(650);
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');await page.evaluate(()=>{localStorage.setItem('vectora.theme','light');});await page.reload();
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();await expect(dialog).toHaveCSS('background-color','rgb(245, 246, 248)');await dialog.screenshot({path:'test-results/laser-preflight-light-narrow.png'});
});

test('laser handoff selects exactly Cut and Engrave and exports original coordinates',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();
  e.setActiveLayer('cutline');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,20]}),'Cut');
  e.setActiveLayer('engrave');e.addShape(new p.Path({insert:false,segments:[[15,25],[35,25]]}),'Engrave');
  e.setActiveLayer('artwork');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[300,300,30,30]}),'Artwork');
  e.setActiveLayer('construction');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[400,400,30,30]}),'Guide');
  e.setLayerState('cutline','visible',false);e.setLayerState('engrave','locked',true);
 });
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();const preflight=page.getByRole('dialog',{name:'Laser preflight'});
 await expect(preflight.locator('.laser-operation-path')).toHaveCount(2);
 await expect(preflight.locator('.laser-footer')).toContainText('set operation order and kerf in laser software');
 await preflight.locator('[data-laser-kerf]').fill('0.8');await preflight.locator('[data-laser-kerf]').dispatchEvent('change');
 await preflight.getByRole('button',{name:'Continue to DXF export'}).click();await expect(preflight).toBeHidden();
 const exportDialog=page.getByRole('dialog',{name:'Export',exact:true});await expect(exportDialog).toBeVisible();
 await expect(exportDialog.getByLabel('Compatibility',{exact:true})).toHaveValue('laser');await exportDialog.getByText('Advanced',{exact:true}).click();
 await expect(exportDialog.getByLabel('Cut Path',{exact:true})).toBeChecked();await expect(exportDialog.getByLabel('Engrave Path',{exact:true})).toBeChecked();
 await expect(exportDialog.getByLabel('Artwork',{exact:true})).not.toBeChecked();await expect(exportDialog.getByLabel('Construction Path',{exact:true})).toHaveCount(0);
 const pending=page.waitForEvent('download');await exportDialog.getByRole('button',{name:'Export DXF'}).click();
 const dxf=readFileSync((await (await pending).path())!,'utf8');expect(dxf).toContain('AC1009');expect(dxf).toContain('\r\n8\r\nCUTLINE\r\n');expect(dxf).toContain('\r\n8\r\nENGRAVE\r\n');expect(dxf).not.toContain('ARTWORK');expect(dxf).not.toContain('CONSTRUCTION');
 const lines=dxf.split('\r\n'),cutXs:number[]=[];for(let i=0;i<lines.length-3;i++)if(lines[i]==='8'&&lines[i+1]==='CUTLINE'){
  for(let j=i+2;j<Math.min(i+30,lines.length-1)&&lines[j]!=='0';j+=2)if(lines[j]==='10'||lines[j]==='11')cutXs.push(Number(lines[j+1]));
 }
 expect(cutXs).toContain(10);expect(cutXs).toContain(50);expect(cutXs).not.toContain(9.6);expect(cutXs).not.toContain(50.4);
});

test('empty laser jobs cannot continue to export',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'Laser preflight',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});await expect(dialog).toContainText('Add a Cut Path or Engrave Path');
 await expect(dialog.getByRole('button',{name:'Continue to DXF export'})).toBeDisabled();
});

test('laser handoff resets a previous Selection export to the checked drawing',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('cutline');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,10,10,10]}),'Selected');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[50,10,10,10]}),'Other');
  e.select(e.objects[0]);
 });
 await page.getByRole('button',{name:'File'}).click();
 await page.getByRole('menuitem',{name:/Export/}).first().click();
 const exportDialog=page.getByRole('dialog',{name:'Export',exact:true});
 await exportDialog.getByLabel('Export area').selectOption('selection');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();
 const preflight=page.getByRole('dialog',{name:'Laser preflight'});
 await expect(preflight.locator('.laser-operation-path')).toHaveCount(2);
 await preflight.getByRole('button',{name:'Continue to DXF export'}).click();
 await expect(exportDialog.getByLabel('Export area')).toHaveValue('drawing');
});

test('preflight detects reversed duplicate open cuts and accepts two-anchor cubic loops',async({page})=>{
 await page.goto(DEV);
 const codes=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  e.newDocument();e.setActiveLayer('cutline');
  e.addShape(new p.Path({insert:false,segments:[[0,0],[10,0]]}),'Open A');
  e.addShape(new p.Path({insert:false,segments:[[10,0],[0,0]]}),'Open B');
  const oval=new p.Path({insert:false,closed:true});
  oval.add(new p.Segment(new p.Point(30,10),new p.Point(0,-10),new p.Point(0,10)));
  oval.add(new p.Segment(new p.Point(50,10),new p.Point(0,10),new p.Point(0,-10)));
  e.addShape(oval,'Two-anchor oval');
  return analyzeLaserJob(e.objects,e.laserJobSettings).issues.map((issue:any)=>({code:issue.code,message:issue.message}));
 });
 expect(codes.filter((issue:any)=>issue.code==='duplicate-cut')).toHaveLength(1);
 expect(codes.filter((issue:any)=>issue.code==='degenerate-cut')).toHaveLength(0);
});

test('kerf affects Cut extents but not an engraving-only bed fit',async({page})=>{
 await page.goto(DEV);
 const codes=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  e.newDocument();e.setActiveLayer('engrave');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,300,200]}),'Full bed engraving');
  return analyzeLaserJob(e.objects,{bedWidthMM:300,bedHeightMM:200,kerfMM:1,order:'engrave-cut'}).issues.map((issue:any)=>issue.code);
 });
 expect(codes).not.toContain('bed-too-small');
});

test('preflight caps a large number of empty contours independently of segment count',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {analyzeLaserJob}=await import('/src/laserPreflight.ts' as string);
  const compound=new p.CompoundPath({insert:false});
  for(let index=0;index<5001;index++)compound.addChild(new p.Path({insert:false}));
  compound.data.uid='many-empty';e.cutlines.addChild(compound);
  const report=analyzeLaserJob([compound],e.laserJobSettings);compound.remove();
  return {complete:report.complete,codes:report.issues.map((issue:any)=>issue.code)};
 });
 expect(result.complete).toBe(false);expect(result.codes).toContain('analysis-limit');
});

test('filled engraving compound preview preserves an inner hole',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('engrave');
  const ring=new p.CompoundPath({insert:false,fillColor:'#0000ff'});
  ring.addChild(new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40]}));
  ring.addChild(new p.Path.Rectangle({insert:false,rectangle:[10,10,20,20]}));
  ring.data.rasterTrace={mode:'fill'};e.addShape(ring,'Ring engraving');
 });
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});
 await expect(dialog.locator('.laser-engrave.is-filled')).toHaveCount(1);
 const fill=dialog.locator('.laser-engrave.is-filled');
 expect(((await fill.getAttribute('d'))??'').match(/M(?=[-\d.])/gi)?.length).toBe(2);
 expect(await fill.evaluate((element:any)=>element.isPointInFill(new DOMPoint(20,20)))).toBe(false);
});

test('reopening preflight clears stale field errors and does not permit export before analysis',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('cutline');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,10,10]}),'Cut');});
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Laser preflight'});
 await expect(dialog.getByRole('button',{name:'Continue to DXF export'})).toBeEnabled();
 await dialog.locator('[data-laser-bed-width]').fill('0');await dialog.locator('[data-laser-bed-width]').dispatchEvent('change');
 await expect(dialog.locator('.laser-field-error')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Continue to DXF export'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Close laser preflight'}).click();
 await page.getByRole('button',{name:'Laser preflight',exact:true}).click();
 await expect(dialog.locator('.laser-field-error')).toBeHidden();
 await expect(dialog.locator('[data-laser-bed-width]')).toHaveAttribute('aria-invalid','false');
});
