import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { GptClient } from "../src/analyzer/lib/gpt-client.mjs";

test("通过 OpenAI Responses 端点获得 JSON", async () => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      output_text: JSON.stringify({ summary: "ok", steps: [], omitted: [], warnings: [] })
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
      timeoutSeconds: 5
    });
    client.baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const result = await client.analyze({
      instructions: "test",
      payload: { value: 1 },
      screenshots: [{ path: screenshotPath, label: "screenshots/evt-1.jpg" }]
    });
    assert.equal(result.summary, "ok");
    assert.equal(requests[0].url, "/v1/responses");
    assert.equal(requests[0].authorization, "Bearer secret");
    assert.equal(requests[0].body.model, "test-model");
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.text.format.type, "json_schema");
    assert.equal(requests[0].body.text.format.strict, true);
    assert.match(requests[0].body.input[0].content[1].text, /screenshots\/evt-1\.jpg/);
    assert.match(requests[0].body.input[0].content[2].image_url, /^data:image\/jpeg;base64,/);
  } finally {
    delete process.env.OPENAI_API_KEY;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDirectory, { recursive: true, force: true });
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
