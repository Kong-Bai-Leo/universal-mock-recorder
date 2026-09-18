import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runJmpAnalysis} from '../src/analyzer/jmp-cli.mjs';
import {jmpProgram} from './fixtures/jmp.mjs';

async function setup(t,count=121) {
  const recording=await fs.mkdtemp(path.join(os.tmpdir(),'jmp-resume-'));
  t.after(()=>fs.rm(recording,{recursive:true,force:true}));
  await fs.mkdir(path.join(recording,'screenshots'));
  await fs.writeFile(path.join(recording,'screenshots/a.jpg'),Buffer.from([255,216,255,217]));
  await fs.writeFile(path.join(recording,'manifest.json'),JSON.stringify({applicationProfile:'jmp',captureDeployment:'same-windows-session',applicationVersion:'19.1.5',applicationEdition:'Trial',language:'en-US',uiAutomationTargets:false}));
  const events=Array.from({length:count},(_,i)=>({id:'evt-'+String(i+1).padStart(3,'0'),eventType:'key_down',key:'ESCAPE',timestampMs:i+1,window:{processName:'jmp',title:'SYNTHETIC'},screenshot:'screenshots/a.jpg',screenshotTimestampMs:count+10}));
  await fs.writeFile(path.join(recording,'events.jsonl'),events.map(JSON.stringify).join('\n'));
  const config=path.join(recording,'config.json');await fs.writeFile(config,JSON.stringify({provider:{model:'synthetic-offline'}}));
  let calls=0;const client={getUsageRecords:()=>[],analyze:async({payload})=>{
    calls++;const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});
    if(calls>1){p.initialScene.kind='continuation';p.operations=[];p.decisions[0].disposition='navigation';}
    await client.onResponse({id:'synthetic-'+calls,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
  }};
  const options={recording,config};const prepared=await runJmpAnalysis(options);
  const report=JSON.parse(await fs.readFile(prepared.report));
  const paused=await runJmpAnalysis({...options,analyze:true},{client});assert.equal(paused.completed,2);
  const oldIdentity='a'.repeat(64),source=path.join(recording,'generated-jmp',oldIdentity.slice(0,24));
  await fs.rename(report.runDirectory,source);
  for(const file of (await fs.readdir(source)).filter(n=>n.endsWith('-request.json'))) {
    const target=path.join(source,file),r=JSON.parse(await fs.readFile(target));r.identity=oldIdentity;await fs.writeFile(target,JSON.stringify(r));
  }
  return {options,source,client,getCalls:()=>calls};
}

test('offline prefix import remains request-free and revalidates before later analysis',async t=>{
  const f=await setup(t),forbidden={analyze:()=>{throw Error('API forbidden');}};
  const result=await runJmpAnalysis({...f.options,resumeSavedRun:f.source},{client:forbidden});
  assert.equal(result.status,'saved_prefix_imported_no_upload');assert.equal(result.completed,2);assert.equal(result.requestsThisRound,0);assert.equal(f.getCalls(),2);
  const cp=JSON.parse(await fs.readFile(path.join(result.runDirectory,'checkpoint.json')));
  assert.equal(cp.importedFrom.provenance.length,2);
  const request=(await fs.readdir(f.source)).find(n=>n.endsWith('-request.json'));
  const p=path.join(f.source,request),raw=await fs.readFile(p),modified=JSON.parse(raw);modified.provider.model='tampered';await fs.writeFile(p,JSON.stringify(modified));
  await assert.rejects(runJmpAnalysis({...f.options,analyze:true},{client:forbidden}),/no longer matches|provenance/);
  await fs.writeFile(p,raw);
  await assert.rejects(runJmpAnalysis({...f.options,resumeSavedRun:f.source},{client:forbidden}),/not empty/);
});

for(const [name,mutate,pattern] of [
  ['schema',r=>{r.schema.name='tampered';},/no longer matches/],
  ['provider',r=>{r.provider.model='other';},/no longer matches/],
  ['image bytes',r=>{r.images[0].bytes++;},/no longer matches/]
])test('offline prefix rejects '+name,async t=>{
  const f=await setup(t),file=(await fs.readdir(f.source)).find(n=>n.endsWith('-request.json'));
  const p=path.join(f.source,file),r=JSON.parse(await fs.readFile(p));mutate(r);await fs.writeFile(p,JSON.stringify(r));
  await assert.rejects(runJmpAnalysis({...f.options,resumeSavedRun:f.source}),pattern);assert.equal(f.getCalls(),2);
});

for(const mode of ['ambiguous','gap','lock'])test('offline prefix rejects '+mode,async t=>{
  const f=await setup(t),files=(await fs.readdir(f.source)).filter(n=>n.endsWith('-parsed.json')).sort();
  if(mode==='ambiguous'){
    const original=files[0].replace('-parsed.json',''),duplicate='001-9999999999999';
    for(const suffix of ['-parsed.json','-provider.json','-request.json'])await fs.copyFile(path.join(f.source,original+suffix),path.join(f.source,duplicate+suffix));
  } else if(mode==='gap') {
    const prefix=files[0].replace('-parsed.json','');
    for(const suffix of ['-parsed.json','-provider.json','-request.json'])await fs.unlink(path.join(f.source,prefix+suffix));
  } else await fs.writeFile(path.join(f.source,'analysis.lock'),'');
  await assert.rejects(runJmpAnalysis({...f.options,resumeSavedRun:f.source}),mode==='lock'?/locked/:mode==='gap'?/Gap/:/Ambiguous/);
  assert.equal(f.getCalls(),2);
});

test('offline prefix rejects a destination lock and does not replace its contents',async t=>{
  const f=await setup(t),prepared=await runJmpAnalysis(f.options);
  const report=JSON.parse(await fs.readFile(prepared.report)),marker=path.join(report.runDirectory,'analysis.lock');
  await fs.writeFile(marker,'owned');
  await assert.rejects(runJmpAnalysis({...f.options,resumeSavedRun:f.source}),/Destination analysis is locked/);
  assert.equal(await fs.readFile(marker,'utf8'),'owned');assert.equal(f.getCalls(),2);
});

test('offline prefix rejects a provider/parsed mismatch',async t=>{
  const f=await setup(t),file=(await fs.readdir(f.source)).find(n=>n.endsWith('-parsed.json'));
  const p=path.join(f.source,file),parsed=JSON.parse(await fs.readFile(p));parsed.summary='tampered';await fs.writeFile(p,JSON.stringify(parsed));
  await assert.rejects(runJmpAnalysis({...f.options,resumeSavedRun:f.source}),/does not match its completed provider response/);
  assert.equal(f.getCalls(),2);
});

test('imported prefix survives a local budget pause and source/local usage stays separate',async t=>{
  const f=await setup(t,301),imported=await runJmpAnalysis({...f.options,resumeSavedRun:f.source});
  assert.equal(imported.completed,2);
  const paused=await runJmpAnalysis({...f.options,analyze:true},{client:f.client});
  assert.equal(paused.status,'budget_paused');assert.equal(paused.completed,4);
  assert.equal(paused.usage.importedAttempts.length,2);assert.equal(paused.usage.attempts.length,2);
  assert.equal(paused.usage.allAttempts.length,4);
  const final=await runJmpAnalysis({...f.options,analyze:true},{client:f.client});
  assert.equal(final.status,'replay_script_generated_not_executed');assert.equal(final.requestsThisRound,2);
  assert.equal(final.usage.importedAttempts.length,2);assert.equal(final.usage.attempts.length,4);
  assert.equal(final.usage.allAttempts.length,6);
  assert.equal(f.getCalls(),6);
});
