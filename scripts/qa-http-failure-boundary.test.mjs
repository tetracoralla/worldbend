import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer,request as httpRequest} from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),viteRequire=createRequire(require.resolve('vite/package.json'));
const {parseAst}=viteRequire('rollup/parseAst');
import {createQaHttpFailureBoundary} from './qa-http-failure-boundary.mjs';

const routes=[
 ['appearance-runtime-check.mjs','/fail.js',500],['foil-receiving-check.mjs','/fail.js',500],
 ['mesh-gradient-receiving-check.mjs','/fail.js',500],['mesh-surface-runtime-check.mjs','/web/fail.js',500],
 ['scene-example-package-check.mjs','/fail.js',400],['scene-three-receiving-check.mjs','/web/fail.js',400],
];
async function actualCallback(file,read,boundary){
 const source=await readFile(new URL(file,import.meta.url),'utf8'),ast=parseAst(source);let callback;
 function visit(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee?.name==='createServer')callback=source.slice(node.arguments[0].start,node.arguments[0].end);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}visit(ast);
 assert(callback,`Actual ${file} HTTP callback is missing`);
 const fixtureRoot=path.resolve('/fixture');
 const deps={httpFailures:boundary,readFile:read,path,root:fixtureRoot,webRoot:fixtureRoot,scratch:fixtureRoot,moved:fixtureRoot,threeRoot:fixtureRoot,example:fixtureRoot,
 cases:[],html:'fixture',plans:{},docs:{},marker:'marker',startupProbe:'probe',script:'',mime:()=> 'text/javascript',contentType:()=> 'text/javascript',
 send:(res,status,type,body)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);},writeFile:async()=>{}};
 return new Function(...Object.keys(deps),`return ${callback};`)(...Object.values(deps));
}
function get(server,url){return new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:url},res=>{const pieces=[];res.on('data',p=>pieces.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(pieces).toString()}));});req.on('error',reject);req.end();});}
for(const [file,url,status]of routes)test(`actual ${file} callback preserves failure privacy, status, original cause and successful socket retry`,async()=>{
 const boundary=createQaHttpFailureBoundary(file),original=new Error('PRIVATE_DIAGNOSTIC_PATH: fixture access refused');original.code='EACCES';let fail=true;
 const callback=await actualCallback(file,async()=>{if(fail)throw original;return Buffer.from('healthy bytes');},boundary),server=createServer(callback);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const result=await get(server,url);assert.equal(result.status,status);assert.equal(result.body,'Fixture request failed.\n');
  assert.equal(result.headers['content-type'],'text/plain; charset=utf-8');assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['x-content-type-options'],'nosniff');
  const runner=new Error('browser contract refused');const decorated=boundary.decorate(runner);assert.equal(decorated.cause.errors[0].cause,original);assert.equal(decorated.cause.errors.at(-1),runner);
  fail=false;const recovered=await get(server,url);assert.equal(recovered.status,200);assert.equal(recovered.body,'healthy bytes');assert.equal(recovered.headers['content-type'],'text/javascript');
  if(!file.startsWith('scene-')){const missing=await get(server,'/unknown');assert([404,200].includes(missing.status));}
  // Actual callback parses URL within its failure boundary; malformed absolute
  // URL can be delivered by a loopback raw HTTP client without killing runner.
  const malformed=await get(server,'http://[');assert.equal(malformed.status,status);assert.equal(malformed.body,'Fixture request failed.\n');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('partial/disconnected response cannot expose diagnostics; retention is bounded without replacing originals',()=>{
 const b=createQaHttpFailureBoundary('fixture'),cause=new Error('original private stack');let destroyed=0;
 b.respond({method:'GET',url:'/partial'},{headersSent:true,destroy(){destroyed++;}},cause,500);
 b.respond({method:'GET',url:'/gone'},{destroyed:true},cause,500);
 for(let i=0;i<30;i++)b.respond({method:'GET',url:'/gone'},{destroyed:true},cause,500);
 const issue=b.decorate(new Error('runner'));assert.equal(destroyed,1);assert.equal(issue.cause.errors.length,9);assert.equal(issue.cause.errors[0].cause,cause);assert.match(issue.cause.message,/omitted=24/);
});
test('ordinary route 404 is not promoted to runner failure',async()=>{
 for(const file of ['foil-receiving-check.mjs','mesh-gradient-receiving-check.mjs','mesh-surface-runtime-check.mjs']){
  const b=createQaHttpFailureBoundary(file),callback=await actualCallback(file,async()=>Buffer.from('healthy'),b),runner=new Error('unrelated assertion');let status;
  await callback({url:'/unknown',method:'GET'},{writeHead:s=>status=s,end(){},setHeader(){}});assert.equal(status,404);assert.equal(b.decorate(runner),runner);
 }
});

test('actual partial and disconnected sockets retain their private original cause without a second HTTP write',{timeout:5000},async()=>{
 for(const mode of ['partial','disconnected']){
  const boundary=createQaHttpFailureBoundary(mode),original=new Error('PRIVATE_SOCKET_FAILURE');let release;
  const held=new Promise(resolve=>release=resolve);
  const callback=await actualCallback('foil-receiving-check.mjs',async()=>{await held;throw original;},boundary);
  let handled,admit;
  const completed=new Promise(resolve=>handled=resolve),admitted=new Promise(resolve=>admit=resolve);
  const server=createServer(async(req,res)=>{
   if(mode==='partial'){res.writeHead(200,{'Content-Type':'text/javascript'});res.write('partial');release();}
   else {res.once('close',release);admit();}
   await callback(req,res);handled();
  });
  try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   let received='';
   let client;
   const closed=new Promise(resolve=>{
    const req=client=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/fail.js'},res=>{
     res.on('data',data=>received+=data);res.once('aborted',resolve);res.once('error',resolve);res.once('end',resolve);
    });req.once('error',resolve);req.end();
   });
   if(mode==='disconnected'){await admitted;client.destroy();}
   await closed;await completed;
   assert(!received.includes('PRIVATE_SOCKET_FAILURE'));
   assert.equal(boundary.decorate(new Error('runner')).cause.errors[0].cause,original);
  }finally{release();await new Promise(resolve=>server.close(resolve));}
 }
});
