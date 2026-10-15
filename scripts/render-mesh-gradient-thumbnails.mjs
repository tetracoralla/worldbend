// Reproducible chooser swatches from the canonical mesh-gradient delivery, before
// Figma composition. This does not acquire or publish a Figma Shader resource.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BUILTIN_MESH_GRADIENT_RECIPES} from '../packages/figma/src/mesh-gradient-material-wire.ts';
import {StdioClient} from './composition-provider-chain-check.mjs';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const client=new StdioClient(path.join(root,'target/debug/worldbend-mcp'),['--root',root,'--surface','catalog']);
const plans=[];
try {
  await client.initialize();
  for(const recipe of BUILTIN_MESH_GRADIENT_RECIPES) {
    const response=await client.callTool('worldbend.run',{operation:'mesh_gradient_delivery',arguments:{recipe,material:recipe.material,target:'web'}});
    const envelope=response.result?.structuredContent;
    if(!envelope?.ok)throw Error('Mesh-gradient delivery failed: '+JSON.stringify(envelope));
    plans.push({id:recipe.recipeId,delivery:envelope.result});
  }
}finally{await client.close();}
const modules=new Map(await Promise.all((await readdir(path.join(root,'packages/web/dist'))).filter(name=>name.endsWith('.js'))
  .map(async name=>['/'+name,await readFile(path.join(root,'packages/web/dist',name))])));
const html=`<!doctype html><style>body{margin:0}.swatch{width:180px;height:130px}</style><script>addEventListener('error',event=>globalThis.__WORLDBEND_PARITY__={error:event.message||'Mesh-gradient module failed to load'});addEventListener('unhandledrejection',event=>globalThis.__WORLDBEND_PARITY__={error:String(event.reason)});</script><script type="module">
import {attachMeshGradient} from '/mesh-gradient.js';
try {
 const renders=[];
 for(const plan of ${JSON.stringify(plans)}) {
   const surface=document.createElement('div');surface.className='swatch';document.body.append(surface);
   const handle=await attachMeshGradient(surface,plan.delivery,{respectReducedMotion:false,paused:true,pixelRatio:1});
   handle.setPaused(true);handle.seek(1500);
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const canvas=surface.querySelector('canvas');
   if(!canvas||handle.getState().status!=='ready'||canvas.width<1)throw Error('Mesh-gradient swatch did not render');
   const swatch=document.createElement('canvas');swatch.width=180;swatch.height=130;
   const context=swatch.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,180,130);context.drawImage(canvas,0,0,180,130);
   renders.push({id:plan.id,jpeg:swatch.toDataURL('image/jpeg',0.8)});handle.destroy();surface.remove();
 }
 globalThis.__WORLDBEND_PARITY__={renders};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
</script>`;
const server=createServer((req,res)=>{const file=modules.get(new URL(req.url,'http://localhost').pathname);
  res.writeHead(200,{'Content-Type':file?'text/javascript':'text/html','Cache-Control':'no-store'});res.end(file??html);});
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/';
  browser=await launchChrome(await findChrome(),['--enable-unsafe-webgpu']);
  const page=await createPage(browser.debugUrl,url);
  const result=await readPageResult(page.webSocketDebuggerUrl,{url,width:180,height:130,timeoutMs:30000});
  if(result.error)throw Error(result.error);
  for(const render of result.renders) {
    if(!/^data:image\/jpeg;base64,/.test(render.jpeg)||!BUILTIN_MESH_GRADIENT_RECIPES.some(recipe=>recipe.recipeId===render.id))throw Error('Invalid mesh-gradient swatch');
    await writeFile(path.join(root,'packages/figma/assets/materials',render.id+'.jpg'),Buffer.from(render.jpeg.split(',')[1],'base64'));
    console.log('Canonical mesh-gradient swatch rendered: '+render.id);
  }
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve));}
