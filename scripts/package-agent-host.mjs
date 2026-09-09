import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishImmutableArtifact } from './immutable-artifact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const plugin=JSON.parse(await readFile(path.join(root,'plugins/worldbend/.codex-plugin/plugin.json'),'utf8'));
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This native artifact is macOS arm64 only');
const output=path.join(root,'artifacts/agent-host');await mkdir(output,{recursive:true});
const staging=await mkdtemp(path.join(output,'.stage-')),component=path.join(staging,'component');
const hash=data=>'sha256:'+createHash('sha256').update(data).digest('hex');
const json=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
try {
  const pluginRoot='marketplace/plugins/worldbend';
  await mkdir(path.join(component,'marketplace/.agents/plugins'),{recursive:true});
  await cp(path.join(root,'plugins/worldbend'),path.join(component,pluginRoot),{recursive:true});
  await cp(path.join(root,'.agents/plugins/marketplace.json'),path.join(component,'marketplace/.agents/plugins/marketplace.json'));
  // Preserve the owner's existing private/no-product-license policy. NOASSERTION
  // is the same fact carried by the product's existing SPDX inventory; it does
  // not add Apache/MIT terms or grant distribution rights.
  const spdx=JSON.parse(await readFile(path.join(component,pluginRoot,'sbom/worldbend-macos-arm64.spdx.json'),'utf8'));
  const product=spdx.packages.filter(entry=>entry.SPDXID==='SPDXRef-Package-Worldbend');
  if(product.length!==1||product[0].licenseDeclared!=='NOASSERTION')throw new Error('Reconcile the product license and artifact notice before packaging');
  await cp(path.join(root,'LICENSE-STATUS.md'),path.join(component,'LICENSE-STATUS.md'));
  await writeFile(path.join(component,'NOTICE.md'),'# Worldbend\n\nDeveloped by openAdam. This private component preserves the current Worldbend\nproduct identity and its bundled third-party notices. It does not adopt the\nretired Projective component\'s product-license metadata.\n');
  const files=[];
  async function inventory(directory,prefix='') {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const name=prefix?`${prefix}/${entry.name}`:entry.name,absolute=path.join(directory,entry.name),info=await lstat(absolute);
      if(info.isSymbolicLink())throw new Error(`Cannot seal a link: ${name}`);
      if(info.isDirectory())await inventory(absolute,name);
      else if(info.isFile()){const data=await readFile(absolute);files.push({path:name,sha256:hash(data),bytes:data.length,executable:Boolean(info.mode&0o111)});}
      else throw new Error(`Cannot seal a nonregular file: ${name}`);
    }
  }
  await inventory(component);files.sort((a,b)=>a.path.localeCompare(b.path));
  const pluginIdentity=['.codex-plugin/plugin.json','.mcp.json','bin/worldbend-mcp',...files.filter(file=>file.path.startsWith(`${pluginRoot}/skills/`)||file.path.startsWith(`${pluginRoot}/web/`)).map(file=>file.path.slice(pluginRoot.length+1))];
  const legal={license:'LICENSE-STATUS.md',notice:'NOTICE.md',thirdPartyNotices:`${pluginRoot}/THIRD_PARTY_NOTICES.md`,sbom:`${pluginRoot}/sbom/worldbend-macos-arm64.spdx.json`};
  const descriptor={schemaVersion:'openadam.agent-host-component.v0.1',id:'worldbend',version:plugin.version,kind:'agent-tool',files,identityFiles:['marketplace/.agents/plugins/marketplace.json',...pluginIdentity.map(file=>`${pluginRoot}/${file}`),...Object.values(legal)],entrypoints:{mcp:`${pluginRoot}/bin/worldbend-mcp`,cli:`${pluginRoot}/bin/worldbend`},integration:{schemaVersion:'openadam.agent-host-tool-integration.v0.2',displayName:'Worldbend',summary:plugin.description,codex:{marketplaceRoot:'marketplace',marketplace:'worldbend-local',pluginRoot,plugin:'worldbend',identityFiles:pluginIdentity},runtime:{transport:'mcp-stdio',executor:'component',command:`${pluginRoot}/bin/worldbend-mcp`,args:['--surface','catalog'],cwd:pluginRoot,workspaceEnvironment:['WORLDBEND_WORKSPACE_ROOT'],expectedTools:['worldbend.describe','worldbend.run','worldbend.search'],timeoutMs:10000},ownership:{uninstall:'agent-host-created-only'}},legal};
  await json(path.join(component,'component.json'),descriptor);
  const archive=`worldbend-${plugin.version}-macos-arm64.tar.gz`;
  // Explicit regular file list: no source directories, live configuration or
  // implicit tar traversal. COPYFILE_DISABLE excludes host-specific Apple data.
  await writeFile(path.join(staging,'files.txt'),[...files.map(file=>'./'+file.path),'./component.json'].sort().join('\n')+'\n');
  const result=spawnSync('/usr/bin/tar',['-czf',path.join(staging,archive),'-C',component,'-T',path.join(staging,'files.txt')],{env:{...process.env,COPYFILE_DISABLE:'1'},encoding:'utf8',timeout:60000});
  if(result.status!==0)throw new Error(result.stderr);
  const bytes=await readFile(path.join(staging,archive)),descriptorBytes=await readFile(path.join(component,'component.json'));
  const report={id:'worldbend',version:plugin.version,archive,archiveSha256:hash(bytes),archiveBytes:bytes.length,descriptorSha256:hash(descriptorBytes),platform:'darwin-arm64',spdx:'NOASSERTION',productLicense:'not-declared',fileCount:files.length};
  await json(path.join(staging,'package-report.json'),report);
  const destination=path.join(output,`${plugin.version}-${report.archiveSha256.slice(7,19)}`);await publishImmutableArtifact(staging,destination);
  console.log(JSON.stringify({...report,directory:destination},null,2));
}catch(error){await rm(staging,{recursive:true,force:true});throw error;}
