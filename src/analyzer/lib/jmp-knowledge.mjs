import fs from 'node:fs/promises';
import path from 'node:path';
import {jmpApiCatalog} from './jmp-api-contract.mjs';
export async function loadJmpKnowledge(root,target){
  if(!target||!['18','19.1'].includes(target.mapVersion)||target.language!=='en-US')throw Error('JMP map target version/language required');
  const base=path.join(root,'ui-maps/jmp',target.mapVersion,target.language);
  let index;
  try { index=JSON.parse(await fs.readFile(path.join(base,'ui-index.json'),'utf8')); }
  catch(error){if(error.code==='ENOENT')throw Error(`JMP ${target.mapVersion} ${target.language} UI map missing; refusing 19.1 fallback`);throw error;}
  if(index.version!==target.mapVersion||index.language!==target.language||index.application!=='JMP')throw Error('JMP UI map identity mismatch');
  const sections=await Promise.all(index.sections.map(async s=>{
    if(!/^[a-z-]+\/ui-map\.json$/.test(s.file))throw Error('Invalid JMP map section path');
    return JSON.parse(await fs.readFile(path.join(base,s.file),'utf8'));
  }));
  const controls=sections.flatMap(s=>s.controls),ids=new Set();
  for(const c of controls){if(ids.has(c.id))throw Error('Duplicate JMP knowledge ID');ids.add(c.id);}
  for(const c of controls)if(c.parentId&&!ids.has(c.parentId))throw Error('Missing JMP map parent '+c.parentId);
  const byId=new Map(controls.map(c=>[c.id,c]));
  for(const c of controls){const chain=new Set();let node=c;while(node){if(chain.has(node.id))throw Error('Cyclic JMP map hierarchy');chain.add(node.id);node=byId.get(node.parentId);}}
  return {application:index.application,version:index.version,observedVersion:index.observedVersion,language:index.language,controls,apiCatalog:jmpApiCatalog(target.mapVersion)};
}
export function retrieveJmpKnowledge(knowledge,events,pending){
  const text=JSON.stringify({targets:events.map(e=>e.target),keys:events.map(e=>e.text||e.key),pending}).toLowerCase();
  const selected=knowledge.controls.filter(c=>c.core||[c.label,...(c.aliases??[])].some(s=>s.length>2&&text.includes(s.toLowerCase())));
  const ids=new Set(selected.map(c=>c.id));
  for(const c of selected){let parent=c.parentId;while(parent){ids.add(parent);parent=knowledge.controls.find(x=>x.id===parent)?.parentId;}}
  return {...knowledge,controls:knowledge.controls.filter(c=>ids.has(c.id)),scope:'task_relevant_core_and_label_candidates',unmatchedRule:'Use screenshot/context as candidate evidence; no forced nearest-match certainty.'};
}
