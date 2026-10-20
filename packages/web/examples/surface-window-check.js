import {attachSurfaceWindow,planSurfaceWindow} from '../dist/surface-window.js';
const button=document.querySelector('#run'),result=document.querySelector('#result'),fixture=document.querySelector('#fixture');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const frame=()=>new Promise(requestAnimationFrame);
const assert=(test,message)=>{if(!test)throw Error(message);};
const near=(actual,expected,tolerance=3)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected} ±${tolerance}`);
const spec=(pose={},frost={baseRadius:0,spread:0,maxRadius:0})=>({schema:'worldbend.surface-window',version:'0.1',contentSize:{width:256,height:128},contentOrigin:{x:0,y:0},windowSize:{width:256,height:128},pose:{perspective:1800,...pose},frost});
button.onclick=async()=>{
  button.disabled=true;fixture.replaceChildren();result.textContent='Running…';
  const checks=[],metrics={},errors=[];let binding,video,stream,bitmap;
  const source=document.createElement('canvas');source.width=256;source.height=128;
  const ctx=source.getContext('2d');
  const gradient=()=>{const data=ctx.createImageData(256,128);for(let y=0;y<128;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;data.data.set([x,y*2,50,255],i);}ctx.putImageData(data,0,0);};gradient();
  const output=document.createElement('canvas');output.width=91;output.height=73;output.style.setProperty('transform','translateX(3px)','important');fixture.append(output);
  const pixel=(x,y)=>{const gl=output.getContext('webgl2');const data=new Uint8Array(4);gl.readPixels(x,output.height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);return [...data];};
  const check=async(name,fn)=>{await fn();checks.push(name);result.textContent=checks.map(x=>'PASS '+x).join('\n');};
  try{
    binding=attachSurfaceWindow(output,source,spec(),{pixelRatio:1,preserveDrawingBuffer:true,onError:e=>errors.push({code:e.code,message:e.message})});
    await check('clear image orientation and premultiplied output',async()=>{assert(await binding.update(spec()),'initial update');const p=pixel(40,25);near(p[0],40);near(p[1],50);near(p[3],255);});
    await check('projected pixels sample the stationary plane',async()=>{
      const input=spec({rotateY:-45,rotateX:12,depth:20});assert(await binding.update(input),'update');const plan=binding.getPlan();const h=plan.mapping.sampleHomography;
      for(const [x,y]of[[60,30],[120,60],[180,85]]){const X=x+.5,Y=y+.5,w=h[6]*X+h[7]*Y+h[8],u=(h[0]*X+h[1]*Y+h[2])/w,v=(h[3]*X+h[4]*Y+h[5])/w;const p=pixel(x,y);near(p[0],u*256-.5,4);near(p[1],v*256-1,4);}
    });
    await check('continuous face changes include the edge without stale content',async()=>{
      for(const y of [0,89,89.99,89.9999,90,90.0001,91,180,91,90,89,0]){const s=spec({rotateY:y,pivot:{x:0,y:.5},perspectiveOrigin:{x:0,y:.5}});assert(await binding.update(s),`angle ${y}: ${errors.at(-1)}`);if(y>=90)assert(output.style.visibility==='hidden',`face ${y} not hidden`);}
      assert(output.style.visibility!=='hidden','face not recovered');
    });
    await check('off-content samples are transparent',async()=>{await binding.update(spec({translate:{x:400,y:0}}));near(pixel(40,40)[3],0);});
    await check('frost reduces contrast and zero distance restores sharp content',async()=>{
      ctx.fillStyle='#fff';ctx.fillRect(0,0,256,128);ctx.fillStyle='#000';for(let x=0;x<256;x+=8)ctx.fillRect(x,0,4,128);await binding.refresh();
      await binding.update(spec());const sharp=pixel(81,64)[0];await binding.update(spec({depth:100},{baseRadius:0,spread:.2,maxRadius:20}));const blurred=pixel(81,64)[0];assert(sharp<12&&blurred>70&&blurred<185,`contrast ${sharp} / ${blurred}`);
      await binding.update(spec());near(pixel(81,64)[0],sharp);metrics.contrast={sharp,blurred};
    });
    await check('decoded images and resized OffscreenCanvas sources',async()=>{
      const image=new Image();image.src=source.toDataURL();await image.decode();assert(await binding.setSource(image),'image');await binding.update(spec());near(pixel(81,64)[0],0);
      const offscreen=new OffscreenCanvas(128,64);const painter=offscreen.getContext('2d');painter.fillStyle='#66aaee';painter.fillRect(0,0,128,64);assert(await binding.setSource(offscreen),'offscreen');near(pixel(40,25)[0],102);
      offscreen.width=64;offscreen.height=32;painter.fillStyle='#cc4422';painter.fillRect(0,0,64,32);assert(await binding.refresh(),'resized refresh');near(pixel(40,25)[0],204);await binding.setSource(source);
    });
    await check('unpremultiplied ImageBitmap has correct transparent color',async()=>{
      ctx.clearRect(0,0,256,128);ctx.fillStyle='rgba(255,0,0,0.5)';ctx.fillRect(0,0,256,128);
      bitmap=await createImageBitmap(source,{premultiplyAlpha:'none'});assert(await binding.setSource(bitmap),'bitmap');await binding.update(spec());const p=pixel(30,30);near(p[0],128,2);near(p[1],0);near(p[3],128,2);metrics.alpha=p;
    });
    await check('invalid media and geometry retain accepted state, then recover',async()=>{
      const before=JSON.stringify(binding.getPlan());assert(!await binding.setSource(document.createElement('div')),'DOM accepted');assert(!await binding.update(spec({depth:1800})),'horizon accepted');assert(JSON.stringify(binding.getPlan())===before,'accepted plan changed');
      gradient();assert(await binding.setSource(source),'recover source');assert(await binding.update(spec()),'recover geometry');near(pixel(40,25)[0],40);
    });
    await check('a tainted replacement cannot destroy the accepted texture',async()=>{
      const other=new URL('./fixtures/window-source.svg',location.href);other.hostname=location.hostname==='localhost'?'127.0.0.1':'localhost';
      const tainted=new Image();tainted.src=other.href;await tainted.decode();const before=pixel(40,25);assert(!await binding.setSource(tainted),'tainted source accepted');await binding.update(spec());const after=pixel(40,25);for(let i=0;i<4;i++)near(after[i],before[i]);
    });
    await check('burst updates are bounded and only the latest applies',async()=>{
      const before=binding.getStatus().draws;const applied=await Promise.all(Array.from({length:150},(_,i)=>binding.update(spec({translate:{x:i/10,y:0}}))));assert(applied.filter(Boolean).length===1,'multiple burst results');assert(binding.getStatus().draws-before===1,'unbounded draws');near(binding.getPlan().spec.pose.translate.x,14.9,.0001);
    });
    await check('pause, mutable content, resume and idle stop',async()=>{
      binding.pause();const before=binding.getStatus().draws;ctx.fillStyle='#22cc66';ctx.fillRect(0,0,256,128);await binding.refresh();await binding.update(spec());assert(binding.getStatus().draws===before,'paused draw');assert(await binding.resume(),'resume');near(pixel(40,25)[0],34);const after=binding.getStatus().draws;await delay(160);assert(binding.getStatus().draws===after,'idle redraw');
    });
    await check('source video refreshes locally without geometry recomputation',async()=>{
      video=document.createElement('video');video.muted=true;video.playsInline=true;video.src='./fixtures/window-colors.mp4';video.controls=true;fixture.append(video);
      const loaded=new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('fixture video failed')),{once:true});});
      const presented=new Promise(resolve=>video.requestVideoFrameCallback(resolve));
      video.load();await Promise.race([loaded,delay(5000).then(()=>{throw Error('video decode timeout');})]);
      await video.play();await Promise.race([presented,delay(5000).then(()=>{throw Error('video presentation timeout');})]);video.pause();
      const reference=document.createElement('canvas');reference.width=256;reference.height=128;const rc=reference.getContext('2d');rc.drawImage(video,0,0);metrics.videoFirstFrame={source:[...rc.getImageData(40,25,1,1).data],ready:video.readyState,time:video.currentTime,hidden:document.hidden};
      assert(await binding.setSource(video),'video source');metrics.videoFirstFrame.output=pixel(40,25);near(pixel(40,25)[0],34,8);const before=binding.getStatus().uploads;
      await video.play();for(let i=0;i<80&&!video.ended;i++)await delay(20);
      assert(binding.getStatus().uploads>before,'video did not refresh');near(pixel(40,25)[0],255,8);
      video.currentTime=0;await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));for(let i=0;i<40&&Math.abs(pixel(40,25)[0]-34)>8;i++)await delay(20);near(pixel(40,25)[0],34,8);await video.play();await binding.update(spec({rotateY:180}));const hiddenUploads=binding.getStatus().uploads;
      for(let i=0;i<80&&!video.ended;i++)await delay(20);assert(binding.getStatus().uploads===hiddenUploads,'hidden face kept uploading');await binding.update(spec());near(pixel(40,25)[0],255,8);
      video.pause();video.remove();ctx.fillStyle='#ff5511';ctx.fillRect(0,0,256,128);await binding.setSource(source);
    });
    await check('lost graphics context hides output and restoration continues',async()=>{
      const gl=output.getContext('webgl2'),extension=gl.getExtension('WEBGL_lose_context');assert(extension,'context loss extension unavailable');extension.loseContext();for(let i=0;i<30&&!binding.getStatus().contextLost;i++)await delay(10);assert(binding.getStatus().contextLost&&output.style.visibility==='hidden','loss not handled');await binding.update(spec({rotateY:20}));await delay(50);extension.restoreContext();for(let i=0;i<60&&binding.getStatus().contextLost;i++)await delay(20);assert(!binding.getStatus().contextLost,'not restored');assert(await binding.update(spec()),'after restore');near(pixel(40,25)[0],255,6);
    });
    await check('backing dimensions respect pixel budget, including thin surfaces',async()=>{
      binding.dispose();binding=attachSurfaceWindow(output,source,spec(),{pixelRatio:4,maxPixels:1,onError:e=>errors.push({code:e.code,message:e.message})});const thin={...spec(),windowSize:{width:8192,height:1}};assert(await binding.update(thin),'thin');const size=binding.getStatus().backingSize;assert(size.width*size.height<=1,`budget ${JSON.stringify(size)}`);
    });
    await check('dispose restores styles and prevents late publication; rebind works',async()=>{
      const pending=binding.update(spec());binding.dispose();assert(!await pending,'disposed request succeeded');assert(output.width===91&&output.height===73,'size not restored');assert(output.style.transform==='translateX(3px)'&&output.style.getPropertyPriority('transform')==='important','styles not restored');binding=attachSurfaceWindow(output,source,spec(),{pixelRatio:1,preserveDrawingBuffer:true});assert(await binding.update(spec()),'rebind');near(pixel(40,25)[0],255,6);
    });
    await check('warm interaction observation',async()=>{
      const times=[];const begin=performance.now();for(let i=0;i<90;i++){const t=performance.now();await binding.update(spec({rotateY:Math.sin(i/12)*60}));times.push(performance.now()-t);}times.sort((a,b)=>a-b);metrics.updateMs={median:times[45],p95:times[85],max:times.at(-1),elapsed:performance.now()-begin};metrics.status=binding.getStatus();
    });
    await check('native planner contract rejects unknown fields',async()=>{let rejected=false;try{await planSurfaceWindow({...spec(),unknown:1});}catch(e){rejected=e.code==='E_SCHEMA';}assert(rejected,'unknown field');});
    result.dataset.outcome='pass';result.textContent=JSON.stringify({outcome:'PASS',checks,metrics,expectedErrors:errors},null,2);
  }catch(error){result.dataset.outcome='fail';result.textContent=JSON.stringify({outcome:'FAIL',checks,error:error.message,metrics,errors},null,2);}
  finally{binding?.dispose();bitmap?.close();video?.pause();video?.remove();stream?.getTracks().forEach(t=>t.stop());button.disabled=false;}
};
