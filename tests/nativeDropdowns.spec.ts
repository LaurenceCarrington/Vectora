import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function unreadableOptions(page:Page,osTheme:'dark'|'light'){
 return page.evaluate(osTheme=>{
  const rgb=(value:string)=>value.match(/[\d.]+/g)!.map(Number),luminance=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('select option,select optgroup')].filter(option=>!option.matches(':disabled')&&!option.closest('select')!.matches(':disabled')).flatMap(option=>{
   const css=getComputedStyle(option),foreground=rgb(css.color),background=rgb(css.backgroundColor),nativeBackground=osTheme==='light'?[255,255,255]:[32,32,32],bg=background.length>3&&background[3]===0?nativeBackground:background,a=luminance(foreground),b=luminance(bg),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   return contrast<4.5?[{select:option.closest('select')?.getAttribute('aria-label')??option.closest('select')?.id,text:option.textContent,foreground:css.color,background:css.backgroundColor,contrast}]:[];
  });
 },osTheme);
}
test('Native dropdown choices remain readable when the app theme differs from the operating system',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await page.goto(DEV);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,10,25,15],strokeColor:'white'}),'Rectangle');});
 await page.getByRole('button',{name:'Properties',exact:true}).click();
 expect(await unreadableOptions(page,'light')).toEqual([]);
 const select=page.getByRole('combobox',{name:'Line style',exact:true});await select.selectOption('dashed');await expect(select).toHaveValue('dashed');
 await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();await page.getByRole('tab',{name:'Gradient',exact:true}).click();
 expect(await unreadableOptions(page,'light')).toEqual([]);
 await page.getByRole('tab',{name:'Pattern',exact:true}).click();expect(await unreadableOptions(page,'light')).toEqual([]);
 await page.getByRole('button',{name:'Generators',exact:true}).click();await page.getByRole('menuitem',{name:'Involute gear',exact:true}).click();expect(await unreadableOptions(page,'light')).toEqual([]);await page.keyboard.press('Escape');
 await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>{document.documentElement.dataset.theme='light';(window as any).__vectora.refreshTheme();});expect(await unreadableOptions(page,'dark')).toEqual([]);
});
test('Reference dropdowns use readable theme colours and preserve grouped font choices',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await page.goto(DEV+'/reference/design-system.html');expect(await unreadableOptions(page,'light')).toEqual([]);
 await page.getByRole('combobox',{name:'Example line style',exact:true}).selectOption('dotted');await expect(page.locator('#example-line-preview')).toHaveAttribute('stroke-linecap','round');
 await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>document.documentElement.dataset.theme='light');expect(await unreadableOptions(page,'dark')).toEqual([]);
});
