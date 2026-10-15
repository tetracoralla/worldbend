import type {MockupShadowPlan} from './generated/core-contract';
export type {MockupShadow,MockupShadowPlan} from './generated/core-contract';

/** Paint the alpha of the core-planned expanded caster. Projection stays in the
 * ordinary transform renderer; Canvas executes its Gaussian filter backend.
 * scale is presentation-only and applies to the expanded pixels, inset and sigma.
 */
export function paintMockupShadow(context:CanvasRenderingContext2D,projected:CanvasImageSource,
  plan:MockupShadowPlan,opacity=1,scale=1,scratch?:HTMLCanvasElement):HTMLCanvasElement{
  if(plan.profile!=='worldbend.projected-alpha-shadow@0.1'||!Number.isFinite(scale)||scale<=0||!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Invalid shadow receiving input');
  const width=Math.max(1,Math.round(plan.sampleCanvas.width*scale)),height=Math.max(1,Math.round(plan.sampleCanvas.height*scale));
  const shadow=plan.shadow;
  if(![plan.sampleCanvas.width,plan.sampleCanvas.height,plan.inset].every(Number.isSafeInteger)||
    plan.sampleCanvas.width<1||plan.sampleCanvas.height<1||plan.inset<0||plan.inset>192||
    ![width,height].every(Number.isSafeInteger)||width*height>64*1024*1024||
    !Number.isFinite(shadow.blurSigmaPx)||shadow.blurSigmaPx<0||shadow.blurSigmaPx>64||
    !Number.isFinite(shadow.opacity)||shadow.opacity<0||shadow.opacity>1||
    shadow.color.length!==3||!shadow.color.every(value=>Number.isInteger(value)&&value>=0&&value<=255))throw Error('Invalid or oversized shadow sampling plan');
  const mask=scratch??context.canvas.ownerDocument.createElement('canvas');
  if(mask.width!==width)mask.width=width;if(mask.height!==height)mask.height=height;
  const target=mask.getContext('2d');if(!target)throw Error('Shadow requires Canvas 2D');
  target.setTransform(1,0,0,1,0,0);target.globalAlpha=1;target.globalCompositeOperation='source-over';target.filter='none';
  target.clearRect(0,0,width,height);target.drawImage(projected,0,0,width,height);
  target.globalCompositeOperation='source-in';const [r,g,b]=plan.shadow.color;target.fillStyle=`rgb(${r},${g},${b})`;target.fillRect(0,0,width,height);
  target.globalCompositeOperation='source-over';
  context.save();
  try{context.setTransform(1,0,0,1,0,0);context.globalCompositeOperation='source-over';context.globalAlpha=opacity*plan.shadow.opacity;
    const filter=plan.shadow.blurSigmaPx>0?`blur(${plan.shadow.blurSigmaPx*scale}px)`:'none';context.filter=filter;
    if(context.filter!==filter)throw Error('Gaussian shadows are unavailable on this Canvas target');
    context.drawImage(mask,-plan.inset*scale,-plan.inset*scale);
  }finally{context.restore()}
  return mask;
}
