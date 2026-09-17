// Opt-in offline compilation, separate from the bounded paid regression runner.
// Revalidate original provider bytes/provenance first; never edit a model result.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadAuditedVivadoFocusedProgram} from './vivado-focused-test.mjs';
import {renderVivado} from './lib/vivado-renderer.mjs';
import {digest} from './lib/vivado-evidence.mjs';

export async function exportVivadoFocusedReplay(options){
 if(!options.outputDirectory)throw Error('Explicit new outputDirectory required');
 const {audit,program,validation,contextProvenance}=await loadAuditedVivadoFocusedProgram(options);
 const script=renderVivado(program,validation),directory=path.resolve(options.outputDirectory);
 const renderer=await fs.readFile(fileURLToPath(new URL('./lib/vivado-renderer.mjs',import.meta.url)));
 const provenance={...audit,status:'offline_replay_compiled_not_executed',generatedExecutable:true,nativeExecution:'not_run',
  fullyReanalysed:false,contextProvenance,programSha256:digest(JSON.stringify(program)),scriptSha256:digest(Buffer.from(script)),rendererSha256:digest(renderer),
  note:'Earlier chunks remain provenance-checked old model context; focused chunks are unchanged provider outputs. Native execution and independent comparison are still required.'};
 // Existing destinations (including symlinks) fail closed. No overwrites and no
 // writes to provider/status/request files; no API client or credentials loaded.
 await fs.mkdir(directory);
 await fs.writeFile(path.join(directory,'vivado-replay.tcl'),script,{flag:'wx'});
 await fs.writeFile(path.join(directory,'replay-program.json'),JSON.stringify(program,null,2),{flag:'wx'});
 await fs.writeFile(path.join(directory,'replay-provenance.json'),JSON.stringify(provenance,null,2),{flag:'wx'});
 return {directory,script:path.join(directory,'vivado-replay.tcl'),...provenance};
}
