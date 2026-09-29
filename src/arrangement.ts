import paper from 'paper';

export type ArrangementAction='align-left'|'align-centre'|'align-right'|'align-top'|'align-middle'|'align-bottom'|'distribute-horizontal'|'distribute-vertical';

/** Exact offsets in selection order. Alignment anchors the last selected bounds. */
export function arrangementOffsets(bounds:readonly paper.Rectangle[],action:ArrangementAction):paper.Point[] {
 const offsets=bounds.map(()=>new paper.Point(0,0));
 if(bounds.length<2)return offsets;
 const horizontal=['align-left','align-centre','align-right','distribute-horizontal'].includes(action),axis=horizontal?'x':'y';
 if(action.startsWith('distribute-')){
  if(bounds.length<3)return offsets;
  const ordered=bounds.map((b,index)=>({index,centre:b.center[axis]})).sort((a,b)=>a.centre-b.centre||a.index-b.index);
  const start=ordered[0].centre,step=(ordered.at(-1)!.centre-start)/(ordered.length-1);
  // Leave both endpoints entirely unchanged, including their metadata.
  for(let i=1;i<ordered.length-1;i++)offsets[ordered[i].index][axis]=start+step*i-ordered[i].centre;
 }else{
  const value=(b:paper.Rectangle)=>action==='align-left'?b.left:action==='align-right'?b.right:action==='align-top'?b.top:action==='align-bottom'?b.bottom:b.center[axis];
  const target=value(bounds.at(-1)!);
  for(let i=0;i<bounds.length-1;i++)offsets[i][axis]=target-value(bounds[i]);
 }
 return offsets;
}
