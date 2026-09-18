import fs from 'node:fs/promises';
import path from 'node:path';
import {STATA_API_CATALOG,STATA_CATALOG_VERSION} from './stata-program.mjs';

export async function loadStataKnowledge(root){
  const base=path.join(root,'ui-maps/stata/18/en-US');
  const index=JSON.parse(await fs.readFile(path.join(base,'ui-index.json'),'utf8'));
  if(index.application!=='Stata/MP'||index.version!=='18.0'||index.language!=='en-US')throw Error('Stata UI knowledge version mismatch');
  const sections=await Promise.all(index.sections.map(async file=>{
    if(!/^[a-z-]+\/ui-map\.json$/.test(file))throw Error('Invalid Stata section path');
    return JSON.parse(await fs.readFile(path.join(base,file),'utf8'));
  }));
  const controls=sections.flatMap(x=>x.controls),ids=new Set();
  for(const c of controls){if(ids.has(c.id))throw Error('Duplicate Stata UI control ID');ids.add(c.id);}
  for(const c of controls)if(c.parentId&&!ids.has(c.parentId))throw Error('Missing Stata UI parent '+c.parentId);
  const interfaceSources={blank:'https://www.stata.com/manuals18/p.pdf',variable:'https://www.stata.com/manuals18/d.pdf',
    cell:'https://www.stata.com/manuals18/d.pdf',summary:'https://www.stata.com/manuals18/rsummarize.pdf',
    regression:'https://www.stata.com/manuals18/r.pdf',save:'https://www.stata.com/manuals18/dsave.pdf',
    reopen:'https://www.stata.com/manuals18/d.pdf'};
  return {application:index.application,version:index.version,language:index.language,verification:index.verification,controls,
    apiCatalog:{version:STATA_CATALOG_VERSION,status:'documented_not_live_verified',transport:'native_do_file',
      interfaces:Object.entries(STATA_API_CATALOG).map(([kind,spec])=>({operationKind:kind,...spec,source:interfaceSources[kind],
        note:kind==='blank'?'Local guard for a visually evidenced blank dataset, not a native Stata command.':
          'Model must select this native command plan and bind exact receiver/result/arguments; host only validates.'}))}};
}
export function retrieveStataKnowledge(knowledge,events,pending){
  const context=JSON.stringify({targets:events.map(x=>x.target),keys:events.map(x=>x.text||x.key),pending}).toLowerCase();
  const selected=knowledge.controls.filter(c=>c.core||[c.label,...c.aliases].some(x=>x.length>2&&context.includes(x.toLowerCase())));
  const ids=new Set(selected.map(x=>x.id));
  for(const c of selected){let parent=c.parentId;while(parent){ids.add(parent);parent=knowledge.controls.find(x=>x.id===parent)?.parentId;}}
  return {...knowledge,controls:knowledge.controls.filter(x=>ids.has(x.id)),scope:'relevant_versioned_ui_candidates',
    unmatchedRule:'Read each control verification separately. A live-observed label or opened dialog is not tested command execution; documented-only or unknown icon functions remain uncertain. Current screenshot, focused parameter role and command stage must decide. No nearest-match promotion.'};
}
