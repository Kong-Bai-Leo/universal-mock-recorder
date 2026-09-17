import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCandidateActions } from './trace.mjs';
import { isQuartus } from './quartus-knowledge.mjs';
export const windowKey = w => JSON.stringify([w?.processId,w?.handle,w?.title,w?.x,w?.y,w?.width,w?.height]);

export function buildQuartusActions(events, {includePointerContext = true} = {}) {
  const inputTimes = events.filter(e => !['mouse_move','state_observation'].includes(e.eventType)).map(e => e.timestampMs).sort((a,b)=>a-b);
  const observationsByWindow = new Map();
  const observationsByProcess = new Map();
  for (const e of events.filter(e => e.eventType === 'state_observation' && isQuartus(e.window))) {
    const key = windowKey(e.window);
    if (!observationsByWindow.has(key)) observationsByWindow.set(key, []);
    observationsByWindow.get(key).push(e);
    if (e.window.processId != null) {
      if (!observationsByProcess.has(e.window.processId)) observationsByProcess.set(e.window.processId, []);
      observationsByProcess.get(e.window.processId).push(e);
    }
  }
  for (const values of [...observationsByWindow.values(), ...observationsByProcess.values()]) values.sort((a,b)=>observationTime(a)-observationTime(b));
  const groups = [];
  let group;
  for (const event of events) {
    if (!isQuartus(event.window) || event.eventType === 'capture_error') { group = null; continue; }
    if (event.eventType === 'state_observation') continue;
    const key = windowKey(event.window);
    if (!group || group.key !== key) { group = { key, events: [] }; groups.push(group); }
    group.events.push(event);
  }
  return groups.flatMap(group => {
    const byId = new Map(group.events.map(e => [e.id, e]));
    const moves = group.events.filter(e=>e.eventType==='mouse_move').sort((a,b)=>a.timestampMs-b.timestampMs);
    // Preserve keys individually: a character may activate a tool, edit a field or be ignored.
    return buildCandidateActions(group.events.map(e => ({ ...e, text: null })), { annotateCad: false }).map(action => {
      const raw = action.sourceEventIds.map(id => byId.get(id));
      const key = raw.find(e => e.eventType === 'key_down');
      const nextTime = inputTimes[upperBound(inputTimes,action.endMs,x=>x)] ?? Infinity;
      const movement = moves.slice(upperBound(moves,action.startMs-1,e=>e.timestampMs),upperBound(moves,nextTime-1,e=>e.timestampMs));
      const selectedMovement = movement.length<=32 ? movement : Array.from({length:32},(_,i)=>movement[Math.round(i*(movement.length-1)/31)]);
      const available = observationsByWindow.get(windowKey(action.window)) ?? [];
      const observations = inInterval(available, action.endMs, nextTime);
      // Keep a dialog opening/closing as separate temporal context, never relabel it
      // as a same-window after screenshot or assume that the edit was committed.
      const changedWindows = inInterval(observationsByProcess.get(action.window.processId) ?? [], action.endMs, nextTime)
        .filter(e => windowKey(e.window) !== windowKey(action.window));
      const transitionGroups = new Map();
      for (const e of changedWindows) {
        const frame = windowKey(e.window);
        if (!transitionGroups.has(frame)) transitionGroups.set(frame, []);
        transitionGroups.get(frame).push(e);
      }
      const selectedObservations = endpoints(observations);
      const selectedTransitions = [...transitionGroups.values()].flatMap(endpoints).sort((a,b)=>observationTime(a)-observationTime(b));
      const candidateObservations = [...observations,...changedWindows].sort((a,b)=>observationTime(a)-observationTime(b));
      const includedObservationIds = new Set([...selectedObservations,...selectedTransitions].map(e=>e.id));
      const literalText = key && !(key.modifiers ?? []).some(m => /^(CTRL|CONTROL|ALT|WIN|META)$/i.test(m))
        && typeof key.text === 'string' && !/[\u0000-\u001f\u007f]/.test(key.text) ? key.text : null;
      return { ...action,
        ...(includePointerContext ? {pointerTrace:selectedMovement.map(e=>({eventId:e.id,timestampMs:e.timestampMs,x:e.x,y:e.y,
          relativeX:e.relativeX ?? null,relativeY:e.relativeY ?? null})),
        pointerTraceBudget:{total:movement.length,included:selectedMovement.length,excluded:movement.length-selectedMovement.length,
          relation:'during_action_and_before_next_input_context'}} : {}),
        ...(key ? { observedText: literalText, rawKeyText: key.text ?? null,
          at: { x: key.x, y: key.y, relativeX: key.relativeX ?? 0, relativeY: key.relativeY ?? 0 },
          inputInterpretation: /edit|textbox|combobox/i.test(key.target?.role ?? '') ? 'field_candidate' : 'shortcut_or_text_unknown' } : {}),
        observationBudget: {policy:'first_and_last_per_window_between_inputs',total:candidateObservations.length,
          included:includedObservationIds.size,excluded:candidateObservations.length-includedObservationIds.size,
          includedEventIds:candidateObservations.filter(e=>includedObservationIds.has(e.id)).map(e=>e.id),
          excludedEventIds:candidateObservations.filter(e=>!includedObservationIds.has(e.id)).map(e=>e.id),
          limitation:'Unselected intermediate observations remain in events.jsonl; endpoints alone do not prove absence of intermediate changes.'},
        observations: selectedObservations.map(observationEvidence),
        transitionObservations: selectedTransitions
          .map(e => ({ ...observationEvidence(e), relation: 'same_process_changed_window_candidate', requiresVisualConfirmation: true })),
        coordinateFrame: 'recorded-window-relative; screenshots-use-manifest-scope',
        screenshotDesktopBounds: raw[0]?.screenshotDesktopBounds ?? null,
        captureTiming: { beforeMs: action.screenshotBeforeTimestampMs ?? null, afterMs: action.screenshotAfterTimestampMs ?? null,
          settled: false }
      };
    });
  });
}

const observationTime = e => e.screenshotTimestampMs ?? e.timestampMs;
function inInterval(values, start, end) {
  return values.slice(upperBound(values,start-1,observationTime),upperBound(values,end-1,observationTime));
}
function endpoints(values) {
  return [values[0], values.at(-1)].filter((e,i,a)=>e && a.findIndex(x=>x?.id===e.id)===i);
}
function observationEvidence(e) {
  return {eventId:e.id, timestampMs:observationTime(e), screenshot:e.screenshot,
    window:e.window, screenshotDesktopBounds:e.screenshotDesktopBounds ?? null};
}

function upperBound(values, time, getTime) {
  let lo=0, hi=values.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(getTime(values[mid])<=time) lo=mid+1; else hi=mid; }
  return lo;
}

export function chunkQuartusActions(actions, maximum = 60) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 300) throw new Error('Quartus 分段动作上限应为 1..300');
  const chunks = [];
  for (const action of actions) {
    const last = chunks.at(-1);
    if (!last || last.length >= maximum || windowKey(last.at(-1).window) !== windowKey(action.window)) chunks.push([action]);
    else last.push(action);
  }
  return chunks;
}

export function actionImages(action) {
  return [...new Set([action.screenshotBefore, action.screenshotSelection, action.screenshotAfter,
    ...(action.observations ?? []).map(e => e.screenshot),
    ...(action.transitionObservations ?? []).map(e => e.screenshot)].filter(Boolean))];
}

export async function selectQuartusEvidence(root, actions, maximum = 24) {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 100) throw new Error('Quartus 截图上限应为 0..100');
  const selected = new Set();
  const excluded = [];
  // Preserve each operation's whole evidence group; prioritize final state and explicit commits.
  const ordered = actions.map((a,i) => ({ a, i, score: i === actions.length - 1 ? 100 :
    /^(ENTER|TAB|ESCAPE)$/.test(a.key ?? '') || /^(OK|Apply|Finish|Start Compilation)$/i.test(a.target?.name ?? '') ? 80 : a.visualChange?.changed ? 60 : 0 }))
    .sort((a,b) => b.score - a.score || a.i - b.i);
  for (const { a } of ordered) {
    const files = actionImages(a);
    const newFiles = files.filter(f => !selected.has(f));
    if (newFiles.length + selected.size > maximum) excluded.push({ eventIds: a.sourceEventIds, files, reason: 'whole_group_exceeds_budget' });
    else files.forEach(f => selected.add(f));
  }
  const realRoot = await fs.realpath(root);
  const images = [];
  for (const file of selected) {
    const candidate = path.resolve(root, file);
    assertInside(path.resolve(root), candidate);
    const real = await fs.realpath(candidate);
    assertInside(realRoot, real);
    if (!/\.(png|jpe?g|webp)$/i.test(real)) throw new Error('不支持的截图类型');
    images.push({ path: real, label: file, detail: 'high' });
  }
  return { images, excluded, missing: actions.filter(a => !a.screenshotBefore || !a.screenshotAfter)
    .map(a => ({ eventIds: a.sourceEventIds, reason: 'missing_before_or_after' })) };
}

// A dialog close can have no same-window after frame. Keep that original gap,
// and separately audit a model-confirmed transition using only supplied evidence.
export function assessQuartusTransitionEvidence(actions, operations, evidence) {
  const supplied=new Set((evidence.images??[]).map(image=>image.label));
  const resolvedTransitionEvidence=[],unresolvedMissingEvidence=[];
  for(const gap of evidence.missing??[]) {
    const action=actions.find(a=>a.sourceEventIds.length===gap.eventIds.length&&a.sourceEventIds.every(id=>gap.eventIds.includes(id)));
    let confirmation;
    if(action?.screenshotBefore&&!action.screenshotAfter&&supplied.has(action.screenshotBefore)&&action.window?.processId!=null) {
      for(const observation of action.transitionObservations??[]) {
        if(observation.relation!=='same_process_changed_window_candidate'||observation.window?.processId!==action.window.processId||
          windowKey(observation.window)===windowKey(action.window)||!Number.isFinite(observation.timestampMs)||
          observation.timestampMs<Math.max(action.endMs,action.screenshotBeforeTimestampMs??action.endMs)||!supplied.has(observation.screenshot))continue;
        const op=operations.find(op=>['applied','cancelled'].includes(op.status)&&
          action.sourceEventIds.every(id=>op.sourceEventIds.includes(id))&&op.beforeScreenshot===action.screenshotBefore&&op.afterScreenshot===observation.screenshot);
        if(op) {
          confirmation={sourceEventIds:action.sourceEventIds,operationId:op.id,status:op.status,
            beforeScreenshot:action.screenshotBefore,confirmationScreenshot:observation.screenshot,
            observationEventId:observation.eventId,observationTimestampMs:observation.timestampMs,
            sourceWindow:action.window,observedWindow:observation.window,
            relation:observation.relation,originalGap:gap,verification:'model_confirmation_with_locally_validated_evidence_links'};
          break;
        }
      }
    }
    if(confirmation)resolvedTransitionEvidence.push(confirmation);else unresolvedMissingEvidence.push(gap);
  }
  return {resolvedTransitionEvidence,unresolvedMissingEvidence};
}

// Final audit can use later explicit confirmations without rewriting historical operations.
export function assessQuartusFinalTransitionEvidence(chunks, completed, evidence, workflow) {
  return {format:'quartus-transition-evidence/1',chunks:chunks.map((actions,i)=>{
    const deferredConfirmations=[];
    const operations=completed[i].plan.operations.map(op=>{
      if(!['pending','unknown'].includes(op.status))return op;
      const resolutions=(workflow.resolutions??[]).filter(r=>r.operationId===op.id);
      if(resolutions.length!==1)return op;
      const resolution=resolutions[0];
      if(!['applied','cancelled'].includes(resolution.status))return op;
      const confirming=completed.map((c,j)=>({c,j})).filter(({c,j})=>j>i&&
        c.plan.resolutions.some(r=>JSON.stringify(r)===JSON.stringify(resolution)));
      if(confirming.length!==1)return op;
      const j=confirming[0].j,events=new Map(),frames=new Map();
      const addFrame=(file,window,time)=>{if(file){if(!frames.has(file))frames.set(file,[]);frames.get(file).push({window,time});}};
      for(const a of chunks[j]) {
        for(const id of a.sourceEventIds)events.set(id,{window:a.window,time:a.endMs});
        addFrame(a.screenshotBefore,a.window,a.screenshotBeforeTimestampMs);
        addFrame(a.screenshotAfter,a.window,a.screenshotAfterTimestampMs);
        for(const o of [...(a.observations??[]),...(a.transitionObservations??[])]) {
          events.set(o.eventId,{window:o.window,time:o.timestampMs});addFrame(o.screenshot,o.window,o.timestampMs);
        }
      }
      const origin=actions.filter(a=>a.sourceEventIds.some(id=>op.sourceEventIds.includes(id)));
      const pid=origin[0]?.window?.processId;
      const lastInput=Math.max(...origin.map(a=>a.endMs));
      const supplied=new Set((evidence[j].images??[]).map(x=>x.label));
      if(pid==null||!origin.length||origin.some(a=>a.window?.processId!==pid)||
        !resolution.sourceEventIds.length||resolution.sourceEventIds.some(id=>!events.has(id)||events.get(id).window?.processId!==pid||
          !Number.isFinite(events.get(id).time)||events.get(id).time<=lastInput)||
        !resolution.screenshotFiles.length||resolution.screenshotFiles.some(f=>!supplied.has(f)||!frames.has(f)||
          frames.get(f).some(frame=>frame.window?.processId!==pid||!Number.isFinite(frame.time)||frame.time<=lastInput)))return op;
      deferredConfirmations.push({operationId:op.id,originalStatus:op.status,finalStatus:resolution.status,
        sourceChunk:i+1,confirmationChunk:j+1,resolution:structuredClone(resolution)});
      return {...op,status:resolution.status};
    });
    const audit=assessQuartusTransitionEvidence(actions,operations,evidence[i]);
    const confirmed=new Set(audit.resolvedTransitionEvidence.map(r=>r.operationId));
    return {index:i+1,...audit,deferredConfirmations:deferredConfirmations.filter(r=>confirmed.has(r.operationId))};
  })};
}

function assertInside(root, file) {
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('截图路径不能超出录制目录');
}
