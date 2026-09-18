import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {STATA_CATALOG_VERSION,STATA_API_CATALOG,STATA_SCHEMA,validateStataProgram,mergeStataChunks,stataPreviousContext} from '../src/analyzer/lib/stata-program.mjs';
import {renderStata,newStataRuntimeDirectoryName} from '../src/analyzer/lib/stata-renderer.mjs';
import {compileStataPlan} from '../src/analyzer/stata-cli.mjs';
import {runStataAnalysis,compileSavedStataAnalysis} from '../src/analyzer/lib/stata-analysis.mjs';
import {prepareStataEvidence,groupStataEvents} from '../src/analyzer/lib/stata-evidence.mjs';

function fixture(x=[1,2,3,4],y=[3,5,8,9]){
  const operations=[],eventIds=['before','after'];
  function add(kind,receiverId,resultId,args){
    const n=operations.length+1,sourceEventIds=['evt'+n];eventIds.push(...sourceEventIds);
    const spec=STATA_API_CATALOG[kind];
    operations.push({id:'op'+n,kind,sourceEventIds,timestampMs:n*100,precision:'exact',receiverId,resultId,arguments:args,
      apiCall:{catalogVersion:STATA_CATALOG_VERSION,interfaceId:spec.interfaceId,command:spec.command,receiver:spec.receiver,receiverId,resultId,arguments:structuredClone(args)}});
  }
  add('blank','session','dataset',{});
  add('variable','dataset','x',{name:'dose',storageType:'double'});
  add('variable','dataset','y',{name:'response',storageType:'double'});
  x.forEach((value,i)=>add('cell','x','',{row:i+1,value}));
  y.forEach((value,i)=>add('cell','y','',{row:i+1,value}));
  add('summary','dataset','',{variableIds:['x','y']});
  add('regression','dataset','',{yVariableId:'y',xVariableId:'x'});
  add('save','dataset','saved-dataset',{outputId:'isolated-dta'});
  add('reopen','saved-dataset','dataset-reopened',{outputId:'isolated-dta'});
  return {eventIds,plan:{version:'1.0',apiCatalogVersion:STATA_CATALOG_VERSION,initialScene:{kind:'blank',evidenceIds:['before']},complete:true,
    operations,decisions:[{sourceEventIds:['before'],disposition:'navigation',reason:'Observed blank precondition'},{sourceEventIds:['after'],disposition:'navigation',reason:'Observed final inventory'}],unresolved:[],pendingEventIds:[],finalScene:{kind:'observed',variableIds:['x','y'],rowCount:x.length,evidenceIds:['after']}}};
}
const validate=f=>validateStataProgram(f.plan,{eventIds:f.eventIds,final:true});
const reject=(change,re)=>{const f=fixture();change(f);assert.throws(()=>validate(f),re);};

test('documented-only base and changed-data variant compile to one bounded .do',()=>{
  for(const f of [fixture(),fixture([2,5,8],[11,17,23])]){
    const state=validate(f);assert.equal(state.rowCount,f.plan.finalScene.rowCount);
    const directory=newStataRuntimeDirectoryName();
    const script=renderStata(f.plan,{eventIds:f.eventIds,runtimeDirectoryName:directory});
    assert.match(script,/input double \(dose response\)/);
    assert.match(script,/summarize dose response\r\nregress response dose/);
    assert.ok(script.includes(`mkdir "${directory}"\r\nconfirm new file "${directory}/reconstructed.dta"`));
    assert.match(script,/if c\(k\) != 0 \| c\(N\) != 0/);
    assert.match(script,/save ".*\.dta"\r\nuse ".*\.dta"/);
    assert.doesNotMatch(script,/\b(clear|replace|shell|!|do|run|import|erase)\b(?!ed)/);
  }
});
test('native result path is portable across analyzer and target Windows users',()=>{
  const f=fixture(),directory=newStataRuntimeDirectoryName();
  const script=renderStata(f.plan,{eventIds:f.eventIds,runtimeDirectoryName:directory});
  assert.doesNotMatch(script,/C:[\\/]|Users[\\/]|15846|replay-abc/);
  assert.ok(script.indexOf('if c(k) != 0')<script.indexOf(`mkdir "${directory}"`));
  assert.ok(script.indexOf(`mkdir "${directory}"`)<script.indexOf(`confirm new file "${directory}/reconstructed.dta"`));
  assert.throws(()=>renderStata(f.plan,{eventIds:f.eventIds,runtimeDirectoryName:'../user-data'}),/invalid isolated runtime/);
  assert.throws(()=>renderStata(f.plan,{eventIds:f.eventIds,runtimeDirectoryName:'C:/Users/user/output'}),/invalid isolated runtime/);
});
test('cannot choose arbitrary command, options, or model path',()=>{
  reject(f=>f.plan.operations.at(-3).apiCall.command='shell',/command\/arguments conflict/);
  reject(f=>f.plan.operations.at(-2).arguments.outputId='C:/user/source.dta',/command\/arguments conflict/);
  reject(f=>f.plan.operations.at(-1).apiCall.extra='replace',/unknown\/missing fields/);
});
test('blank precondition, provenance, unresolved, pending and unknown values refuse publication',()=>{
  reject(f=>f.plan.initialScene.kind='unknown',/blank initial dataset/);
  reject(f=>f.plan.operations[0].sourceEventIds=['unseen'],/operation evidence/);
  reject(f=>{f.plan.complete=false;f.plan.unresolved=[{sourceEventIds:['before'],reason:'Data Editor paste unreadable'}];},/pending or unresolved/);
  reject(f=>f.plan.pendingEventIds=['before'],/pending or unresolved/);
  reject(f=>f.plan.operations[3].precision='unknown',/estimated\/unknown/);
  reject(f=>f.plan.operations[3].arguments.value='?',/command\/arguments conflict/);
});
test('variable identity, row holes, regression role and lifecycle errors refuse publication',()=>{
  reject(f=>{f.plan.operations[2].resultId='x';f.plan.operations[2].apiCall.resultId='x';},/invalid variable binding/);
  reject(f=>{f.plan.operations[3].receiverId='ghost';f.plan.operations[3].apiCall.receiverId='ghost';},/bad cell target/);
  reject(f=>f.plan.operations[4].arguments.row=1,/command\/arguments conflict/);
  reject(f=>{const o=f.plan.operations.find(x=>x.kind==='regression');o.arguments.yVariableId='x';o.apiCall.arguments.yVariableId='x';},/bad regression/);
  reject(f=>{const o=f.plan.operations.find(x=>x.kind==='save');o.resultId='user-dataset';o.apiCall.resultId='user-dataset';},/unsupported save target/);
  reject(f=>{const o=f.plan.operations.find(x=>x.kind==='reopen');o.arguments.outputId='other';o.apiCall.arguments.outputId='other';},/reopen must reference/);
  reject(f=>f.plan.finalScene.rowCount=3,/unconfirmed final/);
  reject(f=>{f.eventIds.push('notClassified');},/unattributed input event/);
  reject(f=>{const cell=f.plan.operations.find(x=>x.kind==='cell');f.plan.operations.splice(f.plan.operations.indexOf(cell),1);},/unequal\/missing numeric rows/);
  reject(f=>{const a=f.plan.operations.find(x=>x.kind==='summary'),cell=f.plan.operations.find(x=>x.kind==='cell');a.timestampMs=cell.timestampMs-1;f.plan.operations.splice(f.plan.operations.indexOf(a),1);f.plan.operations.splice(3,0,a);},/bad cell target/);
  reject(f=>{const o=f.plan.operations.find(x=>x.kind==='variable');o.arguments.name='x; shell';o.apiCall.arguments.name='x; shell';},/unsupported numeric variable/);
});
test('constant predictor and unmatched API choice are rejected',()=>{
  const f=fixture([2,2,2,2]);assert.throws(()=>validate(f),/nonconstant X/);
  reject(f=>{const o=f.plan.operations.find(x=>x.kind==='regression');o.apiCall.arguments.xVariableId='y';},/command\/arguments conflict/);
});
test('confirmed mixed numeric storage compiles typed input and float-aware assertion',()=>{
  const f=fixture(),x=f.plan.operations.find(o=>o.kind==='variable'&&o.resultId==='x');
  x.arguments.storageType='float';x.apiCall.arguments.storageType='float';
  const first=f.plan.operations.find(o=>o.kind==='cell'&&o.receiverId==='x');
  first.arguments.value=0.1;first.apiCall.arguments.value=0.1;
  const script=renderStata(f.plan,{eventIds:f.eventIds,runtimeDirectoryName:newStataRuntimeDirectoryName()});
  assert.match(script,/input float dose double response/);
  assert.match(script,/assert dose\[1\] == float\(0\.1\)/);
  assert.match(script,/assert response\[1\] == \(3\)/);
  assert.match(script,/local __rec_type : type dose\r\nif "`__rec_type'" != "float"/);
  for(const type of ['byte','int','long']){
    const p=fixture(),v=p.plan.operations.find(o=>o.kind==='variable'&&o.resultId==='x');
    v.arguments.storageType=type;v.apiCall.arguments.storageType=type;
    assert.doesNotThrow(()=>validate(p));
  }
});
test('storage range and precision failures are refused before compilation',()=>{
  for(const [type,value] of [['byte',101],['int',32741],['long',2147483621],['float',1e-50]]){
    const f=fixture(),v=f.plan.operations.find(o=>o.kind==='variable'&&o.resultId==='x');
    v.arguments.storageType=type;v.apiCall.arguments.storageType=type;
    const cell=f.plan.operations.find(o=>o.kind==='cell'&&o.receiverId==='x');cell.arguments.value=value;cell.apiCall.arguments.value=value;
    assert.throws(()=>validate(f),/storage range/);
  }
  const f=fixture(),v=f.plan.operations.find(o=>o.kind==='variable'&&o.resultId==='x');
  v.arguments.storageType='unknown';v.apiCall.arguments.storageType='unknown';
  assert.throws(()=>validate(f),/unsupported numeric variable/);
});
test('scene evidence cannot conceal input and modeled decisions cover every listed ID',()=>{
  const f=fixture();f.plan.decisions.shift();
  assert.throws(()=>validate(f),/unattributed input event/);
  const g=fixture();g.plan.decisions[0]={sourceEventIds:['before','evt1'],disposition:'modeled',reason:'partially modeled'};
  assert.throws(()=>validate(g),/modeled decision without committed operation/);
});
test('epoch capture times and observational blank overlap are valid, but mutating overlap is not',()=>{
  const f=fixture();
  f.plan.operations.forEach((o,i)=>{o.timestampMs=1789703183647+i;});
  f.plan.initialScene.evidenceIds=['before'];
  f.plan.decisions[0]={sourceEventIds:['before','evt1'],disposition:'navigation',reason:'Opening blank Data Editor and observing empty inventory'};
  assert.doesNotThrow(()=>validate(f));
  f.plan.decisions[0].sourceEventIds.push('evt2');
  assert.throws(()=>validate(f),/nonpersistent decision overlaps committed operation/);
  f.plan.decisions[0].sourceEventIds.pop();
  f.plan.operations[3].sourceEventIds.push('evt1');
  assert.throws(()=>validate(f),/nonpersistent decision overlaps committed operation/);
  f.plan.operations[3].sourceEventIds.pop();
  f.plan.operations[2].timestampMs=1.5;
  assert.throws(()=>validate(f),/invalid operation evidence\/order/);
});
test('merged continuation preserves operation time order even when pending evidence crosses chunks',()=>{
  const f=fixture(),split=4;
  const first=structuredClone(f.plan),second=structuredClone(f.plan);
  first.operations=f.plan.operations.slice(0,split);
  first.pendingEventIds=['evt4'];
  first.finalScene={kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  second.initialScene={kind:'continuation',evidenceIds:[]};
  second.operations=f.plan.operations.slice(split);
  second.operations[0].sourceEventIds.push('evt4');
  second.operations[0].timestampMs=first.operations.at(-1).timestampMs-1;
  second.decisions=[];
  second.pendingEventIds=[];
  const merged=mergeStataChunks([first,second]);
  assert.throws(()=>validateStataProgram(merged,{eventIds:f.eventIds}),/invalid operation evidence\/order/);
});
test('partial unequal-row continuation context is stable across JSON roundtrip',()=>{
  const f=fixture(),partial=structuredClone(f.plan);
  partial.operations=partial.operations.slice(0,8);
  partial.decisions=partial.decisions.slice(0,1);
  partial.finalScene={kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  const eventIds=['before',...partial.operations.flatMap(o=>o.sourceEventIds)];
  const state=validateStataProgram(partial,{eventIds,final:false});
  assert.deepEqual(state.variables[1].values,[3,null,null,null]);
  const context=stataPreviousContext([partial],state);
  assert.deepEqual(context,JSON.parse(JSON.stringify(context)));
});
test('saved continuation context distinguishes completed save from pending reopen',()=>{
  const f=fixture(),prior=structuredClone(f.plan);
  prior.operations=prior.operations.slice(0,-2);
  prior.decisions=prior.decisions.slice(0,1);
  prior.finalScene={kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  const priorIds=['before',...prior.operations.flatMap(o=>o.sourceEventIds)];
  const beforeSave=validateStataProgram(prior,{eventIds:priorIds,final:false});
  assert.equal(Object.hasOwn(beforeSave,'savedDataset'),false);
  const saved=structuredClone(f.plan);
  saved.operations=saved.operations.slice(0,-1);
  saved.decisions=[saved.decisions[0],{sourceEventIds:['after'],disposition:'pending',reason:'Reopen still in progress'}];
  saved.pendingEventIds=['after'];
  saved.finalScene={kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  const ids=['before','after',...saved.operations.flatMap(o=>o.sourceEventIds)];
  const state=validateStataProgram(saved,{eventIds:ids,final:false});
  const save=saved.operations.at(-1);
  assert.deepEqual(state.savedDataset,{id:'saved-dataset',outputId:'isolated-dta',saveComplete:true,sourceEventIds:save.sourceEventIds,reopened:false});
  const context=stataPreviousContext([saved],state);
  assert.deepEqual(context.pendingEventIds,['after']);
  assert.deepEqual(context,JSON.parse(JSON.stringify(context)));
  assert.equal(validate(f).savedDataset.reopened,true);
  reject(p=>{const copy=structuredClone(p.plan.operations.at(-2));copy.id='duplicate-save';p.plan.operations.splice(-1,0,copy);},/unsupported save target/);
});
test('schema fixes lifecycle bindings but leaves variable identities dynamic',()=>{
  const choices=STATA_SCHEMA.properties.operations.items.anyOf;
  const byKind=Object.fromEntries(choices.map(x=>[x.properties.kind.const,x.properties]));
  for(const [kind,receiver,result] of [['blank','session','dataset'],['summary','dataset',''],['regression','dataset',''],['save','dataset','saved-dataset'],['reopen','saved-dataset','dataset-reopened']]){
    assert.equal(byKind[kind].receiverId.const,receiver);
    assert.equal(byKind[kind].resultId.const,result);
    assert.equal(byKind[kind].apiCall.properties.receiverId.const,receiver);
    assert.equal(byKind[kind].apiCall.properties.resultId.const,result);
  }
  assert.equal(byKind.variable.resultId.type,'string');
  assert.equal(byKind.cell.receiverId.type,'string');
});
test('cross-chunk pending requires explicit carry or explained resolution',()=>{
  const first=fixture().plan;first.pendingEventIds=['evt2'];
  const second={...structuredClone(first),initialScene:{kind:'continuation',evidenceIds:[]},operations:[],decisions:[],pendingEventIds:[],finalScene:{kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]}};
  assert.throws(()=>mergeStataChunks([first,second]),/prior pending event dropped/);
  second.pendingEventIds=['evt2'];assert.doesNotThrow(()=>mergeStataChunks([first,second]));
  second.pendingEventIds=[];second.decisions=[{sourceEventIds:['evt2'],disposition:'no_effect',reason:'Dialog canceled with no persistent edit'}];
  assert.doesNotThrow(()=>mergeStataChunks([first,second]));
});
test('merged pending cancellation remains auditable through final validation',()=>{
  const f=fixture(),pendingId='dialog-cancel';f.eventIds.push(pendingId);
  const first=f.plan;first.pendingEventIds=[pendingId];
  first.decisions.push({sourceEventIds:[pendingId],disposition:'pending',reason:'Dialog open at chunk boundary'});
  const second={...structuredClone(first),initialScene:{kind:'continuation',evidenceIds:[]},operations:[],
    decisions:[{sourceEventIds:[pendingId],disposition:'no_effect',reason:'Dialog canceled without persistent change'}],
    pendingEventIds:[],finalScene:{kind:'observed',variableIds:['x','y'],rowCount:4,evidenceIds:['after']}};
  const merged=mergeStataChunks([first,second]);
  assert.doesNotThrow(()=>validateStataProgram(merged,{eventIds:f.eventIds,final:true}));
  assert.ok(merged.decisions.some(d=>d.disposition==='pending'));
  assert.ok(merged.decisions.some(d=>d.disposition==='no_effect'&&d.sourceEventIds.includes(pendingId)));
});
test('float-rounded constant X cannot pass regression despite differing input text',()=>{
  const f=fixture([16777216,16777216.1,16777216.2],[3,5,8]);
  const x=f.plan.operations.find(o=>o.kind==='variable'&&o.resultId==='x');x.arguments.storageType='float';x.apiCall.arguments.storageType='float';
  assert.equal(new Set([16777216,16777216.1,16777216.2].map(Math.fround)).size,1);
  assert.throws(()=>validate(f),/nonconstant X/);
});
test('compiler writes only new isolated run and never executes Stata',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stata-test-'));
  try{
    const f=fixture();const planFile=path.join(root,'bounded-plan.json');await fs.writeFile(planFile,JSON.stringify(f));
    const result=await compileStataPlan({planFile,outputRoot:root});
    assert.equal(result.status,'script_generated_not_executed');
    assert.equal(path.dirname(result.primaryOutput),result.outputDirectory);
    const script=await fs.readFile(result.primaryOutput,'utf8');
    assert.match(script,/input double \(dose response\)/);
    assert.ok(script.includes(`mkdir "${result.runtimeOutputDirectory.slice(2)}"`));
    assert.equal(result.runtimeDataFile,`${result.runtimeOutputDirectory}/reconstructed.dta`);
    assert.doesNotMatch(script,new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.deepEqual((await fs.readdir(result.outputDirectory)).sort(),['stata-replay.do']);
    assert.equal(await fs.stat(path.join(result.outputDirectory,'reconstructed.dta')).then(()=>true,()=>false),false);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

async function recordingFixture(t,count=2,manifestOverrides={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stata-capture-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'screenshots'));
  await fs.writeFile(path.join(dir,'screenshots/one.jpg'),Buffer.from([255,216,255,217]));
  const manifest={applicationProfile:'stata',applicationVersion:'18.0.0.1',applicationEdition:'MP',language:'en-US',targetProcess:'StataMP-64',
    targetProcessId:4242,targetSessionId:7,captureDeployment:'same-windows-session',screenshotScope:'virtual-desktop',screenshotOriginX:0,screenshotOriginY:0,uiAutomationTargets:false,...manifestOverrides};
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  const events=Array.from({length:count},(_,i)=>({id:'evt-'+String(i+1).padStart(3,'0'),eventType:'key_down',key:'ESCAPE',timestampMs:i+1,
    window:{processName:'StataMP-64',processId:4242,title:'SYNTHETIC'},screenshot:'screenshots/one.jpg',screenshotTimestampMs:count+10}));
  await fs.writeFile(path.join(dir,'events.jsonl'),events.map(JSON.stringify).join('\n'));
  const config=path.join(dir,'config-test.json');await fs.writeFile(config,JSON.stringify({provider:{model:'offline-fake'}}));
  return {recording:dir,config,events};
}
function fakeChunk(payload){
  const first=payload.chunk.index===1,last=payload.chunk.isLastChunk;
  const f=fixture();
  if(first){
    const id=payload.inputs[0].id;
    for(const o of f.plan.operations)o.sourceEventIds=[id];
    f.plan.initialScene.evidenceIds=[id];
    f.plan.finalScene=last?{kind:'observed',variableIds:['x','y'],rowCount:4,evidenceIds:[payload.inputs.at(-1).id]}:
      {kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  }else{
    f.plan.initialScene={kind:'continuation',evidenceIds:[]};f.plan.operations=[];
    f.plan.finalScene=last?{kind:'observed',variableIds:['x','y'],rowCount:4,evidenceIds:[payload.inputs.at(-1).id]}:
      {kind:'unknown',variableIds:[],rowCount:0,evidenceIds:[]};
  }
  f.plan.decisions=payload.inputs.map((e,i)=>({sourceEventIds:[e.id],disposition:first&&i===0?'modeled':'navigation',reason:first&&i===0?'synthetic modeled event':'synthetic no state change'}));
  return f.plan;
}
function fakeClient(){
  let calls=0;const records=[];
  return {get calls(){return calls;},getUsageRecords:()=>records.map(x=>({...x})),
    async analyze({payload,screenshots,maxOutputTokens,outputSchema}){
      calls++;assert.ok(screenshots.length<=12);assert.equal(maxOutputTokens,6000);assert.ok(outputSchema.properties.operations);
      for(const image of screenshots){assert.match(image.path,/[\\/]_upload[\\/]/);assert.equal((await fs.readFile(image.path)).length,4);}
      const result=fakeChunk(payload),response={id:'fake-'+calls,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]};
      records.push({responseId:response.id,inputTokens:100,outputTokens:50,totalTokens:150});
      await this.onResponse(response);return result;
    }};
}
test('Stata evidence validates exact observed MP target, retains temporal/source mapping and rejects unsafe variants',async t=>{
  const f=await recordingFixture(t,2),e=await prepareStataEvidence(f.recording);
  assert.equal(e.manifest.applicationVersion,'18.0.0.1');assert.equal(e.events.length,2);assert.equal(e.chunks.length,1);
  assert.equal(e.imageAliases.length,0);assert.equal(e.temporalWarnings.length,1);
  assert.equal(e.events[0].frames[0].attribution,'later_inputs_may_be_visible');
  assert.equal(groupStataEvents([{eventType:'mouse_down'},{eventType:'mouse_move'},{eventType:'mouse_up'}])[0].length,3);
  assert.throws(()=>groupStataEvents([{eventType:'mouse_down'}]),/inside/);
  const wrong=await recordingFixture(t,1,{applicationEdition:'SE'});await assert.rejects(prepareStataEvidence(wrong.recording),/Stata\/MP/);
  const lost=await recordingFixture(t,1,{targetLost:true,targetLostAtUtc:'2026-09-17T00:00:00Z'});
  await assert.rejects(prepareStataEvidence(lost.recording),/target process was lost/);
  const terminal=await recordingFixture(t,1);terminal.events.push({id:'terminal',eventType:'target_lost',timestampMs:2});
  await fs.writeFile(path.join(terminal.recording,'events.jsonl'),terminal.events.map(JSON.stringify).join('\n'));
  await assert.rejects(prepareStataEvidence(terminal.recording),/target_lost/);
  f.events[0].window.processName='mstsc';await fs.writeFile(path.join(f.recording,'events.jsonl'),f.events.map(JSON.stringify).join('\n'));
  const mixed=await prepareStataEvidence(f.recording);assert.equal(mixed.excluded.length,1);
  f.events[1].screenshot='../escape.jpg';await fs.writeFile(path.join(f.recording,'events.jsonl'),f.events.map(JSON.stringify).join('\n'));
  await assert.rejects(prepareStataEvidence(f.recording),/Unsafe/);
});
test('Stata 18 Windows metadata is normalized only with consistent version provenance',async t=>{
  const metadata={applicationVersion:'521.18.0.120',productVersion:'521.18.0.120',fileVersion:'521,18,0,120',versionSource:'ProductVersion'};
  const good=await recordingFixture(t,1,metadata),e=await prepareStataEvidence(good.recording);
  assert.equal(e.manifest.applicationVersion,metadata.applicationVersion);
  assert.equal(e.manifest.fileVersion,metadata.fileVersion);
  assert.equal(e.normalizedApplicationVersion,'18.0');
  assert.deepEqual(e.versionProvenance,{version:'18.0',rawVersion:metadata.applicationVersion,source:'ProductVersion'});
  for(const overrides of [
    {applicationVersion:'521.19.0.120',productVersion:'521.19.0.120',fileVersion:'521,19,0,120'},
    {applicationVersion:'522.18.0.120',productVersion:'522.18.0.120',fileVersion:'522,18,0,120'},
    {applicationVersion:'521.18.1.120',productVersion:'521.18.1.120',fileVersion:'521,18,1,120'},
    {productVersion:'521.17.0.120'},
    {fileVersion:'521,18,0,121'},
    {versionSource:'unknown'},
    {versionSource:null},
    {applicationEdition:'SE'},
    {targetProcess:'StataSE-64'}
  ]){
    const candidate=await recordingFixture(t,1,{...metadata,...overrides});
    await assert.rejects(prepareStataEvidence(candidate.recording),/Stata\/MP|targetProcess/);
  }
  const missingSource=await recordingFixture(t,1,{...metadata,versionSource:undefined});
  await assert.rejects(prepareStataEvidence(missingSource.recording),/Stata\/MP/);
});
test('fake-client analysis is prepared, capped to two requests, resumes and keeps one nonexecuted .do',async t=>{
  const f=await recordingFixture(t,121),client=fakeClient();
  const prep=await runStataAnalysis(f,{client});assert.equal(prep.status,'prepared_no_upload');assert.equal(client.calls,0);
  const report=JSON.parse(await fs.readFile(prep.report));assert.equal(report.chunks.length,3);
  const paused=await runStataAnalysis({...f,analyze:true},{client});assert.equal(paused.status,'budget_paused');assert.equal(paused.completed,2);assert.equal(client.calls,2);
  assert.equal((await fs.readdir(paused.runDirectory)).filter(x=>x.endsWith('.do')).length,0);
  const result=await runStataAnalysis({...f,analyze:true},{client});assert.equal(result.status,'replay_script_generated_not_executed');
  assert.equal(result.sourceRecordingCompared,false);assert.equal(client.calls,3);
  assert.deepEqual((await fs.readdir(path.dirname(result.primaryOutput))).filter(x=>x.endsWith('.do')),['stata-replay.do']);
  const replay=await fs.readFile(result.primaryOutput,'utf8');
  assert.ok(replay.includes(`mkdir "${result.runtimeOutputDirectory.slice(2)}"`));
  assert.doesNotMatch(replay,/C:[\\/]|Users[\\/]/);
  assert.ok(!replay.includes(paused.runDirectory));
  const audit=JSON.parse(await fs.readFile(result.plan));
  assert.equal(result.runtimeOutputDirectory,`./${audit.runtimeDirectoryName}`);
  const request=JSON.parse(await fs.readFile(path.join(paused.runDirectory,(await fs.readdir(paused.runDirectory)).find(x=>x.endsWith('-request.json')))));
  assert.equal(request.attemptedImageInputs.length,1);assert.equal(request.attemptedImageInputs[0].bytes,4);
  assert.equal(result.usage.attempts.length,3);assert.equal(result.usage.unknownUsageAttempts,0);
  const again=await runStataAnalysis({...f,analyze:true},{client});assert.equal(again.requestsThisRound,0);assert.equal(client.calls,3);
  const recovered=await compileSavedStataAnalysis({...f,compileSavedRun:paused.runDirectory});
  assert.equal(recovered.requestsThisRound,0);assert.equal(recovered.provenance.length,3);assert.equal(recovered.status,'saved_replay_script_generated_not_executed');
  assert.notEqual(recovered.runtimeOutputDirectory,result.runtimeOutputDirectory);
  assert.doesNotMatch(await fs.readFile(recovered.primaryOutput,'utf8'),/C:[\\/]|Users[\\/]/);
});
test('semantic failure stops before next request; upload uncertainty needs explicit retry and keeps usage unknown',async t=>{
  const f=await recordingFixture(t,61);let calls=0;
  const client={getUsageRecords:()=>[],async analyze({payload}){calls++;const bad=fakeChunk(payload);bad.operations[0].apiCall.interfaceId='arbitrary.shell';
    await this.onResponse({id:'bad',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(bad)}]}]});return bad;}};
  await runStataAnalysis(f,{client});await assert.rejects(runStataAnalysis({...f,analyze:true},{client}),/model-selected command/);
  assert.equal(calls,1);await assert.rejects(runStataAnalysis({...f,analyze:true},{client}),/retry-failed/);
  const report=JSON.parse(await fs.readFile(path.join(f.recording,'generated-stata/prepare-report.json')));
  const status=JSON.parse(await fs.readFile(path.join(report.runDirectory,'status.json')));
  assert.equal(status.failurePhase,'chunk_validation');assert.equal(status.usage.unknownUsageAttempts,1);
  assert.equal((await fs.readdir(report.runDirectory)).filter(x=>x.endsWith('.do')).length,0);
});
test('Responses strict schema uses required closed objects and nested, never root, anyOf',()=>{
  assert.equal(STATA_SCHEMA.type,'object');assert.equal(STATA_SCHEMA.anyOf,undefined);
  const walk=node=>{if(!node||typeof node!=='object')return;
    if(node.type==='object'){assert.equal(node.additionalProperties,false);assert.deepEqual(new Set(node.required),new Set(Object.keys(node.properties)));}
    for(const child of Object.values(node))if(Array.isArray(child))child.forEach(walk);else if(child&&typeof child==='object')walk(child);
  };walk(STATA_SCHEMA);
});
test('changed screenshots invalidate prepared approval before any client call',async t=>{
  const f=await recordingFixture(t),client=fakeClient();await runStataAnalysis(f,{client});
  await fs.writeFile(path.join(f.recording,'screenshots/one.jpg'),Buffer.from([255,216,0,255,217]));
  await assert.rejects(runStataAnalysis({...f,analyze:true},{client}),/prepare and review/);
  assert.equal(client.calls,0);
});
test('raw response mismatch is a structure failure, and offline recovery rejects tampered response',async t=>{
  const f=await recordingFixture(t),client=fakeClient();await runStataAnalysis(f,{client});
  const result=await runStataAnalysis({...f,analyze:true},{client});assert.equal(client.calls,1);
  const files=await fs.readdir(path.dirname(result.primaryOutput)),name=files.find(x=>x.endsWith('-provider.json'));
  const target=path.join(path.dirname(result.primaryOutput),name),raw=JSON.parse(await fs.readFile(target,'utf8'));
  raw.output[0].content[0].text=JSON.stringify({bad:'tampered'});await fs.writeFile(target,JSON.stringify(raw));
  await assert.rejects(compileSavedStataAnalysis({...f,compileSavedRun:path.dirname(result.primaryOutput)}),/differs from provider/);
  const f2=await recordingFixture(t),broken={getUsageRecords:()=>[],async analyze({payload}){
    const parsed=fakeChunk(payload);await this.onResponse({id:'mismatch',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({bad:'different'})}]}]});return parsed;
  }};
  await runStataAnalysis(f2,{client:broken});await assert.rejects(runStataAnalysis({...f2,analyze:true},{client:broken}),/differs from provider/);
  const report=JSON.parse(await fs.readFile(path.join(f2.recording,'generated-stata/prepare-report.json')));
  const status=JSON.parse(await fs.readFile(path.join(report.runDirectory,'status.json')));
  assert.equal(status.failurePhase,'response_structure');
});
test('checkpoint resume rechecks raw response and refuses locally modified completed operations',async t=>{
  const f=await recordingFixture(t,121),client=fakeClient();await runStataAnalysis(f,{client});
  const paused=await runStataAnalysis({...f,analyze:true},{client});assert.equal(client.calls,2);
  const checkpointFile=path.join(paused.runDirectory,'checkpoint.json'),checkpoint=JSON.parse(await fs.readFile(checkpointFile,'utf8'));
  const cell=checkpoint.completed[0].operations.find(x=>x.kind==='cell');cell.arguments.value=999;cell.apiCall.arguments.value=999;
  await fs.writeFile(checkpointFile,JSON.stringify(checkpoint));
  await assert.rejects(runStataAnalysis({...f,analyze:true},{client}),/Checkpoint no longer matches/);
  assert.equal(client.calls,2);
});

// Simulate an older local implementation identity without touching production
// files or real provider responses. The provider-facing contract is unchanged.
async function legacySavedRun(f,client){
  await runStataAnalysis(f,{client});
  const paused=await runStataAnalysis({...f,analyze:true},{client});
  const old=path.join(path.dirname(paused.runDirectory),'a'.repeat(24)),legacyIdentity='a'.repeat(64);
  await fs.rename(paused.runDirectory,old);
  for(const file of await fs.readdir(old)){
    if(file==='prepare-report.json'||file==='checkpoint.json'||file.endsWith('-request.json')){
      const target=path.join(old,file),value=JSON.parse(await fs.readFile(target,'utf8'));
      value.identity=legacyIdentity;
      if(file==='checkpoint.json')delete value.completedSources; // pre-provenance checkpoint
      await fs.writeFile(target,JSON.stringify(value));
    }
  }
  await runStataAnalysis(f,{client});
  return old;
}
test('explicit saved-result reuse revalidates original requests and avoids repeating paid chunks',async t=>{
  const f=await recordingFixture(t,121),client=fakeClient(),old=await legacySavedRun(f,client);
  assert.equal(client.calls,2);
  const oldBytes=await fs.readFile(path.join(old,'checkpoint.json'));
  const result=await runStataAnalysis({...f,analyze:true,resumeFromRun:old},{client});
  assert.equal(client.calls,3);assert.equal(result.requestsThisRound,1);
  assert.equal(result.status,'replay_script_generated_not_executed');assert.equal(result.reusedResponses.length,2);
  assert.ok(result.reusedResponses.every(x=>x.runDirectory===old&&x.identity==='a'.repeat(64)));
  assert.deepEqual(await fs.readFile(path.join(old,'checkpoint.json')),oldBytes);
  const compiled=await compileSavedStataAnalysis({...f,compileSavedRun:path.dirname(result.primaryOutput)});
  assert.equal(compiled.requestsThisRound,0);assert.equal(compiled.provenance.length,3);
  assert.equal(compiled.provenance[0].runDirectory,old);
  assert.ok(compiled.provenance.every(x=>x.requestDigest&&x.responseDigest&&x.parsedDigest));
});
test('saved-result reuse rejects altered provider contract before any new request',async t=>{
  const f=await recordingFixture(t,121),client=fakeClient(),old=await legacySavedRun(f,client);
  const requestFile=(await fs.readdir(old)).find(x=>x.startsWith('001-')&&x.endsWith('-request.json'));
  const target=path.join(old,requestFile),request=JSON.parse(await fs.readFile(target,'utf8'));
  request.instructions+=' changed';await fs.writeFile(target,JSON.stringify(request));
  await assert.rejects(runStataAnalysis({...f,analyze:true,resumeFromRun:old},{client}),/Checkpoint no longer matches/);
  assert.equal(client.calls,2);
});
