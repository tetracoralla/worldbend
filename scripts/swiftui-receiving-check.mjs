import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(command,args){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${command} failed (${result.status})`);
}
run(process.execPath,['scripts/generate-ios-appearance-receiving.mjs','--check']);
if(process.platform==='darwin')run('swift',['test','--package-path','packages/swiftui','--scratch-path','.task-notes/ios-material-receiving/swift-build']);
else console.log('Native SwiftUI compilation SKIP: an Apple SDK host is required. Canonical receipts were checked.');
