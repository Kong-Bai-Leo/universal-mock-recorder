import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {jmpProgram,syntheticJmpApiCall} from './fixtures/jmp.mjs';
import {JMP_SCHEMA,JMP_INSTRUCTIONS,jmpSchemaFor,jmpInstructionsFor,validateJmpProgram,mergeJmpChunks,jmpChunkPosition,jmpPreviousContext} from '../src/analyzer/lib/jmp-program.mjs';
import {renderJmp} from '../src/analyzer/lib/jmp-renderer.mjs';
import {prepareJmpEvidence,groupJmpEvents} from '../src/analyzer/lib/jmp-evidence.mjs';
import {loadJmpKnowledge,retrieveJmpKnowledge} from '../src/analyzer/lib/jmp-knowledge.mjs';
import {runJmpAnalysis} from '../src/analyzer/jmp-cli.mjs';
import {buildJmpReplayPlan} from '../src/analyzer/lib/jmp-replay-plan.mjs';
import {resolveJmpVersion} from '../src/analyzer/lib/jmp-version.mjs';
import {jmpApiCatalog} from '../src/analyzer/lib/jmp-api-contract.mjs';
const validation={eventIds:['evt-001'],currentInputIds:['evt-001']};
test('JMP target identity routes exact Pro 18 metadata and rejects guesses/conflicts',()=>{
  const manifest={applicationVersion:'18.0.0.746439',applicationEdition:'Pro',language:'en-US'};
  const target=resolveJmpVersion(manifest);
  assert.equal(target.mapVersion,'18');assert.equal(target.apiCatalogVersion,'jmp-jsl-18-v1');
  assert.equal(target.displayName,'JMP Pro 18.0.0.746439');
  assert.throws(()=>resolveJmpVersion({applicationVersion:'unknown',applicationEdition:'Pro',language:'en-US'}),/version unknown/);
  assert.throws(()=>resolveJmpVersion(manifest,{version:'19.1.5'}),/conflicts/);
  assert.throws(()=>resolveJmpVersion(manifest,{}, {jmpEdition:'Trial'}),/conflicts/);
  assert.throws(()=>resolveJmpVersion({...manifest,applicationVersion:'18.2'}),/Unsupported JMP version/);
  assert.throws(()=>resolveJmpVersion({...manifest,applicationEdition:'Trial'}),/edition-matched observed UI map/);
  assert.throws(()=>resolveJmpVersion({...manifest,applicationVersion:'20.0'}),/Unsupported JMP version/);
});
test('JMP 18 map never falls back to a 19.1 map',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jmp-version-map-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'ui-maps/jmp/19.1/en-US'),{recursive:true});
  await fs.writeFile(path.join(dir,'ui-maps/jmp/19.1/en-US/ui-index.json'),JSON.stringify({application:'JMP',version:'19.1',language:'en-US',sections:[]}));
  await assert.rejects(loadJmpKnowledge(dir,{mapVersion:'18',language:'en-US'}),/18.*map missing.*refusing 19\.1 fallback/);
});
test('JMP 18 prompt, schema, catalog, replay plan and JSL are versioned without claiming native verification',()=>{
  const target=resolveJmpVersion({applicationVersion:'18.0.0.746439',applicationEdition:'Pro',language:'en-US'});
  const p=jmpProgram();p.apiCatalogVersion=target.apiCatalogVersion;
  assert.equal(jmpSchemaFor(target).properties.apiCatalogVersion.const,'jmp-jsl-18-v1');
  assert.match(jmpInstructionsFor(target),/JMP Pro 18\.0\.0\.746439/);
  assert.doesNotMatch(jmpInstructionsFor(target),/JMP 19\.1 Trial|jmp-jsl-19\.1-v1/);
  assert.equal(jmpApiCatalog('18').interfaces.length,9);
  assert.ok(jmpApiCatalog('18').interfaces.every(i=>i.source.includes('/jmp18/')||i.source.includes('/18.0/')));
  assert.doesNotThrow(()=>validateJmpProgram(p,{...validation,apiCatalogVersion:target.apiCatalogVersion,final:true}));
  assert.throws(()=>validateJmpProgram(p,{...validation,apiCatalogVersion:'jmp-jsl-19.1-v1'}),/does not match/);
  const plan=buildJmpReplayPlan(p,validation,'synthetic_fixture',target);
  assert.equal(plan.application.version,'18.0.0.746439');assert.equal(plan.application.edition,'Pro');
  assert.equal(plan.verification.nativeExecution,'not_run');
  assert.match(renderJmp(p,validation,{target}),/\/\/ JMP 18\.0\.0\.746439:/);
});
test('JMP strict output schema has typed discriminators and closed required properties',()=>{
  const visit=s=>{if(s.properties){assert.equal(s.additionalProperties,false);assert.deepEqual(s.required,Object.keys(s.properties));Object.values(s.properties).forEach(visit);}if(s.const!==undefined||s.enum)assert.ok(s.type);if(s.items)visit(s.items);s.anyOf?.forEach(visit);};visit(JMP_SCHEMA);
});
test('JMP replay scope excludes untouched background documents without weakening inventory checks',()=>{
  assert.match(JMP_SCHEMA.properties.initialScene.description,/untouched background table/);
  assert.match(JMP_SCHEMA.properties.finalScene.description,/never invent an ID/);
  assert.match(JMP_INSTRUCTIONS,/even if unrelated empty or populated JMP documents were already open/);
  assert.match(JMP_INSTRUCTIONS,/If an existing document supplies source data or is modified/);
  const p=jmpProgram({analysis:false});
  assert.equal(p.initialScene.kind,'blank');
  assert.doesNotThrow(()=>validateJmpProgram(p,{...validation,final:true}));
  p.finalScene.tableIds.push('background-table');
  assert.throws(()=>validateJmpProgram(p,{...validation,final:true}),/unknown final inventory/);
  p.finalScene.tableIds.pop();
  p.initialScene.kind='contains_existing';
  assert.throws(()=>validateJmpProgram(p,{...validation,final:true}),/unseen initial data table/);
});
test('JMP parameter/name variants compile without hardcoded table values',()=>{
  const p=jmpProgram({name:'Variation',x:[2,5,8],y:[11,17,23]});
  const c=validateJmpProgram(p,{...validation,final:true});assert.deepEqual(c.tables[0].columns[1].values,[11,17,23]);
  const code=renderJmp(p,validation);assert.match(code,/New Table\("Variation"/);assert.match(code,/Set Values\(\{11, 17, 23\}/);assert.match(code,/Run Script/);assert.match(code,/Close\(t0, NoSave\)/);assert.match(code,/sourceRecordingCompared=false/);assert.doesNotMatch(code,/Eval\(|Parse\(|Run Program\(|ExportImage/);
});
test('JMP standalone replay embeds data and analyses with isolated output and no runtime input dependency',()=>{
  const code=renderJmp(jmpProgram({name:'PortableTrial',x:[2,5,8],y:[11,17,23]}),validation,{runId:'portable-test'});
  assert.match(code,/Set Values\(\{2, 5, 8\}\)/);assert.match(code,/Set Values\(\{11, 17, 23\}\)/);
  assert.match(code,/Distribution\(/);assert.match(code,/Bivariate\(/);assert.match(code,/Fit Line\(1\)/);
  assert.match(code,/\$DOCUMENTS/);assert.match(code,/refusing overwrite/);
  const opens=[...code.matchAll(/\bOpen\(([^\n]+)\);/g)].map(m=>m[1]);
  assert.deepEqual(opens,['out || "PortableTrial.jmp"']);
  assert.ok(code.indexOf('t0 << Save(out || "PortableTrial.jmp")')<code.indexOf('t0 = Open('));
  assert.doesNotMatch(code,/replay-plan\.json|\.env|https?:\/\/|Include\(|Load Text File\(|Run Program\(|Current Data Table\(|Close All\(/);
});
for(const [name,mutate] of [
  ['unknown precision',p=>p.operations[3].precision='estimated'],
  ['formula injection',p=>p.operations[3].values[0]='Run Program("cmd")'],
  ['unsafe name',p=>p.operations[0].name='../../other'],
  ['reserved filename',p=>p.operations[0].name='CON'],
  ['duplicate semantic ID',p=>p.operations[4].columnId='x'],
  ['unknown column',p=>p.operations[3].columnId='ghost'],
  ['unknown evidence',p=>p.operations[0].sourceEventIds=['ghost']],
  ['commit order',p=>p.operations[1].timestampMs=-1],
  ['wrong modeling role',p=>p.operations[2].modelingType='nominal'],
  ['case-folded column collision',p=>p.operations[4].name='dose'],
  ['unsupported persistent operation',p=>p.operations[1].kind='delete_rows'],
  ['extra executable field',p=>p.script='Exit();'],
  ['incomplete inventory',p=>p.finalScene.reportIds=[]],
  ['unseen initial data',p=>p.initialScene.kind='contains_existing'],
  ['pending edit',p=>p.commandState.pendingEventIds=['evt-001']],
  ['unresolved change',p=>p.unresolved=[{sourceEventIds:['evt-001'],reason:'unreadable'}]]
])test('JMP rejects '+name,()=>{const p=jmpProgram();mutate(p);assert.throws(()=>renderJmp(p,validation));});
test('JMP missing cells remain missing; analysis with missing cells refuses',()=>{
  const p=jmpProgram({y:[3,null,7,9],analysis:false});assert.equal(validateJmpProgram(p,validation).tables[0].columns[1].values[1],null);
  assert.match(renderJmp(p,validation),/Set Values\(\{3, \., 7, 9\}/);
  assert.throws(()=>renderJmp(jmpProgram({y:[3,null,7,9]}),validation),/missing data/);
});
test('JMP constructor declares columns together, avoiding an implicit Column 1',()=>{
  const code=renderJmp(jmpProgram(),validation);assert.match(code,/New Table\("JmpSmoke", Add Rows\(4\),\n  New Column/);assert.doesNotMatch(code,/t0 << New Column/);
});
test('JMP edits after report creation cannot silently replace stale reports',()=>{
  const p=jmpProgram();p.operations.push({...p.operations[3],id:'late-edit',timestampMs:99});assert.throws(()=>renderJmp(p,validation),/after analysis/);
});
test('JMP chunk continuation keeps stable column identity and typed pending state',()=>{
  const p=jmpProgram(),a=structuredClone(p),b=structuredClone(p);a.operations=p.operations.slice(0,6);a.finalScene.reportIds=[];a.commandState.pendingEventIds=['evt-001'];a.decisions[0].disposition='deferred';b.operations=p.operations.slice(6);b.initialScene.kind='continuation';
  assert.doesNotThrow(()=>renderJmp(mergeJmpChunks([a,b]),validation));
  b.initialScene.kind='blank';assert.throws(()=>mergeJmpChunks([a,b]),/continue/);
});
test('JMP coverage is explicitly per-chunk and host session position is separate',()=>{
  assert.match(JMP_SCHEMA.properties.complete.description,/THIS CHUNK/);
  assert.match(JMP_INSTRUCTIONS,/non-final chunk.*complete=true/);
  assert.deepEqual(jmpChunkPosition(1,3),{index:1,total:3,isLastChunk:false});
  assert.deepEqual(jmpChunkPosition(3,3),{index:3,total:3,isLastChunk:true});
  assert.throws(()=>jmpChunkPosition(0,3),/invalid chunk/);
  const p=jmpProgram();p.commandState.pendingEventIds=['evt-001'];
  assert.doesNotThrow(()=>validateJmpProgram(p,validation));
  assert.throws(()=>validateJmpProgram(p,{...validation,final:true}),/pending interaction/);
});
test('JMP rejects unexplained incomplete coverage before final validation without rewriting it',()=>{
  const p=jmpProgram();p.complete=false;const before=JSON.stringify(p);
  assert.throws(()=>validateJmpProgram(p,validation),{code:'JMP_COVERAGE_CONFLICT'});
  assert.throws(()=>mergeJmpChunks([p]),/chunk 1:.*complete=false requires/);
  assert.equal(JSON.stringify(p),before);
});
test('JMP genuine omissions need reasons and evidence and remain blocked at final validation',()=>{
  const p=jmpProgram();p.complete=false;p.unresolved=[{sourceEventIds:['evt-001'],reason:'Unsupported filter changed the source table'}];
  assert.doesNotThrow(()=>validateJmpProgram(p,validation));
  assert.throws(()=>validateJmpProgram(p,{...validation,final:true}),/evt-001: Unsupported filter/);
  p.unresolved[0].reason='  ';assert.throws(()=>validateJmpProgram(p,validation),/nonempty reason/);
  p.unresolved[0].reason='Unknown cell';p.unresolved[0].sourceEventIds=[];
  assert.throws(()=>validateJmpProgram(p,validation),/requires sourceEventIds/);
  p.unresolved[0].sourceEventIds=['ghost'];assert.throws(()=>validateJmpProgram(p,validation),/source evidence/);
});
test('JMP unresolved decisions cannot be hidden behind true or omitted from the ledger',()=>{
  const p=jmpProgram();p.decisions[0].disposition='unresolved';
  assert.throws(()=>validateJmpProgram(p,validation),/complete=true conflicts/);
  p.complete=false;p.unresolved=[{sourceEventIds:['evt-other'],reason:'Different omission'}];
  assert.throws(()=>validateJmpProgram(p,{eventIds:['evt-001','evt-other']}),/unresolved ledger/);
});
test('JMP validates each chunk so a later omission cannot mask a prior coverage contradiction',()=>{
  const a=jmpProgram(),b=jmpProgram();a.unresolved=[{sourceEventIds:['evt-001'],reason:'Missing change'}];
  b.initialScene.kind='continuation';b.operations=[];b.complete=false;b.unresolved=structuredClone(a.unresolved);
  assert.throws(()=>mergeJmpChunks([a,b]),/chunk 1:.*complete=true conflicts/);
});
test('JMP context carries the coverage ledger and later complete does not erase prior omissions',()=>{
  const a=jmpProgram(),b=jmpProgram();a.complete=false;a.unresolved=[{sourceEventIds:['evt-001'],reason:'Unsupported source change'}];
  b.initialScene.kind='continuation';b.operations=[];b.decisions[0].disposition='navigation';
  const before=JSON.stringify([a,b]),catalog=validateJmpProgram(a,validation),context=jmpPreviousContext([a],catalog);
  assert.deepEqual(context.coverage.chunks,[{index:1,complete:false}]);
  assert.deepEqual(context.coverage.unresolved,[{chunkIndex:1,...a.unresolved[0]}]);
  const merged=mergeJmpChunks([a,b]);assert.equal(merged.complete,false);
  assert.throws(()=>buildJmpReplayPlan(merged,validation),/Unsupported source change/);
  assert.equal(JSON.stringify([a,b]),before);assert.equal(jmpPreviousContext([],catalog),null);
});
test('JMP chunk-local operation labels are namespaced without changing semantic identities',()=>{
  const p=jmpProgram(),a=structuredClone(p),b=structuredClone(p);
  a.operations=p.operations.slice(0,6);a.finalScene.reportIds=[];
  b.operations=p.operations.slice(6).map((o,i)=>({...o,id:'op-'+(i+1)}));b.initialScene.kind='continuation';
  const before=JSON.stringify([a,b]),merged=mergeJmpChunks([a,b]);
  assert.equal(merged.operations[0].id,'chunk-1-op-1');assert.equal(merged.operations[6].id,'chunk-2-op-1');
  assert.deepEqual(merged.operations[6].columnIds,['y']);assert.equal(merged.operations[6].reportId,'distribution-1');
  assert.doesNotThrow(()=>renderJmp(merged,validation));assert.equal(JSON.stringify([a,b]),before);
  b.operations[1].id=b.operations[0].id;assert.throws(()=>mergeJmpChunks([a,b]),/within chunk/);
});
test('JMP namespacing cannot hide duplicate entities or malformed operation labels',()=>{
  const p=jmpProgram();p.operations[4].columnId='x';assert.throws(()=>renderJmp(mergeJmpChunks([p]),validation),/semantic ID/);
  const bad=jmpProgram();bad.operations[0].id='../../bad';assert.throws(()=>mergeJmpChunks([bad]),/invalid operation ID/);
});
test('JMP UI Map hierarchy and no-Automation-ID retrieval remain available',async()=>{
  const k=await loadJmpKnowledge(path.resolve('.'),{mapVersion:'19.1',language:'en-US'});assert.ok(k.controls.length>40);const r=retrieveJmpKnowledge(k,[{key:'ENTER'}],null);assert.ok(r.controls.some(c=>c.id==='jmp.table.modeling-type'));assert.ok(r.controls.some(c=>c.label==='Fit Y by X'));assert.ok(r.controls.every(c=>!c.automationId));
  assert.equal(r.apiCatalog.version,'jmp-jsl-19.1-v1');assert.equal(r.apiCatalog.interfaces.length,9);
  assert.ok(r.apiCatalog.interfaces.some(i=>i.member==='Distribution'&&i.receiverType==='table'));
});
test('JMP Pro 18 loads its observed partial map and versioned interface catalog',async()=>{
  const k=await loadJmpKnowledge(path.resolve('.'),{mapVersion:'18',language:'en-US'});
  assert.equal(k.version,'18');assert.match(k.observedVersion,/18\.0\.0/);
  assert.equal(k.apiCatalog.version,'jmp-jsl-18-v1');
  assert.ok(k.controls.some(c=>c.id==='jmp.file.new'));
  assert.ok(k.controls.some(c=>c.id==='jmp.help.about'));
});
test('JMP internal JSON retains supplied calls and documented interface descriptors, without rewriting choices',()=>{
  const p=jmpProgram(),before=JSON.stringify(p),plan=buildJmpReplayPlan(p,validation,'synthetic_fixture');
  assert.equal(plan.callOrigin,'synthetic_fixture');assert.deepEqual(plan.modelPlan,p);assert.equal(JSON.stringify(p),before);
  assert.deepEqual(plan.modelPlan.operations[7].apiCall.arguments,{X:'x',Y:'y',fitLine:true});
  assert.equal(plan.consumerContract.httpEndpoint,null);assert.equal(plan.verification.nativeExecution,'not_run');
  assert.deepEqual(new Set(plan.interfaceCatalog.interfaces.map(i=>i.id)),new Set(p.operations.map(o=>o.apiCall.interfaceId)));
  assert.deepEqual(plan.expectedState.tables[0].columns[1].values,[3,5,7,9]);
});
for(const [name,mutate] of [
  ['missing model call',p=>delete p.operations[0].apiCall],
  ['invented endpoint',p=>p.operations[0].apiCall.interfaceId='POST /api/create-table'],
  ['incorrect native method',p=>p.operations[3].apiCall.member='SetCell'],
  ['wrong receiver',p=>p.operations[3].apiCall.receiverId='table-1'],
  ['uncreated result reference',p=>p.operations[6].apiCall.arguments.Y=['ghost']],
  ['result binding conflict',p=>p.operations[2].apiCall.resultId='ghost'],
  ['numerical disagreement',p=>p.operations[3].apiCall.arguments.values[0]='999'],
  ['X/Y role inversion',p=>p.operations[7].apiCall.arguments={X:'y',Y:'x',fitLine:true}],
  ['executable argument',p=>p.operations[3].apiCall.arguments.values[0]='Run Program("cmd")'],
  ['unknown catalog version',p=>p.apiCatalogVersion='unverified'],
  ['legacy semantic-only reply',p=>{p.version='1.0';delete p.apiCatalogVersion;for(const o of p.operations)delete o.apiCall;}]
])test('JMP API plan refuses '+name+' instead of selecting or repairing an interface',()=>{
  const p=jmpProgram();mutate(p);const before=JSON.stringify(p);
  assert.throws(()=>buildJmpReplayPlan(p,validation));assert.equal(JSON.stringify(p),before);
});
test('JMP rename calls preserve bindings and a later Fit Line modifies the original report',()=>{
  const p=jmpProgram();
  const add=(kind,fields,time)=>{const o={id:'extra-'+String(time).replace('.','-'),kind,...fields,sourceEventIds:['evt-001'],timestampMs:time,stage:'committed',knowledgeIds:[]};o.apiCall=syntheticJmpApiCall(o);return o;};
  p.operations.splice(6,0,add('rename_table',{tableId:'table-1',name:'Renamed'},6.1),add('rename_column',{tableId:'table-1',columnId:'x',name:'NewDose'},6.2));
  p.operations.at(-1).fitLine=false;p.operations.at(-1).apiCall.arguments.fitLine=false;
  p.operations.push(add('fit_line',{reportId:'bivariate-1'},9));
  const plan=buildJmpReplayPlan(p,validation,'synthetic_fixture');
  assert.equal(plan.expectedState.tables[0].name,'Renamed');assert.equal(plan.expectedState.tables[0].columns[0].id,'x');
  assert.equal(plan.expectedState.reports[1].fitLine,true);assert.equal(plan.modelPlan.operations.at(-1).apiCall.receiverId,'bivariate-1');
  assert.equal(plan.modelPlan.operations[6].apiCall.resultId,'');
});
async function fixture(t,count=1){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jmp-contract-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'screenshots'));
  await fs.writeFile(path.join(dir,'screenshots/test.jpg'),Buffer.from([255,216,255,217]));
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({applicationProfile:'jmp',captureDeployment:'same-windows-session',applicationVersion:'19.1.5',applicationEdition:'Trial',language:'en-US',uiAutomationTargets:false}));
  const events=Array.from({length:count},(_,i)=>({id:'evt-'+String(i+1).padStart(3,'0'),eventType:'key_down',key:'ESCAPE',timestampMs:i+1,window:{processName:'jmp',title:'SYNTHETIC'},screenshot:'screenshots/test.jpg',screenshotTimestampMs:count+10}));
  await fs.writeFile(path.join(dir,'events.jsonl'),events.map(JSON.stringify).join('\n'));const config=path.join(dir,'test-config.json');await fs.writeFile(config,JSON.stringify({provider:{model:'synthetic-offline'}}));return {recording:dir,config,events};
}
test('JMP prepare is offline, advertises one JSL, and changed evidence invalidates approval',async t=>{
  const f=await fixture(t,2);let calls=0;const client={analyze:async()=>{calls++;}};
  const r=await runJmpAnalysis(f,{client});assert.equal(r.status,'prepared_no_upload');assert.equal(calls,0);
  const report=JSON.parse(await fs.readFile(r.report));
  assert.equal(report.outputContract,'standalone_jmp_jsl_v1');assert.equal(report.primaryOutput,'jmp-replay.jsl');
  assert.equal(report.internalContract,'model_selected_interfaces_and_operations_v2');
  assert.deepEqual(await fs.readdir(report.runDirectory),[]);
  assert.equal((await prepareJmpEvidence(f.recording)).temporalWarnings.length,1);
  await fs.appendFile(path.join(f.recording,'events.jsonl'),'\n');await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/重新准备/);assert.equal(calls,0);
});
test('JMP versionless recording stops before a model request',async t=>{
  const f=await fixture(t);const manifest=JSON.parse(await fs.readFile(path.join(f.recording,'manifest.json')));
  delete manifest.applicationVersion;
  await fs.writeFile(path.join(f.recording,'manifest.json'),JSON.stringify(manifest));
  let calls=0;const client={analyze:async()=>{calls++;}};
  await assert.rejects(runJmpAnalysis(f,{client}),/version unknown/);
  assert.equal(calls,0);
});
test('JMP target loss in manifest or terminal event refuses preparation before upload',async t=>{
  for(const source of ['manifest','event']){
    const f=await fixture(t);
    if(source==='manifest'){
      const manifest=JSON.parse(await fs.readFile(path.join(f.recording,'manifest.json')));
      manifest.targetLost=true;manifest.targetLostAtUtc='2026-09-17T00:00:00Z';
      await fs.writeFile(path.join(f.recording,'manifest.json'),JSON.stringify(manifest));
    }else{
      f.events.push({id:'evt-lost',eventType:'target_lost',timestampMs:99});
      await fs.writeFile(path.join(f.recording,'events.jsonl'),f.events.map(JSON.stringify).join('\n'));
    }
    let calls=0;const client={analyze:async()=>{calls++;}};
    await assert.rejects(prepareJmpEvidence(f.recording),/target_lost/);
    await assert.rejects(runJmpAnalysis(f,{client}),/target_lost/);
    assert.equal(calls,0);assert.equal(await fs.stat(path.join(f.recording,'generated-jmp')).then(()=>true,()=>false),false);
  }
});
test('JMP Pro 18 synthetic request stays versioned through preparation and compilation',async t=>{
  const f=await fixture(t);const manifest=JSON.parse(await fs.readFile(path.join(f.recording,'manifest.json')));
  Object.assign(manifest,{applicationVersion:'18.0.0.746439',applicationEdition:'Pro'});
  await fs.writeFile(path.join(f.recording,'manifest.json'),JSON.stringify(manifest));
  let calls=0;const client={getUsageRecords:()=>[],analyze:async({payload,outputSchema,instructions})=>{
    calls++;assert.equal(payload.application,'JMP Pro 18.0.0.746439');
    assert.equal(payload.knowledge.version,'18');assert.equal(payload.knowledge.apiCatalog.version,'jmp-jsl-18-v1');
    assert.equal(outputSchema.properties.apiCatalogVersion.const,'jmp-jsl-18-v1');
    assert.match(instructions,/JMP Pro 18\.0\.0\.746439/);
    const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});p.apiCatalogVersion='jmp-jsl-18-v1';
    await client.onResponse({id:'synthetic-18',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
  }};
  const prep=await runJmpAnalysis(f,{client});const report=JSON.parse(await fs.readFile(prep.report));
  assert.equal(report.target.version,'18.0.0.746439');assert.equal(calls,0);
  const result=await runJmpAnalysis({...f,analyze:true},{client});assert.equal(calls,1);
  assert.match(await fs.readFile(result.primaryOutput,'utf8'),/\/\/ JMP 18\.0\.0\.746439:/);
  assert.equal((JSON.parse(await fs.readFile(result.plan))).application.edition,'Pro');
});
test('JMP pointer pairing, external paths and outer RDP evidence fail closed',async t=>{
  assert.equal(groupJmpEvents([{eventType:'mouse_down'},{eventType:'mouse_move'},{eventType:'mouse_up'}])[0].length,3);assert.throws(()=>groupJmpEvents([{eventType:'mouse_down'}]),/inside/);
  const f=await fixture(t);f.events[0].screenshot='../outside.jpg';await fs.writeFile(path.join(f.recording,'events.jsonl'),JSON.stringify(f.events[0]));await assert.rejects(prepareJmpEvidence(f.recording),/Unsafe/);
  f.events[0].window.processName='mstsc';await fs.writeFile(path.join(f.recording,'events.jsonl'),JSON.stringify(f.events[0]));await assert.rejects(prepareJmpEvidence(f.recording),/没有目标/);
});
test('JMP requests are capped, checkpointed and never executed by analyzer',async t=>{
  const f=await fixture(t,121);let calls=0;const client={getUsageRecords:()=>[],analyze:async({payload})=>{calls++;const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});if(calls>1){assert.ok(payload.previousContext.coverage.chunks.every(c=>c.complete));p.initialScene.kind='continuation';p.operations=[];p.decisions[0].disposition='navigation';}await client.onResponse({id:'synthetic-'+calls,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;}};
  await runJmpAnalysis(f,{client});const paused=await runJmpAnalysis({...f,analyze:true},{client});assert.equal(paused.status,'budget_paused');assert.equal(calls,2);
  assert.ok(!(await fs.readdir(paused.runDirectory)).some(f=>f.endsWith('.jsl')));
  const r=await runJmpAnalysis({...f,analyze:true},{client});assert.equal(r.status,'replay_script_generated_not_executed');assert.equal(r.sourceRecordingCompared,false);assert.equal(calls,3);assert.equal(r.usage.unknownUsageAttempts,3);
  assert.equal(r.primaryOutput,r.replayScript);assert.equal(r.validationScript,r.primaryOutput);
  const run=path.dirname(r.primaryOutput);assert.equal(r.plan,path.join(run,'_internal','replay-plan.json'));
  assert.deepEqual((await fs.readdir(run)).filter(f=>f.endsWith('.jsl')),['jmp-replay.jsl']);
  assert.match(await fs.readFile(r.primaryOutput,'utf8'),/New Table\(/);
  const again=await runJmpAnalysis({...f,analyze:true,exportValidationJsl:true},{client});assert.equal(calls,3);assert.equal(again.requestsThisRound,0);
  assert.equal(again.primaryOutput,r.primaryOutput);assert.deepEqual((await fs.readdir(run)).filter(f=>f.endsWith('.jsl')),['jmp-replay.jsl']);
  const saved=await runJmpAnalysis({...f,compileSavedRun:run},{client});
  assert.equal(saved.requestsThisRound,0);assert.equal(calls,3);assert.equal(saved.provenance.length,3);
});
test('JMP failed API call requires explicit retry and missing usage is not free',async t=>{const f=await fixture(t);let calls=0;const client={analyze:async()=>{calls++;throw Error('offline synthetic failure');}};await runJmpAnalysis(f,{client});await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/offline/);await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/retry-failed/);assert.equal(calls,1);});

test('JMP contradictory first chunk is saved for diagnosis but stops further paid calls immediately',async t=>{
  const f=await fixture(t,61);let calls=0;
  const client={analyze:async({payload})=>{
    calls++;assert.equal(payload.chunk.isLastChunk,false);
    const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});p.complete=false;return p;
  }};
  const prep=await runJmpAnalysis(f,{client}),report=JSON.parse(await fs.readFile(prep.report));
  await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/chunk 1:.*coverage conflict/);
  assert.equal(calls,1);
  const files=await fs.readdir(report.runDirectory),status=JSON.parse(await fs.readFile(path.join(report.runDirectory,'status.json')));
  assert.equal(status.failurePhase,'chunk_validation');assert.equal(status.chunk,1);
  assert.equal(status.validationError.code,'JMP_COVERAGE_CONFLICT');assert.equal(status.providerError,null);
  assert.ok(files.some(n=>n.endsWith('-parsed.json')));assert.ok(!files.includes('checkpoint.json'));
  assert.ok(!files.includes('jmp-replay.jsl'));assert.ok(!files.includes('_internal'));assert.ok(!files.includes('analysis.lock'));
  await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/retry-failed/);assert.equal(calls,1);
});
test('JMP actual omissions reach the next model context but cannot be cleared by a later true',async t=>{
  const f=await fixture(t,61);let calls=0;
  const client={analyze:async({payload})=>{
    calls++;const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});
    if(calls===1){p.complete=false;p.unresolved=[{sourceEventIds:[payload.inputs[0].id],reason:'Synthetic unsupported filter'}];}
    else{
      assert.equal(payload.chunk.isLastChunk,true);
      assert.equal(payload.previousContext.coverage.chunks[0].complete,false);
      assert.equal(payload.previousContext.coverage.unresolved[0].reason,'Synthetic unsupported filter');
      p.initialScene.kind='continuation';p.operations=[];p.decisions[0].disposition='navigation';
    }return p;
  }};
  const prep=await runJmpAnalysis(f,{client}),report=JSON.parse(await fs.readFile(prep.report));
  await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/Synthetic unsupported filter/);
  assert.equal(calls,2);
  const status=JSON.parse(await fs.readFile(path.join(report.runDirectory,'status.json')));
  assert.equal(status.failurePhase,'final_validation');assert.equal(status.providerError,null);
  const files=await fs.readdir(report.runDirectory);assert.ok(!files.includes('jmp-replay.jsl'));assert.ok(!files.includes('_internal'));
});

test('JMP saved response recompilation is offline, evidence-bound and preserves raw results',async t=>{
  const f=await fixture(t);let calls=0;
  const client={getUsageRecords:()=>[],analyze:async({payload})=>{
    calls++;const p=jmpProgram({eventIds:payload.inputs.map(e=>e.id)});
    await client.onResponse({id:'synthetic-response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
  }};
  const prep=await runJmpAnalysis(f,{client});const report=JSON.parse(await fs.readFile(prep.report));
  await runJmpAnalysis({...f,analyze:true},{client});const files=await fs.readdir(report.runDirectory);
  const parsed=path.join(report.runDirectory,files.find(n=>n.endsWith('-parsed.json'))),raw=await fs.readFile(parsed,'utf8');
  const forbiddenClient={analyze:()=>{throw Error('Offline mode must not call a client');}};
  const r=await runJmpAnalysis({...f,config:path.join(f.recording,'does-not-exist.json'),compileSavedRun:report.runDirectory},{client:forbiddenClient});
  assert.equal(r.requestsThisRound,0);assert.equal(calls,1);assert.equal(await fs.readFile(parsed,'utf8'),raw);
  assert.equal(r.provenance[0].responseId,'synthetic-response');assert.equal(r.sourceRecordingCompared,false);
  assert.equal(r.status,'saved_replay_script_generated_not_executed');assert.equal(r.replaySemantics,'validated_final_state');
  assert.equal(r.validationScript,r.primaryOutput);assert.equal(r.replayScript,r.primaryOutput);
  assert.ok(r.primaryOutput.endsWith('jmp-replay.jsl'));assert.equal(r.plan,path.join(path.dirname(r.primaryOutput),'_internal','replay-plan.json'));
  assert.match(await fs.readFile(r.primaryOutput,'utf8'),/Set Values\(/);
  const withScript=await runJmpAnalysis({...f,compileSavedRun:report.runDirectory,exportValidationJsl:true},{client});
  assert.equal(withScript.validationScript,withScript.primaryOutput);assert.equal(calls,1);
  assert.deepEqual((await fs.readdir(path.dirname(withScript.primaryOutput))).filter(f=>f.endsWith('.jsl')),['jmp-replay.jsl']);
  await fs.writeFile(path.join(report.runDirectory,'analysis.lock'),'');
  await assert.rejects(runJmpAnalysis({...f,compileSavedRun:report.runDirectory}),/locked/);await fs.unlink(path.join(report.runDirectory,'analysis.lock'));
  const changed=JSON.parse(raw);changed.summary='edited';await fs.writeFile(parsed,JSON.stringify(changed));
  await assert.rejects(runJmpAnalysis({...f,compileSavedRun:report.runDirectory}),/does not match/);await fs.writeFile(parsed,raw);
  await fs.appendFile(path.join(f.recording,'screenshots/test.jpg'),Buffer.from([1]));
  await assert.rejects(runJmpAnalysis({...f,compileSavedRun:report.runDirectory}),/no longer matches/);assert.equal(calls,1);
});
test('JMP offline compile mode rejects upload or prepare flags before accessing any input',async()=>{
  for(const conflicting of [{analyze:true},{retryFailed:true},{prepareOnly:true}])
    await assert.rejects(runJmpAnalysis({recording:'nonexistent',compileSavedRun:'nonexistent',...conflicting}),/离线编译不能/);
});

test('JMP request contains the interface catalog and required call schema; a semantic-only response is not checkpointed',async t=>{
  const f=await fixture(t);let calls=0;
  const client={analyze:async({payload,outputSchema,instructions})=>{
    calls++;assert.equal(payload.knowledge.apiCatalog.version,'jmp-jsl-19.1-v1');
    assert.ok(outputSchema.properties.operations.items.anyOf.every(s=>s.required.includes('apiCall')));
    assert.match(instructions,/YOU must choose apiCall/);
    const p=jmpProgram();delete p.operations[3].apiCall;return p;
  }};
  const prep=await runJmpAnalysis(f,{client}),report=JSON.parse(await fs.readFile(prep.report));
  await assert.rejects(runJmpAnalysis({...f,analyze:true},{client}),/unsupported operation/);
  assert.equal(calls,1);const files=await fs.readdir(report.runDirectory);
  assert.ok(!files.includes('checkpoint.json'));assert.ok(!files.includes('_internal'));assert.ok(!files.includes('jmp-replay.jsl'));
  assert.ok(files.some(n=>n.endsWith('-parsed.json')));
});

test('JMP delayed frames survive upload preparation and retain temporal attribution',async t=>{
  const f=await fixture(t,2);
  await fs.writeFile(path.join(f.recording,'screenshots/delayed.jpg'),Buffer.from([255,216,1,255,217]));
  f.events[0].screenshotSettledAfter='screenshots/delayed.jpg';
  f.events[0].screenshotSettledAfterTimestampMs=20;
  await fs.writeFile(path.join(f.recording,'events.jsonl'),f.events.map(JSON.stringify).join('\n'));
  const e=await prepareJmpEvidence(f.recording);
  const frame=e.events[0].frames.find(f=>f.role==='screenshotSettledAfter');
  assert.equal(frame.capturedAtMs,20);
  assert.equal(frame.attribution,'later_inputs_may_be_visible');
  assert.ok(e.chunks[0].images.some(i=>i.label===frame.uploadImageLabel));
  assert.ok(e.events[0].frames.some(f=>f.role==='screenshot'));
});
