#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareJmpEvidence, JMP_BUDGET, digest } from "./lib/jmp-evidence.mjs";
import { JMP_SCHEMA, JMP_INSTRUCTIONS, validateJmpProgram, mergeJmpChunks, jmpChunkPosition, jmpPreviousContext } from "./lib/jmp-program.mjs";
import {loadJmpKnowledge, retrieveJmpKnowledge} from "./lib/jmp-knowledge.mjs";
import { renderJmp } from "./lib/jmp-renderer.mjs";
import { buildJmpReplayPlan } from "./lib/jmp-replay-plan.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
async function json(file) { return JSON.parse((await fs.readFile(file,"utf8")).replace(/^\uFEFF/,"")); }
async function optionalJson(file) { try { return await json(file); } catch(e) { if(e.code==="ENOENT")return null; throw e; } }
async function save(file,value) {
  const tmp=file+".tmp"; await fs.writeFile(tmp,JSON.stringify(value,null,2),{encoding:"utf8"}); await fs.rename(tmp,file);
}
async function writeReplayFiles(directory,program,validation) {
  // Validate and compile before publishing any deliverable. Model calls stay
  // auditable internally; the standalone JSL needs neither JSON nor an executor AI.
  const plan=buildJmpReplayPlan(program,validation),script=renderJmp(program,validation);
  const internal=path.join(directory,"_internal");
  await fs.mkdir(internal,{recursive:true});
  const planFile=path.join(internal,"replay-plan.json"),scriptFile=path.join(directory,"jmp-replay.jsl");
  await save(planFile,plan);
  await fs.writeFile(scriptFile+".tmp",script,"utf8");
  await fs.rename(scriptFile+".tmp",scriptFile);
  // Keep the old result key as an alias, not a second runnable file.
  return {primaryOutput:scriptFile,replayScript:scriptFile,plan:planFile,validationScript:scriptFile,replaySemantics:"validated_final_state"};
}
async function usageAudit(run) {
  const files=(await fs.readdir(run)).filter(n=>/^\d{3}-\d+-usage\.json$/.test(n)).sort();
  const attempts=await Promise.all(files.map(n=>json(path.join(run,n))));
  return {attempts,unknownUsageAttempts:attempts.filter(a=>!a.records.length).length,
    note:"Provider-reported usage only. Missing usage after a failed/unknown request is not zero cost; reconcile with provider billing."};
}

export async function runJmpAnalysis(options, deps={}) {
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
  const knowledge=await loadJmpKnowledge(root);
  const codeFiles=["jmp-cli.mjs","lib/jmp-evidence.mjs","lib/jmp-program.mjs","lib/jmp-api-contract.mjs","lib/jmp-replay-plan.mjs","lib/jmp-renderer.mjs","lib/jmp-knowledge.mjs","lib/gpt-client.mjs"];
  const identity=digest({source:evidence.sourceDigest,images:evidence.images.map(i=>({label:i.label,digest:i.digest})),knowledge,provider,budget:JMP_BUDGET,code:await Promise.all(codeFiles.map(async p=>digest(await fs.readFile(path.join(root,"src/analyzer",p)))))});
  const out=path.join(recording,"generated-jmp"), run=path.join(out,identity.slice(0,24));
  await fs.mkdir(run,{recursive:true});
  const reportFile=path.join(out,"prepare-report.json"), previousReport=await optionalJson(reportFile);
  const report={identity,application:"JMP Trial 19.1.5",sourceRecording:recording,model:provider.model,outputContract:"standalone_jmp_jsl_v1",internalContract:"model_selected_interfaces_and_operations_v2",primaryOutput:"jmp-replay.jsl",replaySemantics:"validated_final_state",
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
    const completed=checkpoint.completed;
    const validationFor = i => ({eventIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),currentInputIds:evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds),knowledgeIds:knowledge.controls.map(c=>c.id)});
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
        temporalRule:"Read frame timestamps. Frames marked later_inputs_may_be_visible cannot isolate an earlier action. They still show the later observed state. screenshotSettledAfter is an additional delayed observation, not a guarantee of stability or command completion. Do not assert committed solely from a preview or a delayed after-frame: inspect visible committed cells, completed reports and command state. A frame's uploadImageLabel identifies the supplied image; label is its original recording file. Identical-file deduplication shares pixels only, not timestamps, action identities or parameter roles."};
      if(Buffer.byteLength(JSON.stringify(payload))>JMP_BUDGET.maxPayloadBytes) throw new Error("跨段上下文超出文本预算；未截断实体目录或上传，请缩短录制。");
      const attempt=String(i+1).padStart(3,"0")+"-"+Date.now();
      await save(path.join(run,attempt+"-request.json"),{identity,payload,instructions:JMP_INSTRUCTIONS,schema:JMP_SCHEMA,images:chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})),provider,maxOutputTokens:JMP_BUDGET.maxOutputTokens});
      client.onResponse=response=>save(path.join(run,attempt+"-provider.json"),response);
      client.onFailure=failure=>save(path.join(run,attempt+"-provider-error.json"),failure);
      await save(statusFile,{status:"request_started",identity,chunk:i+1,attempt,usage:client.getUsageRecords?.()??[]});
      requests++;
      const usageStart=client.getUsageRecords?.().length??0;
      let result;
      phase="request";
      try {
        result=await client.analyze({instructions:JMP_INSTRUCTIONS,payload,screenshots:chunk.images.map(x=>({path:x.path,label:x.label})),outputSchema:JMP_SCHEMA,outputName:"jmp_api_plan",outputDescription:"Evidence-grounded operations with explicit native interface choices, receivers and arguments",maxOutputTokens:JMP_BUDGET.maxOutputTokens});
      } finally {
        await save(path.join(run,attempt+"-usage.json"),{attempt,chunk:i+1,records:(client.getUsageRecords?.()??[]).slice(usageStart)});
      }
      await save(path.join(run,attempt+"-parsed.json"),result);
      phase="chunk_validation";
      catalog=validateJmpProgram(mergeJmpChunks([...completed,result]),validationFor(i));
      completed.push(result); await save(checkpointFile,{identity,completed});
      await save(statusFile,{status:"chunk_validated",identity,completed:completed.length,total:evidence.chunks.length,usage:client.getUsageRecords?.()??[]});
    }
    if(completed.length<evidence.chunks.length) {
      const result={status:"budget_paused",completed:completed.length,total:evidence.chunks.length,requestsThisRound:requests,runDirectory:run,usage:await usageAudit(run)}; await save(statusFile,result); return result;
    }
    const program=mergeJmpChunks(completed), validation=validationFor(completed.length-1);
    phase="final_validation";
    const files=await writeReplayFiles(run,program,validation);
    const result={status:"replay_script_generated_not_executed",identity,...files,requestsThisRound:requests,verification:"not_run",sourceRecordingCompared:false,usage:await usageAudit(run)}; await save(statusFile,result); return result;
  } catch(e) {
    await save(statusFile,{status:"failed",identity,message:e.message,failurePhase:phase,chunk:activeChunk,
      providerError:phase==="request"?{status:e.status??null,code:e.code??null,requestId:e.requestId??null,clientRequestId:e.clientRequestId??null}:null,
      validationError:phase.endsWith("validation")?{code:e.code??"JMP_VALIDATION_FAILED",message:e.message}:null,
      requestsThisRound:requests,usage:await usageAudit(run),executableValid:false}); throw e;
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
  const evidence=await prepareJmpEvidence(recording),knowledge=await loadJmpKnowledge(root);
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
    same(request.identity,report.identity);same(request.schema,JMP_SCHEMA);same(request.instructions,JMP_INSTRUCTIONS);
    same(request.payload.chunk,jmpChunkPosition(i+1,evidence.chunks.length));
    same(request.payload.inputs,chunk.events);
    same(request.images,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes})));
    same(request.payload.sourceScope,{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets});
    same(request.payload.knowledge,retrieveJmpKnowledge(knowledge,chunk.events,chunks.at(-1)?.commandState));
    const eventIds=evidence.chunks.slice(0,i+1).flatMap(c=>c.inputIds);
    same(request.payload.allowedEvidenceIds,eventIds);
    const prior=chunks.length?validateJmpProgram(mergeJmpChunks(chunks),{eventIds}):null;
    const withoutReportOperationLabels=context=>context?{...context,catalog:{...context.catalog,reports:context.catalog.reports.map(({id,...report})=>report)}}:null;
    same(withoutReportOperationLabels(request.payload.previousContext),withoutReportOperationLabels(jmpPreviousContext(chunks,prior)));
    chunks.push(parsed);
    validateJmpProgram(mergeJmpChunks(chunks),{eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id)});
    provenance.push({chunk:i+1,prefix,responseId:response.id,requestDigest:digest(request),responseDigest:digest(response),parsedDigest:digest(parsed),operationIds:parsed.operations.map((o,j)=>({original:o.id,compiled:`chunk-${i+1}-op-${j+1}`}))});
  }
  const program=mergeJmpChunks(chunks),eventIds=evidence.chunks.flatMap(c=>c.inputIds);
  const validation={eventIds,currentInputIds:eventIds,knowledgeIds:knowledge.controls.map(c=>c.id)};
  validateJmpProgram(program,{...validation,final:true});
  const destination=await fs.mkdtemp(path.join(out,"offline-compile-"));
  const replayFiles=await writeReplayFiles(destination,program,validation);
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
    else if(["--recording","--config"].includes(arg)&&args.length) opts[arg.slice(2)]=args.shift();
    else throw new Error("Usage: jmp-cli.mjs --recording <folder> [--config <json>] [--prepare-only | --analyze [--retry-failed] | --compile-saved-run <run-folder>] [--export-validation-jsl]");
  }
  if(!opts.recording||opts.analyze&&opts.prepareOnly) throw new Error("Specify recording and exactly one analysis mode");
  console.log(JSON.stringify(await runJmpAnalysis(opts),null,2));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
