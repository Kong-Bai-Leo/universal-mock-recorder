// Explicit allowlist; no user .env/config, recordings or source tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderJmp} from '../src/analyzer/lib/jmp-renderer.mjs';
import {jmpProgram} from '../tests/fixtures/jmp.mjs';
import {resolveJmpVersion} from '../src/analyzer/lib/jmp-version.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const includeNode=process.argv.includes('--with-node');
if(process.argv.slice(2).some(a=>a!=='--with-node'))throw Error('Usage: package-jmp-recorder.mjs [--with-node]');
if(includeNode&&(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<20))throw Error('Windows Node 20+ required');
const out=path.join(root,'dist','jmp-vm-'+Date.now());await fs.mkdir(out,{recursive:true});
const files=['bin/jmp-recorder/JmpRecorder.exe','scripts/analyze-jmp-recording.ps1','src/analyzer/jmp-cli.mjs',
  ...['jmp-evidence.mjs','jmp-program.mjs','jmp-api-contract.mjs','jmp-replay-plan.mjs','jmp-renderer.mjs','jmp-knowledge.mjs','jmp-version.mjs','gpt-client.mjs','workflow.mjs','local-env.mjs'].map(p=>'src/analyzer/lib/'+p),
  'src/Recorder.Jmp/README.md','docs/jmp-api-plan.md','docs/jmp-support-matrix.md','docs/jmp-verification-2026-09-11.md','docs/jmp-18-version-compatibility.md',
  ...['ui-index.json','sources.json','file/ui-map.json','analyze/ui-map.json','distribution/ui-map.json','table/ui-map.json','report/ui-map.json','environment-report.md','live-observation.json','verification-report.json'].map(p=>'ui-maps/jmp/19.1/en-US/'+p)];
// Package only indexed map sections plus explicit audit files, never screenshots.
const jmp18Base='ui-maps/jmp/18/en-US/';
const jmp18Index=JSON.parse(await fs.readFile(path.join(root,jmp18Base,'ui-index.json'),'utf8'));
const sections18=jmp18Index.sections.map(s=>{
  if(typeof s.file!=='string'||!(/^[a-z-]+\/ui-map\.json$/).test(s.file))throw Error('Invalid JMP 18 map section path');
  const base=path.resolve(root,jmp18Base),source=path.resolve(base,s.file);
  if(!source.startsWith(base+path.sep))throw Error('JMP 18 map section escaped its root');
  return s.file;
});
files.push(...['ui-index.json','environment-report.md','live-observation.json',...sections18].map(p=>jmp18Base+p));
for(const file of files){const dest=path.join(out,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,file),dest);}
const example=JSON.parse(await fs.readFile(path.join(root,'config.example.json'),'utf8'));
const provider=Object.fromEntries(['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses'].filter(k=>example.provider[k]!==undefined).map(k=>[k,example.provider[k]]));
await fs.writeFile(path.join(out,'config.json'),JSON.stringify({provider},null,2));
if(includeNode){
  await fs.mkdir(path.join(out,'runtime'));await fs.copyFile(process.execPath,path.join(out,'runtime/node.exe'));
  const licenseUrl='https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE';
  const r=await fetch(licenseUrl,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Node license HTTP '+r.status);const license=await r.text();if(!license.startsWith('Node.js is licensed'))throw Error('Unexpected license response');await fs.writeFile(path.join(out,'runtime/LICENSE.txt'),license);
}
const target=resolveJmpVersion({applicationVersion:'18.0.0',applicationEdition:'Pro',language:'en-US'});
for(const [file,options] of [['synthetic-smoke.jsl',{}],['synthetic-variation.jsl',{name:'ChangedPro18',x:[2,5,8],y:[11,17,23]}]]){
  const program=jmpProgram(options);program.apiCatalogVersion=target.apiCatalogVersion;
  await fs.writeFile(path.join(out,file),renderJmp(program,{eventIds:['evt-001'],target},{target}),'utf8');
}
await fs.writeFile(path.join(out,'PACKAGE-NOTE.txt'),'Development build. Synthetic JSL targets JMP Pro 18.0.0 and tests the fixed compiler, NOT VLM recognition or recording equivalence. No credentials, source data or recordings included. Run recorder inside JMP VM. Check English UI confirmation before recording. If version or edition cannot be detected, verify About and explicitly configure config.json jmp.version/edition/language; do not guess. Paid analysis needs separate authorization. Historical 19.1 verification documents do not validate Pro 18.');
console.log(out);
