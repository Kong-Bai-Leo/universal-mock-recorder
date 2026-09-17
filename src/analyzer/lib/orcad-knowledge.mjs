import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadOrcadKnowledge(root){
  const base=path.join(root,'ui-maps/orcad-capture/24.1/en-US');
  const read=async file=>JSON.parse(await fs.readFile(path.join(base,file),'utf8'));
  const [index,map,place,editing,sources]=await Promise.all(['index.json','ui-map.json','menus/place.json','interfaces/editing.json','sources.json'].map(read));
  if(index.application!=='OrCAD X Capture'||index.version!=='24.1')throw Error('Unexpected OrCAD knowledge version');
  return {index,map,place,editing,sources};
}
export function retrieveOrcadKnowledge(knowledge,events){
  const text=JSON.stringify(events.map(e=>({target:e.target,key:e.key,text:e.text}))).toLowerCase();
  const relevant=knowledge.place.nodes.filter(n=>['place-wire','place-net-alias','place-line'].includes(n.id)||[n.label,n.shortcut].some(s=>s&&text.includes(String(s).toLowerCase())));
  const interfaces=knowledge.editing.interfaces.filter(x=>['capture-tcl-place-wire','capture-tcl-place-net-alias'].includes(x.id));
  return {application:knowledge.index.application,version:knowledge.index.version,coverageStatus:knowledge.index.coverageStatus,notCovered:knowledge.index.notCovered,
    hierarchy:knowledge.map.nodes.filter(n=>['capture','menu-bar','menu-place','schematic-page','status-bar','page-coordinate-display'].includes(n.id)),placeMenu:relevant,interfaces,
    sourceIds:knowledge.sources,rule:'Partial observed map only. Label candidates do not prove selected command. Pixel coordinates do not prove Capture page coordinates.'};
}
