import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';

test('Fill isolates overlapping rectangles and preserves original geometry',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{regionAt}=await import('/src/regionFill.ts');for(const rect of [[0,0,40,40],[20,20,40,40]])e.addShape(new p.Path.Rectangle({insert:false,rectangle:rect}),'Rectangle');const before=e.snapshot();const overlap=regionAt(e.objects,new p.Point(30,30))!,corner=regionAt(e.objects,new p.Point(10,10))!,outside=regionAt(e.objects,new p.Point(90,90));const result={overlap:Number(overlap.area.toFixed(8)),corner:Number(corner.area.toFixed(8)),inside:overlap.contains(new p.Point(30,30)),outside:overlap.contains(new p.Point(10,10)),empty:outside===null,unchanged:JSON.stringify(before)===JSON.stringify(e.snapshot())};overlap.remove();corner.remove();return result;});expect(result).toEqual({overlap:400,corner:1200,inside:true,outside:false,empty:true,unchanged:true});
});

test('Fill follows curved intersections and leaves nested interiors as separate regions',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{regionAt}=await import('/src/regionFill.ts');e.addShape(new p.Path.Circle({insert:false,center:[0,0],radius:20}),'Circle');e.addShape(new p.Path.Line({insert:false,from:[0,-30],to:[0,30]}),'Line');const half=regionAt(e.objects,new p.Point(10,0))!,halfArea=half.area,curved=(half instanceof p.Path?half.segments:half.children.flatMap((x:any)=>x.segments)).some((s:any)=>s.handleIn.length||s.handleOut.length);half.remove();e.objects[1].remove();e.addShape(new p.Path.Circle({insert:false,center:[0,0],radius:10}),'Circle');const ring=regionAt(e.objects,new p.Point(15,0))!,centre=regionAt(e.objects,new p.Point(0,0))!;const result={halfArea,curved,ringArea:ring.area,hole:ring.contains(new p.Point(0,0)),centreArea:centre.area};ring.remove();centre.remove();return result;});expect(result.halfArea).toBeCloseTo(628.49,1);expect(result.curved).toBe(true);expect(result.ringArea).toBeCloseTo(942.74,1);expect(result.hole).toBe(false);expect(result.centreArea).toBeCloseTo(314.25,1);
});

test('Fill finds regions formed by separate lines, ignores dangling branches and does not bridge gaps',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{regionAt}=await import('/src/regionFill.ts');for(const [from,to] of [[[0,0],[40,0]],[[40,0],[40,40]],[[40,40],[0,40]],[[0,40],[0,0]],[[0,20],[10,20]],[[0,0],[40,0]]])e.addShape(new p.Path.Line({insert:false,from,to}),'Line');const region=regionAt(e.objects,new p.Point(20,20))!,area=region.area;region.remove();e.objects[2].remove();const open=regionAt(e.objects,new p.Point(20,20));return {area,open:open===null};});expect(result).toEqual({area:1600,open:true});
});

test('Colour fill toolbar picks colours, fills only the clicked region and recolours with undo',async({page})=>{
  await page.goto(DEV);const click=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;const start=p.view.viewToProject(new p.Point(360,310));for(const offset of [[0,0],[20,20]])e.addShape(new p.Path.Rectangle({insert:false,rectangle:[start.x+offset[0],start.y+offset[1],40,40],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');const point=p.view.projectToView(start.add([30,30]));return {x:point.x,y:point.y};});
  await page.getByRole('button',{name:'Colour fill',exact:true}).click();await expect(page.getByRole('dialog',{name:'Fill colour',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();const menu=page.getByRole('region',{name:'Fill & appearance',exact:true});await menu.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#0000FF');await menu.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');const box=(await page.locator('#cad-canvas').boundingBox())!;await page.mouse.click(box.x+click.x,box.y+click.y);
  expect(await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {count:e.objects.length,name:s.data.name,color:s.fillColor.toCSS(true),area:Number(s.area.toFixed(8)),stroke:s.strokeColor,tool:e.tool,originals:e.objects.filter((x:any)=>!x.data.regionFill).every((x:any)=>!x.fillColor)};})).toEqual({count:3,name:'Colour fill',color:'#0000ff',area:400,stroke:null,tool:'fill',originals:true});await expect(page.locator('#properties-panel')).toBeHidden();
  await menu.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#E99A42');await menu.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');await page.locator('#cad-canvas').focus();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);expect(await page.evaluate(()=>(window as any).__vectora.selected.fillColor.toCSS(true))).toBe('#e99a42');
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.selected.fillColor.toCSS(true))).toBe('#0000ff');await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(3);await page.screenshot({path:'test-results/colour-fill.png'});
});

test('Fill uses transformed and visible outlines, respects Artwork lock and recolours moved fill objects',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40]}),'Rectangle');e.artwork.children[0].rotate(30);e.setFillColor('#FF0000');e.fillAt(new p.Point(20,20));const fill=e.selected,first=fill.area;fill.translate([100,0]);e.setFillColor('#51966A');e.fillAt(new p.Point(120,20));const color=e.selected.fillColor.toCSS(true),count=e.objects.length;e.setLayerState('artwork','locked',true);let locked=false;try{e.fillAt(new p.Point(20,20));}catch{locked=true;}return {first,count,color,locked};});expect(result.first).toBeCloseTo(1600,6);expect(result.count).toBe(2);expect(result.color).toBe('#51966a');expect(result.locked).toBe(true);
});

test('Bucket boundary network handles intersecting circles, self crossings and hidden outlines',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{regionAt}=await import('/src/regionFill.ts');for(const x of [0,20])e.addShape(new p.Path.Circle({insert:false,center:[x,0],radius:20}),'Circle');const lens=regionAt(e.objects,new p.Point(10,0))!,a=lens.area,containsOutside=lens.contains(new p.Point(-10,0));lens.remove();e.objects.forEach((x:any)=>x.remove());e.addShape(new p.Path({insert:false,closed:true,segments:[[0,0],[40,40],[0,40],[40,0]]}),'Crossing');const triangle=regionAt(e.objects,new p.Point(20,5))!,b=triangle.area;triangle.remove();e.artwork.visible=false;return {a,b,containsOutside,hidden:regionAt(e.objects,new p.Point(20,5))===null};});expect(result.a).toBeCloseTo(491.5,0);expect(result.b).toBeCloseTo(400,6);expect(result.containsOutside).toBe(false);expect(result.hidden).toBe(true);
});

test('A new regional fill appears above an existing whole-object colour without changing outlines',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40],strokeColor:'#383838'}),'Rectangle');e.setFillColor('#FF0000');e.fillAt(new p.Point(10,10));const red=e.selected;e.addShape(new p.Path.Line({insert:false,from:[20,0],to:[20,40],strokeColor:'#383838'}),'Line');e.setFillColor('#2678A8');e.fillAt(new p.Point(10,10));return {area:e.selected.area,onTop:e.selected.index>red.index,count:e.objects.length,red:red.fillColor.toCSS(true),blue:e.selected.fillColor.toCSS(true)};});expect(result.area).toBeCloseTo(800,6);expect(result).toMatchObject({onTop:true,count:4,red:'#ff0000',blue:'#2678a8'});
});

test('Fill uses the right Colour panel in production and the reference, without a separate picker',async({page})=>{
  for(const url of [DEV+'/reference/design-system.html','http://127.0.0.1:4173']){
    await page.setViewportSize({width:420,height:700});await page.goto(url);
    await page.getByRole('button',{name:'Colour fill',exact:true}).click();
    await expect(page.locator('#primary-fill-menu')).toHaveCount(0);await expect(page.locator('[data-fill-picker],[data-fill-hex],[data-fill-colour]')).toHaveCount(0);
    await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();const panel=page.getByRole('region',{name:'Fill & appearance',exact:true});await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:'No fill',exact:true})).toHaveAttribute('aria-pressed','true');
    await panel.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#FF00FF');await panel.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');await expect(page.locator('.fill-tools')).not.toHaveClass(/is-no-fill/);expect(await page.locator('.fill-tools').evaluate(el=>getComputedStyle(el).getPropertyValue('--fill-colour').trim().toUpperCase())).toBe('#FF00FF');
    await panel.getByRole('button',{name:'No fill',exact:true}).click();await expect(page.locator('.fill-tools')).toHaveClass(/is-no-fill/);
  }
});

test('Fill activation and shortcut preserve the shared paint and opacity without opening a menu',async({page})=>{
  await page.goto(DEV);await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();await page.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#51966A');await page.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).fill('40');await page.getByRole('spinbutton',{name:'Opacity (%)',exact:true}).press('Enter');
  await page.getByRole('button',{name:'Close Fill & appearance panel',exact:true}).click();await page.getByRole('button',{name:'Colour fill',exact:true}).click();await page.keyboard.press('v');await page.keyboard.press('b');
  await expect(page.getByRole('button',{name:'Colour fill',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#colour-panel')).toBeHidden();await expect(page.locator('#primary-fill-menu')).toHaveCount(0);
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {tool:e.tool,colour:e.fillColor,opacity:e.fillOpacity,noFill:e.noFill};})).toEqual({tool:'fill',colour:'#51966A',opacity:.4,noFill:false});
});

test('Repeated curved fills stay within circle intersections and exclude disconnected regions',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{
    const p=(window as any).__paper,e=(window as any).__vectora,{regionAt}=await import('/src/regionFill.ts');
    e.addShape(new p.Path.Circle({insert:false,center:[27,31],radius:25}),'Circle');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-15,5,46,46]}),'Rectangle');e.addShape(new p.Path.Circle({insert:false,center:[1,35],radius:26}),'Circle');
    const sources=[...e.objects];e.setFillColor('#FF0000');e.fillAt(new p.Point(40.123,38.234));e.fillAt(new p.Point(32.123,27.234));const region=e.selected,point=new p.Point(32.123,27.234);let leaked=0;
    for(let x=-30;x<65;x+=2)for(let y=-5;y<65;y+=2){const q=new p.Point(x+.13,y+.17);if(region.contains(q)&&sources.some(item=>item.contains(q)!==item.contains(point)))leaked++;}
    const priorLeak=region.contains(new p.Point(13.13,11.17));
    e.objects.forEach((item:any)=>item.remove());for(const x of [0,20])e.addShape(new p.Path.Circle({insert:false,center:[x,0],radius:20}),'Circle');
    for(const xy of [[10,0],[-10,0],[30,0],[10,0]])e.fillAt(new p.Point(xy));const lens=e.selected;
    const circles={left:lens.contains(new p.Point(-10,0)),right:lens.contains(new p.Point(30,0)),centre:lens.contains(new p.Point(10,0)),area:lens.area};
    const onEdge=regionAt(e.objects,new p.Point(0,20))===null;
    e.objects.forEach((item:any)=>item.remove());e.addShape(new p.Path.Circle({insert:false,center:[0,0],radius:20}),'Circle');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-30,-5,60,10]}),'Rectangle');const top=regionAt(e.objects,new p.Point(0,-12))!;const disconnected=top.contains(new p.Point(0,12));top.remove();
    return {leaked,priorLeak,circles,onEdge,disconnected};
  });expect(result.leaked).toBe(0);expect(result.priorLeak).toBe(false);expect(result.circles).toMatchObject({left:false,right:false,centre:true});expect(result.circles.area).toBeCloseTo(491.5,0);expect(result.onEdge).toBe(true);expect(result.disconnected).toBe(false);
});

test('Nested and tangent circle boundaries keep all holes after filling',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Circle({insert:false,center:[18,32],radius:10}),'Circle');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-21,-5,58,58]}),'Rectangle');e.addShape(new p.Path.Circle({insert:false,center:[2,8],radius:13}),'Circle');e.setFillColor('#FF0000');e.fillAt(new p.Point(30.123,.234));const fill=e.selected;return {smallHole:fill.contains(new p.Point(18,32)),tangentHole:fill.contains(new p.Point(2,8)),clicked:fill.contains(new p.Point(30.123,.234)),area:fill.area};});expect(result).toMatchObject({smallHole:false,tangentHole:false,clicked:true});expect(result.area).toBeCloseTo(2518.674942515399,5);
});

test('No fill clears only the clicked curved region and all underlying colours, with undo and redo',async({page})=>{
  await page.goto(DEV);
  const result=await page.evaluate(()=>{
    const p=(window as any).__paper,e=(window as any).__vectora;
    e.addShape(new p.Path.Circle({insert:false,center:[0,0],radius:20,strokeColor:'#383838'}),'Circle');
    e.setFillColor('#FF0000');e.fillAt(new p.Point(0,0));
    e.addShape(new p.Path.Circle({insert:false,center:[20,0],radius:20,strokeColor:'#383838'}),'Circle');
    e.setFillColor('#0000FF');e.fillAt(new p.Point(10,0));
    const before=e.snapshot(),outlines=e.objects.filter((x:any)=>!x.data.regionFill).map((x:any)=>x.exportJSON());
    e.setFillColor('none');e.fillAt(new p.Point(10,0));
    const fills=e.objects.filter((x:any)=>x.fillColor),after=e.snapshot();
    const answer={cleared:fills.every((x:any)=>!x.contains(new p.Point(10,0))),neighbour:fills.some((x:any)=>x.contains(new p.Point(-10,0))&&x.fillColor.toCSS(true)==='#ff0000'),unchanged:JSON.stringify(outlines)===JSON.stringify(e.objects.filter((x:any)=>!x.data.regionFill).map((x:any)=>x.exportJSON())),before,after};
    e.fillAt(new p.Point(10,0));return {...answer,noOp:JSON.stringify(after)===JSON.stringify(e.snapshot())};
  });
  expect(result).toMatchObject({cleared:true,neighbour:true,unchanged:true,noOp:true});
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(result.before);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(result.after);
});

test('No fill swatch clears a whole fill from the canvas and a colour exits clearing mode',async({page})=>{
  await page.goto(DEV);
  const point=await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora,start=p.view.viewToProject(new p.Point(380,330));e.addShape(new p.Path.Rectangle({insert:false,rectangle:[start.x,start.y,30,30],strokeColor:'#383838'}),'Rectangle');e.setFillColor('#FF0000');e.fillAt(start.add([15,15]));const q=p.view.projectToView(start.add([15,15]));return {x:q.x,y:q.y};});
  await page.getByRole('button',{name:'Colour fill',exact:true}).click();await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();await page.getByRole('button',{name:'No fill',exact:true}).click();await expect(page.getByRole('button',{name:'No fill',exact:true})).toHaveAttribute('aria-pressed','true');
  const box=(await page.locator('#cad-canvas').boundingBox())!;await page.mouse.click(box.x+point.x,box.y+point.y);
  expect(await page.evaluate(()=>(window as any).__vectora.objects.map((x:any)=>({fill:x.fillColor,name:x.data.name})))).toEqual([{fill:null,name:'Rectangle'}]);
  await page.getByRole('textbox',{name:'Hex colour',exact:true}).fill('#FF00FF');await page.getByRole('textbox',{name:'Hex colour',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'No fill',exact:true})).toHaveAttribute('aria-pressed','false');await page.mouse.click(box.x+point.x,box.y+point.y);
  expect(await page.evaluate(()=>(window as any).__vectora.selected.fillColor.toCSS(true))).toBe('#ff00ff');
});

test('No fill preserves locked fills, hidden fills and the full stroke of filled outlines',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(()=>{
    const p=(window as any).__paper,e=(window as any).__vectora;
    e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,40,40],strokeColor:'#383838'}),'Rectangle');const outline=e.selected;outline.fillColor=new p.Color('#00FFFF');
    e.addShape(new p.Path.Line({insert:false,from:[20,0],to:[20,40],strokeColor:'#383838'}),'Line');
    const protectedFill=outline.clone();protectedFill.strokeColor=null;protectedFill.data={uid:crypto.randomUUID(),role:'artwork'};protectedFill.locked=true;
    const hidden=protectedFill.clone();hidden.locked=false;hidden.visible=false;
    e.setFillColor('none');e.fillAt(new p.Point(10,10));
    return {outline:!!outline.strokeColor&&!outline.fillColor&&outline.area===1600,locked:protectedFill.isInserted()&&!!protectedFill.fillColor,hidden:hidden.isInserted()&&!!hidden.fillColor,left:e.objects.filter((x:any)=>!x.locked&&x.visible&&x.fillColor).some((x:any)=>x.contains(new p.Point(10,10))),right:e.objects.filter((x:any)=>!x.locked&&x.visible&&x.fillColor).some((x:any)=>x.contains(new p.Point(30,10)))};
  });expect(result).toEqual({outline:true,locked:true,hidden:true,left:false,right:true});
});
