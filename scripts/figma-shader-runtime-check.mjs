import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

// Exercise the actual owned Figma shader on WebGPU. This checks its sampler,
// including the host's observed premultiplied texture convention. Figma's
// downstream compositing, shape coverage and export resampling are separate
// installed-host checks; passing this check does not establish PNG parity.
// The foil kernel is checked the same way: property surface, animation,
// flat-base and hidden-output behavior before Figma compositing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "packages/figma/shaders/projective-sampler/main.ts"), "utf8");
const module = source.replace('"figma:shaders"', '"/properties.js"');
const foilSource = await readFile(path.join(root, "packages/figma/shaders/foil/main.ts"), "utf8");
const foilModule = foilSource.replace('"figma:shaders"', '"/properties.js"');
const page = `<!doctype html><meta charset="utf-8"><title>Worldbend Figma shader check</title>
<script type="module">
import * as shader from '/shader.js';
import * as foil from '/foil.js';
try {
  const definitions = globalThis.shaderPropertySets[0];
  const names = ['h00','h01','h02','h10','h11','h12','h20','h21','h22','sourceRight','sourceBottom'];
  if (Object.keys(definitions).length !== names.length || names.some(name =>
    definitions[name]?.type !== 'number' || !Number.isFinite(definitions[name].defaultValue))) {
    throw new Error('The sampler must retain its eleven numeric properties');
  }
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('A WebGPU adapter is required');
  const device = await adapter.requestDevice();
  try {
    const input = device.createTexture({size:[64,64],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const red = [128,0,0,128], blue = [0,0,255,255], clear = [0,0,0,0];
    const texel = x => x < 32 ? red : blue;
    const bytes = new Uint8Array(64*64*4);
    for (let y=0;y<64;y++) for (let x=0;x<64;x++) bytes.set(texel(x),(y*64+x)*4);
    device.queue.writeTexture({texture:input},bytes,{bytesPerRow:256},[64,64]);
    const defaults = Object.fromEntries(names.map(name => [name,definitions[name].defaultValue]));
    const cases = [
      {id:'identity',params:{},width:64,expected:texel},
      {id:'horizontal-flip',params:{h00:-1,h02:1},width:64,expected:x=>texel(63-x)},
      {id:'half-pixel-alpha-transition',params:{h02:-.0078125},width:64,expected:x=>x===32?[64,0,128,192]:texel(x)},
      {id:'outside-source',params:{h02:-2},width:64,expected:()=>clear},
      {id:'source-extent-excludes-padding',params:{sourceRight:.5},width:64,expected:()=>red},
      {id:'larger-output-texture',params:{},width:128,expected:x=>x===63?[96,0,64,160]:x===64?[32,0,191,223]:x<64?red:blue},
    ];
    const measurements = [];
    for (const test of cases) {
      device.pushErrorScope('validation');
      const width = test.width, height = 64, bytesPerRow = width*4;
      const output = device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      const frame = {input,output,state:{},params:{...defaults,...test.params}};
      shader.setup(device,frame);
      const compilation = await frame.state.module.getCompilationInfo();
      const errors = Array.from(compilation.messages).filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => message.lineNum+': '+message.message).join('\\n'));
      shader.render(device,frame);
      const buffer = device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:output},{buffer,bytesPerRow},[width,height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const actual = new Uint8Array(buffer.getMappedRange());
      let maxDelta=0, differentChannels=0;
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const expected=test.expected(x);
        for (let channel=0;channel<4;channel++) {
          const delta=Math.abs(actual[(y*width+x)*4+channel]-expected[channel]);
          maxDelta=Math.max(maxDelta,delta);
          if(delta!==0)differentChannels++;
        }
      }
      buffer.unmap();buffer.destroy();output.destroy();
      const validation = await device.popErrorScope();
      if (validation) throw new Error(test.id+': '+validation.message);
      measurements.push({id:test.id,width,height,maxPremultipliedChannelDelta:maxDelta,differentChannels});
      if (maxDelta>1) throw new Error(test.id+' differs by '+maxDelta+' premultiplied channel levels (limit 1)');
    }
    // Foil kernel: procedural surface, so the checks read whole buffers
    // instead of per-pixel expectations.
    {
      const definitions = globalThis.shaderPropertySets[1];
      const foilNames = ['visible','baseColor','highlightColor','lightAngle','intensity','roughness','flowSpeed'];
      if (Object.keys(definitions).length !== foilNames.length || foilNames.some(name => definitions[name] == null)) {
        throw new Error('The foil kernel must retain its seven designer properties');
      }
      if (definitions.visible.type !== 'boolean' || definitions.baseColor.type !== 'color' ||
          definitions.highlightColor.type !== 'color' ||
          ['lightAngle','intensity','roughness','flowSpeed'].some(name => definitions[name].type !== 'number')) {
        throw new Error('The foil kernel property types changed');
      }
      const width = 128, height = 64, bytesPerRow = width * 4;
      const renderFoil = async (params, time) => {
        const output = device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        device.pushErrorScope('validation');
        const frame = {input:null, output, state:{}, params, time};
        foil.setup(device, frame);
        const compilation = await frame.state.module.getCompilationInfo();
        const errors = Array.from(compilation.messages).filter(message => message.type === 'error');
        if (errors.length) throw new Error('foil: '+errors.map(message => message.lineNum+': '+message.message).join('\\n'));
        foil.render(device, frame);
        const buffer = device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({texture:output},{buffer,bytesPerRow},[width,height]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(buffer.getMappedRange()).slice();
        buffer.unmap(); buffer.destroy(); output.destroy(); frame.state.quad.destroy(); frame.state.uniformBuf.destroy();
        const validation = await device.popErrorScope();
        if (validation) throw new Error('foil: '+validation.message);
        return pixels;
      };
      const defaults = Object.fromEntries(foilNames.map(name => {
        const value = definitions[name].defaultValue;
        return [name, typeof value === 'object' ? {...value} : value];
      }));
      const t0 = await renderFoil(defaults, 0);
      const t2 = await renderFoil(defaults, 2000);
      const nextFrame = await renderFoil(defaults, 16);
      const meanChange = pixels => pixels.reduce((sum, value, i) => sum + Math.abs(value - t0[i]), 0) / pixels.length;
      if (meanChange(nextFrame) >= meanChange(t2) / 20) throw new Error('foil treats millisecond frame time as seconds: a 16ms frame jumps too far');
      let animatedPixels = 0;
      for (let i = 0; i < t0.length; i++) if (t0[i] !== t2[i]) animatedPixels++;
      if (animatedPixels < width * height / 4) throw new Error('foil animation does not move the surface');
      const flat = await renderFoil({...defaults, intensity: 0}, 0);
      const [baseR, baseG, baseB] = [Math.round(defaults.baseColor.r*255), Math.round(defaults.baseColor.g*255), Math.round(defaults.baseColor.b*255)];
      let flatDelta = 0, flatAlpha = 0;
      for (let i = 0; i < width*height; i++) {
        flatDelta = Math.max(flatDelta, Math.abs(flat[i*4]-baseR), Math.abs(flat[i*4+1]-baseG), Math.abs(flat[i*4+2]-baseB));
        flatAlpha = Math.max(flatAlpha, Math.abs(flat[i*4+3]-255));
      }
      if (flatDelta > 2 || flatAlpha > 0) throw new Error('intensity=0 must render the flat base metal (delta '+flatDelta+', alpha '+flatAlpha+')');
      const translucent = await renderFoil({...defaults, intensity: 0, baseColor: {...defaults.baseColor, a: 0.5}}, 0);
      for (let i = 0; i < width*height; i++) {
        if (Math.abs(translucent[i*4] - baseR) > 2 || Math.abs(translucent[i*4+1] - baseG) > 2 ||
            Math.abs(translucent[i*4+2] - baseB) > 2 || Math.abs(translucent[i*4+3] - 128) > 1) {
          throw new Error('foil fill must emit straight RGB and its independent alpha');
        }
      }
      // A native COLOR property's opacity must affect coverage, not leak its
      // hidden tint. The earlier prototype ignored highlightColor.a entirely.
      const transparentHighlight = await renderFoil({...defaults, highlightColor: {...defaults.highlightColor, a: 0}}, 0);
      let alphaChanged = 0, fringeDelta = 0;
      for (let i = 0; i < width*height; i++) {
        if (transparentHighlight[i*4+3] !== t0[i*4+3]) alphaChanged++;
        fringeDelta = Math.max(fringeDelta, Math.abs(transparentHighlight[i*4]-baseR),
          Math.abs(transparentHighlight[i*4+1]-baseG),Math.abs(transparentHighlight[i*4+2]-baseB));
      }
      if (alphaChanged < width*height/2 || fringeDelta > 2) throw new Error('Foil highlight opacity is ignored or introduces a transparent-color fringe');
      const transparent = await renderFoil({...defaults, baseColor: {...defaults.baseColor,a:0}, highlightColor: {...defaults.highlightColor,a:0}}, 0);
      if (transparent.some(value => value !== 0)) throw new Error('Fully transparent Foil must have zero RGB and alpha');
      measurements.push({id:'foil-highlight-opacity',changedAlphaPixels:alphaChanged,maxTransparentTintFringe:fringeDelta});
      const stopped = await renderFoil({...defaults, flowSpeed: 0}, 0);
      const laterStopped = await renderFoil({...defaults, flowSpeed: 0}, 60000);
      if (stopped.some((value, i) => value !== laterStopped[i])) throw new Error('flowSpeed=0 must stop the material clock');
      const hidden = await renderFoil({...defaults, visible: false}, 0);
      if (hidden.some(value => value !== 0)) throw new Error('visible=false must render fully transparent output');
      const smooth = await renderFoil({...defaults, roughness: 0}, 0);
      let roughnessPixels = 0;
      for (let i = 0; i < t0.length; i++) if (smooth[i] !== t0[i]) roughnessPixels++;
      if (roughnessPixels < width * height / 8) throw new Error('roughness does not warp the bands');
      measurements.push({id:'foil-animated-pixels',width,height,maxPremultipliedChannelDelta:animatedPixels,differentChannels:roughnessPixels});
    }
    // Publish completion only after every awaited material check has ended.
    globalThis.__WORLDBEND_PARITY__={ok:true,scope:'sampler and foil before Figma compositing',measurements};
  } finally { device.destroy(); }
} catch (error) {
  globalThis.__WORLDBEND_PARITY__={error:error instanceof Error?error.stack??error.message:String(error)};
}
</script>`;

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const content = pathname === "/" ? ["text/html", page]
    : pathname === "/shader.js" ? ["text/javascript", module]
      : pathname === "/foil.js" ? ["text/javascript", foilModule]
        : pathname === "/properties.js" ? ["text/javascript", "export function defineProperties(_, definitions) { globalThis.shaderPropertySets = globalThis.shaderPropertySets || []; globalThis.shaderPropertySets.push(definitions); globalThis.shaderProperties = definitions; }"]
          : undefined;
  response.writeHead(content ? 200 : 404, { "Content-Type": content?.[0] ?? "text/plain", "Cache-Control": "no-store" });
  response.end(content?.[1] ?? "Not found");
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind shader check server");
  browser = await launchChrome(await findChrome(), ["--enable-unsafe-webgpu"]);
  const target = await createPage(browser.debugUrl, `http://127.0.0.1:${address.port}/`);
  const result = await readPageResult(target.webSocketDebuggerUrl);
  if (result.error) throw new Error(`Figma shader runtime check failed: ${result.error}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await closeChrome(browser);
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
