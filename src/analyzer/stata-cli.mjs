#!/usr/bin/env node
// Offline compilation only. Evidence acquisition / paid model analysis is not
// advertised until the Stata profile and native validation are available.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderStata,newStataRuntimeDirectoryName} from './lib/stata-renderer.mjs';
export {runStataAnalysis,compileSavedStataAnalysis} from './lib/stata-analysis.mjs';

export async function compileStataPlan({planFile,outputRoot}) {
  if(!planFile||!outputRoot)throw Error('Usage: stata-cli.mjs --plan <bounded-json> --output-root <existing-safe-directory>');
  const root=await fs.realpath(path.resolve(outputRoot));
  const stat=await fs.stat(root);if(!stat.isDirectory())throw Error('Output root must be a directory');
  const input=JSON.parse((await fs.readFile(path.resolve(planFile),'utf8')).replace(/^\uFEFF/,''));
  if(!Array.isArray(input.eventIds)||new Set(input.eventIds).size!==input.eventIds.length)throw Error('Explicit evidence inventory required');
  // Validate before creating the host audit directory. The native output is
  // selected locally as a portable relative directory, never by model calls.
  const {validateStataProgram}=await import('./lib/stata-program.mjs');
  validateStataProgram(input.plan,{eventIds:input.eventIds,final:true});
  const run=await fs.mkdtemp(path.join(root,'stata-replay-'));
  const runtimeDirectoryName=newStataRuntimeDirectoryName();
  const script=renderStata(input.plan,{eventIds:input.eventIds,runtimeDirectoryName});
  const target=path.join(run,'stata-replay.do');
  await fs.writeFile(target,script,{encoding:'utf8',flag:'wx'});
  return {status:'script_generated_not_executed',primaryOutput:target,outputDirectory:run,
    runtimeOutputDirectory:`./${runtimeDirectoryName}`,runtimeDataFile:`./${runtimeDirectoryName}/reconstructed.dta`,
    verification:'not_run',sourceRecordingCompared:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),opts={};
  while(args.length){const flag=args.shift();
    if(flag==='--plan'&&args.length)opts.planFile=args.shift();
    else if(flag==='--output-root'&&args.length)opts.outputRoot=args.shift();
    else if(flag==='--recording'&&args.length)opts.recording=args.shift();
    else if(flag==='--config'&&args.length)opts.config=args.shift();
    else if(flag==='--compile-saved-run'&&args.length)opts.compileSavedRun=args.shift();
    else if(flag==='--resume-from-run'&&args.length)opts.resumeFromRun=args.shift();
    else if(flag==='--analyze')opts.analyze=true;
    else if(flag==='--prepare-only')opts.prepareOnly=true;
    else if(flag==='--retry-failed')opts.retryFailed=true;
    else throw Error('Unknown/missing argument: '+flag);
  }
  if(opts.planFile&&(opts.recording||opts.analyze||opts.compileSavedRun||opts.resumeFromRun))throw Error('Standalone plan compile cannot combine with recording analysis');
  const run=opts.planFile?compileStataPlan(opts):import('./lib/stata-analysis.mjs').then(x=>x.runStataAnalysis(opts));
  run.then(x=>console.log(JSON.stringify(x,null,2)),e=>{console.error(e.message);process.exitCode=1;});
}
