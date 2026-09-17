import {validateVivadoProgram,VIVADO_API_VERSION} from './vivado-program.mjs';
export function buildVivadoReplayPlan(program,validation){
 const catalog=validateVivadoProgram(program,{...validation,final:true});
 return {format:'VivadoNativeInterfacePlan',version:VIVADO_API_VERSION,application:{name:'Vivado',version:'2024.2'},
  program,expectedState:catalog,consumerContract:{primary:'Execute the model-supplied apiCall choices in commit order. Bind logical IDs to returned native handles; never evaluate arbitrary command text.',
   destination:'A new isolated directory assigned by executor; reject any existing project path, never force-overwrite.',
   dependencies:'Only exact HDL artifacts explicitly reconstructed from evidence. Never read unseen native source files to fill gaps.',
   executionMode:'A Tcl script, preferably batch. GUI interactive wait_on_runs is not a completion guarantee.',
   verification:'Check properties, exact file contents, run terminal status, and separately compare recording source truth. Successful calls alone do not prove equivalence.'},
  nativeVerification:{status:'not_run',sourceRecordingCompared:false}};
}
