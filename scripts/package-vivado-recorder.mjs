import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length>2)throw Error('Usage: package-vivado-recorder.mjs');
const out=path.join(root,'dist','vivado-vm-'+Date.now());
const files=['bin/vivado-recorder/VivadoRecorder.exe','src/Recorder.Vivado/README.md','scripts/analyze-vivado-recording.ps1','src/analyzer/vivado-cli.mjs',
 ...['vivado-evidence','vivado-program','vivado-replay-plan','vivado-renderer','vivado-knowledge','gpt-client','workflow','local-env'].map(n=>'src/analyzer/lib/'+n+'.mjs'),
 ...['index.json','sources.json','command-catalog.json','live-observation.json','home/ui-map.json','help/ui-map.json','new-project/ui-map.json','project/ui-map.json','settings/ui-map.json'].map(n=>'ui-maps/vivado/2024.2/en-US/'+n)];
for(const file of files){const dest=path.join(out,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,file),dest);}
const example=JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8'));
await fs.writeFile(path.join(out,'config.json'),JSON.stringify({provider:Object.fromEntries(['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses'].filter(k=>example.provider[k]!==undefined).map(k=>[k,example.provider[k]]))},null,2));
await fs.writeFile(path.join(out,'PACKAGE-NOTE.txt'),'No credentials or recordings. Recorder works without Node. Analyze locally after copying the recording, or install Node 20+ separately in the VM. Native verification is separate.');
console.log(out);
