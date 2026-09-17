#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {prepareOrcadEvidence,ORCAD_BUDGET,digest} from './lib/orcad-evidence.mjs';
import {loadOrcadKnowledge,retrieveOrcadKnowledge} from './lib/orcad-knowledge.mjs';
import {ORCAD_SCHEMA,ORCAD_INSTRUCTIONS,validateOrcadProgram} from './lib/orcad-program.mjs';
import {renderOrcadTcl} from './lib/orcad-renderer.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const optional=async f=>read(f).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
async function save(f,v){const tmp=f+'.tmp';await fs.writeFile(tmp,JSON.stringify(v,null,2),'utf8');await fs.rename(tmp,f);}
async function ensureLocalDirectory(dir,recording){
  await fs.mkdir(dir,{recursive:true});
  const info=await fs.lstat(dir),actual=await fs.realpath(dir),relative=path.relative(recording,actual);
  if(info.isSymbolicLink()||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Analysis output directory escapes recording; no write');
}
async function stageUploadImages(run,images){
  const directory=await fs.mkdtemp(path.join(run,'image-snapshot-'));
  const files=[];
  const dispose=async()=>{for(const file of files)await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(directory);};
  try{
    const screenshots=[];
    for(const [index,image] of images.entries()){
      const bytes=await fs.readFile(image.path);
      if(bytes.length!==image.bytes||digest(bytes)!==image.digest)throw Error('Image changed before immutable snapshot; no upload');
      const extension=path.extname(image.path).toLowerCase();
      const file=path.join(directory,`${String(index+1).padStart(3,'0')}${extension}`);
      await fs.writeFile(file,bytes,{flag:'wx',mode:0o400});files.push(file);
      await fs.chmod(file,0o400);
      const info=await fs.lstat(file);
      if(!info.isFile()||info.isSymbolicLink()||digest(await fs.readFile(file))!==image.digest)throw Error('Image snapshot integrity failed; no upload');
      screenshots.push({path:file,label:image.label});
    }
    return {screenshots,dispose,verify:async()=>{
      for(const [index,item] of screenshots.entries()){
        const info=await fs.lstat(item.path);
        if(!info.isFile()||info.isSymbolicLink()||digest(await fs.readFile(item.path))!==images[index].digest)throw Error('Image snapshot changed; no upload');
      }
    }};
  }catch(e){await dispose();throw e;}
}
function safeError(e){return {message:String(e.message??e).slice(0,500),code:typeof e.code==='string'?e.code:null,status:Number.isInteger(e.status)?e.status:null};}

// Recompile an already saved provider result without loading configuration,
// environment variables, or a client. The original attempt/status is read-only.
export async function compileExistingOrcad({recording,parsed:parsedOption}){
  if(!recording||!parsedOption)throw Error('Specify --recording and --compile-existing <parsed.json>');
  const source=await fs.realpath(path.resolve(recording));
  const output=path.join(source,'generated-orcad');
  const outputInfo=await fs.lstat(output);
  if(!outputInfo.isDirectory()||outputInfo.isSymbolicLink()||await fs.realpath(output)!==output)throw Error('Generated OrCAD directory escapes recording');
  const requested=path.resolve(parsedOption),parsedFile=await fs.realpath(requested);
  if(parsedFile!==requested||(await fs.lstat(parsedFile)).isSymbolicLink())throw Error('Parsed source is a link or path escape');
  const run=path.dirname(parsedFile),runName=path.basename(run),parsedName=path.basename(parsedFile);
  const match=/^(\d{3})-parsed\.json$/.exec(parsedName);
  if(!/^[a-f0-9]{24}$/.test(runName)||!match||path.dirname(run)!==output||(await fs.lstat(run)).isSymbolicLink())
    throw Error('Parsed source is not an original OrCAD attempt inside this recording');
  const attempt=Number(match[1]),prefix=match[1];
  const sourceFiles={report:path.join(output,'prepare-report.json'),ledger:path.join(output,'attempts.json'),status:path.join(run,'status.json'),request:path.join(run,`${prefix}-request.json`),provider:path.join(run,`${prefix}-provider.json`),parsed:parsedFile};
  const bytes={};
  for(const [key,file] of Object.entries(sourceFiles)){
    const info=await fs.lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||await fs.realpath(file)!==file)throw Error(`Original ${key} source is not a regular local file`);
    bytes[key]=await fs.readFile(file);
  }
  const originalHashes=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,digest(value)]));
  const data=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,JSON.parse(value.toString('utf8'))]));
  const {report,ledger,status,request,provider,parsed}=data;
  const identity=report.identity;
  if(typeof identity!=='string'||!/^[a-f0-9]{64}$/.test(identity)||identity.slice(0,24)!==runName
      ||path.resolve(report.runDirectory??'')!==run||path.resolve(report.sourceRecording??'')!==source
      ||request.identity!==identity||status.identity!==identity||status.status!=='failed'||status.phase!=='validation'
      ||status.attempt!==attempt||path.resolve(status.parsed??'')!==parsedFile
      ||!Array.isArray(ledger)||ledger[attempt-1]?.attempt!==attempt||ledger[attempt-1]?.identity!==identity)
    throw Error('OrCAD original attempt provenance does not match the saved failed validation');
  if(provider.status!=='completed'||provider.error!=null||provider.incomplete_details!=null)
    throw Error('Original provider response was not completed successfully');
  const providerTexts=provider.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text'&&typeof item.text==='string')??[];
  if(providerTexts.length!==1||!isDeepStrictEqual(JSON.parse(providerTexts[0].text),parsed))
    throw Error('Saved parsed plan differs from original provider output');
  if(Object.hasOwn(provider,'output_text')&&(!provider.output_text||!isDeepStrictEqual(JSON.parse(provider.output_text),parsed)))
    throw Error('Provider output_text differs from saved parsed plan');
  const evidence=await prepareOrcadEvidence(source),eventIds=evidence.events.map(item=>item.id);
  const uploads=evidence.images.map(item=>({file:item.label,bytes:item.bytes,sha256:item.digest}));
  if(!isDeepStrictEqual(report.inputEventIds,eventIds)||!isDeepStrictEqual(request.payload?.allowedEvidenceIds,eventIds)
      ||!isDeepStrictEqual(request.payload?.inputs,evidence.events)
      ||!isDeepStrictEqual(report.pendingUploadImages,uploads)||!isDeepStrictEqual(request.images,uploads)
      ||!isDeepStrictEqual(report.allReferencedImages,evidence.allImages.map(item=>({file:item.label,uploadImageLabel:item.uploadImageLabel,bytes:item.bytes,sha256:item.digest}))))
    throw Error('Recording evidence no longer matches the original request and preparation');
  const validation={eventIds,currentInputIds:eventIds,final:true};
  validateOrcadProgram(parsed,validation);
  const script=renderOrcadTcl(parsed,validation,{mode:'run'});
  // Check again immediately before publishing, without rewriting any source.
  for(const [key,file] of Object.entries(sourceFiles))if(digest(await fs.readFile(file))!==originalHashes[key])throw Error(`Original ${key} changed during offline recompile`);
  const recompiles=path.join(output,'verified-recompile');
  await ensureLocalDirectory(recompiles,source);
  const recompileId=digest({identity,attempt,originalHashes,scriptSha256:digest(script)}).slice(0,24);
  const directory=path.join(recompiles,`${runName}-${prefix}-${recompileId}`);
  await fs.mkdir(directory);
  const primaryOutput=path.join(directory,'orcad-replay.tcl');
  await fs.writeFile(primaryOutput,script,{flag:'wx'});
  const result={status:'not_executed',sourceStatus:'failed',sourcePhase:'validation',execution:'not_run',sourceRecordingCompared:false,
    identity,attempt,sourceParsed:parsedFile,originalHashes,scriptSha256:digest(script),primaryOutput,report:path.join(directory,'recompile-report.json')};
  await fs.writeFile(result.report,JSON.stringify(result,null,2),{flag:'wx'});
  return result;
}
export async function runOrcadAnalysis(options,deps={}){
  if(!options?.recording)throw Error('Specify --recording');
  if(options.analyze&&options.prepareOnly)throw Error('Choose preparation or analysis');
  if(options.retryFailed&&!options.analyze)throw Error('--retry-failed requires --analyze');
  const rawMaxAttempts=options.maxAttempts;
  const maxAttempts=rawMaxAttempts===undefined?ORCAD_BUDGET.maxAttempts:Number(rawMaxAttempts);
  if(!(typeof rawMaxAttempts==='number'&&Number.isInteger(rawMaxAttempts) || typeof rawMaxAttempts==='string'&&/^[2-6]$/.test(rawMaxAttempts) || rawMaxAttempts===undefined)
      ||!Number.isInteger(maxAttempts)||maxAttempts<2||maxAttempts>6)throw Error('--max-attempts must be an integer from 2 to 6');
  const budget={...ORCAD_BUDGET,maxAttempts};
  const recording=await fs.realpath(path.resolve(options.recording));
  const config=await read(path.resolve(options.config??path.join(root,'config.json')));
  const provider=Object.fromEntries(['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses','uploadChunkBytes'].filter(k=>config.provider?.[k]!==undefined).map(k=>[k,config.provider[k]]));
  if(!provider.model)throw Error('provider.model missing');
  // Full-desktop evidence contains small status-bar coordinates. Do not inherit
  // overview-only low detail from other adapters; preserve the model itself.
  const configuredImageDetail=provider.imageDetail??null;
  provider.imageDetail=provider.imageDetail==='original'?'original':'high';
  provider.maxRetries=0;provider.maxRequestBytes=ORCAD_BUDGET.maxRequestBytes;
  const evidence=await prepareOrcadEvidence(recording),knowledge=await loadOrcadKnowledge(root);
  const codeFiles=['orcad-cli.mjs','lib/orcad-evidence.mjs','lib/orcad-knowledge.mjs','lib/orcad-program.mjs','lib/orcad-renderer.mjs','lib/gpt-client.mjs'];
  const identity=digest({source:evidence.sourceDigest,images:evidence.allImages.map(x=>[x.label,x.digest]),schema:ORCAD_SCHEMA,instructions:ORCAD_INSTRUCTIONS,knowledge,provider,budget,code:await Promise.all(codeFiles.map(async f=>digest(await fs.readFile(path.join(root,'src/analyzer',f)))))});
  const out=path.join(recording,'generated-orcad'),run=path.join(out,identity.slice(0,24)),reportFile=path.join(out,'prepare-report.json');
  const report={identity,application:'OrCAD X Capture 24.1 P001',sourceRecording:recording,model:provider.model,primaryOutput:'orcad-replay.tcl',mode:'single_complete_session',inputEventIds:evidence.events.map(e=>e.id),
    pendingUploadImages:evidence.images.map(x=>({file:x.label,bytes:x.bytes,sha256:x.digest})),allReferencedImages:evidence.allImages.map(x=>({file:x.label,uploadImageLabel:x.uploadImageLabel,bytes:x.bytes,sha256:x.digest})),excluded:evidence.excluded,imageAliases:evidence.aliases,temporalWarnings:evidence.temporalWarnings,
    imagePolicy:{configuredDetail:configuredImageDetail,effectiveDetail:provider.imageDetail,reason:'Small status-bar coordinates require detailed full-frame evidence; no image or event is dropped.'},
    budget,estimatedDollarCost:null,priceNote:'Preparation makes no API call; provider usage and unknown failures may incur charges.',limitations:['Partial UI map; command matches are candidates.','Page coordinates need native/calibrated evidence, never pixels.','Generated Tcl has not been executed or compared against this recording.'],runDirectory:run};
  if(!options.analyze){
    await ensureLocalDirectory(out,recording);
    if(await fs.stat(path.join(out,'analysis.lock')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Analysis locked; do not replace preparation while request may be in flight');
    await save(reportFile,report);return {status:'prepared_no_upload',report:reportFile,identity};
  }
  const previous=await optional(reportFile);
  if(previous?.identity!==identity)throw Error('Preparation fingerprint changed; rerun prepare and inspect report before analysis');
  await ensureLocalDirectory(out,recording);await ensureLocalDirectory(run,recording);
  const lockFile=path.join(out,'analysis.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Analysis locked; check existing process before retry');throw e;}
  const statusFile=path.join(run,'status.json'),attemptsFile=path.join(out,'attempts.json');
  let attempt=null,phase='preflight',client=null,snapshot=null;
  try{
    if((await optional(reportFile))?.identity!==identity)throw Error('Preparation changed before lock; no upload');
    const prior=await optional(statusFile),attempts=await optional(attemptsFile)??[];
    if(!Array.isArray(attempts)||attempts.some((a,i)=>a?.attempt!==i+1||typeof a.identity!=='string'))throw Error('Invalid session attempt ledger; no upload');
    if(prior?.status==='not_executed')return prior;
    if(attempts.length>=maxAttempts)throw Error('Session attempt budget exhausted, including unknown usage');
    if(attempts.length&&!options.retryFailed)throw Error('Prior attempt failed or is uncertain; explicitly use --retry-failed');
    const payload={application:report.application,sourceScope:{captureDeployment:evidence.manifest.captureDeployment,screenshotScope:evidence.manifest.screenshotScope,screenshotOrigin:[evidence.manifest.screenshotOriginX,evidence.manifest.screenshotOriginY],uiAutomationTargets:evidence.manifest.uiAutomationTargets},
      inputs:evidence.events,knowledge:retrieveOrcadKnowledge(knowledge,evidence.events),allowedEvidenceIds:evidence.events.map(e=>e.id),temporalRule:'Frame labels are original recording files. Later-input overlap cannot isolate an earlier action. Before and after images are observations, not proof of committed edits; exact page coordinates need page-native evidence.'};
    if(Buffer.byteLength(JSON.stringify(payload))>ORCAD_BUDGET.maxPayloadBytes)throw Error('Payload budget exceeded');
    const fresh=await prepareOrcadEvidence(recording);
    if(fresh.sourceDigest!==evidence.sourceDigest||digest(fresh.allImages.map(x=>[x.label,x.digest]))!==digest(evidence.allImages.map(x=>[x.label,x.digest])))throw Error('Recording/image bytes changed during preflight; no upload');
    snapshot=await stageUploadImages(run,evidence.images);
    if(!deps.client){
      const {loadLocalEnv}=await import('./lib/local-env.mjs');
      await loadLocalEnv(path.join(root,'.env'));
      if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY missing; no request attempted');
    }
    client=deps.client??new (await import('./lib/gpt-client.mjs')).GptClient(provider);
    attempt=attempts.length+1;
    const prefix=String(attempt).padStart(3,'0');
    await save(path.join(run,prefix+'-request.json'),{identity,payload,instructions:ORCAD_INSTRUCTIONS,schema:ORCAD_SCHEMA,images:report.pendingUploadImages,provider,maxOutputTokens:ORCAD_BUDGET.maxOutputTokens});
    // Persist before the uncertain network boundary, across all fingerprints.
    attempts.push({attempt,identity,startedAt:new Date().toISOString(),usage:'unknown'});await save(attemptsFile,attempts);
    await save(statusFile,{status:'request_started',identity,attempt});
    client.onResponse=r=>save(path.join(run,prefix+'-provider.json'),r);
    client.onFailure=e=>save(path.join(run,prefix+'-provider-error.json'),e);
    phase='request';let parsed;
    try{await snapshot.verify();parsed=await client.analyze({instructions:ORCAD_INSTRUCTIONS,payload,screenshots:snapshot.screenshots,outputSchema:ORCAD_SCHEMA,outputName:'orcad_capture_plan',outputDescription:'Evidence-grounded bounded Capture edit plan',maxOutputTokens:ORCAD_BUDGET.maxOutputTokens});await snapshot.verify();}
    finally{await save(path.join(run,prefix+'-usage.json'),{attempt,records:client.getUsageRecords?.()??[],unknownUsage:!(client.getUsageRecords?.()?.length)});}
    await save(path.join(run,prefix+'-parsed.json'),parsed);
    phase='validation';
    const validation={eventIds:evidence.events.map(e=>e.id),currentInputIds:evidence.events.map(e=>e.id)};
    validateOrcadProgram(parsed,validation);
    if(!parsed.complete){const result={status:'parsed_incomplete_not_executed',identity,attempt,parsed:path.join(run,prefix+'-parsed.json'),usage:client.getUsageRecords?.()??[]};await save(statusFile,result);return result;}
    validateOrcadProgram(parsed,{...validation,final:true});
    phase='compile';
    const script=renderOrcadTcl(parsed,validation,{mode:'run'}),target=path.join(run,'orcad-replay.tcl');
    await fs.writeFile(target+'.tmp',script,'utf8');await fs.rename(target+'.tmp',target);
    const result={status:'not_executed',identity,attempt,primaryOutput:target,execution:'not_run',sourceRecordingCompared:false,usage:client.getUsageRecords?.()??[]};await save(statusFile,result);return result;
  }catch(e){const result={status:'failed',identity,attempt,phase,error:safeError(e),parsed:attempt?path.join(run,String(attempt).padStart(3,'0')+'-parsed.json'):null,executableValid:false,usage:client?.getUsageRecords?.()??[],unknownUsage:!client?.getUsageRecords?.()?.length};await save(statusFile,result);throw e;}
  finally{
    try{if(snapshot)await snapshot.dispose();}
    finally{try{await lock.close();}finally{await fs.unlink(lockFile);}}
  }
}
async function main(){const args=process.argv.slice(2),options={};while(args.length){const a=args.shift();if(a==='--analyze')options.analyze=true;else if(a==='--prepare-only')options.prepareOnly=true;else if(a==='--retry-failed')options.retryFailed=true;else if(['--recording','--config','--max-attempts','--compile-existing'].includes(a)&&args.length)options[a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args.shift();else throw Error('Usage: orcad-cli.mjs --recording <folder> [--config <json>] [--max-attempts 2..6] [--prepare-only | --analyze [--retry-failed] | --compile-existing <original-parsed.json>]');}if(options.compileExisting){if(options.analyze||options.prepareOnly||options.retryFailed||options.config||options.maxAttempts)throw Error('--compile-existing only accepts --recording');console.log(JSON.stringify(await compileExistingOrcad({recording:options.recording,parsed:options.compileExisting}),null,2));}else console.log(JSON.stringify(await runOrcadAnalysis(options),null,2));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
