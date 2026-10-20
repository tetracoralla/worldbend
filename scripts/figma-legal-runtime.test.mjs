import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {appendFigmaJavaScriptLegalMaterial} from './generate-plugin-legal.mjs';
import {writeDeterministicZip} from './deterministic-zip.mjs';
import {licenseComment,figmaRuntimeLicenseBanner,assertFigmaRuntimeLockIdentity,readFigmaRuntimeLicense} from './figma-runtime-license.mjs';
const require=createRequire(import.meta.url),packagePath=require.resolve('fflate/package.json');
test('native checkout line endings preserve locked npm identity without changing license or provenance bytes',async()=>{
 const raw=await readFile(new URL('../pnpm-lock.yaml',import.meta.url),'utf8'),installed=JSON.parse(await readFile(packagePath,'utf8'));
 const lf=raw.replace(/\r\n/g,'\n');
 const prefix='  packages/figma:\n',importer=lf.split(prefix)[1].split('\n  packages/')[0];
 for(const ending of ['\n','\r\n']){
  const lock=lf.replace(/\n/g,ending);
  assert.doesNotThrow(()=>assertFigmaRuntimeLockIdentity(lock,installed.version));
  for(const field of ['specifier','version']){
   const changed=lf.replace(prefix+importer,prefix+importer.replace(`${field}: ${installed.version}`,`${field}: ${installed.version}-unreviewed`)).replace(/\n/g,ending);
   assert.notEqual(changed,lock);assert.throws(()=>assertFigmaRuntimeLockIdentity(changed,installed.version),/identity differs/);
  }
  assert.throws(()=>assertFigmaRuntimeLockIdentity(lock,`${installed.version}-unreviewed`),/identity differs/);
 }
 const material=readFigmaRuntimeLicense();assert.equal(material.lock,raw);
 assert.deepEqual(material.license,await readFile(path.join(path.dirname(packagePath),'LICENSE')));
});
test('Figma legal inventory carries locked npm identity and byte-exact upstream MIT license inside its ZIP',async()=>{
 const scratch=await mkdtemp(path.join(tmpdir(),'worldbend-figma-legal-'));
 try{
  await mkdir(path.join(scratch,'sbom'));await writeFile(path.join(scratch,'THIRD_PARTY_NOTICES.md'),'Cargo closure\n');
  await writeFile(path.join(scratch,'sbom/worldbend-figma-wasm.spdx.json'),JSON.stringify({documentNamespace:'https://spdx.org/spdxdocs/figma-'+'0'.repeat(64),packages:[],relationships:[]}));
  await appendFigmaJavaScriptLegalMaterial(scratch);
  const installed=JSON.parse(await readFile(packagePath,'utf8')),license=await readFile(path.join(path.dirname(packagePath),'LICENSE'));
  const entry=`licenses/npm-fflate-${installed.version}/LICENSE`,notice=await readFile(path.join(scratch,'THIRD_PARTY_NOTICES.md'),'utf8'),sbom=JSON.parse(await readFile(path.join(scratch,'sbom/worldbend-figma-wasm.spdx.json'),'utf8'));
  assert(notice.includes(`fflate ${installed.version}`));assert(notice.includes(license.toString().split('\n').find(l=>l.startsWith('Copyright '))));
  assert(sbom.packages.some(p=>p.name==='fflate'&&p.versionInfo===installed.version&&p.licenseDeclared==='MIT'&&p.externalRefs.some(r=>r.referenceLocator===`pkg:npm/fflate@${installed.version}`)));
  assert(sbom.relationships.some(r=>r.relatedSpdxElement===`SPDXRef-Npm-fflate-${installed.version}`));
  assert(sbom.packages[0].comment.includes(createHash('sha256').update(license).digest('hex')));
  assert(figmaRuntimeLicenseBanner().includes(license.toString()),'loose build banner must retain the complete upstream text');
  const archive=path.join(scratch,'legal.zip');await writeDeterministicZip({sourceRoot:scratch,archivePath:archive,rootName:"figma",entries:[entry,'THIRD_PARTY_NOTICES.md','sbom/worldbend-figma-wasm.spdx.json']});
  const zip=unzipSync(await readFile(archive));assert.deepEqual(Buffer.from(zip[`figma/${entry}`]),license);
  assert(Buffer.from(zip['figma/THIRD_PARTY_NOTICES.md']).toString().includes(`fflate ${installed.version}`));
  assert(JSON.parse(Buffer.from(zip['figma/sbom/worldbend-figma-wasm.spdx.json']).toString()).packages.some(p=>p.name==='fflate'));
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test('runtime legal comments cannot terminate JS comments or an inline HTML script and retain exact source text',()=>{
 const original='MIT\nCopyright holder\n*/ </SCRIPT><script>throw 1</script><!--';
 const banner=licenseComment(original,'dependency');
 assert(!banner.includes('</SCRIPT>')&&!banner.includes('<script>')&&!banner.includes('<!--'));
 assert.equal(banner.split('*/').length,2);
 assert.equal(JSON.parse(banner.slice(banner.indexOf('LICENSE JSON: ')+14,-3)),original);
 assert.throws(()=>licenseComment('MIT','unsafe */label'));
});
