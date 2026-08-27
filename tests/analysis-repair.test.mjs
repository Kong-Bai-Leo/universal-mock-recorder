import test from "node:test";
import assert from "node:assert/strict";
import { analyzeValidatedChunk } from "../src/analyzer/lib/analysis-repair.mjs";

test("AI 缺少 CAD 必填参数时携带校验错误自动纠错一次", async () => {
  const calls = [];
  const client = {
    async analyze(request) {
      calls.push(request);
      return calls.length === 1 ? { valid: false, cadProgram: { operations: [{ command: "OFFSET" }] } } : { valid: true };
    }
  };
  const result = await analyzeValidatedChunk({
    client,
    instructions: "test",
    payload: { candidateActions: [{ cadInputEvidence: { command: "OFFSET", parameterName: "distance", value: 10 } }] },
    screenshots: [],
    validate(output) {
      if (!output.valid) throw new Error("OFFSET 缺少明确距离");
      return output;
    }
  });

  assert.equal(result.validationRepairs, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[1].payload.validationCorrection.error, /OFFSET/);
  assert.equal(calls[1].payload.validationCorrection.previousInvalidOutput.cadProgram.operations[0].command, "OFFSET");
});
