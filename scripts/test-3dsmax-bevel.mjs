// Opt-in, isolated headless 3ds Max integration test. No scene file is loaded,
// no desktop instance is controlled, and no API request is made.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderMaxScript } from "../src/analyzer/lib/maxscript-renderer.mjs";
import { bevelOperation, bevelAnalysis } from "../tests/fixtures/threedsmax-bevel.mjs";
import { estimatedBevelFixture } from "../tests/fixtures/threedsmax-estimated-bevel.mjs";
const executable = process.env.THREEDSMAX_BATCH_EXE ?? "C:/Program Files/Autodesk/3ds Max 2027/3dsmaxbatch.exe";
await fs.access(executable);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "umr-bevel-test-"));
const scriptPath = path.join(directory, "bevel-test.ms");
const listener = path.join(directory, "listener.log");
const systemLog = path.join(directory, "max.log");
const compile = (op, name) => renderMaxScript(bevelAnalysis(op, name)).script;
const normal = bevelOperation();
const wrongCount = bevelOperation(); wrongCount.polyEdit.selection.expectedCount = 99;
const numeric = bevelOperation();
numeric.polyEdit.selection = { method: "face_indices", indices: [2], axis: null, side: null,
  faceIds: ["obj:t0:f2"], topologyRevision: 0,
  expectedCount: 1, expectedFaceCount: 6, expectedVertexCount: 8,
  faceChecks: [{ index: 2, center: [0, 0, 10], normal: [0, 0, 1] }] };
const catalogAnalysis = bevelAnalysis(normal, "UMRCatalogBox");
catalogAnalysis.maxProgram.initialObjects[0].className = "Box";
const catalogBevel = bevelOperation(); catalogBevel.polyEdit.selection.topologyRevision = 1;
const instanceBevel = bevelOperation({ id: "instance-bevel", targetObjectIds: ["instance"] });
instanceBevel.polyEdit.selection.topologyRevision = 1;
catalogAnalysis.maxProgram.operations = [
  bevelOperation({ id: "convert", kind: "convert_to_poly", polyEdit: null }),
  bevelOperation({ id: "instance", kind: "clone_objects", polyEdit: null, resultObjectIds: ["instance"], objectName: "UMRCatalogInstance",
    parameters: [{ name: "cloneType", value: "Instance", unit: null, confidence: 1 }] }),
  bevelOperation({ id: "copy", kind: "clone_objects", polyEdit: null, resultObjectIds: ["copy"], objectName: "UMRCatalogCopy",
    parameters: [{ name: "cloneType", value: "Copy", unit: null, confidence: 1 }] }),
  catalogBevel, instanceBevel
];
const main = `
(
fn umrAssert value message = (if not value do throw message)
fn umrMaxZ obj = (local zs = for i = 1 to (polyop.getNumVerts obj.baseObject) collect (polyop.getVert obj.baseObject i).z; amax zs)
local boxNode = convertToPoly (box length:20 width:30 height:10 lengthsegs:1 widthsegs:1 heightsegs:1 name:"UMRBoxBevel")
${compile(normal, "UMRBoxBevel")}
umrAssert ((abs ((umrMaxZ boxNode) - 15.0)) < 0.0001) "Box Bevel height is wrong"
local topVerts = for i = 1 to (polyop.getNumVerts boxNode.baseObject) where (abs ((polyop.getVert boxNode.baseObject i).z - 15.0)) < 0.0001 collect (polyop.getVert boxNode.baseObject i)
local xs = for p in topVerts collect p.x
local ys = for p in topVerts collect p.y
umrAssert ((abs (((amax xs) - (amin xs)) - 28.0)) < 0.0001) "Box Bevel outline X is wrong"
umrAssert ((abs (((amax ys) - (amin ys)) - 18.0)) < 0.0001) "Box Bevel outline Y is wrong"
format "PASS axis-extreme box height/outline\\n"
local cylinderNode = convertToPoly (cylinder radius:10 height:10 sides:12 capsegs:1 heightsegs:1 name:"UMRCylinderBevel")
${compile(normal, "UMRCylinderBevel")}
umrAssert ((abs ((umrMaxZ cylinderNode) - 15.0)) < 0.0001) "Cylinder Bevel height is wrong"
format "PASS axis-extreme cylinder\\n"
local guardNode = convertToPoly (box length:20 width:30 height:10 name:"UMRGuardBevel")
local originalFaces = polyop.getNumFaces guardNode
local guardFailed = false
try (
${compile(wrongCount, "UMRGuardBevel")}
) catch (guardFailed = true)
umrAssert guardFailed "Ambiguous face selector did not fail"
umrAssert ((polyop.getNumFaces guardNode) == originalFaces) "Guard failure mutated geometry"
format "PASS ambiguous-selection guard\\n"
local numericNode = convertToPoly (box length:20 width:30 height:10 lengthsegs:1 widthsegs:1 heightsegs:1 name:"UMRNumericBevel")
format "BOX FACES: %\\n" (for i = 1 to (polyop.getNumFaces numericNode) collect #(i, polyop.getFaceCenter numericNode.baseObject i, polyop.getFaceNormal numericNode.baseObject i))
${compile(numeric, "UMRNumericBevel")}
umrAssert ((abs ((umrMaxZ numericNode) - 15.0)) < 0.0001) "Verified face-index Bevel height is wrong"
format "PASS verified face-index guard\\n"
local catalogNode = box length:20 width:30 height:10 lengthsegs:1 widthsegs:1 heightsegs:1 name:"UMRCatalogBox"
local nodeCount = objects.count
${renderMaxScript(catalogAnalysis).script}
umrAssert (objects.count == nodeCount + 2) "Face catalog detached faces into scene nodes"
umrAssert (UMRFaceCatalogs.count == 3) "Face catalog is missing a clone namespace"
local originalCatalog = (for entry in UMRFaceCatalogs where entry[1] == "obj" collect entry)[1]
local instanceCatalog = (for entry in UMRFaceCatalogs where entry[1] == "instance" collect entry)[1]
local copyCatalog = (for entry in UMRFaceCatalogs where entry[1] == "copy" collect entry)[1]
umrAssert (originalCatalog[3] == 3 and instanceCatalog[3] == 2 and copyCatalog[3] == 0) "Face catalog topology versions drifted"
umrAssert (originalCatalog[6].count == polyop.getNumFaces catalogNode) "Face catalog did not enumerate all faces"
for i = 1 to originalCatalog[6].count do (
  umrAssert (originalCatalog[6][i][1] == "obj:t3:f" + (i as string)) "Face namespace is stale"
  umrAssert ((distance originalCatalog[6][i][3] (polyop.getFaceCenter catalogNode.baseObject i)) < 0.0001) "Face geometry is stale"
)
umrAssert ((abs ((umrMaxZ catalogNode) - 20.0)) < 0.0001) "Instance Bevel was not propagated"
umrAssert ((abs ((umrMaxZ copyCatalog[2]) - 10.0)) < 0.0001) "Independent copy was incorrectly edited"
format "PASS conversion face catalog and copy/instance revisions\\n"
${renderMaxScript(estimatedBevelFixture("UMREstimatedBevel")).script}
local estimatedNode = getNodeByName "UMREstimatedBevel" exact:true
umrAssert (estimatedNode != undefined) "Estimated Bevel did not create its synthetic source"
umrAssert ((abs ((umrMaxZ estimatedNode) - 15.0)) < 0.0001) "Estimated Bevel ratio did not compile to the expected height"
umrAssert ((polyop.getNumFaces estimatedNode) > 14) "Estimated Bevel did not create new side faces"
format "PASS approximate Bevel compiled reference ratio and topology\\n"
format "UMR_BEVEL_INTEGRATION_PASS\\n"
)
`;
await fs.writeFile(scriptPath, main, "utf8");
console.log(`Isolated 3ds Max batch test: ${directory}`);
try {
  const { stdout, stderr } = await promisify(execFile)(executable, [scriptPath, "-listenerlog", listener, "-log", systemLog, "-dm", "on", "-v", "5"],
    { windowsHide: true, cwd: path.dirname(executable), timeout: 180000, maxBuffer: 8 * 1024 * 1024, encoding: "buffer" });
  const log = decode(await fs.readFile(listener).catch(() => ""));
  console.log(decode(stdout), decode(stderr), log);
  if (!log.includes("UMR_BEVEL_INTEGRATION_PASS")) throw new Error(`3ds Max did not pass the Bevel assertions; inspect ${directory}`);
} catch (error) {
  console.error(decode(error.stdout), decode(error.stderr));
  console.error(decode(await fs.readFile(listener).catch(() => error.message)));
  process.exitCode = 1;
}

function decode(value) {
  if (!value) return "";
  if (!Buffer.isBuffer(value)) return String(value);
  return value.toString(value.includes(0) ? "utf16le" : "utf8");
}
