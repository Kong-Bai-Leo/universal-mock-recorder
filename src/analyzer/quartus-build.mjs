#!/usr/bin/env node
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {writeQuartusProjectArtifacts} from './lib/quartus-project.mjs';
export async function main(args=process.argv.slice(2)) {
  const values={},flags=new Set();
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(['--execute','--compile','--help'].includes(arg)){if(flags.has(arg))throw new Error('Duplicate option');flags.add(arg);}
    else if(['--workflow','--output','--quartus-sh','--timeout-ms','--target'].includes(arg)){if(values[arg]||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing/duplicate value: ${arg}`);values[arg]=args[++i];}
    else throw new Error(`Unknown option: ${arg}`);
  }
  if(flags.has('--help')){console.log('quartus-build --workflow workflow.json --output NEW_DIRECTORY [--target cli|gui] [--execute --quartus-sh ABSOLUTE_PATH] [--compile] [--timeout-ms 600000]\nGeneration alone does not create a native project. Execute invokes fixed local Tcl to create .qpf/.qsf and verify assignments. GUI target runs through Tools > Tcl Scripts with no project open.');return;}
  if(!values['--workflow']||!values['--output'])throw new Error('--workflow and --output are required');
  const stat=await fs.stat(values['--workflow']);if(stat.size>2097152)throw new Error('Workflow exceeds 2 MiB');
  const workflow=JSON.parse(await fs.readFile(values['--workflow'],'utf8'));
  const result=await writeQuartusProjectArtifacts(values['--output'],workflow,{execute:flags.has('--execute'),compile:flags.has('--compile'),target:values['--target']??'cli',quartusSh:values['--quartus-sh'],...(values['--timeout-ms']?{timeoutMs:Number(values['--timeout-ms'])}:{})});
  console.log(JSON.stringify(result,null,2));
  if(flags.has('--execute')&&(!result.assignmentsVerified||(flags.has('--compile')&&!result.compiled)))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
