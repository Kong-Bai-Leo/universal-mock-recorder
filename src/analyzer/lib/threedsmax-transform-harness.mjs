export function buildThreeDsMaxTransformHarness(action) {
  const evidence = action?.transformEvidence ?? [];
  const isQuickAlignShortcut = action?.action === "type_text" &&
    /^A$/i.test(String(action.text ?? "")) &&
    (action.modifiers ?? []).includes("SHIFT");
  if (evidence.length === 0 && !isQuickAlignShortcut) return null;

  const point = action.at ?? action.to ?? action.from ?? null;
  const relativeX = finite(point?.relativeX);
  const relativeY = finite(point?.relativeY);
  const isCoordinateDisplayInteraction = relativeX !== null && relativeY !== null &&
    relativeX >= 0.62 && relativeX <= 0.92 && relativeY >= 0.90;
  const isViewportDrag = action.action === "drag" && action.button === "left" && relativeX !== null && relativeY !== null &&
    relativeX >= 0.01 && relativeX <= 0.90 && relativeY >= 0.10 && relativeY <= 0.95;
  const isViewportNavigation = action.action === "drag" && ["middle", "right"].includes(action.button);
  const isCloneTransform = isViewportDrag && (action.modifiers ?? []).includes("SHIFT");
  const typedShortcut = action.action === "type_text" && /^[WER]$/i.test(String(action.text ?? ""));
  const committed = action.action === "press_key" && /^(ENTER|RETURN)$/i.test(String(action.key ?? ""));
  const dragTransaction = action.action === "drag" ? buildDragTransaction(action, evidence) : null;
  const transformContext = action.threeDsMaxTransformContext ?? null;

  let interactionState = "visual_state_check";
  let coordinateDisplayInterpretation = "resolve_from_active_tool_selection_and_mode";
  if (isViewportNavigation) {
    interactionState = "viewport_navigation";
    coordinateDisplayInterpretation = "ignore_for_scene_object_transform";
  } else if (isCloneTransform) {
    interactionState = "viewport_clone_transform_drag";
    coordinateDisplayInterpretation = "paired_before_after_values_resolve_absolute_or_offset_for_new_clone";
  } else if (isViewportDrag) {
    interactionState = "viewport_transform_drag";
    coordinateDisplayInterpretation = "paired_before_after_values_resolve_absolute_or_offset";
  } else if (isCoordinateDisplayInteraction) {
    interactionState = "coordinate_display_edit";
    coordinateDisplayInterpretation = "typed_value_absolute_or_offset_requires_toggle_state";
  } else if (isQuickAlignShortcut) {
    interactionState = "pivot_quick_align_shortcut_candidate";
    coordinateDisplayInterpretation = "next_viewport_click_is_alignment_target_not_a_coordinate_value";
  } else if (typedShortcut) {
    interactionState = "transform_tool_shortcut_candidate";
    coordinateDisplayInterpretation = "do_not_read_as_object_value_until_tool_and_selection_are_visible";
  } else if (committed) {
    interactionState = "coordinate_display_commit_candidate";
    coordinateDisplayInterpretation = "compare_before_after_and_resolve_active_tool_selection_and_mode";
  }

  return {
    interactionState,
    coordinateDisplayInterpretation,
    pointerButton: action.button ?? null,
    modifierState: action.modifiers ?? [],
    shortcutTool: typedShortcut ? transformShortcut(action.text) : null,
    shortcutCommand: isQuickAlignShortcut ? "quick_align" : null,
    activeTransformTool: transformContext?.activeTool ?? null,
    activeTransformToolSource: transformContext?.source ?? null,
    activeTransformToolConfidence: transformContext?.confidence ?? 0,
    interactionMode: transformContext?.interactionMode ?? "unknown",
    dragTransaction,
    coordinateDisplayCapture: {
      beforeTiming: action.action === "drag" ? "immediately_before_mouse_down" : "action_before",
      afterTiming: action.action === "drag" ? "after_mouse_up_settled" : "action_after",
      duringDragReadoutCaptured: false,
      semanticGate: "single_selected_object_and_confirmed_transform_tool_required",
      idleWithoutSelection: "cursor_absolute_world_coordinates",
      primitiveCreation: "cursor_absolute_world_coordinates_not_object_dimensions",
      toolValueKinds: {
        move: "position_scene_units",
        rotate: "rotation_degrees",
        scale: "scale_percent"
      },
      modeEvidence: "absolute_offset_button_is_visible_left_of_xyz_in_uploaded_crop"
    },
    evidenceKinds: [...new Set(evidence.map((item) => item.kind).filter(Boolean))],
    requiredVisualChecks: [
      "active_move_rotate_scale_tool",
      "single_selected_object_or_subobject",
      "absolute_or_offset_toggle",
      "xyz_field_labels_and_values",
      ...(isQuickAlignShortcut ? [
        "affect_pivot_only_state",
        "source_object_selected_before_shortcut",
        "target_object_clicked_after_shortcut"
      ] : [])
    ],
    prohibitions: [
      "do_not_treat_cursor_world_coordinates_as_object_transform",
      "do_not_treat_transform_xyz_as_primitive_dimensions",
      "do_not_convert_pixels_directly_to_scene_units_when_labeled_xyz_values_exist"
    ]
  };
}

export function annotateThreeDsMaxTransformContexts(actions) {
  let state = {
    activeTool: null,
    source: null,
    confidence: 0,
    interactionMode: "unknown"
  };
  for (const action of actions ?? []) {
    const directTool = detectTransformTool(action);
    if (directTool) {
      state = {
        activeTool: directTool.tool,
        source: directTool.source,
        confidence: directTool.confidence,
        interactionMode: "object_transform"
      };
    } else if (isPrimitiveCreationTarget(action)) {
      state = {
        activeTool: null,
        source: "primitive_create_control",
        confidence: 0.96,
        interactionMode: "primitive_creation"
      };
    }
    action.threeDsMaxTransformContext = { ...state };
  }
  return actions;
}

function buildDragTransaction(action, evidence) {
  const start = compactPoint(action.from);
  const end = compactPoint(action.to);
  const deltaX = finite(end?.x) !== null && finite(start?.x) !== null ? end.x - start.x : null;
  const deltaY = finite(end?.y) !== null && finite(start?.y) !== null ? end.y - start.y : null;
  const typeInBefore = findEvidence(evidence, "transform_type_in", "before");
  const typeInAfter = findEvidence(evidence, "transform_type_in", "after");
  const pixelDistance = deltaX !== null && deltaY !== null
    ? Math.hypot(deltaX, deltaY)
    : null;
  const dominantScreenAxis = deltaX === null || deltaY === null
    ? null
    : Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";

  return {
    start,
    end,
    deltaPixels: deltaX === null || deltaY === null ? null : [deltaX, deltaY],
    distancePixels: pixelDistance,
    dominantScreenAxis,
    screenDirection: screenDirection(deltaX, deltaY),
    modifierState: action.modifiers ?? [],
    transformTypeInPair: typeInBefore && typeInAfter ? {
      beforeScreenshot: typeInBefore.screenshot,
      afterScreenshot: typeInAfter.screenshot,
      pairing: "same_drag_event",
      exactValueRule: {
        absoluteMode: "finalXYZ=afterXYZ; deltaXYZ=afterXYZ-beforeXYZ",
        offsetMode: "completed_drag_afterXYZ_may_reset_to_zero; do_not_treat_it_as_final_or_delta_without_an_in_drag_overlay_or_explicit_typed_value",
        modeResolution: "read_absolute_or_offset_toggle_visible_to_the_left_of_xyz_in_the_same_before_after_crops",
        captureTiming: "the_pair_is_outside_the_live_drag: before_mouse_down_and_after_mouse_up_settled"
      }
    } : null,
    pixelUse: "direction_and_sanity_check_only_unless_no_labeled_numeric_evidence_exists"
  };
}

function findEvidence(evidence, kind, phase) {
  return evidence.find((item) => item?.kind === kind && item?.phase === phase) ?? null;
}

function compactPoint(point) {
  if (!point) return null;
  return {
    x: finite(point.x),
    y: finite(point.y),
    relativeX: finite(point.relativeX),
    relativeY: finite(point.relativeY)
  };
}

function screenDirection(deltaX, deltaY) {
  if (deltaX === null || deltaY === null) return null;
  const horizontal = Math.abs(deltaX) < 2 ? "" : deltaX > 0 ? "right" : "left";
  const vertical = Math.abs(deltaY) < 2 ? "" : deltaY > 0 ? "down" : "up";
  return [vertical, horizontal].filter(Boolean).join("_") || "stationary";
}

function transformShortcut(text) {
  return ({ W: "move", E: "rotate", R: "scale" })[String(text ?? "").toUpperCase()] ?? null;
}

function detectTransformTool(action) {
  if (action?.action === "type_text" && !hasBlockingModifier(action.modifiers)) {
    const shortcut = transformShortcut(action.text);
    if (shortcut) return { tool: shortcut, source: `keyboard_${String(action.text).toUpperCase()}`, confidence: 1 };
  }
  const searchable = targetText(action?.target);
  if (/Select\s+and\s+Move|\bSelectAndMove\b/i.test(searchable))
    return { tool: "move", source: "ui_control", confidence: 0.98 };
  if (/Select\s+and\s+Rotate|\bSelectAndRotate\b/i.test(searchable))
    return { tool: "rotate", source: "ui_control", confidence: 0.98 };
  if (/Select\s+and\s+(?:Uniform\s+|Non-Uniform\s+|Squash\s+)?Scale|\bSelectAndScale\b/i.test(searchable))
    return { tool: "scale", source: "ui_control", confidence: 0.98 };
  return null;
}

function isPrimitiveCreationTarget(action) {
  const searchable = targetText(action?.target);
  return /\b(Box|Sphere|GeoSphere|Cylinder|Tube|Torus|Teapot|Plane|Cone|Pyramid|TextPlus)\b/i.test(searchable) &&
    /Create|Object Type|CreateButtonPanel/i.test(searchable);
}

function targetText(target) {
  if (!target) return "";
  return [
    target.name,
    target.automationId,
    target.className,
    ...(target.ancestors ?? []).flatMap((item) => [item.name, item.automationId, item.className])
  ].filter(Boolean).join(" ");
}

function hasBlockingModifier(modifiers) {
  return (modifiers ?? []).some((item) => /^(CTRL|ALT|WIN|META)$/i.test(String(item)));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
