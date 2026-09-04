import { bevelOperation, bevelAnalysis } from "./threedsmax-bevel.mjs";

// Synthetic numbers, never inferred from a user's recording.
export function estimatedBevelFixture(name = "UMREstimatedBevel") {
  const operation = bevelOperation();
  operation.polyEdit.height = null;
  operation.polyEdit.outline = null;
  operation.polyEdit.approximation = {
    method: "reference_geometry_ratio", reference: { objectId: "obj", operationId: "create", parameter: "radius", value: 10 },
    heightRatio: 0.5, outlineRatio: -0.1, heightRatioRange: [0.4,0.6], outlineRatioRange: [-0.12,-0.08],
    confidence: 0.4, view: "perspective", viewStable: true, referenceVisibleUnchanged: true,
    reason: "Synthetic geometric-ratio fixture, not measured image data", limitations: ["Perspective and pixel localization uncertainty"]
  };
  operation.polyEdit.evidence.parameters = ["selection.jpg", "after.jpg"];
  const input = bevelAnalysis(operation, name);
  input.maxProgram.initialObjects = [];
  const create = bevelOperation({ id: "create", kind: "create_primitive", polyEdit: null, targetObjectIds: [], resultObjectIds: ["obj"], className: "Cylinder", objectName: name,
    parameters: [
      { name: "radius", value: 10, unit: "scene_units", confidence: 1 },
      { name: "height", value: 10, unit: "scene_units", confidence: 1 },
      { name: "heightsegs", value: 1, unit: null, confidence: 1 },
      { name: "capsegs", value: 1, unit: null, confidence: 1 },
      { name: "sides", value: 12, unit: null, confidence: 1 }
    ], sourceEventIds: ["evt-create"], sourceScreenshots: ["create.jpg"],
    transform: { mode: "absolute", position: [0,0,0], rotationEulerDegrees: null, scalePercent: null, coordinateSystem: "world" } });
  const convert = bevelOperation({ id: "convert", kind: "convert_to_poly", polyEdit: null, sourceEventIds: ["evt-convert"], sourceScreenshots: ["convert.jpg"] });
  input.maxProgram.operations = [create, convert, operation];
  return input;
}
