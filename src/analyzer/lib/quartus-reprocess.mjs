import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_JSON_BYTES=16*1024*1024;
const sha=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw new Error(`Quartus offline reprocess: ${message}`);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function stringList(value,label,{nonempty=false}={}) {
  if(!Array.isArray(value)||nonempty&&!value.length||value.some(v=>typeof v!=='string'||!v||v.length>4096)||new Set(value).size!==value.length)fail(`${label} must contain unique nonempty strings`);
  return value;
}
function normalizeForComparison(value){const normalized=path.resolve(value);return process.platform==='win32'?normalized.toLowerCase():normalized;}
function isWithin(parent,child){const relative=path.relative(normalizeForComparison(parent),normalizeForComparison(child));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
async function absentRealPath(target) {
  const absolute=path.resolve(target);
  try {await fs.lstat(absolute);fail('output must be a completely new directory');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let ancestor=path.dirname(absolute),tail=[path.basename(absolute)];
  while(true) {
    try {
      const real=await fs.realpath(ancestor),stat=await fs.stat(real);
      if(!stat.isDirectory())fail('output ancestor is not a directory');
      return path.resolve(real,...tail);
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      // An existing broken symlink is not a safe, nonexistent output ancestor.
      try{await fs.lstat(ancestor);fail('output ancestor is a broken alias');}catch(statError){if(statError.code!=='ENOENT')throw statError;}
      const parent=path.dirname(ancestor);if(parent===ancestor)fail('output has no accessible parent');tail.unshift(path.basename(ancestor));ancestor=parent;
    }
  }
}
async function readJsonSnapshot(directory,name) {
  const filename=path.join(directory,name),before=await fs.lstat(filename);
  if(!before.isFile()||before.isSymbolicLink())fail(`${name} must be a regular file, not a symlink`);
  if(before.size>MAX_JSON_BYTES)fail(`${name} exceeds 16 MiB`);
  const handle=await fs.open(filename,'r');
  try {
    const opened=await handle.stat();
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>MAX_JSON_BYTES)fail(`${name} changed while opening`);
    // Bounded read also rejects a file that grows after the initial size check.
    const buffer=Buffer.alloc(MAX_JSON_BYTES+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length>MAX_JSON_BYTES)fail(`${name} exceeds 16 MiB`);
    const after=await handle.stat(),current=await fs.lstat(filename);
    if(current.isSymbolicLink()||!current.isFile()||current.dev!==opened.dev||current.ino!==opened.ino||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||length!==after.size)fail(`${name} changed during reading`);
    const bytes=buffer.subarray(0,length);let value;
    try {value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail(`${name} is not valid JSON`);}
    return {value,path:filename,sha256:sha(bytes),bytes:length};
  }finally{await handle.close();}
}
function inspectPreparation(value,label) {
  if(!plain(value)||value.format!=='QuartusPreparation'||value.version!=='1.0'||value.captureMode!=='visual-input'||!Number.isInteger(value.chunkCount)||value.chunkCount<1||value.chunkCount>2048||!Array.isArray(value.chunks)||value.chunks.length!==value.chunkCount)fail(`${label} preparation format/version/chunk count is invalid`);
  stringList(value.orphanedEventIds,`${label} orphaned events`);
  if(!Array.isArray(value.captureErrors))fail(`${label} capture errors missing`);
  let count=0;
  for(let i=0;i<value.chunks.length;i++) {
    const chunk=value.chunks[i];
    if(!plain(chunk)||chunk.index!==i+1||!Array.isArray(chunk.actions)||!chunk.actions.length||!plain(chunk.harness)||chunk.harness.format!=='QuartusAnalysisHarness'||chunk.harness.version!=='1.0')fail(`${label} chunk ${i+1} is malformed or out of order`);
    count+=chunk.actions.length;
    stringList(chunk.screenshotFiles,`${label} chunk ${i+1} screenshots`);
    if(!Array.isArray(chunk.signatures)||chunk.signatures.length!==chunk.screenshotFiles.length||chunk.signatures.some((s,n)=>!plain(s)||s.file!==chunk.screenshotFiles[n]||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)))fail(`${label} chunk ${i+1} screenshot signatures are invalid`);
    for(const action of chunk.actions) {
      if(!plain(action))fail(`${label} action is invalid`);
      stringList(action.sourceEventIds,`${label} action inputs`,{nonempty:true});
      for(const key of ['observations','transitionObservations'])if(action[key]!==undefined&&(!Array.isArray(action[key])||action[key].some(o=>!plain(o)||typeof o.eventId!=='string'||!o.eventId)))fail(`${label} action observations are invalid`);
    }
  }
  if(!Number.isInteger(value.actionCount)||value.actionCount!==count)fail(`${label} preparation action count is invalid`);
}

/** Import an explicitly selected, complete old model result. This is never checkpoint resume. */
export async function loadQuartusReprocess({source,output,preparation}={}) {
  if(typeof source!=='string'||!source.trim()||typeof output!=='string'||!output.trim())fail('source and a new output directory are required');
  const sourceDirectory=await fs.realpath(path.resolve(source));
  if(!(await fs.stat(sourceDirectory)).isDirectory())fail('source must be a directory');
  const outputDirectory=await absentRealPath(output);
  if(isWithin(sourceDirectory,outputDirectory)||isWithin(outputDirectory,sourceDirectory))fail('source and output cannot overlap or alias one another');
  inspectPreparation(preparation,'fresh');
  const [checkpointFile,preparationFile]=await Promise.all([readJsonSnapshot(sourceDirectory,'analysis-checkpoint.json'),readJsonSnapshot(sourceDirectory,'quartus-preparation.json')]);
  const checkpoint=checkpointFile.value,old=preparationFile.value;
  inspectPreparation(old,'source');
  if(!plain(checkpoint)||checkpoint.format!=='RecorderAnalysisCheckpoint'||checkpoint.version!=='0.1'||typeof checkpoint.identity!=='string'||!/^[a-f0-9]{64}$/.test(checkpoint.identity)||checkpoint.totalChunks!==preparation.chunkCount||!Array.isArray(checkpoint.completed)||checkpoint.completed.length!==checkpoint.totalChunks)fail('source checkpoint must contain every consecutive chunk with a supported format/version');
  for(const key of ['captureMode','actionCount','chunkCount','orphanedEventIds','captureErrors'])if(!equal(old[key],preparation[key]))fail(`preparation mismatch: ${key}`);
  for(let i=0;i<preparation.chunkCount;i++) {
    const fresh=preparation.chunks[i],prior=old.chunks[i],completed=checkpoint.completed[i];
    for(const key of ['index','actions','screenshotFiles','signatures','harness'])if(!equal(prior[key],fresh[key]))fail(`preparation mismatch in chunk ${i+1}: ${key}`);
    if(!plain(completed)||completed.index!==i+1||!plain(completed.plan)||completed.plan.schemaVersion!=='quartus-workflow/1'||!plain(completed.audit))fail(`source checkpoint chunk ${i+1} is missing, out of order, or has an unsupported plan`);
    const expectedEvents=[...new Set(fresh.actions.flatMap(a=>[...a.sourceEventIds,...(a.observations??[]).map(o=>o.eventId),...(a.transitionObservations??[]).map(o=>o.eventId)]))].sort();
    const auditedEvents=stringList(completed.audit.eventIds,`checkpoint chunk ${i+1} event audit`);
    const auditedImages=stringList(completed.audit.screenshotFiles,`checkpoint chunk ${i+1} screenshot audit`);
    if(!equal([...auditedEvents].sort(),expectedEvents))fail(`checkpoint chunk ${i+1} event audit does not match fresh input/observation events`);
    if(!equal(auditedImages,fresh.screenshotFiles))fail(`checkpoint chunk ${i+1} screenshot audit does not match fresh selection`);
  }
  // Recheck absence before handing off; the caller still owns atomic directory creation.
  if(await absentRealPath(output)!==outputDirectory)fail('output alias changed during validation');
  return {completed:structuredClone(checkpoint.completed),provenance:{
    mode:'offline-reprocess',apiRequests:0,sourceDirectory,sourceRequested:path.resolve(source),outputDirectory,
    sourceIdentity:checkpoint.identity,completedChunks:checkpoint.totalChunks,
    sourceFiles:{checkpoint:{path:checkpointFile.path,sha256:checkpointFile.sha256,bytes:checkpointFile.bytes},preparation:{path:preparationFile.path,sha256:preparationFile.sha256,bytes:preparationFile.bytes}},
    modelResultOrigin:'explicitly_imported_existing_results',newApiAnalysis:false,checkpointResume:false
  }};
}
