import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {loadQuartusReprocess} from '../src/analyzer/lib/quartus-reprocess.mjs';

function data() {
  const chunks=[1,2].map(index=>({index,
    actions:[{sourceEventIds:[`input-${index}`],observations:[{eventId:`observation-${index}`}],transitionObservations:[{eventId:`transition-${index}`}],action:'click',startMs:index,endMs:index+1}],
    screenshotFiles:[`screenshots/${index}.png`],signatures:[{file:`screenshots/${index}.png`,sha256:String(index).repeat(64)}],
    harness:{format:'QuartusAnalysisHarness',version:'1.0',previousState:{phase:'unknown',pendingInput:null},inputs:[],rules:['synthetic fixture']}}));
  const preparation={format:'QuartusPreparation',version:'1.0',captureMode:'visual-input',sourceRecording:'C:/synthetic-recording',actionCount:2,chunkCount:2,orphanedEventIds:[],captureErrors:[],limits:{maxRequests:8},chunks};
  const checkpoint={format:'RecorderAnalysisCheckpoint',version:'0.1',identity:'a'.repeat(64),totalChunks:2,completed:chunks.map(c=>({index:c.index,plan:{schemaVersion:'quartus-workflow/1',summary:`Existing model result ${c.index}`},audit:{eventIds:[`input-${c.index}`,`observation-${c.index}`,`transition-${c.index}`],screenshotFiles:c.screenshotFiles,harness:{previousState:{phase:'editing'}}}}))};
  return {preparation,checkpoint};
}
async function fixture(t,modify=()=>{}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'quartus-reprocess-'));
  t.after(async()=>{const absolute=path.resolve(root),base=path.resolve(os.tmpdir());assert.equal(path.dirname(absolute),base);assert.ok(path.basename(absolute).startsWith('quartus-reprocess-'));await fs.rm(absolute,{recursive:true,force:true});});
  const source=path.join(root,'source'),output=path.join(root,'fresh-output');await fs.mkdir(source);
  const {preparation,checkpoint}=data();modify({preparation,checkpoint});
  await fs.writeFile(path.join(source,'quartus-preparation.json'),JSON.stringify(preparation));await fs.writeFile(path.join(source,'analysis-checkpoint.json'),JSON.stringify(checkpoint));
  return {root,source,output,preparation,checkpoint};
}
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
test('imports complete old results with explicit hashes, preserves source, creates no output',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.source,'analysis-checkpoint.json'));
  const current=structuredClone(f.preparation);current.sourceRecording='D:/moved-recording';current.limits={maxRequests:0,maxImages:500};
  const result=await loadQuartusReprocess({...f,preparation:current});
  assert.deepEqual(result.completed,f.checkpoint.completed);assert.equal(result.provenance.mode,'offline-reprocess');assert.equal(result.provenance.apiRequests,0);assert.equal(result.provenance.newApiAnalysis,false);assert.equal(result.provenance.checkpointResume,false);
  assert.equal(result.provenance.sourceIdentity,f.checkpoint.identity);assert.equal(result.provenance.sourceFiles.checkpoint.sha256,hash(before));assert.equal(result.provenance.sourceDirectory,await fs.realpath(f.source));
  assert.deepEqual(await fs.readFile(path.join(f.source,'analysis-checkpoint.json')),before);await assert.rejects(fs.access(f.output),{code:'ENOENT'});
  result.completed[0].plan.summary='caller modification';assert.equal(JSON.parse(await fs.readFile(path.join(f.source,'analysis-checkpoint.json'),'utf8')).completed[0].plan.summary,'Existing model result 1');
});
test('accepts JSON object key order changes and equivalent audited event ordering',async t=>{
  const f=await fixture(t,({checkpoint})=>checkpoint.completed[0].audit.eventIds.reverse());
  const p=f.preparation;f.preparation={chunks:p.chunks,limits:p.limits,captureErrors:p.captureErrors,orphanedEventIds:p.orphanedEventIds,chunkCount:p.chunkCount,actionCount:p.actionCount,sourceRecording:p.sourceRecording,captureMode:p.captureMode,version:p.version,format:p.format};
  assert.equal((await loadQuartusReprocess(f)).completed.length,2);
});
for(const [name,modify] of [
  ['partial checkpoint',({checkpoint})=>checkpoint.completed.pop()],
  ['nonconsecutive checkpoint',({checkpoint})=>checkpoint.completed[1].index=3],
  ['reordered checkpoint',({checkpoint})=>checkpoint.completed.reverse()],
  ['wrong checkpoint version',({checkpoint})=>checkpoint.version='other'],
  ['wrong checkpoint format',({checkpoint})=>checkpoint.format='newResume'],
  ['wrong identity',({checkpoint})=>checkpoint.identity='short'],
  ['unsupported plan version',({checkpoint})=>checkpoint.completed[0].plan.schemaVersion='quartus-workflow/999'],
  ['wrong total chunks',({checkpoint})=>checkpoint.totalChunks=3],
  ['missing audit',({checkpoint})=>delete checkpoint.completed[0].audit],
  ['missing observation audit',({checkpoint})=>checkpoint.completed[0].audit.eventIds.pop()],
  ['extra audit event',({checkpoint})=>checkpoint.completed[0].audit.eventIds.push('unrelated')],
  ['duplicate audit event',({checkpoint})=>checkpoint.completed[0].audit.eventIds.push('input-1')],
  ['wrong screenshot audit',({checkpoint})=>checkpoint.completed[0].audit.screenshotFiles=['screenshots/other.png']],
  ['wrong preparation version',({preparation})=>preparation.version='other'],
  ['nonconsecutive preparation',({preparation})=>preparation.chunks[0].index=2],
  ['wrong action total',({preparation})=>preparation.actionCount=3],
  ['bad screenshot signature',({preparation})=>preparation.chunks[0].signatures[0].sha256='bad'],
])test(`reject ${name}`,async t=>{const f=await fixture(t,modify);await assert.rejects(loadQuartusReprocess({...f,preparation:data().preparation}),/Quartus offline reprocess/);await assert.rejects(fs.access(f.output),{code:'ENOENT'});});
for(const [name,modify] of [
  ['input action',p=>p.chunks[0].actions[0].action='double_click'],
  ['observation timestamp',p=>p.chunks[0].actions[0].observations[0].timestampMs=123],
  ['screenshot selection',p=>{p.chunks[0].screenshotFiles=['screenshots/new.png'];p.chunks[0].signatures[0].file='screenshots/new.png';}],
  ['screenshot bytes',p=>p.chunks[0].signatures[0].sha256='b'.repeat(64)],
  ['harness rule',p=>p.chunks[0].harness.rules=['changed instruction']],
  ['capture mode',p=>p.captureMode='internal-api'],
  ['orphaned events',p=>p.orphanedEventIds=['orphan']],
  ['capture errors',p=>p.captureErrors=[{message:'lost image'}]],
])test(`reject changed fresh ${name}`,async t=>{const f=await fixture(t);modify(f.preparation);await assert.rejects(loadQuartusReprocess(f),/Quartus offline reprocess/);});
test('reject source/output equality, descendants and preexisting output',async t=>{
  const f=await fixture(t);
  await assert.rejects(loadQuartusReprocess({...f,output:f.source}),/completely new/);
  await assert.rejects(loadQuartusReprocess({...f,output:path.join(f.source,'nested','new-output')}),/overlap/);
  await assert.rejects(loadQuartusReprocess({...f,output:f.root}),/completely new/);
  await fs.mkdir(f.output);await assert.rejects(loadQuartusReprocess(f),/completely new/);
});
test('reject aliased descendant output through directory junction',async t=>{
  const f=await fixture(t),alias=path.join(f.root,'alias');
  try{await fs.symlink(f.source,alias,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS disallows link creation');return;}throw e;}
  await assert.rejects(loadQuartusReprocess({...f,output:path.join(alias,'new')}),/overlap/);
});
test('canonicalizes separate source alias and absent output parents without creating them',async t=>{
  const f=await fixture(t),alias=path.join(f.root,'source-alias');
  try{await fs.symlink(f.source,alias,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS disallows link creation');return;}throw e;}
  const result=await loadQuartusReprocess({...f,source:alias,output:path.join(f.root,'not-created','result')});assert.equal(result.provenance.sourceDirectory,await fs.realpath(f.source));await assert.rejects(fs.access(path.join(f.root,'not-created')),{code:'ENOENT'});
});
test('reject symlink JSON input',async t=>{
  const f=await fixture(t),file=path.join(f.source,'analysis-checkpoint.json'),actual=path.join(f.root,'checkpoint.json');await fs.rename(file,actual);
  try{await fs.symlink(actual,file,'file');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS disallows file symlink creation');return;}throw e;}
  await assert.rejects(loadQuartusReprocess(f),/regular file/);
});
for(const filename of ['analysis-checkpoint.json','quartus-preparation.json'])test(`reject non-file or >16 MiB ${filename}`,async t=>{
  const f=await fixture(t),file=path.join(f.source,filename);await fs.unlink(file);await fs.mkdir(file);await assert.rejects(loadQuartusReprocess(f),/regular file/);await fs.rmdir(file);
  await fs.writeFile(file,Buffer.alloc(16*1024*1024+1,32));await assert.rejects(loadQuartusReprocess(f),/16 MiB/);
});
test('reject malformed JSON without modifying source or reading dotenv',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.source,'.env'),'QUARTUS_REPROCESS_CANARY=must-not-load');await fs.writeFile(path.join(f.source,'analysis-checkpoint.json'),'{bad json');const before=process.env.QUARTUS_REPROCESS_CANARY;
  await assert.rejects(loadQuartusReprocess(f),/valid JSON/);assert.equal(process.env.QUARTUS_REPROCESS_CANARY,before);assert.equal(await fs.readFile(path.join(f.source,'analysis-checkpoint.json'),'utf8'),'{bad json');
});
