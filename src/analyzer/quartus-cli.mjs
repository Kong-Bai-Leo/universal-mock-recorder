#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {GptClient,summarizeUsageRecords} from './lib/gpt-client.mjs';
import {loadLocalEnv} from './lib/local-env.mjs';
import {readJsonLines} from './lib/trace.mjs';
import {createAnalysisCheckpointIdentity,loadAnalysisCheckpoint,saveAnalysisCheckpoint} from './lib/analysis-checkpoint.mjs';
import {loadQuartusKnowledge,retrieveQuartusKnowledge,isQuartus} from './lib/quartus-knowledge.mjs';
import {buildQuartusActions,chunkQuartusActions,selectQuartusEvidence,assessQuartusFinalTransitionEvidence} from './lib/quartus-trace.mjs';
import {loadQuartusReprocess} from './lib/quartus-reprocess.mjs';
import {buildQuartusHarness} from './lib/quartus-harness.mjs';
import {QUARTUS_ANALYSIS_INSTRUCTIONS} from './lib/quartus-prompt.mjs';
import {QUARTUS_WORKFLOW_SCHEMA,quartusResponseSchema,validateQuartusOperationInputs,validateQuartusWorkflow,mergeQuartusWorkflows} from './lib/quartus-workflow.mjs';
import {compileQuartusProject,writeQuartusProjectArtifacts} from './lib/quartus-project.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const readJson=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const writeJson=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2),'utf8');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
function integer(value,fallback,min,max,name) {
  const n=value??fallback;
  if(!Number.isInteger(n)||n<min||n>max) throw Error(`${name}: ${min}..${max}`);
  return n;
}
const actionEventIds=a=>[...a.sourceEventIds,...(a.observations??[]).map(o=>o.eventId),...(a.transitionObservations??[]).map(o=>o.eventId)];
function previousContext(plan,history=[]) {
  if(!plan) return null;
  return {project:plan.project,files:plan.files,assignments:plan.assignments,clocks:plan.clocks,
    state:plan.state,unresolved:plan.unresolved,summary:plan.summary,operations:plan.operations.slice(-4),
    pendingOperations:history.flatMap(p=>p.operations).filter(op=>['pending','unknown'].includes(op.status)),
    resolutions:history.flatMap(p=>p.resolutions??[])};
}

// References from past validated state can be carried, but cannot be invented or rewritten as fresh evidence.
function enforceEvidenceInheritance(plan,previous,currentEvents,currentImages) {
  const currentE=new Set(currentEvents),currentI=new Set(currentImages);
  const old=[previous?.project,...(previous?.files??[]),...(previous?.assignments??[]),...(previous?.clocks??[])].filter(Boolean);
  for(const item of [plan.project,...plan.files,...plan.assignments,...plan.clocks].filter(Boolean)) {
    const e=item.evidence;
    if(e.sourceEventIds.every(id=>currentE.has(id))&&e.screenshotFiles.every(f=>currentI.has(f))) continue;
    if(!old.some(x=>JSON.stringify(x)===JSON.stringify(item))) throw Error('旧证据只能随未更改的已校验状态继承，不能支持新数值');
  }
}
function enforceCoverage(plan,actions) {
  const inputs=new Set(actions.flatMap(a=>a.sourceEventIds));
  const represented=new Set([...plan.operations,...plan.unresolved].flatMap(o=>o.sourceEventIds));
  validateQuartusOperationInputs(plan.operations,[...inputs],actions.flatMap(actionEventIds));
  const missing=[...inputs].filter(id=>!represented.has(id));
  if(missing.length) {
    plan.complete=false;
    plan.unresolved.push({description:'模型未表达这些输入的作用',sourceEventIds:missing});
  }
  return plan;
}

export async function runQuartusAnalysis(options,dependencies={}) {
  if(!options?.recording) throw Error('需要录制目录');
  const recording=path.resolve(options.recording),output=path.resolve(options.output??path.join(recording,'generated'));
  let client,requests=0,stage='load',outputWritable=false;
  const statusFile=path.join(output,'analysis-status.json');
  try {
    if(options.reprocessFrom&&(!options.output||options.prepareOnly))throw Error('离线重新生成需要新的 --output，不能与 --prepare-only 同用');
    const manifest=await readJson(path.join(recording,'manifest.json'));
    if(manifest.applicationProfile!=='quartus') throw Error('需要 Quartus 录制；请在运行 Quartus 的 Windows 内启动录制器');
    const config=options.config?await readJson(path.resolve(options.config)):{};
    const settings=config.analysis?.quartus??{};
    const maxRequests=integer(settings.maxRequestsPerRun,4,1,40,'请求上限');
    const repairs=integer(settings.maxValidationRepairs,1,0,2,'修复上限');
    const maxImages=config.analysis?.includeScreenshots===false?0:integer(settings.maxScreenshotsPerRequest,16,0,100,'截图上限');
    const maxTokens=integer(settings.maxOutputTokens,12000,100,32000,'输出 token 上限');
    const maxContextBytes=integer(settings.maxContextBytes,131072,8192,524288,'文本证据预算');
    const events=await readJsonLines(path.join(recording,'events.jsonl'));
    const ids=events.map(e=>e.id);
    if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length) throw Error('录制事件 ID 缺失或重复');
    if(events.some(e=>!Number.isFinite(e.timestampMs))) throw Error('录制事件缺少有效时间');
    const actions=buildQuartusActions(events);
    const chunks=chunkQuartusActions(actions,integer(settings.maxActionsPerRequest,60,1,300,'分段输入上限'));
    const knowledgeRoot=path.join(workspace,'ui-maps/quartus/26.1.1-pro/en-US');
    const knowledge=await loadQuartusKnowledge(knowledgeRoot);
    const evidence=[];
    for(const chunk of chunks) {
      const selected=await selectQuartusEvidence(recording,chunk,maxImages);
      selected.signatures=await Promise.all(selected.images.map(async image=>({file:image.label,sha256:hash(await fs.readFile(image.path))})));
      evidence.push(selected);
    }
    const accounted=new Set(actions.flatMap(a=>a.sourceEventIds));
    const ignorable=e=>['mouse_move','state_observation','capture_error'].includes(e.eventType)||
      (e.eventType==='key_down'&&/^(SHIFT|CTRL|CONTROL|ALT|LWIN|RWIN|WIN|LSHIFT|RSHIFT|LCONTROL|RCONTROL|LMENU|RMENU)$/i.test(e.key??''));
    const orphaned=events.filter(e=>isQuartus(e.window)&&!ignorable(e)&&!accounted.has(e.id));
    const captureErrors=events.filter(e=>e.eventType==='capture_error');
    const preparation={format:'QuartusPreparation',version:'1.0',captureMode:manifest.captureMode??'visual-input',
      sourceRecording:recording,actionCount:actions.length,chunkCount:chunks.length,orphanedEventIds:orphaned.map(e=>e.id),captureErrors,
      limits:{maxRequests,repairs,maxImages,maxTokens,maxContextBytes},
      chunks:chunks.map((chunk,i)=>({index:i+1,actions:chunk,screenshotFiles:evidence[i].images.map(x=>x.label),
        signatures:evidence[i].signatures,harness:buildQuartusHarness(chunk,null,evidence[i])}))};
    const offline=options.reprocessFrom?await loadQuartusReprocess({source:options.reprocessFrom,output,preparation}):null;
    if(offline) {
      await fs.mkdir(path.dirname(output),{recursive:true});
      await fs.mkdir(output);
    } else await fs.mkdir(output,{recursive:true});
    outputWritable=true;
    await writeJson(path.join(output,'quartus-preparation.json'),preparation);
    if(offline)await writeJson(path.join(output,'reprocess-provenance.json'),offline.provenance);
    if(options.prepareOnly) {
      await writeJson(statusFile,{status:'prepared',apiRequests:0,applicationReplay:'not_run'});
      return {preparation,output,apiRequests:0};
    }
    if(!actions.length) throw Error('没有 Quartus 输入；远程桌面进程不能代替目标软件身份');
    if(!offline&&!options.config&&!dependencies.client) throw Error('API 分析需要 --config；--prepare-only 只整理本地证据');
    await writeJson(statusFile,{status:'running',startedAt:new Date().toISOString(),existingArtifacts:'previous_run_until_succeeded'});
    const sourceNames=['quartus-cli.mjs','lib/quartus-trace.mjs','lib/quartus-prompt.mjs','lib/quartus-harness.mjs',
      'lib/quartus-workflow.mjs','lib/quartus-project.mjs','lib/quartus-knowledge.mjs','lib/quartus-reprocess.mjs','lib/trace.mjs','lib/gpt-client.mjs'];
    const sources=await Promise.all(sourceNames.map(f=>fs.readFile(path.join(workspace,'src/analyzer',f),'utf8')));
    const identity=createAnalysisCheckpointIdentity({manifest,events,sources,provider:config.provider,settings,
      imageEnabled:config.analysis?.includeScreenshots,knowledge:knowledge.entries,
      provenance:[...knowledge.sourceById.values()],evidence:evidence.map(e=>({signatures:e.signatures,excluded:e.excluded,missing:e.missing})),
      schema:QUARTUS_WORKFLOW_SCHEMA});
    const checkpointFile=path.join(output,'analysis-checkpoint.json');
    const completed=offline?.completed??(await loadAnalysisCheckpoint(checkpointFile,identity,chunks.length))?.completed??[];
    if(!offline&&!dependencies.client) {
      await loadLocalEnv(path.join(workspace,'.env'));
      if(options.config) await loadLocalEnv(path.join(path.dirname(path.resolve(options.config)),'.env'));
    }
    if(!offline)client=dependencies.client??new GptClient({...config.provider,maxRetries:0});
    const allEvents=[],allImages=[];
    for(let i=0;i<chunks.length;i++) {
      stage=`chunk_${i+1}`;
      const chunk=chunks[i],previous=completed[i-1]?.plan,currentEvents=[...new Set(chunk.flatMap(actionEventIds))];
      const inputEventIds=[...new Set(chunk.flatMap(a=>a.sourceEventIds))];
      const inputSet=new Set(inputEventIds),observationEventIds=currentEvents.filter(id=>!inputSet.has(id));
      const screenshotFiles=evidence[i].images.map(x=>x.label);
      allEvents.push(...currentEvents); allImages.push(...screenshotFiles);
      const validation={eventIds:[...new Set(allEvents)],screenshotFiles:[...new Set(allImages)],
        previousOperationIds:completed.slice(0,i).flatMap(c=>c.plan.operations.map(op=>op.id)),
        currentInputEventIds:inputEventIds,currentEventIds:currentEvents,currentScreenshotFiles:screenshotFiles};
      if(i<completed.length) {
        completed[i].plan=validateQuartusWorkflow(completed[i].plan,validation);
        enforceEvidenceInheritance(completed[i].plan,previous,currentEvents,screenshotFiles);
        enforceCoverage(completed[i].plan,chunk);
        continue;
      }
      if(offline)throw Error('离线结果缺少分段；不会退回 API 分析');
      const context=previousContext(previous,completed.slice(0,i).map(c=>c.plan));
      const queryActions=chunk.map(a=>({...a,observedText:[a.observedText,a.window?.title,a.target?.name].filter(Boolean).join(' ')}));
      const knowledgeContext=retrieveQuartusKnowledge(knowledge,queryActions,{application:'quartus'},
        integer(settings.maxKnowledgeEntries,16,1,100,'知识条目预算'));
      const harness=buildQuartusHarness(chunk,previous?.state,evidence[i]);
      const payload={application:'Quartus',language:config.analysis?.language??'zh-CN',chunk:{index:i+1,total:chunks.length},
        sourceEventIds:inputEventIds,inputEventIds,observationEventIds,evidenceEventIds:currentEvents,
        actions:chunk,screenshotFiles,knowledge:knowledgeContext,harness,previousContext:context,
        capture:{applicationProfile:manifest.applicationProfile,mode:manifest.captureMode??'visual-input',
          screenshotScope:manifest.screenshotScope??null,uiAutomationTargets:manifest.uiAutomationTargets??false,softwareInternalApi:false},
        imageMappings:screenshotFiles.map(f=>({sourceFile:f,uploadedLabel:f,mapping:'original-image-no-resize'}))};
      if(Buffer.byteLength(JSON.stringify(payload))>maxContextBytes) throw Error('分段文本及续接状态超出预算；已完成检查点保留，请增加预算或缩小录制');
      let plan,last,errorMessage,validationDetails;
      for(let attempt=0;attempt<=repairs;attempt++) {
        if(requests>=maxRequests) throw Error(`达到本次 ${maxRequests} 次 API 请求上限，检查点已保留`);
        // Check image bytes again so a changing recording cannot silently alter checkpoint evidence.
        for(const image of evidence[i].images) if(hash(await fs.readFile(image.path))!==evidence[i].signatures.find(s=>s.file===image.label).sha256)
          throw Error('截图在整理后发生变化，请停止录制后重新分析');
        const requestPayload=attempt?{...payload,validationRepair:{error:errorMessage,...(validationDetails?{details:validationDetails}:{}),previousResult:last}}:payload;
        if(Buffer.byteLength(JSON.stringify(requestPayload))>maxContextBytes) throw Error('修复请求超过文本预算，停止修复');
        requests++;
        console.log(`Quartus ${i+1}/${chunks.length}，截图 ${screenshotFiles.length}，请求 ${requests}/${maxRequests}`);
        last=await client.analyze({instructions:QUARTUS_ANALYSIS_INSTRUCTIONS,payload:requestPayload,screenshots:evidence[i].images,
          outputSchema:quartusResponseSchema(inputEventIds),outputName:'quartus_workflow',outputDescription:'有证据的 Quartus 工程最终状态与操作记录',maxOutputTokens:maxTokens});
        await writeJson(path.join(output,`model-result-${i+1}-${attempt+1}.json`),last);
        try {
          plan=validateQuartusWorkflow(last,validation);
          enforceEvidenceInheritance(plan,previous,currentEvents,screenshotFiles);
          enforceCoverage(plan,chunk);
          break;
        } catch(error) {errorMessage=error.message;validationDetails=error.validationDetails;if(attempt===repairs) throw error;}
      }
      completed.push({index:i+1,plan,audit:{eventIds:currentEvents,screenshotFiles,harness,knowledge:knowledgeContext,imageMappings:payload.imageMappings}});
      await saveAnalysisCheckpoint(checkpointFile,{identity,totalChunks:chunks.length,completed});
    }
    stage='generate';
    const workflow=mergeQuartusWorkflows(completed.map(c=>c.plan));
    enforceCoverage(workflow,actions);
    const evidenceResolution=assessQuartusFinalTransitionEvidence(chunks,completed,evidence,workflow);
    for(let i=0;i<completed.length;i++)completed[i].audit.resolvedTransitionEvidence=evidenceResolution.chunks[i].resolvedTransitionEvidence;
    if(orphaned.length||captureErrors.length||evidence.some(e=>e.excluded.length)||evidenceResolution.chunks.some(e=>e.unresolvedMissingEvidence.length)) {
      workflow.complete=false;
      workflow.unresolved.push({description:'采集或截图预算有缺口，详见 quartus-preparation.json',sourceEventIds:orphaned.length?orphaned.map(e=>e.id):actions[0].sourceEventIds});
    }
    if(workflow.complete) {
      try {compileQuartusProject(workflow);} catch(error) {
        workflow.complete=false;
        workflow.unresolved.push({description:`本地工程校验拒绝：${error.message}`,sourceEventIds:actions[0].sourceEventIds});
      }
    }
    const verification={localValidation:'passed',realModelAccuracy:'not_measured',applicationReplay:'not_run',logicalBehavior:'not_tested'};
    await writeJson(path.join(output,'quartus-workflow.json'),workflow);
    await writeJson(path.join(output,'semantic-trace.json'),workflow);
    await writeJson(path.join(output,'analysis-harness.json'),completed.map(c=>c.audit));
    await writeJson(path.join(output,'quartus-evidence-resolution.json'),evidenceResolution);
    const bundle=path.join(output,`project-bundle-${randomUUID().slice(0,8)}`);
    const build=workflow.complete?{status:'generated',...await writeQuartusProjectArtifacts(bundle,workflow)}:
      {status:'blocked',generated:false,executed:false,blockers:workflow.unresolved.map(u=>u.description).concat('工程不完整或证据不足，请查看 quartus-workflow.json')};
    await writeJson(statusFile,{status:'succeeded',completedAt:new Date().toISOString(),identity,requests,complete:workflow.complete,
      mode:offline?'offline-reprocess':'api-analysis',...(offline?{reprocess:offline.provenance}:{}),
      verification,build,evidenceResolution,usage:summarizeUsageRecords(client?.getUsageRecords?.()??[])});
    return {workflow,output,build,evidenceResolution,apiRequests:requests};
  } catch(error) {
    if(!options.reprocessFrom||outputWritable)await fs.mkdir(output,{recursive:true}).then(()=>writeJson(statusFile,{status:'failed',stage,message:error.message,requests,
      existingArtifacts:'previous_run_not_current',usage:summarizeUsageRecords(client?.getUsageRecords?.()??[])})).catch(()=>{});
    throw error;
  }
}

export function parseQuartusArgs(argv) {
  const result={};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--prepare-only') {result.prepareOnly=true;continue;}
    if(!['--recording','--config','--output','--reprocess-from'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--')) throw Error(`无效参数: ${argv[i]}`);
    result[argv[i]==='--reprocess-from'?'reprocessFrom':argv[i].slice(2)]=argv[++i];
  }
  if(!result.recording) throw Error('需要 --recording <Quartus录制目录>');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await runQuartusAnalysis(parseQuartusArgs(process.argv.slice(2))); console.log(`Quartus 输出：${result.output}`);}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
