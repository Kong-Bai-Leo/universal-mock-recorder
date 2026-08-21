import fs from "node:fs/promises";
import path from "node:path";
import { MOCK_WORKFLOW_SCHEMA } from "./workflow.mjs";

export class GptClient {
  constructor(provider = {}) {
    this.baseUrl = "https://api.openai.com/v1";
    this.model = provider.model;
    this.timeoutMs = (provider.timeoutSeconds ?? 180) * 1000;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI API 请求失败 (${response.status}): ${text.slice(0, 1000)}`);
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }
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
