import paper from 'paper';
import { documentPath } from './deletion';

/** Join exact Bézier paths at the nearest pair of endpoints, then close the remaining gap. */
export function closeNearestPaths(sources:readonly paper.Path[]):paper.Path {
  const paths=sources.map(documentPath);
  while(paths.length>1){
    let best={i:0,j:1,startA:false,startB:true,distance:Infinity};
    for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
      for(const startA of [false,true])for(const startB of [true,false]){
        const a=startA?paths[i].firstSegment:paths[i].lastSegment,b=startB?paths[j].firstSegment:paths[j].lastSegment;
        const distance=a.point.getDistance(b.point);
        if(distance<best.distance)best={i,j,startA,startB,distance};
      }
    }
    const a=paths[best.i],b=paths[best.j];
    if(best.startA)a.reverse();if(!best.startB)b.reverse();
    if(a.lastSegment.point.equals(b.firstSegment.point)){
      a.lastSegment.handleOut=b.firstSegment.handleOut.clone();
      a.addSegments(b.segments.slice(1));
    }else{
      a.lastSegment.handleOut=new paper.Point(0,0);b.firstSegment.handleIn=new paper.Point(0,0);
      a.addSegments(b.segments);
    }
    paths.splice(best.j,1);b.remove();
  }
  const result=paths[0];
  if(result.firstSegment.point.equals(result.lastSegment.point)){
    result.firstSegment.handleIn=result.lastSegment.handleIn.clone();result.removeSegment(result.segments.length-1);
  }else{
    result.firstSegment.handleIn=new paper.Point(0,0);result.lastSegment.handleOut=new paper.Point(0,0);
  }
  result.closed=true;return result;
}
