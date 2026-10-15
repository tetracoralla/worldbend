import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cardRuntimeChecks, cardReceivingChecks, cardReceivingStartupChecks, failInitialCardReceipt} from './card-browser-checks.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/web');
const cases={runtime:{page:'/examples/card.html',check:cardRuntimeChecks,minimum:53},
  receiving:{page:'/examples/card-receiving/index.html',check:cardReceivingChecks,minimum:30},
  startup:{page:'/examples/card-receiving/index.html',query:'fail-initial=1',check:cardReceivingStartupChecks,minimum:5}};

/** A loopback fixture for an actual browser, including browsers whose native
 * automation permission is unavailable. It executes the same flows as CDP;
 * the construction agent or maintainer opens the URLs in that browser. */
export async function serveCardBrowserChecks({browser,timeoutMs=600000,onResult=()=>{}}={}) {
  const results={};
  let resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/__card-result'&&req.method==='POST') {
        const name=url.searchParams.get('case');
        assert(Object.hasOwn(cases,name),'Unknown browser case');
        let body='';
        for await(const chunk of req) {body+=chunk;assert(body.length<=65536,'Browser result exceeds limit');}
        const result=JSON.parse(body);
        assert(!result.error,`${name}: ${result.error}`);
        assert(Array.isArray(result.errors)&&result.errors.length===0,`${name}: ${JSON.stringify(result.errors)}`);
        assert(result.checks>=cases[name].minimum,`${name}: Incomplete check (${result.checks}/${cases[name].minimum})`);
        if(browser==='safari') assert(/Version\/[^ ]+ Safari\//.test(result.browser),'Expected an actual Safari result');
        if(browser==='firefox') assert(/Firefox\//.test(result.browser),'Expected an actual Firefox result');
        results[name]=result;onResult(name,result);
        res.end('ok');
        if(Object.keys(results).length===Object.keys(cases).length) resolveDone(results);
        return;
      }
      const relative=decodeURIComponent(url.pathname);
      const file=path.resolve(root,'.'+relative);
      assert(file.startsWith(root+path.sep),'Path outside browser fixture');
      let bytes=await readFile(file);
      const entry=Object.entries(cases).find(([,value])=>value.page===relative&&Boolean(value.query)===url.searchParams.has('fail-initial'));
      if(entry&&!url.searchParams.has('inspect')) {
        const [name,{check}]=entry;
        let html=bytes.toString();
        if(name==='startup')html=html.replace('<head>',`<head><script>(${failInitialCardReceipt.toString()})()</script>`);
        bytes=Buffer.from(html.replace('</body>',
          `<script>(${run.toString()})(${check.toString()},${JSON.stringify(name)})</script></body>`));
      }
      const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':
        file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(bytes);
    } catch(error) {
      if(req.url.startsWith('/__card-result')) rejectDone(error);
      res.writeHead(400);res.end(String(error.message));
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${server.address().port}`;
  const timer=setTimeout(()=>rejectDone(new Error('Browser checks timed out; open all fixture URLs in the requested browser')),timeoutMs);
  return {url,done,close:async()=>{clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

async function run(check,name) {
  const errors=[];
  addEventListener('error',event=>errors.push(event.message??'Resource failed'));
  addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  const environment={browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},
    density:devicePixelRatio,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
  await check();
  const result={...window.__WORLDBEND_PARITY__,...environment,errors};
  const output=document.createElement('output');output.id='browser-check-result';
  output.textContent='Recording browser result…';
  output.style.cssText='position:fixed;left:0;top:0;right:0;padding:10px;background:#fff;color:#111;z-index:1000';
  document.body.append(output);
  try {
    const response=await fetch(`/__card-result?case=${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
    const detail=await response.text();
    // The full stack stays in the recorded result; the banner shows one line.
    const brief=value=>String(value).split('\n')[0];
    output.textContent=!response.ok?`FAIL: ${brief(detail)}`:
      result.error||errors.length?`FAIL: ${brief(result.error??errors.join('; '))}`:`PASS: ${name}, ${result.checks} assertions`;
  } catch(error) {output.textContent=`FAIL: browser result was not recorded: ${String(error.message??error)}`;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const browser=process.argv.find(arg=>arg.startsWith('--browser='))?.slice(10);
  assert(browser===undefined||['safari','firefox'].includes(browser),'Use --browser=safari or --browser=firefox');
  const fixture=await serveCardBrowserChecks({browser,onResult:(name,result)=>console.log(JSON.stringify({name,...result}))});
  console.log(`Open in ${browser??'the browser under test'}:\n${Object.values(cases).map(value=>fixture.url+value.page+'?'+(value.query??'test=1')).join('\n')}`);
  try {await fixture.done;console.log('Card browser runtime, receiving and startup recovery PASS');}
  finally {await fixture.close();}
}
