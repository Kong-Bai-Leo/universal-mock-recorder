import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {prepareStataEvidence,STATA_BUDGET,digest} from './stata-evidence.mjs';
import {loadStataKnowledge,retrieveStataKnowledge} from './stata-knowledge.mjs';
import {STATA_SCHEMA,STATA_INSTRUCTIONS,validateStataProgram,mergeStataChunks,stataChunkPosition,stataPreviousContext} from './stata-program.mjs';
import {renderStata,newStataRuntimeDirectoryName} from './stata-renderer.mjs';
import {loadLocalEnv} from './local-env.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const application='Stata/MP 18.0 en-US';
const evidenceRule='Frames preserve their capture time and source role; delayed after-frames may include later inputs. Identical-byte deduplication only shares pixels, not action identity. Never infer clipboard contents or unknown cell values. UI entries are documented candidates, not observed controls.';
const sourceScopeFor=manifest=>Object.fromEntries(['captureDeployment','screenshotScope','screenshotOriginX','screenshotOriginY',
  'uiAutomationTargets','applicationVersion','applicationEdition','language','versionSource','languageSource','targetProcess','targetProcessId','targetSessionId']
  .filter(k=>manifest[k]!==undefined).map(k=>[k,manifest[k]]));
async function json(file){return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}
async function optionalJson(file){try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8');await fs.rename(temp,file);}
async function usageAudit(run){
  const files=(await fs.readdir(run)).filter(x=>/^\d{3}-\d+-usage\.json$/.test(x)).sort();
  const attempts=await Promise.all(files.map(x=>json(path.join(run,x))));
  return {attempts,unknownUsageAttempts:attempts.filter(x=>!x.records.length).length,
    note:'Only provider-reported usage is known. Failed/unknown attempts without usage may still be billable.'};
}
async function identityFor(evidence,knowledge,provider){
  const code=['stata-analysis.mjs','stata-evidence.mjs','stata-knowledge.mjs','stata-program.mjs','stata-renderer.mjs','gpt-client.mjs'];
  return digest({source:evidence.sourceDigest,images:evidence.images.map(x=>({label:x.label,digest:x.digest})),knowledge,provider,budget:STATA_BUDGET,
    code:await Promise.all(code.map(async file=>digest(await fs.readFile(path.join(root,'src/analyzer/lib',file)))))});
}
const validationFor=(evidence,i)=>({eventIds:evidence.chunks.slice(0,i+1).flatMap(x=>x.inputIds)});
function providerText(response){
  const messages=(response.output??[]).filter(x=>x.type==='message'&&x.role==='assistant');
  const texts=messages.flatMap(m=>(m.content??[]).filter(c=>c.type==='output_text').map(c=>c.text));
  if(response.status!=='completed'||texts.length!==1)throw Error('Saved provider response is not one completed assistant JSON message');
  return texts[0];
}
// Saved model bytes can be reused after a local validator/compiler repair only
// through an explicit source run. Recheck the complete provider-facing contract;
// never rewrite the old request identity to make it look like a new request.
async function restoreCompleted({checkpoint,run,out,evidence,knowledge,provider}){
  const completed=checkpoint.completed;
  if(!Array.isArray(completed)||completed.length>evidence.chunks.length)throw Error('Invalid checkpoint');
  if(checkpoint.completedSources!==undefined&&(!Array.isArray(checkpoint.completedSources)||checkpoint.completedSources.length!==completed.length))
    throw Error('Invalid checkpoint provenance');
  const sources=[];let state=null;
  for(let i=0;i<completed.length;i++){
    let source=checkpoint.completedSources?.[i];
    if(!source){
      const matches=(await fs.readdir(run)).filter(x=>x.startsWith(String(i+1).padStart(3,'0')+'-')&&x.endsWith('-parsed.json'));
      if(matches.length!==1)throw Error('Checkpoint has missing/ambiguous saved provider result');
      source={runDirectory:run,attempt:matches[0].replace(/-parsed\.json$/,''),identity:checkpoint.identity};
    }
    if(!source||typeof source.runDirectory!=='string'||typeof source.attempt!=='string'||typeof source.identity!=='string')
      throw Error('Invalid checkpoint source');
    const sourceRun=await fs.realpath(source.runDirectory);
    if(path.dirname(sourceRun)!==out||!/^\d{3}-\d+$/.test(source.attempt)||
      !/^[0-9a-f]{64}$/.test(source.identity)||path.basename(sourceRun)!==source.identity.slice(0,24))
      throw Error('Checkpoint source escapes recording or has invalid identity');
    const report=await json(path.join(sourceRun,'prepare-report.json'));
    if(report.identity!==source.identity||report.sourceDigest!==evidence.sourceDigest)
      throw Error('Checkpoint source no longer matches recording');
    const prefix=path.join(sourceRun,source.attempt);
    const request=await json(prefix+'-request.json'),raw=await json(prefix+'-provider.json'),parsed=await json(prefix+'-parsed.json');
    if(!isDeepStrictEqual(JSON.parse(providerText(raw)),parsed))throw Error('Saved parsed result differs from provider response');
    const chunk=evidence.chunks[i];
    const expectedPayload={application,chunk:stataChunkPosition(i+1,evidence.chunks.length),sourceScope:sourceScopeFor(evidence.manifest),
      inputs:chunk.events,knowledge:retrieveStataKnowledge(knowledge,chunk.events,completed[i-1]?.pendingEventIds),
      previousContext:stataPreviousContext(completed.slice(0,i),state),allowedEvidenceIds:validationFor(evidence,i).eventIds,evidenceRule};
    if(request.identity!==source.identity||request.instructions!==STATA_INSTRUCTIONS||
      !isDeepStrictEqual(request.schema,STATA_SCHEMA)||!isDeepStrictEqual(request.provider,provider)||
      request.maxOutputTokens!==STATA_BUDGET.maxOutputTokens||
      !isDeepStrictEqual(request.payload,expectedPayload)||
      !isDeepStrictEqual(request.attemptedImageInputs,chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes,detail:provider.imageDetail??'high'})))||
      !isDeepStrictEqual(parsed,completed[i]))
      throw Error('Checkpoint no longer matches saved request/evidence/provider response');
    state=validateStataProgram(mergeStataChunks(completed.slice(0,i+1)),{...validationFor(evidence,i),final:false});
    sources.push({runDirectory:sourceRun,attempt:source.attempt,identity:source.identity,
      requestDigest:digest(request),responseDigest:digest(raw),parsedDigest:digest(parsed)});
  }
  return {state,sources};
}
async function writeReplay(run,program,validation){
  validateStataProgram(program,{...validation,final:true});
  const runtimeDirectoryName=newStataRuntimeDirectoryName();
  const script=renderStata(program,{...validation,runtimeDirectoryName});
  const internal=path.join(run,'_internal');await fs.mkdir(internal,{recursive:true});
  await save(path.join(internal,'replay-plan.json'),{program,validation,runtimeDirectoryName,semantics:'validated_final_state',sourceRecordingCompared:false});
  const target=path.join(run,'stata-replay.do');
  await fs.writeFile(target,script,{encoding:'utf8',flag:'wx'});
  return {primaryOutput:target,replayScript:target,plan:path.join(internal,'replay-plan.json'),
    runtimeOutputDirectory:`./${runtimeDirectoryName}`,runtimeDataFile:`./${runtimeDirectoryName}/reconstructed.dta`,
    replaySemantics:'validated_final_state'};
}

export async function runStataAnalysis(options,deps={}){
  if(options.compileSavedRun){
    if(options.analyze||options.retryFailed||options.prepareOnly||options.resumeFromRun)throw Error('Offline compile cannot combine with upload/prepare/retry/resume');
    return compileSavedStataAnalysis(options);
  }
  if(options.resumeFromRun&&!options.analyze)throw Error('Saved-result resume requires explicit --analyze after preparation');
  if(!options.recording)throw Error('Recording directory required');
  const recording=await fs.realpath(path.resolve(options.recording));
  const config=await json(path.resolve(options.config??path.join(root,'config.json')));
  const provider=Object.fromEntries(['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses','uploadChunkBytes']
    .filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
  if(!provider.model)throw Error('provider.model missing; will not choose a model');
  provider.maxRetries=0;provider.maxRequestBytes=STATA_BUDGET.maxRequestBytes;
  const evidence=await prepareStataEvidence(recording),knowledge=await loadStataKnowledge(root);
  const identity=await identityFor(evidence,knowledge,provider);
  const out=path.join(recording,'generated-stata'),run=path.join(out,identity.slice(0,24));
  await fs.mkdir(run,{recursive:true});
  const reportFile=path.join(out,'prepare-report.json'),previousReport=await optionalJson(reportFile);
  const report={identity,sourceDigest:evidence.sourceDigest,application,
    capturedApplication:{version:evidence.manifest.applicationVersion,edition:evidence.manifest.applicationEdition,language:evidence.manifest.language,
      versionSource:evidence.manifest.versionSource??null,languageSource:evidence.manifest.languageSource??null},
    applicationVerification:'old_VM_visual_observation; replay_not_native_verified',
    sourceRecording:recording,model:provider.model,outputContract:'single_stata_do_v1',internalContract:'model_selected_interfaces_v1',
    primaryOutput:'stata-replay.do',sourceRecordingCompared:false,
    warnings:['Documents-only UI candidates; no Stata GUI control scan proven by this report.','Virtual-desktop screenshots can include other windows; review privacy before --analyze.','Prepared image labels are actual input bytes for a request attempt; HTTP receipt is not proof that provider interpreted them.',
      ...(provider.imageDetail==='low'?['Low image detail may make small Stata cell labels unreadable; model settings were not changed automatically.']:[])],
    inputEvents:evidence.events.length,chunks:evidence.chunks.map((c,i)=>({index:i+1,inputIds:c.inputIds,images:c.images.map(x=>({file:x.label,bytes:x.bytes,sha256:x.digest}))})),
    excluded:evidence.excluded,temporalWarnings:evidence.temporalWarnings,imageAliases:evidence.imageAliases,
    imageCounts:{sourceFiles:evidence.images.length,uniqueContent:new Set(evidence.images.map(x=>x.digest)).size,requestImageSlots:evidence.chunks.reduce((n,c)=>n+c.images.length,0)},
    budget:STATA_BUDGET,estimatedDollarCost:null,runDirectory:run};
  if(!options.analyze){await save(path.join(run,'prepare-report.json'),report);await save(reportFile,report);return {status:'prepared_no_upload',report:reportFile,chunks:evidence.chunks.length};}
  if(previousReport?.identity!==identity)throw Error('Evidence, code, knowledge or provider changed: prepare and review before upload');
  const lockFile=path.join(run,'analysis.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Analysis lock exists; inspect process before retry');throw e;}
  let client,requests=0,phase='checkpoint_validation',activeChunk=null;
  const checkpointFile=path.join(run,'checkpoint.json'),statusFile=path.join(run,'status.json');
  try{
    const previousStatus=await optionalJson(statusFile);
    if(previousStatus?.status==='replay_script_generated_not_executed'&&previousStatus.identity===identity){
      if(previousStatus.primaryOutput!==path.join(run,'stata-replay.do')||
        !(await fs.stat(previousStatus.primaryOutput).then(s=>s.isFile(),()=>false)))throw Error('Completed status points to missing/foreign script; inspect saved run');
      return {...previousStatus,requestsThisRound:0};
    }
    if(['failed','request_started'].includes(previousStatus?.status)&&!options.retryFailed){
      const error=Error('Previous attempt failed/uncertain; explicit --retry-failed required');error.code='STATA_RETRY_REQUIRED';throw error;
    }
    let checkpoint=await optionalJson(checkpointFile);
    if(options.resumeFromRun){
      const sourceRun=await fs.realpath(path.resolve(options.resumeFromRun)),realOut=await fs.realpath(out);
      if(path.dirname(sourceRun)!==realOut||sourceRun===await fs.realpath(run))throw Error('Resume source must be another run of this recording');
      if(await fs.stat(path.join(sourceRun,'analysis.lock')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Resume source is still running');
      if(checkpoint)throw Error('This run already has a checkpoint; resume without --resume-from-run');
      const previousCheckpoint=await json(path.join(sourceRun,'checkpoint.json'));
      const restored=await restoreCompleted({checkpoint:previousCheckpoint,run:sourceRun,out:realOut,evidence,knowledge,provider});
      checkpoint={identity,completed:previousCheckpoint.completed,completedSources:restored.sources};
      await save(path.join(run,'saved-result-reuse.json'),{sourceRun,currentIdentity:identity,
        completedChunks:checkpoint.completed.length,sources:restored.sources,
        rule:'Original provider-facing contract and immutable response rechecked; current local validator used. No new API calls for reused chunks.'});
      await save(checkpointFile,checkpoint);
    }
    checkpoint??={identity,completed:[],completedSources:[]};
    if(checkpoint.identity!==identity||!Array.isArray(checkpoint.completed)||checkpoint.completed.length>evidence.chunks.length)throw Error('Invalid checkpoint');
    const completed=checkpoint.completed;
    const restored=await restoreCompleted({checkpoint,run,out:await fs.realpath(out),evidence,knowledge,provider});
    let state=restored.state;const completedSources=restored.sources;
    if(completed.length<evidence.chunks.length){
      if(deps.client)client=deps.client;
      else{await loadLocalEnv(path.join(root,'.env'));const {GptClient}=await import('./gpt-client.mjs');client=new GptClient(provider);}
    }
    for(let i=completed.length;i<evidence.chunks.length&&requests<STATA_BUDGET.maxRequestsPerRound;i++){
      const chunk=evidence.chunks[i];activeChunk=i+1;
      const inputIds=validationFor(evidence,i).eventIds;
      const payload={application:report.application,chunk:stataChunkPosition(i+1,evidence.chunks.length),
        sourceScope:sourceScopeFor(evidence.manifest),
        inputs:chunk.events,knowledge:retrieveStataKnowledge(knowledge,chunk.events,completed.at(-1)?.pendingEventIds),
        previousContext:stataPreviousContext(completed,state),allowedEvidenceIds:inputIds,
        evidenceRule};
      if(Buffer.byteLength(JSON.stringify(payload))>STATA_BUDGET.maxPayloadBytes)throw Error('Text/context budget exceeded before upload');
      phase='evidence_recheck';
      const attempt=String(i+1).padStart(3,'0')+'-'+Date.now();
      const stagedDirectory=path.join(run,'_upload',attempt);await fs.mkdir(stagedDirectory,{recursive:true});
      const imageInputs=[];
      for(const [index,image] of chunk.images.entries()){
        const bytes=await fs.readFile(image.path);
        if(bytes.length!==image.bytes||digest(bytes)!==image.digest)throw Error('Screenshot changed after preparation; no upload');
        const staged=path.join(stagedDirectory,String(index+1).padStart(2,'0')+path.extname(image.path).toLowerCase());
        await fs.writeFile(staged,bytes,{flag:'wx'});
        imageInputs.push({path:staged,label:image.label});
      }
      const imageAudit=chunk.images.map(x=>({label:x.label,sha256:x.digest,bytes:x.bytes,detail:provider.imageDetail??'high'}));
      await save(path.join(run,attempt+'-request.json'),{identity,payload,instructions:STATA_INSTRUCTIONS,schema:STATA_SCHEMA,
        attemptedImageInputs:imageAudit,provider,maxOutputTokens:STATA_BUDGET.maxOutputTokens,
        transmission:'attempted_not_confirmed_by_local_file'});
      let rawReceived=false;
      client.onResponse=async response=>{rawReceived=true;await save(path.join(run,attempt+'-provider.json'),response);};
      client.onFailure=async failure=>save(path.join(run,attempt+'-provider-error.json'),failure);
      await save(statusFile,{status:'request_started',identity,chunk:i+1,attempt,images:imageAudit,usage:client.getUsageRecords?.()??[]});
      requests++;phase='request';
      const usageStart=client.getUsageRecords?.().length??0;
      let result;
      try{result=await client.analyze({instructions:STATA_INSTRUCTIONS,payload,screenshots:imageInputs,
        outputSchema:STATA_SCHEMA,outputName:'stata18_api_plan',outputDescription:'Evidence-grounded Stata operations with explicit command choices and object bindings',
        maxOutputTokens:STATA_BUDGET.maxOutputTokens});}
      catch(e){if(rawReceived)phase='response_structure';throw e;}
      finally{await save(path.join(run,attempt+'-usage.json'),{attempt,chunk:i+1,images:imageAudit,records:(client.getUsageRecords?.()??[]).slice(usageStart)});}
      if(!rawReceived)throw Error('Provider raw response was not captured; refusing unauditable result');
      phase='response_structure';
      const raw=await json(path.join(run,attempt+'-provider.json'));
      if(!isDeepStrictEqual(JSON.parse(providerText(raw)),result))throw Error('Parsed result differs from provider response');
      await save(path.join(run,attempt+'-parsed.json'),result);
      phase='chunk_validation';
      const next=[...completed,result];
      state=validateStataProgram(mergeStataChunks(next),{...validationFor(evidence,i),final:false});
      completed.push(result);completedSources.push({runDirectory:run,attempt,identity});
      await save(checkpointFile,{identity,completed,completedSources});
      await save(statusFile,{status:'chunk_validated',identity,completed:completed.length,total:evidence.chunks.length,usage:client.getUsageRecords?.()??[]});
    }
    if(completed.length<evidence.chunks.length){const result={status:'budget_paused',completed:completed.length,total:evidence.chunks.length,requestsThisRound:requests,
      runDirectory:run,usage:await usageAudit(run)};await save(statusFile,result);return result;}
    phase='final_validation';
    const program=mergeStataChunks(completed),validation=validationFor(evidence,completed.length-1);
    const files=await writeReplay(run,program,validation);
    const result={status:'replay_script_generated_not_executed',identity,...files,requestsThisRound:requests,verification:'not_run',sourceRecordingCompared:false,
      reusedResponses:completedSources.filter(x=>x.identity!==identity),
      usage:await usageAudit(run)};await save(statusFile,result);return result;
  }catch(e){
    if(e.code==='STATA_RETRY_REQUIRED')throw e;
    await save(statusFile,{status:'failed',identity,message:e.message,failurePhase:phase,chunk:activeChunk,
      providerError:phase==='request'?{status:e.status??null,code:e.code??null,requestId:e.requestId??null,clientRequestId:e.clientRequestId??null}:null,
      requestsThisRound:requests,usage:await usageAudit(run),executableValid:false});throw e;
  }finally{await lock.close();await fs.unlink(lockFile);}
}

export async function compileSavedStataAnalysis(options){
  const recording=await fs.realpath(path.resolve(options.recording));
  const out=await fs.realpath(path.join(recording,'generated-stata'));
  const run=await fs.realpath(path.resolve(options.compileSavedRun));
  if(path.dirname(run)!==out)throw Error('Saved run must be directly under this recording generated-stata');
  if(await fs.stat(path.join(run,'analysis.lock')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Saved run is locked');
  const report=await json(path.join(run,'prepare-report.json'));
  const evidence=await prepareStataEvidence(recording),knowledge=await loadStataKnowledge(root);
  const identity=report.identity;
  if(report.sourceDigest!==evidence.sourceDigest||path.basename(run)!==identity.slice(0,24))throw Error('Saved run no longer matches source recording');
  const checkpoint=await json(path.join(run,'checkpoint.json'));
  if(checkpoint.identity!==identity||checkpoint.completed?.length!==evidence.chunks.length)
    throw Error('Offline compile requires a complete saved checkpoint');
  const source=checkpoint.completedSources?.[0];
  // Resolve through the same recording boundary before reading provider settings.
  const providerRun=source?await fs.realpath(source.runDirectory):run;
  if(path.dirname(providerRun)!==out)throw Error('Checkpoint source escapes recording');
  const attempts=source?[source.attempt]:(await fs.readdir(run)).filter(x=>/^001-\d+-request\.json$/.test(x)).map(x=>x.replace(/-request\.json$/,''));
  if(attempts.length!==1||!/^001-\d+$/.test(attempts[0]))throw Error('Missing/ambiguous first saved request');
  const provider=(await json(path.join(providerRun,attempts[0]+'-request.json'))).provider;
  const restored=await restoreCompleted({checkpoint,run,out,evidence,knowledge,provider});
  const chunks=checkpoint.completed,provenance=restored.sources;
  const program=mergeStataChunks(chunks),validation=validationFor(evidence,chunks.length-1);
  validateStataProgram(program,{...validation,final:true});
  const destination=await fs.mkdtemp(path.join(out,'offline-compile-'));
  const result={status:'saved_replay_script_generated_not_executed',sourceRun:run,sourceIdentity:identity,
    ...await writeReplay(destination,program,validation),requestsThisRound:0,verification:'not_run',sourceRecordingCompared:false,provenance,usage:await usageAudit(run)};
  await save(path.join(destination,'status.json'),result);return result;
}
