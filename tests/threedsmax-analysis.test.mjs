import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMaxScript } from "../src/analyzer/lib/maxscript-renderer.mjs";
import {
  mergeThreeDsMaxAnalyses,
  validateThreeDsMaxAnalysis
} from "../src/analyzer/lib/threedsmax-workflow.mjs";
import {
  loadThreeDsMaxKnowledge,
  retrieveThreeDsMaxKnowledge
} from "../src/analyzer/lib/threedsmax-knowledge.mjs";
import {
  listThreeDsMaxScreenshots,
  selectThreeDsMaxScreenshots
} from "../src/analyzer/lib/threedsmax-screenshots.mjs";
import { buildCandidateActions } from "../src/analyzer/lib/trace.mjs";
import {
  annotateThreeDsMaxTransformContexts,
  buildThreeDsMaxTransformHarness
} from "../src/analyzer/lib/threedsmax-transform-harness.mjs";
import { THREE_DSMAX_ANALYSIS_INSTRUCTIONS } from "../src/analyzer/lib/threedsmax-prompt.mjs";
import {
  assertThreeDsMaxEvidenceCoverage,
  auditThreeDsMaxReplayCompleteness
} from "../src/analyzer/lib/threedsmax-replay-audit.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("3ds Max 场景 IR 校验对象引用并合并分段", () => {
  const first = analysis([
    operation({
      id: "c1-op-001",
      kind: "create_primitive",
      resultObjectIds: ["c1-object-001"],
      className: "Sphere",
      objectName: "RecordedSphere",
      parameters: [parameter("radius", 25)]
    })
  ]);
  const second = analysis([
    operation({
      id: "c2-op-001",
      kind: "transform",
      targetObjectIds: ["c1-object-001"],
      transform: transform({ position: [10, 20, 30] })
    })
  ]);

  const merged = mergeThreeDsMaxAnalyses([first, second]);
  assert.equal(merged.maxProgram.format, "3dsmax_scene_ir");
  assert.equal(merged.maxProgram.operations.length, 2);
  assert.equal(merged.maxProgram.complete, true);

  const invalid = analysis([
    operation({
      id: "c1-op-002",
      kind: "delete_objects",
      targetObjectIds: ["missing-object"]
    })
  ]);
  assert.throws(
    () => validateThreeDsMaxAnalysis(invalid, { validateReferences: true }),
    /尚未定义的对象/
  );
});

test("3ds Max 分段合并不会把前序创建对象重复当作初始对象", () => {
  const first = analysis([
    operation({
      id: "c1-op-001",
      kind: "create_primitive",
      resultObjectIds: ["c1-object-001"],
      className: "Sphere",
      objectName: "RecordedSphere"
    })
  ]);
  const second = analysis([
    operation({
      id: "c2-op-001",
      kind: "transform",
      targetObjectIds: ["c1-object-001"],
      transform: transform({ mode: "relative", position: [10, 0, 0] })
    })
  ]);
  second.maxProgram.initialObjects.push({
    id: "c1-object-001",
    name: "RecordedSphere",
    className: "Sphere",
    confidence: 0.95
  });

  const merged = mergeThreeDsMaxAnalyses([first, second]);

  assert.deepEqual(merged.maxProgram.initialObjects, []);
  assert.equal(merged.maxProgram.operations.length, 2);
  assert.match(merged.maxProgram.warnings.at(-1), /c1-object-001/);
});

test("MAXScript 渲染器编译创建、参数、变换和修改器", () => {
  const input = analysis([
    operation({
      id: "c1-op-001",
      kind: "create_primitive",
      resultObjectIds: ["c1-object-001"],
      className: "Box",
      objectName: "RecordedBox",
      parameters: [parameter("length", 40), parameter("width", 20), parameter("height", 10)],
      transform: transform({ position: [1, 2, 3] })
    }),
    operation({
      id: "c1-op-002",
      kind: "add_modifier",
      targetObjectIds: ["c1-object-001"],
      className: "Bend",
      parameters: [parameter("angle", 45)]
    }),
    operation({
      id: "c1-op-003",
      kind: "transform",
      targetObjectIds: ["c1-object-001"],
      transform: transform({
        mode: "relative",
        position: [10, 0, 0],
        rotationEulerDegrees: [0, 0, 90]
      })
    })
  ]);

  const rendered = renderMaxScript(input);
  assert.equal(rendered.partial, false);
  assert.equal(rendered.renderedOperationCount, 3);
  assert.match(rendered.script, /local umr_obj_1 = Box\(\)/);
  assert.match(rendered.script, /umr_obj_1\.name = "RecordedBox"/);
  assert.match(rendered.script, /setProperty umr_obj_1 #length 40\.0/);
  assert.match(rendered.script, /umr_obj_1\.position = \[1\.0, 2\.0, 3\.0\]/);
  assert.match(rendered.script, /local umr_mod_1_c1_object_001 = Bend\(\)/);
  assert.match(rendered.script, /addModifier umr_obj_1 umr_mod_1_c1_object_001/);
  assert.match(rendered.script, /in coordsys world move umr_obj_1 \[10\.0, 0\.0, 0\.0\]/);
  assert.match(rendered.script, /rotate umr_obj_1 \(eulerAngles 0\.0 0\.0 90\.0\)/);
  assert.match(rendered.script, /catch\s*\([\s\S]*throw\(\)/);
  assert.doesNotMatch(rendered.script, /throw umr_error/);
});

test("MAXScript 渲染器把复制时的相对旋转应用到新对象", () => {
  const input = analysis([
    operation({
      id: "c1-op-001",
      kind: "create_primitive",
      resultObjectIds: ["c1-object-001"],
      className: "Cylinder"
    }),
    operation({
      id: "c1-op-002",
      kind: "clone_objects",
      targetObjectIds: ["c1-object-001"],
      resultObjectIds: ["c1-object-002"],
      transform: transform({
        mode: "relative",
        rotationEulerDegrees: [0, 0, 120]
      })
    })
  ]);

  const rendered = renderMaxScript(input);
  assert.match(rendered.script, /local umr_obj_2 = copy umr_obj_1/);
  assert.match(rendered.script, /rotate umr_obj_2 \(eulerAngles 0\.0 0\.0 120\.0\)/);
});

test("MAXScript 渲染器保留 Instance 克隆语义", () => {
  const input = analysis([
    operation({
      id: "c1-op-001", kind: "create_primitive",
      resultObjectIds: ["c1-object-001"], className: "Cylinder"
    }),
    operation({
      id: "c1-op-002", kind: "clone_objects",
      targetObjectIds: ["c1-object-001"], resultObjectIds: ["c1-object-002"],
      parameters: [parameter("cloneType", "Instance")],
      transform: transform({ mode: "relative", rotationEulerDegrees: [0, 0, 120] })
    })
  ]);

  const rendered = renderMaxScript(input);
  assert.match(rendered.script, /local umr_obj_2 = instance umr_obj_1/);
});

test("MAXScript 渲染器编译精确 Pivot、Center to Object 与目标对象中心对齐", () => {
  const input = analysis([
    operation({
      id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"], className: "Cylinder"
    }),
    operation({
      id: "c1-op-002", kind: "set_pivot", targetObjectIds: ["c1-object-001"],
      transform: transform({ position: [10, 20, 30] })
    }),
    operation({
      id: "c1-op-003", kind: "set_pivot", targetObjectIds: ["c1-object-001"],
      parameters: [parameter("pivotMode", "center_to_object")]
    }),
    operation({
      id: "c1-op-004", kind: "clone_objects", targetObjectIds: ["c1-object-001"],
      resultObjectIds: ["c1-object-002"]
    }),
    operation({
      id: "c1-op-005", kind: "set_pivot", targetObjectIds: ["c1-object-002"],
      parameters: [
        parameter("pivotMode", "match_object_center"),
        parameter("referenceObjectId", "c1-object-001")
      ]
    })
  ]);

  const rendered = renderMaxScript(input);
  assert.match(rendered.script, /umr_obj_1\.pivot = \[10\.0, 20\.0, 30\.0\]/);
  assert.match(rendered.script, /umr_obj_1\.pivot = umr_obj_1\.center/);
  assert.match(rendered.script, /umr_obj_2\.pivot = umr_obj_1\.center/);
});

test("3ds Max IR 拒绝不存在的枢轴对齐目标", () => {
  const input = analysis([
    operation({
      id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
      className: "Cylinder"
    }),
    operation({
      id: "c1-op-002", kind: "set_pivot", targetObjectIds: ["c1-object-001"],
      parameters: [
        parameter("pivotMode", "match_object_center"),
        parameter("referenceObjectId", "missing-object")
      ]
    })
  ]);

  assert.throws(
    () => validateThreeDsMaxAnalysis(input, { validateReferences: true }),
    /枢轴对齐目标尚未定义/
  );
});

test("3ds Max UI Map 检索返回 Create、Modify 和变换控件", async () => {
  const knowledge = await loadThreeDsMaxKnowledge(
    path.join(repositoryRoot, "ui-maps", "3dsmax", "2027", "en-US")
  );
  const retrieval = retrieveThreeDsMaxKnowledge(knowledge, [{
    action: "click",
    target: { name: "Select and Move", automationId: "50001", ancestors: [] }
  }]);
  assert.equal(retrieval.metadata.version, "2027");
  assert.ok(retrieval.context.commandPanels.some((panel) => panel.name === "Create"));
  assert.ok(retrieval.context.commandPanels.some((panel) => panel.name === "Modify"));
  assert.ok(retrieval.context.toolbarControls.some((control) => control.actionId === "MainUI/Move"));
});

test("3ds Max 全量截图模式保留每个动作的完整证据对", () => {
  const actions = Array.from({ length: 20 }, (_, index) => ({
    action: "drag",
    screenshotBefore: `screenshots/evt-${index}-before.jpg`,
    screenshotSelection: index === 5 ? "screenshots/evt-5-selection.jpg" : null,
    screenshotAfter: `screenshots/evt-${index}-after.jpg`,
    visualChange: { changed: true }
  }));

  const all = listThreeDsMaxScreenshots(actions);
  const selected = selectThreeDsMaxScreenshots(actions, 4, { uploadAll: true });

  assert.equal(all.length, 41);
  assert.deepEqual(selected, all);
  assert.ok(selected.includes("screenshots/evt-5-selection.jpg"));
});

test("3ds Max 变换局部证据从原始鼠标事件传到候选动作并优先上传", () => {
  const region = (kind, phase) => ({
    kind,
    phase,
    screenshot: `screenshots/transform/evt-2-${kind}-${phase}.jpg`,
    relativeBounds: [0.6, 0.9, 0.3, 0.1],
    pixelBounds: [600, 900, 300, 100]
  });
  const events = [
    {
      id: "evt-1", eventType: "mouse_down", timestampMs: 1, button: "left", x: 100, y: 100,
      screenshot: "screenshots/evt-1.jpg", window: { width: 1000, height: 1000 }
    },
    {
      id: "evt-2", eventType: "mouse_up", timestampMs: 2, button: "left", x: 200, y: 200,
      screenshot: "screenshots/evt-2.jpg", screenshotAfter: "screenshots/evt-2.jpg",
      transformEvidence: [
        region("transform_toolbar", "before"), region("transform_toolbar", "after"),
        region("transform_type_in", "before"), region("transform_type_in", "after")
      ],
      visualChange: { changed: true }, window: { width: 1000, height: 1000 }
    }
  ];

  const actions = buildCandidateActions(events);
  const selected = selectThreeDsMaxScreenshots(actions, 4);

  assert.equal(actions[0].action, "drag");
  assert.equal(actions[0].transformEvidence.length, 4);
  assert.ok(selected.includes("screenshots/transform/evt-2-transform_type_in-before.jpg"));
  assert.ok(selected.includes("screenshots/transform/evt-2-transform_type_in-after.jpg"));
  assert.ok(selected.some((item) => item.includes("transform_toolbar")));
});

test("3ds Max Harness 区分视口拖拽增量与右下角数值输入", () => {
  const evidence = [{ kind: "transform_type_in", phase: "after", screenshot: "xyz.jpg" }];
  const viewport = buildThreeDsMaxTransformHarness({
    action: "drag",
    button: "left",
    from: { relativeX: 0.5, relativeY: 0.5 },
    to: { relativeX: 0.55, relativeY: 0.6 },
    transformEvidence: evidence
  });
  const typeIn = buildThreeDsMaxTransformHarness({
    action: "click",
    at: { relativeX: 0.76, relativeY: 0.97 },
    transformEvidence: evidence
  });

  assert.equal(viewport.interactionState, "viewport_transform_drag");
  assert.equal(
    viewport.coordinateDisplayInterpretation,
    "paired_before_after_values_resolve_absolute_or_offset"
  );
  assert.equal(typeIn.interactionState, "coordinate_display_edit");
  assert.match(typeIn.coordinateDisplayInterpretation, /absolute_or_offset/);
  assert.equal(viewport.coordinateDisplayCapture.duringDragReadoutCaptured, false);
  assert.equal(viewport.coordinateDisplayCapture.primitiveCreation,
    "cursor_absolute_world_coordinates_not_object_dimensions");
  assert.equal(viewport.coordinateDisplayCapture.toolValueKinds.scale, "scale_percent");
});

test("3ds Max Harness 使用正确的 W E R 变换快捷键映射", () => {
  const evidence = [{ kind: "transform_toolbar", phase: "after", screenshot: "toolbar.jpg" }];
  const shortcut = (text) => buildThreeDsMaxTransformHarness({
    action: "type_text", text, transformEvidence: evidence
  }).shortcutTool;

  assert.equal(shortcut("W"), "move");
  assert.equal(shortcut("E"), "rotate");
  assert.equal(shortcut("R"), "scale");
});

test("3ds Max Harness 沿时间线区分创建坐标与对象变换数值", () => {
  const actions = [
    {
      action: "click",
      target: { name: "Cylinder", ancestors: [{ name: "Create Object Type", automationId: "CreateButtonPanel" }] }
    },
    { action: "drag", button: "left", from: { relativeX: 0.4, relativeY: 0.4 }, to: { relativeX: 0.5, relativeY: 0.5 } },
    { action: "type_text", text: "R", modifiers: [] },
    { action: "drag", button: "left", from: { relativeX: 0.5, relativeY: 0.5 }, to: { relativeX: 0.5, relativeY: 0.3 } }
  ];
  annotateThreeDsMaxTransformContexts(actions);

  assert.equal(buildThreeDsMaxTransformHarness({
    ...actions[1], transformEvidence: [{ kind: "transform_type_in", phase: "after", screenshot: "create.jpg" }]
  }).interactionMode, "primitive_creation");
  const scaleHarness = buildThreeDsMaxTransformHarness({
    ...actions[3], transformEvidence: [{ kind: "transform_type_in", phase: "after", screenshot: "scale.jpg" }]
  });
  assert.equal(scaleHarness.activeTransformTool, "scale");
  assert.equal(scaleHarness.activeTransformToolSource, "keyboard_R");
  assert.equal(scaleHarness.interactionMode, "object_transform");
});

test("3ds Max Harness 保留 Shift+A 并标记 Quick Align", () => {
  const actions = buildCandidateActions([{
    id: "evt-align", eventType: "key_down", key: "A", text: "A",
    modifiers: ["SHIFT"], timestampMs: 100,
    screenshotBefore: "align-before.jpg", screenshotAfter: "align-after.jpg",
    target: { name: "Perspective" }
  }]);

  assert.deepEqual(actions[0].modifiers, ["SHIFT"]);
  assert.equal(actions[0].screenshotBefore, "align-before.jpg");
  assert.equal(actions[0].screenshotAfter, "align-after.jpg");
  const harness = buildThreeDsMaxTransformHarness(actions[0]);
  assert.equal(harness.shortcutCommand, "quick_align");
  assert.equal(harness.interactionState, "pivot_quick_align_shortcut_candidate");
});

test("3ds Max Harness 区分中键导航与 Shift 左键克隆变换", () => {
  const evidence = [
    { kind: "viewport_transform_overlay", phase: "after", screenshot: "overlay.jpg" },
    { kind: "transform_type_in", phase: "before", screenshot: "xyz-before.jpg" },
    { kind: "transform_type_in", phase: "after", screenshot: "xyz-after.jpg" }
  ];
  const navigation = buildThreeDsMaxTransformHarness({
    action: "drag", button: "middle", modifiers: [],
    from: { relativeX: 0.5, relativeY: 0.5 }, to: { relativeX: 0.6, relativeY: 0.6 },
    transformEvidence: evidence
  });
  const clone = buildThreeDsMaxTransformHarness({
    action: "drag", button: "left", modifiers: ["SHIFT"],
    from: { x: 500, y: 500, relativeX: 0.5, relativeY: 0.5 },
    to: { x: 600, y: 600, relativeX: 0.6, relativeY: 0.6 },
    transformEvidence: evidence
  });

  assert.equal(navigation.interactionState, "viewport_navigation");
  assert.equal(navigation.coordinateDisplayInterpretation, "ignore_for_scene_object_transform");
  assert.equal(clone.interactionState, "viewport_clone_transform_drag");
  assert.deepEqual(clone.modifierState, ["SHIFT"]);
  assert.deepEqual(clone.dragTransaction.deltaPixels, [100, 100]);
  assert.equal(clone.dragTransaction.transformTypeInPair.beforeScreenshot, "xyz-before.jpg");
  assert.match(clone.dragTransaction.transformTypeInPair.exactValueRule.absoluteMode, /afterXYZ-beforeXYZ/);
  assert.match(clone.dragTransaction.transformTypeInPair.exactValueRule.offsetMode, /reset_to_zero/);
});

test("3ds Max 截图名额优先保留视口动态角度和 Clone Options", () => {
  const action = {
    action: "drag",
    transformEvidence: [
      { kind: "scene_explorer", screenshot: "scene.jpg" },
      { kind: "transform_type_in", screenshot: "type-in.jpg" },
      { kind: "clone_options", screenshot: "clone.jpg" },
      { kind: "viewport_transform_overlay", screenshot: "angle.jpg" }
    ]
  };

  assert.deepEqual(selectThreeDsMaxScreenshots([action], 2), ["clone.jpg", "angle.jpg"]);
});

test("3ds Max 精简截图跨时间保留创建参数和 Shift 拖拽数值对", () => {
  const filler = Array.from({ length: 12 }, (_, index) => ({
    action: "click",
    transformEvidence: [
      { kind: "command_panel_parameters", phase: "before", screenshot: `p-${index}-before.jpg` },
      { kind: "command_panel_parameters", phase: "after", screenshot: `p-${index}-after.jpg` }
    ]
  }));
  const clone = {
    action: "drag", button: "left", modifiers: ["SHIFT"],
    transformEvidence: [
      { kind: "transform_type_in", phase: "before", screenshot: "clone-xyz-before.jpg" },
      { kind: "transform_type_in", phase: "after", screenshot: "clone-xyz-after.jpg" },
      { kind: "viewport_transform_overlay", phase: "after", screenshot: "clone-overlay-after.jpg" }
    ]
  };

  const selected = selectThreeDsMaxScreenshots([...filler, clone], 8);

  assert.ok(selected.includes("p-0-after.jpg"));
  assert.ok(selected.includes("clone-xyz-before.jpg"));
  assert.ok(selected.includes("clone-xyz-after.jpg"));
  assert.ok(selected.includes("clone-overlay-after.jpg"));
});

test("3ds Max 数值拖拽对不会被 Quick Align 重复图挤出名额", () => {
  const pair = (id) => ({
    action: "drag", button: "left", modifiers: [],
    transformEvidence: [
      { kind: "transform_type_in", phase: "before", screenshot: `${id}-before.jpg` },
      { kind: "transform_type_in", phase: "after", screenshot: `${id}-after.jpg` },
      { kind: "viewport_transform_overlay", phase: "after", screenshot: `${id}-overlay.jpg` }
    ]
  });
  const align = {
    action: "type_text", text: "A", modifiers: ["SHIFT"],
    screenshotBefore: "align-full-before.jpg",
    transformEvidence: [
      { kind: "command_panel_context", phase: "before", screenshot: "align-context-before.jpg" },
      { kind: "command_panel_context", phase: "after", screenshot: "align-context-after.jpg" },
      { kind: "scene_explorer", phase: "before", screenshot: "align-scene-before.jpg" },
      { kind: "scene_explorer", phase: "after", screenshot: "align-scene-after.jpg" },
      { kind: "selected_object", phase: "before", screenshot: "align-object-before.jpg" },
      { kind: "selected_object", phase: "after", screenshot: "align-object-after.jpg" }
    ]
  };
  const target = {
    action: "click", button: "left", screenshotAfter: "target-after.jpg",
    transformEvidence: [
      { kind: "selected_object", phase: "after", screenshot: "target-object-after.jpg" },
      { kind: "scene_explorer", phase: "after", screenshot: "target-scene-after.jpg" }
    ]
  };

  const selected = selectThreeDsMaxScreenshots([align, target, pair("move"), pair("scale")], 8);
  for (const file of ["move-before.jpg", "move-after.jpg", "scale-before.jpg", "scale-after.jpg"])
    assert.ok(selected.includes(file), file);
});

test("3ds Max 分析提示不再携带历史录制数字", () => {
  assert.doesNotMatch(THREE_DSMAX_ANALYSIS_INSTRUCTIONS, /5\.465|10\.706|934\.053|120\.00/);
  assert.match(THREE_DSMAX_ANALYSIS_INSTRUCTIONS, /uploadedEvidence=true/);
});

test("3ds Max 多阶段 Cylinder 创建同时保留半径和最终高度参数图", () => {
  const primitive = {
    action: "click", button: "left",
    target: {
      name: "Cylinder", automationId: "CreateButtonPanel.Cylinder",
      ancestors: [{ name: "Object Type", automationId: "QtCreatePanelWidget" }]
    }
  };
  const radius = {
    action: "drag", button: "left",
    to: { relativeX: 0.5, relativeY: 0.5 },
    transformEvidence: [{
      kind: "command_panel_parameters", phase: "after", screenshot: "radius-stage.jpg"
    }]
  };
  const height = {
    action: "click", button: "left",
    at: { relativeX: 0.5, relativeY: 0.5 },
    transformEvidence: [{
      kind: "command_panel_parameters", phase: "after", screenshot: "height-final.jpg"
    }]
  };

  const selected = selectThreeDsMaxScreenshots([primitive, radius, height], 4);
  assert.ok(selected.includes("radius-stage.jpg"));
  assert.ok(selected.includes("height-final.jpg"));
});

test("关闭 UI Automation 后仍按 Create 面板位置保留多阶段参数", () => {
  const primitive = {
    action: "click", button: "left", at: { relativeX: 0.95, relativeY: 0.21 },
    target: null,
    transformEvidence: [{
      kind: "command_panel_parameters", phase: "after", screenshot: "primitive-selected.jpg"
    }]
  };
  const radius = {
    action: "drag", button: "left", to: { relativeX: 0.55, relativeY: 0.55 },
    transformEvidence: [{
      kind: "command_panel_parameters", phase: "after", screenshot: "radius-no-uia.jpg"
    }]
  };
  const height = {
    action: "click", button: "left", at: { relativeX: 0.55, relativeY: 0.53 },
    screenshotAfter: "height-no-uia.jpg"
  };

  const selected = selectThreeDsMaxScreenshots([primitive, radius, height], 4);
  assert.ok(selected.includes("radius-no-uia.jpg"));
  assert.ok(selected.includes("height-no-uia.jpg"));
});

test("3ds Max 回放审计拒绝把默认尺寸和原点当作录制结果", () => {
  const input = analysis([operation({
    id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
    className: "Cylinder", parameters: [], transform: transform({ mode: "none" })
  })]);

  const audited = auditThreeDsMaxReplayCompleteness(input);
  assert.equal(audited.maxProgram.complete, false);
  assert.match(audited.maxProgram.warnings.join(" "), /尺寸参数/);
  assert.match(audited.maxProgram.warnings.join(" "), /创建位置/);
});

test("3ds Max 证据覆盖校验拒绝忽略清晰创建参数", () => {
  const input = analysis([operation({
    id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
    className: "Cylinder", parameters: [], sourceEventIds: ["evt-create"]
  })]);
  const payload = {
    actions: [{
      sourceEventIds: ["evt-create"],
      transformEvidence: [{ kind: "command_panel_parameters", phase: "after", screenshot: "params.jpg" }]
    }]
  };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /创建参数未被可靠逐字读取/
  );
});

test("3ds Max 证据覆盖校验拒绝把清晰参数当作低置信猜测", () => {
  const input = analysis([operation({
    id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
    className: "Cylinder", confidence: 0.6,
    parameters: [
      parameter("radius", 25), parameter("height", 10), parameter("heightsegs", 1),
      parameter("capsegs", 1), parameter("sides", 32)
    ],
    sourceEventIds: ["evt-create"]
  })]);
  input.maxProgram.operations[0].parameters[0].confidence = 0.55;
  const payload = {
    actions: [{
      sourceEventIds: ["evt-create"],
      transformEvidence: [{ kind: "command_panel_parameters", phase: "after", screenshot: "params.jpg" }]
    }]
  };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /低置信字段=radius/
  );
});

test("3ds Max 自动修复后仍拒绝低置信创建参数", () => {
  const input = analysis([operation({
    id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
    className: "Cylinder", confidence: 0.6,
    parameters: [
      { ...parameter("radius", 12.435), confidence: 0.6 },
      { ...parameter("height", 1.929), confidence: 0.6 },
      { ...parameter("heightsegs", 1), confidence: 0.6 },
      { ...parameter("capsegs", 1), confidence: 0.6 },
      { ...parameter("sides", 24), confidence: 0.6 }
    ],
    sourceEventIds: ["evt-create"]
  })]);
  const payload = { actions: [{
    sourceEventIds: ["evt-create"],
    transformEvidence: [{ kind: "command_panel_parameters", screenshot: "params.jpg" }]
  }] };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /禁止保留默认值或近似值/
  );
});

test("3ds Max 证据覆盖校验拒绝丢失 Shift 拖拽复制位移", () => {
  const input = analysis([
    operation({
      id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
      className: "Cylinder", parameters: [parameter("radius", 12)]
    }),
    operation({
      id: "c1-op-002", kind: "clone_objects",
      targetObjectIds: ["c1-object-001"], resultObjectIds: ["c1-object-002"],
      sourceEventIds: ["evt-drag"], transform: transform({ mode: "none" })
    })
  ]);
  const payload = {
    actions: [{
      sourceEventIds: ["evt-drag"],
      transformHarness: {
        interactionState: "viewport_clone_transform_drag",
        dragTransaction: { transformTypeInPair: { beforeScreenshot: "a.jpg", afterScreenshot: "b.jpg" } }
      }
    }]
  };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /clone transform 为空/
  );
});

test("3ds Max 证据覆盖校验拒绝省略已上传的精确拖拽", () => {
  const input = analysis([]);
  input.omitted = [{
    sourceEventIds: ["evt-move"],
    reason: "存在持久拖拽变化，但无法安全确定完整精确变换值。",
    confidence: 0.7
  }];
  const payload = { actions: [{
    action: "drag", button: "left", sourceEventIds: ["evt-move"],
    visualChange: { changed: true },
    transformHarness: {
      interactionState: "viewport_transform_drag",
      dragTransaction: { transformTypeInPair: { uploadedEvidence: true } }
    }
  }] };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /未生成对应变换/
  );
  input.omitted[0].reason = "Transform Type-In after 为空字段，这是多选框选而非对象变换。";
  assert.doesNotThrow(() => assertThreeDsMaxEvidenceCoverage(input, payload));
});

test("3ds Max 精确数值拖拽不允许以低置信猜测降级通过", () => {
  const input = analysis([operation({
    id: "c1-op-002", kind: "transform", targetObjectIds: ["existing-object"],
    sourceEventIds: ["evt-drag"], confidence: 0.76,
    transform: transform({ mode: "absolute", position: [0, 0, 100] })
  })]);
  input.maxProgram.initialObjects = [{
    id: "existing-object", name: "Cylinder001", className: "Cylinder", confidence: 1
  }];
  const payload = { actions: [{
    action: "drag", button: "left", sourceEventIds: ["evt-drag"],
    visualChange: { changed: true },
    transformHarness: {
      interactionState: "viewport_transform_drag",
      dragTransaction: { transformTypeInPair: { uploadedEvidence: true } }
    }
  }] };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /置信度仅为 0\.76/
  );
});

test("3ds Max 证据覆盖校验要求 Pivot Quick Align 目标关系", () => {
  const input = analysis([
    operation({
      id: "c1-op-001", kind: "create_primitive", resultObjectIds: ["c1-object-001"],
      className: "Cylinder", parameters: [parameter("radius", 12)]
    }),
    operation({
      id: "c1-op-002", kind: "clone_objects", targetObjectIds: ["c1-object-001"],
      resultObjectIds: ["c1-object-002"]
    }),
    operation({
      id: "c1-op-003", kind: "set_pivot", targetObjectIds: ["c1-object-002"],
      sourceEventIds: ["evt-center"], parameters: [parameter("pivotMode", "center_to_object")]
    })
  ]);
  const payload = {
    actions: [
      { sourceEventIds: ["evt-center"], target: { name: "Center to Object", ancestors: [] } },
      {
        sourceEventIds: ["evt-align"],
        transformHarness: { shortcutCommand: "quick_align" }
      },
      { sourceEventIds: ["evt-target"], action: "click", target: { name: "Perspective", ancestors: [] } }
    ]
  };

  assert.throws(
    () => assertThreeDsMaxEvidenceCoverage(input, payload),
    /match_object_center/
  );
});

function analysis(operations) {
  return {
    summary: "test",
    maxProgram: {
      format: operations.length > 0 ? "3dsmax_scene_ir" : "none",
      initialObjects: [],
      operations,
      confidence: 0.95,
      warnings: [],
      complete: true
    },
    omitted: [],
    warnings: []
  };
}

function operation(overrides = {}) {
  return {
    id: "c1-op-default",
    kind: "select_objects",
    targetObjectIds: [],
    resultObjectIds: [],
    className: null,
    objectName: null,
    parameters: [],
    propertyTarget: "none",
    transform: transform(),
    selectionMode: "none",
    sourceEventIds: ["evt-1"],
    sourceScreenshots: [],
    confidence: 0.95,
    ...overrides
  };
}

function parameter(name, value) {
  return { name, value, unit: null, confidence: 0.95 };
}

function transform(overrides = {}) {
  return {
    mode: "absolute",
    position: null,
    rotationEulerDegrees: null,
    scalePercent: null,
    coordinateSystem: "world",
    ...overrides
  };
}
