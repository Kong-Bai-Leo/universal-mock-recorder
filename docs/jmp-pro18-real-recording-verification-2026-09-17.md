# JMP Pro 18 real-recording verification — 2026-09-17

Scope: the user's old VM, JMP Pro 18.0.0 (746439), English UI, recording `20260917-151021-b446a0`. This is one small Distribution workflow, not a general accuracy claim or a certification of the modified installation.

| Gate | Result and evidence boundary |
| --- | --- |
| Real capture | A new table was created in the native UI, with one Numeric/Continuous column and four entered values, then Distribution was launched. The separate truth record was written before API submission and never used as recognition input. |
| Real model analysis | Five chunks returned structured results through the authorized API. Earlier chunk responses were reused as a verified prefix; no source `.jmp` or independent truth JSON was supplied to the VLM. |
| Local contract and compile | Model-selected interfaces, identities, coverage and values passed the bounded validator; one controlled `jmp-replay.jsl` was produced. This alone did not prove native behavior. |
| Native execution | The generated JSL was transferred unchanged and run in JMP Pro 18. It saved the reconstructed table, closed and reopened it, and invoked the stored Distribution script. The returned native files include `execution-status.txt`, `table-table-1-verified.txt`, `Untitled 2.jmp`, and the pre-save report XML. |
| Independent comparison | PASS for this sample: the primary agent's independent GUI review of the reopened table and report matched the pre-API source truth for name, Numeric/Continuous type, values and displayed Distribution statistics. This comparison is separate from the script's own assertions; it was not a user-performed review. |

Independent source and replay both showed `Measure` as Numeric/Continuous with values `[2, 6, 11, 15]`. Distribution showed N = 4, missing = 0, mean = 8.5, standard deviation = 5.6862407, standard error = 2.8431204, 95% mean interval `[-0.548078, 17.548078]`, minimum = 2, maximum = 15, median = 8.5, Q1 = 3 and Q3 = 14. The source truth tolerance was zero for cells and counts, `1e-10` for mean, and `1e-6` absolute for displayed statistics.

Local audit locations (not for upload or commit): `dist/jmp18-source-truth-20260917.json` and `dist/20260917-151021-b446a0/generated-jmp/14eef9acaa445a8948bcd801/`, with native return files in `8cec3327-afab-47e5-a43d-bae649cee6aa/`. The generated script's `execution-status.txt` correctly retains `sourceRecordingCompared=false`; its self-check never performs the independent GUI comparison. The final `status.json` also records generation-time `verification: not_run`, because the analyzer does not execute JMP. Neither status was rewritten to manufacture a pass.

Provider usage for the five accepted chunk responses, as reported in the local usage ledger: 196,999 input tokens, including 13,616 cached input tokens; 3,827 output tokens; 200,826 total tokens. An earlier returned response failed semantic validation and additionally used 43,320 input and 1,102 output tokens. Thus all six confirmed responses total 240,319 input (13,616 cached), 4,929 output and 245,248 total tokens; reused prefix responses are counted only once. A prior sandbox EACCES attempt has no confirmed response/usage and is **not** treated as zero cost; reconcile any charge with provider billing. No monetary cost is inferred here.

The returned pre-save report XML was independently inspected locally: its Summary Statistics and Quantiles entries match the source record as well. This corroborates the earlier report; the post-reopen report comparison remains the separate GUI observation, not a claim that this XML was captured after reopening. SHA-256 of the unchanged replay JSL: `C92C3D57A2A5EDD722CC19D6F8F165B9F24C400F0A183920AFCAC86CA641CB14`; pre-API source truth: `C18F5EA68D929D270B15BF62F6F16538C1909B01D47AFE292A1E4EB068972BC2`.

Not tested: Bivariate, Fit Line, Pro-only analyses, data changes after analysis, larger or different tables, other JMP builds, and general recognition accuracy. Raw events, screenshots, request/response bodies and the source `.jmp` remain local.
