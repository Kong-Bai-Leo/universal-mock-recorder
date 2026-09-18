import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateQuartusWorkflow,mergeQuartusWorkflows,emptyQuartusWorkflow} from '../src/analyzer/lib/quartus-workflow.mjs';
import {compileQuartusProject,writeQuartusProjectArtifacts,quartusTclWord} from '../src/analyzer/lib/quartus-project.mjs';
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/quartus/synthetic-project.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(fixture);
const context={eventIds:['synthetic-e1'],screenshotFiles:['synthetic-before.png','synthetic-after.png']};
const temp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quartus-tests-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
test('strict data contract and source context accept synthetic project without promoting empty workflow',()=>{
  assert.equal(validateQuartusWorkflow(fresh(),context).complete,true);
  assert.equal(validateQuartusWorkflow(emptyQuartusWorkflow()).complete,false);
});
for(const [name,mutate] of [
  ['unknown field',w=>w.tcl='exec unsafe'],['assignment hook',w=>w.assignments[0].name='PRE_FLOW_SCRIPT_FILE'],
  ['path traversal',w=>w.files[0].path='../escaped.v'],['absolute source',w=>w.files[0].path='C:/secret.v'],
  ['Windows reserved source',w=>w.files[0].path='CON.v'],['Tcl project substitution',w=>w.project.name='x[exec calc]'],
  ['duplicate case path',w=>w.files.push({...w.files[0],path:'RECORDER_DEMO.v'})],['HDL include',w=>w.files[0].content='`include "../private.v"'],
  ['HDL system task',w=>w.files[0].content='module a; initial $system("cmd"); endmodule'],['foreign binding',w=>w.files[0].content='import "DPI-C" function void x();'],
  ['arbitrary IO Tcl',w=>w.assignments=[{name:'IO_STANDARD',target:'y',value:'[exec calc]',evidence:w.project.evidence}]],
  ['unbounded clock',w=>w.clocks=[{name:'clk',port:'a',periodNs:0,evidence:w.project.evidence}]],
  ['duplicate operation id',w=>w.operations.push({...w.operations[0]})],
])test(`reject ${name}`,()=>{const w=fresh();mutate(w);assert.throws(()=>validateQuartusWorkflow(w));});
test('reject unknown event and screenshot references',()=>{
  assert.throws(()=>validateQuartusWorkflow(fresh(),{...context,eventIds:['other']}),/evidence/);
  assert.throws(()=>validateQuartusWorkflow(fresh(),{...context,screenshotFiles:[]}),/screenshot/);
});
for(const [name,mutate] of [
  ['missing HDL',w=>w.files[0].content=null],['estimated value',w=>w.project.evidence.precision='estimated'],
  ['unresolved dependency',w=>w.unresolved=[{description:'Missing IP',sourceEventIds:['synthetic-e1']}]],
  ['pending operation',w=>w.operations[0].status='pending'],['pending state',w=>w.state.pendingInput='Device not confirmed'],
])test(`block native generation for ${name}`,()=>{const w=fresh();mutate(w);assert.equal(validateQuartusWorkflow(w).complete,false);assert.throws(()=>compileQuartusProject(w),/blocked/);});
test('state cannot build without applied edit provenance',()=>{const w=fresh();w.operations=[];assert.throws(()=>compileQuartusProject(w),/applied edit/);});
test('cumulative merge preserves final confirmed edits and concatenates history',()=>{
  const first=fresh(),second=fresh();second.project.top='updated_top';second.operations[0].id='op2';second.operations[0].kind='set_project';
  const merged=mergeQuartusWorkflows([first,second],context);assert.equal(merged.project.top,'updated_top');assert.equal(merged.operations.length,2);assert.equal(merged.complete,true);
  second.operations[0].kind='navigation';assert.equal(mergeQuartusWorkflows([first,second],context).complete,false);
});
test('later evidence resolves pending history without rewriting original status',()=>{
  const first=fresh(),second=fresh();first.operations[0].status='pending';first.complete=false;
  second.operations=[{...second.operations[0],id:'finish',kind:'save',sourceEventIds:['e2'],beforeScreenshot:'later-before.png',afterScreenshot:'later-after.png'}];
  second.resolutions=[{operationId:'synthetic-op1',status:'applied',sourceEventIds:['e2'],screenshotFiles:['later-after.png']}];
  const c={eventIds:[...context.eventIds,'e2'],screenshotFiles:[...context.screenshotFiles,'later-before.png','later-after.png']};
  const merged=mergeQuartusWorkflows([first,second],c);assert.equal(merged.complete,true);assert.equal(merged.operations[0].status,'pending');assert.equal(merged.resolutions[0].status,'applied');assert.doesNotThrow(()=>compileQuartusProject(merged));
  second.resolutions[0].sourceEventIds=['synthetic-e1'];assert.throws(()=>mergeQuartusWorkflows([first,second],c),/new event/);
});
test('wrong edit kind and unknown or screenshot-free resolutions cannot clear uncertainty',()=>{
  const first=fresh(),second=fresh();second.project.top='different';second.operations[0].id='o2';second.operations[0].kind='set_clock';
  assert.equal(mergeQuartusWorkflows([first,second]).complete,false);
  const w=fresh();w.resolutions=[{operationId:'missing',status:'applied',sourceEventIds:['synthetic-e1'],screenshotFiles:[]}];assert.throws(()=>validateQuartusWorkflow(w),/unknown operation/);
  w.operations[0].status='pending';w.resolutions[0].operationId=w.operations[0].id;assert.throws(()=>validateQuartusWorkflow(w),/screenshot/);
});
test('fixed compiler emits escaped bus pins, primary clocks and explicit readback',()=>{
  const w=fresh();w.assignments.push({name:'LOCATION',target:'bus[0]',value:'PIN_A1',evidence:w.project.evidence});
  w.clocks.push({name:'clock',port:'a',periodNs:10,evidence:w.project.evidence});
  const result=compileQuartusProject(w,{compile:true}),script=result.files.find(f=>f.path==='build.tcl').content;
  assert.match(script,/project_new/);assert.match(script,/project_open/);assert.match(script,/execute_flow -compile/);assert.match(script,/assert_source/);
  assert.ok(script.includes('bus\\[0\\]'));assert.ok(result.files.some(f=>f.path==='recorded-clocks.sdc'));
  assert.equal(quartusTclWord('$x[hi]'), '"\\$x\\[hi\\]"');
});
test('generation writes new artifacts but never claims native execution or overwrites',async t=>{
  const parent=await temp(t),dir=path.join(parent,'output');const report=await writeQuartusProjectArtifacts(dir,fresh());
  assert.equal(report.generated,true);assert.equal(report.executed,false);assert.equal(report.assignmentsVerified,false);assert.equal(report.logicalEquivalenceVerified,false);
  assert.equal(await fs.readFile(path.join(dir,'recorder_demo.v'),'utf8'),fixture.files[0].content);
  await assert.rejects(fs.access(path.join(dir,'recorder_demo.qpf')));
  await assert.rejects(writeQuartusProjectArtifacts(dir,fresh()),/EEXIST/);
  await assert.rejects(writeQuartusProjectArtifacts(path.join(parent,'compile'),fresh(),{compile:true}),/explicit execution/);
});
test('symlink/junction output ancestors are rejected',async t=>{
  const parent=await temp(t),real=path.join(parent,'real'),link=path.join(parent,'link');await fs.mkdir(real);
  try{await fs.symlink(real,link,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS disallows symlink creation');return;}throw e;}
  await assert.rejects(writeQuartusProjectArtifacts(path.join(link,'out'),fresh()),/symlinks/);
});
test('GUI build preserves the running application and guards the existing project',()=>{
  const script=compileQuartusProject(fresh(),{target:'gui'}).files.find(f=>f.path==='build.tcl').content;
  assert.match(script,/is_project_open/);assert.match(script,/cd \$recorder_previous_directory/);assert.ok(!/\bexit\b/.test(script));
});
const python=process.env.QUARTUS_TEST_PYTHON??(process.platform==='win32'?path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'):'python3');
for(const fault of ['', 'readback','source','content','compile','missing-report'])test(`real Tcl core with simulated Quartus APIs: ${fault||'success'}`,async t=>{
  const parent=await temp(t),dir=path.join(parent,'build');await fs.mkdir(dir);
  const w=fresh();w.clocks=[{name:'clk',port:'a',periodNs:10,evidence:w.project.evidence}];
  w.assignments.push({name:'LOCATION',value:'PIN_A1',target:'bus[0]',evidence:w.project.evidence},{name:'IO_STANDARD',value:'1.8 V',target:'bus[0]',evidence:w.project.evidence});
  const plan=compileQuartusProject(w,{compile:true});for(const f of plan.files)await fs.writeFile(path.join(dir,f.path),f.content);
  const helper=fileURLToPath(new URL('./fixtures/quartus/tcl-runtime.py',import.meta.url));
  const run=spawnSync(python,[helper,path.join(dir,'build.tcl'),fault],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(run.error?.code==='ENOENT'||run.status===77){t.skip('Tcl core test runtime unavailable');return;}
  if(!fault){assert.equal(run.status,0,run.stderr);const readback=JSON.parse(run.stdout.split('TEST_READBACK ')[1].trim());assert.equal(readback.assignmentChecks,plan.assignmentChecks);assert.equal(readback.logicalEquivalenceVerified,false);}
  else {assert.notEqual(run.status,0);assert.match(run.stderr,({readback:/Readback mismatch/,source:/Missing source assignment/,content:/source content/,compile:/Simulated compile failure/,'missing-report':/Compile returned without flow report/})[fault]);assert.ok(!run.stdout.includes('TEST_READBACK'));}
});
for(const fault of ['', 'readback','open-project'])test(`GUI Tcl with simulated Quartus: ${fault||'success'}`,async t=>{
  const parent=await temp(t),dir=path.join(parent,'gui');await fs.mkdir(dir);
  const plan=compileQuartusProject(fresh(),{target:'gui'});for(const f of plan.files)await fs.writeFile(path.join(dir,f.path),f.content);
  const helper=fileURLToPath(new URL('./fixtures/quartus/tcl-runtime.py',import.meta.url));
  const run=spawnSync(python,[helper,path.join(dir,'build.tcl'),fault],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(run.error?.code==='ENOENT'||run.status===77){t.skip('Tcl core test runtime unavailable');return;}
  if(!fault){assert.equal(run.status,0,run.stderr);assert.ok(run.stdout.includes('TEST_READBACK'));}
  else{assert.notEqual(run.status,0);assert.match(run.stderr,fault==='readback'?/Readback mismatch/:/close the current project first/);}
});
