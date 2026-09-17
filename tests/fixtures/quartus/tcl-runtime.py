"""Evaluate generated Tcl using real Tcl core and deliberately simulated Quartus APIs.

This tests Tcl syntax, literal escaping, control flow and readback guards only.
It does not emulate the FPGA compiler or prove Quartus API compatibility.
No Tcl_Init is needed; this also works with Python's Tcl DLL without init.tcl.
"""
import ctypes
import ctypes.util
import pathlib
import json
import sys

dll_path = pathlib.Path(sys.executable).parent / 'DLLs' / 'tcl86t.dll'
library = str(dll_path) if dll_path.is_file() else ctypes.util.find_library('tcl8.6')
if not library:
    print('Tcl core library unavailable', file=sys.stderr)
    sys.exit(77)
tcl = ctypes.CDLL(library)
tcl.Tcl_FindExecutable.argtypes = [ctypes.c_char_p]
tcl.Tcl_FindExecutable(sys.executable.encode())
tcl.Tcl_CreateInterp.restype = ctypes.c_void_p
tcl.Tcl_EvalEx.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
tcl.Tcl_GetStringResult.argtypes = [ctypes.c_void_p]
tcl.Tcl_GetStringResult.restype = ctypes.c_char_p
interp = tcl.Tcl_CreateInterp()
tcl.Tcl_Init.argtypes = [ctypes.c_void_p]
tcl.Tcl_Init(interp)  # Initializes encoding/filesystems even if init.tcl is absent.
stub = r'''
# The bundled Tcl DLL lacks its encoding/init library. Keep filesystem operations
# simulated; parser, list handling, substitutions and catch/error remain real Tcl.
rename file native_file
rename open native_open
rename close native_close
rename puts native_puts
rename cd native_cd
rename info native_info
rename read native_read
rename fconfigure native_fconfigure
array set disk {}
array set handles {}
set next_handle 0
proc file {sub args} {
  global disk
  set name [lindex $args 0]
  switch $sub {
    normalize {return $name}
    dirname {return "/test"}
    exists - isfile {return [info exists disk($name)]}
    mkdir {return}
    default {error "Unsupported simulated file operation $sub"}
  }
}
proc cd {args} {}
proc info {sub args} {if {$sub eq "script"} {return /test/build.tcl};return [uplevel 1 [list native_info $sub {*}$args]]}
proc open {name mode} {
  global disk handles next_handle
  if {[lsearch $mode EXCL]>=0 && [info exists disk($name)]} {error "File already exists"}
  if {$mode eq "r"} {
    if {![info exists disk($name)]} {error "Missing simulated source"}
  } else {set disk($name) ""}
  set handle "test_handle_[incr next_handle]"
  set handles($handle) $name
  return $handle
}
proc close {handle} {}
proc fconfigure {args} {}
proc read {handle} {global disk handles fault;if {$fault eq "content"} {return CORRUPTED};return $disk($handles($handle))}
proc puts {args} {
  global disk handles
  if {[llength $args]==2 && [info exists handles([lindex $args 0])]} {
    append disk($handles([lindex $args 0])) [lindex $args 1] "\n"
  } else {native_puts {*}$args}
}
package provide ::quartus::project 1.0
package provide ::quartus::flow 1.0
array set globals {}
array set locations {}
array set instances {}
set revision ""
proc value_after {args name} {return [lindex $args [expr {[lsearch -exact $args $name]+1}]]}
proc project_new {name args} {
  global revision
  set revision [value_after $args -revision]
  close [open "$name.qpf" w]
  close [open "$revision.qsf" w]
}
proc project_open {args} {}
proc is_project_open {} {global fault;return [expr {$fault eq "open-project"}]}
proc project_close {args} {}
proc export_assignments {} {}
proc set_global_assignment {args} {
  global globals
  set name [value_after $args -name]
  lappend globals($name) [lindex $args end]
}
proc get_global_assignment {args} {
  global globals fault
  set name [value_after $args -name]
  if {$fault eq "readback" && $name eq "DEVICE"} {return WRONG_DEVICE}
  return [lindex $globals($name) end]
}
proc get_all_global_assignments {args} {
  global globals fault
  set name [value_after $args -name]
  set rows {}
  foreach value $globals($name) {
    if {$fault ne "source"} {lappend rows [list "" $name $value ""]}
  }
  return $rows
}
proc foreach_in_collection {variable collection body} {
  upvar 1 $variable item
  foreach item $collection {uplevel 1 $body}
}
proc set_location_assignment {value args} {global locations;set locations([value_after $args -to]) $value}
proc get_location_assignment {args} {global locations;return $locations([value_after $args -to])}
proc set_instance_assignment {args} {global instances;set instances([value_after $args -name]:[value_after $args -to]) [lindex $args 2]}
proc get_instance_assignment {args} {global instances;return $instances([value_after $args -name]:[value_after $args -to])}
proc execute_flow {args} {
  global revision fault
  if {$fault eq "compile"} {error "Simulated compile failure"}
  if {$fault ne "missing-report"} {file mkdir output_files;close [open "output_files/$revision.flow.rpt" w]}
}
'''
def evaluate(script):
    code = tcl.Tcl_EvalEx(interp, script.encode('utf-8'), -1, 0)
    if code:
        print(tcl.Tcl_GetStringResult(interp).decode('utf-8', errors='replace'), file=sys.stderr)
        sys.exit(1)

evaluate(stub)
fault = sys.argv[2] if len(sys.argv) > 2 else ''
if fault not in ('', 'readback', 'source', 'content', 'compile', 'missing-report', 'open-project'):
    raise ValueError('invalid test fault')
evaluate('set fault {' + fault + '}')
script_path = pathlib.Path(sys.argv[1]).resolve().as_posix()
if not pathlib.Path(sys.argv[1]).is_file():
    raise FileNotFoundError(script_path)
for source_file in pathlib.Path(sys.argv[1]).parent.iterdir():
    if not all(c.isalnum() or c in '._-' for c in source_file.name):
        raise ValueError('unsupported synthetic filename')
    value = source_file.read_text(encoding='utf-8')
    value = value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('[', '\\[').replace(']', '\\]').replace('\n', '\\n').replace('\r', '\\r')
    evaluate('set disk(' + source_file.name + ') "' + value + '"')
evaluate(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
evaluate('native_puts "TEST_READBACK $disk(quartus-readback.json)"')
