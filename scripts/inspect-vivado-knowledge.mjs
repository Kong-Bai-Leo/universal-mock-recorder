#!/usr/bin/env node
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadVivadoKnowledge, validateVivadoKnowledge, retrieveVivadoKnowledge} from "../src/analyzer/lib/vivado-knowledge.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
export async function inspectVivadoKnowledge(query) {
  const knowledge=await loadVivadoKnowledge(root);
  return query === undefined ? validateVivadoKnowledge(knowledge) : retrieveVivadoKnowledge(knowledge,{texts:[query]});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length>1) { console.error('Usage: node scripts/inspect-vivado-knowledge.mjs ["visible label or canonical command"]'); process.exitCode=1; }
  else { try { console.log(JSON.stringify(await inspectVivadoKnowledge(args[0]),null,2)); } catch(e) { console.error(e.message); process.exitCode=1; } }
}
