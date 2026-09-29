export interface LaserJobSettings {
  bedWidthMM:number;
  bedHeightMM:number;
  kerfMM:number;
  order:'engrave-cut'|'cut-engrave';
}

export function defaultLaserJobSettings():LaserJobSettings {
  return {bedWidthMM:300,bedHeightMM:200,kerfMM:0,order:'engrave-cut'};
}

export function validateLaserJobSettings(value:unknown):LaserJobSettings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid laser job settings.');
  const data=value as Record<string,unknown>;
  const dimension=(field:string,min:number,max:number):number=>{
    const n=data[field];
    if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`Enter ${field} from ${min} to ${max} mm.`);
    return n;
  };
  const bedWidthMM=dimension('bedWidthMM',1,10000);
  const bedHeightMM=dimension('bedHeightMM',1,10000);
  const kerfMM=dimension('kerfMM',0,10);
  if(data.order!=='engrave-cut'&&data.order!=='cut-engrave')throw new Error('Choose a valid laser operation order.');
  return {bedWidthMM,bedHeightMM,kerfMM,order:data.order};
}
