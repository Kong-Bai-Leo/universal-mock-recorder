// Synthetic, evidence-shaped Capture plan for offline contract tests.
// This fixture is not a recording or a successful native replay.
export const orcadEvidenceIds = Object.freeze(['page', 'calibration', 'wire', 'alias', 'final']);

export const createOrcadPageCoordinate = (value, event = 'wire') => ({
  value, unit: 'page_inch', coordinateSpace: 'capture_page', precision: 'exact',
  basis: 'native_page_coordinate', evidenceIds: [event]
});

export function createOrcadFixture() {
  const q = createOrcadPageCoordinate;
  return {
    version: '1.0', complete: true, summary: 'One wire and its net alias.',
    pageContext: { application: 'OrCAD X Capture', version: '24.1 P001', pageName: 'PAGE1', initialState: 'isolated_blank', evidenceIds: ['page'] },
    calibration: { coordinateSpace: 'capture_page', unit: 'page_inch', physicalGranularity: 100, docUnitsPerInch: 100, evidenceIds: ['calibration'] },
    operations: [
      { id: 'opWire', kind: 'place_wire', timestampMs: 100, stage: 'committed', sourceEventIds: ['wire'], wireId: 'wireOne',
        x1: q(1.7), y1: q(3), x2: q(3.7), y2: q(3),
        apiCall: { interfaceId: 'capture-tcl-place-wire', member: 'PlaceWire', arguments: { x1: 1.7, y1: 3, x2: 3.7, y2: 3 } } },
      { id: 'opAlias', kind: 'place_net_alias', timestampMs: 200, stage: 'committed', sourceEventIds: ['alias'], aliasId: 'aliasOne', targetWireId: 'wireOne',
        x: q(1.7, 'alias'), y: q(3, 'alias'), name: 'RECORDER_TEST',
        apiCall: { interfaceId: 'capture-tcl-place-net-alias', member: 'PlaceNetAlias', arguments: { x: 1.7, y: 3, name: 'RECORDER_TEST' } } }
    ],
    decisions: [
      { sourceEventIds: ['wire'], disposition: 'modeled', reason: 'Committed wire.' },
      { sourceEventIds: ['alias'], disposition: 'modeled', reason: 'Committed alias.' }
    ],
    unresolved: [],
    finalScene: { kind: 'observed', wireIds: ['wireOne'], aliasIds: ['aliasOne'], evidenceIds: ['final'] },
    commandState: { pendingEventIds: [], selectionIds: [] }
  };
}
