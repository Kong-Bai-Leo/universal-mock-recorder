# OrCAD X Capture recorder — capture-only foundation

This separate Windows executable is intended for the **same Windows session** as OrCAD X Capture 24.1 P001. Its target process is `Capture` (case-insensitive). It reuses the shared recorder's process-filtered mouse/keyboard events, before/after and delayed full-desktop screenshots, optional UI Automation targets, and privacy pause. UI Automation starts **off** and can be enabled before recording. It does not read schematic/design objects through OrCAD internals, the clipboard, project files, or Tcl.

Controls: start, stop and save, pause/resume, and open the current recording directory. `Ctrl+Shift+F12` also pauses/resumes. Recordings are stored locally under `bin/orcad-recorder/recordings/<timestamp>-<id>/` as `manifest.json`, `events.jsonl`, and screenshots. Because screenshots cover the virtual desktop, close sensitive windows first. The target process filter does not crop screenshots to the Capture window.

Stop only saves the recording; the recorder UI has no automatic analyzer call. A **separate experimental CLI** uses the partial OrCAD UI map, structured model output, validation, and a fixed-interface Tcl compiler. One real single-wire recording with UI Automation off has passed API analysis, generated Tcl file execution, independent endpoint comparison, and same-process save/close/reopen on VM2. This does not validate complex circuits or all Capture features. The capture application version and process name are the current VM target, not evidence that all installations use the same executable name.

## Experimental analysis CLI

Run from the repository root with Node.js and the existing local `config.json` model configuration:

```powershell
node src/analyzer/orcad-cli.mjs --recording "<saved recording folder>" --prepare-only
```

This makes **no API call**. Inspect `generated-orcad/prepare-report.json`: it lists every referenced frame, the actual deduplicated upload list, event exclusions, timing warnings, and the input fingerprint. Screenshots remain full-desktop images; check for unrelated sensitive content before authorizing upload.

Only after upload authorization:

```powershell
node src/analyzer/orcad-cli.mjs --recording "<saved recording folder>" --analyze
```

The explicit analysis step uses the locally configured OpenAI key; never put a key in the command or recording. Initial limits are a complete small session of at most 60 relevant input events, 12 distinct screenshots, 6000 output tokens and two total attempts per recording. Automatic network retries are disabled. Missing pairs, privacy gaps, unsupported target events, or budget overflow stop before uploading; there is no silent partial-session sampling. Budget errors report actual image/event/payload/base64 counts against their limits. A failed/uncertain request requires an explicit `--retry-failed` and still consumes an attempt. Changing model or code does not reset that ledger. API failures may still incur usage.

For an explicitly authorized extra attempt, pass `--max-attempts 4` to **both** preparation and analysis (integers 2–6 are accepted). The session-wide ledger still counts all previous failed/uncertain attempts; changes to code, model or budget never reset it. Use `--retry-failed` for another request. This is an explicit spending limit, not automatic retry permission.

The OrCAD adapter keeps the configured model but requests at least `high` image detail (`original` stays `original`) because its full-desktop frames contain small status-bar coordinates. The prepare report records configured/effective detail. This can use more input tokens than `low`; all image and request budgets still apply. The prompt distinguishes page-cursor X/Y at accepted clicks from pixel coordinates, zoom, and unrelated hover values. It never inserts the verifier's object readback into model input.

Complete, validated output produces one `orcad-replay.tcl` inside the fingerprint-specific run directory. Audit JSON stays local. Unsupported or ambiguous edits remain unresolved and produce no runnable script. An incomplete plan with no operations may retain empty calibration evidence rather than inventing a reference; it cannot compile. Only nonintersecting axis-aligned wires and a unique endpoint net alias are currently supported; components, junctions, simulation, project creation and saving are not implemented in this backend.

The Tcl requires a fresh isolated blank page with the recorded page name and observed coordinate calibration. It checks object counts, wire identity/endpoints and alias owner/name/location. It does not save, overwrite, reset, or roll back the project. A runtime failure can leave partial unsaved edits. Do not run it on an existing user schematic. Native compiler verification and real model-recognition verification are separate; consult `docs/orcad-ansys-progress-2026-09-16.md` for the latest measured status.

On 2026-09-16 the complete compiler output for a **synthetic one-wire/one-alias fixture** ran successfully inside Capture 24.1 P001, with endpoint/owner/anchor readback and visible geometry. Repeating the script on that now-nonblank page was rejected before modification, with unchanged readback. This was not model output or a real recording comparison, and did not verify file loading or save/reopen.

## Recompile a saved response without another API request

After a validator/compiler fix, an original failed-validation response can be rechecked without uploading again:

```powershell
node src/analyzer/orcad-cli.mjs --recording "<saved recording folder>" --compile-existing "<original run directory>/003-parsed.json"
```

The command validates the saved request/response, recording and image hashes, run identity, ledger and failed status; it refuses edited, incomplete or mismatched artifacts. It does not load API credentials, reset the spending ledger or overwrite the original result. A new `verified-recompile/` directory holds the Tcl and a provenance report; successful compilation alone is not native replay verification. Local hashes are audit checks, not a signature against coordinated tampering.

The real sample initially failed because final passive selection was treated as an unfinished operation. Known, unique created-object selection is now allowed; unknown/duplicate IDs and pending commands still fail. The original model response was not edited. The generated file ran in a new blank project and matched the source wire `(2,3)→(4,3)` page inches; saved/reopened readback was unchanged, and rerunning refused the nonblank page. See `docs/orcad-verification-2026-09-17.md`.

Run the Tcl only after opening the intended isolated blank schematic page, clicking its canvas to activate it, and then focusing the Capture Command Window. Use `source {C:/path/to/orcad-replay.tcl}`. Focusing only the project manager can produce `Command Requires SchematicView`; activate the schematic instead. Saving is a separate GUI step.

Build locally with `scripts/build-orcad-recorder.ps1`. This creates `bin/orcad-recorder/OrcadRecorder.exe`; building does not start the application. Do not overwrite a running executable or kill an unrelated process if the output is locked. The capture UI and experimental CLI remain separate.
