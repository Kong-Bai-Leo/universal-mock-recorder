export function renderComputerUseTask(plan) {
  const steps = (plan.steps ?? []).map((step) => {
    const change = step.canvasChange ?? {};
    const gesture = step.gesture
      ? `；拖拽 ${formatPoint(step.gesture.fromRelative)} → ${formatPoint(step.gesture.toRelative)}`
      : "";
    const screenshots = [change.beforeScreenshot, change.afterScreenshot]
      .filter(Boolean)
      .map(formatScreenshotPath)
      .join(" → ") || "无";
    const measurements = (change.measurements ?? [])
      .map((item) => `${item.name}=${item.value}${item.unit}`)
      .join("，") || "无";
    return `${step.id}. ${step.goal}（${step.action}${gesture}）\n` +
      `   - 目标：${step.target?.visualDescription ?? step.target?.semanticFunction ?? "按语义和视觉定位"}\n` +
      `   - 画布变化：${change.changeType ?? "unknown"}；${change.objectDescription ?? "未说明"}\n` +
      `   - 参考截图：${screenshots}\n` +
      `   - 测量：${measurements}\n` +
      `   - 验证：${step.expectedState?.visualDescription ?? step.expectedState?.stateChange ?? "确认界面状态发生预期变化"}`;
  }).join("\n\n");

  return `# Computer Use Agent 复现任务\n\n` +
    `## 目标\n\n${plan.summary}\n\n` +
    `## 输入\n\n` +
    `- 完整结构化流程：\`semantic-trace.json\`\n` +
    `- 可执行 TypeScript 描述：\`mock-script.ts\`\n` +
    `- 原录制参考截图：\`../screenshots/\`\n` +
    `- 目标 Mock 软件入口：由执行者提供并确保可重置到初始状态\n\n` +
    `## 执行规则\n\n` +
    `1. 使用 Computer Use 操作目标 Mock，不调用被录制软件的专用接口。\n` +
    `2. 按语义功能、无障碍信息、文字、视觉、相对位置的顺序定位控件。\n` +
    `3. 每步后截图，并与 canvasChange 和参考截图核对；不满足预期时先 Escape，必要时 Undo，再重试候选目标。\n` +
    `4. drag 必须使用 gesture 的起点、终点和路径；位置均相对目标窗口归一化。\n` +
    `5. measurements 是几何验收值；业务单位不可见时只比较 px 或 window_ratio。\n` +
    `6. 不执行 omitted 中被撤销、取消或无状态贡献的动作。\n` +
    `7. 最后保存结果截图，并报告成功步骤、失败步骤、几何误差和最终画布差异。\n\n` +
    `## 步骤\n\n${steps || "没有可执行步骤。"}\n\n` +
    `## 通过标准\n\n` +
    `- 所有必要步骤执行成功；\n` +
    `- 最终对象数量、形状和相对位置与参考结果一致；\n` +
    `- 有 measurements 时，几何误差不超过目标画布尺寸的 2%；\n` +
    `- 最终画布没有因误点或已撤销操作产生的多余对象。\n`;
}

function formatPoint(point) {
  return Array.isArray(point) && point.length === 2
    ? `[${point.map((value) => Number(value).toFixed(4)).join(", ")}]`
    : "未知位置";
}

function formatScreenshotPath(value) {
  return value.startsWith("screenshots/") ? `../${value}` : value;
}
