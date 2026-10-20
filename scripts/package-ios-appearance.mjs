import {cp,mkdir,mkdtemp,readFile,readdir,writeFile,stat,rename,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts/ios-receiving');
await mkdir(output,{recursive:true});
const scratch=await mkdtemp(path.join(output,'.stage-'));
const directory=path.join(scratch,'worldbend-ios-receiving');
try {
// Explicit source inputs only; build caches, credentials and author paths do not enter the receipt.
for(const entry of ['packages/swiftui','examples/ios-material-receiving','packages/web/examples/assets/fronalpstock.jpg','packages/web/examples/assets/NOTICE.md','LICENSE','NOTICE']){
  const destination=path.join(directory,entry);await mkdir(path.dirname(destination),{recursive:true});
  await cp(path.join(root,entry),destination,{recursive:true,filter:source=>!source.split(path.sep).some(part=>['.build','.swiftpm','xcuserdata'].includes(part))});
}
const files={};
async function scan(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isSymbolicLink())throw Error('Receiving package must not contain symlinks');
  if(entry.isDirectory())await scan(file);
  else {const bytes=await readFile(file);files[path.relative(directory,file)]=createHash('sha256').update(bytes).digest('hex');}
}}
await scan(directory);
await writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'worldbend.ios-receiving-source@0.1',files},null,2)+'\n');
const archive=path.join(output,'worldbend-ios-receiving.zip');
const temporaryArchive=path.join(scratch,'worldbend-ios-receiving.zip');
const result=spawnSync('/usr/bin/ditto',['-c','-k','--keepParent',directory,temporaryArchive],{stdio:'inherit'});
if(result.error||result.status!==0)throw result.error??Error('Archive creation failed');
await rename(temporaryArchive,archive);
console.log(JSON.stringify({archive,bytes:(await stat(archive)).size,sha256:createHash('sha256').update(await readFile(archive)).digest('hex')}));

} finally { await rm(scratch,{recursive:true,force:true}); }
