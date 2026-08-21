import fs from "node:fs/promises";
import path from "node:path";
import { MOCK_WORKFLOW_SCHEMA } from "./workflow.mjs";

export class GptClient {
  constructor(provider = {}) {
    this.baseUrl = "https://api.openai.com/v1";
    this.model = provider.model;
    this.timeoutMs = (provider.timeoutSeconds ?? 180) * 1000;
    this.maxRetries = provider.maxRetries ?? 2;
    this.retryBaseDelayMs = provider.retryBaseDelayMs ?? 1200;
  }

  async analyze({ instructions, payload, screenshots = [] }) {
    this.#validate();
    const apiKey = process.env.OPENAI_API_KEY;
    const images = await Promise.all(screenshots.map(toImageInput));
    return this.#responses(apiKey, instructions, payload, images);
  }

  #validate() {
    if (!this.model) throw new Error("provider.model 未配置");
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("环境变量 OPENAI_API_KEY 未设置。请勿将密钥写入配置文件。");
    }
  }

  async #responses(apiKey, instructions, payload, images) {
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
          name: "mock_workflow",
          description: "可由 Mock Runtime 执行并逐步验证的软件操作工作流",
          schema: MOCK_WORKFLOW_SCHEMA,
          strict: true
        }
      },
      store: false
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
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: serializedBody,
          signal: controller.signal
        });
        const text = await response.text();
        if (!response.ok) {
          const error = new Error(`OpenAI API 请求失败 (${response.status}): ${text.slice(0, 1000)}`);
          error.status = response.status;
          throw error;
        }
        return JSON.parse(text);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxRetries || !isRetryable(error)) break;
        await delay(this.retryBaseDelayMs * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    const requestSizeMb = (Buffer.byteLength(serializedBody) / 1024 / 1024).toFixed(2);
    throw new Error(
      `OpenAI API 连接失败（请求约 ${requestSizeMb} MB，已重试 ${this.maxRetries} 次）：${lastError?.message ?? lastError}`
    );
  }
}

function isRetryable(error) {
  if ([408, 409, 429].includes(error?.status) || error?.status >= 500) return true;
  const code = error?.cause?.code ?? error?.code;
  return ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code) ||
    error?.name === "AbortError" || /fetch failed|socket|network/i.test(error?.message ?? "");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
