// First-party compositions. Geometry and shadow sampling resolve in Worldbend core.
const quad = points => Object.fromEntries(['tl','tr','br','bl'].map((key,index)=>[key,{x:points[index][0],y:points[index][1]}]));
export function scene({series=false, strength=.25, softness=12}={}) {
  const covers = series ? [
    [[.13,.18],[.43,.21],[.41,.72],[.10,.65]],
    [[.53,.15],[.82,.09],[.86,.67],[.57,.76]],
    [[.31,.23],[.66,.26],[.63,.88],[.28,.85]],
  ] : [[[.33,.10],[.71,.16],[.67,.87],[.30,.77]]];
  return {schema:'worldbend.mockup-motion',version:'0.1',canvas:{width:960,height:720},timebase:{numerator:24,denominator:1},frameCount:96,
    background:{kind:'color',rgba:[233,229,219,255],space:'srgb8'},seams:[],
    planes:covers.map((points,index)=>{
      const start=quad(points), middle=quad(points.map(([x,y],corner)=>[x+(corner%3===0?-.012:.018),y+(index===1?-.012:.012)]));
      return {id:'cover-'+index,sourceId:'cover',opacity:1,shadow:{offset:{x:8,y:16},blurSigmaPx:softness,color:[24,39,37],opacity:strength},
        base:{schema:'worldbend.transform',version:'0.1',destination:{space:'normalized',quad:start},content:{fit:'stretch',orientation:'native'}},
        keyframes:[{frame:0,quad:start,easingToNext:{kind:'cubicBezier',x1:.22,y1:0,x2:.35,y2:1}},{frame:47,quad:middle,easingToNext:{kind:'cubicBezier',x1:.22,y1:0,x2:.35,y2:1}},{frame:95,quad:start}]};
    })};
}
