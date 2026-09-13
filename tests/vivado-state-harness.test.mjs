import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFixture,call,topState,topTransaction} from './fixtures/vivado.mjs';
import {validateVivadoProgram,mergeVivadoChunks,vivadoPreviousContext} from '../src/analyzer/lib/vivado-program.mjs';
import {VIVADO_STATE_RULES} from '../src/analyzer/lib/vivado-state-harness.mjs';
import {renderVivado} from '../src/analyzer/lib/vivado-renderer.mjs';
const events=[1,2,3].map(n=>({id:'evt-00'+n,timestampMs:n*100,frames:[{label:'screenshots/evt-00'+n+'.jpg',capturedAtMs:n*100+10,role:n===3?'screenshotBefore':'screenshotAfter'}]}));
const evidence={eventIds:events.map(e=>e.id),events};
const topPlan=()=>{const p=projectFixture();p.operations.push(call('set-top','set_property','fs','',{name:'top',value:'child'},['evt-002'],200));p.topTransactions=[{...topTransaction('set-top','fs','child',['evt-002']),before:topState('parent','evt-001'),after:topState('child','evt-003')}];p.decisions.push({sourceEventIds:['evt-002'],disposition:'modeled',reason:'Set as Top'});return p;};

test('later next-input before frame confirms changed top without tree reordering',()=>{validateVivadoProgram(topPlan(),{...evidence,final:true});assert.match(VIVADO_STATE_RULES.topIdentity,/Tree order/);assert.match(VIVADO_STATE_RULES.asynchronous,/next input BEFORE/);});
test('catalogued native interface knowledge IDs are accepted, invented IDs are rejected',()=>{
 const p=topPlan();p.operations.at(-1).knowledgeIds=['vivado-tcl-set-property'];validateVivadoProgram(p,{...evidence,knowledgeIds:[]});
 p.operations.at(-1).knowledgeIds.push('vivado-tcl-exec');assert.throws(()=>validateVivadoProgram(p,{...evidence,knowledgeIds:[]}),/unknown knowledge ID: vivado-tcl-exec/);
});
test('incidental navigation can supply confirmation evidence, not replace the modeled trigger',()=>{
 const p=topPlan();p.topTransactions[0].sourceEventIds.push('evt-003');p.operations.at(-1).sourceEventIds.push('evt-003');
 p.decisions.push({sourceEventIds:['evt-003'],disposition:'navigation',reason:'Open context menu in preparation for Set as Top; no activation yet'});
 validateVivadoProgram(p,evidence);
 p.decisions[1].disposition='navigation';assert.throws(()=>validateVivadoProgram(p,evidence),/cancelled\/navigation/);
});
test('merely opening a Set as Top menu is not an attempted state change',()=>{
 const p=projectFixture();p.decisions.push({sourceEventIds:['evt-002'],disposition:'navigation',reason:'Open menu containing Set as Top, no activation'});
 validateVivadoProgram(p,evidence);
 p.decisions[1].disposition='cancelled';assert.throws(()=>validateVivadoProgram(p,evidence),/omitted/);
});
test('updating observation cannot stand in for committed stable top',()=>{const p=topPlan();p.topTransactions[0].after.stability='updating';assert.throws(()=>validateVivadoProgram(p,evidence),/updating/);});
test('missing indicator, fabricated frame and pre-trigger after frame are rejected',()=>{for(const change of [p=>p.topTransactions[0].after.indicator='unknown',p=>p.topTransactions[0].after.frames[0].imageLabel='invented.jpg',p=>p.topTransactions[0].after=topState('child','evt-001')]){const p=topPlan();change(p);assert.throws(()=>validateVivadoProgram(p,evidence));}});
test('wrong top value, missing call and contradictory cancelled decision are rejected',()=>{for(const change of [p=>p.topTransactions[0].after.module='wrong',p=>p.topTransactions[0].operationId='ghost',p=>p.decisions[1].disposition='cancelled']){const p=topPlan();change(p);assert.throws(()=>validateVivadoProgram(p,evidence));}});
test('admitted Set as Top cannot be omitted as an unverified cancellation',()=>{const p=projectFixture();p.decisions.push({sourceEventIds:['evt-002'],disposition:'cancelled',reason:'Set as Top menu disappeared'});assert.throws(()=>validateVivadoProgram(p,evidence),/omitted/);});
test('changed stable top contradicts both no-effect and cancelled even with a frame',()=>{for(const status of ['no_effect','cancelled']){const p=topPlan();p.operations.pop();p.decisions[1].disposition='cancelled';Object.assign(p.topTransactions[0],{status,operationId:'',cancelEvidence:[{eventId:'evt-003',imageLabel:'screenshots/evt-003.jpg'}]});assert.throws(()=>validateVivadoProgram(p,evidence));}});
test('no-effect requires stable identical states; cancellation requires explicit evidence',()=>{const p=topPlan();p.operations.pop();p.decisions[1].disposition='cancelled';Object.assign(p.topTransactions[0],{status:'no_effect',operationId:'',after:topState('parent','evt-003')});validateVivadoProgram(p,evidence);p.topTransactions[0].status='cancelled';assert.throws(()=>validateVivadoProgram(p,evidence),/explicit evidence/);});
test('cross-chunk pending survives context and resolves using original trigger',()=>{const p=topPlan();p.operations.pop();p.topTransactions[0].status='pending';p.topTransactions[0].operationId='';p.topTransactions[0].after=topState('','evt-002','updating');p.commandState.pendingEventIds=['evt-002'];p.decisions[1].disposition='deferred';const catalog=validateVivadoProgram(p,evidence);assert.equal(vivadoPreviousContext([p],catalog).pendingTopTransactions.length,1);const q=topPlan();q.initialScene.kind='continuation';q.operations=q.operations.slice(-1);q.decisions=q.decisions.slice(-1);const merged=mergeVivadoChunks([p,q]);validateVivadoProgram(merged,{...evidence,final:true});assert.equal(vivadoPreviousContext([p,q],catalog).pendingTopTransactions.length,0);assert.equal(merged.topTransactions[1].operationId,merged.operations.at(-1).id);});

function built(){const p=projectFixture();p.artifacts=[{id:'a',name:'top.v',precision:'exact',sourceEventIds:['evt-001'],content:'module top; endmodule\n'}];p.operations.push(call('add','add_files','p','',{fileset:'sources_1',artifactIds:['a']}),call('synth','get_runs','p','s',{name:'synth_1'}),call('launch','launch_runs','s','',{jobs:1}),call('wait','wait_on_runs','s','',{timeoutMinutes:5,expectedStatus:'synth_design Complete!'}));return p;}
function changeTop(p){p.operations.push(call('changed','set_property','fs','',{name:'top',value:'other'}));p.topTransactions.push(topTransaction('changed','fs','other'));}
test('top change invalidates completed synthesis and blocks implementation',()=>{const p=built();changeTop(p);assert.equal(validateVivadoProgram(p,evidence).objects.find(o=>o.id==='s').state,'stale');p.operations.push(call('impl','get_runs','p','i',{name:'impl_1'}),call('launch-i','launch_runs','i','',{jobs:1}));assert.throws(()=>validateVivadoProgram(p,evidence),/current design revision/);});
test('changed then restored top does not resurrect old synthesis',()=>{const p=built();changeTop(p);p.operations.push(call('restored','set_property','fs','',{name:'top',value:'top'}));p.topTransactions.push(topTransaction('restored','fs','top'));assert.throws(()=>validateVivadoProgram(p,{...evidence,final:true}),/current design revision/);});
test('source addition invalidates synthesis, simulation-only source does not',()=>{for(const fileset of ['sources_1','sim_1']){const p=built();p.artifacts.push({id:'b',name:'other.v',precision:'exact',sourceEventIds:['evt-001'],content:'module other; endmodule\n'});p.operations.push(call('add2','add_files','p','',{fileset,artifactIds:['b']}));assert.equal(validateVivadoProgram(p,evidence).objects.find(o=>o.id==='s').state,fileset==='sources_1'?'stale':'completed');}});
test('input change during launched run is rejected',()=>{const p=built();p.operations.pop();changeTop(p);assert.throws(()=>validateVivadoProgram(p,evidence),/run is active/);});
test('same-identity read-only query preserves properties, completed/stale state and revisions',()=>{
 const p=built();changeTop(p);const before=validateVivadoProgram(p,evidence);
 p.operations.push(call('read-fileset-again','get_filesets','p','fs',{name:'sources_1'}),call('read-run-again','get_runs','p','s',{name:'synth_1'}));
 assert.deepEqual(validateVivadoProgram(p,evidence),before);
 assert.equal(before.objects.find(o=>o.id==='s').state,'stale');
 assert.throws(()=>validateVivadoProgram(p,{...evidence,final:true}),/current design revision/);
 const ready=built();const readyBefore=validateVivadoProgram(ready,evidence);ready.operations.push(call('read-run','get_runs','p','s',{name:'synth_1'}));assert.deepEqual(validateVivadoProgram(ready,evidence),readyBefore);
});
test('re-query cannot alias, retype or overwrite a logical object',()=>{
 for(const [id,command,name] of [['other','get_filesets','sources_1'],['fs','get_runs','synth_1'],['p','get_runs','synth_1']]){
  const p=projectFixture();p.operations.push(call('query-again',command,'p',id,{name}));assert.throws(()=>validateVivadoProgram(p,evidence),/alias|duplicate/);
 }
});
test('renderer checks current synthesis before implementation and run freshness after reopen',()=>{const p=built();p.operations.push(call('impl','get_runs','p','i',{name:'impl_1'}),call('launch-i','launch_runs','i','',{jobs:1}),call('wait-i','wait_on_runs','i','',{timeoutMinutes:5,expectedStatus:'route_design Complete!'}));const script=renderVivado(p,evidence);assert.match(script,/NEEDS_REFRESH \$synthesisRun/);assert.match(script,/Reopened run is incomplete or obsolete/);assert.doesNotMatch(script,/set_property NEEDS_REFRESH false|reset_run/);});
