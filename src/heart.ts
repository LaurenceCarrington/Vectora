import paper from 'paper';

/** Six exact cubic segments, symmetric within the supplied bounds, with sharp cleft and tip. */
export function createHeart(bounds:paper.Rectangle):paper.Path {
 const {x,y,width:w,height:h}=bounds;
 const nodes=[
  [.5,.22,.10,-.14,-.10,-.14],
  [.25,0,.15,0,-.16,0],
  [0,.28,0,-.16,0,.28],
  [.5,1,-.12,-.20,.12,-.20],
  [1,.28,0,.28,0,-.16],
  [.75,0,.16,0,-.15,0],
 ];
 return new paper.Path({insert:false,closed:true,segments:nodes.map(([px,py,ix,iy,ox,oy])=>new paper.Segment(new paper.Point(x+px*w,y+py*h),new paper.Point(ix*w,iy*h),new paper.Point(ox*w,oy*h)))});
}
