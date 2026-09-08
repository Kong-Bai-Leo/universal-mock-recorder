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
    this.reasoningEffort = provider.reasoningEffort ?? null;
    this.verbosity = provider.verbosity ?? null;
    this.imageDetail = provider.imageDetail ?? "high";
    this.timeoutMs = (provider.timeoutSeconds ?? 180) * 1000;
    this.maxRetries = provider.maxRetries ?? 4;
    this.retryBaseDelayMs = provider.retryBaseDelayMs ?? 2000;
    this.retryMaxDelayMs = provider.retryMaxDelayMs ?? 20000;
    this.streamResponses = provider.streamResponses !== false;
    this.forceTls12OnIntegrityError = provider.forceTls12OnIntegrityError !== false;
    this.uploadChunkBytes = Math.max(16 * 1024, provider.uploadChunkBytes ?? 64 * 1024);
    this.usageRecords = [];
  }

  getUsageRecords() {
    return this.usageRecords.map((record) => ({ ...record }));
  }

  async analyze({
    instructions,
    payload,
    screenshots = [],
    outputSchema = MOCK_WORKFLOW_SCHEMA,
    outputName = "mock_workflow",
    outputDescription = "可由 Mock Runtime 执行并逐步验证的软件操作工作流",
    reasoningEffort = this.reasoningEffort,
    verbosity = this.verbosity,
    maxOutputTokens
  }) {
    this.#validate();
    const apiKey = process.env.OPENAI_API_KEY;
    const images = await Promise.all(screenshots.map((input) =>
      toImageInput(input, this.imageDetail)));
    return this.#responses(apiKey, instructions, payload, images, {
      schema: outputSchema,
      name: outputName,
      description: outputDescription,
      reasoningEffort,
      verbosity,
      maxOutputTokens
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
        { type: "input_image", image_url: image.dataUrl, detail: image.detail }
      ])
    ];
    const body = {
      model: this.model,
      instructions,
      input: [{ role: "user", content }],
      text: {
        ...(outputFormat.verbosity ? { verbosity: outputFormat.verbosity } : {}),
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
    if (outputFormat.reasoningEffort)
      body.reasoning = { effort: outputFormat.reasoningEffort };
    if (outputFormat.maxOutputTokens !== undefined) {
      if (!Number.isInteger(outputFormat.maxOutputTokens) || outputFormat.maxOutputTokens < 1)
        throw new Error("maxOutputTokens 必须是正整数");
      body.max_output_tokens = outputFormat.maxOutputTokens;
    }
    const response = await this.#post("/responses", apiKey, body);
    const usage = normalizeResponseUsage(response, this.model);
    if (usage) this.usageRecords.push(usage);
    const outputText = response.output_text ?? response.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    return parseModelJson(outputText);
  }

  async #post(endpoint, apiKey, body) {
    const serializedBody = JSON.stringify(body);
    let lastError;
    let lastClientRequestId = null;
    let attemptsMade = 0;
    let forceTls12 = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const clientRequestId = randomUUID();
      lastClientRequestId = clientRequestId;
      attemptsMade += 1;
      try {
        const response = await postJson(
          `${this.baseUrl}${endpoint}`,
          apiKey,
          serializedBody,
          this.timeoutMs,
          clientRequestId,
          {
            forceTls12,
            uploadChunkBytes: this.uploadChunkBytes
          }
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
        if (this.forceTls12OnIntegrityError && isTlsIntegrityError(error))
          forceTls12 = true;
        const exponentialDelay = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** attempt);
        await delay(Math.max(exponentialDelay, error.retryAfterMs ?? 0));
      }
    }
    const requestSizeMb = (Buffer.byteLength(serializedBody) / 1024 / 1024).toFixed(2);
    const requestIdText = lastError?.requestId ? `；OpenAI request id=${lastError.requestId}` : "";
    const clientRequestIdText = `；client request id=${lastError?.clientRequestId ?? lastClientRequestId}`;
    const wrapped = new Error(
      `OpenAI API 连接失败（请求约 ${requestSizeMb} MB，共尝试 ${attemptsMade} 次）：${lastError?.message ?? lastError}`
      + requestIdText + clientRequestIdText
    );
    wrapped.cause = lastError;
    wrapped.status = lastError?.status;
    wrapped.requestId = lastError?.requestId ?? null;
    wrapped.clientRequestId = lastError?.clientRequestId ?? lastClientRequestId;
    wrapped.requestSizeMb = Number(requestSizeMb);
    wrapped.attemptsMade = attemptsMade;
    wrapped.tls12FallbackUsed = forceTls12;
    throw wrapped;
  }
}

export function summarizeUsageRecords(records = []) {
  const normalized = records.filter(Boolean);
  return {
    requestCount: normalized.length,
    inputTokens: normalized.reduce((sum, item) => sum + finiteTokenCount(item.inputTokens), 0),
    cachedInputTokens: normalized.reduce((sum, item) => sum + finiteTokenCount(item.cachedInputTokens), 0),
    outputTokens: normalized.reduce((sum, item) => sum + finiteTokenCount(item.outputTokens), 0),
    reasoningTokens: normalized.reduce((sum, item) => sum + finiteTokenCount(item.reasoningTokens), 0),
    totalTokens: normalized.reduce((sum, item) => sum + finiteTokenCount(item.totalTokens), 0),
    responses: normalized.map((item) => ({ ...item }))
  };
}

export function isRetryable(error) {
  if ([408, 409, 429].includes(error?.status) || error?.status >= 500) return true;
  const code = error?.cause?.code ?? error?.code;
  return [
    "UND_ERR_SOCKET", "ECONNRESET", "ECONNABORTED", "ECONNREFUSED",
    "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EPROTO"
  ].includes(code) ||
    isTlsIntegrityError(error) || error?.name === "AbortError" ||
    /fetch failed|socket|network/i.test(error?.message ?? "");
}

export function isTlsIntegrityError(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const code = String(current.code ?? "").toUpperCase();
    const message = String(current.message ?? "");
    if (/BAD_RECORD_MAC|DECRYPTION_FAILED|TLSV1_ALERT_INTERNAL_ERROR|UNEXPECTED_EOF/.test(code) ||
      /ssl\/tls alert bad record mac|bad record mac|decryption failed|tls.*unexpected eof/i.test(message))
      return true;
    current = current.cause;
  }
  return false;
}

function postJson(url, apiKey, body, timeoutMs, clientRequestId, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const agent = target.protocol === "https:"
      ? new https.Agent({
        keepAlive: false,
        maxCachedSessions: 0,
        ...(options.forceTls12 ? { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } : {})
      })
      : false;
    let settled = false;
    const cleanup = () => {
      if (agent && typeof agent.destroy === "function") agent.destroy();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const request = transport.request(target, {
      method: "POST",
      agent,
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
        cleanup();
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.on("close", cleanup);
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`OpenAI API 请求超过 ${Math.round(timeoutMs / 1000)} 秒`);
      error.name = "AbortError";
      request.destroy(error);
    });
    request.on("error", fail);
    writeRequestBody(request, body, options.uploadChunkBytes ?? 64 * 1024).catch((error) =>
      request.destroy(error));
  });
}

async function writeRequestBody(request, body, chunkBytes) {
  const buffer = Buffer.from(body, "utf8");
  const size = Math.max(16 * 1024, Number(chunkBytes) || 64 * 1024);
  for (let offset = 0; offset < buffer.length; offset += size) {
    const writable = request.write(buffer.subarray(offset, Math.min(buffer.length, offset + size)));
    if (!writable) await new Promise((resolve, reject) => {
      const onDrain = () => {
        request.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        request.off("drain", onDrain);
        reject(error);
      };
      request.once("drain", onDrain);
      request.once("error", onError);
    });
  }
  request.end();
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

async function toImageInput(input, defaultDetail = "high") {
  const filePath = typeof input === "string" ? input : input.path;
  const label = typeof input === "string" ? path.basename(input) : input.label;
  const evidenceRole = typeof input === "string" ? "" : String(input.evidenceRole ?? "");
  const requestedDetail = typeof input === "string" ? null : input.detail;
  const detail = requestedDetail ??
    (/trim|final_canvas|cad_input|change_pair|change_selection|canvas_click|offset/i.test(evidenceRole)
      ? "high"
      : defaultDetail);
  const data = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return {
    label: label || path.basename(filePath),
    detail,
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

function normalizeResponseUsage(response, fallbackModel) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = finiteTokenCount(usage.input_tokens);
  const outputTokens = finiteTokenCount(usage.output_tokens);
  return {
    responseId: typeof response.id === "string" ? response.id : null,
    model: typeof response.model === "string" ? response.model : fallbackModel,
    inputTokens,
    cachedInputTokens: finiteTokenCount(usage.input_tokens_details?.cached_tokens),
    outputTokens,
    reasoningTokens: finiteTokenCount(usage.output_tokens_details?.reasoning_tokens),
    totalTokens: finiteTokenCount(usage.total_tokens) || inputTokens + outputTokens
  };
}

function finiteTokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}
