// A bounded official JSL interface vocabulary, not REST endpoints or UI Map IDs.
// The model must supply every call. These definitions validate, never fill gaps.
import {isDeepStrictEqual} from 'node:util';
const str={type:'string'}, num={type:'number'}, bool={type:'boolean'};
const obj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const arr=items=>({type:'array',items});
const constant=value=>({type:typeof value,const:value});
const choice=(...values)=>({type:'string',enum:values});
const syntax='https://www.jmp.com/content/dam/jmp/documents/en/support/jmp19/jsl-syntax-reference.pdf';
const guide='https://www.jmp.com/content/dam/jmp/documents/en/support/jmp19/scripting-guide.pdf';
export const JMP_API_CATALOG_VERSION='jmp-jsl-19.1-v1';
const definitions={
  create_table:{id:'jmp.jsl.NewTable',member:'New Table',callType:'function',receiverType:'none',resultType:'table',
    arguments:obj({name:str}),receiverField:null,resultField:'tableId',bindings:{name:'name'},
    syntax:'New Table(name, <New Column(...) initializers>)',source:syntax+'#page=304',
    note:'Construct with explicit recorded columns; do not blindly retain an implicit Column 1.'},
  add_rows:{id:'jmp.jsl.DataTable.AddRows',member:'Add Rows',callType:'message',receiverType:'table',resultType:'discard',
    arguments:obj({count:num}),receiverField:'tableId',resultField:null,bindings:{count:'count'},
    syntax:'table << Add Rows(count)',source:'https://www.jmp.com/support/help/en/19.0/jmp/add-rows.shtml'},
  create_column:{id:'jmp.jsl.DataTable.NewColumn',member:'New Column',callType:'message',receiverType:'table',resultType:'column',
    arguments:obj({name:str,dataType:choice('numeric','character'),modelingType:choice('continuous','nominal','ordinal')}),
    receiverField:'tableId',resultField:'columnId',bindings:{name:'name',dataType:'dataType',modelingType:'modelingType'},
    syntax:'table << New Column(name, dataType, modelingType)',source:'https://www.jmp.com/support/help/en/19.0/jmp/create-columns.shtml',
    note:'May be composed as an initializer of this plan\'s New Table to avoid an implicit default column. Retain the column result binding.'},
  rename_table:{id:'jmp.jsl.DataTable.SetName',member:'Set Name',callType:'message',receiverType:'table',resultType:'discard',
    arguments:obj({name:str}),receiverField:'tableId',resultField:null,bindings:{name:'name'},
    syntax:'table << Set Name(name)',source:syntax+'#page=405',note:'Discard the returned name string; retain the original table reference.'},
  rename_column:{id:'jmp.jsl.Column.SetName',member:'Set Name',callType:'message',receiverType:'column',resultType:'discard',
    arguments:obj({name:str}),receiverField:'columnId',resultField:null,bindings:{name:'name'},
    syntax:'column << Set Name(name)',source:syntax+'#page=416'},
  set_cells:{id:'jmp.jsl.Column.IndexAssignment',member:'[] =',callType:'indexed_assignment',receiverType:'column',resultType:'discard',
    arguments:obj({startRow:num,values:arr(str)}),receiverField:'columnId',resultField:null,bindings:{startRow:'startRow',values:'values'},
    syntax:'column[startRow + i] = typed(values[i]), i = 0..length-1',source:guide+'#page=400',
    note:'JSL indexing/assignment, NOT a fictitious SetCell method. Rows are 1-based. Convert explicit cell strings by the column data type; empty numeric text means missing (.), not zero. Never evaluate text as code.'},
  distribution:{id:'jmp.jsl.DataTable.Distribution',member:'Distribution',callType:'message',receiverType:'table',resultType:'report',
    arguments:obj({Y:arr(str)}),receiverField:'tableId',resultField:'reportId',bindings:{Y:'columnIds'},
    syntax:'table << Distribution(Y(columnRefs...))',source:guide+'#page=492',
    note:'Y contains stable column IDs, resolved to column references belonging to this table. Continuous numeric columns only in this release.'},
  bivariate:{id:'jmp.jsl.DataTable.Bivariate',member:'Bivariate',callType:'message',receiverType:'table',resultType:'report',
    arguments:obj({X:str,Y:str,fitLine:bool}),receiverField:'tableId',resultField:'reportId',bindings:{X:'xColumnId',Y:'yColumnId',fitLine:'fitLine'},
    syntax:'table << Bivariate(X(xColumnRef), Y(yColumnRef), <Fit Line>)',source:guide+'#page=492',
    note:'Include Fit Line only if fitLine=true. X and Y are column IDs, not names or values.'},
  fit_line:{id:'jmp.jsl.Bivariate.FitLine',member:'Fit Line',callType:'message',receiverType:'report',resultType:'discard',
    arguments:obj({}),receiverField:'reportId',resultField:null,bindings:{},
    syntax:'bivariateReport << Fit Line',source:guide+'#page=487'}
};
export function jmpApiCallSchema(kind){
  const d=definitions[kind];if(!d)throw Error('Unsupported JMP interface operation '+kind);
  return obj({interfaceId:constant(d.id),member:constant(d.member),callType:constant(d.callType),
    receiverId:str,resultId:str,arguments:d.arguments});
}
export function jmpApiCatalog(){
  return {version:JMP_API_CATALOG_VERSION,application:'JMP',applicationVersion:'19.1',transport:'native_jsl',
    scope:'Bounded table, cells, Distribution and Bivariate/Fit Line interfaces; not all JMP APIs. IDs are local catalog keys, member is the official JSL name/operator.',
    interfaces:Object.entries(definitions).map(([operationKind,d])=>({
      id:d.id,operationKind,member:d.member,callType:d.callType,receiverType:d.receiverType,resultType:d.resultType,
      argumentsSchema:d.arguments,syntax:d.syntax,source:d.source,note:d.note??'',
      status:'official_documentation_checked; explicit_model_call_contract_not_native_verified'
    }))};
}
export function validateJmpApiCalls(program){
  for(const o of program.operations){
    const d=definitions[o.kind],c=o.apiCall;
    if(!d||!c)throw Error('JMP: model must return an explicit apiCall for '+o.id);
    if(c.interfaceId!==d.id||c.member!==d.member||c.callType!==d.callType)
      throw Error('JMP: unsupported or mismatched interface for '+o.id);
    if(c.receiverId!==(d.receiverField?o[d.receiverField]:'')||c.resultId!==(d.resultField?o[d.resultField]:''))
      throw Error('JMP: interface receiver/result binding conflicts with operation '+o.id);
    const expected=Object.fromEntries(Object.entries(d.bindings).map(([argument,field])=>[argument,o[field]]));
    if(!isDeepStrictEqual(c.arguments,expected))throw Error('JMP: interface arguments conflict with recorded operation '+o.id);
  }
}
