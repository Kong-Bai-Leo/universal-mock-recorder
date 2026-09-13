#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareVivadoEvidence, VIVADO_BUDGET, digest } from "./lib/vivado-evidence.mjs";
import { VIVADO_SCHEMA, VIVADO_INSTRUCTIONS, validateVivadoProgram, mergeVivadoChunks, vivadoChunkPosition, vivadoPreviousContext } from "./lib/vivado-program.mjs";
import {loadVivadoKnowledge, retrieveVivadoKnowledge} from "./lib/vivado-knowledge.mjs";
import { renderVivado } from "./lib/vivado-renderer.mjs";
import { buildVivadoReplayPlan } from "./lib/vivado-replay-plan.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
async function json(file) { return JSON.parse((await fs.readFile(file,"utf8")).replace(/^\uFEFF/,"")); }
async function optionalJson(file) { try { return await json(file); } catch(e) { if(e.code==="ENOENT")return null; throw e; } }
async function save(file,value) {
  const tmp=file+".tmp"; await fs.writeFile(tmp,JSON.stringify(value,null,2),{encoding:"utf8"}); await fs.rename(tmp,file);
}
// One self-contained native script is the user deliverable. The model-selected
// interface plan remains an internal audit/compilation artifact, not a prerequisite
// on the machine where the script is run.
async function writeReplayFiles(directory,program,validation) {
  const plan=buildVivadoReplayPlan(program,validation);
  const script=renderVivado(program,validation);
  const internal=path.join(directory,"_internal");
  await fs.mkdir(internal,{recursive:true});
  const planFile=path.join(internal,"replay-plan.json"),scriptFile=path.join(directory,"vivado-replay.tcl");
  await save(planFile,plan);
  const temporary=scriptFile+".tmp";
  await fs.writeFile(temporary,script,"utf8");
  await fs.rename(temporary,scriptFile);
  return {primaryOutput:scriptFile,replayScript:scriptFile,plan:planFile,
    // Backward-compatible status field; never emit a second Tcl file.
    validationScript:scriptFile};
}
async function usageAudit(run, visited=new Set()) {
  run=await fs.realpath(run);
  if(visited.has(run))throw new Error("Cyclic usage provenance");
  visited=new Set([...visited,run]);
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-usage\.json$/.test(n)).sort();
  const attempts=await Promise.all(files.map(async n=>({...await json(path.join(run,n)),sourceRun:run})));
  const currentRunAttempts=attempts.length, provenance=await optionalJson(path.join(run,"resume-provenance.json"));
  if(provenance){
    const source=await fs.realpath(provenance.sourceRun);
    if(path.dirname(source)!==path.dirname(run))throw new Error("Usage source must belong to same recording");
    attempts.push(...(await usageAudit(source,visited)).attempts);
  }
  return {attempts,currentRunAttempts,unknownUsageAttempts:attempts.filter(a=>!a.records.length).length,
    note:"Provider-reported usage only. Missing usage after a failed/unknown request is not zero cost; reconcile with provider billing."};
}

// Reused responses stay in their original run. Follow only recorded, hashed
// provenance inside this recording, never copy or silently rewrite paid output.
async function savedCandidates(run, base, visited=new Set()) {
  run=await fs.realpath(run);
  if(path.dirname(run)!==base||visited.has(run))throw new Error("Invalid/cyclic saved response provenance");
  visited=new Set([...visited,run]);
  const status=await json(path.join(run,"status.json"));
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-parsed\.json$/.test(n)).sort();
  const candidates=[];
  for(const file of files){
    const prefix=file.replace(/-parsed\.json$/,"");
    const request=await json(path.join(run,prefix+"-request.json"));
    const response=await json(path.join(run,prefix+"-provider.json"));
    const parsed=await json(path.join(run,file));
    const texts=(response.output??[]).filter(m=>m.type==="message"&&m.role==="assistant").flatMap(m=>(m.content??[]).filter(c=>c.type==="output_text").map(c=>c.text));
    if(request.identity!==status.identity||response.status!=="completed"||texts.length!==1||!isDeepStrictEqual(JSON.parse(texts[0]),parsed))throw new Error("Saved parsed result does not match provider response/identity");
    candidates.push({run,prefix,request,response,parsed});
  }
  const provenance=await optionalJson(path.join(run,"resume-provenance.json"));
  if(provenance){
    const inherited=await savedCandidates(provenance.sourceRun,base,visited);
    for(const entry of provenance.reused){
      const matches=inherited.filter(c=>c.prefix===entry.prefix&&c.response.id===entry.responseId&&digest(c.request)===entry.requestDigest&&digest(c.response)===entry.responseDigest&&c.request.payload.chunk.index===entry.chunk);
      if(matches.length!==1)throw new Error("Missing/changed inherited response provenance");
      candidates.push(matches[0]);
    }
  }
  return candidates;
}

function repairRule(){return "Correct only the failed chunk from its original evidence, without repeating committed operations or weakening validation. For chunk.index > 1 initialScene.kind must be continuation, even when the wizard has not created a project yet. create_project is session-scoped and MUST have receiverId as the empty string, not an invented session ID. Other receiverIds and commandState.selectionIds must reference existing logical native objects, never event IDs or UI control IDs. Before project creation selectionIds is empty. pendingEventIds holds pending input evidence. knowledgeIds may contain only IDs explicitly present in the supplied knowledge controls; omit unmatched IDs, never invent them. Keep exact observed parameters and legitimate dependencies.";}

// A compiler/harness revision must not silently invalidate evidence or re-upload
// already paid, valid chunks. Explicit migration verifies each original request
// and raw provider response against current evidence/contracts before reuse.
export async function recoverSavedCheckpoint(sourceRun, out, report, evidence, knowledge, provider) {
  const source=await fs.realpath(path.resolve(sourceRun)), base=await fs.realpath(out);
  if(path.dirname(source)!==base) throw new Error("Resume source must belong to this recording");
  if(await fs.stat(path.join(source,"analysis.lock")).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;})) throw new Error("Resume source is locked");
  const checkpoint=await optionalJson(path.join(source,"checkpoint.json"))??{completed:[]};
  const oldStatus=await json(path.join(source,"status.json"));
  if(!Array.isArray(checkpoint.completed)||checkpoint.completed.length>=evidence.chunks.length) throw new Error("No unfinished saved checkpoint to resume");
  const same=(a,b)=>isDeepStrictEqual(a,JSON.parse(JSON.stringify(b)));
  const candidates=await savedCandidates(source,base);
  const completed=[],provenance=[];
  let repairFeedback=null;
  for(let i=0;i<=checkpoint.completed.length;i++) {
    const chunk=evidence.chunks[i], eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
    const prior=completed.length?validateVivadoProgram(mergeVivadoChunks(completed),{eventIds}):null;
    const matches=[];
    for(const candidate of candidates) {
      const {prefix,request,parsed,response}=candidate;
      if(request.payload?.chunk?.index!==i+1)continue;
      const expected={chunk:vivadoChunkPosition(i+1,evidence.chunks.length),inputs:chunk.events,nativeApiCatalog:knowledge.commands,
        knowledge:retrieveVivadoKnowledge(knowledge,{texts:chunk.events.flatMap(e=>[e.target?.name,e.window?.title,e.text].filter(Boolean))}),
        sourceScope:{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets},
        allowedEvidenceIds:eventIds,previousContext:vivadoPreviousContext(completed,prior)};
      if(!same(request.schema,VIVADO_SCHEMA)||request.instructions!==VIVADO_INSTRUCTIONS||!same(request.provider,provider)||request.maxOutputTokens!==VIVADO_BUDGET.maxOutputTokens||
        Object.entries(expected).some(([k,v])=>!same(request.payload[k],v))||!same(request.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})))) throw new Error("Saved checkpoint evidence/contract changed; refusing paid-response reuse");
      matches.push({prefix,request,parsed,response});
    }
    if(i<checkpoint.completed.length) {
      const valid=matches.filter(m=>same(m.parsed,checkpoint.completed[i]));
      if(valid.length!==1)throw new Error("Ambiguous/missing valid checkpoint provenance");
      completed.push(valid[0].parsed);
      validateVivadoProgram(mergeVivadoChunks(completed),{eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id)});
      provenance.push({chunk:i+1,responseId:valid[0].response.id,prefix:valid[0].prefix,requestDigest:digest(valid[0].request),responseDigest:digest(valid[0].response)});
    } else if(oldStatus.failurePhase==="chunk_validation"&&oldStatus.chunk===i+1&&matches.length===1) {
      repairFeedback={validationError:oldStatus.message,previousInvalidResult:matches[0].parsed,
        rule:repairRule()};
    }
  }
  return {identity:report.identity,completed,provenance:{sourceRun:source,sourceIdentity:oldStatus.identity,reused:provenance,priorUsage:await usageAudit(source)},repairFeedback};
}

export async function runVivadoAnalysis(options, deps={}) {
  if(options.compileSavedRun) {
    if(options.analyze||options.retryFailed||options.prepareOnly) throw new Error("离线编译不能与准备/上传/重试同时使用");
    return compileSavedVivadoAnalysis(options);
  }
  const recording=path.resolve(options.recording);
  const config=await json(path.resolve(options.config??path.join(root,"config.json")));
  // Keep the selected model/effort/detail; only transport/request budgets differ.
  const provider=Object.fromEntries(["model","reasoningEffort","verbosity","imageDetail","timeoutSeconds","streamResponses","uploadChunkBytes"].filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
  if (!provider.model) throw new Error("provider.model 未配置；不会擅自选择模型");
  provider.maxRetries=0; provider.maxRequestBytes=VIVADO_BUDGET.maxRequestBytes;
  const evidence=await prepareVivadoEvidence(recording);
  const knowledge=await loadVivadoKnowledge(root);
  const codeFiles=["vivado-cli.mjs","lib/vivado-evidence.mjs","lib/vivado-program.mjs","lib/vivado-replay-plan.mjs","lib/vivado-renderer.mjs","lib/vivado-knowledge.mjs","lib/gpt-client.mjs"];
  const identity=digest({source:evidence.sourceDigest,images:evidence.images.map(i=>({label:i.label,digest:i.digest})),knowledge,provider,budget:VIVADO_BUDGET,code:await Promise.all(codeFiles.map(async p=>digest(await fs.readFile(path.join(root,"src/analyzer",p)))))});
  const out=path.join(recording,"generated-vivado"), run=path.join(out,identity.slice(0,24));
  await fs.mkdir(run,{recursive:true});
  const reportFile=path.join(out,"prepare-report.json"), previousReport=await optionalJson(reportFile);
  const report={identity,application:"Vivado 2024.2",sourceRecording:recording,model:provider.model,outputContract:"standalone_vivado_tcl_v1",internalContract:"model_selected_native_tcl_calls_v1",primaryOutput:"vivado-replay.tcl",
    imageDetail:provider.imageDetail??"high",warnings:[...(provider.imageDetail==="low"?["当前配置为 low 图像细节，小参数标签可能不可读；未擅自修改模型配置。"]:[]),"First release supports isolated RTL project configuration and evidence-backed HDL plus bounded Tcl calls. IP/block designs/hardware are not supported. Execution is separate."],
    inputEvents:evidence.events.length,chunks:evidence.chunks.map((c,i)=>({index:i+1,inputIds:c.inputIds,images:c.images.map(x=>({file:x.label,bytes:x.bytes,sha256:x.digest}))})),
    excluded:evidence.excluded,temporalWarnings:evidence.temporalWarnings,imageAliases:evidence.imageAliases,
    imageCounts:{sourceFiles:evidence.images.length,uniqueContent:new Set(evidence.images.map(i=>i.digest)).size,requestImageSlots:evidence.chunks.reduce((n,c)=>n+c.images.length,0)},
    budget:VIVADO_BUDGET,estimatedDollarCost:null,
    priceNote:"准备不调用 API。费用按实际模型用量计；图片数量不是报价，输出上限不含输入费用。",runDirectory:run};
  if (!options.analyze) { await save(reportFile,report); return {status:"prepared_no_upload",report:reportFile,chunks:evidence.chunks.length}; }
  if (previousReport?.identity!==identity) throw new Error("请先重新准备分析并查看报告；录制/图片/模型/代码/知识库发生变化，旧确认不再适用。");
  const lockFile=path.join(run,"analysis.lock");
  let lock;
  try { lock=await fs.open(lockFile,"wx"); } catch(e) { if(e.code==="EEXIST")throw new Error("同一录制正在分析或上次异常退出留下锁；先确认没有分析进程，勿重复付费请求。"); throw e; }
  let client, requests=0, phase="checkpoint_validation", activeChunk=null, activeAttempt=null, previousStatus=null;
  const checkpointFile=path.join(run,"checkpoint.json"), statusFile=path.join(run,"status.json");
  try {
    previousStatus=await optionalJson(statusFile);
    if (["failed","request_started"].includes(previousStatus?.status)&&!options.retryFailed) throw new Error("上一轮失败或请求结果未知；已有结果保留。确认重试可能产生费用后显式使用 --retry-failed。");
    let checkpoint=await optionalJson(checkpointFile);
    if(options.resumeSavedRun&&!checkpoint) {
      if(!options.retryFailed)throw new Error("Explicit --retry-failed is required with --resume-saved-run");
      checkpoint=await recoverSavedCheckpoint(options.resumeSavedRun,out,report,evidence,knowledge,provider);
      await save(checkpointFile,checkpoint);
      await save(path.join(run,"resume-provenance.json"),checkpoint.provenance);
    }
    checkpoint??={identity,completed:[]};
    if (checkpoint.identity!==identity || !Array.isArray(checkpoint.completed) || checkpoint.completed.length>evidence.chunks.length) throw new Error("Invalid checkpoint");
    const completed=checkpoint.completed;
    const validationFor = i => ({eventIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),currentInputIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),knowledgeIds:knowledge.controls.map(c=>c.id)});
    let catalog={objects:[],artifacts:[]};
    for(let i=0;i<completed.length;i++) catalog=validateVivadoProgram(mergeVivadoChunks(completed.slice(0,i+1)),validationFor(i));
    if(options.retryFailed&&!checkpoint.repairFeedback&&previousStatus?.failurePhase==="chunk_validation"&&previousStatus.chunk===completed.length+1){
      const failed=(await savedCandidates(run,await fs.realpath(out))).filter(c=>c.run===run&&c.request.payload.chunk.index===previousStatus.chunk&&(!previousStatus.attempt||c.prefix===previousStatus.attempt)).sort((a,b)=>a.prefix.localeCompare(b.prefix)).at(-1);
      if(failed)checkpoint.repairFeedback={validationError:previousStatus.message,previousInvalidResult:failed.parsed,rule:repairRule()};
    }
    if (completed.length<evidence.chunks.length) {
      if (deps.client) client=deps.client;
      else { await loadLocalEnv(path.join(root,".env")); const {GptClient}=await import("./lib/gpt-client.mjs"); client=new GptClient(provider); }
    }
    for(let i=completed.length;i<evidence.chunks.length&&requests<VIVADO_BUDGET.maxRequestsPerRound;i++) {
      const chunk=evidence.chunks[i];
      activeChunk=i+1;
      const payload={application:report.application,chunk:vivadoChunkPosition(i+1,evidence.chunks.length),
        interfaceBindingRules:{initialScene:i===0?"Establish blank/unknown/existing from evidence":"MUST use continuation; this is not a new recording, even if the wizard is still pending",createProjectReceiverId:"Must be the empty string. No invented session ID.",selectionIds:"Only existing native object logical IDs. Never event IDs or UI IDs; empty before project creation.",knowledgeIds:"Only supplied knowledge control IDs; unmatched may be empty, never invented."},
        sourceScope:{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets},
        inputs:chunk.events,nativeApiCatalog:knowledge.commands,knowledge:retrieveVivadoKnowledge(knowledge,{texts:chunk.events.flatMap(e=>[e.target?.name,e.window?.title,e.text].filter(Boolean))}),previousContext:vivadoPreviousContext(completed,catalog),
        allowedEvidenceIds:validationFor(i).eventIds,
        temporalRule:"Read frame timestamps. Frames marked later_inputs_may_be_visible cannot isolate an earlier action. They still show the later observed state. screenshotSettledAfter is an additional delayed observation, not a guarantee of stability or command completion. Inspect committed project settings, sources and terminal run status, not previews. A frame's uploadImageLabel identifies the supplied image; label is its original recording file. Identical-file deduplication shares pixels only, not timestamps, action identities or parameter roles."};
      if(checkpoint.repairFeedback&&i===checkpoint.completed.length)payload.repairFeedback=checkpoint.repairFeedback;
      if(Buffer.byteLength(JSON.stringify(payload))>VIVADO_BUDGET.maxPayloadBytes) throw new Error("跨段上下文超出文本预算；未截断实体目录或上传，请缩短录制。");
      const attempt=String(i+1).padStart(3,"0")+"-"+Date.now();
      activeAttempt=attempt;
      await save(path.join(run,attempt+"-request.json"),{identity,payload,instructions:VIVADO_INSTRUCTIONS,schema:VIVADO_SCHEMA,images:chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})),provider,maxOutputTokens:VIVADO_BUDGET.maxOutputTokens});
      client.onResponse=response=>save(path.join(run,attempt+"-provider.json"),response);
      client.onFailure=failure=>save(path.join(run,attempt+"-provider-error.json"),failure);
      await save(statusFile,{status:"request_started",identity,chunk:i+1,attempt,usage:client.getUsageRecords?.()??[]});
      requests++;
      const usageStart=client.getUsageRecords?.().length??0;
      let result;
      phase="request";
      try {
        result=await client.analyze({instructions:VIVADO_INSTRUCTIONS,payload,screenshots:chunk.images.map(x=>({path:x.path,label:x.label})),outputSchema:VIVADO_SCHEMA,outputName:"vivado_api_plan",outputDescription:"Evidence-grounded operations with explicit native interface choices, receivers and arguments",maxOutputTokens:VIVADO_BUDGET.maxOutputTokens});
      } finally {
        await save(path.join(run,attempt+"-usage.json"),{attempt,chunk:i+1,records:(client.getUsageRecords?.()??[]).slice(usageStart)});
      }
      await save(path.join(run,attempt+"-parsed.json"),result);
      phase="chunk_validation";
      catalog=validateVivadoProgram(mergeVivadoChunks([...completed,result]),validationFor(i));
      completed.push(result); checkpoint.repairFeedback=null; await save(checkpointFile,{identity,completed,provenance:checkpoint.provenance});
      await save(statusFile,{status:"chunk_validated",identity,completed:completed.length,total:evidence.chunks.length,usage:client.getUsageRecords?.()??[]});
    }
    if(completed.length<evidence.chunks.length) {
      const result={status:"budget_paused",identity,completed:completed.length,total:evidence.chunks.length,requestsThisRound:requests,runDirectory:run,usage:await usageAudit(run)}; await save(statusFile,result); return result;
    }
    const program=mergeVivadoChunks(completed), validation=validationFor(completed.length-1);
    phase="final_validation";
    const files=await writeReplayFiles(run,program,validation);
    const result={status:"replay_script_generated_not_executed",identity,...files,requestsThisRound:requests,verification:"not_run",sourceRecordingCompared:false,usage:await usageAudit(run)}; await save(statusFile,result); return result;
  } catch(e) {
    // A blocked retry is not a new request failure. Keep the original error and
    // attempt identity so explicit retry can repair exactly that response.
    if(requests===0&&["failed","request_started"].includes(previousStatus?.status)&&!options.retryFailed)throw e;
    await save(statusFile,{status:"failed",identity,message:e.message,failurePhase:phase,chunk:activeChunk,
      attempt:activeAttempt,
      providerError:phase==="request"?{status:e.status??null,code:e.code??null,requestId:e.requestId??null,clientRequestId:e.clientRequestId??null}:null,
      validationError:phase.endsWith("validation")?{code:e.code??"VIVADO_VALIDATION_FAILED",message:e.message}:null,
      requestsThisRound:requests,usage:await usageAudit(run),executableValid:false}); throw e;
  } finally { await lock.close(); await fs.unlink(lockFile); }
}

// Explicit offline recovery after a local validator/compiler fix. Never load keys,
// instantiate a client, mutate paid responses, or bypass evidence/schema checks.
export async function compileSavedVivadoAnalysis(options) {
  const recording=await fs.realpath(path.resolve(options.recording));
  const out=await fs.realpath(path.join(recording,"generated-vivado"));
  const run=await fs.realpath(path.resolve(options.compileSavedRun));
  if(path.dirname(run)!==out) throw new Error("Saved run must be directly inside this recording's generated-vivado directory");
  const locked=await fs.stat(path.join(run,"analysis.lock")).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;});
  if(locked) throw new Error("Saved analysis is locked");
  const report=await json(path.join(out,"prepare-report.json"));
  const evidence=await prepareVivadoEvidence(recording),knowledge=await loadVivadoKnowledge(root);
  const candidates=await savedCandidates(run,out);
  if(candidates.length!==evidence.chunks.length) throw new Error("Offline compilation requires exactly one saved response for every chunk; missing/ambiguous responses");
  const chunks=[],provenance=[];
  for(let i=0;i<evidence.chunks.length;i++) {
    const matches=candidates.filter(c=>c.request.payload?.chunk?.index===i+1);
    if(matches.length!==1) throw new Error("Offline compilation requires exactly one saved response for every chunk; missing/ambiguous chunk "+(i+1));
    const {prefix,request,response,parsed}=matches[0],chunk=evidence.chunks[i];
    const same=(a,b)=>{if(!isDeepStrictEqual(a,JSON.parse(JSON.stringify(b))))throw new Error("Saved request no longer matches current evidence/schema/knowledge; refusing offline reuse");};
    same(request.provider,candidates[0].request.provider);same(request.schema,VIVADO_SCHEMA);same(request.instructions,VIVADO_INSTRUCTIONS);
    same(request.payload.chunk,vivadoChunkPosition(i+1,evidence.chunks.length));
    same(request.payload.inputs,chunk.events);same(request.payload.nativeApiCatalog,knowledge.commands);
    same(request.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})));
    same(request.payload.sourceScope,{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets});
    same(request.payload.knowledge,retrieveVivadoKnowledge(knowledge,{texts:chunk.events.flatMap(e=>[e.target?.name,e.window?.title,e.text].filter(Boolean))}));
    const eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
    same(request.payload.allowedEvidenceIds,eventIds);
    const prior=chunks.length?validateVivadoProgram(mergeVivadoChunks(chunks),{eventIds}):null;
    const withoutReportOperationLabels=context=>context;
    same(withoutReportOperationLabels(request.payload.previousContext),withoutReportOperationLabels(vivadoPreviousContext(chunks,prior)));
    chunks.push(parsed);
    validateVivadoProgram(mergeVivadoChunks(chunks),{eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id)});
    provenance.push({chunk:i+1,prefix,responseId:response.id,requestDigest:digest(request),responseDigest:digest(response),parsedDigest:digest(parsed),operationIds:parsed.operations.map((o,j)=>({original:o.id,compiled:`chunk-${i+1}-op-${j+1}`}))});
  }
  const program=mergeVivadoChunks(chunks),eventIds=evidence.chunks.flatMap(c=>c.inputIds);
  const validation={eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id)};
  buildVivadoReplayPlan(program,validation);
  const destination=await fs.mkdtemp(path.join(out,"offline-compile-"));
  const files=await writeReplayFiles(destination,program,validation);
  const result={status:"saved_replay_script_generated_not_executed",sourceRun:run,sourceIdentity:report.identity,...files,requestsThisRound:0,sourceRecordingCompared:false,verification:"not_run",provenance,compilerDigest:digest(await fs.readFile(path.join(root,"src/analyzer/lib/vivado-renderer.mjs"))),validatorDigest:digest(await fs.readFile(path.join(root,"src/analyzer/lib/vivado-program.mjs"))),interfaceContractDigest:digest(VIVADO_SCHEMA),usage:await usageAudit(run)};
  await save(path.join(destination,"status.json"),result);return result;
}

async function main() {
  const args=process.argv.slice(2), opts={};
  while(args.length) {
    const arg=args.shift();
    if(["--analyze","--retry-failed"].includes(arg)) opts[arg==="--analyze"?"analyze":"retryFailed"]=true;
    else if(arg==="--prepare-only") opts.prepareOnly=true;
    else if(arg==="--export-validation-tcl") { /* Legacy flag: native Tcl is now always generated. */ }
    else if(arg==="--compile-saved-run"&&args.length) opts.compileSavedRun=args.shift();
    else if(arg==="--resume-saved-run"&&args.length) opts.resumeSavedRun=args.shift();
    else if(["--recording","--config"].includes(arg)&&args.length) opts[arg.slice(2)]=args.shift();
    else throw new Error("Usage: vivado-cli.mjs --recording <folder> [--config <json>] [--prepare-only | --analyze [--retry-failed [--resume-saved-run <run-folder>]] | --compile-saved-run <run-folder>] [--export-validation-tcl]");
  }
  if(!opts.recording||opts.analyze&&opts.prepareOnly) throw new Error("Specify recording and exactly one analysis mode");
  console.log(JSON.stringify(await runVivadoAnalysis(opts),null,2));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
