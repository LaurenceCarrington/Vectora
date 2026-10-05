import type {QuantizedImage,RasterSource} from './types';
type RGB=[number,number,number];
const distance=(a:RGB,b:RGB)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
const hex=(c:RGB)=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase();
/** Weighted bounded histogram clustering, without random state or per-pixel iterations. */
export function quantize(source:RasterSource,colours:number,maximumDimension=1200):QuantizedImage {
 const {width,height,data}=source;
 if(![1200,1600].includes(maximumDimension)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>maximumDimension||height>maximumDimension||!(data instanceof Uint8ClampedArray)||data.length!==width*height*4)throw new Error(`Invalid analysis image. Maximum size is ${maximumDimension} pixels per side.`);
 if(!Number.isInteger(colours)||colours<2||colours>32)throw new Error('Choose 2–32 colours.');
 const count=new Uint32Array(32768),sumR=new Float64Array(32768),sumG=new Float64Array(32768),sumB=new Float64Array(32768),pixelBins=new Int32Array(width*height).fill(-1);
 for(let i=0;i<pixelBins.length;i++){
  const a=data[i*4+3];if(a<16)continue;const alpha=a/255;
  const r=Math.round(data[i*4]*alpha+255*(1-alpha)),g=Math.round(data[i*4+1]*alpha+255*(1-alpha)),b=Math.round(data[i*4+2]*alpha+255*(1-alpha)),bin=(r>>3)*1024+(g>>3)*32+(b>>3);
  pixelBins[i]=bin;count[bin]++;sumR[bin]+=r;sumG[bin]+=g;sumB[bin]+=b;
 }
 const bins:number[]=[],means:RGB[]=[];for(let bin=0;bin<count.length;bin++)if(count[bin]){bins.push(bin);means.push([sumR[bin]/count[bin],sumG[bin]/count[bin],sumB[bin]/count[bin]]);}
 if(!bins.length)throw new Error('This image is entirely transparent. Choose an image with visible colours.');
 let largest=0;for(let i=1;i<bins.length;i++)if(count[bins[i]]>count[bins[largest]])largest=i;
 const centres:RGB[]=[means[largest]],nearest=new Float64Array(bins.length).fill(Infinity);
 while(centres.length<Math.min(colours,bins.length)){
  let best=-1,score=0;for(let i=0;i<bins.length;i++){nearest[i]=Math.min(nearest[i],distance(means[i],centres.at(-1)!));const s=nearest[i]*Math.sqrt(count[bins[i]]);if(s>score){score=s;best=i;}}
  if(best<0)break;centres.push(means[best]);
 }
 const assigned=new Int16Array(bins.length).fill(-1);
 for(let pass=0;pass<12;pass++){
  const sums=centres.map(()=>[0,0,0,0]);let changed=false;
  for(let i=0;i<bins.length;i++){
   let best=0,d=Infinity;for(let j=0;j<centres.length;j++){const n=distance(means[i],centres[j]);if(n<d){d=n;best=j;}}
   if(assigned[i]!==best)changed=true;assigned[i]=best;const n=count[bins[i]],s=sums[best];s[0]+=means[i][0]*n;s[1]+=means[i][1]*n;s[2]+=means[i][2]*n;s[3]+=n;
  }
  sums.forEach((s,i)=>{if(s[3])centres[i]=[s[0]/s[3],s[1]/s[3],s[2]/s[3]];});if(!changed)break;
 }
 const palette=[...new Set(centres.map(hex))].sort(),rgb=palette.map(s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)] as RGB),lookup=new Int16Array(32768),used=new Set<number>();
 for(let i=0;i<bins.length;i++){let best=0,d=Infinity;for(let j=0;j<rgb.length;j++){const n=distance(means[i],rgb[j]);if(n<d){d=n;best=j;}}lookup[bins[i]]=best;used.add(best);}
 const indices=[...used].sort((a,b)=>a-b),remap=new Map(indices.map((n,i)=>[n,i])),labels=new Int16Array(pixelBins.length);
 for(let i=0;i<labels.length;i++)labels[i]=pixelBins[i]<0?-1:remap.get(lookup[pixelBins[i]])!;
 return {width,height,labels,palette:indices.map(i=>palette[i])};
}
