import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runQuartusAnalysis,parseQuartusArgs} from '../src/analyzer/quartus-cli.mjs';
import {buildQuartusActions,chunkQuartusActions,selectQuartusEvidence,assessQuartusTransitionEvidence} from '../src/analyzer/lib/quartus-trace.mjs';
import {buildQuartusHarness} from '../src/analyzer/lib/quartus-harness.mjs';
import {isQuartus} from '../src/analyzer/lib/quartus-knowledge.mjs';

// All model responses and screenshots are synthetic. No external API or Quartus process runs here.
const window={processName:'quartus',processId:42,title:'Quartus Prime Pro Edition',x:0,y:0,width:1280,height:720};
const hdl='module demo(input wire a, output wire y);\n  assign y = a;\nendmodule\n';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=','base64');
function key(id,name='ENTER',changes={}) {return {id,eventType:'key_down',timestampMs:Number(id.slice(1))*100,key:name,
  text:name.length===1?name.toLowerCase():null,modifiers:[],window,target:null,
  screenshotBefore:`screenshots/${id}-before.png`,screenshotAfter:`screenshots/${id}-after.png`,...changes};}
function plan(payload) {
  const evidence={sourceEventIds:payload.actions[0].sourceEventIds,screenshotFiles:payload.screenshotFiles.slice(0,2),precision:'exact'};
  const prior=payload.previousContext?structuredClone(payload.previousContext):null;
  return {schemaVersion:'quartus-workflow/1',summary:'Synthetic recorded design',complete:true,warnings:[],
    project:prior?.project??{name:'demo',revision:'demo',family:'Agilex 5',device:'A5ED065BB32AE4S',top:'demo',evidence},
    files:prior?.files??[{path:'demo.v',language:'verilog',content:hdl,evidence}],
    assignments:prior?.assignments??[],clocks:prior?.clocks??[],
    operations:payload.actions.map((a,i)=>({id:`chunk-${payload.chunk.index}-op-${i}`,kind:prior?'navigation':'create_project',
      summary:'Synthetic evidenced action',sourceEventIds:a.sourceEventIds,
      beforeScreenshot:payload.screenshotFiles.includes(a.screenshotBefore)?a.screenshotBefore:null,
      afterScreenshot:payload.screenshotFiles.includes(a.screenshotAfter)?a.screenshotAfter:null,status:'applied'})),
    resolutions:[],unresolved:[],state:{phase:'idle',pendingInput:null}};
}
async function fixture(t,settings={},events=[key('e1'),key('e2')]) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quartus-analysis-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'screenshots'));
  for(const e of events) for(const f of [e.screenshot,e.screenshotBefore,e.screenshotAfter].filter(Boolean)) await fs.writeFile(path.join(dir,f),png);
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({applicationProfile:'quartus',captureMode:'visual-input',uiAutomationTargets:false,screenshotScope:'virtual-desktop'}));
  await fs.writeFile(path.join(dir,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
  const config=path.join(dir,'config.json');
  await fs.writeFile(config,JSON.stringify({provider:{model:'synthetic-no-api'},analysis:{quartus:settings}}));
  return {dir,events,options:{recording:dir,config}};
}
const read=async(file)=>JSON.parse(await fs.readFile(file,'utf8'));
const clientFor=callback=>({client:{analyze:async request=>callback(request),getUsageRecords:()=>[]}});

test('Quartus identity isolates remote desktop and other software; shortcuts are not pasted text',()=>{
  assert.equal(isQuartus({processName:'QUARTUS.EXE'}),true);
  for(const processName of ['mstsc','quartus_sh','quartus-helper','notepad'])assert.equal(isQuartus({processName}),false);
  assert.equal(buildQuartusActions([key('e1','X',{window:{processName:'mstsc',title:'Quartus'}})]).length,0);
  const actions=buildQuartusActions([key('e1','V',{text:'\u0016',modifiers:['CTRL']}),key('e2','3',{text:'3'})]);
  assert.deepEqual(actions.map(a=>a.observedText),[null,'3']);assert.equal(actions[0].rawKeyText,'\u0016');
  assert.ok(actions.every(a=>a.cadInputEvidence===undefined));
});

test('window changes do not pair gestures and delayed dialog evidence preserves its frame',()=>{
  const down={...key('e1'),eventType:'mouse_down',button:'left',x:1,y:2};
  const dialog={...window,title:'New Project Wizard',x:200,y:100,width:600,height:400};
  assert.equal(buildQuartusActions([down,{...key('e2'),eventType:'mouse_up',button:'left',window:dialog,x:1,y:2}]).length,0);
  assert.equal(buildQuartusActions([{...down,window:{...window,handle:101}},
    {...key('e2'),eventType:'mouse_up',button:'left',window:{...window,handle:102},x:1,y:2}]).length,0);
  const obs={id:'o1',eventType:'state_observation',timestampMs:150,window:dialog,screenshot:'screenshots/dialog.png'};
  const actions=buildQuartusActions([key('e1'),obs,key('e2','ESCAPE',{window:dialog})]);
  assert.equal(chunkQuartusActions(actions).length,2);
  assert.deepEqual(actions[0].observations,[]);
  assert.deepEqual(actions[0].transitionObservations[0].window,dialog);
  assert.equal(actions[0].transitionObservations[0].requiresVisualConfirmation,true);
  assert.equal(actions[0].captureTiming.settled,false);
});

test('whole before/after groups survive budget selection; traversal is refused',async t=>{
  const {dir,events}=await fixture(t);const actions=buildQuartusActions(events);
  const chosen=await selectQuartusEvidence(dir,actions,3);
  assert.deepEqual(chosen.images.map(x=>x.label).sort(),['screenshots/e2-after.png','screenshots/e2-before.png']);
  assert.equal(chosen.excluded.length,1);assert.equal(chosen.excluded[0].files.length,2);
  assert.equal((await selectQuartusEvidence(dir,actions,1)).images.length,0);
  await assert.rejects(()=>selectQuartusEvidence(dir,[{sourceEventIds:['e1'],screenshotBefore:'../outside.png'}],2),/超出/);
});

test('harness keeps pending input and evidence health without assuming edits committed',()=>{
  const state={phase:'project_setup',pendingInput:'device selection not committed'};
  const harness=buildQuartusHarness(buildQuartusActions([key('e1')]),state,{missing:[{eventIds:['e1']}]});
  assert.deepEqual(harness.previousState,state);assert.equal(harness.inputs[0].stage,'unknown');
  assert.equal(harness.inputs[0].requiresVisualConfirmation,true);assert.equal(harness.evidenceHealth.missing.length,1);
});

test('pointer sampling declares loss and late observations do not leak beyond the next input',()=>{
  const moves=Array.from({length:70},(_,i)=>({id:`m${i}`,eventType:'mouse_move',timestampMs:101+i,window,x:i,y:i}));
  const observation={id:'o1',eventType:'state_observation',timestampMs:175,screenshotTimestampMs:205,window,screenshot:'screenshots/late.png'};
  const actions=buildQuartusActions([key('e1'),...moves,observation,key('e2')]);
  assert.equal(actions[0].pointerTrace.length,32);assert.equal(actions[0].pointerTraceBudget.excluded,38);
  assert.equal(actions[0].pointerTrace[0].eventId,'m0');assert.equal(actions[0].pointerTrace.at(-1).eventId,'m69');
  assert.deepEqual(actions[0].observations,[]);assert.deepEqual(actions[1].observations.map(o=>o.eventId),['o1']);
});

test('observation endpoint policy explicitly accounts for omitted intermediate frames',()=>{
  const obs=(id,time,w=window)=>({id,eventType:'state_observation',timestampMs:time,window:w,screenshot:`screenshots/${id}.png`});
  const dialog={...window,handle:900,title:'New Project Wizard'};
  const action=buildQuartusActions([key('e1'),obs('same-first',110),obs('same-middle',120),obs('same-last',130),
    obs('dialog-first',140,dialog),obs('dialog-middle',150,dialog),obs('dialog-last',160,dialog),key('e2')])[0];
  assert.equal(action.observationBudget.total,6);assert.equal(action.observationBudget.included,4);
  assert.equal(action.observationBudget.excluded,2);
  assert.deepEqual(action.observationBudget.excludedEventIds,['same-middle','dialog-middle']);
  assert.deepEqual(action.observationBudget.includedEventIds,['same-first','same-last','dialog-first','dialog-last']);
  assert.deepEqual(action.observations.map(o=>o.eventId),['same-first','same-last']);
  assert.deepEqual(action.transitionObservations.map(o=>o.eventId),['dialog-first','dialog-last']);
});

test('prepare-only performs zero API calls without credentials and preserves input evidence',async t=>{
  const {dir}=await fixture(t);let calls=0;
  const result=await runQuartusAnalysis({recording:dir,prepareOnly:true},clientFor(()=>{calls++;throw Error('API forbidden');}));
  assert.equal(calls,0);assert.equal(result.apiRequests,0);assert.equal(result.preparation.actionCount,2);
  assert.equal(result.preparation.chunks[0].signatures.length,4);
  assert.equal((await read(path.join(dir,'generated/analysis-status.json'))).status,'prepared');
});

test('observation IDs are separated in payload/schema; bounded repair preserves transition proof and raw response',async t=>{
  const obs={id:'o1',eventType:'state_observation',timestampMs:150,
    window:{...window,handle:222,title:'Opened project'},screenshot:'screenshots/finished.png'};
  const {options,dir}=await fixture(t,{maxValidationRepairs:1},[key('e1','ENTER',{screenshotAfter:null}),obs]);
  const requests=[];
  const result=await runQuartusAnalysis(options,clientFor(request=>{
    requests.push(request);
    const {payload,outputSchema}=request;
    assert.deepEqual(payload.inputEventIds,['e1']);
    assert.deepEqual(payload.sourceEventIds,['e1']);
    assert.deepEqual(payload.observationEventIds,['o1']);
    assert.deepEqual(payload.evidenceEventIds,['e1','o1']);
    assert.deepEqual(outputSchema.properties.operations.items.properties.sourceEventIds.items.enum,['e1']);
    const p=structuredClone(plan(payload));p.operations[0].afterScreenshot=obs.screenshot;
    // Observations are legitimate final-state evidence, but never input coverage.
    p.project.evidence.sourceEventIds=['e1','o1'];p.project.evidence.screenshotFiles=[obs.screenshot];
    if(!payload.validationRepair)p.operations[0].sourceEventIds.push('o1');
    else {
      assert.deepEqual(payload.validationRepair.details,{code:'quartus_operation_input_reference',
        invalidReferences:[{operationId:'chunk-1-op-0',eventId:'o1',reason:'observation_not_input'}],allowedInputEventIds:['e1']});
      assert.match(payload.validationRepair.error,/afterScreenshot/);
    }
    return p;
  }));
  assert.equal(requests.length,2);assert.equal(result.workflow.complete,true);
  assert.equal(result.evidenceResolution.chunks[0].resolvedTransitionEvidence[0].observationEventId,'o1');
  assert.deepEqual((await read(path.join(dir,'generated/model-result-1-1.json'))).operations[0].sourceEventIds,['e1','o1']);
  assert.deepEqual(result.workflow.operations[0].sourceEventIds,['e1']);
  assert.equal(result.build.executed,false);
});

test('repeated same-window observation-as-input is rejected at repair cap without generating a project',async t=>{
  const obs={id:'o1',eventType:'state_observation',timestampMs:150,window,screenshot:'screenshots/settled.png'};
  const {options,dir}=await fixture(t,{maxValidationRepairs:1},[key('e1'),obs]);let calls=0;
  await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{
    calls++;const p=plan(payload);p.operations[0].sourceEventIds=['o1'];return p;
  })),/o1 \(observation_not_input\)/);
  assert.equal(calls,2);
  const status=await read(path.join(dir,'generated/analysis-status.json'));
  assert.equal(status.status,'failed');assert.equal(status.requests,2);
  assert.equal((await fs.readdir(path.join(dir,'generated'))).some(n=>n.startsWith('project-bundle-')),false);
});

test('old and invented inputs remain rejected with precise repair classifications',async t=>{
  for(const reference of ['e1','invented']) {
    const {options,dir}=await fixture(t,{maxActionsPerRequest:1,maxValidationRepairs:1});let calls=0;
    await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{
      calls++;const p=structuredClone(plan(payload));
      if(payload.chunk.index===2) {
        p.operations[0].sourceEventIds.push(reference);
        if(payload.validationRepair)assert.deepEqual(payload.validationRepair.details.invalidReferences,
          [{operationId:'chunk-2-op-0',eventId:reference,reason:'not_current_chunk_input'}]);
      }
      return p;
    })),/not_current_chunk_input/);
    assert.equal(calls,3);
    assert.equal((await read(path.join(dir,'generated/analysis-checkpoint.json'))).completed.length,1);
  }
});

test('current observation can resolve earlier pending operation without counting as an input',async t=>{
  const obs={id:'o1',eventType:'state_observation',timestampMs:250,window,screenshot:'screenshots/confirm.png'};
  const {options}=await fixture(t,{maxActionsPerRequest:1},[key('e1'),key('e2'),obs]);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan({...payload,previousContext:null});
    if(payload.chunk.index===1){p.project=null;p.files=[];p.complete=false;p.operations[0].status='pending';p.state={phase:'project_setup',pendingInput:'awaiting confirmation'};}
    else p.resolutions=[{operationId:'chunk-1-op-0',status:'applied',sourceEventIds:['o1'],screenshotFiles:[obs.screenshot]}];
    return p;
  }));
  assert.equal(result.workflow.complete,true);
  assert.deepEqual(result.workflow.operations.flatMap(o=>o.sourceEventIds),['e1','e2']);
  assert.deepEqual(result.workflow.resolutions[0].sourceEventIds,['o1']);
});

test('valid stub analysis carries cumulative state, writes source/Tcl artifacts and does not claim replay',async t=>{
  const {options,dir}=await fixture(t,{maxActionsPerRequest:1});const requests=[];
  const result=await runQuartusAnalysis(options,clientFor(request=>{requests.push(request);return plan(request.payload);}));
  assert.equal(result.workflow.complete,true);assert.equal(result.workflow.operations.length,2);
  assert.deepEqual(requests[1].payload.previousContext.files,result.workflow.files);
  assert.equal(requests[0].payload.capture.softwareInternalApi,false);
  assert.ok(requests[0].payload.knowledge.entries.length>0);
  assert.equal(requests[0].screenshots.length,2);
  assert.ok(requests[0].payload.imageMappings.every(m=>m.sourceFile===m.uploadedLabel));
  assert.match(requests[0].instructions,/Imported HDL/);
  assert.equal(result.build.generated,true);assert.equal(result.build.executed,false);assert.equal(result.build.logicalEquivalenceVerified,false);
  assert.equal(await fs.readFile(path.join(result.build.outputDirectory,'demo.v'),'utf8'),hdl);
  assert.match(await fs.readFile(path.join(result.build.outputDirectory,'build.tcl'),'utf8'),/project_new/);
  for(const name of ['quartus-workflow.json','semantic-trace.json','analysis-harness.json'])assert.ok((await fs.stat(path.join(dir,'generated',name))).size>0);
  const status=await read(path.join(dir,'generated/analysis-status.json'));
  assert.equal(status.verification.applicationReplay,'not_run');assert.equal(status.verification.realModelAccuracy,'not_measured');
});

test('completed checkpoints reuse API results and changed screenshot bytes invalidate them',async t=>{
  const {options,dir}=await fixture(t);let calls=0;
  const dependency=clientFor(({payload})=>{calls++;return plan(payload);});
  await runQuartusAnalysis(options,dependency);await runQuartusAnalysis(options,dependency);assert.equal(calls,1);
  await fs.appendFile(path.join(dir,'screenshots/e1-before.png'),Buffer.from('synthetic evidence changed'));
  await runQuartusAnalysis(options,dependency);assert.equal(calls,2);
});

test('request ceiling preserves checkpoints and next run resumes remaining chunks',async t=>{
  const {options,dir}=await fixture(t,{maxRequestsPerRun:1,maxActionsPerRequest:1});let calls=0;
  const dependency=clientFor(({payload})=>{calls++;return plan(payload);});
  await assert.rejects(()=>runQuartusAnalysis(options,dependency),/请求上限/);
  assert.equal((await read(path.join(dir,'generated/analysis-checkpoint.json'))).completed.length,1);
  const result=await runQuartusAnalysis(options,dependency);assert.equal(calls,2);assert.equal(result.workflow.complete,true);
});

test('text context limit fails before any API request',async t=>{
  const {options}=await fixture(t,{maxContextBytes:8192},[key('e1','A',{text:'a'.repeat(20000)})]);let calls=0;
  await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{calls++;return plan(payload);})),/预算/);
  assert.equal(calls,0);
});

test('unknown image/event references fail within bounded validation repairs',async t=>{
  for(const kind of ['image','event']) {
    const {options,dir}=await fixture(t,{maxValidationRepairs:1});let calls=0;
    await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{
      calls++;const p=plan(payload);
      if(kind==='image')p.project.evidence.screenshotFiles=['not-uploaded.png'];else p.project.evidence.sourceEventIds=['fabricated'];
      return p;
    })),/evidence/);
    assert.equal(calls,2);assert.equal((await read(path.join(dir,'generated/analysis-status.json'))).status,'failed');
  }
});

test('previous evidence cannot support newly changed design values',async t=>{
  const {options}=await fixture(t,{maxActionsPerRequest:1,maxValidationRepairs:0});let calls=0;
  await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{
    calls++;const p=plan(payload);
    if(payload.chunk.index===2){p.project.top='changed';p.operations[0].kind='set_project';}
    return p;
  })),/旧证据/);
  assert.equal(calls,2);
});

test('a later Finish resolves pending wizard operation with fresh evidence and preserves the audit',async t=>{
  const {options}=await fixture(t,{maxActionsPerRequest:1,maxValidationRepairs:0});
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan({...payload,previousContext:null});
    if(payload.chunk.index===1) {
      p.project=null;p.files=[];p.complete=false;p.operations[0].status='pending';
      p.state={phase:'project_setup',pendingInput:'wizard awaiting Finish'};
    } else p.resolutions=[{operationId:'chunk-1-op-0',status:'applied',sourceEventIds:payload.actions[0].sourceEventIds,screenshotFiles:payload.screenshotFiles}];
    return p;
  }));
  assert.equal(result.workflow.complete,true);assert.equal(result.build.generated,true);
  assert.equal(result.workflow.operations.find(o=>o.id==='chunk-1-op-0').status,'pending');
  assert.equal(result.workflow.resolutions[0].status,'applied');
  assert.deepEqual(result.workflow.resolutions[0].sourceEventIds,['e2']);
});

test('final analysis resolves an earlier pending transition using a later explicit confirmation',async t=>{
  const dialog={...window,handle:222,title:'Confirmation'};
  const obs={id:'o1',eventType:'state_observation',timestampMs:150,window:dialog,screenshot:'screenshots/dialog.png'};
  const {options}=await fixture(t,{maxActionsPerRequest:1},[key('e1','ENTER',{screenshotAfter:null}),obs,
    key('e2','ENTER',{window:dialog,screenshotBeforeTimestampMs:190,screenshotAfterTimestampMs:210})]);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan({...payload,previousContext:null});
    if(payload.chunk.index===1){
      p.project=null;p.files=[];p.complete=false;p.operations[0].status='pending';p.operations[0].afterScreenshot=obs.screenshot;
      p.state={phase:'project_setup',pendingInput:'confirmation needed'};
    } else p.resolutions=[{operationId:'chunk-1-op-0',status:'applied',sourceEventIds:['e2'],screenshotFiles:payload.screenshotFiles}];
    return p;
  }));
  assert.equal(result.workflow.complete,true);assert.equal(result.build.generated,true);
  assert.equal(result.workflow.operations[0].status,'pending');
  assert.equal(result.evidenceResolution.chunks[0].unresolvedMissingEvidence.length,0);
  assert.equal(result.evidenceResolution.chunks[0].deferredConfirmations[0].confirmationChunk,2);
});

test('explicit offline reprocessing revalidates saved plans with zero client calls and preserves source output',async t=>{
  const {options,dir}=await fixture(t);
  await runQuartusAnalysis(options,clientFor(({payload})=>plan(payload)));
  const source=path.join(dir,'generated'),before=await fs.readFile(path.join(source,'analysis-status.json'),'utf8');
  let calls=0;
  const result=await runQuartusAnalysis({...options,reprocessFrom:source,output:path.join(dir,'offline')},
    clientFor(()=>{calls++;throw Error('Network forbidden');}));
  assert.equal(calls,0);assert.equal(result.apiRequests,0);assert.equal(result.build.generated,true);
  assert.equal(result.build.executed,false);assert.equal(await fs.readFile(path.join(source,'analysis-status.json'),'utf8'),before);
  const status=await read(path.join(dir,'offline/analysis-status.json'));
  assert.equal(status.mode,'offline-reprocess');assert.equal(status.requests,0);
  assert.equal((await fs.readdir(path.join(dir,'offline'))).includes('analysis-checkpoint.json'),false);
  await assert.rejects(()=>runQuartusAnalysis({...options,reprocessFrom:source,output:source}),/output|目标|目录/i);
  assert.equal(await fs.readFile(path.join(source,'analysis-status.json'),'utf8'),before);
});

test('a pending operation cannot be resolved using old screenshots as proof of Finish',async t=>{
  const {options}=await fixture(t,{maxActionsPerRequest:1,maxValidationRepairs:0});
  await assert.rejects(()=>runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan({...payload,previousContext:null});
    if(payload.chunk.index===1) {
      p.project=null;p.files=[];p.complete=false;p.operations[0].status='pending';
      p.state={phase:'project_setup',pendingInput:'wizard awaiting Finish'};
    } else p.resolutions=[{operationId:'chunk-1-op-0',status:'applied',sourceEventIds:payload.actions[0].sourceEventIds,screenshotFiles:['screenshots/e1-after.png']}];
    return p;
  })),/evidence|截图|resolution/i);
});

test('missing source content saves incomplete analysis and blocks project generation',async t=>{
  const {options}=await fixture(t);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan(payload);p.files[0].content=null;
    p.unresolved=[{description:'Visible filename does not provide source content',sourceEventIds:payload.actions[0].sourceEventIds}];return p;
  }));
  assert.equal(result.workflow.complete,false);assert.equal(result.build.generated,false);
});

test('navigation-only model output cannot fabricate an applied project build',async t=>{
  const {options}=await fixture(t);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan(payload);p.operations.forEach(op=>{op.kind='navigation';});return p;
  }));
  assert.equal(result.build.generated,false);assert.equal(result.build.status,'blocked');
});

test('unrepresented persistent input is retained as unresolved and blocks generation',async t=>{
  const {options}=await fixture(t);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{const p=plan(payload);p.operations.pop();return p;}));
  assert.equal(result.workflow.complete,false);assert.equal(result.build.generated,false);
  assert.ok(result.workflow.unresolved.some(u=>u.sourceEventIds.includes('e2')));
});

test('a later snapshot cannot silently discard uncovered earlier inputs',async t=>{
  const {options}=await fixture(t,{maxActionsPerRequest:2},[key('e1'),key('e2'),key('e3')]);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan(payload);if(payload.chunk.index===1)p.operations.pop();return p;
  }));
  assert.equal(result.workflow.complete,false);assert.equal(result.build.generated,false);
  assert.ok(result.workflow.unresolved.some(u=>u.sourceEventIds.includes('e2')));
});

test('missing before/after evidence and excluded groups keep otherwise valid plans incomplete',async t=>{
  for(const [settings,events] of [[{maxScreenshotsPerRequest:2},[key('e1'),key('e2')]],[{},[key('e1','ENTER',{screenshotBefore:null})]]]) {
    const {options}=await fixture(t,settings,events);
    const result=await runQuartusAnalysis(options,clientFor(({payload})=>plan(payload)));
    assert.equal(result.workflow.complete,false);assert.equal(result.build.generated,false);
    assert.ok(result.workflow.unresolved.length>0);
  }
});

test('a model-confirmed dialog Finish uses supplied transition evidence without replacing the original gap',async t=>{
  const observation={id:'o1',eventType:'state_observation',timestampMs:150,window:{...window,handle:222,title:'Opened project'},screenshot:'screenshots/finished.png'};
  const {options,dir}=await fixture(t,{},[key('e1','ENTER',{screenshotAfter:null}),observation]);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan(payload);p.operations[0].afterScreenshot=observation.screenshot;return p;
  }));
  assert.equal(result.workflow.complete,true);assert.equal(result.build.generated,true);
  const resolution=result.evidenceResolution.chunks[0];assert.equal(resolution.unresolvedMissingEvidence.length,0);
  assert.equal(resolution.resolvedTransitionEvidence[0].observationEventId,'o1');
  assert.equal(resolution.resolvedTransitionEvidence[0].status,'applied');
  const preparation=await read(path.join(dir,'generated/quartus-preparation.json'));
  assert.equal(preparation.chunks[0].actions[0].screenshotAfter,null);
  assert.equal(preparation.chunks[0].harness.evidenceHealth.missing.length,1);
  const audit=await read(path.join(dir,'generated/analysis-harness.json'));
  assert.equal(audit[0].harness.evidenceHealth.missing.length,1);
  assert.equal(audit[0].resolvedTransitionEvidence.length,1);
});

test('confirmed cancellation can resolve a transition gap while preserving an existing evidenced design',async t=>{
  const observation={id:'o1',eventType:'state_observation',timestampMs:250,window:{...window,handle:222,title:'Project Home'},screenshot:'screenshots/cancelled.png'};
  const {options}=await fixture(t,{},[key('e1'),key('e2','ESCAPE',{screenshotAfter:null}),observation]);
  const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
    const p=plan(payload);p.operations[1].status='cancelled';p.operations[1].kind='navigation';p.operations[1].afterScreenshot=observation.screenshot;return p;
  }));
  assert.equal(result.workflow.complete,true);assert.equal(result.build.generated,true);
  assert.equal(result.evidenceResolution.chunks[0].resolvedTransitionEvidence[0].status,'cancelled');
});

test('transition gaps remain blocking for missing before, unconfirmed, pending, unknown or foreign-window evidence',async t=>{
  for(const variant of ['missing-before','unreferenced','pending','unknown','foreign-process']) {
    const observation={id:'o1',eventType:'state_observation',timestampMs:150,
      window:{...window,handle:222,title:'Other window',processId:variant==='foreign-process'?99:window.processId},screenshot:'screenshots/transition.png'};
    const event=key('e1','ENTER',{screenshotAfter:null,...(variant==='missing-before'?{screenshotBefore:null}:{})});
    const {options}=await fixture(t,{},[event,observation]);
    const result=await runQuartusAnalysis(options,clientFor(({payload})=>{
      const p=plan(payload);
      if(['pending','unknown'].includes(variant))p.operations[0].status=variant;
      if(!['unreferenced','foreign-process'].includes(variant))p.operations[0].afterScreenshot=observation.screenshot;
      return p;
    }));
    assert.equal(result.workflow.complete,false,variant);assert.equal(result.build.generated,false,variant);
    assert.equal(result.evidenceResolution.chunks[0].resolvedTransitionEvidence.length,0,variant);
    assert.equal(result.evidenceResolution.chunks[0].unresolvedMissingEvidence.length,1,variant);
  }
});

test('transition resolver rejects unsupplied images, stale timing and mismatched input references',()=>{
  const action={sourceEventIds:['e1','e2'],endMs:100,screenshotBeforeTimestampMs:110,window,screenshotBefore:'before.png',screenshotAfter:null,
    transitionObservations:[{eventId:'o1',timestampMs:150,screenshot:'after.png',window:{...window,handle:222},relation:'same_process_changed_window_candidate'}]};
  const op={id:'op',sourceEventIds:['e1','e2'],status:'applied',beforeScreenshot:'before.png',afterScreenshot:'after.png'};
  const evidence={images:[{label:'before.png'},{label:'after.png'}],missing:[{eventIds:['e1','e2'],reason:'missing_before_or_after'}]};
  assert.equal(assessQuartusTransitionEvidence([action],[op],evidence).resolvedTransitionEvidence.length,1);
  for(const variant of ['unsupplied','stale','partial-input','wrong-before']) {
    const a=structuredClone(action),o=structuredClone(op),e=structuredClone(evidence);
    if(variant==='unsupplied')e.images.pop();if(variant==='stale')a.transitionObservations[0].timestampMs=105;
    if(variant==='partial-input')o.sourceEventIds=['e1'];if(variant==='wrong-before')o.beforeScreenshot='another.png';
    assert.equal(assessQuartusTransitionEvidence([a],[o],e).resolvedTransitionEvidence.length,0,variant);
  }
});

test('capture errors and orphaned target input prevent a complete restoration claim',async t=>{
  const orphan={...key('e2'),eventType:'mouse_down',button:'left',x:3,y:4};
  for(const event of [orphan,{id:'err',timestampMs:250,eventType:'capture_error',window,message:'synthetic capture failure'}]) {
    const {options}=await fixture(t,{},[key('e1'),event]);
    const result=await runQuartusAnalysis(options,clientFor(({payload})=>plan(payload)));
    assert.equal(result.workflow.complete,false);assert.equal(result.build.generated,false);
  }
});

test('wrong profile, only RDP input, duplicate event IDs and malformed arguments are refused',async t=>{
  const {options,dir}=await fixture(t);await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({applicationProfile:'pscad'}));
  await assert.rejects(()=>runQuartusAnalysis(options),/Quartus/);
  const remote=await fixture(t,{},[key('e1','ENTER',{window:{processName:'mstsc'}})]);
  await assert.rejects(()=>runQuartusAnalysis(remote.options,clientFor(()=>{throw Error('API forbidden');})),/没有 Quartus/);
  const duplicates=await fixture(t,{},[key('e1'),key('e1')]);
  await assert.rejects(()=>runQuartusAnalysis(duplicates.options),/重复/);
  assert.throws(()=>parseQuartusArgs(['--recording']),/无效/);
  assert.throws(()=>parseQuartusArgs(['--recording','somewhere','--execute']),/无效/);
});
