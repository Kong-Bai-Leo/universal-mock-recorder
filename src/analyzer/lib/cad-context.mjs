export function buildCadEntityCatalog(plans) {
  const activeEntities = new Map();
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (plan?.cadProgram?.format !== "autocad_command_ir") continue;
    for (const operation of plan.cadProgram.operations ?? []) {
      // TRIM 会用新的线段/圆弧替换被修改实体。后续分段只能选择仍然存在的结果实体，
      // 不能继续引用已经被修剪掉的完整圆或原始线段。
      if (operation.semanticKind === "trim") {
        for (const sourceId of operation.visualInference?.sourceEntityIds ?? [])
          activeEntities.delete(sourceId);
      }
      for (const entityId of operation.resultEntityIds ?? []) {
        activeEntities.set(entityId, {
          entityId,
          createdByOperationId: operation.id,
          semanticKind: operation.semanticKind,
          command: operation.command,
          // 创建参数本身也能严格定义几何；不能因为 resultGeometry 为空就忘掉实体。
          arguments: operation.arguments ?? [],
          resultGeometry: (operation.resultGeometry ?? [])
            .filter((geometry) => geometry.id === entityId),
          confidence: operation.confidence
        });
      }
    }
  }
  return [...activeEntities.values()];
}
