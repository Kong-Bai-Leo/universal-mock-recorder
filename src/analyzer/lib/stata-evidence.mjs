import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const STATA_BUDGET=Object.freeze({maxRequestsPerRound:2,maxImages:12,maxOutputTokens:6000,
  maxInputEvents:60,maxPayloadBytes:100000,maxRequestBytes:8*1024*1024});
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const inputTypes=new Set(['mouse_down','mouse_up','mouse_move','mouse_wheel','key_down']);
const screenshotKeys=['screenshotBefore','screenshotSelection','screenshotAfter','screenshotSettledAfter','screenshot'];
// Stata 18 Windows User's Guide B.2 lists StataMP/SE/BE-64.exe. The current
// target is observed MP; SE/BE names are documented candidates, not this VM.
export const STATA_WINDOWS_PROCESS_NAMES=Object.freeze(['statamp-64','statase-64','statabe-64']);
const basename=name=>String(name??'').toLowerCase().replace(/\.exe$/,'');
function stata18Version(manifest){
  const raw=manifest.applicationVersion;
  if(typeof raw!=='string')return null;
  const direct=/^18\.0(?:\.\d+){0,2}$/.test(raw);
  // Windows metadata on the observed Stata/MP 18 executable uses 521.18.0.build.
  // This is not a general mapping from arbitrary 521.x releases to Stata x.
  const encoded=/^521\.18\.0\.\d+$/.test(raw);
  if(!direct&&!encoded)return null;
  const source=manifest.versionSource;
  if(source!==undefined&&source!=='ProductVersion'&&source!=='FileVersion')return null;
  if(encoded&&!source)return null;
  const numeric=value=>typeof value==='string'?value.replace(/,/g,'.'):null;
  const product=numeric(manifest.productVersion),file=numeric(manifest.fileVersion);
  if(manifest.productVersion!=null&&product!==raw)return null;
  if(manifest.fileVersion!=null&&file!==raw)return null;
  if(source==='ProductVersion'&&product!==raw||source==='FileVersion'&&file!==raw)return null;
  return {version:'18.0',rawVersion:raw,source:source??'legacy_applicationVersion'};
}
export async function insideStataFile(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||/(^|[\\/])\.\.([\\/]|$)/.test(relative)||relative.includes(':'))throw Error('Unsafe recording file path');
  const base=await fs.realpath(root),file=await fs.realpath(path.resolve(base,relative));
  const rel=path.relative(base,file);
  if(rel.startsWith('..')||path.isAbsolute(rel)||!(await fs.stat(file)).isFile())throw Error('Recording file escapes root or is not a file');
  return file;
}
export function groupStataEvents(events){
  const groups=[];let gesture=null;
  for(const e of events){
    if(e.eventType==='mouse_down'){if(gesture)throw Error('Overlapping pointer gesture');gesture=[e];}
    else if(gesture){gesture.push(e);if(e.eventType==='mouse_up'){groups.push(gesture);gesture=null;}}
    else {if(e.eventType==='mouse_up')throw Error('Pointer release without down');groups.push([e]);}
  }
  if(gesture)throw Error('Recording ends inside pointer gesture');
  return groups;
}
export async function prepareStataEvidence(recording){
  const manifestBytes=await fs.readFile(await insideStataFile(recording,'manifest.json'));
  const eventBytes=await fs.readFile(await insideStataFile(recording,'events.jsonl'));
  const manifest=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,''));
  const version=stata18Version(manifest);
  if(manifest.applicationProfile!=='stata'||!version||manifest.applicationEdition!=='MP'||manifest.language!=='en-US'||manifest.captureDeployment!=='same-windows-session')
    throw Error('Stata evidence requires same-session Stata/MP 18.0 en-US manifest; unverified versions/editions are rejected');
  if(manifest.targetLost===true)throw Error('Stata target process was lost during capture; no upload');
  if(basename(manifest.targetProcess)!=='statamp-64')throw Error('Stata/MP targetProcess does not match the documented StataMP-64.exe');
  if(!Number.isInteger(manifest.targetProcessId)||manifest.targetProcessId<=0||!Number.isInteger(manifest.targetSessionId)||manifest.targetSessionId<0)
    throw Error('Stata manifest requires captured target process and session identity');
  const raw=eventBytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));
  if(raw.length>20000)throw Error('Stata recording exceeds local 20000-event limit');
  const events=[],excluded=[],ids=new Set();let time=-1;
  for(const e of raw){
    if(typeof e.id!=='string'||!e.id||ids.has(e.id)||!Number.isFinite(e.timestampMs)||e.timestampMs<time)throw Error('Invalid/duplicate/out-of-order input event');
    ids.add(e.id);time=e.timestampMs;
    if(e.error||/error/.test(e.eventType)||['privacy_pause','privacy_resume','target_lost'].includes(e.eventType))throw Error('Capture error, privacy pause or target_lost; no upload');
    if(basename(e.window?.processName)!=='statamp-64'||e.window?.processId!==manifest.targetProcessId){excluded.push({id:e.id,reason:'outside_captured_target_process'});continue;}
    if(!inputTypes.has(e.eventType)){excluded.push({id:e.id,reason:'unsupported_event_type'});continue;}
    events.push(Object.fromEntries(['id','eventType','timestampMs','x','y','relativeX','relativeY','button','wheelDelta','key','text','modifiers','window','target','visualChange',
      ...screenshotKeys,...screenshotKeys.map(x=>x+'TimestampMs')].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])));
  }
  if(!events.length)throw Error('No Stata/MP input; inspect same-session capture process');
  const images=new Map(),byHash=new Map(),imageAliases=[],temporalWarnings=[];
  for(let i=0;i<events.length;i++){
    const e=events[i];e.frames=[];
    for(const key of screenshotKeys){
      if(!e[key])continue;
      const label=e[key].replaceAll('\\','/');
      if(!/\.(jpg|jpeg|png)$/i.test(label))throw Error('Unsupported screenshot extension');
      if(!images.has(label)){
        const file=await insideStataFile(recording,label),bytes=await fs.readFile(file);
        const jpeg=bytes[0]===255&&bytes[1]===216,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        if(!jpeg&&!png||bytes.length>5*1024*1024)throw Error('Bad/oversized JPEG or PNG screenshot');
        const hash=digest(bytes),representative=byHash.get(hash);
        const image={label,path:file,bytes:bytes.length,digest:hash,uploadImageLabel:representative?.label??label};
        images.set(label,image);
        if(!representative)byHash.set(hash,image);
        else imageAliases.push({file:label,uploadImageLabel:representative.label,sha256:hash,reason:'identical_file_sha256'});
      }
      const capturedAtMs=e[key+'TimestampMs']??null;
      const later=capturedAtMs!==null&&events[i+1]&&capturedAtMs>=events[i+1].timestampMs;
      e.frames.push({label,uploadImageLabel:images.get(label).uploadImageLabel,role:key,capturedAtMs,
        attribution:capturedAtMs===null?'unknown_time':later?'later_inputs_may_be_visible':'time_bounded_observation'});
      if(later)temporalWarnings.push({eventId:e.id,label,reason:'Capture occurred after next input; not isolated proof of this action'});
      delete e[key];delete e[key+'TimestampMs'];
    }
  }
  const chunks=[];let pending=[];
  const describe=group=>{const labels=[...new Set(group.flatMap(e=>e.frames.map(f=>f.uploadImageLabel)))];
    return {events:group,inputIds:group.map(e=>e.id),images:labels.map(x=>images.get(x))};};
  const fits=group=>{const c=describe(group);return c.images.length<=STATA_BUDGET.maxImages&&c.events.length<=STATA_BUDGET.maxInputEvents&&
    Buffer.byteLength(JSON.stringify(c.events))<=STATA_BUDGET.maxPayloadBytes&&
    c.images.reduce((n,x)=>n+Math.ceil(x.bytes/3)*4,0)<=STATA_BUDGET.maxRequestBytes-200000;};
  for(const group of groupStataEvents(events)){
    if(!fits(group))throw Error('One pointer transaction exceeds evidence budget; no evidence was discarded');
    if(pending.length&&!fits([...pending,...group])){chunks.push(describe(pending));pending=[];}
    pending.push(...group);
  }
  if(pending.length)chunks.push(describe(pending));
  if(chunks.some(c=>!c.images.length))throw Error('Screenshot-free chunk cannot support Stata reconstruction');
  return {manifest,normalizedApplicationVersion:version.version,versionProvenance:version,events,chunks,excluded,images:[...images.values()],imageAliases,temporalWarnings,
    sourceDigest:digest(Buffer.concat([manifestBytes,eventBytes]))};
}
