// Primary deliverable: one self-contained Tcl file compiled from validated calls.
import {validateVivadoProgram} from './vivado-program.mjs';
import {randomUUID} from 'node:crypto';
// Tcl double-quoted literal with every substitution escaped, including newlines.
export function tclLiteral(value){return '"'+String(value).replace(/\\/g,'\\\\').replace(/\$/g,'\\$').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';}
export function renderVivado(program,validation){
 const state=validateVivadoProgram(program,{...validation,final:true});
 const lines=[
  '# Generated from validated model-selected interfaces. Never overwrite an existing project.',
  '# Vivado 2024.2: Tools > Run Tcl Script, or source this file in the Tcl Console.',
  '# Close the current project first. Output is a new subdirectory of the current working directory.',
  '# No JSON, recorder, Node.js or API key is required. Captured HDL, if any, is embedded below.',
  'if {[llength [get_projects -quiet]] != 0} { error "Close the current project before isolated replay" }',
  `set replayRoot [file normalize [file join [pwd] ${tclLiteral('VivadoReplay-'+randomUUID())}]]`,
  'if {[file exists $replayRoot]} { error "Replay destination already exists" }',
  'file mkdir $replayRoot',
  'set audit [open [file join $replayRoot calls.log] {WRONLY CREAT EXCL}]',
  'proc one {items} { if {[llength $items] != 1} {error "Expected exactly one native object"}; return [lindex $items 0] }',
  'array set obj {}',
  'if {[catch {'
 ];
 for(const a of program.artifacts){lines.push(`set fp [open [file join $replayRoot ${tclLiteral(a.name)}] {WRONLY CREAT EXCL}]`,'fconfigure $fp -encoding utf-8 -translation lf',`puts -nonewline $fp ${tclLiteral(a.content)}`,'close $fp');}
 for(const o of program.operations){const c=o.apiCall,a=c.arguments,r=`$obj(${c.receiverId})`;lines.push(`puts $audit ${tclLiteral(o.id+' '+c.command)}`,'flush $audit');
  if(c.command==='create_project')lines.push(`set obj(${c.resultId}) [create_project ${tclLiteral(a.name)} [file join $replayRoot project] -part ${tclLiteral(a.part)}]`);
  else if(c.command==='set_property')lines.push(`set_property ${tclLiteral(a.name)} ${tclLiteral(a.value)} ${r}`,`if {[get_property ${tclLiteral(a.name)} ${r}] ne ${tclLiteral(a.value)}} {error "Property mismatch"}`);
  else if(c.command==='get_filesets'||c.command==='get_runs')lines.push(`set obj(${c.resultId}) [one [${c.command} ${tclLiteral(a.name)}]]`);
  else if(c.command==='add_files'){const files=a.artifactIds.map(id=>program.artifacts.find(x=>x.id===id));lines.push(`add_files -fileset ${tclLiteral(a.fileset)} -norecurse [list ${files.map(f=>`[file join $replayRoot ${tclLiteral(f.name)}]`).join(' ')}]`);}
  else if(c.command==='launch_runs')lines.push(`launch_runs ${r} -jobs ${a.jobs}`);
  else if(c.command==='wait_on_runs')lines.push(`wait_on_runs ${r} -timeout ${a.timeoutMinutes}`,`if {[get_property PROGRESS ${r}] ne "100%" || [get_property STATUS ${r}] ne ${tclLiteral(a.expectedStatus)}} {error "Run failed, timed out, or wrong terminal step"}`);
 }
 const p=state.objects.find(o=>o.type==='project');
 lines.push(`set savedProject [file join $replayRoot project ${tclLiteral(p.name+'.xpr')}]`,'close_project','open_project $savedProject',
  `if {[get_property PART [current_project]] ne ${tclLiteral(p.part)}} {error "Reopened part mismatch"}`);
 for(const [key,value] of Object.entries(p.properties))lines.push(`if {[get_property ${tclLiteral(key)} [current_project]] ne ${tclLiteral(value)}} {error "Reopened project property mismatch"}`);
 for(const s of state.objects.filter(o=>o.type==='fileset'))for(const [key,value] of Object.entries(s.properties))lines.push(`if {[get_property ${tclLiteral(key)} [one [get_filesets ${tclLiteral(s.name)}]]] ne ${tclLiteral(value)}} {error "Reopened fileset property mismatch"}`);
 for(const f of p.files){const a=program.artifacts.find(x=>x.id===f.artifactId);lines.push(`set nativeFile [one [get_files -of_objects [get_filesets ${tclLiteral(f.fileset)}] [file join $replayRoot ${tclLiteral(a.name)}]]]`,`set fp [open $nativeFile r]`,'fconfigure $fp -encoding utf-8 -translation lf','set observedContent [read $fp]','close $fp',`if {$observedContent ne ${tclLiteral(a.content)}} {error "Reopened HDL content mismatch"}`);}
 lines.push('set status [open [file join $replayRoot verification-status.txt] {WRONLY CREAT EXCL}]',`puts $status ${tclLiteral('NATIVE_CALLS_AND_REOPEN_PASS\nSource-recording comparison still required')}`,'close $status','puts "VIVADO_REPLAY_PASS $replayRoot"',
  '} replayError]} { puts $audit "FAILED: $replayError"; close $audit; error $replayError }','close $audit');
 return lines.join('\n')+'\n';
}
