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
      maxOutputTokens: 16000,
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
    assert.equal(requests[0].body.max_output_tokens, undefined);
    assert.equal(requests[1].body.max_output_tokens, 16000);
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

test("failed streaming response preserves provider error and usage without retry", async () => {
  let calls=0;const failures=[];
  const server=http.createServer(async(request,response)=>{
    calls++;for await(const _ of request){}
    response.writeHead(200,{"content-type":"text/event-stream"});
    response.end("data: "+JSON.stringify({type:"response.failed",response:{id:"failed-synthetic",status:"failed",error:{code:"server_error",message:"synthetic overload"},usage:{input_tokens:120,output_tokens:3,total_tokens:123}}})+"\n\n");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="synthetic-key";
  try {
    const client=new GptClient({model:"synthetic",maxRetries:0,onFailure:f=>failures.push(f)});
    client.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
    await assert.rejects(client.analyze({instructions:"test",payload:{}}),e=>e.code==="server_error"&&e.status===500);
    assert.equal(calls,1);assert.equal(failures.length,1);
    assert.equal(failures[0].response.id,"failed-synthetic");
    assert.equal(client.getUsageRecords()[0].totalTokens,123);
    assert.doesNotMatch(JSON.stringify(failures),/synthetic-key|authorization/);
  } finally {
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    await new Promise(resolve=>server.close(resolve));
  }
});

test("schema rejection preserves error body and missing usage is not fabricated", async () => {
  const failures=[];let calls=0;
  const server=http.createServer(async(request,response)=>{
    calls++;for await(const _ of request){}
    response.writeHead(400,{"content-type":"application/json","x-request-id":"req_synthetic"});
    response.end(JSON.stringify({error:{code:"invalid_json_schema",message:"missing type"}}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="synthetic-key";
  try {
    const client=new GptClient({model:"synthetic",maxRetries:0,onFailure:f=>failures.push(f)});
    client.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
    await assert.rejects(client.analyze({instructions:"test",payload:{}}),e=>e.code==="invalid_json_schema"&&e.requestId==="req_synthetic");
    assert.equal(calls,1);assert.equal(failures[0].response.error.code,"invalid_json_schema");
    assert.deepEqual(client.getUsageRecords(),[]);
  } finally {
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    await new Promise(resolve=>server.close(resolve));
  }
});

for (const scenario of [
  { name: "text done without terminal completion", contentType: "text/event-stream", body:
    "data: " + JSON.stringify({type:"response.output_text.done",text:'{"summary":"partial"}'}) + "\n\n", code: "response_stream_unfinished" },
  { name: "standalone stream error after text", contentType: "text/event-stream", body:
    "data: " + JSON.stringify({type:"response.output_text.done",text:'{"summary":"partial"}'}) + "\n\n" +
    "data: " + JSON.stringify({type:"error",code:"server_error",message:"synthetic terminal failure"}) + "\n\n", code: "server_error" },
  { name: "nested overload error on a successful HTTP stream", contentType: "text/event-stream", body:
    "data: " + JSON.stringify({type:"error",error:{type:"service_unavailable_error",code:"server_is_overloaded",message:"synthetic overload",param:null},sequence_number:2}) + "\n\n", code:"server_is_overloaded" },
  { name: "non-stream incomplete response containing valid partial JSON", contentType: "application/json", body:
    JSON.stringify({id:"resp_incomplete",status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output_text:'{"summary":"partial"}',usage:{input_tokens:8,output_tokens:4,total_tokens:12}}), code:"response_incomplete" }
]) test(scenario.name + " cannot become a successful analysis", async () => {
  let calls=0; const failures=[], successes=[];
  const server=http.createServer(async (request,response)=>{
    calls++; for await (const _ of request) {}
    response.writeHead(200,{"content-type":scenario.contentType,"x-request-id":"req_terminal_test"});
    response.end(scenario.body);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="synthetic-key";
  try {
    const client=new GptClient({model:"synthetic",maxRetries:0,onFailure:f=>failures.push(f),onResponse:r=>successes.push(r)});
    client.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
    await assert.rejects(client.analyze({instructions:"test",payload:{}}),e=>e.code===scenario.code&&e.requestId==="req_terminal_test");
    assert.equal(calls,1); assert.equal(successes.length,0); assert.equal(failures.length,1);
    if(scenario.code==="response_incomplete") assert.equal(client.getUsageRecords()[0].totalTokens,12);
  } finally {
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    await new Promise(resolve=>server.close(resolve));
  }
});
