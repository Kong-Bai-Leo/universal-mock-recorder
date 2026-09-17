# Generated from validated model-selected interfaces. Never overwrite an existing project.
if {[llength [get_projects -quiet]] != 0} { error "Close the current project before isolated replay" }
set replayRoot [file normalize [file join [pwd] "VivadoReplay-72e8b43a-7823-4362-bdd4-60a9326ed13c"]]
if {[file exists $replayRoot]} { error "Replay destination already exists" }
file mkdir $replayRoot
set audit [open [file join $replayRoot calls.log] {WRONLY CREAT EXCL}]
proc one {items} { if {[llength $items] != 1} {error "Expected exactly one native object"}; return [lindex $items 0] }
array set obj {}
if {[catch {
puts $audit "chunk-3-op-1 create_project"
flush $audit
set obj(project-vivadosmoke-20260912-a) [create_project "VivadoSmoke_20260912_A" [file join $replayRoot project] -part "xc7vx485tffg1157-1"]
puts $audit "chunk-3-op-2 set_property"
flush $audit
set_property "target_language" "VHDL" $obj(project-vivadosmoke-20260912-a)
if {[get_property "target_language" $obj(project-vivadosmoke-20260912-a)] ne "VHDL"} {error "Property mismatch"}
puts $audit "chunk-3-op-3 set_property"
flush $audit
set_property "simulator_language" "Mixed" $obj(project-vivadosmoke-20260912-a)
if {[get_property "simulator_language" $obj(project-vivadosmoke-20260912-a)] ne "Mixed"} {error "Property mismatch"}
set savedProject [file join $replayRoot project "VivadoSmoke_20260912_A.xpr"]
close_project
open_project $savedProject
if {[get_property PART [current_project]] ne "xc7vx485tffg1157-1"} {error "Reopened part mismatch"}
if {[get_property "target_language" [current_project]] ne "VHDL"} {error "Reopened project property mismatch"}
if {[get_property "simulator_language" [current_project]] ne "Mixed"} {error "Reopened project property mismatch"}
set status [open [file join $replayRoot verification-status.txt] {WRONLY CREAT EXCL}]
puts $status "NATIVE_CALLS_AND_REOPEN_PASS\nSource-recording comparison still required"
close $status
puts "VIVADO_REPLAY_PASS $replayRoot"
} replayError]} { puts $audit "FAILED: $replayError"; close $audit; error $replayError }
close $audit
