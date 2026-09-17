import test from 'node:test';
import assert from 'node:assert/strict';
import {assessQuartusFinalTransitionEvidence} from '../src/analyzer/lib/quartus-trace.mjs';
import {emptyQuartusWorkflow} from '../src/analyzer/lib/quartus-workflow.mjs';

// Synthetic evidence only: no API, filesystem screenshots, or application run.
const wizard={processName:'quartus',processId:42,handle:101,title:'Wizard',x:20,y:30,width:600,height:500};
const editor={...wizard,handle:102,title:'Project editor'};
function fixture(status='applied',originalStatus='pending') {
  const original={sourceEventIds:['e1','e2'],startMs:100,endMs:110,window:wizard,
    screenshotBefore:'before.png',screenshotBeforeTimestampMs:105,screenshotAfter:null,
    observations:[],transitionObservations:[{eventId:'o1',timestampMs:120,screenshot:'transition.png',window:editor,
      relation:'same_process_changed_window_candidate',requiresVisualConfirmation:true}]};
  const confirmation={sourceEventIds:['e3'],startMs:200,endMs:200,window:editor,
    screenshotBefore:'later-before.png',screenshotBeforeTimestampMs:201,screenshotAfter:'later-after.png',screenshotAfterTimestampMs:210,
    observations:[{eventId:'o2',timestampMs:230,screenshot:'confirmed.png',window:editor}],transitionObservations:[]};
  const pending={id:'op1',kind:'create_project',summary:'Pending project wizard',sourceEventIds:['e1','e2'],
    beforeScreenshot:'before.png',afterScreenshot:'transition.png',status:originalStatus};
  const later={id:'op2',kind:'navigation',summary:'Later confirming action',sourceEventIds:['e3'],
    beforeScreenshot:'later-before.png',afterScreenshot:'later-after.png',status:'applied'};
  const resolution={operationId:'op1',status,sourceEventIds:['e3','o2'],screenshotFiles:['confirmed.png']};
  const evidence=[{images:[{label:'before.png'},{label:'transition.png'}],excluded:[],
    missing:[{eventIds:['e1','e2'],reason:'missing_before_or_after'}]},
  {images:[{label:'later-before.png'},{label:'later-after.png'},{label:'confirmed.png'}],excluded:[],missing:[]}];
  const plans=[{...emptyQuartusWorkflow(),operations:[pending]},{...emptyQuartusWorkflow(),operations:[later],resolutions:[structuredClone(resolution)]}];
  const completed=plans.map((plan,i)=>({index:i+1,plan,audit:{eventIds:i?['e3','o2']:['e1','e2','o1'],screenshotFiles:evidence[i].images.map(x=>x.label)}}));
  return {chunks:[[original],[confirmation]],completed,evidence,
    workflow:{...emptyQuartusWorkflow(),operations:[structuredClone(pending),structuredClone(later)],resolutions:[structuredClone(resolution)]}};
}
function assess(f) {
  const before=JSON.stringify(f);
  const result=assessQuartusFinalTransitionEvidence(f.chunks,f.completed,f.evidence,f.workflow);
  assert.equal(JSON.stringify(f),before,'Assessment must not mutate historical actions, plans, resolutions, or original gaps');
  assert.equal(result.format,'quartus-transition-evidence/1');
  assert.equal(result.chunks.length,f.chunks.length);
  return result;
}
function blocked(f,label) {
  const result=assess(f);
  assert.equal(result.chunks[0].unresolvedMissingEvidence.length,1,label);
  assert.equal(result.chunks[0].deferredConfirmations.length,0,label);
}
const changeResolution=(f,change)=>{change(f.completed[1].plan.resolutions[0]);change(f.workflow.resolutions[0]);};

test('later applied and cancelled resolutions close a pending gap without rewriting historical state',()=>{
  for(const status of ['applied','cancelled'])for(const originalStatus of ['pending','unknown']) {
    const f=fixture(status,originalStatus),result=assess(f);
    assert.equal(result.chunks[0].unresolvedMissingEvidence.length,0,`${originalStatus} -> ${status}`);
    assert.equal(result.chunks[0].deferredConfirmations.length,1);
    assert.equal(result.chunks[0].resolvedTransitionEvidence[0].operationId,'op1');
    assert.equal(result.chunks[0].resolvedTransitionEvidence[0].status,status);
    assert.equal(f.workflow.operations[0].status,originalStatus);
    assert.equal(f.chunks[0][0].screenshotAfter,null);
    assert.equal(f.evidence[0].missing.length,1);
  }
});

test('a later observation alone can be confirmation evidence without becoming an input action',()=>{
  const f=fixture();changeResolution(f,r=>{r.sourceEventIds=['o2'];});
  const result=assess(f);
  assert.equal(result.chunks[0].unresolvedMissingEvidence.length,0);
  assert.deepEqual(f.workflow.operations[0].sourceEventIds,['e1','e2']);
  assert.deepEqual(f.workflow.operations[1].sourceEventIds,['e3']);
});

test('the timestamped after frame of a later input can confirm the historical operation',()=>{
  const f=fixture();changeResolution(f,r=>{r.sourceEventIds=['e3'];r.screenshotFiles=['later-after.png'];});
  const result=assess(f);
  assert.equal(result.chunks[0].unresolvedMissingEvidence.length,0);
  assert.equal(result.chunks[0].deferredConfirmations.length,1);
});

test('no explicit later resolution or unknown resolution status cannot close the gap',()=>{
  for(const variant of ['none','not-in-completed','not-in-final','unknown','pending','wrong-operation']) {
    const f=fixture();
    if(variant==='none'){f.completed[1].plan.resolutions=[];f.workflow.resolutions=[];}
    if(variant==='not-in-completed')f.completed[1].plan.resolutions=[];
    if(variant==='not-in-final')f.workflow.resolutions=[];
    if(['unknown','pending'].includes(variant))changeResolution(f,r=>{r.status=variant;});
    if(variant==='wrong-operation')changeResolution(f,r=>{r.operationId='unknown-op';});
    blocked(f,variant);
  }
});

test('old, invented, empty or mixed evidence refs do not become a later confirmation',()=>{
  for(const refs of [[],['e1'],['o1'],['invented'],['e3','invented'],['e3','o1']]) {
    const f=fixture();changeResolution(f,r=>{r.sourceEventIds=refs;});
    blocked(f,JSON.stringify(refs));
  }
});

test('old or unselected confirmation images remain blocked even when another current image exists',()=>{
  for(const variant of ['old','old-in-current-selection','missing','empty','mixed-old','unselected']) {
    const f=fixture();
    if(variant==='old')changeResolution(f,r=>{r.screenshotFiles=['transition.png'];});
    if(variant==='old-in-current-selection') {
      changeResolution(f,r=>{r.screenshotFiles=['transition.png'];});
      f.evidence[1].images.push({label:'transition.png'});f.completed[1].audit.screenshotFiles.push('transition.png');
    }
    if(variant==='missing')changeResolution(f,r=>{r.screenshotFiles=['fabricated.png'];});
    if(variant==='empty')changeResolution(f,r=>{r.screenshotFiles=[];});
    if(variant==='mixed-old')changeResolution(f,r=>{r.screenshotFiles=['confirmed.png','transition.png'];});
    if(variant==='unselected')f.evidence[1].images=f.evidence[1].images.filter(x=>x.label!=='confirmed.png');
    blocked(f,variant);
  }
});

test('original operation must still cover both input events and explicitly retain before and transition images',()=>{
  for(const variant of ['partial-input','unknown-input','wrong-before','missing-before','wrong-after','missing-after']) {
    const f=fixture();
    for(const op of [f.completed[0].plan.operations[0],f.workflow.operations[0]]) {
      if(variant==='partial-input')op.sourceEventIds=['e1'];
      if(variant==='unknown-input')op.sourceEventIds=['e1','invented'];
      if(variant==='wrong-before')op.beforeScreenshot='wrong-before.png';
      if(variant==='missing-before')op.beforeScreenshot=null;
      if(variant==='wrong-after')op.afterScreenshot='wrong-after.png';
      if(variant==='missing-after')op.afterScreenshot=null;
    }
    blocked(f,variant);
  }
});

test('original window relation, selected before evidence and capture timing cannot be bypassed',()=>{
  for(const variant of ['no-before','before-unselected','transition-unselected','foreign-process','same-window','wrong-relation','stale-time','no-time']) {
    const f=fixture(),action=f.chunks[0][0],observation=action.transitionObservations[0];
    if(variant==='no-before')action.screenshotBefore=null;
    if(variant==='before-unselected')f.evidence[0].images=f.evidence[0].images.filter(x=>x.label!=='before.png');
    if(variant==='transition-unselected')f.evidence[0].images=f.evidence[0].images.filter(x=>x.label!=='transition.png');
    if(variant==='foreign-process')observation.window={...editor,processId:99};
    if(variant==='same-window')observation.window=wizard;
    if(variant==='wrong-relation')observation.relation='unknown';
    if(variant==='stale-time')observation.timestampMs=99;
    if(variant==='no-time')observation.timestampMs=null;
    blocked(f,variant);
  }
});

test('later confirming evidence must have the same target process and later timestamps',()=>{
  for(const variant of ['foreign-action','foreign-observation','old-action','old-observation','missing-time']) {
    const f=fixture(),action=f.chunks[1][0],observation=action.observations[0];
    if(variant==='foreign-action')action.window={...editor,processId:99};
    if(variant==='foreign-observation')observation.window={...editor,processId:99};
    if(variant==='old-action'){action.startMs=90;action.endMs=90;}
    if(variant==='old-observation')observation.timestampMs=95;
    if(variant==='missing-time')observation.timestampMs=null;
    blocked(f,variant);
  }
});

test('a valid current input reference cannot launder an unrelated or stale confirmation screenshot',()=>{
  for(const variant of ['foreign-image-window','old-image-time','missing-image-time']) {
    const f=fixture();changeResolution(f,r=>{r.sourceEventIds=['e3'];});
    const observation=f.chunks[1][0].observations[0];
    if(variant==='foreign-image-window')observation.window={...editor,processId:99};
    if(variant==='old-image-time')observation.timestampMs=95;
    if(variant==='missing-image-time')observation.timestampMs=null;
    blocked(f,variant);
  }
});

test('resolution in the original chunk is not a later confirmation',()=>{
  const f=fixture();f.completed[0].plan.resolutions=f.completed[1].plan.resolutions;f.completed[1].plan.resolutions=[];
  blocked(f,'not later');
});
