import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadStataKnowledge,retrieveStataKnowledge} from '../src/analyzer/lib/stata-knowledge.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(root,'ui-maps/stata/18/en-US');
test('Stata partial live map has complete parent chains without leaking session coordinates into static controls',async()=>{
  const knowledge=await loadStataKnowledge(root);
  const index=JSON.parse(await fs.readFile(path.join(base,'ui-index.json'),'utf8'));
  const report=JSON.parse(await fs.readFile(path.join(base,'verification-report.json'),'utf8'));
  assert.equal(knowledge.verification,'live_partial_scan');
  assert.equal(index.sections.length,report.sectionCount);
  assert.equal(knowledge.controls.length,report.controlCount);
  assert.equal(report.fullUiCoverage,false);
  assert.equal(report.nativeReplay,'not_run');
  const byId=new Map(knowledge.controls.map(c=>[c.id,c]));
  for(const c of knowledge.controls){
    assert.equal('bounds' in c,false,c.id);
    assert.equal('automationId' in c,false,c.id);
    const seen=new Set([c.id]);
    for(let parent=c.parentId;parent;parent=byId.get(parent).parentId){
      assert.ok(byId.has(parent),parent);
      assert.equal(seen.has(parent),false,`cyclic parent for ${c.id}`);
      seen.add(parent);
    }
  }
  const observation=JSON.parse(await fs.readFile(path.join(base,index.observation),'utf8'));
  assert.equal(observation.frame.reuseAsReplayCoordinates,false);
  for(const item of observation.observations){
    if(item.controlId)assert.ok(byId.has(item.controlId));
    for(const [id,box] of item.regions||[]){assert.ok(byId.has(id),id);assert.equal(box.length,4);}
  }
});
test('Stata retrieval without UI Automation retains role-specific fields and explicit verification limits',async()=>{
  const knowledge=await loadStataKnowledge(root);
  const result=retrieveStataKnowledge(knowledge,[],null);
  const byId=new Map(result.controls.map(c=>[c.id,c]));
  for(const id of ['stata.data-editor.grid','stata.summary.variables','stata.regression.y','stata.regression.x',
    'stata.main.statistics.summaries.descriptive.summary','stata.main.statistics.linear.regression'])assert.ok(byId.has(id),id);
  for(const c of result.controls)if(c.parentId)assert.ok(byId.has(c.parentId),c.parentId);
  assert.match(byId.get('stata.regression.y').function,/Y variable/);
  assert.match(byId.get('stata.regression.x').function,/X variable/);
  assert.equal(result.apiCatalog.status,'documented_not_live_verified');
  assert.match(result.unmatchedRule,/not tested command execution/);
});
test('Stata uninspected icons and Do-file Editor dropdown stay unknown, not silently assigned native commands',async()=>{
  const knowledge=await loadStataKnowledge(root);
  const unknown=knowledge.controls.filter(c=>c.verification==='live_observed_function_unknown');
  assert.equal(unknown.length,7);
  for(const c of unknown){assert.equal(c.canonicalName,undefined);assert.equal(c.core,false);assert.equal(c.label,'');}
});
test('Stata Do-file Editor map distinguishes observed execution entries from actual execution',async()=>{
  const knowledge=await loadStataKnowledge(root),byId=new Map(knowledge.controls.map(c=>[c.id,c]));
  assert.equal(byId.get('stata.main.window.do-file-editor.new').shortcut,'Ctrl+9');
  assert.equal(byId.get('stata.do-file-editor.text').verification,'live_observed_blank');
  assert.equal(byId.get('stata.do-file-editor.file.save').shortcut,'Ctrl+S');
  assert.equal(byId.get('stata.do-file-editor.file.save-project').enabled,false);
  assert.equal(byId.get('stata.do-file-editor.tools').verification,'live_observed_first_level');
  const actions=knowledge.controls.filter(c=>c.parentId==='stata.do-file-editor.tools');
  assert.equal(actions.length,7);
  for(const action of actions){assert.equal(action.enabled,false);assert.equal(action.verification,'live_observed_disabled');}
  assert.equal(byId.get('stata.do-file-editor.tools.do').shortcut,'Ctrl+D');
  assert.equal(byId.get('stata.do-file-editor.file.open.document').shortcut,'Ctrl+O');
  assert.equal(byId.get('stata.do-file-editor.open-dialog.cancel').verification,'live_observed_executed');
  assert.equal(byId.get('stata.do-file-editor.open-dialog.open').verification,'live_observed_not_executed');
});
