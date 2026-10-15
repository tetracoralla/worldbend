import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function withAppearancePlanner(callback) {
  const child=spawn(path.join(root,'target/debug/worldbend-mcp'),['--root',root,'--surface','catalog'],{stdio:['pipe','pipe','pipe']});
  let buffer='',id=0,stderr='';const pending=new Map();
  const fail=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
  child.on('error',fail);child.stdin.on('error',fail);child.once('exit',code=>fail(Error(`Material planner exited (${code}): ${stderr}`)));
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    if(buffer.length>1024*1024){fail(Error('Material planner output exceeds limit'));child.kill();return;}
    while(buffer.includes('\n')) {
      const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      if(!line)continue;
      try{const value=JSON.parse(line),request=pending.get(value.id);if(request){clearTimeout(request.timer);pending.delete(value.id);value.error?request.reject(Error(JSON.stringify(value.error))):request.resolve(value.result);}}
      catch(error){fail(error);child.kill();}
    }
  });
  function call(method,params) {const key=++id;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(key);reject(Error('Material planner timed out'));child.kill();},30000);
    pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');
  });}
  async function run(operation,args) {
    const result=await call('tools/call',{name:'worldbend.run',arguments:{operation,arguments:args}});
    const envelope=result.structuredContent;
    assert(envelope?.ok,JSON.stringify(envelope??result));return envelope.result;
  }
  try {
    await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'appearance-receiving-fixture',version:'1'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
    return await callback(run);
  } finally {for(const request of pending.values())clearTimeout(request.timer);child.kill();}
}