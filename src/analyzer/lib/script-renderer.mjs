export function renderTypeScript(plan, runtimeImport = "@mock/runtime") {
  const serialized = JSON.stringify(plan, null, 2);
  return `// 此文件由 Universal Mock Recorder 自动生成。\n` +
    `// 脚本按语义识别Mock中的等价控件，不依赖录制时的绝对坐标。\n` +
    `import { createMockAgent } from ${JSON.stringify(runtimeImport)};\n\n` +
    `const workflow = ${serialized} as const;\n\n` +
    `export default async function runMockWorkflow() {\n` +
    `  const agent = await createMockAgent();\n` +
    `  await agent.run(workflow, {\n` +
    `    locateOrder: ["semantic", "accessibility", "text", "visual", "relative_position"],\n` +
    `    verifyAfterEachStep: true,\n` +
    `    retryCandidates: true,\n` +
    `    recoverWithEscapeOrUndo: true\n` +
    `  });\n` +
    `}\n`;
}

