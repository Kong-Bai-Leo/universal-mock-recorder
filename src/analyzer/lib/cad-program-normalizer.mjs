export function normalizeAuditedCadProgram(program) {
  if (program?.format !== "autocad_command_ir" || !Array.isArray(program.operations))
    return { program, changed: false, findings: [] };
  const normalized = JSON.parse(JSON.stringify(program));
  const ordered = orderOperations(normalized.operations);
  normalized.operations = ordered.operations;
  const rewired = rewireUnambiguousLineage(normalized.operations);
  const findings = [];
  if (ordered.changed)
    findings.push("本地按录制事件和实体依赖重新排列了最终审计返回的 CAD 操作。");
  if (rewired.length > 0) {
    findings.push(`本地按唯一实体血缘修复了 ${rewired.length} 处旧实体引用：` +
      rewired.map((item) => `${item.operationId}:${item.from}->${item.to}`).join("，"));
  }
  return {
    program: normalized,
    changed: ordered.changed || rewired.length > 0,
    findings
  };
}

function orderOperations(operations) {
  const producers = new Map();
  operations.forEach((operation, index) => {
    for (const entityId of operation.resultEntityIds ?? []) producers.set(entityId, index);
  });
  const dependencies = operations.map(() => new Set());
  const dependents = operations.map(() => []);
  operations.forEach((operation, index) => {
    for (const referenceId of operationReferenceIds(operation)) {
      const producerIndex = producers.get(referenceId);
      if (producerIndex === undefined || producerIndex === index || dependencies[index].has(producerIndex))
        continue;
      dependencies[index].add(producerIndex);
      dependents[producerIndex].push(index);
    }
  });

  const ready = operations.map((_, index) => index)
    .filter((index) => dependencies[index].size === 0);
  const orderedIndexes = [];
  while (ready.length > 0) {
    ready.sort((left, right) => compareOperationPriority(
      operations[left], left, operations[right], right));
    const index = ready.shift();
    orderedIndexes.push(index);
    for (const dependent of dependents[index]) {
      dependencies[dependent].delete(index);
      if (dependencies[dependent].size === 0) ready.push(dependent);
    }
  }
  if (orderedIndexes.length < operations.length) {
    const remaining = operations.map((_, index) => index)
      .filter((index) => !orderedIndexes.includes(index))
      .sort((left, right) => compareOperationPriority(
        operations[left], left, operations[right], right));
    orderedIndexes.push(...remaining);
  }
  const changed = orderedIndexes.some((sourceIndex, targetIndex) => sourceIndex !== targetIndex);
  return { operations: orderedIndexes.map((index) => operations[index]), changed };
}

function compareOperationPriority(left, leftIndex, right, rightIndex) {
  const leftEvent = firstEvidenceOrdinal(left);
  const rightEvent = firstEvidenceOrdinal(right);
  if (leftEvent !== rightEvent) return leftEvent - rightEvent;
  const leftChunk = operationChunkOrdinal(left);
  const rightChunk = operationChunkOrdinal(right);
  if (leftChunk !== rightChunk) return leftChunk - rightChunk;
  return leftIndex - rightIndex;
}

function firstEvidenceOrdinal(operation) {
  const values = [
    ...(operation.sourceEventIds ?? []),
    ...(operation.sourceScreenshots ?? [])
  ].map((value) => /evt-(\d+)/i.exec(String(value))?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : Number.MAX_SAFE_INTEGER;
}

function operationChunkOrdinal(operation) {
  const match = /^c(\d+)-/i.exec(String(operation?.id ?? ""));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function rewireUnambiguousLineage(operations) {
  const available = new Set();
  const successor = new Map();
  const rewrites = [];
  for (const operation of operations) {
    rewriteOperationReferences(operation, (entityId) => {
      if (available.has(entityId)) return entityId;
      const resolved = resolveUniqueSuccessor(entityId, successor, available);
      if (!resolved || resolved === entityId) return entityId;
      rewrites.push({ operationId: operation.id, from: entityId, to: resolved });
      return resolved;
    });

    if (isReplacementOperation(operation)) {
      const sources = replacementSourceIds(operation);
      for (const sourceId of sources) {
        const replacements = unique((operation.resultGeometry ?? [])
          .filter((geometry) => (geometry.sourceEntityIds ?? []).includes(sourceId))
          .map((geometry) => geometry.id));
        available.delete(sourceId);
        successor.set(sourceId, replacements.length === 1 ? replacements[0] : null);
      }
    }
    for (const resultId of operation.resultEntityIds ?? []) available.add(resultId);
  }
  return uniqueRewrites(rewrites);
}

function rewriteOperationReferences(operation, resolve) {
  for (const argument of operation.arguments ?? []) {
    if (argument.point)
      argument.point.referenceEntityIds = (argument.point.referenceEntityIds ?? []).map(resolve);
    if (argument.selection)
      argument.selection.entityIds = (argument.selection.entityIds ?? []).map(resolve);
  }
  if (operation.visualInference) {
    operation.visualInference.sourceEntityIds =
      (operation.visualInference.sourceEntityIds ?? []).map(resolve);
    operation.visualInference.referenceEntityIds =
      (operation.visualInference.referenceEntityIds ?? []).map(resolve);
  }
  for (const geometry of operation.resultGeometry ?? []) {
    geometry.sourceEntityIds = (geometry.sourceEntityIds ?? []).map(resolve);
    if (geometry.center)
      geometry.center.referenceEntityIds = (geometry.center.referenceEntityIds ?? []).map(resolve);
    for (const point of geometry.points ?? [])
      point.referenceEntityIds = (point.referenceEntityIds ?? []).map(resolve);
  }
}

function resolveUniqueSuccessor(entityId, successor, available) {
  const visited = new Set();
  let current = entityId;
  while (successor.has(current) && !visited.has(current)) {
    visited.add(current);
    current = successor.get(current);
    if (!current) return null;
    if (available.has(current)) return current;
  }
  return available.has(current) ? current : null;
}

function operationReferenceIds(operation) {
  const result = [];
  for (const argument of operation.arguments ?? []) {
    result.push(...(argument.point?.referenceEntityIds ?? []));
    result.push(...(argument.selection?.entityIds ?? []));
  }
  result.push(...(operation.visualInference?.sourceEntityIds ?? []));
  result.push(...(operation.visualInference?.referenceEntityIds ?? []));
  for (const geometry of operation.resultGeometry ?? []) {
    result.push(...(geometry.sourceEntityIds ?? []));
    result.push(...(geometry.center?.referenceEntityIds ?? []));
    for (const point of geometry.points ?? [])
      result.push(...(point.referenceEntityIds ?? []));
  }
  return unique(result);
}

function isReplacementOperation(operation) {
  const command = String(operation?.command ?? "").trim().toUpperCase();
  if (command === "ROTATE" && operation.arguments?.some((argument) =>
    argument.kind === "keyword" &&
    (/copy/i.test(String(argument.name ?? "")) || /copy/i.test(String(argument.text ?? ""))))) return false;
  return [
    "MOVE", "ROTATE", "SCALE", "STRETCH", "FILLET", "CHAMFER",
    "TRIM", "EXTEND", "BREAK"
  ].includes(command) || ["trim", "fillet"].includes(operation.semanticKind);
}

function replacementSourceIds(operation) {
  return unique([
    ...(operation.visualInference?.sourceEntityIds ?? []),
    ...(operation.resultGeometry ?? []).flatMap((geometry) => geometry.sourceEntityIds ?? [])
  ]);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueRewrites(rewrites) {
  const seen = new Set();
  return rewrites.filter((item) => {
    const key = `${item.operationId}:${item.from}:${item.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
