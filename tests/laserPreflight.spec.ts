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
