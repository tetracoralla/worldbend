import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeWebLegalMaterial } from './generate-plugin-legal.mjs';
import { publishImmutableArtifact } from './immutable-artifact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'plugins/worldbend/.codex-plugin/plugin.json'),'utf8'));
const source=JSON.parse(await readFile(path.join(root,'packages/web/package.json'),'utf8'));
const parent=path.join(root,'artifacts/web');await mkdir(parent,{recursive:true});
const staging=await mkdtemp(path.join(parent,'.stage-'));
let destination;
const packageRoot=path.join(staging,'package');
const run=(command,args,cwd=root)=>{const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});if(r.status!==0)throw new Error(`${command}: ${r.error??r.stderr}`);return r.stdout;};
try {
  await writeWebLegalMaterial({destination:packageRoot,version:manifest.version});
  await cp(path.join(root,'packages/web/dist'),path.join(packageRoot,'dist'),{recursive:true});
  await cp(path.join(root,'packages/web/examples'),path.join(packageRoot,'examples'),{recursive:true});
  await cp(path.join(root,'plugins/worldbend/skills/worldbend/references/live-web.md'),path.join(packageRoot,'README.md'));
  await cp(path.join(root,'docs/PLANE_POSE_CONTRACT.md'),path.join(packageRoot,'PLANE_POSE_CONTRACT.md'));
  // Vite has bundled every runtime import. Source-only workspace dependencies
  // must not escape into the independently installable local package.
  const pkg={name:source.name,version:manifest.version,private:true,license:'Apache-2.0',type:'module',exports:source.exports,files:['LICENSE','NOTICE','dist','examples','licenses','sbom','README.md','PLANE_POSE_CONTRACT.md','THIRD_PARTY_NOTICES.md']};
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const archive=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',staging],packageRoot))[0];
  const bytes=await readFile(path.join(staging,archive.filename));
  // Agent distributions receive an inert SDK archive, without the demo UI.
  const runtimeDirectory=path.join(staging,'runtime');await mkdir(runtimeDirectory);
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify({...pkg,files:pkg.files.filter(file=>file!=='examples')},null,2)+'\n');
  const runtimeArchive=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',runtimeDirectory],packageRoot))[0];
  const runtimeBytes=await readFile(path.join(runtimeDirectory,runtimeArchive.filename));
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const chunks=[];
  // Include the focused entry's actual static module closure in size reporting.
  const visited=new Set();
  async function visit(name){if(visited.has(name))return;visited.add(name);const data=await readFile(path.join(packageRoot,'dist',name));chunks.push({path:name,bytes:data.length,gzipBytes:gzipSync(data).length});for(const match of data.toString().matchAll(/from\s*["'](\.[^"']+\.js)["']/g))await visit(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));}
  await visit('perspective.js');
  const report={schema:'worldbend.web-package-observation.v0.1',version:pkg.version,archive:archive.filename,runtimeArchive:`runtime/${runtimeArchive.filename}`,runtimeArchiveBytes:runtimeBytes.length,runtimeArchiveSha256:createHash('sha256').update(runtimeBytes).digest('hex'),archiveBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),focusedModules:chunks,focusedBytes:chunks.reduce((sum,item)=>sum+item.bytes,0),focusedGzipBytes:chunks.reduce((sum,item)=>sum+item.gzipBytes,0),productLicense:'Apache-2.0',runtimeDependencies:[]};
  await writeFile(path.join(staging,'package-report.json'),JSON.stringify(report,null,2)+'\n');
  // A disposable consumer outside the workspace proves no workspace:* or hidden
  // package-manager resolution is necessary, and executes the packed WASM.
  const consumer=await mkdtemp(path.join(tmpdir(),'worldbend-web-consumer-'));
  try {
    await writeFile(path.join(consumer,'package.json'),'{"private":true,"type":"module"}');
    run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',path.join(runtimeDirectory,runtimeArchive.filename)],consumer);
    const smoke=`import assert from 'node:assert/strict';
import {projectPlanePose,projectPlaneStrip} from '@worldbend/web/perspective';
const pose=await projectPlanePose({elementSize:{width:640,height:360},pose:{perspective:1400,rotateY:-12}});
assert.equal(pose.spec.schema,'worldbend.transform');
const strip=await projectPlaneStrip({spec:pose.spec,panels:[{id:'outer',start:0,end:.47,elementSize:{width:140,height:310}},{id:'inner',start:.53,end:1,elementSize:{width:140,height:310}}]});
assert.equal(strip.items.length,2);assert(strip.items.every(item=>item.css.transform.startsWith('matrix3d(')));
await assert.rejects(projectPlanePose({elementSize:{width:640,height:360},pose:{perspective:1400,depth:1400}}),error=>error.code==='E_HOMOGRAPHY_HORIZON_CROSSING');
console.log('Packed independent Web consumer passed');`;
    await writeFile(path.join(consumer,'smoke.mjs'),smoke);process.stdout.write(run('node',['smoke.mjs'],consumer));
    await writeFile(path.join(consumer,'consumer.ts'),`import {attachPlanePose,attachPerspective,attachPerspectiveStrip,normalizedSpec} from '@worldbend/web/perspective';
const container=document.createElement('div'),element=document.createElement('div');
const pose=attachPlanePose(element,{perspective:1400,rotateY:-8});
const saved=pose.getSpec();if(saved){const binding=attachPerspective(element,container,saved);void binding.update(saved);binding.dispose();}
const plane=normalizedSpec({tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}});
attachPerspectiveStrip(container,[{id:'one',element,start:0,end:1}],plane).dispose();`);
    run(path.join(root,'node_modules/.bin/tsc'),['--noEmit','--strict','--target','es2022','--module','esnext','--moduleResolution','bundler','--lib','es2022,dom','consumer.ts'],consumer);
  } finally {await rm(consumer,{recursive:true,force:true});}
  // Versioned output is immutable; do not overwrite an earlier artifact.
  destination=path.join(parent,`${manifest.version}-${report.sha256.slice(0,12)}`);
  await publishImmutableArtifact(staging,destination);
  const output={...report,directory:destination};
  const reportIndex=process.argv.indexOf('--report-file');
  if(reportIndex!==-1){const outputPath=process.argv[reportIndex+1];if(!outputPath||!path.isAbsolute(outputPath))throw new Error('--report-file requires an absolute path');await writeFile(outputPath,JSON.stringify(output,null,2)+'\n');}
  console.log(JSON.stringify(output,null,2));
} catch(error){await rm(staging,{recursive:true,force:true});throw error;}
