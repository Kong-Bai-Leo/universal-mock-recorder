import { validateOrcadProgram } from './orcad-program.mjs';

const internal = value => Math.round(value * 100);

// Fixed native members observed on Capture 24.1 P001. No model string is Tcl.
export function renderOrcadTcl(program, validation = {}, { mode = 'run' } = {}) {
  validateOrcadProgram(program, { ...validation, final: true });
  if (mode !== 'review' && mode !== 'run') throw new Error('OrCAD: unsupported render mode');
  if (mode === 'review') {
    const lines = [
      '# OrCAD X Capture 24.1 P001 — non-executable review plan.',
      `# Requires already open isolated blank ${program.pageContext.pageName}; does not create OPJ/DSN, save, or overwrite.`,
      '# Coordinates are Capture page inches; observed granularity and units-per-inch are 100.',
      'error {OrCAD recorder review only: no edits performed}'
    ];
    for (const op of program.operations) {
      const args = op.apiCall.arguments;
      if (op.kind === 'place_wire') lines.push(`# PlaceWire ${args.x1} ${args.y1} ${args.x2} ${args.y2}`);
      else lines.push(`# PlaceNetAlias ${args.x} ${args.y} ${args.name}`);
    }
    return lines.join('\r\n') + '\r\n';
  }

  const lines = [
    '# Generated fixed-interface OrCAD X Capture 24.1 P001 Tcl.',
    '# Source only in an isolated, already open blank schematic page.',
    '# No project creation, save, overwrite, rollback, or external file access.',
    '# On assertion failure, edits already performed may remain unsaved.',
    '# Coordinate conversion is limited to the observed 100 units/page-inch calibration.',
    'proc __orc_assertPage {expectedName} {',
    '  set page [GetActivePage]',
    '  if {$page eq {NULL} || $page eq {}} {error {No active Capture page}}',
    '  set name [DboTclHelper_sMakeCString]',
    '  $page GetName $name',
    '  if {[DboTclHelper_sGetConstCharPtr $name] ne $expectedName} {error {Active page name mismatch}}',
    '  return $page',
    '}',
    'proc __orc_assertCounts {page status expectedWires} {',
    '  foreach method {GetPartInstCount GetBusEntryCount GetPortCount GetGlobalCount GetOffPageConnectorCount GetCommentGraphicCount} {',
    '    if {[$page $method $status] != 0} {error "Page is not isolated/blank: $method"}',
    '  }',
    '  if {[$page GetWireCount $status] != $expectedWires} {error {Wire count mismatch}}',
    '}',
    'proc __orc_wireRows {page status} {',
    '  set iter [$page NewWiresIter $status]',
    '  if {$iter eq {NULL} || $iter eq {}} {return {}}',
    '  set rows {}',
    '  try {',
    '    for {set wire [$iter NextWire $status]} {$wire ne {NULL}} {set wire [$iter NextWire $status]} {',
    '      set start [$wire GetStartPoint $status]',
    '      set end [$wire GetEndPoint $status]',
    '      lappend rows [list [$wire GetId $status] [DboTclHelper_sGetCPointX $start] [DboTclHelper_sGetCPointY $start] [DboTclHelper_sGetCPointX $end] [DboTclHelper_sGetCPointY $end]]',
    '    }',
    '  } finally {delete_DboPageWiresIter $iter}',
    '  return $rows',
    '}',
    'proc __orc_aliasRows {page status targetId} {',
    '  set wireIter [$page NewWiresIter $status]',
    '  if {$wireIter eq {NULL} || $wireIter eq {}} {error {Target wire iterator missing}}',
    '  set found 0',
    '  set rows {}',
    '  try {',
    '    for {set wire [$wireIter NextWire $status]} {$wire ne {NULL}} {set wire [$wireIter NextWire $status]} {',
    '      if {[$wire GetId $status] ne $targetId} {continue}',
    '      set found 1',
    '      set aliasIter [$wire NewAliasesIter $status]',
    '      if {$aliasIter eq {NULL} || $aliasIter eq {}} {error {Alias iterator missing after placement}}',
    '      try {',
    '        for {set alias [$aliasIter NextAlias $status]} {$alias ne {NULL}} {set alias [$aliasIter NextAlias $status]} {',
    '          set name [DboTclHelper_sMakeCString]',
    '          $alias GetName $name',
    '          set location [$alias GetLocation $status]',
    '          lappend rows [list [DboTclHelper_sGetConstCharPtr $name] [[$alias GetOwner] GetId $status] [DboTclHelper_sGetCPointX $location] [DboTclHelper_sGetCPointY $location]]',
    '        }',
    '      } finally {delete_DboWireAliasesIter $aliasIter}',
    '    }',
    '  } finally {delete_DboPageWiresIter $wireIter}',
    '  if {!$found} {error {Target wire ID not found}}',
    '  return $rows',
    '}',
    'proc __orc_findRow {rows targetId} {',
    '  foreach row $rows {if {[lindex $row 0] eq $targetId} {return $row}}',
    '  error {Wire ID not found after placement}',
    '}',
    'proc __orc_assertGeometry {row x1 y1 x2 y2} {',
    '  lassign $row id ax ay bx by',
    '  if {!(($ax == $x1 && $ay == $y1 && $bx == $x2 && $by == $y2) || ($ax == $x2 && $ay == $y2 && $bx == $x1 && $by == $y1))} {',
    '    error {Wire endpoint readback mismatch}',
    '  }',
    '}',
    `set __orc_page [__orc_assertPage {${program.pageContext.pageName}}]`,
    'set __orc_status [DboState]',
    'if {[$__orc_page GetPhysicalGranularity] != 100 || [$__orc_page GetDocUnitsPerInch] != 100} {error {Unverified Capture page coordinate calibration}}',
    '__orc_assertCounts $__orc_page $__orc_status 0',
    'if {[llength [__orc_wireRows $__orc_page $__orc_status]] != 0} {error {Page wire enumeration is not empty}}'
  ];
  const wireVars = new Map(), wireGeometry = new Map(), aliasExpectations = [];
  let wireIndex = 0, aliasIndex = 0;
  for (const op of program.operations) {
    lines.push(`set __orc_page [__orc_assertPage {${program.pageContext.pageName}}]`);
    if (op.kind === 'place_wire') {
      const idx = wireIndex++;
      const idVar = `__orc_wire_id_${idx}`;
      const { x1, y1, x2, y2 } = op.apiCall.arguments;
      lines.push(
        'set __orc_before [__orc_wireRows $__orc_page $__orc_status]',
        'set __orc_beforeIds [lmap __orc_row $__orc_before {lindex $__orc_row 0}]',
        `if {[PlaceWire ${x1} ${y1} ${x2} ${y2}] != 0} {error {PlaceWire returned failure}}`,
        `__orc_assertCounts $__orc_page $__orc_status ${wireIndex}`,
        'set __orc_after [__orc_wireRows $__orc_page $__orc_status]',
        'set __orc_newIds {}',
        'foreach __orc_row $__orc_after {',
        '  set __orc_id [lindex $__orc_row 0]',
        '  if {[lsearch -exact $__orc_beforeIds $__orc_id] < 0} {lappend __orc_newIds $__orc_id}',
        '}',
        'if {[llength $__orc_after] != [expr {[llength $__orc_before] + 1}] || [llength $__orc_newIds] != 1} {error {New wire ID/count difference mismatch}}',
        `set ${idVar} [lindex $__orc_newIds 0]`,
        `__orc_assertGeometry [__orc_findRow $__orc_after $${idVar}] ${internal(x1)} ${internal(y1)} ${internal(x2)} ${internal(y2)}`
      );
      wireVars.set(op.wireId, idVar);
      wireGeometry.set(op.wireId, [internal(x1), internal(y1), internal(x2), internal(y2)]);
    } else {
      const idx = aliasIndex++;
      const wireVar = wireVars.get(op.targetWireId);
      const { x, y, name } = op.apiCall.arguments;
      lines.push(
        `if {[PlaceNetAlias ${x} ${y} {${name}}] != 0} {error {PlaceNetAlias returned failure}}`,
        `__orc_assertCounts $__orc_page $__orc_status ${wireIndex}`,
        `set __orc_alias_${idx} [__orc_aliasRows $__orc_page $__orc_status $${wireVar}]`,
        `if {[llength $__orc_alias_${idx}] != 1} {error {Net alias count mismatch}}`,
        `set __orc_aliasRow_${idx} [lindex $__orc_alias_${idx} 0]`,
        `if {[lindex $__orc_aliasRow_${idx} 0] ne {${name}} || [lindex $__orc_aliasRow_${idx} 1] ne $${wireVar} || [lindex $__orc_aliasRow_${idx} 2] != ${internal(x)} || [lindex $__orc_aliasRow_${idx} 3] != ${internal(y)}} {error {Net alias name/owner/anchor readback mismatch}}`
      );
      aliasExpectations.push({ wireVar, name, x: internal(x), y: internal(y), index: idx });
    }
  }
  lines.push(
    `set __orc_page [__orc_assertPage {${program.pageContext.pageName}}]`,
    `__orc_assertCounts $__orc_page $__orc_status ${wireIndex}`,
    'set __orc_finalRows [__orc_wireRows $__orc_page $__orc_status]',
    `if {[llength $__orc_finalRows] != ${wireIndex}} {error {Final wire enumeration mismatch}}`
  );
  for (const [id, geometry] of wireGeometry) lines.push(`__orc_assertGeometry [__orc_findRow $__orc_finalRows $${wireVars.get(id)}] ${geometry.join(' ')}`);
  for (const alias of aliasExpectations) lines.push(
    `set __orc_finalAlias_${alias.index} [__orc_aliasRows $__orc_page $__orc_status $${alias.wireVar}]`,
    `if {[llength $__orc_finalAlias_${alias.index}] != 1 || [lindex [lindex $__orc_finalAlias_${alias.index} 0] 0] ne {${alias.name}} || [lindex [lindex $__orc_finalAlias_${alias.index} 0] 1] ne $${alias.wireVar} || [lindex [lindex $__orc_finalAlias_${alias.index} 0] 2] != ${alias.x} || [lindex [lindex $__orc_finalAlias_${alias.index} 0] 3] != ${alias.y}} {error {Final net alias readback mismatch}}`
  );
  lines.push('puts {OrCAD recorder: verified unsaved wire/alias edits on isolated page; source recording not compared}');
  return lines.join('\r\n') + '\r\n';
}
