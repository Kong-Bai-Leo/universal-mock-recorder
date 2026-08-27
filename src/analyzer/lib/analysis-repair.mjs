export async function analyzeValidatedChunk({
  client,
  instructions,
  payload,
  screenshots,
  validate,
  maxValidationRepairs = 1
}) {
  let output = await client.analyze({ instructions, payload, screenshots });
  try {
    return { plan: validate(output), validationRepairs: 0 };
  } catch (firstError) {
    if (maxValidationRepairs < 1) throw firstError;
    const repairPayload = {
      ...payload,
      validationCorrection: {
        error: firstError.message,
        previousInvalidOutput: output,
        requirements: [
          "返回当前分段的完整替换 JSON，不要只返回补丁。",
          "严格修复本地校验错误；不得删除同段其他已有充分证据的 CAD operations。",
          "重新核对 candidateActions.cadInputEvidence 与 autoCadActionMacro 中的命令参数。",
          "重新核对 analysisHarness 的当前命令、阶段、选项解释，并返回与截图提示一致的 commandState。",
          "所有实体引用必须来自 previousChunkContext.cadEntityCatalog 或当前分段更早的 operation；不得根据 summary/warnings 创造幽灵实体 ID。",
          "若证据确实不足，移除无法验证的 operation、设置 cadProgram.complete=false 并写明 warning，禁止保留结构不完整的 operation。"
        ]
      }
    };
    output = await client.analyze({ instructions, payload: repairPayload, screenshots });
    try {
      return { plan: validate(output), validationRepairs: 1 };
    } catch (secondError) {
      throw new Error(
        `AI 输出第一次未通过本地校验：${firstError.message}；自动纠错后仍未通过：${secondError.message}`
      );
    }
  }
}
