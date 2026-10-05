import {test,expect} from './fixtures';

test('A recovery record with a malformed tab still exposes the valid working document',async({page})=>{
 await page.goto('http://127.0.0.1:5174');
 const contents=await page.evaluate(async()=>{const {encodeDocument}=await import('/src/documentFormat.ts');return encodeDocument((window as any).__vectora,false);});
 const recovered=await page.evaluate(async contents=>{
  const {DocumentRecovery}=await import('/src/documentRecovery.ts');
  localStorage.setItem('vectora.recovery.pending',JSON.stringify({version:1,time:Date.now()+10000,id:'malformed-tab',data:{contents,filename:'Recovered.vectora',dirty:false,activeTabId:'valid',tabs:[null,{id:'valid',contents,filename:'Recovered.vectora',dirty:false}]}}));
  return (await new DocumentRecovery(()=>{}).read())?.contents;
 },contents);
 expect(recovered).toBe(contents);
});

test('Font cleanup during navigation cannot overwrite the captured text draft',async({page})=>{
 let rejectFont:()=>Promise<void>=async()=>{throw new Error('Font was not requested');};
 await page.route('**/fonts/Lato-Regular.ttf',route=>{rejectFont=()=>route.abort();});
 await page.goto('http://127.0.0.1:5174');await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(500,400);await page.locator('#inline-text').fill('Keep this draft');
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));await rejectFont();await expect(page.locator('#inline-text')).toBeHidden();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 const draft=await page.evaluate(async()=>{const {DocumentRecovery}=await import('/src/documentRecovery.ts');return(await new DocumentRecovery(()=>{}).read())?.draft?.content;});
 expect(draft).toBe('Keep this draft');
 // If navigation is cancelled, a real subsequent edit resumes normal caching.
 await page.locator('#cad-canvas').focus();await page.keyboard.press('v');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[30,30,20,20]}),'After cancellation');});
 await expect.poll(()=>page.evaluate(async()=>{const {DocumentRecovery}=await import('/src/documentRecovery.ts');const data=await new DocumentRecovery(()=>{}).read();return {draft:data?.draft,objects:JSON.parse(data!.contents).layers.flatMap((l:any)=>l.objects).length};})).toEqual({draft:undefined,objects:1});
});
