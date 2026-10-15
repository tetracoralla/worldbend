import {cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Build-only native QA host; launching is separate. All outputs are owned
// reproducible resources on this repository's volume, never an installation.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function option(name,fallback){
  const at=process.argv.indexOf(name);
  if(at>=0&&(!process.argv[at+1]||process.argv[at+1].startsWith('--')))throw Error('Missing path for '+name);
  return path.resolve(at<0?fallback:process.argv[at+1]);
}
const scratch=option('--scratch',path.join(root,'.task-notes/native-material-receiving/build'));
const project=path.join(root,'examples/ios-procedural-materials');
const app=option('--output',path.join(root,'.task-notes/native-material-receiving/WorldbendMaterialReceiving.app'));
const executable=path.join(app,'Contents/MacOS/WorldbendMaterialReceiving');
const preferenceStore=process.argv.includes('--preference-store')?option('--preference-store', ''):null;
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const matches=spawnSync('pgrep',['-x','WorldbendMaterialReceiving'],{encoding:'utf8',maxBuffer:16*1024});
if(matches.error||!([0,1].includes(matches.status)))throw Error('Unable to inspect the receiving example process.');
const pids=matches.stdout.trim().split(/\s+/).filter(value=>/^\d+$/.test(value));
if(pids.length&&execFileSync('ps',['-p',pids.join(','),'-o','command='],{encoding:'utf8',maxBuffer:64*1024})
  .split('\n').some(line=>line.trim()===executable))throw Error('Close this receiving example before rebuilding its app bundle.');
const args=['--package-path',project,'--scratch-path',scratch];
execFileSync('swift',['build',...args],{cwd:root,stdio:'inherit'});
const bin=execFileSync('swift',['build',...args,'--show-bin-path'],{cwd:root,encoding:'utf8'}).trim();
await mkdir(path.join(app,'Contents/MacOS'),{recursive:true});
await cp(path.join(bin,'WorldbendMaterialReceiving'),path.join(app,'Contents/MacOS/WorldbendMaterialReceiving'));
// SwiftPM's generated accessors search immediately beneath Bundle.main.bundleURL.
for(const name of await readdir(bin))if(name.endsWith('.bundle'))await cp(path.join(bin,name),path.join(app,name),{recursive:true});
await writeFile(path.join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>WorldbendMaterialReceiving</string>
<key>CFBundleIdentifier</key><string>org.openadam.worldbend.procedural-receiving.mac</string>
<key>CFBundleName</key><string>Worldbend Material Receiving</string>
<key>CFBundleDisplayName</key><string>Worldbend Material Receiving</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
${process.argv.includes('--legacy-mesh')?'<key>WorldbendLegacyMeshFixture</key><true/>':''}
${process.argv.includes('--personal-preferences')?'<key>WorldbendPersonalPreferences</key><true/>':''}
${process.argv.includes('--invalid-render-size')?'<key>WorldbendInvalidMaterialSize</key><true/>':''}
${preferenceStore?'<key>WorldbendPreferenceStore</key><string>'+xml(preferenceStore)+'</string>':''}
</dict></plist>
`);
console.log(JSON.stringify({app,scratch,installed:false}));
