// A data-only final-state contract. Runtime commands never come from model output.
const str = { type: 'string' }, nullable = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const enumeration = values => ({ type: 'string', enum: values });
const evidence = object({ sourceEventIds: array(str), screenshotFiles: array(str), precision: enumeration(['exact','estimated','unknown']) });
export const QUARTUS_WORKFLOW_SCHEMA = object({
  schemaVersion: enumeration(['quartus-workflow/1']), summary: str, complete: { type: 'boolean' }, warnings: array(str),
  project: { anyOf: [object({ name:str, revision:str, family:str, device:str, top:str, evidence }), { type:'null' }] },
  files: array(object({ path:str, language:enumeration(['verilog','systemverilog','vhdl']), content:nullable, evidence })),
  assignments: array(object({ name:enumeration(['SEED','OPTIMIZATION_MODE','NUM_PARALLEL_PROCESSORS','LOCATION','IO_STANDARD']), value:str, target:nullable, evidence })),
  clocks: array(object({ name:str, port:str, periodNs:{type:'number'}, evidence })),
  operations: array(object({ id:str, kind:enumeration(['create_project','set_project','add_source','set_assignment','set_clock','compile','save','navigation','unknown']),
    summary:str, sourceEventIds:array(str), beforeScreenshot:nullable, afterScreenshot:nullable,
    status:enumeration(['applied','cancelled','pending','unknown']) })),
  resolutions: array(object({operationId:str,status:enumeration(['applied','cancelled']),sourceEventIds:array(str),screenshotFiles:array(str)})),
  unresolved: array(object({description:str,sourceEventIds:array(str)})),
  state: object({phase:enumeration(['unknown','project_setup','editing','building','idle']),pendingInput:nullable})
});
// Operation references are inputs; observations remain valid design/resolution evidence.
export function quartusResponseSchema(inputEventIds) {
  const schema=structuredClone(QUARTUS_WORKFLOW_SCHEMA);
  const refs=schema.properties.operations.items.properties.sourceEventIds;
  refs.description='Only current inputEventIds. Never observationEventIds or previous-chunk IDs; use beforeScreenshot/afterScreenshot for visual evidence.';
  refs.items={type:'string',enum:[...new Set(inputEventIds)]};
  return schema;
}
export function validateQuartusOperationInputs(operations,inputEventIds,evidenceEventIds) {
  const inputs=new Set(inputEventIds),evidence=new Set(evidenceEventIds);
  const invalidReferences=operations.flatMap(op=>op.sourceEventIds.filter(id=>!inputs.has(id)).map(eventId=>({
    operationId:op.id,eventId,reason:evidence.has(eventId)?'observation_not_input':'not_current_chunk_input'
  })));
  if(!invalidReferences.length)return;
  const error=new Error('Invalid operations.sourceEventIds: '+invalidReferences.map(r=>`${r.eventId} (${r.reason})`).join(', ')+
    '. Use only inputEventIds for operations; retain confirming images in beforeScreenshot/afterScreenshot. Do not invent or discard input actions.');
  error.validationDetails={code:'quartus_operation_input_reference',invalidReferences,allowedInputEventIds:[...inputs]};
  throw error;
}
export function emptyQuartusWorkflow() {
  return {schemaVersion:'quartus-workflow/1',summary:'No Quartus project evidence yet.',complete:false,warnings:[],project:null,files:[],assignments:[],clocks:[],operations:[],resolutions:[],unresolved:[],state:{phase:'unknown',pendingInput:null}};
}
export function effectiveQuartusOperationStatus(operation,workflow) {return workflow.resolutions.find(r=>r.operationId===operation.id)?.status??operation.status;}
function checkSchema(value,schema,where='$') {
  if(schema.anyOf) { if(!schema.anyOf.some(s=>{try {checkSchema(value,s,where);return true;}catch{return false;}})) throw new Error(`${where}: invalid nullable project`);return; }
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(!types.includes(actual) || actual==='number'&&!Number.isFinite(value)) throw new Error(`${where}: invalid type`);
  if(schema.enum&&!schema.enum.includes(value)) throw new Error(`${where}: unsupported enum`);
  if(actual==='string' && value.length>262144) throw new Error(`${where}: text budget exceeded`);
  if(actual==='array') { if(value.length>2048) throw new Error(`${where}: item budget exceeded`); value.forEach((v,i)=>checkSchema(v,schema.items,`${where}[${i}]`)); }
  if(actual==='object') {
    if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)) || schema.required.some(k=>!Object.hasOwn(value,k))) throw new Error(`${where}: unknown or missing field`);
    for(const [k,s] of Object.entries(schema.properties)) checkSchema(value[k],s,`${where}.${k}`);
  }
}
const fail = message => { throw new Error(message); };
const identifier = value => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value);
const port = value => /^[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]{1,5}\])?$/.test(value) && value.length<=100;
const safeFile = value => /^[A-Za-z][A-Za-z0-9_-]{0,79}\.(?:v|sv|vhd|vhdl)$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value);
export function validateQuartusWorkflow(value,context={}) {
  if(Buffer.byteLength(JSON.stringify(value)??'')>2097152) fail('Quartus workflow budget exceeded');
  checkSchema(value,QUARTUS_WORKFLOW_SCHEMA);
  if(context.currentInputEventIds) validateQuartusOperationInputs(value.operations,context.currentInputEventIds,context.currentEventIds??[]);
  const result=structuredClone(value), known=context.eventIds ? new Set(context.eventIds):null, images=context.screenshotFiles ? new Set(context.screenshotFiles):null;
  const ids = refs => { if(!refs.length||refs.some(x=>!x||x.length>256||known&&!known.has(x))||new Set(refs).size!==refs.length) fail('Missing, duplicate or unknown event evidence'); };
  const image = ref => { if(ref!==null&&(!ref||images&&!images.has(ref))) fail('Unknown screenshot evidence'); };
  let ready=true;
  const ev = e => { ids(e.sourceEventIds);e.screenshotFiles.forEach(image);if(!e.screenshotFiles.length||e.precision!=='exact')ready=false; };
  if(result.project) {
    const p=result.project;
    if(![p.name,p.revision,p.top].every(identifier)||!/^[A-Za-z][A-Za-z0-9 ()-]{0,79}$/.test(p.family)||!/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/.test(p.device)) fail('Invalid project identity, family or device');
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(p.name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(p.revision)) fail('Reserved Windows project name');
    ev(p.evidence);
  }else ready=false;
  if(result.files.length>128||result.assignments.length>512||result.clocks.length>32)fail('Project item budget exceeded');
  const paths=new Set();
  for(const f of result.files) {
    if(!safeFile(f.path)||paths.has(f.path.toLowerCase()))fail('Unsafe or duplicate source path');paths.add(f.path.toLowerCase());
    const suffix={verilog:/\.v$/,systemverilog:/\.sv$/,vhdl:/\.vhdl?$/}[f.language];if(!suffix.test(f.path))fail('Source extension and language mismatch');
    ev(f.evidence);if(f.content===null||!f.content.trim())ready=false;
    // External reads, embedded attributes and system tasks need an explicit dependency adapter.
    if(f.content!==null&&(/\x00/.test(f.content)||/`include\b|\$|\baltera_attribute\b|\bforeign\b|\bDPI(?:-C)?\b|\bfile\s+[A-Za-z_]|\breadmem[hb]\b|\bsynthesis\s+(?:read_comments_as_HDL|translate)/i.test(f.content)))fail('Unsupported HDL external dependency, attribute or system task');
  }
  if(!result.files.length)ready=false;
  const keys=new Set(), pins=new Set();
  for(const a of result.assignments) {
    const key=`${a.name}:${a.target??''}`;if(keys.has(key))fail('Duplicate assignment');keys.add(key);ev(a.evidence);
    if(['LOCATION','IO_STANDARD'].includes(a.name)) {
      if(!port(a.target??''))fail('Pin assignment needs one literal port');
      if(a.name==='LOCATION') {if(!/^PIN_[A-Z]{1,3}[0-9]{1,4}$/.test(a.value)||pins.has(a.value))fail('Invalid or duplicate physical pin');pins.add(a.value);}
      if(a.name==='IO_STANDARD'&&!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/.test(a.value))fail('Invalid IO standard');
    } else {
      if(a.target!==null)fail('Global assignment cannot have a target');
      if(a.name==='SEED'&&(!/^\d{1,3}$/.test(a.value)||+a.value<1||+a.value>100))fail('SEED must be 1..100');
      if(a.name==='NUM_PARALLEL_PROCESSORS'&&(!/^\d{1,2}$/.test(a.value)||+a.value<1||+a.value>64))fail('Parallel processors must be 1..64');
      if(a.name==='OPTIMIZATION_MODE'&&!['BALANCED','HIGH PERFORMANCE EFFORT','AGGRESSIVE PERFORMANCE','SUPERIOR PERFORMANCE','HIGH PLACEMENT ROUTABILITY EFFORT','HIGH PACKING ROUTABILITY EFFORT'].includes(a.value))fail('Unsupported optimization mode');
    }
  }
  const clockNames=new Set(),clockPorts=new Set();
  for(const c of result.clocks) { if(!identifier(c.name)||!port(c.port)||c.periodNs<0.001||c.periodNs>1e9||clockNames.has(c.name)||clockPorts.has(c.port))fail('Invalid or duplicate clock');clockNames.add(c.name);clockPorts.add(c.port);ev(c.evidence); }
  const operationIds=new Set(),resolved=new Set();
  for(const op of result.operations) {if(!op.id||op.id.length>256||operationIds.has(op.id))fail('Duplicate/invalid operation id');operationIds.add(op.id);ids(op.sourceEventIds);image(op.beforeScreenshot);image(op.afterScreenshot);}
  const previousIds=new Set(context.previousOperationIds??[]);
  const currentIds=context.currentEventIds?new Set(context.currentEventIds):null,currentImages=context.currentScreenshotFiles?new Set(context.currentScreenshotFiles):null;
  for(const r of result.resolutions) {
    if(resolved.has(r.operationId)||!operationIds.has(r.operationId)&&!previousIds.has(r.operationId))fail('Duplicate or unknown operation resolution');resolved.add(r.operationId);
    const original=result.operations.find(o=>o.id===r.operationId);
    if(original&&!['pending','unknown'].includes(original.status))fail('Only pending/unknown operations can be resolved');
    ids(r.sourceEventIds);r.screenshotFiles.forEach(image);
    if(!r.screenshotFiles.length||currentIds&&!r.sourceEventIds.some(id=>currentIds.has(id))||currentImages&&!r.screenshotFiles.some(f=>currentImages.has(f)))fail('Resolution requires current event and screenshot evidence');
    if(original&&r.sourceEventIds.every(id=>original.sourceEventIds.includes(id)))fail('Resolution requires new event evidence');
    if(original&&r.screenshotFiles.every(f=>[original.beforeScreenshot,original.afterScreenshot].includes(f)))fail('Resolution requires new screenshot evidence');
  }
  for(const op of result.operations) {const status=effectiveQuartusOperationStatus(op,result);if(status==='pending'||status==='unknown'||op.kind==='unknown'&&status!=='cancelled')ready=false;}
  for(const u of result.unresolved){if(!u.description.trim())fail('Unresolved item needs description');ids(u.sourceEventIds);}
  if(result.unresolved.length||result.state.pendingInput!==null)ready=false;
  // Coverage is a model claim; this gate can only downgrade it, never upgrade it.
  result.complete=result.complete&&ready;
  return result;
}
// Each plan returns a cumulative final-state snapshot; operations are current-chunk only.
// Changed/deleted state is accepted only with an applied edit operation in that chunk.
export function mergeQuartusWorkflows(plans,context={}) {
  if(!Array.isArray(plans)||!plans.length)return emptyQuartusWorkflow();
  let merged=null;
  for(const raw of plans) {
    const p=validateQuartusWorkflow(raw,{...context,previousOperationIds:merged?.operations.map(o=>o.id)??context.previousOperationIds});
    if(!merged){merged=p;continue;}
    const canonical=v=>v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).filter(k=>k!=='evidence').sort().map(k=>[k,canonical(v[k])]));
    const changed=['project','files','assignments','clocks'].filter(k=>JSON.stringify(canonical(merged[k]))!==JSON.stringify(canonical(p[k])));
    const edits=[...p.operations,...merged.operations.filter(o=>p.resolutions.some(r=>r.operationId===o.id&&r.status==='applied')).map(o=>({...o,status:'applied'}))];
    const expected={project:['create_project','set_project'],files:['create_project','add_source'],assignments:['create_project','set_assignment'],clocks:['create_project','set_clock']};
    const unexplained=changed.filter(field=>!edits.some(o=>o.status==='applied'&&expected[field].includes(o.kind)));
    const allIds=new Set(merged.operations.map(o=>o.id));
    if(p.operations.some(o=>allIds.has(o.id)))fail('Duplicate operation across Quartus chunks');
    const conflicts=unexplained.length?[{description:`Final-state snapshot changed without an applied matching edit operation: ${unexplained.join(', ')}.`,sourceEventIds:[...new Set([...p.operations.flatMap(o=>o.sourceEventIds),...p.resolutions.flatMap(r=>r.sourceEventIds)])].slice(0,32)}]:[];
    if(conflicts.length&&!conflicts[0].sourceEventIds.length)fail('Unaccounted snapshot change without events');
    const resolutions=[...merged.resolutions,...p.resolutions];
    if(new Set(resolutions.map(r=>r.operationId)).size!==resolutions.length)fail('Duplicate resolution across chunks');
    merged={...p,resolutions,operations:[...merged.operations,...p.operations],warnings:[...new Set([...merged.warnings,...p.warnings])],unresolved:[...p.unresolved,...conflicts],complete:p.complete&&!conflicts.length};
  }
  const {currentInputEventIds,currentEventIds,currentScreenshotFiles,...aggregateContext}=context;
  return validateQuartusWorkflow(merged,aggregateContext);
}
