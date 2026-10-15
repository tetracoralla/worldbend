import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {canvasReadbackScript} from './webgpu-readback.mjs';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';

const html = `<!doctype html><canvas width="67" height="31"></canvas><script type="module">
${canvasReadbackScript}
try {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw Error('No WebGPU adapter is available');
  const device = await adapter.requestDevice(), canvas = document.querySelector('canvas');
  const context = canvas.getContext('webgpu');
  context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'premultiplied'});
  const measurements = [];
  for (const [color,expected] of [[[1,0,0,1],[255,0,0,255]],[[0,.25,0,.5],[0,128,0,128]],[[0,0,1,1],[0,0,255,255]]]) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:color}]});
    pass.end();device.queue.submit([encoder.finish()]);
    const pixels = await readGpuPixels(canvas);
    let delta = 0;
    for (let i=0;i<pixels.length;i++) delta = Math.max(delta,Math.abs(pixels[i]-expected[i%4]));
    if (delta>1) throw Error('WebGPU clear/readback failed: '+JSON.stringify({expected,actual:[...pixels.slice(0,4)],delta}));
    measurements.push({expected,actual:[...pixels.slice(0,4)],maxDelta:delta});
  }
  const info=adapter.info;
  context.unconfigure();device.destroy();
  globalThis.__WORLDBEND_PARITY__={ok:true,adapter:info?{vendor:info.vendor,architecture:info.architecture,description:info.description}:null,measurements};
} catch(error) {globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
</script>`;
const server=createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end(html)});
let browser;
let diagnostics='';
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await launchChrome(await findChrome(),['--enable-unsafe-webgpu']);
  browser.process.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-8000)});
  const url=`http://127.0.0.1:${server.address().port}/`;
  const target=await createPage(browser.debugUrl,url);
  const result=await readPageResult(target.webSocketDebuggerUrl,{width:640,height:480,url,timeoutMs:20000});
  if(result.error)throw Error(result.error+'\nBrowser GPU diagnostics:\n'+diagnostics);
  assert.equal(result.ok,true);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} finally {
  if(browser)await closeChrome(browser);
  await new Promise(resolve=>server.close(resolve));
}
