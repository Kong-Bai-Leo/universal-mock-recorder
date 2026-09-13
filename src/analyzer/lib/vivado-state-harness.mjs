// Visual claims are model observations, never native truth. The host validates
// their provenance, chronology and consistency; it cannot certify their pixels.
const str={type:'string'}, arr=items=>({type:'array',items});
const obj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const choice=(...values)=>({type:'string',enum:values});
const frame=obj({eventId:str,imageLabel:str});
const topState=obj({module:str,stability:choice('stable','updating','unknown'),indicator:choice('top_module_icon','project_summary','unknown'),frames:arr(frame)});
export const TOP_TRANSACTIONS_SCHEMA=arr(obj({id:str,sourceEventIds:arr(str),filesetId:str,requestedModule:str,
 status:choice('committed','pending','cancelled','no_effect','unresolved'),before:topState,after:topState,
 operationId:str,cancelEvidence:arr(frame),reason:str}));

export const VIVADO_STATE_RULES=Object.freeze({
 topIdentity:'Identify the TOP MODULE ICON next to the module, or the explicit Project Summary Top module name. Tree order, indentation, selection highlight and the first row are NOT top identity. A child may retain its tree position after Set as Top. Bold text is supporting evidence only; distinguish it from selection. Do not assume the uppermost row is top.',
 asynchronous:'Sources Updating means pending. Neither elapsed time nor screenshotSettledAfter proves stability. Seek the later stable observation, including the next input BEFORE frame. Attribute completion back to its triggering Set as Top, not that incidental input. The icon may change without tree reordering. If the latest available state is still updating/unknown, defer and retain pending state; never infer cancellation.',
 transactions:'Emit topTransactions for every attempted Set as Top/top-property change, including cancelled and pending attempts. before/after describe observed module identity with frame references (eventId and supplied original/upload imageLabel). Stable states require a top_module_icon or explicit project_summary indicator. Unknown module is empty. A committed transaction must reference its set_property top operationId, filesetId and exact requestedModule; add get_filesets to resolve the native binding if needed. Preserve intermediate committed changes even if later restored.',
 cancellation:'cancelled requires explicit visual cancellation evidence, not a disappeared menu or unchanged tree order. no_effect requires before and after stable same-module evidence after the attempt. If stable top changes, emit committed plus set_property, never cancelled/navigation. If evidence is contradictory or unavailable, unresolved/pending is correct. Empty topTransactions is only valid when no top change was attempted.',
 revisions:'Design-source additions, target_language and sources_1 top changes invalidate earlier synthesis/implementation. A completed run only applies to its input revision. Never mark old synthesis current after changing top back. This backend does not yet support reset/rebuild cycles: report such committed unsupported cycles as unresolved; never silently reuse an obsolete run.',
 boundary:'A screenshot observation belongs to its timestamp, not merely its event role. Cross-chunk completion may cite earlier trigger events. Preserve pending top transactions and the current top identity in context; later restoration does not erase a previous committed switch.'
});

export function pendingTopTransactions(transactions){
 return transactions.filter((t,i)=>t.status==='pending'&&!transactions.slice(i+1).some(n=>n.status!=='pending'&&n.sourceEventIds.some(id=>t.sourceEventIds.includes(id))));
}

export function validateTopTransactions(p,{eventIds=[],events=null}={}) {
 const assert=(v,m)=>{if(!v)throw Error('Vivado top state: '+m);};
 const allowed=new Set(eventIds), byEvent=events?new Map(events.map(e=>[e.id,e])):null;
 const evidence=ref=>{
  assert(allowed.has(ref.eventId)&&ref.imageLabel.trim(),'unknown/empty frame reference');
  if(!byEvent)return null;
  const f=byEvent.get(ref.eventId)?.frames?.find(f=>f.label===ref.imageLabel||f.uploadImageLabel===ref.imageLabel);
  assert(f,'frame was not in supplied event evidence');
  return f.capturedAtMs;
 };
 const state=s=>{
  const times=s.frames.map(evidence).filter(Number.isFinite);
  if(s.stability==='stable')assert(/^[A-Za-z][A-Za-z0-9_-]*$/.test(s.module)&&s.frames.length&&s.indicator!=='unknown','stable top needs visible module identity and indicator');
  return times.length?Math.max(...times):null;
 };
 const operations=new Map(p.operations.map(o=>[o.id,o])), covered=new Set(), ids=new Set();
 for(const t of p.topTransactions){
  assert(t.id.trim()&&!ids.has(t.id),'duplicate transaction');ids.add(t.id);
  assert(t.sourceEventIds.length&&t.sourceEventIds.every(id=>allowed.has(id))&&t.reason.trim(),'transaction evidence/reason required');
  const beforeTime=state(t.before),afterTime=state(t.after);t.cancelEvidence.forEach(evidence);
  const changed=t.before.stability==='stable'&&t.after.stability==='stable'&&t.before.module!==t.after.module;
  if(['committed','no_effect'].includes(t.status)){
   assert(t.after.stability==='stable','updating/unknown is not a completed top change');
   if(byEvent){
    const times=t.sourceEventIds.map(id=>byEvent.get(id)?.timestampMs);
    assert(times.every(Number.isFinite)&&Number.isFinite(afterTime)&&afterTime>=Math.max(...times),'result frame precedes trigger or lacks capture time');
    if(Number.isFinite(beforeTime))assert(afterTime>=beforeTime,'reversed top observations');
   }
  }
  if(t.status==='committed'){
   const o=operations.get(t.operationId),c=o?.apiCall;
   assert(c?.command==='set_property'&&c.arguments.name==='top'&&c.arguments.value===t.requestedModule&&c.receiverId===t.filesetId&&t.after.module===t.requestedModule,'committed top missing/mismatched native call');
   assert(o.sourceEventIds.some(id=>t.sourceEventIds.includes(id))&&!covered.has(o.id),'call and transaction evidence mismatch/duplicate');covered.add(o.id);
   // A later input can provide the confirming BEFORE frame while its own
   // action is navigation. This does not cancel the earlier triggering click.
   const observations=new Set(t.after.frames.map(f=>f.eventId));
   const modeled=new Set(p.decisions.filter(d=>d.disposition==='modeled').flatMap(d=>d.sourceEventIds));
   assert(!p.decisions.some(d=>{
    const shared=d.sourceEventIds.filter(id=>t.sourceEventIds.includes(id));
    if(!shared.length)return false;
    if(d.disposition==='cancelled')return true;
    if(d.disposition!=='navigation')return false;
    return !shared.every(id=>observations.has(id))||!t.sourceEventIds.some(id=>modeled.has(id)&&!observations.has(id));
   }),'committed top cannot also be cancelled/navigation');
  }else{
   assert(t.operationId==='','non-committed top cannot claim a call');
   if(t.status==='cancelled')assert(t.cancelEvidence.length&&!changed,'cancellation needs explicit evidence and no contradictory changed top');
   if(t.status==='no_effect')assert(t.before.stability==='stable'&&!changed&&t.before.module===t.after.module,'no-effect needs stable identical before/after top');
   if(t.status==='pending'&&pendingTopTransactions(p.topTransactions).includes(t))assert(p.commandState.pendingEventIds.some(id=>t.sourceEventIds.includes(id)),'pending top lost from command state');
   if(t.status==='unresolved')assert(!p.complete&&p.unresolved.some(u=>u.sourceEventIds.some(id=>t.sourceEventIds.includes(id))),'unresolved top missing from omissions');
  }
 }
 for(const o of p.operations)if(o.apiCall.command==='set_property'&&o.apiCall.arguments.name==='top')assert(covered.has(o.id),'set_property top needs a visual transaction');
 // Text can flag an admitted attempt but never invent one from a single key.
 // Menu preparation/hover can mention Set as Top without activating it.
 // This text guard detects non-navigation admissions, not pixel semantics;
 // independent visual review still checks for mislabelled navigation.
 for(const d of p.decisions)if(d.disposition!=='navigation'&&/set\s+as\s+top|top[- ]property|设为顶层|设置顶层/i.test(d.reason))assert(p.topTransactions.some(t=>t.sourceEventIds.some(id=>d.sourceEventIds.includes(id))),'admitted top attempt omitted from transactions');
}
