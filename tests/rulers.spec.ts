import { test, expect } from './fixtures';
const DEV='http://127.0.0.1:5174';

test('millimetre rulers track document coordinates through pan, zoom and resize',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
  for(const zoom of [.1,1,96/25.4,24,100]){
    await page.evaluate(zoom=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=zoom;p.view.center=new p.Point(-34.125,12.375);e.setTool('select');},zoom);
    const report=await page.evaluate(()=>{
      const p=(window as any).__paper,c=document.querySelector('#cad-canvas')!.getBoundingClientRect();
      return [...document.querySelectorAll<SVGSVGElement>('.canvas-ruler')].map(svg=>{
        const vertical=svg.classList.contains('ruler-left');
        const marks=[...svg.querySelectorAll<SVGLineElement>('line')];
        const errors=marks.map(line=>{
          const mm=Number(line.dataset.mm),point=svg.createSVGPoint();
          point.x=line.x1.baseVal.value;point.y=line.y1.baseVal.value;
          const actual=point.matrixTransform(svg.getScreenCTM()!);
          const expected=p.view.projectToView(new p.Point(vertical?0:mm,vertical?mm:0));
          return Math.abs(vertical?actual.y-c.y-expected.y:actual.x-c.x-expected.x);
        });
        return {count:marks.length,error:Math.max(...errors),labels:svg.querySelectorAll('text').length};
      });
    });
    for(const ruler of report){expect(ruler.count).toBeGreaterThan(10);expect(ruler.count).toBeLessThan(300);expect(ruler.error).toBeLessThan(.001);expect(ruler.labels).toBeGreaterThan(2);}
  }
  expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);
  await page.evaluate(()=>{const e=(window as any).__vectora;e.setGridSpacing(2.5);e.resetZoom();});
  await page.screenshot({path:'test-results/canvas-rulers.png'});
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:750});
    await expect.poll(()=>page.locator('.ruler-bottom').evaluate(el=>el.querySelectorAll('line').length)).toBeGreaterThan(5);
    const bounds=await page.locator('.ruler-bottom').boundingBox();
    expect(bounds!.x).toBe(64);expect(bounds!.x+bounds!.width).toBe(width-44);expect(bounds!.height).toBe(20);expect(bounds!.y).toBe(702);
    const left=await page.locator('.ruler-left').boundingBox();expect(left!.x).toBe(44);expect(left!.y).toBe(120);expect(left!.width).toBe(20);expect(left!.y+left!.height).toBe(bounds!.y);
  }
  expect(errors).toEqual([]);
});

test('rulers use the shared design in the reference and production',async({page})=>{
  let reference:unknown;
  for(const url of [DEV+'/reference/design-system.html','http://127.0.0.1:4173']){
    await page.goto(url);
    const ruler=page.getByRole('img',{name:'Horizontal ruler in millimetres'});
    await expect(ruler.locator('text').first()).toBeVisible();
    await expect(ruler.locator('text').first()).toHaveCSS('stroke','none');
    const styles=await ruler.evaluate(el=>{const s=getComputedStyle(el);return {height:s.height,background:s.backgroundColor,color:s.color};});
    if(reference)expect(styles).toEqual(reference);else reference=styles;
  }
});
