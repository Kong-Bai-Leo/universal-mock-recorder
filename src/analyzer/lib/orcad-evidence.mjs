import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const ORCAD_BUDGET=Object.freeze({maxImages:12,maxInputEvents:60,maxPayloadBytes:100000,maxRequestBytes:8*1024*1024,maxOutputTokens:6000,maxAttempts:2});
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const keys=['screenshotBefore','screenshotSelection','screenshotAfter','screenshotSettledAfter','screenshot'];
const input=new Set(['mouse_down','mouse_up','mouse_move','mouse_wheel','key_down']);
export async function insideFile(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes(':')||/(^|[\\/])\.\.([\\/]|$)/.test(relative))throw Error('Unsafe recording file path');
  const base=await fs.realpath(root),file=await fs.realpath(path.resolve(base,relative));
  const relation=path.relative(base,file);
  if(relation.startsWith('..')||path.isAbsolute(relation)||!(await fs.stat(file)).isFile())throw Error('Recording file escapes its root');
  return file;
}
export async function prepareOrcadEvidence(recording){
  const manifestBytes=await fs.readFile(await insideFile(recording,'manifest.json'));
  const eventBytes=await fs.readFile(await insideFile(recording,'events.jsonl'));
  const manifest=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,''));
  if(manifest.applicationProfile!=='orcad-x-capture'||manifest.captureDeployment!=='same-windows-session')throw Error('Expected same-session OrCAD X Capture recording');
  const raw=eventBytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  if(raw.length>20000)throw Error('Recording event limit exceeded');
  const events=[],excluded=[],ids=new Set();let time=-1;
  for(const e of raw){
    if(typeof e.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(e.id)||ids.has(e.id)||!Number.isFinite(e.timestampMs)||e.timestampMs<time)throw Error('Invalid event ID or time');
    ids.add(e.id);time=e.timestampMs;
    if(e.error||/error/.test(e.eventType)||['privacy_pause','privacy_resume'].includes(e.eventType))throw Error('Capture error or privacy gap');
    if(String(e.window?.processName??'').toLowerCase().replace(/\.exe$/,'')!=='capture'){excluded.push({id:e.id,reason:'outside_target_process'});continue;}
    if(!input.has(e.eventType))throw Error('Unknown target event type may contain persistent edit; no upload');
    events.push(Object.fromEntries(['id','eventType','timestampMs','x','y','relativeX','relativeY','button','wheelDelta','key','text','modifiers','window','target','visualCommandContext','visualChange',...keys,...keys.map(k=>k+'TimestampMs')].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])));
  }
  if(!events.length)throw Error('No OrCAD input events');
  const images=new Map(),aliases=[],byDigest=new Map(),temporalWarnings=[];
  for(let i=0;i<events.length;i++){
    const e=events[i];e.frames=[];
    for(const key of keys){
      if(!e[key])continue;
      const label=e[key].replaceAll('\\','/');
      if(!/\.(jpg|jpeg|png)$/i.test(label))throw Error('Unsupported screenshot format');
      if(!images.has(label)){
        const file=await insideFile(recording,label),bytes=await fs.readFile(file);
        if(bytes.length>5*1024*1024||!(bytes[0]===255&&bytes[1]===216)&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid or oversized screenshot');
        const hash=digest(bytes),prior=byDigest.get(hash),item={label,path:file,bytes:bytes.length,digest:hash,uploadImageLabel:prior?.label??label};
        images.set(label,item);if(!prior)byDigest.set(hash,item);else aliases.push({file:label,uploadImageLabel:prior.label,sha256:hash});
      }
      const capturedAtMs=e[key+'TimestampMs']??null,overlap=capturedAtMs!==null&&events[i+1]&&capturedAtMs>=events[i+1].timestampMs;
      e.frames.push({label,uploadImageLabel:images.get(label).uploadImageLabel,role:key,capturedAtMs,attribution:capturedAtMs===null?'unknown_time':overlap?'later_inputs_may_be_visible':'time_bounded_observation'});
      if(overlap)temporalWarnings.push({eventId:e.id,label,reason:'later input may be visible'});
      delete e[key];delete e[key+'TimestampMs'];
    }
  }
  // One complete session only. No chunking or partial before/after uploads.
  const relevant=events.filter(e=>e.eventType!=='mouse_move'||e.frames.length||e.visualChange);
  if(relevant.length!==events.length)for(const e of events)if(!relevant.includes(e))excluded.push({id:e.id,reason:'unframed_mouse_move'});
  if(!relevant.length)throw Error('No OrCAD input events after filtering');
  const uploads=[...byDigest.values()];
  const payloadBytes=Buffer.byteLength(JSON.stringify(relevant));
  const base64Bytes=uploads.reduce((n,x)=>n+Math.ceil(x.bytes/3)*4,0);
  const base64Limit=ORCAD_BUDGET.maxRequestBytes-200000;
  if(relevant.length>ORCAD_BUDGET.maxInputEvents||uploads.length>ORCAD_BUDGET.maxImages||payloadBytes>ORCAD_BUDGET.maxPayloadBytes||base64Bytes>base64Limit)
    throw Error(`Complete session exceeds request budget: unique images ${uploads.length}/${ORCAD_BUDGET.maxImages}, input events ${relevant.length}/${ORCAD_BUDGET.maxInputEvents}, payload bytes ${payloadBytes}/${ORCAD_BUDGET.maxPayloadBytes}, base64 bytes ${base64Bytes}/${base64Limit} (request limit ${ORCAD_BUDGET.maxRequestBytes} bytes includes 200000-byte reserve); no partial upload`);
  const before=relevant.some(e=>e.frames.some(f=>f.role==='screenshotBefore'));
  const after=relevant.some(e=>e.frames.some(f=>['screenshotAfter','screenshotSettledAfter'].includes(f.role)));
  if(!before||!after)throw Error('Missing before/after screenshot evidence; no upload');
  // Recorder.cs creates a key-down pair on the same input and a mouse-down /
  // mouse-up transaction pair. A later frame on another action cannot repair it.
  let down=null;
  for(const e of relevant){
    const has=role=>e.frames.some(f=>f.role===role);
    if(e.eventType==='key_down'&&(!has('screenshotBefore')||!has('screenshotAfter')))throw Error('Incomplete key-down before/after pair; no upload');
    const beforeTime=e.frames.find(f=>f.role==='screenshotBefore')?.capturedAtMs;
    const afterTime=e.frames.find(f=>f.role==='screenshotAfter')?.capturedAtMs;
    if(beforeTime!==undefined&&beforeTime!==null&&afterTime!==undefined&&afterTime!==null&&afterTime<beforeTime)throw Error('Screenshot before/after timestamps reversed; no upload');
    if(e.eventType==='mouse_down'){
      if(down||!has('screenshotBefore'))throw Error('Incomplete/overlapping mouse before/after pair; no upload');
      down=e;
    }
    if(e.eventType==='mouse_up'){
      if(!down||!has('screenshotBefore')||!has('screenshotAfter'))throw Error('Incomplete mouse before/after pair; no upload');
      const source=down.frames.find(f=>f.role==='screenshotBefore')?.label;
      if(source!==e.frames.find(f=>f.role==='screenshotBefore')?.label)throw Error('Mouse before/after source mismatch; no upload');
      down=null;
    }
    if(e.eventType==='mouse_wheel'&&!e.frames.length)throw Error('Mouse wheel missing screenshot evidence; no upload');
  }
  if(down)throw Error('Unfinished mouse transaction; no upload');
  return {manifest,events:relevant,images:uploads,allImages:[...images.values()],excluded,aliases,temporalWarnings,sourceDigest:digest(Buffer.concat([manifestBytes,eventBytes]))};
}
