import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function assertFigmaRuntimeLockIdentity(lock,version){
 // Checkout line endings are not dependency identity. Keep the original lock
 // bytes for provenance, and normalize only this parsing view.
 const parsed=lock.replace(/\r\n/g,'\n'),importer=parsed.split('  packages/figma:\n')[1]?.split('\n  packages/')[0]??'';
 if(!importer.includes(`      fflate:\n        specifier: ${version}\n        version: ${version}\n`)||!parsed.includes(`  fflate@${version}:\n`))throw Error('Figma JavaScript license identity differs from pnpm lock');
}
export function readFigmaRuntimeLicense(){
 const manifest=JSON.parse(readFileSync(path.join(root,'packages/figma/package.json'),'utf8')),version=manifest.dependencies.fflate;
 const names=Object.keys(manifest.dependencies).filter(name=>!manifest.dependencies[name].startsWith('workspace:'));
 if(names.join(',')!=='fflate'||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Figma bundled JavaScript dependency inventory requires a locked legal entry');
 const lock=readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8');assertFigmaRuntimeLockIdentity(lock,version);
 const require=createRequire(path.join(root,'packages/figma/package.json')),installed=require.resolve('fflate/package.json'),pkg=JSON.parse(readFileSync(installed,'utf8'));
 if(pkg.name!=='fflate'||pkg.version!==version||pkg.license!=='MIT'||Object.keys(pkg.dependencies??{}).length)throw Error('Figma bundled JavaScript dependency metadata changed; inspect its complete runtime closure');
 const license=readFileSync(path.join(path.dirname(installed),'LICENSE')),copyright=license.toString('utf8').split('\n').find(line=>line.startsWith('Copyright '));
 if(!copyright)throw Error('Figma JavaScript upstream copyright unavailable');
 return {version,license,copyright,lock};
}
/** A legal bang-comment survives minification, adds no executable code and is
 * safe inside the single-file UI script. Rare comment/HTML terminators use a
 * reversible JSON-encoded comment rather than dropping any upstream text. */
export function licenseComment(license,label){
 if(typeof license!=='string'||typeof label!=='string'||/[\r\n*<>]/.test(label))throw Error('Invalid runtime license comment');
 if(/\*\/|<\/script|<!--/i.test(license))return `/*! ${label} LICENSE JSON: ${JSON.stringify(license).replace(/\*/g,'\\u002a').replace(/</g,'\\u003c')} */`;
 return `/*! ${label}\n${license}\n*/`;
}
export function figmaRuntimeLicenseBanner(){const {version,license}=readFigmaRuntimeLicense();return licenseComment(license.toString('utf8'),`fflate ${version} — MIT`);}
