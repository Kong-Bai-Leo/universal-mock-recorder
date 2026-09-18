import {validateJmpProgram} from './jmp-program.mjs';
import {jmpApiCatalog} from './jmp-api-contract.mjs';

// Package validated model calls, not a semantic-operation-to-API translator.
export function buildJmpReplayPlan(program,validation={},origin='model_response',target=null){
  if(!['model_response','synthetic_fixture'].includes(origin))throw Error('Invalid JMP plan origin');
  const mapVersion=program.apiCatalogVersion==='jmp-jsl-18-v1'?'18':'19.1';
  const catalog=jmpApiCatalog(mapVersion);
  if(target&&target.apiCatalogVersion!==catalog.version)throw Error('JMP replay version mismatch');
  const state=validateJmpProgram(program,{...validation,apiCatalogVersion:catalog.version,final:true});
  const expectedState={tables:state.tables,reports:state.reports.map(r=>r.kind==='distribution'
    ?{kind:r.kind,id:r.reportId,tableId:r.tableId,columnIds:r.columnIds}
    :{kind:r.kind,id:r.reportId,tableId:r.tableId,xColumnId:r.xColumnId,yColumnId:r.yColumnId,fitLine:r.fitLine})};
  const used=new Set(program.operations.map(o=>o.apiCall.interfaceId));
  return {format:'jmp-api-replay-plan',version:'1.0',application:{name:'JMP',version:target?.version??mapVersion,edition:target?.edition??'unspecified',language:target?.language??'en-US'},
    callOrigin:origin,modelPlan:structuredClone(program),
    interfaceCatalog:{...catalog,interfaces:catalog.interfaces.filter(d=>used.has(d.id))},
    consumerContract:{
      completeness:'modelPlan.complete means all completed persistent operations were represented across every chunk, not that the model decided the session had ended. Pending interaction and final scene checks are separate. It does not prove native replay or visual accuracy.',
      executionMode:'native_jsl',httpEndpoint:null,
      order:'modelPlan.operations is the committed operation/call order. Preserve semantic object bindings across chunks and renames; do not use UI Automation IDs as runtime IDs.',
      arguments:'Use each apiCall exactly as supplied after validation. Strings in reference roles are semantic IDs, not names. Resolve them to the corresponding runtime object. Empty resultId discards a return value.',
      tableInitialization:'Use a NEW isolated data table. Compose this plan\'s New Column definitions into New Table before cell writes, to avoid an implicit Column 1. Preserve all declared column identities and assert exact column count; never delete a column from an existing user table.',
      cellValues:'Rows are 1-based. Parse strings using the declared column type; empty numeric text is missing (.), character text stays text. Never Eval/Parse cell text, names or model strings as code.',
      safety:'Do not modify existing user tables, run external processes, import files or invoke undeclared APIs. Stop on unresolved references, unexpected columns/types or interface mismatch.',
      verification:'After replay compare table names, ordered column identities/types, row counts, every cell and report roles against expectedState. Independently compare report statistics with the source recording; this file does not prove replay success.'
    },expectedState,
    verification:{status:'schema_and_semantics_validated_not_executed',nativeExecution:'not_run',sourceRecordingCompared:false}};
}
