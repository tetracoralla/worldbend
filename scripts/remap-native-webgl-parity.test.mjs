import assert from "node:assert/strict";
import test from "node:test";
import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {once} from "node:events";

import {
  compareRgba,
  compareCompositedRgba,
  terminateBrowserProcessesSync,
  closeChrome,
} from "./remap-native-webgl-parity.mjs";

test("Remap parity comparison excludes only the declared edge inset", () => {
  const expected = new Uint8Array(4 * 4 * 4);
  const actual = expected.slice();
  actual[(1 * 4 + 1) * 4] = 3;
  actual[(3 * 4 + 3) * 4] = 255;

  assert.deepEqual(compareRgba(actual, expected, 4, 4, 1), {
    maxChannelDelta: 3,
    meanChannelDelta: 3 / 16,
    differentChannelRatio: 1 / 16,
    comparedChannels: 16,
    inset: 1,
    maxAt: { x: 1, y: 1, channel: 0, actual: 3, expected: 0 },
  });
});

async function checkExitedBrowserCleanup(requireInheritedPipe){
  const profile=await mkdtemp(path.join(tmpdir(),"worldbend-close-chrome-test-"));
  const helperScript="setInterval(()=>{},1000)";
  const script=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(helperScript)}],{stdio:['ignore','ignore',process.stderr]});console.log(child.pid);child.unref();`;
  let browser,helper,helperPid;
  try{
    // Keep the unrelated sentinel owned by this harness: descendant lifetime
    // after leader exit varies by platform. The POSIX case separately retains
    // the inherited-pipe fixture.
    if(!requireInheritedPipe){
      helper=spawn(process.execPath,["-e",helperScript],{stdio:"ignore"});
      await once(helper,"spawn");helperPid=helper.pid;
    }
    browser=spawn(process.execPath,["-e",requireInheritedPipe?script:"process.exit(0)"],{stdio:["ignore","pipe","pipe"]});
    let output="";browser.stdout.on("data",chunk=>output+=chunk);
    await once(browser,"exit");
    if(requireInheritedPipe)helperPid=Number(output.trim());
    assert(Number.isSafeInteger(helperPid)&&helperPid>0);
    if(requireInheritedPipe)assert.equal(browser.stderr.destroyed,false,"fixture must retain an inherited open pipe after leader exit");
    process.kill(helperPid,0);
    await closeChrome({process:browser,profile});
    assert.equal(browser.stderr.destroyed,true,"owned pipe must be released after confirmed leader exit");
    process.kill(helperPid,0); // No wildcard/name/pid-tree retirement of other processes.
    await closeChrome({process:browser,profile}); // Idempotent cleanup/recovery.
  }finally{
    if(helperPid)try{process.kill(helperPid,"SIGTERM");}catch{}
    if(helper?.pid&&helper.exitCode===null&&helper.signalCode===null)await once(helper,"exit");
    browser?.stdout.destroy();browser?.stderr.destroy();await rm(profile,{recursive:true,force:true});
  }
}

test("closing an exited browser retires owned resources without killing other processes and is idempotent",async()=>{
  await checkExitedBrowserCleanup(false);
});

test("POSIX inherited stderr remains open after leader exit and is retired by owned browser cleanup",
  {skip:process.platform==="win32"?"Windows closes this pipe when the leader exits; the cross-platform ownership case still runs":false},async()=>{
  await checkExitedBrowserCleanup(true);
});

test("Remap parity comparison rejects inconsistent dimensions", () => {
  assert.throws(
    () => compareRgba(new Uint8Array(4), new Uint8Array(8), 1, 1),
    /same declared dimensions/,
  );
});

test("transparent parity ignores invisible RGB but observes every alpha edge", () => {
  const transparent = new Uint8Array([0, 0, 0, 0]);
  assert.equal(compareCompositedRgba(new Uint8Array([255, 80, 40, 0]), transparent, 1, 1).maxChannelDelta, 0);
  const clipped = compareCompositedRgba(new Uint8Array([255, 255, 255, 128]), transparent, 1, 1);
  assert.equal(clipped.inset, 0);
  assert.equal(clipped.maxChannelDelta, 128);
  assert.equal(clipped.composites[0].maxChannelDelta, 128);
});

test("process-exit cleanup terminates only live owned Chrome processes", () => {
  const signals = [];
  const live = {
    process: {
      pid: 123,
      exitCode: null,
      signalCode: null,
      kill(signal) { signals.push(signal); return true; },
    },
  };
  const exited = {
    process: {
      pid: 456,
      exitCode: 0,
      signalCode: null,
      kill() { throw new Error("must not signal an exited process"); },
    },
  };
  const neverStarted = {
    process: {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      kill() { throw new Error("must not signal a process without a pid"); },
    },
  };

  assert.equal(terminateBrowserProcessesSync([live, exited, neverStarted]), 1);
  assert.deepEqual(signals, ["SIGTERM"]);
});
