import { interactiveSessionImageGroups } from "./threedsmax-interactions.mjs";

// Screenshot-space face identities. Never a source of MAXScript polygon indices
// or exact scene dimensions. Model detections are proposals; this module owns IDs.
const stringList = { type: "array", items: { type: "string" } };
const nullableString = { type: ["string", "null"] };
const point2 = { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 };
export const VISUAL_FACE_FRAMES_SCHEMA = {
  type: "array", maxItems: 16, items: {
    type: "object", additionalProperties: false,
    properties: {
      frameId: { type: "string" }, comparedToFrameId: nullableString,
      viewport: { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
      view: { type: "string" },
      change: { type: "string", enum: ["baseline", "stable", "view_change", "object_transform", "topology_edit", "unknown"] },
      editCompleted: { type: "boolean" }, sourceEventIds: stringList, objectIds: stringList,
      coverage: { type: "string", enum: ["complete_visible", "focused", "unreadable"] },
      faces: { type: "array", maxItems: 64, items: {
        type: "object", additionalProperties: false,
        properties: {
          observationId: { type: "string" }, objectId: { type: "string" },
          polygon: { type: "array", items: point2, minItems: 3, maxItems: 16 },
          visibility: { type: "string", enum: ["visible", "partial"] },
          relation: { type: "string", enum: ["first_seen", "same", "created", "uncertain"] },
          matchRef: nullableString, parentRefs: stringList, neighborRefs: stringList,
          matchBasis: { type: "string", enum: ["none", "contour", "neighbors", "distinctive_feature"] },
          selected: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 },
          description: { type: "string" }
        },
        required: ["observationId", "objectId", "polygon", "visibility", "relation", "matchRef", "parentRefs", "neighborRefs", "matchBasis", "selected", "confidence", "description"]
      } },
      retiredRefs: stringList, reason: { type: "string" }
    },
    required: ["frameId", "comparedToFrameId", "viewport", "view", "change", "editCompleted", "sourceEventIds", "objectIds", "coverage", "faces", "retiredRefs", "reason"]
  }
};

export function visualFaceLimits(options = {}) {
  const bounded = (value, fallback, max) => Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
  return { maxFrames: bounded(options.maxFrames, 6, 16), maxFacesPerFrame: bounded(options.maxFacesPerFrame, 12, 64),
    maxContextTracks: bounded(options.maxContextTracks, 32, 128) };
}

export function emptyVisualFaceState() {
  return { version: 1, nextId: 1, tracks: [], frames: [], issues: [], coverage: "not_analyzed" };
}

// Checkpoints store deltas, not another copy of the entire recording in each part.
export function mergeVisualFaceTracking(parts) {
  const state = emptyVisualFaceState();
  const tracks = new Map();
  for (const part of parts ?? []) {
    const delta = part.visualFaceTracking;
    if (!delta) continue;
    for (const track of delta.updates ?? []) tracks.set(track.id, track);
    state.frames.push(...(delta.frames ?? []));
    state.issues.push(...(delta.issues ?? []));
    state.nextId = Math.max(state.nextId, delta.nextId ?? 1);
  }
  state.tracks = [...tracks.values()];
  state.coverage = state.frames.length ? "sampled_visible_faces_only" : "not_analyzed";
  return state;
}

export function visualFaceContext(state, options = {}) {
  const limit = visualFaceLimits(options).maxContextTracks;
  const eligible = state.tracks.filter((t) => t.status !== "retired");
  const tracks = [...eligible].sort((a, b) => b.lastSeen.order - a.lastSeen.order).slice(0, limit);
  return { version: 1, omittedTrackCount: eligible.length - tracks.length,
    policy: "visualFaceId is screenshot identity, never a runtime face index; absent/hidden faces are not deleted",
    tracks: tracks.map(({ lastSeen, ...track }) => ({ ...track, lastSeen })) };
}

export function visualFaceContextScreenshots(state, maximum = 1) {
  return [...new Set([...state.tracks].filter((t) => t.status !== "retired")
    .sort((a, b) => b.lastSeen.order - a.lastSeen.order).map((t) => t.lastSeen.screenshot))].slice(0, maximum);
}

// Reserve bounded before/after *full canvas* evidence without raising the overall
// upload budget. Parameter/XYZ crops cannot localize a polygon in a viewport.
export function visualFacePriorityScreenshots(actions, maximum = 6) {
  if (maximum < 2) return [];
  const reserved = [];
  for (const group of interactiveSessionImageGroups(actions)) {
    const newNames = group.screenshots.filter((name) => !reserved.includes(name));
    if (reserved.length + newNames.length <= maximum) reserved.push(...newNames);
  }
  const candidates = actions.map((action, index) => {
    const kinds = action.transformEvidence?.map((e) => e.kind) ?? [];
    const explicit = /poly|bevel|extrude|inset|chamfer/i.test(JSON.stringify(action.target ?? {})) ||
      /subobject/.test(action.threeDsMaxTransformContext?.interactionMode ?? action.transformHarness?.interactionMode ?? "") ||
      kinds.includes("subobject_parameters");
    const previous = actions[index-1];
    const leftDrag = action.action === "drag" && action.button === "left";
    const completion = action.action === "click" && action.button === "left" && previous?.action === "drag" && previous.button === "left";
    const recentMenu = actions.slice(Math.max(0,index-3),index).some((a) => a.action === "right_click");
    const score = (explicit ? 30 : 0) + (leftDrag ? action.visualChange?.changed === false ? 3 : 10 : 0) + (completion ? 9 : 0) +
      (action.visualChange?.changed ? 5 : 0) + (recentMenu ? 4 : 0);
    return { action, index, score };
  }).filter(({action,score}) => score > 0 && action.screenshotBefore && action.screenshotAfter)
    .sort((a,b) => b.score - a.score || a.index - b.index);
  for (const { action } of candidates) {
    const names = [action.screenshotBefore, action.screenshotAfter].filter((name) => !reserved.includes(name));
    if (reserved.length + names.length <= maximum) reserved.push(...names);
  }
  return reserved;
}

export function buildVisualFaceInput(screenshots, actions, state, chunkIndex, options = {}) {
  const limits = visualFaceLimits(options);
  const priorFrames = new Map(state.frames.map((f) => [f.screenshot, f]));
  const byName = new Map(screenshots.map((s) => [s.logicalScreenshot, s]));
  const candidates = [];
  const seen = new Set();
  const latestOrder = Math.max(-Infinity, ...state.frames.map((f) => f.order));
  let excludedHistoryCount = 0;
  actions.forEach((action, actionIndex) => {
    for (const phase of ["before", "after"]) {
      const name = phase === "before" ? action.screenshotBefore : action.screenshotAfter;
      const image = byName.get(name);
      if (!image || seen.has(name) || /3dsmax_transform_/.test(image.evidenceRole ?? "")) continue;
      seen.add(name);
      const prior = priorFrames.get(name);
      const timestamp = phase === "before" ? action.screenshotBeforeTimestampMs : action.screenshotAfterTimestampMs;
      const inputTime = phase === "before" ? action.startMs : action.endMs;
      const observedTime = Number.isFinite(timestamp) ? timestamp : Number.isFinite(inputTime) ? inputTime : null;
      // Actual capture time takes precedence over before/after roles. Raw tails
      // may include older images not previously selected: don't rewind the ledger.
      const order = observedTime ?? chunkIndex * 1000000000 + actionIndex * 2 + (phase === "after" ? 1 : 0);
      if (!prior && order <= latestOrder) { excludedHistoryCount++; continue; }
      candidates.push({ id: prior?.frameId ?? `vf-frame-c${chunkIndex}-${candidates.length + 1}`, screenshot: name,
        label: image.label, phase, historical: Boolean(prior),
        timestampMs: Number.isFinite(timestamp) ? timestamp : null,
        inputTimeMs: inputTime ?? null,
        order: prior?.order ?? order,
        sourceEventIds: action.sourceEventIds ?? [], imageMapping: image.imageMapping ?? null });
    }
  });
  // An older matching image may lie outside rawActionTail; retain its actual
  // metadata only if that same full image was uploaded again.
  for (const [name, previous] of priorFrames) if (byName.has(name) && !seen.has(name)) {
    const image = byName.get(name);
    candidates.push({ id: previous.frameId, screenshot: name, label: image.label, historical: true,
      phase: previous.phase, timestampMs: previous.timestampMs, inputTimeMs: previous.inputTimeMs,
      order: previous.order, sourceEventIds: previous.sourceEventIds, imageMapping: image.imageMapping ?? null });
  }
  const fresh = candidates.filter((f) => !f.historical).sort((a,b) => a.order - b.order);
  const priorityNames = visualFacePriorityScreenshots(actions, limits.maxFrames);
  const sample = fresh.filter((f) => priorityNames.includes(f.screenshot)).slice(0, limits.maxFrames);
  const remaining = fresh.filter((f) => !sample.includes(f));
  const slots = Math.min(limits.maxFrames - sample.length, remaining.length);
  sample.push(...(slots === 1 ? [remaining.at(-1)] : Array.from({ length: slots }, (_, i) =>
    remaining[Math.round(i * (remaining.length - 1) / (slots - 1))])));
  return { enabled: true, version: 1, limits, coordinateSpace: "normalized_uploaded_image_0_to_1",
    frames: [...candidates.filter((f) => f.historical), ...sample].sort((a, b) => a.order - b.order),
    excludedFrameCount: fresh.length - sample.length, excludedHistoryCount,
    context: visualFaceContext(state, options) };
}

// Soft-fail tracking proposals: missing outlines must not discard a valid scene
// program or cause a paid repair loop. Every rejected/downgraded claim is retained.
export function trackVisualFaces(previous, reports, payload, analysis) {
  const input = payload.visualFaceInput;
  const delta = { version: 1, nextId: previous.nextId, updates: [], frames: [], issues: [] };
  if (!input?.enabled) return delta;
  const issues = delta.issues;
  const issue = (frameId, observationId, code) => issues.push({ frameId, observationId, code });
  const tracks = new Map(previous.tracks.map((t) => [t.id, structuredClone(t)]));
  const changed = new Set();
  const aliases = new Map(previous.frames.flatMap((f) => f.observations.map((o) => [o.observationId, o.visualFaceId])));
  const available = new Map(input.frames.map((f) => [f.id, f]));
  const observedFrames = new Map(previous.frames.map((f) => [f.frameId, f]));
  const knownObjects = new Set([
    ...(payload.previousContext?.knownObjects ?? []).map((o) => o.id),
    ...analysis.maxProgram.initialObjects.map((o) => o.id),
    ...analysis.maxProgram.operations.flatMap((o) => o.resultObjectIds)
  ]);
  const actions = [...(payload.previousContext?.rawActionTail ?? []), ...(payload.actions ?? [])];
  const reportIds = new Set();
  const raw = Array.isArray(reports) ? reports : [];
  if (!Array.isArray(reports)) issue(null, null, "invalid_frame_reports");
  for (const report of [...raw].sort((a, b) => (available.get(a?.frameId)?.order ?? Infinity) - (available.get(b?.frameId)?.order ?? Infinity))) {
    const frame = available.get(report?.frameId);
    if (!frame || frame.historical || reportIds.has(frame.id)) { issue(report?.frameId ?? null, null, "unknown_historical_or_duplicate_frame"); continue; }
    reportIds.add(frame.id);
    if (!validFrame(report, input.limits) || report.objectIds.some((id) => !knownObjects.has(id)) ||
        report.sourceEventIds.some((id) => !actions.some((a) => a.sourceEventIds?.includes(id))) ||
        !report.sourceEventIds.some((id) => frame.sourceEventIds.includes(id))) {
      issue(frame.id, null, "invalid_viewport_object_or_event"); continue;
    }
    const before = observedFrames.get(report.comparedToFrameId);
    const ordered = before && before.order < frame.order && available.has(before.frameId) &&
      !(Number.isFinite(before.timestampMs) && Number.isFinite(frame.timestampMs) && before.timestampMs >= frame.timestampMs);
    const navigation = ordered && navigationBetween(actions, before, frame);
    const comparable = ordered && sameViewport(before, report) && !navigation;
    const stable = comparable && report.change === "stable" && !modificationBetween(analysis, actions, before, frame);
    const edit = comparable && report.change === "topology_edit" && report.editCompleted && frame.phase === "after";
    const reportFrame = { frameId: frame.id, screenshot: frame.screenshot, phase: frame.phase,
      order: frame.order, timestampMs: frame.timestampMs, inputTimeMs: frame.inputTimeMs,
      sourceEventIds: frame.sourceEventIds, viewport: report.viewport, view: report.view,
      comparedToFrameId: ordered ? before.frameId : null, change: navigation ? "view_change" : report.change,
      coverage: report.coverage, reason: report.reason, observations: [] };
    const initialTracks = [...tracks.values()];
    const initialById = new Map(initialTracks.map((t) => [t.id, structuredClone(t)]));
    const resolve = (ref, objectId) => {
      const track = tracks.get(aliases.get(ref) ?? ref);
      return track && track.objectId === objectId && track.status !== "retired" ? track : null;
    };
    const valid = [];
    const seenObservations = new Set();
    for (const face of report.faces) {
      if (!validFace(face, report) || aliases.has(face.observationId) || seenObservations.has(face.observationId)) {
        issue(frame.id, face?.observationId ?? null, "invalid_or_duplicate_face_observation"); continue;
      }
      seenObservations.add(face.observationId);
      const proposal = { face, match: null, candidates: [] };
      if (face.relation === "same") {
        const target = resolve(face.matchRef, face.objectId);
        const priorUploaded = target && input.frames.some((f) => f.screenshot === target.lastSeen.screenshot);
        const overlap = target && stable && target.lastSeen.frameId === before.frameId ? polygonIoU(face.polygon, target.lastSeen.polygon) : 0;
        const neighborSupport = target && face.neighborRefs.some((ref) => target.neighborIds.includes(resolve(ref, face.objectId)?.id));
        const distinctive = face.matchBasis === "distinctive_feature" || face.matchBasis === "neighbors" && neighborSupport;
        if (target && ordered && priorUploaded && face.confidence >= 0.85 && (overlap >= 0.8 || distinctive && face.confidence >= 0.92)) proposal.match = target.id;
        else { if (target) proposal.candidates.push(target.id); issue(frame.id, face.observationId, "unverified_reidentification"); }
      } else if (face.relation === "uncertain") {
        const target = resolve(face.matchRef, face.objectId);
        if (target) proposal.candidates.push(target.id);
      } else if (face.relation === "first_seen" && stable && face.confidence >= 0.85) {
        const ranked = initialTracks.filter((t) => t.objectId === face.objectId && t.status !== "retired" && t.lastSeen.frameId === before.frameId)
          .map((t) => ({ id: t.id, score: polygonIoU(face.polygon, t.lastSeen.polygon) })).filter((t) => t.score >= 0.5).sort((a, b) => b.score - a.score);
        proposal.candidates = ranked.map((t) => t.id);
        if (ranked[0]?.score >= 0.8 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.15) proposal.match = ranked[0].id;
      }
      valid.push(proposal);
    }
    // One-to-one matching: never let detection order decide which of two faces
    // inherits the same old identity.
    const claimed = new Map();
    for (const p of valid) if (p.match) claimed.set(p.match, (claimed.get(p.match) ?? 0) + 1);
    const used = new Set();
    for (const p of valid) {
      const face = p.face;
      if (p.match && claimed.get(p.match) > 1) { p.candidates.push(p.match); p.match = null; issue(frame.id, face.observationId, "ambiguous_many_to_one"); }
      const parents = face.parentRefs.map((ref) => initialById.get(aliases.get(ref) ?? ref))
        .map((t) => t && t.objectId === face.objectId && t.status !== "retired" ? t : null);
      const canCreate = face.relation === "created" && edit && hasCompletedEdit(analysis, report, face.objectId) &&
        parents.length > 0 && parents.every((t) => t && t.lastSeen.order < frame.order) && face.confidence >= 0.85;
      if (face.relation === "created" && !canCreate) issue(frame.id, face.observationId, "new_face_not_proven_by_completed_edit");
      const candidate = !p.match && (p.candidates.length > 0 || ["same", "uncertain", "created"].includes(face.relation) && !canCreate || face.confidence < 0.85);
      const origin = canCreate ? "created_by_edit" : navigation || report.change === "view_change" ? "newly_visible" : "first_seen";
      const id = p.match ?? `vf-${String(delta.nextId++).padStart(6, "0")}`;
      const mapped = mapVisualPolygon(face.polygon, frame.imageMapping);
      const observation = { observationId: face.observationId, visualFaceId: id, objectId: face.objectId,
        relation: p.match ? "matched" : canCreate ? "created" : candidate ? "candidate" : origin,
        polygon: face.polygon, sourcePolygon: mapped.normalized, sourcePixelPolygon: mapped.pixels,
        visibility: face.visibility, selected: face.selected, confidence: candidate ? Math.min(face.confidence, 0.49) : face.confidence,
        candidateIds: [...new Set(p.candidates.filter((c) => c !== p.match))], description: face.description };
      const lastSeen = { frameId: frame.id, screenshot: frame.screenshot, order: frame.order, timestampMs: frame.timestampMs,
        viewport: report.viewport, view: report.view, polygon: face.polygon, sourcePolygon: mapped.normalized,
        description: face.description };
      const track = p.match ? tracks.get(p.match) : { id, objectId: face.objectId, origin,
        identity: candidate ? "candidate" : "tracked", firstSeen: { frameId: frame.id, timestampMs: frame.timestampMs },
        parentIds: canCreate ? parents.map((t) => t.id) : [], createdByEventIds: canCreate ? report.sourceEventIds : [], neighborIds: [],
        runtimeFaceId: null };
      if (track.identity === "candidate") observation.confidence = Math.min(observation.confidence, 0.49);
      Object.assign(track, { status: "visible", lastSeen, confidence: observation.confidence, candidateIds: observation.candidateIds });
      tracks.set(id, track); changed.add(id); aliases.set(face.observationId, id); used.add(id);
      reportFrame.observations.push(observation);
    }
    for (const p of valid) {
      const id = aliases.get(p.face.observationId);
      const track = tracks.get(id);
      track.neighborIds = [...new Set(p.face.neighborRefs.map((ref) => resolve(ref, p.face.objectId)?.id).filter((n) => n && n !== id))];
    }
    for (const old of initialTracks) if (!used.has(old.id) && old.status !== "retired" && report.objectIds.includes(old.objectId)) {
      tracks.get(old.id).status = "not_observed"; changed.add(old.id);
    }
    for (const ref of report.retiredRefs) {
      const old = tracks.get(aliases.get(ref) ?? ref);
      const hasChild = [...tracks.values()].some((t) => t.lastSeen.frameId === frame.id && t.parentIds.includes(old?.id));
      if (!old || used.has(old.id) || !edit || !hasChild || !hasCompletedEdit(analysis, report, old.objectId)) {
        issue(frame.id, null, "unproven_retirement"); continue;
      }
      old.status = "retired"; old.retiredAtFrameId = frame.id; changed.add(old.id);
    }
    observedFrames.set(frame.id, reportFrame); delta.frames.push(reportFrame);
  }
  for (const frame of input.frames.filter((f) => !f.historical)) if (!observedFrames.has(frame.id)) issue(frame.id, null, "frame_not_analyzed");
  if (input.excludedFrameCount > 0) issue(null, null, "frame_budget_excluded_images");
  if (input.excludedHistoryCount > 0) issue(null, null, "older_untracked_frames_not_replayed");
  for (const op of analysis.maxProgram.operations) if (op.kind === "delete_objects") {
    for (const track of tracks.values()) if (op.targetObjectIds.includes(track.objectId)) {
      track.status = "retired"; track.retirementReason = "owning_object_deleted";
      track.retiredByEventIds = op.sourceEventIds; changed.add(track.id);
    }
  }
  delta.updates = [...changed].map((id) => tracks.get(id));
  return delta;
}

function validFrame(r, limits) {
  return rect(r.viewport) && typeof r.view === "string" && r.view.length > 0 &&
    ["baseline", "stable", "view_change", "object_transform", "topology_edit", "unknown"].includes(r.change) &&
    typeof r.editCompleted === "boolean" && strings(r.sourceEventIds) && r.sourceEventIds.length > 0 && strings(r.objectIds) &&
    ["complete_visible", "focused", "unreadable"].includes(r.coverage) && Array.isArray(r.faces) &&
    r.faces.length <= limits.maxFacesPerFrame && strings(r.retiredRefs) && typeof r.reason === "string";
}
function validFace(f, frame) {
  return f && typeof f.observationId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(f.observationId) && !/^vf-/.test(f.observationId) &&
    frame.objectIds.includes(f.objectId) && validPolygon(f.polygon) && f.polygon.every(([x, y]) =>
      x >= frame.viewport[0] && y >= frame.viewport[1] && x <= frame.viewport[0] + frame.viewport[2] && y <= frame.viewport[1] + frame.viewport[3]) &&
    ["visible", "partial"].includes(f.visibility) && ["first_seen", "same", "created", "uncertain"].includes(f.relation) &&
    (f.matchRef === null || typeof f.matchRef === "string") && strings(f.parentRefs) && strings(f.neighborRefs) &&
    ["none", "contour", "neighbors", "distinctive_feature"].includes(f.matchBasis) && typeof f.selected === "boolean" &&
    Number.isFinite(f.confidence) && f.confidence >= 0 && f.confidence <= 1 && typeof f.description === "string";
}
const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === "string" && s.length > 0);
const unit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const rect = (a) => Array.isArray(a) && a.length === 4 && a.every(unit) && a[2] > 0 && a[3] > 0 && a[0] + a[2] <= 1.000001 && a[1] + a[3] <= 1.000001;
function validPolygon(p) {
  if (!Array.isArray(p) || p.length < 3 || p.length > 16 || !p.every((v) => Array.isArray(v) && v.length === 2 && v.every(unit))) return false;
  for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
    if (i === 0 && j === p.length - 1) continue;
    const a = p[i], b = p[(i+1)%p.length], c = p[j], d = p[(j+1)%p.length];
    const cross = (u,v,w) => (v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
    if (cross(a,b,c)*cross(a,b,d) < -1e-12 && cross(c,d,a)*cross(c,d,b) < -1e-12) return false;
  }
  return polygonArea(p) > 0.000001;
}
function polygonArea(p) {
  return Math.abs(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
}
function sameViewport(before, after) {
  return !/^(unknown|unsure|未知)$/i.test(before.view) && before.view.toLowerCase() === after.view.toLowerCase() &&
    before.viewport.every((v, i) => Math.abs(v - after.viewport[i]) <= 0.005);
}
function betweenActions(actions, before, after) {
  const start = before.timestampMs ?? before.inputTimeMs;
  const end = after.timestampMs ?? after.inputTimeMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return actions; // No timing: conservative, not silent continuity.
  return actions.filter((a) => (a.endMs ?? Infinity) > start && (a.startMs ?? -Infinity) <= end);
}
function navigationBetween(actions, before, after) {
  return betweenActions(actions, before, after).some((a) => a.action === "scroll" ||
    a.action === "drag" && ["middle", "right"].includes(a.button) ||
    /^(type_text|press_key)$/.test(a.action) && /^(T|B|F|L|P|U|Z)$/i.test(a.text ?? a.key ?? "") ||
    /\b(orbit|zoom|pan view|viewcube)\b/i.test(JSON.stringify(a.target ?? {})) ||
    /viewport_navigation/.test(a.transformHarness?.interactionState ?? ""));
}
function modificationBetween(analysis, actions, before, after) {
  const ids = new Set(betweenActions(actions, before, after).flatMap((a) => a.sourceEventIds ?? []));
  return analysis.maxProgram.operations.some((op) => !["select_objects"].includes(op.kind) && op.sourceEventIds.some((id) => ids.has(id))) ||
    analysis.dragAssessments?.some((a) => a.persistentChange && ["object_transform", "clone_transform", "subobject_edit"].includes(a.category) && a.sourceEventIds.some((id) => ids.has(id)));
}
function hasCompletedEdit(analysis, frame, objectId) {
  const related = (item) => item.sourceEventIds.some((id) => frame.sourceEventIds.includes(id));
  return analysis.maxProgram.operations.some((o) => o.kind === "bevel_faces" && o.targetObjectIds.includes(objectId) && related(o)) ||
    analysis.dragAssessments?.some((a) => related(a) && a.category === "subobject_edit" && a.persistentChange === true &&
      /\b(bevel|extrude|inset|chamfer|cut|slice|bridge|weld|connect)\b/i.test(a.activeTool ?? ""));
}

export function mapVisualPolygon(polygon, mapping) {
  const source = mapping?.sourceSize; const crop = mapping?.cropRect;
  if (!source || !crop || ![source.width, source.height, crop.width, crop.height].every((n) => Number.isFinite(n) && n > 0) ||
    ![crop.x, crop.y].every(Number.isFinite)) return { normalized: null, pixels: null };
  const pixels = polygon.map(([x, y]) => [crop.x + x * crop.width, crop.y + y * crop.height]);
  if (pixels.some(([x,y]) => x < 0 || y < 0 || x > source.width || y > source.height)) return { normalized: null, pixels: null };
  return { pixels, normalized: pixels.map(([x, y]) => [x / source.width, y / source.height]) };
}

// Bounded rasterized polygon IoU, not merely bounding-box overlap. Used only in
// a proven unchanged viewport; it is never converted into CAD/3D distances.
export function polygonIoU(a, b) {
  if (!validPolygon(a) || !validPolygon(b)) return 0;
  const all = [...a, ...b];
  const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX; const h = Math.max(...ys) - minY;
  let intersection = 0; let union = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const point = [minX + (x + 0.5) * w / 32, minY + (y + 0.5) * h / 32];
    const inA = inside(point, a); const inB = inside(point, b);
    if (inA || inB) union++;
    if (inA && inB) intersection++;
  }
  return union ? intersection / union : 0;
}
function inside([x, y], polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}
