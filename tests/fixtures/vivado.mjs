import {VIVADO_API_VERSION} from '../../src/analyzer/lib/vivado-program.mjs';
export const frame=(eventId='evt-001')=>({eventId,imageLabel:'screenshots/'+eventId+'.jpg'});
export const topState=(module,eventId='evt-001',stability='stable')=>({module,stability,indicator:stability==='stable'?'top_module_icon':'unknown',frames:[frame(eventId)]});
export function topTransaction(operationId='op-top',filesetId='fileset-1',module='top',sourceEventIds=['evt-001']){
 return {id:'top-'+operationId,sourceEventIds,filesetId,requestedModule:module,status:'committed',before:topState('',sourceEventIds[0],'unknown'),after:topState(module,sourceEventIds.at(-1)),operationId,cancelEvidence:[],reason:'Observed top icon'};
}
export const call=(id,command,receiverId,resultId,args,sourceEventIds=['evt-001'],timestampMs=1)=>({id,sourceEventIds,timestampMs,stage:'committed',knowledgeIds:[],apiCall:{command,interfaceId:'vivado-tcl-'+command.replaceAll('_','-'),receiverId,resultId,arguments:args}});
export function projectFixture(){return {version:VIVADO_API_VERSION,complete:true,summary:'Synthetic project',initialScene:{kind:'blank',evidenceIds:['evt-001']},operations:[call('create','create_project','','p',{name:'Example',part:'xc7a200tsbg484-1'}),call('fileset','get_filesets','p','fs',{name:'sources_1'})],artifacts:[],topTransactions:[],decisions:[{sourceEventIds:['evt-001'],disposition:'modeled',reason:'Create'}],unresolved:[],finalScene:{kind:'observed',projectIds:['p'],evidenceIds:['evt-001']},commandState:{command:'',stage:'idle',pendingEventIds:[],selectionIds:[]}};}
