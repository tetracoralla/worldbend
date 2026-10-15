import {planEffect} from '../dist/effects.js';
import {nativeStage} from './stage-native.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(v,names)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||!equal(Object.keys(v).sort(),[...names].sort()))throw Error('比较文件字段不完整或包含未知字段');
};
export async function validateStageStudy(input){
  const v=structuredClone(input);
  keys(v,['schema','version','content','host','candidates','state','choice','observation']);
  if(v.schema!=='worldbend.stage-study'||v.version!=='1')throw Error('不支持的比较版本');
  keys(v.content,['id','version','theme']);
  if(v.content.id!=='little-explorer'||v.content.version!=='1'||![0,1].includes(v.content.theme))throw Error('不支持的素材版本');
  keys(v.host,['id','version','width','height','offsets']);keys(v.host.offsets,Object.keys(nativeStage.offsets));
  for(const key of ['id','version','width','height'])if(v.host[key]!==nativeStage[key])throw Error('不支持的宿主方案');
  for(const id of Object.keys(nativeStage.offsets))if(!equal(v.host.offsets[id],nativeStage.offsets[id]))throw Error('宿主方案参数发生变化');
  if(!['host-offsets','layered-depth','rigid-tilt'].includes(v.choice))throw Error('未知选择');
  if(typeof v.observation!=='string'||v.observation.length>2000)throw Error('观察文字超过限制');
  if(!Array.isArray(v.candidates)||v.candidates.length!==2)throw Error('需要两份 Worldbend 配方');
  for(const [i,c] of v.candidates.entries()){
    keys(c,['recipe','fingerprint']);
    if(typeof c.fingerprint!=='string')throw Error('缺少配方指纹');
    await planEffect({recipe:c.recipe,state:v.state,expectedFingerprint:c.fingerprint});
    const ids=i===0?['background','middle','foreground']:['content'];
    if(c.recipe.viewport.width!==600||c.recipe.viewport.height!==400||!equal(c.recipe.layers.map(l=>l.id),ids)||c.recipe.layers.some(l=>l.surface.kind!=='plane'||l.surface.size.width!==600||l.surface.size.height!==400))throw Error('这份组合不适用于固定的三层舞台，请在完整空间试验台中使用');
  }
  return v;
}

export async function makeStageStudy({recipes,state,theme,choice,observation}){
  const candidates=await Promise.all(recipes.map(async recipe=>({recipe:structuredClone(recipe),fingerprint:(await planEffect({recipe,state})).fingerprint})));
  return validateStageStudy({schema:'worldbend.stage-study',version:'1',content:{id:'little-explorer',version:'1',theme},host:structuredClone(nativeStage),candidates,state:{...state},choice,observation});
}
