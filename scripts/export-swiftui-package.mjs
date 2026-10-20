import {cp, mkdir, readFile, readdir, writeFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Local source artifact, not installation or publication. Require a new/empty
// directory so a consumer's modified sources cannot be silently overwritten.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const at=process.argv.indexOf('--output');
if(at<0 || !process.argv[at+1]) throw Error('Pass --output <empty directory>');
const output=path.resolve(process.argv[at+1]);
await mkdir(output,{recursive:true});
if((await readdir(output)).length) throw Error('Output must be empty');
for(const item of ['Package.swift','Sources','Tests','README.md','PROCEDURAL_MATERIALS.md']) {
  await cp(path.join(root,'packages/swiftui',item),path.join(output,item),{recursive:true});
}
for(const item of ['LICENSE','NOTICE']) await cp(path.join(root,item),path.join(output,item));
const files={};
async function scan(folder){
  for(const item of (await readdir(folder)).sort()){
    const file=path.join(folder,item), info=await lstat(file);
    if(info.isSymbolicLink())throw Error('Source package may not contain links');
    if(info.isDirectory())await scan(file);
    else files[path.relative(output,file)]=createHash('sha256').update(await readFile(file)).digest('hex');
  }
}
await scan(output);
const receipt={schema:'worldbend.swiftui-source@0.1',
  baseRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceModified:!!execFileSync('git',['status','--porcelain','--','packages/swiftui'],{cwd:root,encoding:'utf8'}).trim(),
  contentHash:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
await writeFile(path.join(output,'source-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({output,contentHash:receipt.contentHash,fileCount:Object.keys(files).length}));
