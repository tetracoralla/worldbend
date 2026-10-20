// Actual browser media decoding, keyboard playback and byte-range seeking.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';

export async function checkEncodedVideo(movie,evidence,{width=960,height=640,duration=2}={}) {
 let browser,server;
 try {
 const html=`<!doctype html><meta charset="utf-8"><title>Worldbend encoded delivery</title>
 <style>body{margin:0;background:#101622;color:#e9eef6;font:14px system-ui;padding:24px}video{display:block;width:100%;max-width:960px}h1{font-size:18px}</style>
 <h1>Worldbend · encoded motion</h1><video id="movie" controls muted playsinline src="/motion.mp4"></video><script>
 (async()=>{try{const video=document.getElementById('movie');
 const once=event=>new Promise(resolve=>video.addEventListener(event,resolve,{once:true}));
 const input=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT_DONE__=false;
  globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};
  while(!globalThis.__WORLDBEND_INPUT_DONE__)await new Promise(resolve=>setTimeout(resolve,10));};
 if(video.readyState<2)await once('loadeddata');
 if(video.error)throw Error(video.error.message);const duration=video.duration;
 video.focus();const playing=once('playing');
 await input('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await input('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await playing;await new Promise(resolve=>setTimeout(resolve,450));const advanced=video.currentTime;
 const pausing=once('pause');
 await input('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await input('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
 await pausing;const paused=video.currentTime;await new Promise(resolve=>setTimeout(resolve,180));
 if(Math.abs(video.currentTime-paused)>.04)throw Error('Paused movie kept advancing');
 const events=[];for(const event of ['playing','pause','seeking','seeked','ended','error'])video.addEventListener(event,()=>events.push({event,time:video.currentTime,paused:video.paused}));
 const seekTarget=duration-.1;const seeking=once('seeked');video.currentTime=seekTarget;await seeking;
 const seek=video.currentTime;
 if(!video.paused||Math.abs(seek-seekTarget)>.04)throw Error('Seek failed: '+JSON.stringify({seekTarget,seek,paused:video.paused,events,buffered:Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)]),seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)])}));
 const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
 canvas.getContext('2d').drawImage(video,0,0);
 const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
 let foreground=0;const colors=new Set();for(let i=0;i<pixels.length;i+=64){
  if(Math.abs(pixels[i]-16)+Math.abs(pixels[i+1]-22)+Math.abs(pixels[i+2]-34)>45)foreground++;
  colors.add([pixels[i]>>4,pixels[i+1]>>4,pixels[i+2]>>4].join(','));}
 if(foreground<1000||colors.size<20)throw Error('Decoded video lost foreground artwork');
 await input('Input.dispatchMouseEvent',{type:'mouseMoved',x:400,y:400},'encoded-video');
 globalThis.__WORLDBEND_PARITY__={duration,advanced,paused,seek,width:video.videoWidth,height:video.videoHeight,
 decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames,foregroundSamples:foreground,colorBins:colors.size};
 }catch(error){globalThis.__WORLDBEND_PARITY__={error:String(error.stack||error)}}})();</script>`;
 const bytes=await readFile(movie);
 server=createServer((req,res)=>{if(req.url==='/motion.mp4'){
  // A receiving HTTP project must serve byte ranges for media seeking. Keep
  // the actual encoded artifact unchanged while exercising native decoding.
  let start=0,end=bytes.length-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});res.end();return;}
   start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
   end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});res.end();return;}
   status=206;
  }
  res.writeHead(status,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})});
  res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));}
 else{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
 browser=await launchChrome(await findChrome(),[]);const page=await createPage(browser.debugUrl,url);
 const runtime=await readPageResult(page.webSocketDebuggerUrl,{url,width:1040,height:800,timeoutMs:30000,trustedInput:true,screenshotDirectory:evidence});
 await writeFile(path.join(evidence,'browser-result.json'),JSON.stringify(runtime,null,2)+'\n');
 assert(!runtime.error,runtime.error);assert(runtime.advanced>.15&&runtime.decodedFrames>=2,'Movie failed to play: '+JSON.stringify(runtime));
 assert.equal(runtime.width,width);assert.equal(runtime.height,height);assert(Math.abs(runtime.duration-duration)<.00001);
 return runtime;
 } finally {
  if(browser)await closeChrome(browser);
  if(server)await new Promise(resolve=>server.close(resolve));
 }
}
