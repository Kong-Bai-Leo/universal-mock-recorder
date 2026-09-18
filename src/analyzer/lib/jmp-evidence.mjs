import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const JMP_BUDGET = Object.freeze({ maxRequestsPerRound: 2, maxImages: 12, maxOutputTokens: 6000, maxInputEvents: 60, maxPayloadBytes: 100000, maxRequestBytes: 8*1024*1024 });
export const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const processAllowed = e => ["jmp"].includes(String(e.window?.processName ?? "").toLowerCase().replace(/\.exe$/,""));
const inputTypes = new Set(["mouse_down","mouse_up","mouse_move","mouse_wheel","key_down"]);
const screenshotKeys = ["screenshotBefore","screenshotSelection","screenshotAfter","screenshotSettledAfter","screenshot"];

export async function insideFile(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || /(^|[\\/])\.\.([\\/]|$)/.test(relative) || relative.includes(":")) throw new Error("Unsafe recording file path");
  const base = await fs.realpath(root), file = await fs.realpath(path.resolve(base,relative));
  const relation = path.relative(base,file);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("Recording file escapes its root");
  if (!(await fs.stat(file)).isFile()) throw new Error("Recording reference is not a file");
  return file;
}

// Mouse down / movement / up remain indivisible. Application-level commands may
// span these groups; the model must carry pending command state, never assume idle.
export function groupJmpEvents(events) {
  const groups=[]; let gesture=null;
  for (const e of events) {
    if (e.eventType === "mouse_down") {
      if (gesture) throw new Error("Overlapping/incomplete pointer gesture; do not split it silently");
      gesture=[e];
    } else if (gesture) {
      gesture.push(e);
      if (e.eventType === "mouse_up") { groups.push(gesture); gesture=null; }
    } else {
      if (e.eventType === "mouse_up") throw new Error("Pointer release without captured down");
      groups.push([e]);
    }
  }
  if (gesture) throw new Error("Recording ends inside a pointer gesture");
  return groups;
}

export async function prepareJmpEvidence(recording) {
  const manifestBytes=await fs.readFile(await insideFile(recording,"manifest.json"));
  const eventBytes=await fs.readFile(await insideFile(recording,"events.jsonl"));
  const manifest=JSON.parse(manifestBytes.toString("utf8").replace(/^\uFEFF/,""));
  if (manifest.applicationProfile !== "jmp" || manifest.captureDeployment !== "same-windows-session") throw new Error("需要在 JMP 所在 VM 内采集的 JMP 录制，不能分析外层远程桌面输入。");
  const raw=eventBytes.toString("utf8").replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));
  if(manifest.targetLost===true||raw.some(e=>e.eventType==="target_lost"))
    throw new Error("JMP target_lost: 录制期间目标进程退出或身份变化；会话已截断，禁止准备或上传分析。");
  if (raw.length>20000) throw new Error("超过首版 20000 事件本地准备上限");
  const events=[], excluded=[]; const ids=new Set(); let time=-1;
  for (const e of raw) {
    if (!e.id || ids.has(e.id) || !Number.isFinite(e.timestampMs) || e.timestampMs<time) throw new Error("Invalid/duplicate/out-of-order input event");
    ids.add(e.id); time=e.timestampMs;
    if (e.error || /error/.test(e.eventType)) throw new Error("Recording contains a capture error; evidence must be repaired before upload");
    if (e.eventType === "privacy_pause" || e.eventType === "privacy_resume") throw new Error("录制含暂停区间；首版不能证明暂停期间没有修改，已停止上传。");
    if (!processAllowed(e)) { excluded.push({id:e.id,reason:"outside_target_process"}); continue; }
    if (!inputTypes.has(e.eventType)) { excluded.push({id:e.id,reason:"unsupported_event_type"}); continue; }
    // Only allowlisted recording fields reach the VLM; never arbitrary files or paths.
    events.push(Object.fromEntries(["id","eventType","timestampMs","x","y","relativeX","relativeY","button","wheelDelta","key","text","modifiers","window","target","visualChange",...screenshotKeys,...screenshotKeys.map(k=>k+"TimestampMs")].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])));
  }
  if (!events.length) throw new Error("没有目标 JMP 进程输入；请检查录制器是否运行在 VM 内。");
  const images=new Map(), imageByDigest=new Map(), imageAliases=[], temporalWarnings=[], warningKeys=new Set();
  for (let i=0;i<events.length;i++) {
    const e=events[i]; e.frames=[];
    for (const key of screenshotKeys) {
      if (!e[key]) continue;
      const label=e[key].replaceAll("\\","/");
      if (!/\.(jpg|jpeg|png)$/i.test(label)) throw new Error("Unsupported screenshot format");
      if (!images.has(label)) {
        const file=await insideFile(recording,label), bytes=await fs.readFile(file);
        const jpeg=bytes[0]===255&&bytes[1]===216, png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        if (!jpeg&&!png) throw new Error("Screenshot is not JPEG/PNG");
        if (bytes.length>5*1024*1024) throw new Error("单张截图超过 5 MB；保留原图，需另行设计可审计压缩。");
        const hash=digest(bytes), representative=imageByDigest.get(hash);
        const image={label,path:file,bytes:bytes.length,digest:hash,uploadImageLabel:representative?.label??label};
        images.set(label,image);
        if (!representative) imageByDigest.set(hash,image);
        else imageAliases.push({file:label,uploadImageLabel:representative.label,sha256:hash,reason:"identical_file_sha256"});
      }
      const capturedAtMs=e[key+"TimestampMs"]??null;
      const laterInputOverlap=capturedAtMs!==null&&events[i+1]&&capturedAtMs>=events[i+1].timestampMs;
      // Reuse only identical image bytes. Keep each observation's source file,
      // time and role: identical pixels do not mean the same action or moment.
      const frame={label,uploadImageLabel:images.get(label).uploadImageLabel,role:key,capturedAtMs,attribution:capturedAtMs===null?"unknown_time":laterInputOverlap?"later_inputs_may_be_visible":"time_bounded_observation"};
      e.frames.push(frame);
      const warningKey=JSON.stringify([e.id,label]);
      if (laterInputOverlap&&!warningKeys.has(warningKey)) { warningKeys.add(warningKey); temporalWarnings.push({eventId:e.id,label,reason:"Capture occurred after the next input; not proof of this action's isolated result"}); }
      delete e[key]; delete e[key+"TimestampMs"];
    }
  }
  const chunks=[]; let pending=[];
  const describe = group => {
    const labels=[...new Set(group.flatMap(e=>e.frames.map(f=>f.uploadImageLabel)))];
    return {events:group,inputIds:group.map(e=>e.id),images:labels.map(l=>images.get(l))};
  };
  const fits = group => { const c=describe(group); return c.images.length<=JMP_BUDGET.maxImages && c.events.length<=JMP_BUDGET.maxInputEvents && Buffer.byteLength(JSON.stringify(c.events))<=JMP_BUDGET.maxPayloadBytes && c.images.reduce((n,x)=>n+Math.ceil(x.bytes/3)*4,0)<=JMP_BUDGET.maxRequestBytes-200000; };
  for (const group of groupJmpEvents(events)) {
    if (!fits(group)) throw new Error("单个鼠标事务超过证据预算；未删图或拆开前后图，需调整采集/预算后再准备。");
    if (pending.length&&!fits([...pending,...group])) { chunks.push(describe(pending)); pending=[]; }
    pending.push(...group);
  }
  if (pending.length) chunks.push(describe(pending));
  // Empty-image chunks are not sufficient for a screenshot-first reconstruction.
  if (chunks.some(c=>!c.images.length)) throw new Error("存在没有截图的分段，不能仅凭键鼠数据推测工程。");
  return {manifest,events,chunks,excluded,temporalWarnings,imageAliases,images:[...images.values()],sourceDigest:digest(Buffer.concat([manifestBytes,eventBytes]))};
}
