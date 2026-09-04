import { geometryReferencesFromParts } from "./threedsmax-approximation.mjs";

// Face IDs are logical children, not detached scene nodes. Catalog geometry is
// computed only when the generated script executes; screenshots cannot expose
// hidden face data. Each topology-changing operation invalidates old face IDs.
export const FACE_CATALOG_MAXSCRIPT = [
  "  global UMRFaceCatalogs",
  "  UMRFaceCatalogs = #()",
  "  fn umrRecordFaces catalogs node objectId revision = (",
  "    local poly = node.baseObject",
  '    if classOf poly != Editable_Poly do throw "Face catalog requires Editable Poly"',
  "    local faces = for fi = 1 to (polyop.getNumFaces poly) collect (",
  '      local faceId = objectId + ":t" + (revision as string) + ":f" + (fi as string)',
  "      #(faceId, fi, polyop.getFaceCenter poly fi, polyop.getFaceNormal poly fi, polyop.getFaceVerts poly fi)",
  "    )",
  "    local entry = #(objectId, node, revision, polyop.getNumFaces poly, polyop.getNumVerts poly, faces)",
  "    local slot = findItem (for item in catalogs collect item[1]) objectId",
  "    if slot == 0 then append catalogs entry else catalogs[slot] = entry",
  "    entry",
  "  )",
  "  fn umrRefreshFaces catalogs node = (",
  "    local affected = for entry in catalogs where (isValidNode entry[2]) and (entry[2].baseObject == node.baseObject) collect #(entry[1], entry[2], entry[3] + 1)",
  "    for entry in affected do umrRecordFaces catalogs entry[2] entry[1] entry[3]",
  "  )"
];

export function buildThreeDsMaxObjectContext(parts) {
  const objects = new Map();
  const owners = new Map();
  for (const part of parts) {
    for (const object of part.maxProgram.initialObjects) {
      if (!objects.has(object.id)) {
        objects.set(object.id, { ...object, topologyRevision: /editable.?poly/i.test(object.className ?? "") ? 0 : null });
        owners.set(object.id, object.id);
      }
    }
    for (const op of part.maxProgram.operations) {
      op.resultObjectIds.forEach((id, index) => {
        const source = objects.get(op.targetObjectIds[index] ?? op.targetObjectIds[0]);
        objects.set(id, { id, name: op.objectName, className: op.className ?? source?.className ?? null,
          confidence: op.confidence, topologyRevision: op.kind === "clone_objects" && source?.topologyRevision != null ? 0 : null });
        const cloneType = op.parameters?.find((parameter) => parameter.name === "cloneType")?.value;
        owners.set(id, op.kind === "clone_objects" && /^(instance|reference)$/i.test(cloneType ?? "") ? owners.get(source?.id) ?? source?.id : id);
      });
      if (["convert_to_poly", "bevel_faces"].includes(op.kind)) for (const id of op.targetObjectIds) {
        for (const object of objects.values()) {
          if (object.id === id || op.kind === "bevel_faces" && owners.get(object.id) === owners.get(id)) {
            object.className = "Editable_Poly"; object.topologyRevision = (object.topologyRevision ?? 0) + 1;
          }
        }
      }
      if (op.kind === "delete_objects") for (const id of op.targetObjectIds) objects.delete(id);
    }
  }
  const geometryReferences = geometryReferencesFromParts(parts);
  return [...objects.values()].map((object) => ({ ...object,
    geometryReferences: geometryReferences.filter((ref) => ref.objectId === object.id),
    faceCatalog: object.topologyRevision == null ? null : {
      faceIdPattern: `${object.id}:t${object.topologyRevision}:f<1-based-index>`,
      geometryAvailableToAnalysis: false,
      policy: "Runtime-only face catalog; do not invent unseen faces or reuse IDs after topology changes."
    }
  }));
}
