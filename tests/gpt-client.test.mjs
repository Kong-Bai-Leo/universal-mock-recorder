import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  GptClient,
  isRetryable,
  isTlsIntegrityError,
  summarizeUsageRecords
} from "../src/analyzer/lib/gpt-client.mjs";

test("通过 OpenAI Responses 端点获得 JSON", async () => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      clientRequestId: request.headers["x-client-request-id"],
      body: JSON.parse(body)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `resp_${requests.length}`,
      model: "test-model-snapshot",
      output_text: JSON.stringify({ summary: "ok", steps: [], omitted: [], warnings: [] }),
      usage: {
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 300,
        output_tokens_details: { reasoning_tokens: 120 },
        total_tokens: 1300
      }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-image-"));
  const screenshotPath = path.join(tempDirectory, "evt-1.jpg");
  await fs.writeFile(screenshotPath, Buffer.from([1, 2, 3]));
  process.env.OPENAI_API_KEY = "secret";

  try {
    const client = new GptClient({
      model: "test-model",
      timeoutSeconds: 5,
      reasoningEffort: "low",
      verbosity: "low",
      imageDetail: "low"
    });
    client.baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const result = await client.analyze({
      instructions: "test",
      payload: { value: 1 },
      screenshots: [{ path: screenshotPath, label: "screenshots/evt-1.jpg" }]
    });
    await client.analyze({
      instructions: "custom",
      payload: { value: 2 },
      outputName: "custom_audit",
      outputDescription: "custom schema",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"]
      }
    });
    assert.equal(result.summary, "ok");
    assert.equal(requests[0].url, "/v1/responses");
    assert.equal(requests[0].authorization, "Bearer secret");
    assert.equal(requests[0].body.model, "test-model");
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.stream, true);
    assert.equal(requests[0].body.reasoning.effort, "low");
    assert.equal(requests[0].body.text.verbosity, "low");
    assert.match(requests[0].clientRequestId, /^[0-9a-f-]{36}$/i);
    assert.equal(requests[0].body.text.format.type, "json_schema");
    assert.equal(requests[0].body.text.format.strict, true);
    assert.ok(requests[0].body.text.format.schema.properties.cadProgram);
    assert.equal(requests[0].body.text.format.schema.properties.nativeScript, undefined);
    assert.match(requests[0].body.input[0].content[1].text, /screenshots\/evt-1\.jpg/);
    assert.match(requests[0].body.input[0].content[2].image_url, /^data:image\/jpeg;base64,/);
    assert.equal(requests[0].body.input[0].content[2].detail, "low");
    assert.equal(requests[1].body.text.format.name, "custom_audit");
    assert.deepEqual(Object.keys(requests[1].body.text.format.schema.properties), ["summary"]);
    const usage = summarizeUsageRecords(client.getUsageRecords());
    assert.equal(usage.requestCount, 2);
    assert.equal(usage.inputTokens, 2000);
    assert.equal(usage.cachedInputTokens, 400);
    assert.equal(usage.outputTokens, 600);
    assert.equal(usage.reasoningTokens, 240);
    assert.equal(usage.totalTokens, 2600);
    assert.equal(usage.responses[0].responseId, "resp_1");
    assert.equal(usage.responses[0].model, "test-model-snapshot");
  } finally {
    delete process.env.OPENAI_API_KEY;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test("流式 Responses 保持长分析连接并解析最终 JSON", async () => {
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume request body */ }
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    response.write("event: response.created\n");
    response.write("data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_test\"}}\n\n");
    response.write("event: response.output_text.done\n");
    response.write("data: {\"type\":\"response.output_text.done\",\"text\":\"{\\\"summary\\\":\\\"streamed\\\",\\\"steps\\\":[],\\\"omitted\\\":[],\\\"warnings\\\":[]}\"}\n\n");
    response.write("event: response.completed\n");
    response.end("data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"{\\\"summary\\\":\\\"streamed\\\",\\\"steps\\\":[],\\\"omitted\\\":[],\\\"warnings\\\":[]}\"}}\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_API_KEY = "secret";
  try {
    const client = new GptClient({ model: "test-model", timeoutSeconds: 5 });
    client.baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const result = await client.analyze({ instructions: "test", payload: { value: 1 } });
    assert.equal(result.summary, "streamed");
  } finally {
    delete process.env.OPENAI_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("上传连接被关闭时自动重试", async () => {
  let attempts = 0;
  const server = http.createServer(async (request, response) => {
    attempts += 1;
    for await (const _chunk of request) { /* consume request body */ }
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      output_text: JSON.stringify({ summary: "retried", steps: [], omitted: [], warnings: [] })
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENAI_API_KEY = "secret";
  try {
    const client = new GptClient({
      model: "test-model",
      timeoutSeconds: 5,
      maxRetries: 1,
      retryBaseDelayMs: 1
    });
    client.baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const result = await client.analyze({ instructions: "test", payload: { value: 1 } });
    assert.equal(result.summary, "retried");
    assert.equal(attempts, 2);
  } finally {
    delete process.env.OPENAI_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("TLS bad record mac 被识别为可重试的连接完整性错误", () => {
  const error = new Error("ssl/tls alert bad record mac");
  error.code = "ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC";
  assert.equal(isTlsIntegrityError(error), true);
  assert.equal(isRetryable(error), true);

  const wrapped = new Error("request failed", { cause: error });
  assert.equal(isTlsIntegrityError(wrapped), true);
  assert.equal(isRetryable(wrapped), true);
});
