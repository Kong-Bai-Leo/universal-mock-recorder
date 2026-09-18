import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execFileAsync=promisify(execFile);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map19=['ui-index.json','sources.json','file/ui-map.json','analyze/ui-map.json','distribution/ui-map.json','table/ui-map.json','report/ui-map.json','environment-report.md','live-observation.json','verification-report.json'];
const staticFiles=[
  'bin/jmp-recorder/JmpRecorder.exe','scripts/analyze-jmp-recording.ps1','src/analyzer/jmp-cli.mjs',
  ...['jmp-evidence.mjs','jmp-program.mjs','jmp-api-contract.mjs','jmp-replay-plan.mjs','jmp-renderer.mjs','jmp-knowledge.mjs','jmp-version.mjs','gpt-client.mjs','workflow.mjs','local-env.mjs'].map(name=>'src/analyzer/lib/'+name),
  'src/Recorder.Jmp/README.md','docs/jmp-api-plan.md','docs/jmp-support-matrix.md','docs/jmp-verification-2026-09-11.md','docs/jmp-18-version-compatibility.md',
  ...map19.map(name=>'ui-maps/jmp/19.1/en-US/'+name)
];
async function write(root,relative,data='fixture'){
  const destination=path.join(root,relative);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.writeFile(destination,data);
}
async function copy(root,relative){
  const destination=path.join(root,relative);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await fs.copyFile(path.join(repository,relative),destination);
}
async function fixture(t,sections=['file/ui-map.json','help/ui-map.json']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'jmp-package-offline-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const imported=['scripts/package-jmp-recorder.mjs','tests/fixtures/jmp.mjs','src/analyzer/lib/jmp-renderer.mjs','src/analyzer/lib/jmp-program.mjs','src/analyzer/lib/jmp-api-contract.mjs','src/analyzer/lib/jmp-version.mjs'];
  for(const relative of imported)await copy(root,relative);
  for(const relative of staticFiles)if(!imported.includes(relative))await write(root,relative);
  await write(root,'config.example.json',JSON.stringify({provider:{model:'offline-fixture'}}));
  const base='ui-maps/jmp/18/en-US/';
  await write(root,base+'ui-index.json',JSON.stringify({application:'JMP',version:'18',language:'en-US',sections:sections.map(file=>({file}))}));
  await write(root,base+'environment-report.md');await write(root,base+'live-observation.json','{}');
  for(const section of sections.filter(file=>/^[a-z-]+\/ui-map\.json$/.test(file)))await write(root,base+section,'{}');
  await write(root,'.env','SECRET_DO_NOT_PACKAGE');
  await write(root,'bin/jmp-recorder/recordings/private/manifest.json','SECRET_RECORDING');
  await write(root,base+'screenshots/private.png','SECRET_SCREENSHOT');
  return root;
}
async function packageFixture(root){
  const {stdout}=await execFileAsync(process.execPath,[path.join(root,'scripts/package-jmp-recorder.mjs')],{cwd:root,timeout:20000});
  return stdout.trim();
}
async function relativeFiles(root){
  const result=[];
  async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())await visit(full);else result.push(path.relative(root,full).replaceAll('\\','/'));
  }}
  await visit(root);return result.sort();
}

test('JMP package contains only allowed runtime, Pro 18 maps and documentation, without private files',async t=>{
  const sections=['file/ui-map.json','help/ui-map.json'];
  const root=await fixture(t,sections),out=await packageFixture(root);
  assert.equal(path.dirname(out),path.join(root,'dist'));
  const expected=[...staticFiles,'ui-maps/jmp/18/en-US/ui-index.json','ui-maps/jmp/18/en-US/environment-report.md','ui-maps/jmp/18/en-US/live-observation.json',...sections.map(file=>'ui-maps/jmp/18/en-US/'+file),'config.json','synthetic-smoke.jsl','synthetic-variation.jsl','PACKAGE-NOTE.txt'].sort();
  assert.deepEqual(await relativeFiles(out),expected);
  const script=await fs.readFile(path.join(out,'synthetic-smoke.jsl'),'utf8');
  assert.match(script,/\/\/ JMP 18\.0\.0:/);assert.doesNotMatch(script,/JMP 19\.1/);
  const config=JSON.parse(await fs.readFile(path.join(out,'config.json'),'utf8'));
  assert.equal(config.provider.model,'offline-fixture');
  assert.ok(!(await relativeFiles(out)).some(file=>/\.env|recordings|screenshots|private\.png/i.test(file)));
});

test('JMP package rejects invalid or traversal map sections before copying extras',async t=>{
  for(const invalid of ['../../../.env','file/../ui-map.json','file/private.png']){
    const root=await fixture(t,[invalid]);
    await assert.rejects(packageFixture(root),/Invalid JMP 18 map section path/);
    const dist=path.join(root,'dist');
    const runs=await fs.readdir(dist).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));
    for(const run of runs)assert.deepEqual(await relativeFiles(path.join(dist,run)),[]);
  }
});
