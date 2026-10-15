import assert from 'node:assert/strict';
import test from 'node:test';
import {serveCardBrowserChecks} from './card-browser-fixture.mjs';

const result=(checks,browser='Firefox/153.0')=>({checks,browser,errors:[]});
const submit=(fixture,name,value)=>fetch(`${fixture.url}/__card-result?case=${name}`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),
});

test('completion waits for runtime, receiving and startup recovery',async()=>{
  const fixture=await serveCardBrowserChecks({browser:'firefox'});
  let complete=false;
  fixture.done.then(()=>{complete=true;});
  try{
    assert.equal((await submit(fixture,'runtime',result(55))).status,200);
    assert.equal((await submit(fixture,'receiving',result(30))).status,200);
    assert.equal(complete,false,'two passing pages cannot close the three-flow check');
    assert.equal((await submit(fixture,'startup',result(5))).status,200);
    assert.deepEqual(Object.keys(await fixture.done).sort(),['receiving','runtime','startup']);
  }finally{await fixture.close();}
});

for(const [label,value,pattern] of [
  ['incomplete flow',result(1),/Incomplete/],
  ['wrong engine',result(55,'Version\/26.6 Safari\/605.1'),/actual Firefox/],
  ['unhandled browser error',{...result(55),errors:['late failure']},/late failure/],
]) test(`rejects ${label}`,async()=>{
  const fixture=await serveCardBrowserChecks({browser:'firefox'});
  const rejected=assert.rejects(fixture.done,pattern);
  try{assert.equal((await submit(fixture,'runtime',value)).status,400);await rejected;}
  finally{await fixture.close();}
});

test('an unfinished browser run fails on timeout and can close its server',async()=>{
  const fixture=await serveCardBrowserChecks({timeoutMs:20});
  try{await assert.rejects(fixture.done,/timed out/);}
  finally{await fixture.close();}
  await assert.rejects(fetch(fixture.url));
});
