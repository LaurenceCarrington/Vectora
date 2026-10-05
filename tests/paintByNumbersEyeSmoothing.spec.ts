import {test,expect} from './fixtures';
test('Heavy smoothing rounds every thin eye band',async({page})=>{
 await page.goto('http://127.0.0.1:5174');
 const r=await page.evaluate(async()=>{
  const {processPaint}=await import('/src/paintByNumbers/process.ts'),{loadLabelMetrics,previewSheetSVG}=await import('/src/paintByNumbers/paperSheets.ts'),{layoutSheets}=await import('/src/paintByNumbers/layout.ts'),metrics=await loadLabelMetrics(),p=(window as any).__paper,w=240,data=new Uint8ClampedArray(w*w*4);
  const colours=[[255,160,30,255],[255,225,170,255],[5,12,8,255],[40,95,45,255],[130,180,80,255]];
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){const d=Math.hypot((x-120)*1.1,y-120),index=d>92?0:d>82?1:d>75?2:d>68?3:d>35?4:2;data.set(colours[index],(y*w+x)*4);}
  const s={colours:5,cleanupMM2:0,imageWidthMM:100,imageHeightMM:100,labelSizeMM:3,metrics},off=processPaint({width:w,height:w,data},{...s,smoothing:'off'}),heavy=processPaint({width:w,height:w,data},{...s,smoothing:'heavy'});
  let area=0,crossings=0,labels=true;const edges=new Map<string,number>();
  for(const region of heavy.regions){const shape=new p.CompoundPath({insert:false,children:region.contours.map(c=>new p.Path({insert:false,segments:c,closed:true}))});shape.fillRule='evenodd';area+=shape.area;crossings+=shape.getCrossings(shape).length;const m=metrics[region.paletteIndex],rx=(m.width*3/2+.2)*w/100,ry=(m.height*3/2+.2)*w/100,[x,y]=region.label,rect=new p.Path.Rectangle({insert:false,from:[x-rx,y-ry],to:[x+rx,y+ry]});labels&&=shape.getIntersections(rect).length===0&&rect.segments.every((s:any)=>shape.contains(s.point));rect.remove();shape.remove();
   for(const c of region.contours)for(let i=0;i<c.length;i++){const a=c[i],b=c[(i+1)%c.length];if([a,b].every(([x,y])=>x===0||y===0||x===w||y===w))continue;const key=[a.join(','),b.join(',')].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}
  }
  const page={preset:'custom' as const,orientation:'portrait' as const,widthMM:140,heightMM:156,marginMM:10,labelSizeMM:3,lineWeightMM:.2},svgs=[off,heavy].flatMap(result=>{const layout=layoutSheets(result,page);return ['numbered','reference'].map(view=>previewSheetSVG(layout,view as 'numbered'|'reference'));});
  return {area,crossings,labels,shared:[...edges.values()].every(count=>count===2),regions:heavy.regions.length,original:off.regions.length,moved:heavy.regions.some((r,i)=>Math.hypot(r.label[0]-off.regions[i].label[0],r.label[1]-off.regions[i].label[1])>0),svgs,loops:heavy.regions.map(r=>r.contours.map(c=>({length:c.length,fractional:c.filter(([x,y])=>!Number.isInteger(x)||!Number.isInteger(y)).length})))};
 });
 for(const region of r.loops)for(const loop of region)if(loop.length>10)expect(loop.fractional).toBeGreaterThan(10);
 expect(r.moved).toBe(true);expect(r.labels).toBe(true);expect(r.crossings).toBe(0);expect(r.shared).toBe(true);expect(r.area).toBeCloseTo(240*240,5);expect(r.regions).toBe(r.original);
 await page.setContent(`<style>body{margin:0;background:white;font:16px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}section{text-align:center}svg{width:100%;height:auto}</style>${r.svgs.map((svg,i)=>`<section><p>${i<2?'Off':'Heavy'} — ${i%2?'colour reference':'numbered outline'}</p>${svg}</section>`).join('')}`);
 await page.screenshot({path:'test-results/paint-eye-smoothing-comparison.png',scale:'css'});
});
