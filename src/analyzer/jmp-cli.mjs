#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareJmpEvidence, JMP_BUDGET, digest } from "./lib/jmp-evidence.mjs";
import { jmpSchemaFor, jmpInstructionsFor, validateJmpProgram, mergeJmpChunks, jmpChunkPosition, jmpPreviousContext } from "./lib/jmp-program.mjs";
import {loadJmpKnowledge, retrieveJmpKnowledge} from "./lib/jmp-knowledge.mjs";
import {resolveJmpVersion} from "./lib/jmp-version.mjs";
import { renderJmp } from "./lib/jmp-renderer.mjs";
import { buildJmpReplayPlan } from "./lib/jmp-replay-plan.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const TEMPORAL_RULE="Read frame timestamps. Frames marked later_inputs_may_be_visible cannot isolate an earlier action. They still show the later observed state. screenshotSettledAfter is an additional delayed observation, not a guarantee of stability or command completion. Do not assert committed solely from a preview or a delayed after-frame: inspect visible committed cells, completed reports and command state. A frame's uploadImageLabel identifies the supplied image; label is its original recording file. Identical-file deduplication shares pixels only, not timestamps, action identities or parameter roles.";
async function json(file) { return JSON.parse((await fs.readFile(file,"utf8")).replace(/^\uFEFF/,"")); }
async function optionalJson(file) { try { return await json(file); } catch(e) { if(e.code==="ENOENT")return null; throw e; } }
async function save(file,value) {
  const tmp=file+".tmp"; await fs.writeFile(tmp,JSON.stringify(value,null,2),{encoding:"utf8"}); await fs.rename(tmp,file);
}
async function writeReplayFiles(directory,program,validation,target) {
  // Validate and compile before publishing any deliverable. Model calls stay
  // auditable internally; the standalone JSL needs neither JSON nor an executor AI.
  const plan=buildJmpReplayPlan(program,validation,'model_response',target),script=renderJmp(program,validation,{target});
  const internal=path.join(directory,"_internal");
  await fs.mkdir(internal,{recursive:true});
  const planFile=path.join(internal,"replay-plan.json"),scriptFile=path.join(directory,"jmp-replay.jsl");
  await save(planFile,plan);
  await fs.writeFile(scriptFile+".tmp",script,"utf8");
  await fs.rename(scriptFile+".tmp",scriptFile);
  // Keep the old result key as an alias, not a second runnable file.
  return {primaryOutput:scriptFile,replayScript:scriptFile,plan:planFile,validationScript:scriptFile,replaySemantics:"validated_final_state"};
}
async function usageAudit(run, importedFrom=null) {
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-usage\.json$/.test(n)).sort();
  const attempts=await Promise.all(files.map(n=>json(path.join(run,n))));
  const importedAttempts=importedFrom?await Promise.all(importedFrom.provenance.map(async p=>{
    const file=path.join(importedFrom.run,p.prefix+"-usage.json");
    return fs.readFile(file,"utf8").then(s=>({...JSON.parse(s),sourceRun:importedFrom.run,sourcePrefix:p.prefix}),e=>{if(e.code==="ENOENT")return {attempt:p.prefix,chunk:p.chunk,records:[],sourceRun:importedFrom.run,sourcePrefix:p.prefix,usageFileMissing:true};throw e;});
  })):[];
  const seen=new Set(),all=[...importedAttempts,...attempts].filter(a=>{const key=(a.sourceRun??run)+"/"+(a.sourcePrefix??a.attempt);if(seen.has(key))return false;seen.add(key);return true;});
  return {attempts,importedAttempts,allAttempts:all,unknownUsageAttempts:all.filter(a=>!a.records?.length).length,
    note:"Provider-reported usage only. Missing usage after a failed/unknown request is not zero cost; reconcile with provider billing."};
}
async function locked(run) { return fs.stat(path.join(run,"analysis.lock")).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;}); }
const sameSaved=(a,b)=>{if(!isDeepStrictEqual(a,JSON.parse(JSON.stringify(b))))throw new Error("Saved request no longer matches current evidence/schema/knowledge/provider; refusing offline reuse");};
async function verifySavedPrefix(sourceRun,context) {
  const {recording,evidence,target,knowledge,schema,instructions,provider}=context;
  const out=await fs.realpath(path.join(recording,"generated-jmp")),run=await fs.realpath(sourceRun);
  if(path.dirname(run)!==out) throw new Error("Saved run must be directly inside this recording's generated-jmp directory");
  if(await locked(run)) throw new Error("Saved analysis is locked");
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-parsed\.json$/.test(n)).sort();
  if(!files.length)throw new Error("No saved responses");
  const candidates=await Promise.all(files.map(async file=>{
    const prefix=file.replace(/-parsed\.json$/,""),request=await json(path.join(run,prefix+"-request.json"));
    return {prefix,request,response:await json(path.join(run,prefix+"-provider.json")),parsed:await json(path.join(run,file))};
  }));
  const sourceIdentity=candidates[0].request.identity;
  if(typeof sourceIdentity!=="string"||path.basename(run)!==sourceIdentity.slice(0,24))throw new Error("Saved run identity/path mismatch");
  const counts=new Map();
  for(const c of candidates) {
    sameSaved(c.request.identity,sourceIdentity);
    const index=c.request.payload?.chunk?.index;
    if(!Number.isInteger(index)||index<1||index>evidence.chunks.length)throw new Error("Saved response chunk index invalid");
    counts.set(index,(counts.get(index)??0)+1);
  }
  if([...counts.values()].some(n=>n!==1))throw new Error("Ambiguous saved responses");
  const indexes=[...counts.keys()].sort((a,b)=>a-b);
  if(indexes.some((n,i)=>n!==i+1))throw new Error("Gap in saved response prefix");
  const chunks=[],provenance=[];
  for(let i=0;i<indexes.length;i++) {
    const {prefix,request,response,parsed}=candidates.find(c=>c.request.payload.chunk.index===i+1),chunk=evidence.chunks[i];
    if(parsed.version!=="2.0")throw new Error("Saved response is not JMP API plan 2.0");
    const texts=(response.output??[]).filter(x=>x.type==="message"&&x.role==="assistant").flatMap(m=>(m.content??[]).filter(c=>c.type==="output_text").map(c=>c.text));
    if(response.status!=="completed"||texts.length!==1||!isDeepStrictEqual(JSON.parse(texts[0]),parsed))throw new Error("Saved parsed result does not match its completed provider response");
    sameSaved(request.provider,provider);sameSaved(request.maxOutputTokens,JMP_BUDGET.maxOutputTokens);
    sameSaved(request.schema,schema);sameSaved(request.instructions,instructions);
    sameSaved(request.payload.application,target.displayName);
    sameSaved(request.payload.chunk,jmpChunkPosition(i+1,evidence.chunks.length));
    sameSaved(request.payload.inputs,chunk.events);
    sameSaved(request.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})));
    sameSaved(request.payload.sourceScope,{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets});
    sameSaved(request.payload.knowledge,retrieveJmpKnowledge(knowledge,chunk.events,chunks.at(-1)?.commandState));
    const eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
    sameSaved(request.payload.allowedEvidenceIds,eventIds);
    sameSaved(request.payload.temporalRule,TEMPORAL_RULE);
    const priorIds=evidence.chunks.slice(0,i).flatMap(c=>c.inputIds);
    const prior=chunks.length?validateJmpProgram(mergeJmpChunks(chunks),{eventIds:priorIds,currentInputIds:priorIds,knowledgeIds:knowledge.controls.map(c=>c.id),apiCatalogVersion:target.apiCatalogVersion}):null;
    const strip=context=>context?{...context,catalog:{...context.catalog,reports:context.catalog.reports.map(({id,...report})=>report)}}:null;
    sameSaved(strip(request.payload.previousContext),strip(jmpPreviousContext(chunks,prior)));
    chunks.push(parsed);
    validateJmpProgram(mergeJmpChunks(chunks),{eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id),apiCatalogVersion:target.apiCatalogVersion});
    provenance.push({chunk:i+1,prefix,requestDigest:digest(request),responseDigest:digest(response),parsedDigest:digest(parsed)});
  }
  return {run,sourceIdentity,chunks,provenance};
}

export async function resumeSavedJmpAnalysis(options) {
  const recording=await fs.realpath(path.resolve(options.recording));
  const sourceRun=await fs.realpath(path.resolve(options.resumeSavedRun));
  if(await locked(sourceRun))throw new Error("Saved analysis is locked");
  const prepared=await runJmpAnalysis({...options,recording,resumeSavedRun:undefined,prepareOnly:true});
  const report=await json(prepared.report),run=report.runDirectory;
  if(await fs.realpath(run)===sourceRun)throw new Error("Source and destination run are the same");
  if(await locked(run))throw new Error("Destination analysis is locked");
  if((await fs.readdir(run)).length)throw new Error("Destination run is not empty; refusing overwrite");
  const config=await json(path.resolve(options.config??path.join(root,"config.json")));
  const provider=Object.fromEntries(["model","reasoningEffort","verbosity","imageDetail","timeoutSeconds","streamResponses","uploadChunkBytes"].filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
  provider.maxRetries=0;provider.maxRequestBytes=JMP_BUDGET.maxRequestBytes;
  const evidence=await prepareJmpEvidence(recording),target=report.target,knowledge=await loadJmpKnowledge(root,target);
  const verified=await verifySavedPrefix(sourceRun,{recording,evidence,target,knowledge,schema:jmpSchemaFor(target),instructions:jmpInstructionsFor(target),provider});
  const lockFile=path.join(run,"analysis.lock"),lock=await fs.open(lockFile,"wx");
  try {
    if((await fs.readdir(run)).some(n=>n!=="analysis.lock"))throw new Error("Destination run changed; refusing overwrite");
    await save(path.join(run,"checkpoint.json"),{identity:report.identity,completed:verified.chunks,importedFrom:{run:verified.run,sourceIdentity:verified.sourceIdentity,provenance:verified.provenance}});
    const result={status:"saved_prefix_imported_no_upload",identity:report.identity,runDirectory:run,sourceRun:verified.run,completed:verified.chunks.length,total:evidence.chunks.length,requestsThisRound:0,provenance:verified.provenance};
    await save(path.join(run,"status.json"),result);return result;
  } finally {await lock.close();await fs.unlink(lockFile);}
}

export async function runJmpAnalysis(options, deps={}) {
  if(options.resumeSavedRun) {
    if(options.analyze||options.retryFailed||options.prepareOnly||options.compileSavedRun) throw new Error("离线续用不能与准备/上传/重试/离线编译同时使用");
    return resumeSavedJmpAnalysis(options);
  }
  if(options.compileSavedRun) {
    if(options.analyze||options.retryFailed||options.prepareOnly) throw new Error("离线编译不能与准备/上传/重试同时使用");
    return compileSavedJmpAnalysis(options);
  }
  const recording=path.resolve(options.recording);
  const config=await json(path.resolve(options.config??path.join(root,"config.json")));
  // Keep the selected model/effort/detail; only transport/request budgets differ.
  const provider=Object.fromEntries(["model","reasoningEffort","verbosity","imageDetail","timeoutSeconds","streamResponses","uploadChunkBytes"].filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
  if (!provider.model) throw new Error("provider.model 未配置；不会擅自选择模型");
  provider.maxRetries=0; provider.maxRequestBytes=JMP_BUDGET.maxRequestBytes;
  const evidence=await prepareJmpEvidence(recording);
  const target=resolveJmpVersion(evidence.manifest,config.jmp??{},options);
  const knowledge=await loadJmpKnowledge(root,target),schema=jmpSchemaFor(target),instructions=jmpInstructionsFor(target);
  const codeFiles=["jmp-cli.mjs","lib/jmp-evidence.mjs","lib/jmp-program.mjs","lib/jmp-version.mjs","lib/jmp-api-contract.mjs","lib/jmp-replay-plan.mjs","lib/jmp-renderer.mjs","lib/jmp-knowledge.mjs","lib/gpt-client.mjs"];
  const identity=digest({source:evidence.sourceDigest,images:evidence.images.map(i=>({label:i.label,digest:i.digest})),target,knowledge,provider,budget:JMP_BUDGET,code:await Promise.all(codeFiles.map(async p=>digest(await fs.readFile(path.join(root,"src/analyzer",p)))))});
  const out=path.join(recording,"generated-jmp"), run=path.join(out,identity.slice(0,24));
  await fs.mkdir(run,{recursive:true});
  const reportFile=path.join(out,"prepare-report.json"), previousReport=await optionalJson(reportFile);
  const report={identity,application:target.displayName,target,sourceRecording:recording,model:provider.model,outputContract:"standalone_jmp_jsl_v1",internalContract:"model_selected_interfaces_and_operations_v2",primaryOutput:"jmp-replay.jsl",replaySemantics:"validated_final_state",
    imageDetail:provider.imageDetail??"high",warnings:[...(provider.imageDetail==="low"?["当前配置为 low 图像细节，小参数标签可能不可读；未擅自修改模型配置。"]:[]),"First backend supports small explicit data tables, continuous numeric Distribution and Bivariate/Fit Line only. Native execution and recording comparison require separate verification."],
    inputEvents:evidence.events.length,chunks:evidence.chunks.map((c,i)=>({index:i+1,inputIds:c.inputIds,images:c.images.map(x=>({file:x.label,bytes:x.bytes,sha256:x.digest}))})),
    excluded:evidence.excluded,temporalWarnings:evidence.temporalWarnings,imageAliases:evidence.imageAliases,
    imageCounts:{sourceFiles:evidence.images.length,uniqueContent:new Set(evidence.images.map(i=>i.digest)).size,requestImageSlots:evidence.chunks.reduce((n,c)=>n+c.images.length,0)},
    budget:JMP_BUDGET,estimatedDollarCost:null,
    priceNote:"准备不调用 API。费用按实际模型用量计；图片数量不是报价，输出上限不含输入费用。",runDirectory:run};
  if (!options.analyze) { await save(reportFile,report); return {status:"prepared_no_upload",report:reportFile,chunks:evidence.chunks.length}; }
  if (previousReport?.identity!==identity) throw new Error("请先重新准备分析并查看报告；录制/图片/模型/代码/知识库发生变化，旧确认不再适用。");
  const lockFile=path.join(run,"analysis.lock");
  let lock;
  try { lock=await fs.open(lockFile,"wx"); } catch(e) { if(e.code==="EEXIST")throw new Error("同一录制正在分析或上次异常退出留下锁；先确认没有分析进程，勿重复付费请求。"); throw e; }
  let client, requests=0, phase="checkpoint_validation", activeChunk=null;
  const checkpointFile=path.join(run,"checkpoint.json"), statusFile=path.join(run,"status.json");
  try {
    const previousStatus=await optionalJson(statusFile);
    if (["failed","request_started"].includes(previousStatus?.status)&&!options.retryFailed) throw new Error("上一轮失败或请求结果未知；已有结果保留。确认重试可能产生费用后显式使用 --retry-failed。");
    const checkpoint=await optionalJson(checkpointFile)??{identity,completed:[]};
    if (checkpoint.identity!==identity || !Array.isArray(checkpoint.completed) || checkpoint.completed.length>evidence.chunks.length) throw new Error("Invalid checkpoint");
    if (checkpoint.importedFrom) {
      const verified=await verifySavedPrefix(checkpoint.importedFrom.run,{recording,evidence,target,knowledge,schema,instructions,provider,identity});
      const prefixCount=verified.chunks.length;
      if (prefixCount>checkpoint.completed.length || !isDeepStrictEqual(verified.chunks,checkpoint.completed.slice(0,prefixCount)) ||
          !isDeepStrictEqual(verified.provenance,checkpoint.importedFrom.provenance)) throw new Error("Imported checkpoint provenance changed");
      const localAttempts=checkpoint.localAttempts??[];
      if(localAttempts.length!==checkpoint.completed.length-prefixCount)throw new Error("Local checkpoint provenance missing");
      for(let j=0;j<localAttempts.length;j++) {
        const record=localAttempts[j],index=prefixCount+j+1;
        if(record.chunk!==index || !/^\d{3}-\d+$/.test(record.prefix))throw new Error("Local checkpoint provenance invalid");
        const savedRequest=await json(path.join(run,record.prefix+"-request.json"));
        const savedParsed=await json(path.join(run,record.prefix+"-parsed.json"));
        const savedResponse=await json(path.join(run,record.prefix+"-provider.json"));
        const texts=(savedResponse.output??[]).filter(x=>x.type==="message"&&x.role==="assistant").flatMap(m=>(m.content??[]).filter(c=>c.type==="output_text").map(c=>c.text));
        if(savedResponse.status!=="completed"||texts.length!==1||!isDeepStrictEqual(JSON.parse(texts[0]),savedParsed)||
          !isDeepStrictEqual(savedParsed,checkpoint.completed[index-1])||savedRequest.identity!==identity||
          savedRequest.payload?.chunk?.index!==index||!isDeepStrictEqual(savedRequest.provider,provider)||
          digest(savedRequest)!==record.requestDigest||digest(savedResponse)!==record.responseDigest||digest(savedParsed)!==record.parsedDigest)
          throw new Error("Local checkpoint provenance changed");
      }
    }
    const completed=checkpoint.completed;
    const validationFor = i => ({eventIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),currentInputIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),knowledgeIds:knowledge.controls.map(c=>c.id),apiCatalogVersion:target.apiCatalogVersion});
    let catalog={tables:[],reports:[]};
    for(let i=0;i<completed.length;i++) catalog=validateJmpProgram(mergeJmpChunks(completed.slice(0,i+1)),validationFor(i));
    if (completed.length<evidence.chunks.length) {
      if (deps.client) client=deps.client;
      else { await loadLocalEnv(path.join(root,".env")); const {GptClient}=await import("./lib/gpt-client.mjs"); client=new GptClient(provider); }
    }
    for(let i=completed.length;i<evidence.chunks.length&&requests<JMP_BUDGET.maxRequestsPerRound;i++) {
      const chunk=evidence.chunks[i];
      activeChunk=i+1;
      const payload={application:report.application,chunk:jmpChunkPosition(i+1,evidence.chunks.length),
        sourceScope:{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets},
        inputs:chunk.events,knowledge:retrieveJmpKnowledge(knowledge,chunk.events,completed.at(-1)?.commandState),previousContext:jmpPreviousContext(completed,catalog),
        allowedEvidenceIds:validationFor(i).eventIds,
        temporalRule:TEMPORAL_RULE};
      if(Buffer.byteLength(JSON.stringify(payload))>JMP_BUDGET.maxPayloadBytes) throw new Error("跨段上下文超出文本预算；未截断实体目录或上传，请缩短录制。");
      const attempt=String(i+1).padStart(3,"0")+"-"+Date.now();
      await save(path.join(run,attempt+"-request.json"),{identity,payload,instructions,schema,images:chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})),provider,maxOutputTokens:JMP_BUDGET.maxOutputTokens});
      client.onResponse=response=>save(path.join(run,attempt+"-provider.json"),response);
      client.onFailure=failure=>save(path.join(run,attempt+"-provider-error.json"),failure);
      await save(statusFile,{status:"request_started",identity,chunk:i+1,attempt,usage:client.getUsageRecords?.()??[]});
      requests++;
      const usageStart=client.getUsageRecords?.().length??0;
      let result;
      phase="request";
      try {
        result=await client.analyze({instructions,payload,screenshots:chunk.images.map(x=>({path:x.path,label:x.label})),outputSchema:schema,outputName:"jmp_api_plan",outputDescription:"Evidence-grounded operations with explicit native interface choices, receivers and arguments",maxOutputTokens:JMP_BUDGET.maxOutputTokens});
      } finally {
        await save(path.join(run,attempt+"-usage.json"),{attempt,chunk:i+1,records:(client.getUsageRecords?.()??[]).slice(usageStart)});
      }
      await save(path.join(run,attempt+"-parsed.json"),result);
      phase="chunk_validation";
      catalog=validateJmpProgram(mergeJmpChunks([...completed,result]),validationFor(i));
      completed.push(result);
      if(checkpoint.importedFrom) (checkpoint.localAttempts??=[]).push({chunk:i+1,prefix:attempt,requestDigest:digest(await json(path.join(run,attempt+"-request.json"))),responseDigest:digest(await json(path.join(run,attempt+"-provider.json"))),parsedDigest:digest(result)});
      await save(checkpointFile,{identity,completed, ...(checkpoint.importedFrom?{importedFrom:checkpoint.importedFrom,localAttempts:checkpoint.localAttempts}:{})});
      await save(statusFile,{status:"chunk_validated",identity,completed:completed.length,total:evidence.chunks.length,usage:client.getUsageRecords?.()??[]});
    }
    if(completed.length<evidence.chunks.length) {
      const result={status:"budget_paused",completed:completed.length,total:evidence.chunks.length,requestsThisRound:requests,runDirectory:run,usage:await usageAudit(run,checkpoint.importedFrom)}; await save(statusFile,result); return result;
    }
    const program=mergeJmpChunks(completed), validation=validationFor(completed.length-1);
    phase="final_validation";
    const files=await writeReplayFiles(run,program,validation,target);
    const result={status:"replay_script_generated_not_executed",identity,...files,requestsThisRound:requests,verification:"not_run",sourceRecordingCompared:false,usage:await usageAudit(run,checkpoint.importedFrom)}; await save(statusFile,result); return result;
  } catch(e) {
    await save(statusFile,{status:"failed",identity,message:e.message,failurePhase:phase,chunk:activeChunk,
      providerError:phase==="request"?{status:e.status??null,code:e.code??null,requestId:e.requestId??null,clientRequestId:e.clientRequestId??null}:null,
      validationError:phase.endsWith("validation")?{code:e.code??"JMP_VALIDATION_FAILED",message:e.message}:null,
      requestsThisRound:requests,usage:await usageAudit(run,(await optionalJson(checkpointFile))?.importedFrom),executableValid:false}); throw e;
  } finally { await lock.close(); await fs.unlink(lockFile); }
}

// Explicit offline recovery after a local validator/compiler fix. Never load keys,
// instantiate a client, mutate paid responses, or bypass evidence/schema checks.
export async function compileSavedJmpAnalysis(options) {
  const recording=await fs.realpath(path.resolve(options.recording));
  const out=await fs.realpath(path.join(recording,"generated-jmp"));
  const run=await fs.realpath(path.resolve(options.compileSavedRun));
  if(path.dirname(run)!==out) throw new Error("Saved run must be directly inside this recording's generated-jmp directory");
  const locked=await fs.stat(path.join(run,"analysis.lock")).then(()=>true,e=>{if(e.code==="ENOENT")return false;throw e;});
  if(locked) throw new Error("Saved analysis is locked");
  const report=await json(path.join(out,"prepare-report.json"));
  const evidence=await prepareJmpEvidence(recording);
  if(!report.target)throw Error('Saved JMP run lacks explicit target version; refusing to assume 19.1');
  const target=resolveJmpVersion(evidence.manifest,report.target,options);
  const knowledge=await loadJmpKnowledge(root,target),schema=jmpSchemaFor(target),instructions=jmpInstructionsFor(target);
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-parsed\.json$/.test(n)).sort();
  const candidates=await Promise.all(files.map(async file=>{
    const prefix=file.replace(/-parsed\.json$/,"");
    const request=await json(path.join(run,prefix+"-request.json"));
    const response=await json(path.join(run,prefix+"-provider.json"));
    const parsed=await json(path.join(run,file));
    if(parsed.version!=="2.0")throw new Error("旧响应没有模型返回的接口调用，不能伪装成新版 API 计划；原结果已保留。需要按新契约另行授权分析。");
    const messages=(response.output??[]).filter(x=>x.type==="message"&&x.role==="assistant");
    const texts=messages.flatMap(m=>(m.content??[]).filter(c=>c.type==="output_text").map(c=>c.text));
    if(response.status!=="completed"||texts.length!==1||!isDeepStrictEqual(JSON.parse(texts[0]),parsed)) throw new Error("Saved parsed result does not match its completed provider response");
    return {prefix,request,response,parsed};
  }));
  if(candidates.length!==evidence.chunks.length) throw new Error("Offline compilation requires exactly one saved response for every chunk; missing/ambiguous responses");
  const chunks=[],provenance=[];
  for(let i=0;i<evidence.chunks.length;i++) {
    const matches=candidates.filter(c=>c.request.payload?.chunk?.index===i+1);
    if(matches.length!==1) throw new Error("Offline compilation requires exactly one saved response for every chunk; missing/ambiguous chunk "+(i+1));
    const {prefix,request,response,parsed}=matches[0],chunk=evidence.chunks[i];
    const same=(a,b)=>{if(!isDeepStrictEqual(a,JSON.parse(JSON.stringify(b))))throw new Error("Saved request no longer matches current evidence/schema/knowledge; refusing offline reuse");};
    same(request.identity,report.identity);same(request.schema,schema);same(request.instructions,instructions);
    same(request.payload.chunk,jmpChunkPosition(i+1,evidence.chunks.length));
    same(request.payload.inputs,chunk.events);
    same(request.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})));
    same(request.payload.sourceScope,{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets});
    same(request.payload.knowledge,retrieveJmpKnowledge(knowledge,chunk.events,chunks.at(-1)?.commandState));
    const eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
    same(request.payload.allowedEvidenceIds,eventIds);
    const prior=chunks.length?validateJmpProgram(mergeJmpChunks(chunks),{eventIds,apiCatalogVersion:target.apiCatalogVersion}):null;
    const withoutReportOperationLabels=context=>context?{...context,catalog:{...context.catalog,reports:context.catalog.reports.map(({id,...report})=>report)}}:null;
    same(withoutReportOperationLabels(request.payload.previousContext),withoutReportOperationLabels(jmpPreviousContext(chunks,prior)));
    chunks.push(parsed);
    validateJmpProgram(mergeJmpChunks(chunks),{eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id),apiCatalogVersion:target.apiCatalogVersion});
    provenance.push({chunk:i+1,prefix,responseId:response.id,requestDigest:digest(request),responseDigest:digest(response),parsedDigest:digest(parsed),operationIds:parsed.operations.map((o,j)=>({original:o.id,compiled:`chunk-${i+1}-op-${j+1}`}))});
  }
  const program=mergeJmpChunks(chunks),eventIds=evidence.chunks.flatMap(c=>c.inputIds);
  const validation={eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id),apiCatalogVersion:target.apiCatalogVersion};
  validateJmpProgram(program,{...validation,final:true});
  const destination=await fs.mkdtemp(path.join(out,"offline-compile-"));
  const replayFiles=await writeReplayFiles(destination,program,validation,target);
  const result={status:"saved_replay_script_generated_not_executed",sourceRun:run,sourceIdentity:report.identity,...replayFiles,requestsThisRound:0,sourceRecordingCompared:false,verification:"not_run",provenance,compilerDigest:digest(await fs.readFile(path.join(root,"src/analyzer/lib/jmp-renderer.mjs"))),validatorDigest:digest(await fs.readFile(path.join(root,"src/analyzer/lib/jmp-program.mjs"))),interfaceContractDigest:digest(await fs.readFile(path.join(root,"src/analyzer/lib/jmp-api-contract.mjs"))),usage:await usageAudit(run)};
  await save(path.join(destination,"status.json"),result);return result;
}

async function main() {
  const args=process.argv.slice(2), opts={};
  while(args.length) {
    const arg=args.shift();
    if(["--analyze","--retry-failed"].includes(arg)) opts[arg==="--analyze"?"analyze":"retryFailed"]=true;
    else if(arg==="--prepare-only") opts.prepareOnly=true;
    else if(arg==="--export-validation-jsl") { /* Compatibility: JSL is now always generated. */ }
    else if(arg==="--compile-saved-run"&&args.length) opts.compileSavedRun=args.shift();
    else if(arg==="--resume-saved-run"&&args.length) opts.resumeSavedRun=args.shift();
    else if(["--recording","--config"].includes(arg)&&args.length) opts[arg.slice(2)]=args.shift();
    else if(["--jmp-version","--jmp-edition","--jmp-language"].includes(arg)&&args.length) opts[{"--jmp-version":"jmpVersion","--jmp-edition":"jmpEdition","--jmp-language":"jmpLanguage"}[arg]]=args.shift();
    else throw new Error("Usage: jmp-cli.mjs --recording <folder> [--config <json>] [--jmp-version <version> --jmp-edition <edition> --jmp-language <language>] [--prepare-only | --analyze [--retry-failed] | --compile-saved-run <run-folder> | --resume-saved-run <run-folder>]");
  }
  if(!opts.recording||opts.analyze&&opts.prepareOnly) throw new Error("Specify recording and exactly one analysis mode");
  console.log(JSON.stringify(await runJmpAnalysis(opts),null,2));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
