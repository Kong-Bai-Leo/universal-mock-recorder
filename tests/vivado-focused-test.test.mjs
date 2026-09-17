import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {projectFixture} from './fixtures/vivado.mjs';
import {VIVADO_LEGACY_SCHEMA,validateVivadoProgram,mergeVivadoChunks,vivadoPreviousContext} from '../src/analyzer/lib/vivado-program.mjs';
import {prepareVivadoEvidence,VIVADO_BUDGET} from '../src/analyzer/lib/vivado-evidence.mjs';
import {prepareVivadoFocusedTest,runVivadoFocusedTest,auditVivadoFocusedTest} from '../src/analyzer/vivado-focused-test.mjs';
import {exportVivadoFocusedReplay} from '../src/analyzer/vivado-focused-replay.mjs';

async function sample(fn,eventCount=121){
 const recording=await fs.mkdtemp(path.join(os.tmpdir(),'vivado-focus-test-'));
 try{
  await fs.mkdir(path.join(recording,'screenshots'));
  await fs.writeFile(path.join(recording,'screenshots/frame.jpg'),Buffer.from([255,216,255,217]));
  await fs.writeFile(path.join(recording,'manifest.json'),JSON.stringify({applicationProfile:'vivado',captureDeployment:'same-windows-session'}));
  const raw=Array.from({length:eventCount},(_,i)=>({id:'evt-'+String(i+1).padStart(3,'0'),timestampMs:i+1,eventType:'key_down',key:'TAB',window:{processName:'vivado'},screenshot:'screenshots/frame.jpg',screenshotTimestampMs:i+1}));
  await fs.writeFile(path.join(recording,'events.jsonl'),raw.map(e=>JSON.stringify(e)).join('\n'));
  const config=path.join(recording,'config.json');await fs.writeFile(config,JSON.stringify({provider:{model:'test',imageDetail:'high'}}));
  const sourceRun=path.join(recording,'generated-vivado/source');await fs.mkdir(sourceRun,{recursive:true});await fs.writeFile(path.join(sourceRun,'status.json'),JSON.stringify({identity:'old'}));
  const evidence=await prepareVivadoEvidence(recording),chunks=[];
  for(let i=0;i<evidence.chunks.length;i++){
   const chunk=evidence.chunks[i],p=projectFixture();p.initialScene.kind=i?'continuation':'blank';if(i)p.operations=[];
   p.decisions=[{sourceEventIds:chunk.inputIds,disposition:i?'navigation':'modeled',reason:i?'View':'Create'}];
   const eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
   const context=vivadoPreviousContext(chunks,chunks.length?validateVivadoProgram(mergeVivadoChunks(chunks),{eventIds}):null);
   if(context){delete context.topTransactions;delete context.pendingTopTransactions;for(const o of context.catalog.objects){delete o.designRevision;delete o.inputRevision;}}
   const legacy={...p,version:'vivado-native-plan-1'};delete legacy.topTransactions;
   const req={identity:'old',schema:VIVADO_LEGACY_SCHEMA,provider:{model:'test',imageDetail:'high',maxRetries:0,maxRequestBytes:VIVADO_BUDGET.maxRequestBytes},images:chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})),payload:{chunk:{index:i+1,total:evidence.chunks.length,isLastChunk:i+1===evidence.chunks.length},inputs:chunk.events,allowedEvidenceIds:eventIds,previousContext:context,sourceScope:{captureDeployment:'same-windows-session',screenshotOrigin:[null,null]}}};
   const prefix=String(i+1).padStart(3,'0')+'-1';
   const response={id:'response-'+i,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(legacy)}]}]};
   for(const [suffix,value] of [['request',req],['parsed',legacy],['provider',response]])await fs.writeFile(path.join(sourceRun,prefix+'-'+suffix+'.json'),JSON.stringify(value));
   chunks.push(p);
  }
  await fn({recording,sourceRun,config,fromChunk:2,throughChunk:3,maxRequests:3});
 }finally{const real=await fs.realpath(recording);assert.equal(path.dirname(real),await fs.realpath(os.tmpdir()));assert.ok(path.basename(real).startsWith('vivado-focus-test-'));await fs.rm(real,{recursive:true});}
}

test('focused preparation verifies old context without uploading; two fresh chunks never publish Tcl',()=>sample(async options=>{
 let calls=0;const client={getUsageRecords:()=>[],analyze:async({payload})=>{
  calls++;assert.match(payload.evaluationScope,/OLD MODEL CONTEXT/);assert.ok(payload.stateKnowledge.controls.length);
  const p=projectFixture();p.initialScene.kind='continuation';p.operations=[];p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'navigation',reason:'View'}];return p;
 }};
 const prepared=await runVivadoFocusedTest(options,{client});assert.equal(calls,0);assert.equal(prepared.contextProvenance.length,1);
 const result=await runVivadoFocusedTest({...options,analyze:true},{client});assert.equal(calls,2);assert.equal(result.analysedChunks,2);assert.equal(result.fullyReanalysed,false);assert.equal(result.generatedExecutable,false);
 assert.deepEqual((await fs.readdir(result.directory)).filter(n=>n.endsWith('.tcl')),[]);
 await assert.rejects(runVivadoFocusedTest({...options,analyze:true},{client}),/already started/);assert.equal(calls,2);
}));
test('focus refuses mutated original output, changed model and out-of-range budget before API',()=>sample(async options=>{
 await assert.rejects(prepareVivadoFocusedTest({...options,maxRequests:5}),/budget/);
 await fs.writeFile(options.config,JSON.stringify({provider:{model:'different'}}));await assert.rejects(prepareVivadoFocusedTest(options),/configured model/);
 await fs.writeFile(options.config,JSON.stringify({provider:{model:'test',imageDetail:'high'}}));
 const file=path.join(options.sourceRun,'001-1-parsed.json'),p=JSON.parse(await fs.readFile(file));p.summary='tampered';await fs.writeFile(file,JSON.stringify(p));
 await assert.rejects(prepareVivadoFocusedTest(options),/does not match provider/);
}));
test('focused transport failure stops without automatic paid retry',()=>sample(async options=>{
 let calls=0;const client={getUsageRecords:()=>[],analyze:async()=>{calls++;throw Error('Synthetic transport failure');}};
 const prepared=await runVivadoFocusedTest(options,{client});await assert.rejects(runVivadoFocusedTest({...options,analyze:true},{client}),/transport failure/);assert.equal(calls,1);
 const status=JSON.parse(await fs.readFile(path.join(prepared.directory,'status.json')));assert.equal(status.status,'failed');assert.equal(status.requests,1);
}));
test('only one semantic repair is allowed across the whole focus test',()=>sample(async options=>{
 let calls=0;const client={getUsageRecords:()=>[],analyze:async()=>{calls++;return {};}};
 await runVivadoFocusedTest(options,{client});await assert.rejects(runVivadoFocusedTest({...options,analyze:true},{client}));assert.equal(calls,2);
}));

async function failedWithSavedResponse(options){
 const prepared=await runVivadoFocusedTest(options),usage=[];let calls=0;
 const client={getUsageRecords:()=>usage,analyze:async({payload})=>{
  calls++;const p=projectFixture();p.initialScene.kind=calls===1?'unknown':'continuation';p.operations=[];
  p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'navigation',reason:'View'}];
  const response={id:'focus-response-'+calls,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]};
  await client.onResponse(response);usage.push({responseId:response.id,inputTokens:10,outputTokens:10});
  if(calls===2){const prefix=(await fs.readdir(prepared.directory)).filter(n=>n.endsWith('-request.json')).sort().at(-1).replace('-request.json','');await fs.writeFile(path.join(prepared.directory,prefix+'-parsed.json'),JSON.stringify(p));throw Error('Synthetic host failure after saving response');}
  return p;
 }};
 await assert.rejects(runVivadoFocusedTest({...options,analyze:true},{client}),/Synthetic host/);assert.equal(calls,2);
 return prepared.directory;
}
test('read-only audit accepts complete saved real-response contract without a new request or status rewrite',()=>sample(async baseOptions=>{
 const options={...baseOptions,throughChunk:2,maxRequests:2},auditRun=await failedWithSavedResponse(options),before=await fs.readFile(path.join(auditRun,'status.json'),'utf8');
 const result=await auditVivadoFocusedTest({...options,auditRun});assert.equal(result.requests,2);assert.equal(result.analysedChunks,1);assert.equal(result.generatedExecutable,false);assert.equal(result.nativeExecution,'not_run');
 assert.equal(await fs.readFile(path.join(auditRun,'status.json'),'utf8'),before);assert.ok(!(await fs.readdir(auditRun)).includes('resumed-by.json'));
}));
test('explicit focus recovery keeps paid ledger, reuses unchanged response, cannot spend twice',()=>sample(async options=>{
 const resumeFrom=await failedWithSavedResponse(options),usage=[];let calls=0;
 const client={getUsageRecords:()=>usage,analyze:async({payload})=>{
  calls++;assert.equal(payload.chunk.index,3);const p=projectFixture();p.initialScene.kind='continuation';p.operations=[];
  p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'navigation',reason:'View'}];return p;
 }};
 const prepared=await runVivadoFocusedTest({...options,resumeFrom},{client});assert.equal(calls,0);assert.equal(prepared.resume.requests,2);assert.equal(prepared.resume.repairs,1);
 const result=await runVivadoFocusedTest({...options,resumeFrom,analyze:true},{client});assert.equal(calls,1);assert.equal(result.requests,3);assert.equal(result.repairs,1);assert.equal(result.analysedChunks,2);
 await assert.rejects(runVivadoFocusedTest({...options,resumeFrom,analyze:true},{client}),/already consumed/);assert.equal(calls,1);
 const original=JSON.parse(await fs.readFile(path.join(resumeFrom,'status.json')));assert.equal(original.status,'failed');assert.equal(original.requests,2);
}));

test('explicit offline export compiles verified original responses without spending or overwriting',()=>sample(async baseOptions=>{
 const options={...baseOptions,throughChunk:2,maxRequests:2},auditRun=await failedWithSavedResponse(options);
 const status=await fs.readFile(path.join(auditRun,'status.json'),'utf8'),outputDirectory=path.join(options.recording,'native-replay');
 const result=await exportVivadoFocusedReplay({...options,auditRun,outputDirectory});
 assert.equal(result.generatedExecutable,true);assert.equal(result.nativeExecution,'not_run');assert.equal(result.fullyReanalysed,false);assert.equal(result.contextProvenance.length,1);
 assert.match(await fs.readFile(result.script,'utf8'),/VIVADO_REPLAY_PASS/);
 assert.equal(await fs.readFile(path.join(auditRun,'status.json'),'utf8'),status);
 await assert.rejects(exportVivadoFocusedReplay({...options,auditRun,outputDirectory}),/EEXIST/);
 const names=await fs.readdir(auditRun),parsed=path.join(auditRun,names.filter(n=>n.endsWith('-parsed.json')).sort().at(-1));
 const p=JSON.parse(await fs.readFile(parsed));p.summary='tampered';await fs.writeFile(parsed,JSON.stringify(p));
 await assert.rejects(exportVivadoFocusedReplay({...options,auditRun,outputDirectory:path.join(options.recording,'tampered-replay')}),/does not match provider/);
 await assert.rejects(fs.stat(path.join(options.recording,'tampered-replay')),/ENOENT/);
},61));

test('offline export refuses non-final scope and omitted destination',()=>sample(async baseOptions=>{
 const options={...baseOptions,throughChunk:2,maxRequests:2},auditRun=await failedWithSavedResponse(options),outputDirectory=path.join(options.recording,'partial');
 await assert.rejects(exportVivadoFocusedReplay({...options,auditRun,outputDirectory}),/final recording chunk/);
 await assert.rejects(exportVivadoFocusedReplay({...options,auditRun}),/outputDirectory/);
 await assert.rejects(fs.stat(outputDirectory),/ENOENT/);
}));
test('focus recovery rejects mutated provider output, changed contract, and missing usage',()=>sample(async options=>{
 const resumeFrom=await failedWithSavedResponse(options),names=await fs.readdir(resumeFrom);
 for(const suffix of ['parsed','request','usage']){
  const file=path.join(resumeFrom,names.filter(n=>n.endsWith('-'+suffix+'.json')).sort().at(-1)),original=await fs.readFile(file,'utf8'),value=JSON.parse(original);
  if(suffix==='parsed')value.summary='tampered';else if(suffix==='request')value.instructions='changed prompt';else value.records=[];
  await fs.writeFile(file,JSON.stringify(value));await assert.rejects(prepareVivadoFocusedTest({...options,resumeFrom}));await fs.writeFile(file,original);
 }
 await assert.rejects(prepareVivadoFocusedTest({...options,resumeFrom,maxRequests:4}),/scope\/config/);
}));
test('chained host-fix recovery cannot reset requests/repairs or alter ancestor usage',()=>sample(async baseOptions=>{
 const options={...baseOptions,throughChunk:4,maxRequests:4},first=await failedWithSavedResponse(options);
 const second=await runVivadoFocusedTest({...options,resumeFrom:first}),usage=[];
 const failing={getUsageRecords:()=>usage,analyze:async({payload})=>{
  assert.equal(payload.chunk.index,3);const p=projectFixture();p.initialScene.kind='continuation';p.operations=[];p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'navigation',reason:'View'}];
  const response={id:'focus-third-response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]};await failing.onResponse(response);usage.push({responseId:response.id,inputTokens:10,outputTokens:10});
  const prefix=(await fs.readdir(second.directory)).filter(n=>n.endsWith('-request.json')).at(-1).replace('-request.json','');await fs.writeFile(path.join(second.directory,prefix+'-parsed.json'),JSON.stringify(p));throw Error('Synthetic host failure');
 }};
 await assert.rejects(runVivadoFocusedTest({...options,resumeFrom:first,analyze:true},{client:failing}),/Synthetic host/);
 const statusPath=path.join(first,'status.json'),original=await fs.readFile(statusPath,'utf8'),changed=JSON.parse(original);changed.usage=[];await fs.writeFile(statusPath,JSON.stringify(changed));
 await assert.rejects(prepareVivadoFocusedTest({...options,resumeFrom:second.directory}),/ancestor ledger/);await fs.writeFile(statusPath,original);
 const third=await runVivadoFocusedTest({...options,resumeFrom:second.directory});assert.equal(third.resume.requests,3);assert.equal(third.resume.repairs,1);
 let calls=0;const client={getUsageRecords:()=>[],analyze:async({payload})=>{calls++;assert.equal(payload.chunk.index,4);const p=projectFixture();p.initialScene.kind='continuation';p.operations=[];p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'navigation',reason:'View'}];return p;}};
 const done=await runVivadoFocusedTest({...options,resumeFrom:second.directory,analyze:true},{client});assert.equal(calls,1);assert.equal(done.requests,4);assert.equal(done.repairs,1);assert.equal(done.analysedChunks,3);
},181));
