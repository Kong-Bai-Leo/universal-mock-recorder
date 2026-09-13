import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {loadVivadoKnowledge, validateVivadoKnowledge, retrieveVivadoKnowledge,vivadoStateKnowledge,vivadoKnowledgeIds} from "../src/analyzer/lib/vivado-knowledge.mjs";
import {projectFixture} from './fixtures/vivado.mjs';
import {validateVivadoProgram} from '../src/analyzer/lib/vivado-program.mjs';

const root = fileURLToPath(new URL("../",import.meta.url));
const original = await loadVivadoKnowledge(root);
const copy = () => structuredClone(original);
test('knowledge citations include documented commands and sources without accepting invented IDs',()=>{
 const ids=vivadoKnowledgeIds(original),p=projectFixture();p.operations[0].knowledgeIds=['vivado-tcl-create-project','amd-create-project'];
 validateVivadoProgram(p,{eventIds:['evt-001'],knowledgeIds:ids});
 p.operations[0].knowledgeIds.push('amd-fabricated-source');assert.throws(()=>validateVivadoProgram(p,{eventIds:['evt-001'],knowledgeIds:ids}),/unknown knowledge ID/);
 assert.ok(ids.includes('amd-get-runs'));assert.ok(ids.includes('vivado-sources-top-icon'));
});

test("Vivado map is internally consistent without claiming complete coverage or replay", () => {
  const result = validateVivadoKnowledge(original);
  assert.equal(result.controls,203);
  assert.equal(result.commands,7);
  assert.equal(result.coverageStatus,"partial");
  assert.equal(result.replayBackend,"bounded_native_plan_offline_tested");
  assert.ok(original.controls.every(c => c.automationId === null));
});

test("same Add Files label retains source and constraint parents", () => {
  const result = retrieveVivadoKnowledge(original,{texts:["Add Files"]});
  for (const id of ["vivado-source-button-0","vivado-constraints-button-0","vivado-source-menu-0"]) {
    const c = result.controls.find(c=>c.id===id);
    assert.ok(c); assert.equal(c.matchStatus,"candidate_only");
    assert.equal(c.breadcrumb.at(-1).id,id);
  }
  assert.notDeepEqual(result.controls[0].breadcrumb,result.controls[1].breadcrumb);
  const menu = result.controls.find(c=>c.id==="vivado-source-menu-0");
  assert.equal(menu.breadcrumb.at(-2).id,"vivado-source-add-menu");
  assert.ok(result.commands.some(c=>c.canonicalName==="add_files"));
});

test("explicit map ID and icon-only hierarchy do not imply Automation ID", () => {
  const result = retrieveVivadoKnowledge(original,{controlIds:["vivado-settings-device-browse","not-real"]});
  assert.equal(result.controls[0].parentId,"vivado-settings-device");
  assert.equal(result.controls[0].retrievalReason,"requested_map_id_not_automation_id");
  assert.deepEqual(result.unknownControlIds,["not-real"]);
});

test("unknown and single-character inputs invent no button/command", () => {
  for(const texts of [[],["i"],["C"],["totally_unknown_function_98765"]]) {
    const result=retrieveVivadoKnowledge(original,{texts});
    assert.equal(result.controls.length,0); assert.equal(result.commands.length,0);
  }
});

test("bounded retrieval reports excluded candidates rather than claiming all supplied", () => {
  const result=retrieveVivadoKnowledge(original,{texts:["Settings","Run Synthesis","Run Implementation","Add Files"],maxControls:1,maxCommands:1});
  assert.equal(result.controls.length,1);
  assert.ok(result.omittedForBudget.controlIds.length>0);
  assert.ok(result.commands.length<=1);
  for(const c of result.commands) for(const id of c.sourceIds) assert.ok(result.sources.some(s=>s.id===id));
  assert.throws(()=>retrieveVivadoKnowledge(original,{maxControls:Infinity}));
});

test("canonical wait API retains asynchronous and GUI limitations", () => {
  const result=retrieveVivadoKnowledge(original,{texts:["wait_on_runs"]});
  const command=result.commands.find(c=>c.canonicalName==="wait_on_runs");
  assert.ok(command);
  assert.equal(command.interfaceKind,"native_tcl");
  assert.match(command.description,/GUI/);
  assert.match(command.completion,/PROGRESS/);
  assert.equal(command.replayStatus,"implemented_offline_not_native_verified");
});

test("launch retrieval also offers run lookup and completion verification, with explicit budget omissions", () => {
  const result=retrieveVivadoKnowledge(original,{texts:["Run Synthesis"]});
  assert.deepEqual(result.commands.map(c=>c.canonicalName),["launch_runs","get_runs","wait_on_runs"]);
  const bounded=retrieveVivadoKnowledge(original,{texts:["launch_runs"],maxCommands:1});
  assert.equal(bounded.commands[0].canonicalName,"launch_runs");
  assert.ok(bounded.omittedForBudget.commandIds.includes("vivado-tcl-wait-on-runs"));
  const k=copy(); k.commands[0].companionCommandIds=["fake"];
  assert.throws(()=>validateVivadoKnowledge(k),/companion command/);
});

test("reject duplicate IDs, broken parent links and cycles", () => {
  let k=copy(); k.controls.push(k.controls[0]); assert.throws(()=>validateVivadoKnowledge(k),/duplicate/);
  k=copy(); k.controls[0].parentId="missing"; assert.throws(()=>validateVivadoKnowledge(k),/parent/);
  k=copy(); k.controls[0].parentId=k.controls[0].id; assert.throws(()=>validateVivadoKnowledge(k),/cycle/);
});

test("reject fabricated sources, observations, command links and static pixel coordinates", () => {
  let k=copy(); k.controls[0].sourceIds=["fake"]; assert.throws(()=>validateVivadoKnowledge(k),/source/);
  k=copy(); k.controls.find(c=>c.observationStatus==='observed').observationIds=[]; assert.throws(()=>validateVivadoKnowledge(k),/observation required/);
  k=copy(); k.commands[0].relatedControlIds=["fake"]; assert.throws(()=>validateVivadoKnowledge(k),/related control/);
  k=copy(); k.controls[0].bounds=[1,2,3,4]; assert.throws(()=>validateVivadoKnowledge(k),/live observations/);
});

test("loader refuses paths outside the versioned map root", async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"vivado-map-unit-"));
  try {
    const base=path.join(temp,"ui-maps/vivado/2024.2/en-US"); await fs.mkdir(base,{recursive:true});
    await fs.writeFile(path.join(base,"index.json"),JSON.stringify({...original.index,sections:[{id:"bad",path:"../../../../secret.json"}]}));
    await assert.rejects(loadVivadoKnowledge(temp),/unsafe map path/);
  } finally {
    const resolved=await fs.realpath(temp), tempRoot=await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(resolved),tempRoot);
    assert.ok(path.basename(resolved).startsWith("vivado-map-unit-"));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});

test('UIA-free state bundle contains documented top menu/icon without claiming a click',()=>{
 const bundle=vivadoStateKnowledge(original);
 assert.equal(bundle.controls.length,3);
 assert.ok(bundle.controls.some(c=>c.id==='vivado-sources-set-as-top'&&c.parentId==='vivado-sources-context-menu'));
 assert.ok(bundle.controls.some(c=>c.id==='vivado-sources-top-icon'));
 assert.ok(bundle.controls.every(c=>c.matchStatus==='candidate_only'&&c.observationStatus==='documented_not_scanned'));
 assert.ok(bundle.commands.some(c=>c.canonicalName==='set_property'));
 assert.equal(bundle.sources.length>0,true);
});
