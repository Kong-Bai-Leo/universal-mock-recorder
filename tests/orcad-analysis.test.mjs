import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runOrcadAnalysis as analyzeOrcad,compileExistingOrcad} from '../src/analyzer/orcad-cli.mjs';
import {ORCAD_BUDGET,prepareOrcadEvidence} from '../src/analyzer/lib/orcad-evidence.mjs';

const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
// Tests must not depend on the developer's ignored config.json or real model settings.
const runOrcadAnalysis=(options,deps)=>analyzeOrcad({
  ...options,config:options.config??path.join(options.recording,'fixture-config.json')
},deps);
async function recording(t,events){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'orcad-analysis-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'fixture-config.json'),JSON.stringify({provider:{model:'mock-orcad-model',imageDetail:'high'}}));
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({applicationProfile:'orcad-x-capture',captureDeployment:'same-windows-session'}));
  await fs.writeFile(path.join(dir,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
  await fs.writeFile(path.join(dir,'before.png'),png);await fs.writeFile(path.join(dir,'after.png'),png);
  return dir;
}
const events=[
  {id:'before',timestampMs:1,eventType:'key_down',key:'w',window:{processName:'Capture.exe'},screenshotBefore:'before.png',screenshotAfter:'after.png'},
  {id:'after',timestampMs:2,eventType:'key_down',key:'Escape',window:{processName:'Capture.exe'},screenshotBefore:'before.png',screenshotAfter:'after.png'}
];
const incompletePlan=()=>({
  version:'1.0',complete:false,summary:'The wire geometry is not known exactly.',
  pageContext:{application:'OrCAD X Capture',version:'24.1 P001',pageName:'PAGE1',initialState:'isolated_blank',evidenceIds:['before']},
  calibration:{coordinateSpace:'capture_page',unit:'page_inch',physicalGranularity:100,docUnitsPerInch:100,evidenceIds:[]},
  operations:[],decisions:[{sourceEventIds:['before','after'],disposition:'unresolved',reason:'Exact page coordinates are unavailable.'}],
  unresolved:[{sourceEventIds:['before','after'],reason:'Exact page coordinates are unavailable.'}],
  finalScene:{kind:'unknown',wireIds:[],aliasIds:[],evidenceIds:['after']},
  commandState:{pendingEventIds:[],selectionIds:[]}
});
test('prepare reports complete mapped evidence and never touches client',async t=>{
  const dir=await recording(t,events);let called=0;
  const result=await runOrcadAnalysis({recording:dir},{client:{analyze:()=>{called++;}}});
  assert.equal(result.status,'prepared_no_upload');assert.equal(called,0);
  const report=JSON.parse(await fs.readFile(result.report,'utf8'));
  assert.deepEqual(report.inputEventIds,['before','after']);assert.equal(report.allReferencedImages.length,2);
  assert.deepEqual(report.allReferencedImages.map(x=>x.uploadImageLabel),['before.png','before.png']);
  assert.equal(report.pendingUploadImages.length,1);
});
test('missing before/after, overflow and escaping image are rejected before upload',async t=>{
  const missing=await recording(t,[{...events[0],screenshotAfter:undefined}]);await assert.rejects(()=>prepareOrcadEvidence(missing),/before\/after/);
  const excess=await recording(t,[...events,...Array.from({length:61},(_,i)=>({id:'move'+i,timestampMs:i+3,eventType:'key_down',window:{processName:'Capture.exe'},key:'x'}))]);
  await assert.rejects(()=>prepareOrcadEvidence(excess),/input events 63\/60/);
  const escape=await recording(t,[{...events[0],screenshotBefore:'../outside.png'},events[1]]);
  await assert.rejects(()=>prepareOrcadEvidence(escape),/Unsafe recording file path/);
});
test('budget rejection reports actual counts against every limit without partial evidence',async t=>{
  const imageEvents=Array.from({length:12},(_,i)=>({...events[0],id:`image${i}`,timestampMs:i+1,screenshotBefore:`image${i}.png`}));
  const imageDir=await recording(t,imageEvents);
  for(let i=0;i<12;i++)await fs.writeFile(path.join(imageDir,`image${i}.png`),Buffer.concat([png,Buffer.from([i])]));
  await assert.rejects(()=>prepareOrcadEvidence(imageDir),error=>{
    assert.match(error.message,/unique images 13\/12/);
    assert.match(error.message,/input events 12\/60/);
    assert.match(error.message,/payload bytes \d+\/100000/);
    assert.match(error.message,new RegExp(`base64 bytes \\d+\\/${ORCAD_BUDGET.maxRequestBytes-200000}`));
    assert.match(error.message,/no partial upload/);
    return true;
  });
  const payloadDir=await recording(t,[{...events[0],text:'x'.repeat(100001)}]);
  await assert.rejects(()=>prepareOrcadEvidence(payloadDir),/payload bytes 100\d+\/100000/);
  const base64Dir=await recording(t,events);
  const large=Buffer.concat([png,Buffer.alloc(4*1024*1024)]);
  await fs.writeFile(path.join(base64Dir,'before.png'),large);
  await fs.writeFile(path.join(base64Dir,'after.png'),Buffer.concat([large,Buffer.from([1])]));
  await assert.rejects(()=>prepareOrcadEvidence(base64Dir),error=>{
    assert.match(error.message,/unique images 2\/12/);
    assert.match(error.message,new RegExp(`base64 bytes \\d+\\/${ORCAD_BUDGET.maxRequestBytes-200000}`));
    return true;
  });
});
test('explicit analysis requires matching preparation, preserves parsed invalid result, and requires explicit retry',async t=>{
  const dir=await recording(t,events);let calls=0;
  const client={analyze:async()=>{calls++;return {invalid:true};},getUsageRecords:()=>[]};
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client}),/Preparation fingerprint/);
  await runOrcadAnalysis({recording:dir});
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client}),/OrCAD:/);
  assert.equal(calls,1);
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client}),/explicitly use --retry-failed/);
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true,retryFailed:true},{client}),/OrCAD:/);
  assert.equal(calls,2);
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true,retryFailed:true},{client}),/attempt budget exhausted/);
  const run=path.join(dir,'generated-orcad',(await runOrcadAnalysis({recording:dir})).identity.slice(0,24));
  assert.deepEqual((await fs.readdir(run)).filter(x=>x.endsWith('-parsed.json')).length,2);
  assert.ok(!(await fs.readdir(run)).includes('orcad-replay.tcl'));
});
test('mock complete IR produces one unexecuted guarded Tcl and sends task knowledge',async t=>{
  const dir=await recording(t,events);await runOrcadAnalysis({recording:dir});
  const q=value=>({value,unit:'page_inch',coordinateSpace:'capture_page',precision:'exact',basis:'native_page_coordinate',evidenceIds:['before']});
  const program={version:'1.0',complete:true,summary:'One observed wire',pageContext:{application:'OrCAD X Capture',version:'24.1 P001',pageName:'PAGE1',initialState:'isolated_blank',evidenceIds:['before']},calibration:{coordinateSpace:'capture_page',unit:'page_inch',physicalGranularity:100,docUnitsPerInch:100,evidenceIds:['before']},
    operations:[{id:'opWire',kind:'place_wire',timestampMs:2,stage:'committed',sourceEventIds:['before','after'],wireId:'wireOne',x1:q(1),y1:q(2),x2:q(3),y2:q(2),apiCall:{interfaceId:'capture-tcl-place-wire',member:'PlaceWire',arguments:{x1:1,y1:2,x2:3,y2:2}}}],
    decisions:[{sourceEventIds:['before','after'],disposition:'modeled',reason:'Observed committed wire'}],unresolved:[],finalScene:{kind:'observed',wireIds:['wireOne'],aliasIds:[],evidenceIds:['after']},commandState:{pendingEventIds:[],selectionIds:[]}};
  let request;
  const client={analyze:async x=>{request=x;return program;},getUsageRecords:()=>[]};
  const result=await runOrcadAnalysis({recording:dir,analyze:true},{client});
  assert.equal(result.status,'not_executed');
  assert.equal(request.screenshots.length,1);
  assert.ok(request.payload.knowledge.placeMenu.some(x=>x.id==='place-wire'));
  assert.ok(request.payload.knowledge.interfaces.some(x=>x.id==='capture-tcl-place-wire'));
  const script=await fs.readFile(result.primaryOutput,'utf8');assert.match(script,/__orc_assertPage/);assert.match(script,/PlaceWire/);
  assert.ok(!(await fs.readdir(path.dirname(result.primaryOutput))).some(x=>x.startsWith('image-snapshot-')));
});
test('configured low image detail is raised to high without changing model or schema',async t=>{
  const dir=await recording(t,events),config=path.join(dir,'config.json');
  await fs.writeFile(config,JSON.stringify({provider:{model:'mock-orcad-model',imageDetail:'low'}}));
  const prepared=await runOrcadAnalysis({recording:dir,config});
  const report=JSON.parse(await fs.readFile(prepared.report,'utf8'));
  assert.equal(report.model,'mock-orcad-model');
  assert.equal(report.imagePolicy.configuredDetail,'low');
  assert.equal(report.imagePolicy.effectiveDetail,'high');
  let request;
  const client={analyze:async value=>{request=value;return incompletePlan();},getUsageRecords:()=>[]};
  const result=await runOrcadAnalysis({recording:dir,config,analyze:true},{client});
  assert.equal(result.status,'parsed_incomplete_not_executed');
  assert.equal(request.outputSchema.properties.calibration.type,'object');
  assert.ok(request.outputSchema.required.includes('operations'));
  const audit=JSON.parse(await fs.readFile(path.join(dir,'generated-orcad',prepared.identity.slice(0,24),'001-request.json'),'utf8'));
  assert.equal(audit.provider.model,'mock-orcad-model');
  assert.equal(audit.provider.imageDetail,'high');
  assert.deepEqual(audit.schema,request.outputSchema);
});
test('valid incomplete zero-operation plan preserves parsed data and emits no Tcl',async t=>{
  const dir=await recording(t,events),plan=incompletePlan();
  const prepared=await runOrcadAnalysis({recording:dir});
  const client={analyze:async()=>plan,getUsageRecords:()=>[]};
  const result=await runOrcadAnalysis({recording:dir,analyze:true},{client});
  assert.equal(result.status,'parsed_incomplete_not_executed');
  assert.deepEqual(JSON.parse(await fs.readFile(result.parsed,'utf8')),plan);
  const run=path.join(dir,'generated-orcad',prepared.identity.slice(0,24));
  assert.ok(!(await fs.readdir(run)).includes('orcad-replay.tcl'));
  assert.ok(!(await fs.readdir(run)).includes('orcad-replay.tcl.tmp'));
});
test('changed image hash invalidates preparation',async t=>{
  const dir=await recording(t,events);await runOrcadAnalysis({recording:dir});
  await fs.writeFile(path.join(dir,'after.png'),Buffer.concat([png,Buffer.from([1])]));
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client:{analyze:()=>{throw Error('should not run');}}}),/fingerprint changed/);
});
test('two uncertain attempts remain the limit after model configuration changes',async t=>{
  const dir=await recording(t,events),config=path.join(dir,'config.json');
  const client={analyze:async()=>{throw Error('transport unknown');},getUsageRecords:()=>[]};
  for(const [i,model] of ['mock-a','mock-b'].entries()){
    await fs.writeFile(config,JSON.stringify({provider:{model}}));
    await runOrcadAnalysis({recording:dir,config});
    await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,analyze:true,retryFailed:i>0},{client}),/transport unknown/);
  }
  await fs.writeFile(config,JSON.stringify({provider:{model:'mock-c'}}));
  await runOrcadAnalysis({recording:dir,config});
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,analyze:true,retryFailed:true},{client}),/attempt budget exhausted/);
  const attempts=JSON.parse(await fs.readFile(path.join(dir,'generated-orcad','attempts.json'),'utf8'));
  assert.equal(attempts.length,2);assert.ok(attempts.every(x=>x.usage==='unknown'));
});
test('explicit four-attempt budget retains two unknown attempts across fingerprints',async t=>{
  const dir=await recording(t,events),config=path.join(dir,'config.json');
  const client={analyze:async()=>{throw Error('transport unknown');},getUsageRecords:()=>[]};
  for(const model of ['mock-a','mock-b']){
    await fs.writeFile(config,JSON.stringify({provider:{model}}));
    await runOrcadAnalysis({recording:dir,config});
    await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,analyze:true,retryFailed:model==='mock-b'},{client}),/transport unknown/);
  }
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,analyze:true,retryFailed:true,maxAttempts:4},{client}),/Preparation fingerprint changed/);
  const defaultIdentity=(await runOrcadAnalysis({recording:dir,config})).identity;
  const prepared=await runOrcadAnalysis({recording:dir,config,maxAttempts:4});
  const report=JSON.parse(await fs.readFile(prepared.report,'utf8'));
  assert.equal(report.budget.maxAttempts,4);
  assert.notEqual(prepared.identity,defaultIdentity);
  for(let i=0;i<2;i++)await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,maxAttempts:4,analyze:true,retryFailed:true},{client}),/transport unknown/);
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,maxAttempts:4,analyze:true,retryFailed:true},{client}),/attempt budget exhausted/);
  const attempts=JSON.parse(await fs.readFile(path.join(dir,'generated-orcad','attempts.json'),'utf8'));
  assert.equal(attempts.length,4);assert.ok(attempts.every(x=>x.usage==='unknown'));
  await runOrcadAnalysis({recording:dir,config,maxAttempts:2});
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,config,maxAttempts:2,analyze:true,retryFailed:true},{client}),/attempt budget exhausted/);
});
test('invalid max-attempts values are rejected before preparation',async t=>{
  const dir=await recording(t,events);
  for(const maxAttempts of [1,7,2.5,'four','4.0','',null,NaN])
    await assert.rejects(()=>runOrcadAnalysis({recording:dir,maxAttempts}),/max-attempts must be an integer from 2 to 6/);
  await assert.rejects(()=>fs.stat(path.join(dir,'generated-orcad')),error=>error.code==='ENOENT');
});
test('recording-wide lock refuses concurrent analysis',async t=>{
  const dir=await recording(t,events);await runOrcadAnalysis({recording:dir});
  await fs.writeFile(path.join(dir,'generated-orcad','analysis.lock'),'held');
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client:{}}),/locked/);
});
test('privacy gap, unknown target action and partial key pair are rejected',async t=>{
  const privacy=await recording(t,[events[0],{id:'pause',timestampMs:2,eventType:'privacy_pause'}, {...events[1],timestampMs:3}]);
  await assert.rejects(()=>prepareOrcadEvidence(privacy),/privacy gap/);
  const unknown=await recording(t,[events[0],{id:'unknown',timestampMs:2,eventType:'custom_edit',window:{processName:'Capture.exe'}},{...events[1],timestampMs:3}]);
  await assert.rejects(()=>prepareOrcadEvidence(unknown),/Unknown target event/);
  const partial=await recording(t,[events[0],{...events[1],screenshotAfter:undefined}]);
  await assert.rejects(()=>prepareOrcadEvidence(partial),/Incomplete key-down/);
  const reversed=await recording(t,[{...events[0],screenshotBeforeTimestampMs:10,screenshotAfterTimestampMs:9},events[1]]);
  await assert.rejects(()=>prepareOrcadEvidence(reversed),/timestamps reversed/);
});
test('Recorder visual command context reaches the model and malformed ledger fails closed',async t=>{
  const dir=await recording(t,[{...events[0],visualCommandContext:'Place Wire'},events[1]]);
  const prepared=await runOrcadAnalysis({recording:dir});
  const evidence=await prepareOrcadEvidence(dir);
  assert.equal(evidence.events[0].visualCommandContext,'Place Wire');
  await fs.writeFile(path.join(dir,'generated-orcad','attempts.json'),'{}');
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client:{analyze:()=>{throw Error('must not call');}}}),/Invalid session attempt ledger/);
  assert.ok(prepared.identity);
});
test('upload uses isolated snapshot bytes when original image changes during client call; snapshot is cleaned',async t=>{
  const dir=await recording(t,events);await runOrcadAnalysis({recording:dir});
  let observed;
  const client={analyze:async request=>{
    await fs.writeFile(path.join(dir,'before.png'),Buffer.concat([png,Buffer.from([3])]));
    observed=await fs.readFile(request.screenshots[0].path);
    assert.match(request.screenshots[0].path,/image-snapshot-/);
    throw Error('simulated response failure');
  },getUsageRecords:()=>[]};
  await assert.rejects(()=>runOrcadAnalysis({recording:dir,analyze:true},{client}),/simulated response failure/);
  assert.deepEqual(observed,png);
  const out=path.join(dir,'generated-orcad');
  const runs=(await fs.readdir(out,{withFileTypes:true})).filter(x=>x.isDirectory());
  assert.equal(runs.length,1);
  assert.ok(!(await fs.readdir(path.join(out,runs[0].name))).some(x=>x.startsWith('image-snapshot-')));
});
test('symlinked source image escaping recording is rejected',async t=>{
  const dir=await recording(t,events),outside=await fs.mkdtemp(path.join(os.tmpdir(),'orcad-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'image.png'),png);
  await fs.unlink(path.join(dir,'before.png'));
  try{await fs.symlink(path.join(outside,'image.png'),path.join(dir,'before.png'),'file');}
  catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e;}
  await assert.rejects(()=>prepareOrcadEvidence(dir),/escapes its root/);
});

async function savedFailedAttempt(t,change=()=>{}){
  const dir=await recording(t,events),prepared=await runOrcadAnalysis({recording:dir});
  const out=path.join(dir,'generated-orcad'),run=path.join(out,prepared.identity.slice(0,24));
  await fs.mkdir(run);
  const q=value=>({value,unit:'page_inch',coordinateSpace:'capture_page',precision:'exact',basis:'native_page_coordinate',evidenceIds:['before']});
  const plan={version:'1.0',complete:true,summary:'Synthetic committed wire',
    pageContext:{application:'OrCAD X Capture',version:'24.1 P001',pageName:'PAGE1',initialState:'isolated_blank',evidenceIds:['before']},
    calibration:{coordinateSpace:'capture_page',unit:'page_inch',physicalGranularity:100,docUnitsPerInch:100,evidenceIds:['before']},
    operations:[{id:'opWire',kind:'place_wire',timestampMs:2,stage:'committed',sourceEventIds:['before','after'],wireId:'wireOne',x1:q(1),y1:q(2),x2:q(3),y2:q(2),apiCall:{interfaceId:'capture-tcl-place-wire',member:'PlaceWire',arguments:{x1:1,y1:2,x2:3,y2:2}}}],
    decisions:[{sourceEventIds:['before','after'],disposition:'modeled',reason:'Observed committed wire'}],unresolved:[],
    finalScene:{kind:'observed',wireIds:['wireOne'],aliasIds:[],evidenceIds:['after']},commandState:{pendingEventIds:[],selectionIds:['wireOne']}};
  change(plan);
  const parsed=path.join(run,'001-parsed.json'),request=path.join(run,'001-request.json');
  const evidence=await prepareOrcadEvidence(dir);
  await fs.writeFile(parsed,JSON.stringify(plan));
  await fs.writeFile(request,JSON.stringify({identity:prepared.identity,payload:{inputs:evidence.events,allowedEvidenceIds:evidence.events.map(item=>item.id)},images:evidence.images.map(item=>({file:item.label,bytes:item.bytes,sha256:item.digest}))}));
  await fs.writeFile(path.join(run,'001-provider.json'),JSON.stringify({status:'completed',error:null,incomplete_details:null,output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]}));
  await fs.writeFile(path.join(run,'status.json'),JSON.stringify({status:'failed',phase:'validation',identity:prepared.identity,attempt:1,parsed}));
  await fs.writeFile(path.join(out,'attempts.json'),JSON.stringify([{attempt:1,identity:prepared.identity,usage:'unknown'}]));
  return {dir,out,run,parsed,plan,request};
}

test('offline compile uses original provider-parsed plan and request IDs without changing failed status or attempt ledger',async t=>{
  const source=await savedFailedAttempt(t);
  const oldStatus=await fs.readFile(path.join(source.run,'status.json'));
  const oldLedger=await fs.readFile(path.join(source.out,'attempts.json'));
  const result=await compileExistingOrcad({recording:source.dir,parsed:source.parsed});
  assert.equal(result.status,'not_executed');assert.equal(result.sourceStatus,'failed');
  assert.equal(result.sourceRecordingCompared,false);assert.equal(result.execution,'not_run');
  assert.equal(Object.keys(result.originalHashes).length,6);
  assert.match(await fs.readFile(result.primaryOutput,'utf8'),/PlaceWire 1 2 3 2/);
  assert.deepEqual(await fs.readFile(path.join(source.run,'status.json')),oldStatus);
  assert.deepEqual(await fs.readFile(path.join(source.out,'attempts.json')),oldLedger);
  assert.deepEqual(JSON.parse(await fs.readFile(result.report,'utf8')),result);
});

test('offline compile rejects changed provider parse, orphaned attempt, tampered request and incomplete plan',async t=>{
  const changed=await savedFailedAttempt(t);
  const altered=structuredClone(changed.plan);altered.commandState.selectionIds=[];
  await fs.writeFile(changed.parsed,JSON.stringify(altered));
  await assert.rejects(()=>compileExistingOrcad({recording:changed.dir,parsed:changed.parsed}),/differs from original provider/);

  const orphan=await savedFailedAttempt(t);
  await fs.writeFile(path.join(orphan.out,'attempts.json'),'[]');
  await assert.rejects(()=>compileExistingOrcad({recording:orphan.dir,parsed:orphan.parsed}),/provenance/);

  const request=await savedFailedAttempt(t);
  const requestData=JSON.parse(await fs.readFile(request.request));requestData.payload.allowedEvidenceIds=['wrong'];
  await fs.writeFile(request.request,JSON.stringify(requestData));
  await assert.rejects(()=>compileExistingOrcad({recording:request.dir,parsed:request.parsed}),/evidence no longer matches/);

  const images=await savedFailedAttempt(t);
  const imagesRequest=JSON.parse(await fs.readFile(images.request));imagesRequest.images=[];
  await fs.writeFile(images.request,JSON.stringify(imagesRequest));
  await assert.rejects(()=>compileExistingOrcad({recording:images.dir,parsed:images.parsed}),/evidence no longer matches/);

  const partial=await savedFailedAttempt(t,plan=>{plan.complete=false;plan.unresolved=[{sourceEventIds:['after'],reason:'Missing edit'}];});
  await assert.rejects(()=>compileExistingOrcad({recording:partial.dir,parsed:partial.parsed}),/incomplete\/unresolved/);
});

test('offline compile rejects incomplete provider status and inconsistent output_text',async t=>{
  for(const change of [
    provider=>{provider.status='incomplete';},
    provider=>{provider.error={message:'partial response'};},
    provider=>{provider.incomplete_details={reason:'max_output_tokens'};},
    provider=>{provider.output_text=JSON.stringify({invalid:true});}
  ]){
    const source=await savedFailedAttempt(t),file=path.join(source.run,'001-provider.json');
    const provider=JSON.parse(await fs.readFile(file));change(provider);
    await fs.writeFile(file,JSON.stringify(provider));
    await assert.rejects(()=>compileExistingOrcad({recording:source.dir,parsed:source.parsed}),/provider response was not completed|output_text differs/);
  }
});

test('offline compile rejects parsed path outside its original recording',async t=>{
  const a=await savedFailedAttempt(t),b=await savedFailedAttempt(t);
  await assert.rejects(()=>compileExistingOrcad({recording:a.dir,parsed:b.parsed}),/not an original OrCAD attempt/);
});
