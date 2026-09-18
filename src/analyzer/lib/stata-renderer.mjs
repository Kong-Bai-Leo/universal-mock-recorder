import {randomUUID} from 'node:crypto';
import {validateStataProgram} from './stata-program.mjs';

export function newStataRuntimeDirectoryName(){return `stata-recorder-${randomUUID()}`;}
const runtimeDirectory = value => {
  if(typeof value!=='string'||!/^stata-recorder-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
    throw Error('Stata: invalid isolated runtime directory name');
  return value;
};
const number = value => {
  if(!Number.isFinite(value)||Math.abs(value)>=1e12)throw Error('Stata: unsafe number');
  return String(value);
};
// The native result is relative to Stata's working directory, not the analyzer
// host. mkdir must succeed on every execution; existing output is never reused.
export function renderStata(plan,{eventIds,runtimeDirectoryName}={}) {
  const state=validateStataProgram(plan,{eventIds,final:true});
  const directory=runtimeDirectory(runtimeDirectoryName);
  const dataPath=`${directory}/reconstructed.dta`;
  const name=new Map(state.variables.map(v=>[v.id,v.name]));
  const lines=[
    '* Stata 18 documented syntax; this file has not been natively executed by the recorder.',
    '* Single-file replay; data below are embedded, not read from a source dataset.',
    '* Results are created under the current Stata working directory, not the analyzer host.',
    'version 18.0',
    'if c(k) != 0 | c(N) != 0 {',
    '    display as error "Open a blank dataset before running this replay; no data were cleared."',
    '    exit 459',
    '}',
    `mkdir "${directory}"`,
    `confirm new file "${dataPath}"`,
    state.variables.every(v=>v.storageType===state.variables[0].storageType)
      ?`input ${state.variables[0].storageType} (${state.variables.map(v=>v.name).join(' ')})`
      :`input ${state.variables.map(v=>`${v.storageType} ${v.name}`).join(' ')}`
  ];
  for(let i=0;i<state.rowCount;i++)lines.push(state.variables.map(v=>number(v.values[i])).join(' '));
  lines.push('end');
  for(const op of state.analyses)lines.push(op.kind==='summary'
    ?`summarize ${op.arguments.variableIds.map(id=>name.get(id)).join(' ')}`
    :`regress ${name.get(op.arguments.yVariableId)} ${name.get(op.arguments.xVariableId)}`);
  lines.push(`save "${dataPath}"`, `use "${dataPath}"`,
    `assert _N == ${state.rowCount}`,`assert c(k) == ${state.variables.length}`);
  for(const v of state.variables)lines.push(
    `local __rec_type : type ${v.name}`,
    `if "\`__rec_type'" != "${v.storageType}" {`,
    `    display as error "Reopened storage type differs for ${v.name}."`,
    '    exit 459',
    '}'
  );
  for(const v of state.variables)for(let i=0;i<state.rowCount;i++){
    const value=number(v.values[i]);
    lines.push(v.storageType==='float'
      ?`assert ${v.name}[${i+1}] == float(${value})`
      :`assert ${v.name}[${i+1}] == (${value})`);
  }
  lines.push('display as text "Stata recorder replay: saved and reopened data verified; independent source/analysis comparison not performed."');
  return lines.join('\r\n')+'\r\n';
}
