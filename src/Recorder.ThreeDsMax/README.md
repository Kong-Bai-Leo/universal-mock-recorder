# 3ds Max Recorder

`ThreeDsMaxRecorder.exe` is a separate product build that reuses the stable Windows input-capture engine in `src/Recorder.Native/Recorder.cs` while compiling the `THREEDSMAX` application profile.

The profile:

- stores recordings under `bin/3dsmax-recorder/recordings`;
- records only interactions whose owning process is `3dsmax.exe`;
- writes `autodesk-3dsmax`, the 2027 English UI map root, and `maxscript` into the recording manifest;
- keeps UI Automation capture optional;
- disables AutoCAD Action Recorder and AutoCAD command heuristics;
- runs the dedicated 3ds Max analyzer after Stop when automatic generation is enabled;
- writes `semantic-trace.json`, `max-program.json`, and executable `3dsmax-replay.ms` under the recording's `generated` directory.

The analyzer uses the 3ds Max UI Map, input events, UI Automation evidence when enabled, and selected before/after screenshots. It emits a structured scene IR first and compiles that IR locally into MAXScript; the model is not allowed to return arbitrary script text. Exact scene dimensions and transforms are emitted only when typed or visibly labeled evidence exists.

For transform gestures, the recorder also saves high-quality before/after crops of the main transform toolbar, Scene Explorer, the selected-object panel, and the bottom-right Transform Type-In XYZ fields. The Type-In crop is calibrated to the lower status-bar band rather than the timeline or command panel. These crops remain available when UI Automation capture is disabled and let the analyzer pair the active Move/Rotate/Scale tool, target object, and labeled XYZ values.

Build with `scripts/build-3dsmax-recorder.ps1`. Analyze an existing recording with `scripts/analyze-3dsmax-recording.ps1`.
