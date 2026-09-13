import fs from "node:fs/promises";
import path from "node:path";

const mapPath = "ui-maps/vivado/2024.2/en-US";
const norm = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[._\s-]+/g, " ").trim();
const requireThat = (ok, message) => { if (!ok) throw new Error(`Vivado knowledge: ${message}`); };

// All paths come from a versioned local index, not model-selected arbitrary files.
async function readInside(base, relative) {
  requireThat(typeof relative === "string" && !relative.includes("\\") && !relative.includes(":") &&
    !path.isAbsolute(relative) && relative.split("/").every(p => p && p !== "." && p !== ".."), "unsafe map path");
  const resolved = await fs.realpath(path.join(base, relative));
  const within = path.relative(base, resolved);
  requireThat(within && !within.startsWith("..") && !path.isAbsolute(within), "map symlink escapes root");
  return JSON.parse((await fs.readFile(resolved, "utf8")).replace(/^\uFEFF/, ""));
}

export function validateVivadoKnowledge(knowledge) {
  const {index, controls, commands, sources, observations} = knowledge;
  requireThat(index.application === "Vivado" && index.version === "2024.2", "unsupported application/version");
  const unique = (items, kind) => {
    requireThat(Array.isArray(items), `${kind} must be an array`);
    const ids = new Set();
    for (const item of items) {
      requireThat(item && typeof item.id === "string" && item.id.length && !ids.has(item.id), `duplicate/missing ${kind} ID`);
      ids.add(item.id);
    }
    return ids;
  };
  const ids = unique(controls, "control"), commandIds = unique(commands, "command"),
    sourceIds = unique(sources, "source"), observationIds = unique(observations, "observation");
  const byId = new Map(controls.map(c => [c.id, c]));
  const refs = (values, allowed, label) => {
    requireThat(Array.isArray(values), `${label} must be an array`);
    for (const value of values) requireThat(allowed.has(value), `unknown ${label}: ${value}`);
  };
  for (const c of controls) {
    requireThat(typeof c.label === "string" && c.label.length && typeof c.type === "string", `invalid control ${c.id}`);
    requireThat(c.parentId === null || ids.has(c.parentId), `unknown parent for ${c.id}`);
    requireThat(!("bounds" in c), `layout bounds must be in live observations: ${c.id}`);
    refs(c.sourceIds, sourceIds, "source"); refs(c.observationIds, observationIds, "observation");
    requireThat(c.observationStatus !== "observed" || c.observationIds.length > 0, `observation required: ${c.id}`);
    const visited = new Set([c.id]);
    let parent = c.parentId;
    while (parent !== null) {
      requireThat(!visited.has(parent), `parent cycle at ${c.id}`);
      visited.add(parent); parent = byId.get(parent).parentId;
    }
  }
  const names = new Set();
  for (const c of commands) {
    requireThat(typeof c.canonicalName === "string" && !names.has(c.canonicalName), "duplicate command name");
    names.add(c.canonicalName);
    refs(c.sourceIds, sourceIds, "command source"); refs(c.relatedControlIds, ids, "related control");
    refs(c.companionCommandIds, commandIds, "companion command");
    requireThat(c.sourceIds.length > 0, `official source required: ${c.id}`);
    requireThat(c.interfaceKind === "native_tcl", `unexpected interface kind: ${c.id}`);
  }
  for (const obs of observations) {
    for (const region of obs.regions ?? []) {
      requireThat(ids.has(region.controlId), `unknown observed control ${region.controlId}`);
      requireThat(Array.isArray(region.bounds) && region.bounds.length === 4 && region.bounds.every(Number.isFinite) && region.bounds[2] > 0 && region.bounds[3] > 0, "invalid observation bounds");
    }
  }
  return {controls:ids.size, commands:commandIds.size, sources:sourceIds.size, observations:observationIds.size,
    coverageStatus:index.coverageStatus, replayBackend:index.replayBackend};
}

export async function loadVivadoKnowledge(root) {
  const base = await fs.realpath(path.resolve(root, mapPath));
  const index = await readInside(base, "index.json");
  const sections = await Promise.all(index.sections.map(s => readInside(base, s.path)));
  const sourceDoc = await readInside(base, index.sourceFile);
  const commandDoc = await readInside(base, index.commandFile);
  const observationDoc = await readInside(base, index.observationFile);
  requireThat(commandDoc.version === index.catalogVersion, "catalog version mismatch");
  const controls = sections.flatMap((section,i) => {
    requireThat(section.section === index.sections[i].id && section.application === index.application && section.version === index.version, "section/version mismatch");
    return section.controls.map(c => ({...c, sectionId:section.section}));
  });
  const knowledge = {index, controls, commands:commandDoc.commands, sources:sourceDoc.sources, observations:observationDoc.observations};
  validateVivadoKnowledge(knowledge);
  return knowledge;
}

// Retrieval offers evidence candidates, never an automatic UI match or permission to execute.
// No single-letter command guessing and no stale active-command override of fresh labels.
export function retrieveVivadoKnowledge(knowledge, {texts = [], controlIds = [], sectionIds = [], maxControls = 12, maxCommands = 6} = {}) {
  requireThat(Array.isArray(texts) && texts.every(t => typeof t === "string"), "texts must be strings");
  requireThat(Array.isArray(controlIds) && Array.isArray(sectionIds), "invalid retrieval IDs");
  requireThat(Number.isInteger(maxControls) && maxControls >= 1 && maxControls <= 24, "invalid control budget");
  requireThat(Number.isInteger(maxCommands) && maxCommands >= 1 && maxCommands <= 8, "invalid command budget");
  const queries = texts.slice(0, 100).map(t => norm(t.slice(0, 2000))).filter(t => t.length >= 3);
  const requested = new Set(controlIds), sections = new Set(sectionIds);
  const byId = new Map(knowledge.controls.map(c => [c.id,c]));
  const breadcrumb = c => {
    const result = [];
    for (let item = c; item; item = item.parentId ? byId.get(item.parentId) : null) result.unshift({id:item.id,label:item.label,type:item.type});
    return result;
  };
  const ranked = knowledge.controls.map(c => {
    const label = norm(c.label), description = norm(c.description);
    const explicit = requested.has(c.id);
    const exact = queries.some(q => q === label);
    const partial = queries.some(q => label.includes(q) || (label.length >= 4 && q.includes(label)));
    const weak = queries.some(q => description.includes(q));
    const score = explicit ? 100 : exact ? 50 : partial ? 20 : weak ? 5 : 0;
    return {c, score:score + (score > 0 && sections.has(c.sectionId) ? 10 : 0), reason:explicit ? "requested_map_id_not_automation_id" : exact ? "label_candidate" : "text_candidate"};
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.c.id.localeCompare(b.c.id));
  const chosen = ranked.slice(0,maxControls), chosenIds = new Set(chosen.map(x=>x.c.id));
  const canonicalMatches = knowledge.commands.filter(c => queries.some(q => q === norm(c.canonicalName)));
  const relatedCommands = [...canonicalMatches];
  const included = new Set(canonicalMatches.map(c=>c.id));
  for (const c of knowledge.commands) {
    if (!included.has(c.id) && c.relatedControlIds.some(id => chosenIds.has(id))) {
      relatedCommands.push(c); included.add(c.id);
    }
  }
  const commandById = new Map(knowledge.commands.map(c=>[c.id,c]));
  for (let i=0; i<relatedCommands.length; i++) {
    for (const id of relatedCommands[i].companionCommandIds) {
      if (!included.has(id)) { relatedCommands.push(commandById.get(id)); included.add(id); }
    }
  }
  const commands = relatedCommands.slice(0,maxCommands);
  const relevantSources = new Set([...chosen.flatMap(x=>x.c.sourceIds),...commands.flatMap(c=>c.sourceIds)]);
  return {application:knowledge.index.application, version:knowledge.index.version, catalogVersion:knowledge.index.catalogVersion,
    coverageStatus:knowledge.index.coverageStatus, replayBackend:knowledge.index.replayBackend,
    controls:chosen.map(({c,reason}) => ({...c, breadcrumb:breadcrumb(c), matchStatus:"candidate_only", retrievalReason:reason})),
    commands, sources:knowledge.sources.filter(s=>relevantSources.has(s.id)),
    unknownControlIds:controlIds.filter(id=>!byId.has(id)),
    omittedForBudget:{controlIds:ranked.slice(maxControls).map(x=>x.c.id), commandIds:relatedCommands.slice(maxCommands).map(c=>c.id)},
    rule:"Use current screenshots, labels, parent hierarchy and command stage to disambiguate. A map ID is not an Automation ID. Documented controls and commands do not prove license access or implemented replay. Empty retrieval is not permission to invent a command."};
}
