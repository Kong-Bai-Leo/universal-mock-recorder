import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {VIVADO_API_VERSION,validateVivadoProgram,mergeVivadoChunks} from '../src/analyzer/lib/vivado-program.mjs';
import {renderVivado,tclLiteral} from '../src/analyzer/lib/vivado-renderer.mjs';
import {buildVivadoReplayPlan} from '../src/analyzer/lib/vivado-replay-plan.mjs';
import {prepareVivadoEvidence,groupVivadoEvents} from '../src/analyzer/lib/vivado-evidence.mjs';
import {runVivadoAnalysis,recoverSavedCheckpoint} from '../src/analyzer/vivado-cli.mjs';
import {loadVivadoKnowledge} from '../src/analyzer/lib/vivado-knowledge.mjs';
const evidence={eventIds:['evt-001'],currentInputIds:['evt-001']};
const call=(command,receiverId,resultId,args)=>({id:'op-'+command,sourceEventIds:['evt-001'],timestampMs:1,stage:'committed',knowledgeIds:[],apiCall:{command,interfaceId:'vivado-tcl-'+command.replaceAll('_','-'),receiverId,resultId,arguments:args}});
export function fixture(){return {version:VIVADO_API_VERSION,complete:true,summary:'Observed blank RTL project',initialScene:{kind:'blank',evidenceIds:['evt-001']},
 operations:[call('create_project','','project-1',{name:'Smoke',part:'xc7a35tcpg236-1'}),call('set_property','project-1','',{name:'target_language',value:'VHDL'})],
 artifacts:[],decisions:[{sourceEventIds:['evt-001'],disposition:'modeled',reason:'project created'}],unresolved:[],finalScene:{kind:'observed',projectIds:['project-1'],evidenceIds:['evt-001']},commandState:{command:'',stage:'idle',pendingEventIds:[],selectionIds:[]}};}
test('explicit calls build internal JSON without claiming execution',()=>{const p=buildVivadoReplayPlan(fixture(),evidence);assert.equal(p.nativeVerification.status,'not_run');assert.equal(p.expectedState.objects[0].properties.target_language,'VHDL');});
test('reject missing or mismatched native call',()=>{const p=fixture();delete p.operations[0].apiCall;assert.throws(()=>validateVivadoProgram(p,evidence));const q=fixture();q.operations[0].apiCall.interfaceId='invented';assert.throws(()=>validateVivadoProgram(q,evidence));});
test('reject ghost objects and top property on project',()=>{const p=fixture();p.operations[1].apiCall.receiverId='future';assert.throws(()=>validateVivadoProgram(p,evidence),/not created/);const q=fixture();q.operations[1].apiCall.arguments={name:'top',value:'top'};assert.throws(()=>validateVivadoProgram(q,evidence),/fileset/);});
test('reject arbitrary paths, properties, commands and HDL paths',()=>{for(const value of ['../data','a;exit','NUL','a[exec]']){const p=fixture();p.operations[0].apiCall.arguments.name=value;assert.throws(()=>validateVivadoProgram(p,evidence));}const p=fixture();p.operations[1].apiCall.arguments.name='STEPS.SYNTH_DESIGN.TCL.PRE';assert.throws(()=>validateVivadoProgram(p,evidence));});
test('pending is separate from coverage but prevents final execution',()=>{const p=fixture();p.commandState.pendingEventIds=['evt-001'];validateVivadoProgram(p,evidence);assert.throws(()=>buildVivadoReplayPlan(p,evidence),/unfinished/);p.complete=false;assert.throws(()=>validateVivadoProgram(p,evidence),/conflict/);});
test('evidence and decision coverage cannot disappear',()=>{const p=fixture();p.decisions=[];assert.throws(()=>validateVivadoProgram(p,evidence),/coverage/);const q=fixture();q.operations[0].sourceEventIds=['unknown'];assert.throws(()=>validateVivadoProgram(q,evidence),/evidence/);});
test('chunk-local operation labels namespace without renaming project',()=>{const p=fixture(),q=fixture();p.operations.pop();q.initialScene.kind='continuation';q.operations.shift();q.operations[0].id=p.operations[0].id;const m=mergeVivadoChunks([p,q]);assert.equal(m.operations[1].apiCall.receiverId,'project-1');validateVivadoProgram(m,evidence);});
test('HDL content is required, identity stable, fileset top works',()=>{const p=fixture();p.artifacts=[{id:'source-1',name:'top.v',content:'module top(input a, output y); assign y=a; endmodule\n',precision:'exact',sourceEventIds:['evt-001']}];p.operations.push(call('add_files','project-1','',{fileset:'sources_1',artifactIds:['source-1']}),call('get_filesets','project-1','fileset-1',{name:'sources_1'}),{...call('set_property','fileset-1','',{name:'top',value:'top'}),id:'op-top'});validateVivadoProgram(p,{...evidence,final:true});p.artifacts[0].precision='unknown';assert.throws(()=>validateVivadoProgram(p,evidence),/unreadable/);});
test('run completion needs launch, source content and bounded wait',()=>{const p=fixture();p.operations.push(call('get_runs','project-1','run-1',{name:'synth_1'}),call('wait_on_runs','run-1','',{timeoutMinutes:5,expectedStatus:'synth_design Complete!'}));assert.throws(()=>validateVivadoProgram(p,evidence),/launched/);p.operations[3]=call('launch_runs','run-1','',{jobs:2});assert.throws(()=>validateVivadoProgram(p,evidence),/without captured source/);});
test('implementation requires design sources and completed synthesis; bitstream is unsupported',()=>{const p=fixture();p.artifacts=[{id:'source-1',name:'top.v',content:'module top; endmodule\n',precision:'exact',sourceEventIds:['evt-001']}];p.operations.push(call('add_files','project-1','',{fileset:'sim_1',artifactIds:['source-1']}),call('get_runs','project-1','run-1',{name:'impl_1'}),call('launch_runs','run-1','',{jobs:1}));assert.throws(()=>validateVivadoProgram(p,evidence),/sources_1/);p.operations[2].apiCall.arguments.fileset='sources_1';assert.throws(()=>validateVivadoProgram(p,evidence),/completed synthesis/);p.operations.pop();p.operations.push(call('wait_on_runs','run-1','',{timeoutMinutes:5,expectedStatus:'write_bitstream Complete!'}));assert.throws(()=>validateVivadoProgram(p,evidence),/invalid native call/);});
test('Tcl backend quotes substitution and rejects overwrite',()=>{const s=renderVivado(fixture(),evidence);assert.match(s,/open_project \$savedProject/);assert.match(s,/WRONLY CREAT EXCL/);assert.doesNotMatch(s,/-force/);assert.equal(tclLiteral('$x[exit]"\\\n'),'"\\$x\\[exit\\]\\"\\\\\\n"');});
test('pointer gestures stay together and incomplete ones rejected',()=>{assert.throws(()=>groupVivadoEvents([{eventType:'mouse_up'}]));assert.equal(groupVivadoEvents([{eventType:'mouse_down'},{eventType:'mouse_move'},{eventType:'mouse_up'}]).length,1);});
async function withRecording(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'vivado-test-'));try{await fs.mkdir(path.join(root,'screenshots'));await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({applicationProfile:'vivado',captureDeployment:'same-windows-session'}));await fs.writeFile(path.join(root,'screenshots/frame.jpg'),Buffer.from([255,216,255,217]));await fs.writeFile(path.join(root,'events.jsonl'),JSON.stringify({id:'evt-001',timestampMs:1,eventType:'key_down',key:'ENTER',window:{processName:'vivado'},screenshot:'screenshots/frame.jpg'}));await fs.writeFile(path.join(root,'config.json'),JSON.stringify({provider:{model:'test',imageDetail:'high'}}));return await fn(root);}finally{const real=await fs.realpath(root);assert.equal(path.dirname(real),await fs.realpath(os.tmpdir()));assert.ok(path.basename(real).startsWith('vivado-test-'));await fs.rm(real,{recursive:true});}}
test('evidence rejects outer RDP and pause intervals',()=>withRecording(async root=>{const p=await prepareVivadoEvidence(root);assert.equal(p.events.length,1);await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({applicationProfile:'vivado',captureDeployment:'outside-rdp'}));await assert.rejects(prepareVivadoEvidence(root),/VM/);}));
test('prepare never calls API; success always delivers one Tcl and reuses checkpoint',()=>withRecording(async recording=>{
 let calls=0;const client={analyze:async()=>{calls++;return fixture();},getUsageRecords:()=>[]};
 const opts={recording,config:path.join(recording,'config.json')};
 const prepared=await runVivadoAnalysis(opts,{client});assert.equal(prepared.status,'prepared_no_upload');assert.equal(calls,0);
 const report=JSON.parse(await fs.readFile(prepared.report,'utf8'));assert.equal(report.primaryOutput,'vivado-replay.tcl');
 assert.deepEqual((await fs.readdir(report.runDirectory)).filter(n=>n.endsWith('.tcl')),[]);
 const r=await runVivadoAnalysis({...opts,analyze:true},{client});
 assert.equal(r.status,'replay_script_generated_not_executed');assert.equal(calls,1);
 assert.equal(path.basename(r.primaryOutput),'vivado-replay.tcl');assert.equal(r.replayScript,r.primaryOutput);assert.equal(r.validationScript,r.primaryOutput);
 assert.equal(path.basename(path.dirname(r.plan)),'_internal');assert.equal(r.verification,'not_run');
 assert.match(await fs.readFile(r.primaryOutput,'utf8'),/create_project "Smoke"/);
 await runVivadoAnalysis({...opts,analyze:true,exportValidationTcl:true},{client});assert.equal(calls,1);
 assert.deepEqual((await fs.readdir(report.runDirectory)).filter(n=>n.endsWith('.tcl')),['vivado-replay.tcl']);
}));
test('failed requests require explicit retry and never auto-loop',()=>withRecording(async recording=>{let calls=0;const client={analyze:async()=>{calls++;throw Error('network test');},getUsageRecords:()=>[]};const opts={recording,config:path.join(recording,'config.json')};await runVivadoAnalysis(opts,{client});await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/network/);await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/retry-failed/);assert.equal(calls,1);}));

test('explicit same-run retry receives original validation error without automatic paid loops',()=>withRecording(async recording=>{
 let calls=0;const opts={recording,config:path.join(recording,'config.json')};
 const client={getUsageRecords:()=>[],analyze:async({payload})=>{
  calls++;const p=fixture();if(calls===1)p.commandState.selectionIds=['evt-001'];
  else {assert.match(payload.repairFeedback.validationError,/unknown selection/);assert.deepEqual(payload.repairFeedback.previousInvalidResult.commandState.selectionIds,['evt-001']);}
  await client.onResponse({id:'fake-retry-'+calls,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
 }};
 await runVivadoAnalysis(opts,{client});await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/unknown selection/);assert.equal(calls,1);
 const result=await runVivadoAnalysis({...opts,analyze:true,retryFailed:true},{client});assert.equal(result.status,'replay_script_generated_not_executed');assert.equal(calls,2);
}));

test('saved complete provider response compiles standalone Tcl offline without configuration or API',()=>withRecording(async recording=>{
 let calls=0;const client={getUsageRecords:()=>[],analyze:async()=>{
  calls++;const p=fixture();
  await client.onResponse({id:'fake-completed',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
 }};
 const opts={recording,config:path.join(recording,'config.json')};await runVivadoAnalysis(opts,{client});
 const generated=await runVivadoAnalysis({...opts,analyze:true},{client});
 const sourceRun=path.dirname(generated.primaryOutput);
 const priorFiles=await fs.readdir(sourceRun);const before=await Promise.all(priorFiles.filter(n=>n.endsWith('-provider.json')).map(n=>fs.readFile(path.join(sourceRun,n),'utf8')));
 const offline=await runVivadoAnalysis({recording,compileSavedRun:sourceRun,config:path.join(recording,'does-not-exist.json')},{client:{analyze:()=>assert.fail('offline must not call API')}});
 assert.equal(offline.status,'saved_replay_script_generated_not_executed');assert.equal(offline.requestsThisRound,0);assert.equal(calls,1);
 assert.equal(path.basename(offline.primaryOutput),'vivado-replay.tcl');assert.notEqual(offline.primaryOutput,generated.primaryOutput);
 assert.match(await fs.readFile(offline.primaryOutput,'utf8'),/open_project \$savedProject/);
 assert.deepEqual(await Promise.all(priorFiles.filter(n=>n.endsWith('-provider.json')).map(n=>fs.readFile(path.join(sourceRun,n),'utf8'))),before);
}));

test('incomplete final plan cannot publish a runnable Tcl',()=>withRecording(async recording=>{
 const client={getUsageRecords:()=>[],analyze:async()=>{const p=fixture();p.commandState.pendingEventIds=['evt-001'];return p;}};
 const opts={recording,config:path.join(recording,'config.json')};const prepared=await runVivadoAnalysis(opts,{client});
 await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/unfinished/);
 const report=JSON.parse(await fs.readFile(prepared.report,'utf8'));
 assert.deepEqual((await fs.readdir(report.runDirectory)).filter(n=>n.endsWith('.tcl')),[]);
}));

test('HDL replay embeds exact source instead of requiring a separate source or JSON file',()=>{
 const p=fixture();const content='module top(input a, output y); assign y=a; endmodule\n';
 p.artifacts=[{id:'source-1',name:'top.v',content,precision:'exact',sourceEventIds:['evt-001']}];
 p.operations.push(call('add_files','project-1','',{fileset:'sources_1',artifactIds:['source-1']}));
 const script=renderVivado(p,evidence);
 assert.ok(script.includes('puts -nonewline $fp '+tclLiteral(content)));
 assert.match(script,/Tools > Run Tcl Script/);
 assert.doesNotMatch(script,/replay-plan\.json|\.env|https?:\/\//);
});

test('explicit recovery reuses verified paid chunks and gives failed chunk feedback; rejects tampering',()=>withRecording(async recording=>{
 const events=Array.from({length:61},(_,i)=>({id:`evt-${i+1}`,timestampMs:i+1,eventType:'key_down',key:'TAB',window:{processName:'vivado'},screenshot:'screenshots/frame.jpg'}));
 await fs.writeFile(path.join(recording,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
 const opts={recording,config:path.join(recording,'config.json')};let calls=0;
 const client={getUsageRecords:()=>[],analyze:async({payload})=>{
  assert.ok(payload.interfaceBindingRules);assert.match(payload.interfaceBindingRules.createProjectReceiverId,/empty string/);
  calls++;const p=fixture();p.initialScene={kind:calls===1?'blank':'continuation',evidenceIds:[payload.inputs[0].id]};p.operations=[];
  p.finalScene={kind:'unknown',projectIds:[],evidenceIds:[payload.inputs.at(-1).id]};
  p.decisions=[{sourceEventIds:payload.inputs.map(e=>e.id),disposition:'deferred',reason:'wizard pending'}];
  p.commandState={command:'create_project',stage:'pending',pendingEventIds:payload.inputs.map(e=>e.id),selectionIds:calls===2?[payload.inputs[0].id]:[]};
  await client.onResponse({id:`fake-${calls}`,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(p)}]}]});return p;
 }};
 await runVivadoAnalysis(opts,{client});await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/unknown selection/);assert.equal(calls,2);
 const report=JSON.parse(await fs.readFile(path.join(recording,'generated-vivado/prepare-report.json'),'utf8'));
 const statusBefore=await fs.readFile(path.join(report.runDirectory,'status.json'),'utf8');
 await assert.rejects(runVivadoAnalysis({...opts,analyze:true},{client}),/retry-failed/);
 assert.equal(await fs.readFile(path.join(report.runDirectory,'status.json'),'utf8'),statusBefore);
 const evidence=await prepareVivadoEvidence(recording),knowledge=await loadVivadoKnowledge(process.cwd());
 const provider={model:'test',imageDetail:'high',maxRetries:0,maxRequestBytes:8*1024*1024};
 const recovered=await recoverSavedCheckpoint(report.runDirectory,path.dirname(report.runDirectory),{identity:'new'},evidence,knowledge,provider);
 assert.equal(recovered.completed.length,1);assert.equal(recovered.provenance.reused[0].responseId,'fake-1');assert.match(recovered.repairFeedback.validationError,/unknown selection/);assert.equal(calls,2);
 assert.match(recovered.repairFeedback.rule,/initialScene.kind must be continuation/);assert.match(recovered.repairFeedback.rule,/receiverId as the empty string/);
 const chained=path.join(path.dirname(report.runDirectory),'second-harness');await fs.mkdir(chained);
 await fs.writeFile(path.join(chained,'checkpoint.json'),JSON.stringify(recovered));
 await fs.writeFile(path.join(chained,'status.json'),JSON.stringify({identity:'new',status:'budget_paused'}));
 await fs.writeFile(path.join(chained,'resume-provenance.json'),JSON.stringify(recovered.provenance));
 const again=await recoverSavedCheckpoint(chained,path.dirname(chained),{identity:'third'},evidence,knowledge,provider);
 assert.equal(again.completed.length,1);assert.equal(again.provenance.reused[0].responseId,'fake-1');assert.equal(calls,2);
 const file=(await fs.readdir(report.runDirectory)).find(n=>n.startsWith('001-')&&n.endsWith('-parsed.json'));
 const parsed=JSON.parse(await fs.readFile(path.join(report.runDirectory,file),'utf8'));parsed.summary='tampered';await fs.writeFile(path.join(report.runDirectory,file),JSON.stringify(parsed));
 await assert.rejects(recoverSavedCheckpoint(report.runDirectory,path.dirname(report.runDirectory),{identity:'new'},evidence,knowledge,provider),/does not match provider/);
}));
