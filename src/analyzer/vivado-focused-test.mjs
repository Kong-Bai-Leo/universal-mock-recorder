// Bounded paid regression, NOT checkpoint migration or a publishing path.
// Earlier provider responses supply explicitly labelled context only. This file
// never emits Tcl and cannot mark an entire historical recording reanalysed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {prepareVivadoEvidence,VIVADO_BUDGET,digest} from './lib/vivado-evidence.mjs';
import {VIVADO_API_VERSION,VIVADO_SCHEMA,VIVADO_LEGACY_SCHEMA,VIVADO_INSTRUCTIONS,checkVivadoSchema,validateVivadoProgram,mergeVivadoChunks,vivadoPreviousContext,vivadoChunkPosition} from './lib/vivado-program.mjs';
import {loadVivadoKnowledge,retrieveVivadoKnowledge,vivadoStateKnowledge,vivadoKnowledgeIds} from './lib/vivado-knowledge.mjs';
import {VIVADO_STATE_RULES} from './lib/vivado-state-harness.mjs';
import {savedCandidates,vivadoSourceTransactionRules} from './vivado-cli.mjs';
import {loadLocalEnv} from './lib/local-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const json=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const save=async(p,v)=>{const tmp=p+'.tmp';await fs.writeFile(tmp,JSON.stringify(v,null,2));await fs.rename(tmp,p);};
const assert=(v,m)=>{if(!v)throw Error('Vivado focused test: '+m);};
const same=(a,b)=>isDeepStrictEqual(a,JSON.parse(JSON.stringify(b)));
const exists=async p=>fs.stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
const EVALUATION_SCOPE='Focused regression. Earlier chunks are provenance-checked OLD MODEL CONTEXT, not current reanalysis and not native source truth. Analyse only supplied current inputs; preserve their dependencies. Do not claim native execution.';
function validationAt(evidence,knowledge,i){return {eventIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),currentInputIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),events:evidence.chunks.slice(0,i+1).flatMap(c=>c.events),knowledgeIds:vivadoKnowledgeIds(knowledge)};}
function payloadAt(evidence,knowledge,completed,i){
 const chunk=evidence.chunks[i],catalog=completed.length?validateVivadoProgram(mergeVivadoChunks(completed),validationAt(evidence,knowledge,i-1)):null;
 return {application:'Vivado 2024.2',chunk:vivadoChunkPosition(i+1,evidence.chunks.length),evaluationScope:EVALUATION_SCOPE,
  sourceScope:{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets},
  sourceTransactionRules:vivadoSourceTransactionRules(),stateRules:VIVADO_STATE_RULES,stateKnowledge:vivadoStateKnowledge(knowledge),inputs:chunk.events,nativeApiCatalog:knowledge.commands,
  knowledge:retrieveVivadoKnowledge(knowledge,{texts:chunk.events.flatMap(e=>[e.target?.name,e.window?.title,e.text].filter(Boolean))}),previousContext:vivadoPreviousContext(completed,catalog),allowedEvidenceIds:validationAt(evidence,knowledge,i).eventIds};
}

async function focusedLedger(source,base,seen=new Set()){
 assert(path.dirname(source)===base&&!seen.has(source)&&seen.size<4,'invalid/cyclic focused provenance');seen.add(source);
 assert(!await exists(path.join(source,'analysis.lock')),'ancestor focused run is active');
 const report=await json(path.join(source,'prepare.json')),status=await json(path.join(source,'status.json'));
 assert(status.identity===report.identity&&path.basename(source)===report.identity.slice(0,24),'focused provenance identity mismatch');
 const own=await savedCandidates(source,base),files=(await fs.readdir(source)).filter(n=>/^\d{3}-\d+-request\.json$/.test(n));
 assert(files.length===own.length,'incomplete/uncertain request ledger; cannot resume');
 let inherited=[];
 if(report.resume){
  const ancestor=await fs.realpath(report.resume.source),parent=await focusedLedger(ancestor,base,seen),marker=await json(path.join(ancestor,'resumed-by.json'));
  assert(marker.identity===report.identity&&path.resolve(marker.directory)===source,'focused continuation ownership mismatch');
  assert(digest(parent.report)===report.resume.prepareDigest&&digest(parent.status)===report.resume.statusDigest&&parent.status.requests===report.resume.requests&&parent.status.repairs===report.resume.repairs&&same(parent.status.usage,report.resume.usage),'ancestor ledger changed');
  assert(parent.report.maxRequests===report.maxRequests&&parent.report.maxSemanticRepairs===report.maxSemanticRepairs,'ancestor budget changed');
  inherited=parent.candidates;
  assert(inherited.length===report.resume.provenance.length&&report.resume.provenance.every(p=>inherited.some(c=>c.prefix===p.prefix&&c.response.id===p.responseId&&digest(c.request)===p.requestDigest&&digest(c.response)===p.responseDigest)),'ancestor response provenance changed');
 }
 const candidates=[...inherited,...own];assert(candidates.length===status.requests,'cumulative request ledger mismatch');
 return {report,status,candidates};
}

// Explicit bounded recovery after a host validation-only fix. Raw
// provider JSON is revalidated unchanged. Prompt/schema/evidence must match;
// all previous requests and the semantic-repair count remain charged.
async function recoverFocused(options,prepared,{allowCompleted=false}={}){
 const {report,evidence,knowledge,provider,contextChunks}=prepared;
 const base=await fs.realpath(path.join(options.recording,'generated-vivado/_focused-tests'));
 const source=await fs.realpath(path.resolve(options.resumeFrom));
 assert(path.dirname(source)===base,'resume must belong to this recording');
 assert(!await exists(path.join(source,'analysis.lock'))&&!await exists(path.join(source,'resumed-by.json')),'resume source locked/already consumed');
 const old=await json(path.join(source,'prepare.json')),status=await json(path.join(source,'status.json'));
 assert(status.status==='failed'&&status.identity===old.identity&&path.basename(source)===old.identity.slice(0,24),'only a failed focus run can resume');
 for(const k of ['scope','sourceRun','fromChunk','throughChunk','totalChunks','maxRequests','maxSemanticRepairs','networkRetries','model','provider','contextProvenance','chunks'])assert(same(old[k],report[k]),'resume scope/config/evidence changed: '+k);
 const {candidates}=await focusedLedger(source,base);
 assert(Number.isInteger(status.requests)&&status.requests>0&&status.requests<=report.maxRequests&&candidates.length===status.requests,'incomplete/uncertain request ledger; cannot resume');
 assert(Number.isInteger(status.repairs)&&status.repairs>=0&&status.repairs<=report.maxSemanticRepairs,'invalid repair ledger');
 const usage=[];
 for(const c of candidates){const u=await json(path.join(c.run,c.prefix+'-usage.json'));assert(u.records.length===1&&u.records[0].responseId===c.response.id,'missing/ambiguous saved usage');usage.push(...u.records);}
 assert(same(usage,status.usage),'usage ledger changed');
 const results=[],completed=[...contextChunks],provenance=[];
 for(let i=report.fromChunk-1;i<report.throughChunk;i++){
  const matches=candidates.filter(c=>c.request.payload.chunk.index===i+1);if(!matches.length)break;
  const expected=payloadAt(evidence,knowledge,completed,i);
  for(const c of matches){
   const payload=structuredClone(c.request.payload);delete payload.repairFeedback;
   assert(same(payload,expected)&&c.request.instructions===VIVADO_INSTRUCTIONS&&same(c.request.schema,VIVADO_SCHEMA)&&same(c.request.provider,provider)&&c.request.maxOutputTokens===VIVADO_BUDGET.maxOutputTokens&&same(c.request.images,report.chunks.find(c=>c.index===i+1).images),'saved focused request contract/evidence changed');
   provenance.push({chunk:i+1,prefix:c.prefix,responseId:c.response.id,requestDigest:digest(c.request),responseDigest:digest(c.response)});
  }
  const c=matches.at(-1);validateVivadoProgram(mergeVivadoChunks([...completed,c.parsed]),validationAt(evidence,knowledge,i));
  completed.push(c.parsed);results.push({chunk:i+1,prefix:c.prefix,result:c.parsed,reusedFrom:c.run});
 }
 assert(provenance.length===status.requests&&results.length>0&&(allowCompleted||results.length<report.chunks.length),'noncontiguous or already finished focused responses');
 assert(status.requests+report.chunks.length-results.length<=report.maxRequests,'remaining request budget cannot finish scope');
 const resume={source,sourceIdentity:old.identity,statusDigest:digest(status),prepareDigest:digest(old),requests:status.requests,repairs:status.repairs,usage,provenance,analysedChunks:results.length};
 const identity=digest({currentIdentity:report.identity,resume}),directory=path.join(base,identity.slice(0,24));
 return {...prepared,report:{...report,identity,directory,resume},directory,reusedResults:results};
}

// Read-only post-run audit. This never retries, changes provider JSON/status,
// generates Tcl, or claims native execution. It also verifies the full request
// chain under the current schema/prompt/evidence before local revalidation.
export async function auditVivadoFocusedTest(options){
 return (await auditedFocusedBundle(options)).audit;
}

// Explicit read-only handoff to the separate offline replay exporter. The paid
// regression runner itself still never generates an executable.
export async function loadAuditedVivadoFocusedProgram(options){
 const bundle=await auditedFocusedBundle(options);
 assert(bundle.audit.throughChunk===bundle.totalChunks,'executable export requires the final recording chunk');
 validateVivadoProgram(bundle.program,{...bundle.validation,final:true});
 return bundle;
}

async function auditedFocusedBundle(options){
 const prepared=await prepareVivadoFocusedTest({...options,resumeFrom:undefined});
 const recovered=await recoverFocused({...options,resumeFrom:options.auditRun},prepared,{allowCompleted:true});
 const {report,reusedResults,evidence,knowledge,contextChunks}=recovered;
 assert(reusedResults.length===report.chunks.length,'focused scope is not fully analysed');
 const program=mergeVivadoChunks([...contextChunks,...reusedResults.map(r=>r.result)]),validation=validationAt(evidence,knowledge,report.throughChunk-1);
 const catalog=validateVivadoProgram(program,{...validation,final:report.throughChunk===report.totalChunks});
 const base=await fs.realpath(path.join(options.recording,'generated-vivado/_focused-tests')),{candidates}=await focusedLedger(await fs.realpath(options.auditRun),base);
 const usage=candidates.map(c=>({chunk:c.request.payload.chunk.index,responseId:c.response.id,model:c.response.model,serviceTier:c.response.service_tier,usage:c.response.usage}));
 const audit={status:'saved_real_api_results_revalidated_locally',apiRunnerStatus:'failed_before_host_fixes',scope:report.scope,fromChunk:report.fromChunk,throughChunk:report.throughChunk,
  requests:report.resume.requests,repairs:report.resume.repairs,code:report.code,provenance:report.resume.provenance,usage,
  topTransactions:reusedResults.flatMap(r=>r.result.topTransactions),catalog,contextChunks:contextChunks.length,analysedChunks:reusedResults.length,
  fullyReanalysed:false,generatedExecutable:false,nativeExecution:'not_run',needsIndependentVisualReview:true};
 return {audit,program,validation,totalChunks:report.totalChunks,contextProvenance:report.contextProvenance};
}

function legacyContext(context){
 if(!context)return null;
 const c=structuredClone(context);delete c.topTransactions;delete c.pendingTopTransactions;
 for(const o of c.catalog.objects){delete o.designRevision;delete o.inputRevision;}
 return c;
}

export async function prepareVivadoFocusedTest(options){
 const recording=await fs.realpath(path.resolve(options.recording));
 const base=await fs.realpath(path.join(recording,'generated-vivado'));
 const sourceRun=await fs.realpath(path.resolve(options.sourceRun));
 assert(path.dirname(sourceRun)===base,'source run must belong to this recording');
 assert(!await exists(path.join(sourceRun,'analysis.lock')),'source run is locked');
 const config=await json(path.resolve(options.config));
 const provider=Object.fromEntries(['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses','uploadChunkBytes'].filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
 assert(provider.model,'configured model required');provider.maxRetries=0;provider.maxRequestBytes=VIVADO_BUDGET.maxRequestBytes;
 const evidence=await prepareVivadoEvidence(recording),knowledge=await loadVivadoKnowledge(root);
 const from=options.fromChunk,through=options.throughChunk??from,maxRequests=options.maxRequests??4;
 assert(Number.isInteger(from)&&Number.isInteger(through)&&from>=1&&through>=from&&through<=evidence.chunks.length&&through-from<3,'select 1..3 contiguous chunks');
 assert(Number.isInteger(maxRequests)&&maxRequests>=through-from+1&&maxRequests<=4,'request budget must cover selection and stay <=4');
 const candidates=await savedCandidates(sourceRun,base),selected=[];
 for(let i=0;i<through;i++){
  const matches=candidates.filter(c=>c.request.payload?.chunk?.index===i+1);
  assert(matches.length===1,'missing/ambiguous saved response for chunk '+(i+1));
  const c=matches[0],chunk=evidence.chunks[i],r=c.request;
  assert(same(r.payload.chunk,vivadoChunkPosition(i+1,evidence.chunks.length))&&same(r.payload.inputs,chunk.events)&&same(r.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes}))),'recording/chunk/images changed');
  assert(same(r.provider,provider),'keep original configured model, detail and effort');
  assert(same(r.payload.allowedEvidenceIds,evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds)),'saved evidence scope changed');
  assert(same(r.payload.sourceScope,{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets}),'source scope changed');
  selected.push(c);
 }
 const contextChunks=[],contextProvenance=[];
 for(let i=0;i<from-1;i++){
  const c=selected[i],legacy=c.parsed.version==='vivado-native-plan-1';
  assert(same(c.request.schema,legacy?VIVADO_LEGACY_SCHEMA:VIVADO_SCHEMA),'unknown saved schema');
  checkVivadoSchema(c.parsed,legacy?VIVADO_LEGACY_SCHEMA:VIVADO_SCHEMA);
  // Old top/run semantics cannot seed this regression: select an earlier start.
  if(legacy)assert(!c.parsed.operations.some(o=>o.apiCall.arguments.name==='top'||['launch_runs','wait_on_runs'].includes(o.apiCall.command))&&!c.parsed.decisions.some(d=>/set\s+as\s+top|top[- ]property|设为顶层/i.test(d.reason)),'legacy prefix contains affected semantics; start test earlier');
  const eventIds=evidence.chunks.slice(0,i).flatMap(c=>c.inputIds);
  const prior=contextChunks.length?validateVivadoProgram(mergeVivadoChunks(contextChunks),{eventIds,events:evidence.events}):null;
  const currentContext=vivadoPreviousContext(contextChunks,prior);
  assert(same(c.request.payload.previousContext,legacy?legacyContext(currentContext):currentContext),'saved prefix context chain changed');
  contextChunks.push(legacy?{...structuredClone(c.parsed),version:VIVADO_API_VERSION,topTransactions:[]}:structuredClone(c.parsed));
  validateVivadoProgram(mergeVivadoChunks(contextChunks),{eventIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),events:evidence.events,knowledgeIds:vivadoKnowledgeIds(knowledge)});
  contextProvenance.push({chunk:i+1,responseId:c.response.id,sourceRun:c.run,prefix:c.prefix,requestDigest:digest(c.request),responseDigest:digest(c.response),role:'old_model_context_not_reanalysed',legacy});
 }
 const codeFiles=['vivado-focused-test.mjs','vivado-cli.mjs','lib/vivado-state-harness.mjs','lib/vivado-program.mjs','lib/vivado-knowledge.mjs','lib/vivado-evidence.mjs','lib/gpt-client.mjs'];
 const code=await Promise.all(codeFiles.map(async file=>({file,sha256:digest(await fs.readFile(path.join(root,'src/analyzer',file)))})));
 const identity=digest({source:evidence.sourceDigest,images:evidence.images.map(i=>[i.label,i.digest]),code,knowledge,provider,from,through,maxRequests,contextProvenance});
 const directory=path.join(base,'_focused-tests',identity.slice(0,24));
 const report={identity,scope:'focused_api_regression_not_full_reanalysis',sourceRun,fromChunk:from,throughChunk:through,totalChunks:evidence.chunks.length,maxRequests,
  maxSemanticRepairs:1,networkRetries:0,model:provider.model,provider,contextProvenance,code,
  chunks:evidence.chunks.slice(from-1,through).map((c,i)=>({index:from+i,inputIds:c.inputIds,images:c.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes}))})),
  estimatedDollarCost:null,directory,generatedExecutable:false,nativeExecution:'not_run'};
 const prepared={report,evidence,knowledge,provider,contextChunks,directory};
 return options.resumeFrom?recoverFocused(options,prepared):prepared;
}

export async function runVivadoFocusedTest(options,deps={}){
 const prepared=await prepareVivadoFocusedTest(options),{report,evidence,knowledge,provider,directory,contextChunks}=prepared;
 await fs.mkdir(directory,{recursive:true});
 const reportFile=path.join(directory,'prepare.json'),statusFile=path.join(directory,'status.json');
 if(!options.analyze){await save(reportFile,report);return {status:'prepared_no_upload',...report};}
 assert(await exists(reportFile)&&same(await json(reportFile),report),'prepare and inspect unchanged focused report before upload');
 const lockFile=path.join(directory,'analysis.lock'),lock=await fs.open(lockFile,'wx');
 try{
  assert(!await exists(statusFile),'this focused test already started; inspect its result instead of silently spending again');
  const client=deps.client??await(async()=>{await loadLocalEnv(path.join(root,'.env'));const {GptClient}=await import('./lib/gpt-client.mjs');return new GptClient(provider);})();
  if(report.resume){const marker=await fs.open(path.join(report.resume.source,'resumed-by.json'),'wx');try{await marker.writeFile(JSON.stringify({identity:report.identity,directory}));}finally{await marker.close();}}
  const results=[...(prepared.reusedResults??[])],completed=[...contextChunks,...results.map(r=>r.result)];
  let requests=report.resume?.requests??0,repairs=report.resume?.repairs??0;
  const state=()=>({identity:report.identity,scope:report.scope,fromChunk:report.fromChunk,throughChunk:report.throughChunk,contextChunks:contextChunks.length,analysedChunks:results.length,requests,maxRequests:report.maxRequests,repairs,usage:[...(report.resume?.usage??[]),...(client.getUsageRecords?.()??[])],directory,generatedExecutable:false,nativeExecution:'not_run',fullyReanalysed:false});
  const validation=i=>validationAt(evidence,knowledge,i);
  try{
   await save(statusFile,{...state(),status:'started'});
   for(let i=report.fromChunk-1+results.length;i<report.throughChunk;i++){
    const chunk=evidence.chunks[i];let feedback=null;
    while(true){
     assert(requests<report.maxRequests,'request budget exhausted');
     const payload=payloadAt(evidence,knowledge,completed,i);
     if(feedback)payload.repairFeedback=feedback;
     assert(Buffer.byteLength(JSON.stringify(payload))<=VIVADO_BUDGET.maxPayloadBytes,'payload budget exceeded');
     const prefix=String(i+1).padStart(3,'0')+'-'+Date.now();
     await save(path.join(directory,prefix+'-request.json'),{identity:report.identity,payload,instructions:VIVADO_INSTRUCTIONS,schema:VIVADO_SCHEMA,provider,maxOutputTokens:VIVADO_BUDGET.maxOutputTokens,images:report.chunks.find(c=>c.index===i+1).images});
     client.onResponse=r=>save(path.join(directory,prefix+'-provider.json'),r);
     client.onFailure=r=>save(path.join(directory,prefix+'-provider-error.json'),r);
     requests++;await save(statusFile,{...state(),status:'request_started',chunk:i+1,prefix});
     const usageStart=client.getUsageRecords?.().length??0;let result;
     try{result=await client.analyze({instructions:VIVADO_INSTRUCTIONS,payload,screenshots:chunk.images.map(x=>({path:x.path,label:x.label})),outputSchema:VIVADO_SCHEMA,outputName:'vivado_state_regression',outputDescription:'Visual state transactions and model-selected native interfaces',maxOutputTokens:VIVADO_BUDGET.maxOutputTokens});}
     finally{await save(path.join(directory,prefix+'-usage.json'),{chunk:i+1,prefix,records:(client.getUsageRecords?.()??[]).slice(usageStart)});}
     await save(path.join(directory,prefix+'-parsed.json'),result);
     try{validateVivadoProgram(mergeVivadoChunks([...completed,result]),validation(i));}
     catch(e){
      await save(path.join(directory,prefix+'-validation-error.json'),{message:e.message});
      if(repairs>=report.maxSemanticRepairs||requests>=report.maxRequests)throw e;
      repairs++;feedback={validationError:e.message,previousInvalidResult:result,rule:'Use original evidence to correct this failed chunk only. Do not fabricate a frame, stable state, cancellation or native ID to pass. Preserve earlier committed calls and source events. If evidence is ambiguous, report unresolved.'};continue;
     }
     completed.push(result);results.push({chunk:i+1,prefix,result});
     await save(path.join(directory,'results.json'),{contextProvenance:report.contextProvenance,results});
     await save(statusFile,{...state(),status:'chunk_validated',chunk:i+1});break;
    }
   }
   const merged=mergeVivadoChunks(completed);
   const final=report.throughChunk===evidence.chunks.length;
   validateVivadoProgram(merged,{...validation(report.throughChunk-1),final});
   const result={...state(),status:'focused_api_structural_validation_passed',coverageComplete:results.every(r=>r.result.complete),needsIndependentVisualReview:true,topTransactions:results.flatMap(r=>r.result.topTransactions)};
   await save(statusFile,result);return result;
  }catch(e){await save(statusFile,{...state(),status:'failed',message:e.message,coverageComplete:false});throw e;}
 }finally{await lock.close();await fs.unlink(lockFile);}
}
