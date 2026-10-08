import { test, expect, type Locator } from './fixtures';
const DEV='http://127.0.0.1:5174';
async function appearance(page:any){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();}
async function renderedContrast(locator:Locator):Promise<number>{
  return locator.evaluate(el=>{
    const styles=getComputedStyle(el);
    const luminance=(colour:string)=>{
      const c=colour.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
      return .2126*c[0]+.7152*c[1]+.0722*c[2];
    };
    const a=luminance(styles.color),b=luminance(styles.backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
}

test('High contrast keeps hovered and keyboard-focused navigation controls readable',async({page})=>{
  await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[20,20,40,30],insert:false}),'Panel');});
  await appearance(page);await page.locator('[name="appearance-theme"][value="high-contrast"]').check();
  const general=page.getByRole('tab',{name:'General',exact:true});await general.hover();
  expect(await renderedContrast(general)).toBeGreaterThanOrEqual(7);
  await page.keyboard.press('Escape');
  // Native dialog closure restores focus before the queued close handler runs.
  // Wait for that handler as well, so it cannot steal the next field's focus.
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  const name=page.locator('.document-name');await name.focus();
  await expect(name).toBeFocused();
  await expect(name).toHaveCSS('outline-style','solid');await expect(name).toHaveCSS('outline-width','3px');
  const file=page.getByRole('button',{name:'File',exact:true});await file.focus();await file.press('Enter');
  const row=page.locator('.file-dropdown .dropdown-option').first();await row.focus();
  expect(await renderedContrast(row)).toBeGreaterThanOrEqual(7);
  await expect(row.locator('kbd')).toHaveCSS('color','rgb(0, 0, 0)');
  await page.keyboard.press('Escape');
  const grip=page.locator('#selection-menu-grip');await grip.focus();
  expect(await renderedContrast(grip)).toBeGreaterThanOrEqual(3);
});

test('High contrast gives semantic actions and reference specimens readable foregrounds',async({page})=>{
  await page.goto(DEV+'/reference/design-system.html');await appearance(page);
  await page.locator('[name="appearance-theme"][value="high-contrast"]').check();await page.keyboard.press('Escape');
  for(const selector of ['.semantic-examples .button--danger','.semantic-examples .button--warning','pre']){
    expect(await renderedContrast(page.locator(selector).first()),selector).toBeGreaterThanOrEqual(7);
  }
  expect(await renderedContrast(page.locator('.icon-specimen').first())).toBeGreaterThanOrEqual(3);
});

test('High contrast is keyboard accessible, keeps artwork and history intact, and remembers the theme',async({page})=>{
  await page.goto(DEV);
  const before=await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.Path.Rectangle({rectangle:[20,20,80,50],strokeColor:'#FFFFFF',insert:false}),'Panel');
    e.addShape(new p.Path.Circle({center:[140,60],radius:15,fillColor:'#00FFFF',data:{regionFill:true,customColour:'#00FFFF',rasterTrace:{mode:'fill'}},insert:false}),'Custom fill');
    return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo};
  });
  await appearance(page);
  const highContrast=page.locator('[name="appearance-theme"][value="high-contrast"]');
  await highContrast.focus();await highContrast.press('Space');
  await expect(highContrast).toBeChecked();
  await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#preferences-shell')).toHaveCSS('color','rgb(0, 0, 0)');
  await expect(page.locator('#preferences-shell')).toHaveCSS('border-color','rgb(0, 0, 0)');
  await expect(highContrast.locator('..')).toHaveCSS('outline-width','3px');
  await expect(highContrast.locator('..')).toHaveCSS('outline-color','rgb(0, 95, 204)');
  await expect(page.locator('.ruler-bottom')).toHaveCSS('background-color','rgb(255, 255, 255)');
  const after=await page.evaluate(()=>{
    const e=(window as any).__vectora;return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo,stroke:e.objects[0].strokeColor.toCSS(true),fill:e.objects[1].fillColor.toCSS(true),grid:e.grid.layer.children[0].strokeColor.toCSS(true)};
  });
  expect({snapshot:after.snapshot,undo:after.undo,redo:after.redo}).toEqual(before);
  expect(after.stroke).toBe('#383838');expect(after.fill).toBe('#00ffff');
  // Visible grid lines must contrast at least 3:1 against the white canvas.
  const rgb=after.grid.slice(1).match(/../g)!.map((value:string)=>parseInt(value,16)/255);
  const linear=rgb.map((v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  expect(1.05/(.2126*linear[0]+.7152*linear[1]+.0722*linear[2]+.05)).toBeGreaterThanOrEqual(3);
  await page.screenshot({path:'test-results/high-contrast-appearance.png'});
  await page.keyboard.press('Escape');await expect(page.locator('#workspace')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','high-contrast');
  await appearance(page);await expect(highContrast).toBeChecked();
  await page.locator('[name="appearance-theme"][value="dark"]').check();
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].strokeColor.toCSS(true))).toBe('#ffffff');
  await page.locator('[name="appearance-theme"][value="light"]').check();
  await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(255, 255, 255)');
});

test('High contrast works in the reference and production, including compact settings and empty 3D preview',async({page})=>{
  for(const url of [DEV+'/reference/design-system.html','http://127.0.0.1:4173']){
    await page.goto(url);await appearance(page);
    await page.locator('[name="appearance-theme"][value="high-contrast"]').check();
    await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await expect(page.locator('#preferences-shell')).toHaveCSS('color','rgb(0, 0, 0)');
    await page.setViewportSize({width:390,height:750});
    expect(await page.locator('#preferences-shell').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});
    await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','high-contrast');
    await appearance(page);await expect(page.locator('[name="appearance-theme"][value="high-contrast"]')).toBeChecked();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Preview',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Material & process preview'});
    if(url.includes('/reference/'))await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
    else {
      await expect(dialog.locator('[data-preview-status]')).toHaveText('No material to preview');
      await expect(dialog.locator('[data-preview-message]')).toHaveCSS('background-color','rgb(255, 255, 255)');
      await expect(dialog.locator('[data-preview-message]')).toHaveCSS('color','rgb(0, 0, 0)');
    }
    await expect(dialog.locator('.material-preview-viewport')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await expect(dialog.getByRole('button',{name:'Top view',exact:true})).toHaveCSS('color','rgb(0, 0, 0)');
    await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
  }
});

test('Light mode themes the workspace and neutral artwork without changing document history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const before=await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.Path.Rectangle({rectangle:[50,40,60,30],strokeColor:'#FFFFFF',insert:false}),'Rectangle');
    e.addShape(new p.Path.Circle({center:[140,60],radius:15,fillColor:'#FFFFFF',data:{regionFill:true,rasterTrace:{mode:"fill"}},insert:false}),'Custom white fill');
    const {loadTextFont}=await import('/src/text.ts');await loadTextFont('lato');e.saveText('Text',10,new p.Point(100,110),null,'lato');
    return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo};
  });
  await appearance(page);await page.locator('[name="appearance-theme"][value="light"]').check();
  await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('#preferences-shell')).toHaveCSS('color','rgb(37, 42, 48)');
  await expect(page.locator('.ruler-bottom')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.screenshot({path:'test-results/light-appearance.png'});
  const after=await page.evaluate(()=>{
    const e=(window as any).__vectora;return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo,stroke:e.objects[0].strokeColor.toCSS(true),fill:e.objects[1].fillColor.toCSS(true),grid:e.grid.layer.children[0].strokeColor.toCSS(true),text:e.objects[2].fillColor.toCSS(true)};
  });
  expect(after.snapshot).toBe(before.snapshot);expect(after.undo).toBe(before.undo);expect(after.redo).toBe(before.redo);
  expect(after.stroke).toBe('#383838');expect(after.text).toBe('#383838');expect(after.fill).toBe('#ffffff');expect(['#e9edf3','#ccd5e1']).toContain(after.grid);
  await page.keyboard.press('Escape');await expect(page.locator('[aria-label="Select"]')).toHaveCSS('background-color','rgb(237, 242, 255)');await page.screenshot({path:'test-results/light-workspace.png'});
  await page.evaluate(()=>{const e=(window as any).__vectora;e.undo();e.redo();});
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].strokeColor.toCSS(true))).toBe('#383838');
  await appearance(page);await page.locator('[name="appearance-theme"][value="dark"]').check();
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].strokeColor.toCSS(true))).toBe('#ffffff');
  await expect(page.locator('#workspace')).toHaveCSS('background-color','rgb(32, 34, 38)');
  await page.locator('[name="appearance-theme"][value="light"]').check();await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await appearance(page);await expect(page.locator('[name="appearance-theme"][value="light"]')).toBeChecked();
  expect(errors).toEqual([]);
});

test('Light mode works in the reference, narrow layouts and production build',async({page})=>{
  for(const url of [DEV+'/reference/design-system.html','http://127.0.0.1:4173']){
    await page.goto(url);await appearance(page);await page.locator('[name="appearance-theme"][value="light"]').check();
    await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await page.setViewportSize({width:390,height:750});
    expect(await page.locator('#preferences-shell').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});
  }
});
