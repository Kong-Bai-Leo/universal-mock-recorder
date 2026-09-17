export function buildQuartusHarness(actions, previousState = null, evidence = {}) {
  return {
    format: 'QuartusAnalysisHarness', version: '1.0',
    previousState: previousState ?? {phase:'unknown',pendingInput:null},
    inputs: actions.map(a => ({eventIds:a.sourceEventIds,window:a.window,key:a.key ?? null,
      observedText:a.observedText ?? null,stage:'unknown',requiresVisualConfirmation:true})),
    evidenceHealth: {excluded:evidence.excluded ?? [],missing:evidence.missing ?? []},
    rules: [
      'Reconstruct command stage from current visual evidence. Do not interpret text until field role and project identity are known.',
      'Mouse coordinates are positions in the recorded window, never device pins, project paths or electrical values.',
      'Keep before, intermediate and after images paired. Observation timestamps may lag input events.',
      'Changed-window observations may show dialog transitions; they are not proof that pending edits were applied.',
      'Carry pending project wizard and settings fields across chunks, and resolve Finish/Cancel from persisted after-state.',
      'Imported source filenames do not authorize local filesystem reads and do not prove file contents.',
      'No fixed UI Map coordinates or historical field values are current evidence.',
      'Model outputs are data only. Unsupported operations and uncertainty block automatic project build.',
      'Compilation success and restored logical behavior are separate verification layers.'
    ]
  };
}
