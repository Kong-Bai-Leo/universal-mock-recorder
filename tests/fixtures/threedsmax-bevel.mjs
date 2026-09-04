export function bevelOperation(overrides = {}) {
  return {
    id: "test-bevel", kind: "bevel_faces", targetObjectIds: ["obj"], resultObjectIds: [],
    className: null, objectName: null, parameters: [], propertyTarget: "object", selectionMode: "none",
    transform: { mode: "none", position: null, rotationEulerDegrees: null, scalePercent: null, coordinateSystem: "local" },
    polyEdit: {
      height: 5, outline: -1, bevelType: "group", bias: null,
      selection: { method: "axis_extreme", axis: "z", side: "max", expectedCount: 1,
        indices: [], faceIds: [], topologyRevision: null, faceChecks: [], expectedFaceCount: null, expectedVertexCount: null },
      evidence: { selection: ["selection.jpg"], parameters: ["parameters.jpg"], completion: ["after.jpg"] }
    },
    sourceEventIds: ["evt-bevel"], sourceScreenshots: ["selection.jpg", "parameters.jpg", "after.jpg"], confidence: 0.95,
    ...overrides
  };
}

export function bevelAnalysis(operation = bevelOperation(), name = "UMRBevelTest") {
  return {
    summary: "Synthetic Bevel test fixture, not a reconstruction of user data",
    maxProgram: { format: "3dsmax_scene_ir", initialObjects: [{ id: "obj", name, className: "Editable_Poly", confidence: 1 }],
      operations: [operation], confidence: 0.95, complete: true, warnings: [] },
    omitted: [], warnings: [], dragAssessments: []
  };
}
