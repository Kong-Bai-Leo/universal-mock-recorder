import test from 'node:test';
import assert from 'node:assert/strict';
import {jmpProgram} from './fixtures/jmp.mjs';
import {validateJmpProgram} from '../src/analyzer/lib/jmp-program.mjs';

test('validated operations cover their inputs without duplicate modeled decisions',()=>{
  const p=jmpProgram();p.decisions=[];
  assert.doesNotThrow(()=>validateJmpProgram(p,{eventIds:['evt-001'],currentInputIds:['evt-001'],final:true}));
  p.operations[0].apiCall.arguments.name='Different';
  assert.throws(()=>validateJmpProgram(p,{eventIds:['evt-001'],currentInputIds:['evt-001'],final:true}));
});

test('operation coverage never hides an unaccounted input or treats a scene reference as coverage',()=>{
  const p=jmpProgram();p.decisions=[];p.finalScene.evidenceIds.push('evt-002');
  const v={eventIds:['evt-001','evt-002'],currentInputIds:['evt-001','evt-002']};
  assert.throws(()=>validateJmpProgram(p,v),/input coverage gap: evt-002/);
  p.commandState.pendingEventIds=['evt-002'];
  assert.throws(()=>validateJmpProgram(p,v),/input coverage gap: evt-002/);
  p.decisions=[{sourceEventIds:['evt-002'],disposition:'deferred',reason:'Uncommitted dialog input'}];
  assert.doesNotThrow(()=>validateJmpProgram(p,v));
  assert.throws(()=>validateJmpProgram(p,{...v,final:true}),/unconfirmed pending interaction/);
});
