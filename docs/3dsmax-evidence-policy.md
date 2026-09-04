# 3ds Max evidence policy (2026-09-03)

The recorder does not treat a left drag or a changed screenshot as proof of an
object transform. The model must classify each left drag in `dragAssessments`
before producing scene operations. Tool, selection level, XYZ meaning, input
mode, readable evidence, and persistent geometry change are separate facts.

- Whole-object Move/Rotate/Scale must use the matching transform field. Cursor
  coordinates and sub-object selection-center coordinates cannot move the object.
- Editable Poly face Bevel has a guarded `bevel_faces` backend (see below).
  Extrude/Inset and other unsupported sub-object edits are still recorded as
  incomplete, not converted to whole-object transforms.
- Unreadable evidence is allowed as an explicit incomplete result. Uploading an
  image does not prove the numbers are readable, and confidence is never raised
  just to pass validation.
- XYZ crops retain a wider status area; parameter crops retain the full panel
  height needed for sub-object tools. Analysis of old recordings attempts to
  recover these areas from the matching full before/after frames. Without those
  frames it preserves the original crop and cannot restore missing pixels.
- Before/after labels are roles, not timing guarantees. Input and screenshot
  timestamps are passed through. Region centers are not mouse-click coordinates.
- XYZ screenshot pairs are selected atomically. Failed file reads are not marked
  as uploaded evidence.
- Near-boundary Shift drags are moved together with detected Clone Options when
  the bounded action budget permits. Each next chunk also receives the previous
  eight actions and up to four context images within the existing image budget.
  This is a bounded continuity improvement, not a complete command-state parser.
- The last model result is retained inside the existing `analysis-error.json`
  after validation repair exhaustion; no extra error artifact is required.

Old checkpoints are invalidated by the new pipeline version. Reanalysis uses the
new policy; reopening the rebuilt recorder is required for wider *new* captures.
Offline tests and image inspection do not establish model/replay accuracy: that
still requires a paid analysis and a separate real 3ds Max replay validation.

## Logical face identities and Bevel

The screenshot-side [visual face tracker](3dsmax-visual-face-tracking.md) now adds
separate `vf-...` identities to analysis. These are not the runtime IDs below.

`convert_to_poly` creates a face catalog when the generated MAXScript runs.
Each face is a logical child of its original object, **not** a detached scene
node. For example, `c1-object-001:t1:f92` means object `c1-object-001`, topology
revision 1, polygon 92. The runtime `UMRFaceCatalogs` array contains object ID,
node, revision, face/vertex counts and per-face ID, index, local center, normal
and vertex indices. It lives in the replay session; no extra file is written.

Conversion starts at revision 1; an initially existing Editable Poly starts at
0. Bevel rebuilds the catalog and invalidates old face IDs. A cloned object has
its own namespace from revision 0; instance geometry changes refresh the known
instances too. Deleting an object removes its runtime catalog entry. This is
versioned identity, not a promise that face 92 is the same surface after edits.

The analyzer receives the object namespace and revision across chunks, **not**
the hidden runtime geometry. The screenshot-only recorder cannot enumerate
occluded faces or recover an existing mesh's exact topology. Reading an actual
source-scene face catalog during recording would require a separate, optional
3ds Max integration; this update does not add one.

Supported Bevel input:

- A collapsed Editable Poly with no modifier stack, one identified target.
- Prefer explicit Height/Outline. When absent, a declared, bounded
  [known-dimension visual estimate](3dsmax-bevel-approximation.md) is supported.
  Group/Local Normal/By Polygon mode must still be identified; Local Normal
  also needs its Bias. These are not the status bar's object XYZ values.
- An unambiguous local-axis extreme plane selector with exact selected-face
  count, or face indices with matching versioned IDs, total face/vertex counts
  and known local centers/normals. Screen top does not imply local +Z.
- Uploaded, event-associated evidence for selection, parameters and completion.
  Multi-stage height/outline input is one completed Bevel operation.

The renderer checks target type, selection count and optional topology/geometry
guards before editing. Wrong/stale indices fail rather than silently selecting
another face. It uses `polyop.setFaceSelection` and Editable Poly `bevelFaces`;
it does not substitute the unrelated spline Bevel modifier or Edit Poly modifier.
Values without either exact evidence or a supported scale reference remain incomplete. New captures preserve Bevel dialog fields and
pointer-local caddy candidates; old recordings cannot recover pixels never saved.

Official API references:

- [Editable Poly properties (Bevel type and bias)](https://help.autodesk.com/cloudhelp/2027/ENU/MAXScript-Help/files/3ds-Max-Objects-and-Interfaces/Editable-Meshes-Splines-Patches/Editable_Poly/GUID-0196A023-116F-47F8-99E9-AF3CB52F302C.html)
- [EditablePoly interface (bevelFaces)](https://help.autodesk.com/cloudhelp/2027/ENU/MAXScript-Help/files/3ds-Max-Objects-and-Interfaces/Editable-Meshes-Splines-Patches/Editable_Poly/GUID-90843EC5-AE3A-43EB-9406-A3631DAEADEF.html)

Offline checks: `node --test tests/*.test.mjs`.
Opt-in isolated runtime checks: `node scripts/test-3dsmax-bevel.mjs`.
The latter launches a separate, hidden 3ds Max batch session with synthetic
models, without loading a user scene or calling OpenAI. Set
`THREEDSMAX_BATCH_EXE` if 3ds Max is installed elsewhere.
