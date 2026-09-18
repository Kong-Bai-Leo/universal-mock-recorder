// Stata 18: bounded, model-selected command plan. Documentation-only until native validation.
import {isDeepStrictEqual} from 'node:util';
export const STATA_CATALOG_VERSION = 'stata18-minimal-1';
export const STATA_API_CATALOG = Object.freeze({
  blank: {interfaceId:'stata18.precondition.blank',command:'local_blank_guard', receiver:'session', args:[]},
  variable: {interfaceId:'stata18.input.variable',command:'input', receiver:'dataset', args:['name','storageType']},
  cell: {interfaceId:'stata18.input.cell',command:'input', receiver:'variable', args:['row','value']},
  summary: {interfaceId:'stata18.summarize',command:'summarize', receiver:'dataset', args:['variableIds']},
  regression: {interfaceId:'stata18.regress',command:'regress', receiver:'dataset', args:['yVariableId','xVariableId']},
  save: {interfaceId:'stata18.save',command:'save', receiver:'dataset', args:['outputId']},
  reopen: {interfaceId:'stata18.use',command:'use', receiver:'savedDataset', args:['outputId']}
});
export const STATA_INSTRUCTIONS = `Analyze only the supplied Stata/MP 18.0 en-US same-session inputs and actual labeled images. Return structured JSON under the schema: operations AND an explicit model-selected apiCall for every operation. Do not emit executable Stata source, paths, expressions, macros, options, imports, statistical values guessed from a chart, or unknown cell contents. UI map entries are documented candidates, not observed controls or APIs.
Use knowledge.apiCatalog to select each interfaceId, command, receiver type, receiverId, resultId and concrete arguments. The local code checks your choice but will not fill it from the semantic kind. Fixed bindings: blank session -> dataset; variable/summary/regression/save dataset -> respectively a new variable ID, empty result, empty result, saved-dataset; reopen saved-dataset -> dataset-reopened. A cell targets its stable variable ID and has an empty result. Variable IDs are model-selected and must remain stable across chunks. A model-provided path or arbitrary command is forbidden. The renderer may compose many input operations into one input block to embed known data; it does not claim identical UI command history.
Establish blank initial data from evidence, not from an assumed empty-looking Results pane. Record only committed variable names, row values and analyses. Numeric values require exact readable text plus row/column identity; Ctrl+V alone does not reveal pasted values. Separate row count, cell value, summary statistic, X role and Y role. First release supports two to eight ASCII numeric variables whose final storage type is visibly confirmed as byte, int, long, float or double, 3–50 complete rows, default-option summarize of selected numeric variables, default-option one-X/one-Y regress with nonconstant X, then isolated save and reopen. Do not assume double: Data Editor may create byte and recast later. If a type conversion during entry cannot be established from evidence, record it unresolved; never silently assign a final type. Float storage rounds entered decimal values; do not claim the screenshot text is the exact stored binary value. Nondefault analysis options, including if/in, weights, vce and nocons, are unsupported: record them unresolved with event IDs rather than dropping them. No edits after analyses, missing/string data, external sources, formulas, graphs, multiple frames, replace or clear of user data. If any completed persistent change is unsupported or unreadable, record unresolved with event IDs and reason and set complete=false; no runnable output will be published.
Each supplied input event must be attributed to an operation, pending, unresolved or an explicit decision of modeled/navigation/no_effect/pending/unresolved with reason. Initial/final scene evidence alone cannot classify an input. A modeled decision must associate every listed event with a committed operation. A blank precondition may cite a navigation/no_effect event; the observed blank initialScene needs its own evidence, which need not be the same event. Mutating operations may not overlap navigation/no_effect decisions. Pending dialog input is not itself an omitted persistent change; carry every pending ID into the next chunk or explicitly resolve it there through a committed operation, an explained no_effect/navigation decision, or unresolved ledger. Consult previousContext.catalog and previousContext.pendingEventIds in continuation chunks; preserve prior variable bindings and explicitly carry or resolve pending IDs. Every chunk's complete refers to completed persistent operations in that chunk, not the end of the recording; false requires explicit unresolved entries, true conflicts with them. Later chunks may cite earlier pending evidence and must keep the same variable identities. Do not invent old IDs or silently repair missing operations. For nonfinal chunks set initialScene.kind=continuation after the first and finalScene.kind=unknown if the final inventory is not yet established. For the last chunk establish observed final variable IDs/row count from evidence. Delayed after frames may show later inputs; inspect timestamps and visible committed state before calling anything complete. Do not claim API execution, Stata native verification or independent source-recording equivalence.`;
const str={type:'string'},num={type:'number'},integer={type:'integer'},bool={type:'boolean'};
const arr=items=>({type:'array',items}),strs=arr(str);
const obj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const constant=value=>({type:typeof value,const:value});
const storageTypes=['byte','int','long','float','double'];
const opArguments={blank:obj({}),variable:obj({name:str,storageType:{type:'string',enum:storageTypes}}),cell:obj({row:integer,value:num}),summary:obj({variableIds:strs}),regression:obj({yVariableId:str,xVariableId:str}),save:obj({outputId:constant('isolated-dta')}),reopen:obj({outputId:constant('isolated-dta')})};
const operationSchema=kind=>{
  const spec=STATA_API_CATALOG[kind],argumentsSchema=opArguments[kind];
  const receiverId=kind==='blank'?constant('session'):kind==='cell'?str:kind==='reopen'?constant('saved-dataset'):constant('dataset');
  const resultId=kind==='blank'?constant('dataset'):kind==='variable'?str:kind==='save'?constant('saved-dataset'):kind==='reopen'?constant('dataset-reopened'):constant('');
  return obj({id:str,kind:constant(kind),sourceEventIds:strs,timestampMs:num,precision:constant('exact'),receiverId,resultId,
    arguments:argumentsSchema,apiCall:obj({catalogVersion:constant(STATA_CATALOG_VERSION),interfaceId:constant(spec.interfaceId),command:constant(spec.command),receiver:constant(spec.receiver),receiverId,resultId,arguments:argumentsSchema})});
};
export const STATA_SCHEMA=obj({
  version:constant('1.0'),apiCatalogVersion:constant(STATA_CATALOG_VERSION),
  initialScene:obj({kind:{type:'string',enum:['blank','continuation','unknown','contains_existing']},evidenceIds:strs}),
  complete:bool,operations:arr({anyOf:Object.keys(STATA_API_CATALOG).map(operationSchema)}),
  decisions:arr(obj({sourceEventIds:strs,disposition:{type:'string',enum:['modeled','navigation','no_effect','pending','unresolved']},reason:str})),
  unresolved:arr(obj({sourceEventIds:strs,reason:str})),pendingEventIds:strs,
  finalScene:obj({kind:{type:'string',enum:['observed','unknown']},variableIds:strs,rowCount:integer,evidenceIds:strs})
});
const fail = message => {throw Error('Stata: '+message);};
const guard = (ok,message) => {if(!ok) fail(message);};
const plain = value => value && typeof value==='object' && !Array.isArray(value);
const keys = (value,expected) => guard(plain(value)&&Object.keys(value).sort().join('|')===expected.slice().sort().join('|'),'unknown/missing fields: '+expected.join(','));
const id = value => typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const reservedNames=new Set(['if','in','using','end','byte','int','long','float','double','clear','save','use','input','regress','summarize']);
const variableName = value => typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value)&&!reservedNames.has(value.toLowerCase());
const finite = value => typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e12;
const timestamp = value => Number.isSafeInteger(value)&&value>=0;
const storageValue=(type,value)=>{
  if(!finite(value))return false;
  if(type==='byte')return Number.isInteger(value)&&value>=-127&&value<=100;
  if(type==='int')return Number.isInteger(value)&&value>=-32767&&value<=32740;
  if(type==='long')return Number.isInteger(value)&&value>=-2147483647&&value<=2147483620;
  if(type==='float')return Number.isFinite(Math.fround(value))&&(Math.fround(value)!==0||value===0);
  return type==='double';
};
const eq = (a,b) => isDeepStrictEqual(a,b);
const list = (value,allowed,nonempty=false) => Array.isArray(value)&&(!nonempty||value.length>0)&&value.every(x=>id(x)&&(!allowed||allowed.has(x)))&&new Set(value).size===value.length;

export function validateStataProgram(plan,{eventIds=[],final=true}={}) {
  keys(plan,['version','apiCatalogVersion','initialScene','complete','operations','decisions','unresolved','pendingEventIds','finalScene']);
  guard(plan.version==='1.0'&&plan.apiCatalogVersion===STATA_CATALOG_VERSION,'unsupported program/catalog version');
  const evidence = new Set(eventIds);
  keys(plan.initialScene,['kind','evidenceIds']);
  guard(plan.initialScene.kind==='blank'&&list(plan.initialScene.evidenceIds,evidence,true),'blank initial dataset needs observed evidence');
  guard(typeof plan.complete==='boolean'&&Array.isArray(plan.operations)&&Array.isArray(plan.decisions)&&Array.isArray(plan.unresolved)&&list(plan.pendingEventIds,evidence),'malformed coverage');
  for(const decision of plan.decisions){keys(decision,['sourceEventIds','disposition','reason']);guard(list(decision.sourceEventIds,evidence,true)&&['modeled','navigation','no_effect','pending','unresolved'].includes(decision.disposition)&&typeof decision.reason==='string'&&decision.reason.trim(),'invalid evidence decision');}
  for(const missing of plan.unresolved){keys(missing,['sourceEventIds','reason']);guard(list(missing.sourceEventIds,evidence,true)&&typeof missing.reason==='string'&&missing.reason.trim(),'unresolved item needs evidence and reason');}
  guard(plan.complete===!plan.unresolved.length,'coverage/unresolved conflict');
  const unresolvedEvents=new Set(plan.unresolved.flatMap(x=>x.sourceEventIds));
  for(const decision of plan.decisions)if(decision.disposition==='unresolved')guard(decision.sourceEventIds.every(x=>unresolvedEvents.has(x)),'unresolved decision missing from ledger');
  if(final) guard(plan.complete&&!plan.pendingEventIds.length,'pending or unresolved work; no runnable output');
  const ids=new Set(), variables=new Map(), cellRows=new Map(), analyses=[];
  let blank=false, saved=false, reopened=false, outputId=null, saveEventIds=null, lastTime=-1, analysisStarted=false;
  for(const o of plan.operations){
    keys(o,['id','kind','sourceEventIds','timestampMs','apiCall','arguments','receiverId','resultId','precision']);
    guard(id(o.id)&&!ids.has(o.id),'invalid/duplicate operation ID');ids.add(o.id);
    guard(list(o.sourceEventIds,evidence,true)&&timestamp(o.timestampMs)&&o.timestampMs>=lastTime,'invalid operation evidence/order');lastTime=o.timestampMs;
    const spec=STATA_API_CATALOG[o.kind];guard(spec,'unsupported operation');
    keys(o.apiCall,['catalogVersion','interfaceId','command','receiver','receiverId','resultId','arguments']);
    guard(o.apiCall.catalogVersion===STATA_CATALOG_VERSION&&o.apiCall.interfaceId===spec.interfaceId&&o.apiCall.command===spec.command&&o.apiCall.receiver===spec.receiver&&o.apiCall.receiverId===o.receiverId&&o.apiCall.resultId===o.resultId&&eq(o.apiCall.arguments,o.arguments),'model-selected command/arguments conflict');
    keys(o.arguments,spec.args);
    guard(o.precision==='exact','estimated/unknown value or selection cannot be replayed');
    if(o.kind==='blank'){
      guard(!blank&&plan.operations[0]===o&&o.receiverId==='session'&&o.resultId==='dataset','blank must create first dataset');
      blank=true;
    } else {
      guard(blank&&!reopened,'operation outside active dataset');
      if(o.kind==='variable'){
        guard(!saved&&!analysisStarted&&o.receiverId==='dataset'&&id(o.resultId)&&!variables.has(o.resultId),'invalid variable binding');
        guard(variableName(o.arguments.name)&&storageTypes.includes(o.arguments.storageType)&&variables.size<8,'unsupported numeric variable');
        guard(![...variables.values()].some(v=>v.name.toLowerCase()===o.arguments.name.toLowerCase()),'duplicate variable name');
        variables.set(o.resultId,{id:o.resultId,name:o.arguments.name,storageType:o.arguments.storageType});cellRows.set(o.resultId,new Map());
      } else if(o.kind==='cell'){
        guard(!saved&&!analysisStarted&&variables.has(o.receiverId)&&o.resultId===''&&o.arguments.row>=1&&Number.isInteger(o.arguments.row)&&o.arguments.row<=50&&storageValue(variables.get(o.receiverId).storageType,o.arguments.value),'bad cell target/row/value or storage range');
        guard(!cellRows.get(o.receiverId).has(o.arguments.row),'duplicate/ambiguous cell write');
        cellRows.get(o.receiverId).set(o.arguments.row,o.arguments.value);
      } else if(o.kind==='summary'){
        guard(!saved&&o.receiverId==='dataset'&&o.resultId===''&&list(o.arguments.variableIds,new Set(variables.keys()),true),'bad summarize roles');analysisStarted=true;analyses.push(o);
      } else if(o.kind==='regression'){
        const {xVariableId:x,yVariableId:y}=o.arguments;
        guard(!saved&&o.receiverId==='dataset'&&o.resultId===''&&variables.has(x)&&variables.has(y)&&x!==y,'bad regression X/Y roles');analysisStarted=true;analyses.push(o);
      } else if(o.kind==='save'){
        guard(!saved&&o.receiverId==='dataset'&&o.resultId==='saved-dataset'&&o.arguments.outputId==='isolated-dta','unsupported save target');saved=true;outputId=o.arguments.outputId;saveEventIds=o.sourceEventIds;
      } else {
        guard(saved&&!reopened&&o.receiverId==='saved-dataset'&&o.resultId==='dataset-reopened'&&o.arguments.outputId===outputId,'reopen must reference only own saved dataset');reopened=true;
      }
    }
  }
  if(final)guard(blank&&variables.size>=2&&saved&&reopened&&analyses.some(x=>x.kind==='summary')&&analyses.some(x=>x.kind==='regression'),'incomplete blank/variables/analyses/save/reopen lifecycle');
  const lengths=[...cellRows.values()].map(x=>x.size),rows=lengths[0];
  if(final||analysisStarted){guard(rows>=3&&lengths.every(n=>n===rows),'unequal/missing numeric rows');
    for(const values of cellRows.values())for(let row=1;row<=rows;row++)guard(values.has(row),'hole in observed row '+row);}
  for(const a of analyses)if(a.kind==='regression'){
    const variable=variables.get(a.arguments.xVariableId);
    const x=[...cellRows.get(variable.id).values()].map(value=>variable.storageType==='float'?Math.fround(value):value);
    guard(new Set(x).size>1,'regression requires nonconstant X');
  }
  keys(plan.finalScene,['kind','variableIds','rowCount','evidenceIds']);
  if(final)guard(plan.finalScene.kind==='observed'&&list(plan.finalScene.evidenceIds,evidence,true)&&eq(plan.finalScene.variableIds,[...variables.keys()])&&plan.finalScene.rowCount===rows,'unconfirmed final dataset inventory');
  else guard(['unknown','observed'].includes(plan.finalScene.kind)&&list(plan.finalScene.evidenceIds,evidence),'invalid interim scene');
  const attributed=new Set([...plan.pendingEventIds,
    ...plan.operations.flatMap(x=>x.sourceEventIds),...plan.decisions.flatMap(x=>x.sourceEventIds),...plan.unresolved.flatMap(x=>x.sourceEventIds)]);
  guard(eventIds.every(x=>attributed.has(x)),'unattributed input event; classify it before publication');
  const modeled=new Set(plan.operations.flatMap(x=>x.sourceEventIds));
  const explicitlyResolved=new Set([...plan.unresolved.flatMap(x=>x.sourceEventIds),
    ...plan.decisions.filter(x=>['navigation','no_effect'].includes(x.disposition)).flatMap(x=>x.sourceEventIds)]);
  for(const decision of plan.decisions){
    if(decision.disposition==='modeled')guard(decision.sourceEventIds.every(x=>modeled.has(x)),'modeled decision without committed operation');
    if(['navigation','no_effect'].includes(decision.disposition))guard(decision.sourceEventIds.every(x=>!modeled.has(x)||
      plan.operations.filter(o=>o.sourceEventIds.includes(x)).every(o=>o.kind==='blank')),
      'nonpersistent decision overlaps committed operation');
    if(decision.disposition==='pending')guard(decision.sourceEventIds.every(x=>plan.pendingEventIds.includes(x)||modeled.has(x)||explicitlyResolved.has(x)),'pending decision missing from pending state or later resolution');
  }
  // An unobserved cell is unknown, not zero. Keep continuation state JSON-stable:
  // JSON serialization turns undefined array slots into null.
  return {variables:[...variables.values()].map(v=>({...v,values:Array.from({length:rows??0},(_,i)=>cellRows.get(v.id).get(i+1)??null)})),rowCount:rows??0,analyses,outputId,
    ...(saved?{savedDataset:{id:'saved-dataset',outputId,saveComplete:true,sourceEventIds:saveEventIds,reopened}}:{})};
}

export function mergeStataChunks(chunks){
  guard(Array.isArray(chunks)&&chunks.length>0,'no chunks');
  chunks.forEach((c,i)=>{
    keys(c,['version','apiCatalogVersion','initialScene','complete','operations','decisions','unresolved','pendingEventIds','finalScene']);
    guard(c.version==='1.0'&&c.apiCatalogVersion===STATA_CATALOG_VERSION,'bad chunk version');
    guard(c.complete===!c.unresolved.length,'chunk '+(i+1)+' coverage conflict');
    guard(i===0?c.initialScene.kind==='blank':c.initialScene.kind==='continuation','bad chunk initial scene');
    if(i>0)for(const pendingId of chunks[i-1].pendingEventIds){
      const resolved=c.pendingEventIds.includes(pendingId)||c.operations.some(o=>o.sourceEventIds.includes(pendingId))||
        c.unresolved.some(u=>u.sourceEventIds.includes(pendingId))||
        c.decisions.some(d=>['navigation','no_effect'].includes(d.disposition)&&d.sourceEventIds.includes(pendingId));
      guard(resolved,'prior pending event dropped without explicit resolution: '+pendingId);
    }
  });
  return {...chunks.at(-1),initialScene:chunks[0].initialScene,complete:chunks.every(c=>c.complete),
    operations:chunks.flatMap((c,i)=>c.operations.map((o,j)=>({...o,id:`chunk-${i+1}-op-${j+1}`}))),
    decisions:chunks.flatMap(c=>c.decisions),unresolved:chunks.flatMap(c=>c.unresolved)};
}
export function stataChunkPosition(index,total){guard(Number.isInteger(index)&&Number.isInteger(total)&&index>=1&&index<=total,'bad chunk position');return {index,total,isLastChunk:index===total};}
export function stataPreviousContext(chunks,state){return chunks.length?{catalog:state, pendingEventIds:chunks.at(-1).pendingEventIds,
  coverage:{chunks:chunks.map((c,i)=>({index:i+1,complete:c.complete})),unresolved:chunks.flatMap(c=>c.unresolved)}}:null;}
