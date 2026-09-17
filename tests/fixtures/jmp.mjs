// Synthetic API replies only. Production must never use this to fill model gaps.
export function syntheticJmpApiCall(o){
  let interfaceId,member,callType='message',receiverId=o.tableId,resultId='',args;
  switch(o.kind){
    case 'create_table':interfaceId='jmp.jsl.NewTable';member='New Table';callType='function';receiverId='';resultId=o.tableId;args={name:o.name};break;
    case 'add_rows':interfaceId='jmp.jsl.DataTable.AddRows';member='Add Rows';args={count:o.count};break;
    case 'create_column':interfaceId='jmp.jsl.DataTable.NewColumn';member='New Column';resultId=o.columnId;args={name:o.name,dataType:o.dataType,modelingType:o.modelingType};break;
    case 'rename_table':interfaceId='jmp.jsl.DataTable.SetName';member='Set Name';args={name:o.name};break;
    case 'rename_column':interfaceId='jmp.jsl.Column.SetName';member='Set Name';receiverId=o.columnId;args={name:o.name};break;
    case 'set_cells':interfaceId='jmp.jsl.Column.IndexAssignment';member='[] =';callType='indexed_assignment';receiverId=o.columnId;args={startRow:o.startRow,values:[...o.values]};break;
    case 'distribution':interfaceId='jmp.jsl.DataTable.Distribution';member='Distribution';resultId=o.reportId;args={Y:[...o.columnIds]};break;
    case 'bivariate':interfaceId='jmp.jsl.DataTable.Bivariate';member='Bivariate';resultId=o.reportId;args={X:o.xColumnId,Y:o.yColumnId,fitLine:o.fitLine};break;
    case 'fit_line':interfaceId='jmp.jsl.Bivariate.FitLine';member='Fit Line';receiverId=o.reportId;args={};break;
    default:throw Error('Unknown synthetic operation');
  }
  return {interfaceId,member,callType,receiverId,resultId,arguments:args};
}
export function jmpProgram({name='JmpSmoke',x=[1,2,3,4],y=[3,5,7,9],eventIds=['evt-001'],analysis=true}={}){
  const operations=[];
  const add=(kind,fields)=>{const o={id:'op-'+(operations.length+1),kind,...fields,sourceEventIds:[eventIds[0]],timestampMs:operations.length+1,stage:'committed',knowledgeIds:[]};o.apiCall=syntheticJmpApiCall(o);operations.push(o);};
  add('create_table',{tableId:'table-1',name});
  add('add_rows',{tableId:'table-1',count:x.length});
  for(const [id,label,values] of [['x','Dose',x],['y','Response',y]]){
    add('create_column',{tableId:'table-1',columnId:id,name:label,dataType:'numeric',modelingType:'continuous'});
    add('set_cells',{tableId:'table-1',columnId:id,startRow:1,values:values.map(v=>v===null?'':String(v)),precision:'exact'});
  }
  if(analysis){add('distribution',{tableId:'table-1',reportId:'distribution-1',columnIds:['y']});add('bivariate',{tableId:'table-1',reportId:'bivariate-1',xColumnId:'x',yColumnId:'y',fitLine:true});}
  return {version:'2.0',apiCatalogVersion:'jmp-jsl-19.1-v1',complete:true,summary:'Offline synthetic fixture, not a recording analysis.',initialScene:{kind:'blank',evidenceIds:[eventIds[0]]},finalScene:{kind:'observed',tableIds:['table-1'],reportIds:analysis?['distribution-1','bivariate-1']:[],evidenceIds:[eventIds.at(-1)]},operations,decisions:[{sourceEventIds:eventIds,disposition:'modeled',reason:'Synthetic fixture coverage'}],unresolved:[],commandState:{command:'',stage:'idle',pendingEventIds:[],selectionIds:[]}};
}
