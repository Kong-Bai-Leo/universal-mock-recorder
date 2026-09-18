import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const native = await fs.readFile(new URL('../src/Recorder.Native/Recorder.cs', import.meta.url), 'utf8');
const jmpForm = await fs.readFile(new URL('../src/Recorder.Jmp/JmpRecorderForm.cs', import.meta.url), 'utf8');
const stataForm = await fs.readFile(new URL('../src/Recorder.Stata/StataRecorderForm.cs', import.meta.url), 'utf8');
const stataBuild = await fs.readFile(new URL('../scripts/build-stata-recorder.ps1', import.meta.url), 'utf8');
const stataAnalyze = await fs.readFile(new URL('../scripts/analyze-stata-recording.ps1', import.meta.url), 'utf8');

test('JMP version and edition are read from a unique same-session executable, never a baked trial version', () => {
  assert.doesNotMatch(native, /ApplicationVersion = "19\.1\.5"/);
  assert.match(native, /process\.SessionId == currentSession/);
  assert.match(native, /candidates\.Count != 1/);
  assert.match(native, /FileVersionInfo\.GetVersionInfo\(target\.MainModule\.FileName\)/);
  assert.match(native, /NumericVersion\(capture\.ProductVersion\)/);
  assert.match(native, /NumericVersion\(capture\.FileVersion\)/);
  assert.match(native, /ApplicationEdition = "unknown"/);
  assert.ok(native.includes('@"\\bPro\\b"'));
  assert.ok(native.includes('@"\\bTrial\\b"'));
  assert.match(native, /ui-maps\/jmp\/18\/en-US/);
  assert.match(native, /ui-maps\/jmp\/19\.1\/en-US/);
  assert.match(native, /window\.ProcessId == _targetCapture\.ProcessId/);
});

test('language requires explicit GUI confirmation and manifest states its provenance', () => {
  for (const form of [jmpForm, stataForm]) {
    assert.match(form, /english\.Checked/);
    assert.match(form, /new RecorderEngine\(recording, uia\.Checked, "en-US"\)/);
  }
  assert.match(native, /languageSource\\": \\"configured/);
  assert.match(native, /targetProcessId/);
  assert.match(native, /targetSessionId/);
});

test('file metadata is JSON-escaped and frozen target loss is recorded before analysis', () => {
  assert.match(native, /else if \(ch < 0x20\) escaped\.Append\("\\\\u"\)/);
  assert.match(native, /target\.StartTime\.ToUniversalTime\(\)\.Ticks == _targetCapture\.StartedAtUtcTicks/);
  assert.match(native, /new System\.Threading\.Timer\(delegate \{ CheckTargetAlive\(\); \}/);
  assert.match(native, /EventType = "target_lost"/);
  assert.match(native, /"  \\\"targetLost\\\": "/);
  assert.match(native, /"  \\\"targetLostAtUtc\\\": "/);
  assert.match(native, /_privacyPaused = true;/);
});

test('Stata accepts only official MP, SE and BE executable names', () => {
  const stataBranch = native.split(/#(?:if|elif) STATA\r?\n            return/)[1]?.split('#else')[0];
  assert.ok(stataBranch);
  for (const name of ['StataMP-64', 'StataSE-64', 'StataBE-64']) assert.ok(stataBranch.includes(name));
  assert.doesNotMatch(stataBranch, /"Stata-64"/);
});

test('Stata shares input transitions, settled observation, UIA toggle and privacy pause', () => {
  assert.match(native, /#if (?:KICAD \|\| )?(?:TWINBUILDER \|\| )?JMP \|\| STATA \|\| (?:VIVADO \|\| )?ORCAD/);
  assert.match(native, /#if JMP \|\| STATA \|\| (?:VIVADO \|\| )?ORCAD[\s\S]*?ScreenshotSettledAfter/);
  assert.match(native, /#if (?:TWINBUILDER \|\| )?JMP \|\| STATA \|\| (?:VIVADO \|\| )?ORCAD[\s\S]*?TogglePause/);
  assert.match(stataForm, /UI Automation（可关闭）/);
  assert.match(stataForm, /最多 2 次请求、每次最多 12 张图、输出最多 6000 tokens/);
  assert.match(stataBuild, /\/define:STATA/);
  assert.match(stataAnalyze, /stata-cli\.mjs/);
  for (const option of ['--recording', '--config', '--prepare-only', '--analyze', '--retry-failed', '--compile-saved-run']) assert.ok(stataAnalyze.includes(option));
});
