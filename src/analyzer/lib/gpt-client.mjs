import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { MOCK_WORKFLOW_SCHEMA } from "./workflow.mjs";

export class GptClient {
  constructor(provider = {}) {
    this.baseUrl = "https://api.openai.com/v1";
    this.model = provider.model;
    this.timeoutMs = (provider.timeoutSeconds ?? 180) * 1000;
    this.maxRetries = provider.maxRetries ?? 4;
    this.retryBaseDelayMs = provider.retryBaseDelayMs ?? 2000;
    this.retryMaxDelayMs = provider.retryMaxDelayMs ?? 20000;
    this.streamResponses = provider.streamResponses !== false;
  }

  async analyze({
    instructions,
    payload,
    screenshots = [],
    outputSchema = MOCK_WORKFLOW_SCHEMA,
    outputName = "mock_workflow",
    outputDescription = "可由 Mock Runtime 执行并逐步验证的软件操作工作流"
  }) {
    this.#validate();
    const apiKey = process.env.OPENAI_API_KEY;
    const images = await Promise.all(screenshots.map(toImageInput));
    return this.#responses(apiKey, instructions, payload, images, {
      schema: outputSchema,
      name: outputName,
      description: outputDescription
    });
  }

  #validate() {
    if (!this.model) throw new Error("provider.model 未配置");
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("环境变量 OPENAI_API_KEY 未设置。请勿将密钥写入配置文件。");
    }
  }

  async #responses(apiKey, instructions, payload, images, outputFormat) {
    const content = [
      { type: "input_text", text: JSON.stringify(payload) },
      ...images.flatMap((image) => [
        { type: "input_text", text: `下面的图片对应录制文件 ${image.label}` },
        { type: "input_image", image_url: image.dataUrl, detail: "high" }
      ])
    ];
    const body = {
      model: this.model,
      instructions,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: outputFormat.name,
          description: outputFormat.description,
          schema: outputFormat.schema,
          strict: true
        }
      },
      store: false,
      stream: this.streamResponses
    };
    const response = await this.#post("/responses", apiKey, body);
    const outputText = response.output_text ?? response.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    return parseModelJson(outputText);
  }

  async #post(endpoint, apiKey, body) {
    const serializedBody = JSON.stringify(body);
    let lastError;
    let lastClientRequestId = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const clientRequestId = randomUUID();
      lastClientRequestId = clientRequestId;
      try {
        const response = await postJson(
          `${this.baseUrl}${endpoint}`,
          apiKey,
          serializedBody,
          this.timeoutMs,
          clientRequestId
        );
        if (response.status < 200 || response.status >= 300) {
          const error = new Error(`OpenAI API 请求失败 (${response.status}): ${response.text.slice(0, 1000)}`);
          error.status = response.status;
          error.retryAfterMs = parseRetryAfter(response.headers["retry-after"]);
          error.requestId = response.headers["x-request-id"] ?? null;
          error.clientRequestId = clientRequestId;
          throw error;
        }
        return parseApiResponse(response);
      } catch (error) {
        if (!error.clientRequestId) error.clientRequestId = clientRequestId;
        lastError = error;
        if (attempt >= this.maxRetries || !isRetryable(error)) break;
        const exponentialDelay = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** attempt);
        await delay(Math.max(exponentialDelay, error.retryAfterMs ?? 0));
      }
    }
    const requestSizeMb = (Buffer.byteLength(serializedBody) / 1024 / 1024).toFixed(2);
    const requestIdText = lastError?.requestId ? `；OpenAI request id=${lastError.requestId}` : "";
    const clientRequestIdText = `；client request id=${lastError?.clientRequestId ?? lastClientRequestId}`;
    const wrapped = new Error(
      `OpenAI API 连接失败（请求约 ${requestSizeMb} MB，已重试 ${this.maxRetries} 次）：${lastError?.message ?? lastError}`
      + requestIdText + clientRequestIdText
    );
    wrapped.cause = lastError;
    wrapped.status = lastError?.status;
    wrapped.requestId = lastError?.requestId ?? null;
    wrapped.clientRequestId = lastError?.clientRequestId ?? lastClientRequestId;
    wrapped.requestSizeMb = Number(requestSizeMb);
    throw wrapped;
  }
}

function isRetryable(error) {
  if ([408, 409, 429].includes(error?.status) || error?.status >= 500) return true;
  const code = error?.cause?.code ?? error?.code;
  return [
    "UND_ERR_SOCKET", "ECONNRESET", "ECONNABORTED", "ECONNREFUSED",
    "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH"
  ].includes(code) ||
    error?.name === "AbortError" || /fetch failed|socket|network/i.test(error?.message ?? "");
}

function postJson(url, apiKey, body, timeoutMs, clientRequestId) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request(target, {
      method: "POST",
      agent: false,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        connection: "close",
        "x-client-request-id": clientRequestId
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("aborted", () => {
        const error = new Error("OpenAI API 在响应完成前关闭了连接");
        error.code = "ECONNRESET";
        fail(error);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`OpenAI API 请求超过 ${Math.round(timeoutMs / 1000)} 秒`);
      error.name = "AbortError";
      request.destroy(error);
    });
    request.on("error", fail);
    request.end(body);
  });
}

function parseApiResponse(response) {
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("text/event-stream"))
    return parseResponsesEventStream(response.text);
  return JSON.parse(response.text);
}

function parseResponsesEventStream(text) {
  let completedResponse = null;
  let completedText = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw new Error(`OpenAI 流式响应包含无效 JSON：${error.message}`);
    }
    if (event.type === "response.output_text.done" && typeof event.text === "string")
      completedText = event.text;
    if (event.type === "response.completed" && event.response)
      completedResponse = event.response;
    if (event.type === "response.failed" || event.type === "response.incomplete") {
      const details = event.response?.error?.message ?? event.error?.message ??
        event.response?.incomplete_details?.reason ?? event.type;
      const error = new Error(`OpenAI 流式响应失败：${details}`);
      error.code = event.response?.error?.code ?? event.error?.code ?? null;
      error.status = error.code === "server_error" ? 500 : null;
      throw error;
    }
  }
  if (completedResponse) return completedResponse;
  if (completedText !== null) return { output_text: completedText };
  throw new Error("OpenAI 流式响应在完成事件之前结束");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function toImageInput(input) {
  const filePath = typeof input === "string" ? input : input.path;
  const label = typeof input === "string" ? path.basename(input) : input.label;
  const data = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return {
    label: label || path.basename(filePath),
    dataUrl: `data:${mime};base64,${data.toString("base64")}`
  };
}

function parseModelJson(text) {
  if (!text) throw new Error("OpenAI API 响应中没有文本内容");
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(`OpenAI API 没有返回有效 JSON: ${error.message}`);
  }
}
