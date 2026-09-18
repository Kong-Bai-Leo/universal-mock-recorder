// Stata VM development package. Explicit executable/analyzer/UI-document allowlist;
// never walk the workspace or copy .env, user config, recordings, screenshots.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const STATA_PACKAGE_STATIC_FILES=[
  'bin/stata-recorder/StataRecorder.exe',
  'scripts/analyze-stata-recording.ps1',
  'src/analyzer/stata-cli.mjs',
  ...['stata-analysis','stata-evidence','stata-knowledge','stata-program','stata-renderer','gpt-client','workflow','local-env']
    .map(name=>'src/analyzer/lib/'+name+'.mjs'),
  'docs/stata18-support-matrix.md',
  'docs/stata18-real-recording-verification-2026-09-18.md',
  'ui-maps/stata/18/en-US/live-observation.json',
  'ui-maps/stata/18/en-US/verification-report.json'
];
const mapBase='ui-maps/stata/18/en-US/';
function safeRelative(value){
  if(typeof value!=='string'||!value||path.isAbsolute(value)||/(^|[\\/])\.\.([\\/]|$)/.test(value)||value.includes(':')||/[\x00-\x1f]/.test(value))
    throw Error('Unsafe package path');
  return value;
}
async function safeCopy(sourceRoot,destinationRoot,relative){
  safeRelative(relative);
  const source=path.resolve(sourceRoot,relative),relation=path.relative(sourceRoot,source);
  if(relation.startsWith('..')||path.isAbsolute(relation))throw Error('Package source escaped root');
  const resolved=await fs.realpath(source);
  if(path.normalize(resolved).toLowerCase()!==path.normalize(source).toLowerCase())throw Error('Package source traverses a symlink: '+relative);
  const stat=await fs.lstat(source);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Package source must be a regular non-symlink file: '+relative);
  const target=path.join(destinationRoot,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(source,target);
}
export async function packageStataRecorder({sourceRoot=repoRoot,outputRoot=path.join(sourceRoot,'dist')}={}){
  const root=await fs.realpath(path.resolve(sourceRoot));
  const indexFile=path.join(root,mapBase,'ui-index.json');
  if(path.normalize(await fs.realpath(indexFile)).toLowerCase()!==path.normalize(indexFile).toLowerCase())throw Error('Stata UI index traverses a symlink');
  if((await fs.lstat(indexFile)).isSymbolicLink())throw Error('Stata UI index cannot be a symlink');
  const index=JSON.parse(await fs.readFile(indexFile,'utf8'));
  if(index.application!=='Stata/MP'||index.version!=='18.0'||index.language!=='en-US'||!Array.isArray(index.sections))
    throw Error('Unexpected Stata UI index');
  const sections=index.sections.map(s=>{
    if(typeof s!=='string'||!(/^[a-z-]+\/ui-map\.json$/).test(s))throw Error('Invalid Stata map section path');
    return s;
  });
  if(new Set(sections).size!==sections.length||sections.length>20)throw Error('Duplicate/oversized Stata map index');
  const files=[...STATA_PACKAGE_STATIC_FILES,mapBase+'ui-index.json',...sections.map(s=>mapBase+s)];
  const outBase=path.resolve(outputRoot);await fs.mkdir(outBase,{recursive:true});
  const out=await fs.mkdtemp(path.join(outBase,'stata-vm-'));
  for(const file of files)await safeCopy(root,out,file);
  // Use only public example fields, not the user's config.json or .env.
  const exampleFile=path.join(root,'config.example.json');
  if(path.normalize(await fs.realpath(exampleFile)).toLowerCase()!==path.normalize(exampleFile).toLowerCase())throw Error('Public example config traverses a symlink');
  if((await fs.lstat(exampleFile)).isSymbolicLink())throw Error('Public example config cannot be a symlink');
  const example=JSON.parse(await fs.readFile(exampleFile,'utf8'));
  const allowed=['model','reasoningEffort','verbosity','imageDetail','timeoutSeconds','streamResponses'];
  const provider=Object.fromEntries(allowed.filter(k=>example.provider?.[k]!==undefined).map(k=>[k,example.provider[k]]));
  if(typeof provider.model!=='string'||!provider.model)throw Error('Public example provider.model missing');
  await fs.writeFile(path.join(out,'config.json'),JSON.stringify({provider},null,2),'utf8');
  await fs.writeFile(path.join(out,'PACKAGE-NOTE.txt'),
    'Development package for same-session Stata/MP 18.0 en-US recording. Read ui-index.json and per-control verification: the current map is a partial live scan, not complete application coverage or native execution proof. No credentials, recordings, screenshots, original datasets or user config are included. Recording works without Node; analysis needs Node.js 20+ in the VM or on a separate analysis host. Preparation does not upload; paid --analyze requires separate authorization. Native Stata execution and source-recording comparison are not proven by this package.\n','utf8');
  return {directory:out,files:[...files,'config.json','PACKAGE-NOTE.txt']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2)throw Error('Usage: node scripts/package-stata-recorder.mjs');
  packageStataRecorder().then(x=>console.log(x.directory),e=>{console.error(e.message);process.exitCode=1;});
}
