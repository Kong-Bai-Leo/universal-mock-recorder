import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../ui-maps/orcad-capture/24.1/en-US/", import.meta.url));
const readJson = async relative => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));

function validatePackage(index, sourceRegistry, groups) {
  assert.equal(index.application, "OrCAD X Capture");
  assert.equal(index.version, "24.1");
  assert.equal(index.packageKind, "partial_observed_ui_and_interface_candidates");
  assert.equal(index.coverageStatus, "partial_ui_observed");
  assert.equal(index.runtimeStatus, "single_wire_real_recording_native_replay_and_reopen_passed");
  assert.equal(index.observationStatus, "capture_24_1_p001_schematic_and_dsn_db_observed");
  assert.equal(index.uiMapFile, "ui-map.json");
  assert.equal(index.liveObservationFile, "live-observation.json");

  const sourceIds = new Set();
  for (const source of sourceRegistry.sources) {
    assert.ok(source.id && !sourceIds.has(source.id), `duplicate source ID: ${source.id}`);
    sourceIds.add(source.id);
    assert.match(source.url, /^https:\/\/(resources\.pcb|community)\.cadence\.com\//);
    assert.ok(["cadence_product_material", "cadence_community_user_example", "cadence_community_technical_reply"].includes(source.provenance));
    assert.equal(source.targetVmVerified, false);
  }

  const groupIds = new Set();
  const interfaceIds = new Set();
  for (const group of groups) {
    assert.ok(group.id && !groupIds.has(group.id), `duplicate group ID: ${group.id}`);
    groupIds.add(group.id);
    for (const item of group.interfaces) {
      assert.ok(item.id && !interfaceIds.has(item.id), `duplicate interface ID: ${item.id}`);
      interfaceIds.add(item.id);
      assert.ok(item.sourceIds.length > 0);
      for (const id of item.sourceIds) assert.ok(sourceIds.has(id), `unknown source: ${id}`);
      assert.ok(item.sourceIds.some(id => sourceRegistry.sources.find(s => s.id === id).provenance === item.evidenceLevel), `misstated provenance: ${item.id}`);
      assert.equal(item.targetVmVerified, false);
      assert.equal(item.implementationStatus, "catalog_only");
      assert.ok(item.unknowns.length > 0, `missing unknowns: ${item.id}`);
      assert.ok(item.uiHierarchy.includes("unknown"));
      for (const parameter of item.parameters) assert.ok(parameter.unit && parameter.role);
    }
  }
  assert.deepEqual(new Set(index.interfaceFiles.map(section => section.id)), groupIds);
  return interfaceIds;
}

test("Capture catalog references are unique, sourced and explicitly unverified", async () => {
  const index = await readJson("index.json");
  const sources = await readJson(index.sourceFile);
  const groups = [];
  for (const section of index.interfaceFiles) {
    assert.match(section.path, /^interfaces\/[a-z-]+\.json$/);
    groups.push(await readJson(section.path));
  }
  const ids = validatePackage(index, sources, groups);
  assert.deepEqual(ids, new Set([
    "capture-tcl-source-file", "capture-tcl-launch-with-file", "capture-tcl-place-wire",
    "capture-tcl-place-net-alias", "capture-tcl-get-selected-objects", "capture-tcl-menu-save"
  ]));
  assert.ok([...ids].every(id => id.startsWith("capture-tcl-")));
});

test("observed UI hierarchy stays separate from layout and unverified replay interfaces", async () => {
  const index = await readJson("index.json");
  const ui = await readJson(index.uiMapFile);
  const observation = await readJson(index.liveObservationFile);
  assert.equal(ui.coverageStatus, "partial");
  assert.equal(ui.automationIdsCollected, false);
  assert.equal(ui.staticBoundsIncluded, false);
  const nodes = [...ui.nodes];
  for (const node of ui.nodes) {
    if (!node.childrenFile) continue;
    const group = await readJson(node.childrenFile);
    assert.equal(group.parentId, node.id);
    nodes.push(...group.nodes);
  }
  const ids = new Set(nodes.map(node => node.id));
  assert.equal(ids.size, nodes.length);
  for (const node of nodes) {
    assert.ok(node.parentId === null || ids.has(node.parentId), `unknown UI parent: ${node.id}`);
    assert.equal(node.bounds, undefined);
    assert.equal(node.automationId, undefined);
  }
  assert.equal(nodes.find(node => node.id === "place-wire").shortcut, "W");
  assert.equal(nodes.find(node => node.id === "place-line").shortcut, "Shift+L");
  assert.equal(nodes.find(node => node.id === "place-auto-wire").childrenScanStatus, "not_scanned");
  assert.equal(observation.about.version, "24.1 P001");
  const dsnProbe = observation.observations.find(item => item.id === "capture-standalone-dsn-dbo-probe-20260916");
  assert.ok(dsnProbe);
  assert.ok(dsnProbe.facts.some(fact => fact.includes("File > Open > Design") && fact.includes("RECORDER_ROOT / REPLAY_PAGE")));
  assert.ok(dsnProbe.facts.some(fact => fact.includes("wire ID 1") && fact.includes("(170,300) to (370,300)")));
  assert.ok(dsnProbe.facts.some(fact => fact.includes("772%") && fact.includes("not visible")));
  assert.match(dsnProbe.verificationLimit, /not independent-process reopen or visual rendering/);
  assert.ok(index.notCovered.some(item => item.includes("complex circuits and independent-process replay remain unverified")));
  const real = observation.realRecordingVerification;
  assert.equal(real.modelRequest.sourceObjectReadbackIncluded, false);
  assert.equal(real.execution.catchCode, 0);
  assert.equal(real.comparison.geometryMatch, true);
  assert.equal(real.comparison.sourceUnchanged, true);
  assert.deepEqual(real.comparison.sourceInternalEndpoints, real.comparison.replayInternalEndpoints);
  assert.equal(real.persistence.projectClosedAndReopened, true);
  assert.equal(real.persistence.sameProcess, true);
  assert.deepEqual(real.persistence.readbackInternalEndpoints, real.comparison.sourceInternalEndpoints);
  assert.equal(real.rerunGuard.readbackUnchanged, true);
  assert.match(real.verificationLimit, /One isolated wire/);
  const smoke = observation.compilerSmokeTest;
  assert.equal(smoke.sampleKind, "synthetic_fixture_not_model_output");
  assert.equal(smoke.transportCheck.matchedBeforeExecution, true);
  assert.equal(smoke.execution.catchCode, 0);
  assert.equal(smoke.execution.allGeneratedAssertionsPassed, true);
  assert.equal(smoke.execution.visualWireAndAliasObserved, true);
  assert.deepEqual(smoke.readback.startInternal, [170, 300]);
  assert.deepEqual(smoke.readback.endInternal, [370, 300]);
  assert.equal(smoke.readback.aliasOwnerId, smoke.readback.wireId);
  assert.equal(smoke.rerunGuard.catchCode, 1);
  assert.equal(smoke.rerunGuard.message, "Wire count mismatch");
  assert.equal(smoke.rerunGuard.wireAndAliasReadbackUnchanged, true);
  assert.match(smoke.verificationLimit, /Not a real recording/);
  for (const item of observation.observations) {
    for (const id of item.uiIds ?? []) assert.ok(ids.has(id), `unknown observed UI: ${id}`);
    for (const box of item.bounds ?? []) {
      assert.ok(ids.has(box.uiId));
      assert.ok(box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0);
      assert.ok(box.x + box.width <= observation.coordinateSpace.width);
      assert.ok(box.y + box.height <= observation.coordinateSpace.height);
    }
  }
});

test("catalog validation rejects fabricated citations, duplicate IDs and false runtime claims", async () => {
  const index = await readJson("index.json");
  const sources = await readJson(index.sourceFile);
  const groups = await Promise.all(index.interfaceFiles.map(section => readJson(section.path)));

  let copy = structuredClone(groups);
  copy[0].interfaces[0].sourceIds = ["invented-source"];
  assert.throws(() => validatePackage(index, sources, copy), /unknown source/);

  copy = structuredClone(groups);
  copy[1].interfaces[0].id = copy[0].interfaces[0].id;
  assert.throws(() => validatePackage(index, sources, copy), /duplicate interface ID/);

  copy = structuredClone(groups);
  copy[0].interfaces[0].targetVmVerified = true;
  assert.throws(() => validatePackage(index, sources, copy));

  const falseIndex = {...index, runtimeStatus: "native_replay_verified"};
  assert.throws(() => validatePackage(falseIndex, sources, groups));
});
