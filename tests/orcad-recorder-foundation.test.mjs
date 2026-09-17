import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('OrCAD build is isolated and targets only the Capture profile', async () => {
  const build = await read('scripts/build-orcad-recorder.ps1');
  const native = await read('src/Recorder.Native/Recorder.cs');
  assert.match(build, /\/define:ORCAD/);
  assert.match(build, /bin\\orcad-recorder/);
  assert.match(build, /src\\Recorder\.Orcad\\OrcadRecorderForm\.cs/);
  const profile = native.match(/#if ORCAD([\s\S]*?)#(?:elif|else|endif)\b/)?.[1];
  assert.ok(profile);
  assert.match(profile, /ApplicationName = "OrCAD X Capture"/);
  assert.match(profile, /TargetProcess = "Capture"/);
  assert.match(profile, /SupportsAnalysis = false/);
  assert.match(profile, /RequiresReplayFile = false/);
  assert.match(profile, /FilterToTargetProcess = true/);
  assert.match(native, /#if ORCAD\s+Application\.Run\(new OrcadRecorderForm\(\)\)/);
});

test('OrCAD front end only records and opens its local directory', async () => {
  const form = await read('src/Recorder.Orcad/OrcadRecorderForm.cs');
  assert.match(form, /new RecorderEngine\(recording, uia\.Checked\)/);
  assert.match(form, /Checked = false/);
  assert.match(form, /engine\.Stop\(\)/);
  assert.match(form, /engine\.TogglePause\(\)/);
  assert.match(form, /Directory\.Exists\(recording\)/);
  assert.doesNotMatch(form, /Analyze\(|analyze-orcad|HttpClient|OpenAI|replayScript/);
});
