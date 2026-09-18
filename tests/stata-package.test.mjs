import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {packageStataRecorder,STATA_PACKAGE_STATIC_FILES} from '../scripts/package-stata-recorder.mjs';

async function fixture(t,sections=['main/ui-map.json']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stata-package-source-'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'stata-package-output-'));
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true});await fs.rm(output,{recursive:true,force:true});});
  for(const relative of STATA_PACKAGE_STATIC_FILES){
    const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'PUBLIC '+relative);
  }
  const base=path.join(root,'ui-maps/stata/18/en-US');await fs.mkdir(base,{recursive:true});
  await fs.writeFile(path.join(base,'ui-index.json'),JSON.stringify({application:'Stata/MP',version:'18.0',language:'en-US',sections}));
  for(const section of sections)if(!section.includes('..')){const file=path.join(base,section);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'PUBLIC MAP');}
  await fs.writeFile(path.join(root,'config.example.json'),JSON.stringify({provider:{model:'offline-example',imageDetail:'high',apiKey:'SYNTHETIC_SECRET'}}));
  await fs.writeFile(path.join(root,'.env'),'OPENAI_API_KEY=SYNTHETIC_SECRET');
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify({provider:{model:'user-private',apiKey:'SYNTHETIC_SECRET'}}));
  await fs.mkdir(path.join(root,'recordings'));await fs.writeFile(path.join(root,'recordings/private.jpg'),'SYNTHETIC_SECRET');
  return {root,output};
}
async function filesBelow(root){
  const files=[];
  async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);if(item.isDirectory())await walk(file);else files.push(path.relative(root,file).replaceAll('\\','/'));
  }}await walk(root);return files.sort();
}
test('Stata package is an explicit analyzer closure and never reads/copies source secrets',async t=>{
  const f=await fixture(t);const envBefore=await fs.readFile(path.join(f.root,'.env'),'utf8');
  const userConfigBefore=await fs.readFile(path.join(f.root,'config.json'),'utf8');
  const result=await packageStataRecorder({sourceRoot:f.root,outputRoot:f.output});
  const actual=await filesBelow(result.directory);
  assert.deepEqual(actual,[...STATA_PACKAGE_STATIC_FILES,'ui-maps/stata/18/en-US/ui-index.json','ui-maps/stata/18/en-US/main/ui-map.json','config.json','PACKAGE-NOTE.txt'].sort());
  assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),envBefore);
  assert.equal(await fs.readFile(path.join(f.root,'config.json'),'utf8'),userConfigBefore);
  for(const relative of actual)assert.doesNotMatch(await fs.readFile(path.join(result.directory,relative),'utf8'),/SYNTHETIC_SECRET/);
  const provider=JSON.parse(await fs.readFile(path.join(result.directory,'config.json'),'utf8')).provider;
  assert.deepEqual(provider,{model:'offline-example',imageDetail:'high'});
});
test('Stata package rejects traversing and duplicate UI section references before creating a bundle',async t=>{
  const a=await fixture(t,['../private/ui-map.json']);
  await assert.rejects(packageStataRecorder({sourceRoot:a.root,outputRoot:a.output}),/Invalid Stata map section/);
  assert.deepEqual(await fs.readdir(a.output),[]);
  const b=await fixture(t,['main/ui-map.json','main/ui-map.json']);
  await assert.rejects(packageStataRecorder({sourceRoot:b.root,outputRoot:b.output}),/Duplicate\/oversized/);
  assert.deepEqual(await fs.readdir(b.output),[]);
});
