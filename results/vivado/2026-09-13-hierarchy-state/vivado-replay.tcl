# Generated from validated model-selected interfaces. Never overwrite an existing project.
# Vivado 2024.2: Tools > Run Tcl Script, or source this file in the Tcl Console.
# Close the current project first. Output is a new subdirectory of the current working directory.
# No JSON, recorder, Node.js or API key is required. Captured HDL, if any, is embedded below.
if {[llength [get_projects -quiet]] != 0} { error "Close the current project before isolated replay" }
set replayRoot [file normalize [file join [pwd] "VivadoReplay-f9cbe32f-9e29-47f0-9666-5e0bf5afd7e9"]]
if {[file exists $replayRoot]} { error "Replay destination already exists" }
file mkdir $replayRoot
set audit [open [file join $replayRoot calls.log] {WRONLY CREAT EXCL}]
proc one {items} { if {[llength $items] != 1} {error "Expected exactly one native object"}; return [lindex $items 0] }
proc verify_replay_run {run expected audit waitFailed waitError} {
 set status [get_property STATUS $run]; set progress [get_property PROGRESS $run]; set stale [get_property NEEDS_REFRESH $run]
 set nativeLog [file join [get_property DIRECTORY $run] runme.log]
 set detail [list run $run status $status progress $progress needsRefresh $stale expected $expected nativeLog $nativeLog waitFailed $waitFailed waitError $waitError]
 puts $audit [linsert $detail 0 RUN_STATUS]; flush $audit
 if {$waitFailed || $progress ne "100%" || $status ne $expected || $stale} {error "Native run verification failed: $detail"}
}
array set obj {}
if {[catch {
set fp [open [file join $replayRoot "parity_leaf.v"] {WRONLY CREAT EXCL}]
fconfigure $fp -encoding utf-8 -translation lf
puts -nonewline $fp "module parity_leaf(input wire \[3:0\] a, output wire p);\n  assign p = ^a;\nendmodule\n"
close $fp
set fp [open [file join $replayRoot "parity_top.v"] {WRONLY CREAT EXCL}]
fconfigure $fp -encoding utf-8 -translation lf
puts -nonewline $fp "module parity_top(input wire \[3:0\] a, output wire y);\n  wire p;\n  parity_leaf u_leaf(.a(a), .p(p));\n  assign y = ~p;\nendmodule\n"
close $fp
puts $audit "chunk-4-op-1 create_project"
flush $audit
set obj(project-vivadohierarchy-20260912-c) [create_project "VivadoHierarchy_20260912_C" [file join $replayRoot project] -part "xc7a200tsbg484-1"]
puts $audit "chunk-4-op-2 set_property"
flush $audit
set_property "target_language" "Verilog" $obj(project-vivadohierarchy-20260912-c)
if {[get_property "target_language" $obj(project-vivadohierarchy-20260912-c)] ne "Verilog"} {error "Property mismatch"}
puts $audit "chunk-4-op-3 set_property"
flush $audit
set_property "simulator_language" "Mixed" $obj(project-vivadohierarchy-20260912-c)
if {[get_property "simulator_language" $obj(project-vivadohierarchy-20260912-c)] ne "Mixed"} {error "Property mismatch"}
puts $audit "chunk-7-op-1 add_files"
flush $audit
add_files -fileset "sources_1" -norecurse [list [file join $replayRoot "parity_leaf.v"]]
puts $audit "chunk-11-op-1 add_files"
flush $audit
add_files -fileset "sources_1" -norecurse [list [file join $replayRoot "parity_top.v"]]
puts $audit "chunk-12-op-1 get_filesets"
flush $audit
set obj(fileset-sources-1) [one [get_filesets "sources_1"]]
puts $audit "chunk-12-op-2 set_property"
flush $audit
set_property "top" "parity_leaf" $obj(fileset-sources-1)
if {[get_property "top" $obj(fileset-sources-1)] ne "parity_leaf"} {error "Property mismatch"}
puts $audit "chunk-13-op-1 get_filesets"
flush $audit
set obj(fileset-sources-1) [one [get_filesets "sources_1"]]
puts $audit "chunk-13-op-2 set_property"
flush $audit
set_property "top" "parity_top" $obj(fileset-sources-1)
if {[get_property "top" $obj(fileset-sources-1)] ne "parity_top"} {error "Property mismatch"}
puts $audit "chunk-13-op-3 get_runs"
flush $audit
set obj(run-synth-1) [one [get_runs "synth_1"]]
puts $audit "chunk-13-op-4 launch_runs"
flush $audit
launch_runs $obj(run-synth-1) -jobs 2
puts $audit "chunk-13-op-5 wait_on_runs"
flush $audit
set waitFailed [catch {wait_on_runs $obj(run-synth-1) -timeout 15} waitError]
verify_replay_run $obj(run-synth-1) "synth_design Complete!" $audit $waitFailed $waitError
puts $audit "chunk-14-op-1 get_runs"
flush $audit
set obj(run-impl-1) [one [get_runs "impl_1"]]
puts $audit "chunk-14-op-2 launch_runs"
flush $audit
set synthesisRun [one [get_runs synth_1]]
if {[get_property PROGRESS $synthesisRun] ne "100%" || [get_property STATUS $synthesisRun] ne "synth_design Complete!" || [get_property NEEDS_REFRESH $synthesisRun]} {error "Implementation requires current successful synthesis"}
launch_runs $obj(run-impl-1) -jobs 2
puts $audit "chunk-14-op-3 wait_on_runs"
flush $audit
set waitFailed [catch {wait_on_runs $obj(run-impl-1) -timeout 15} waitError]
verify_replay_run $obj(run-impl-1) "route_design Complete!" $audit $waitFailed $waitError
set savedProject [file join $replayRoot project "VivadoHierarchy_20260912_C.xpr"]
close_project
open_project $savedProject
if {[get_property PART [current_project]] ne "xc7a200tsbg484-1"} {error "Reopened part mismatch"}
if {[get_property "target_language" [current_project]] ne "Verilog"} {error "Reopened project property mismatch"}
if {[get_property "simulator_language" [current_project]] ne "Mixed"} {error "Reopened project property mismatch"}
if {[get_property "top" [one [get_filesets "sources_1"]]] ne "parity_top"} {error "Reopened fileset property mismatch"}
set verifiedRun [one [get_runs "synth_1"]]
if {[get_property PROGRESS $verifiedRun] ne "100%" || [get_property STATUS $verifiedRun] ne "synth_design Complete!" || [get_property NEEDS_REFRESH $verifiedRun]} {error "Reopened run is incomplete or obsolete"}
set verifiedRun [one [get_runs "impl_1"]]
if {[get_property PROGRESS $verifiedRun] ne "100%" || [get_property STATUS $verifiedRun] ne "route_design Complete!" || [get_property NEEDS_REFRESH $verifiedRun]} {error "Reopened run is incomplete or obsolete"}
set nativeFile [one [get_files -of_objects [get_filesets "sources_1"] [file join $replayRoot "parity_leaf.v"]]]
set fp [open $nativeFile r]
fconfigure $fp -encoding utf-8 -translation lf
set observedContent [read $fp]
close $fp
if {$observedContent ne "module parity_leaf(input wire \[3:0\] a, output wire p);\n  assign p = ^a;\nendmodule\n"} {error "Reopened HDL content mismatch"}
set nativeFile [one [get_files -of_objects [get_filesets "sources_1"] [file join $replayRoot "parity_top.v"]]]
set fp [open $nativeFile r]
fconfigure $fp -encoding utf-8 -translation lf
set observedContent [read $fp]
close $fp
if {$observedContent ne "module parity_top(input wire \[3:0\] a, output wire y);\n  wire p;\n  parity_leaf u_leaf(.a(a), .p(p));\n  assign y = ~p;\nendmodule\n"} {error "Reopened HDL content mismatch"}
set status [open [file join $replayRoot verification-status.txt] {WRONLY CREAT EXCL}]
puts $status "NATIVE_CALLS_AND_REOPEN_PASS\nSource-recording comparison still required"
close $status
puts "VIVADO_REPLAY_PASS $replayRoot"
} replayError]} { puts $audit "FAILED: $replayError"; close $audit; error $replayError }
close $audit
