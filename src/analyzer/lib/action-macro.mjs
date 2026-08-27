import fs from "node:fs/promises";
import path from "node:path";

export async function loadActionMacroEvidence(recordingDir) {
  const manifestPath = path.join(recordingDir, "action-recorder.json");
  const macroDirectory = path.join(recordingDir, "action-recorder");
  const manifest = await readOptionalJson(manifestPath);
  let names = [];
  try {
    names = (await fs.readdir(macroDirectory))
      .filter((name) => /\.actmx?$/i.test(name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const entries = [];
  const parsedFormats = new Set();
  for (const name of names) {
    const bytes = await fs.readFile(path.join(macroDirectory, name));
    appendMacroEntries(entries, parsedFormats, bytes, name);
    if (entries.length >= 6000) break;
  }

  // 旧版 Recorder 可能在 AutoCAD 尚未写完时复制到了 0 字节文件。重试分析时，
  // 若清单仍指向同名的 Autodesk Action 目录文件，则只读恢复该文件，不暴露绝对路径。
  let recoveredFromSource = false;
  if (entries.length === 0 && typeof manifest?.sourcePath === "string" &&
      /\.actmx?$/i.test(manifest.sourcePath)) {
    try {
      const bytes = await fs.readFile(manifest.sourcePath);
      if (bytes.length > 0) {
        appendMacroEntries(entries, parsedFormats, bytes, path.basename(manifest.sourcePath));
        recoveredFromSource = entries.length > 0;
      }
    } catch {
      // 源文件可能已被用户移动；主事件与截图分析仍可继续。
    }
  }

  if (!manifest && names.length === 0) return null;
  return {
    metadata: {
      format: "AutoCadActionMacroEvidence",
      version: "0.1",
      available: entries.length > 0,
      status: manifest?.status ?? (entries.length > 0 ? "saved" : "unknown"),
      macroName: manifest?.macroName ?? null,
      files: names,
      totalEntries: entries.length,
      truncated: entries.length >= 6000,
      parsedFormats: [...parsedFormats],
      recoveredFromSource,
      error: manifest?.error ?? null
    },
    entries
  };
}

export function retrieveActionMacroChunk(evidence, chunkIndex, chunkTotal, options = {}) {
  const maxEntries = options.maxEntries ?? 90;
  if (!evidence || evidence.entries.length === 0) {
    return {
      context: null,
      audit: {
        available: false,
        status: evidence?.metadata?.status ?? "not_enabled",
        error: evidence?.metadata?.error ?? null,
        selectedEntries: 0
      }
    };
  }

  const total = evidence.entries.length;
  const safeTotalChunks = Math.max(1, chunkTotal);
  const safeIndex = Math.min(Math.max(1, chunkIndex), safeTotalChunks);
  const proportionalStart = Math.floor(total * (safeIndex - 1) / safeTotalChunks);
  const proportionalEnd = Math.ceil(total * safeIndex / safeTotalChunks);
  const overlap = Math.min(12, Math.floor(maxEntries / 4));
  let start = Math.max(0, proportionalStart - overlap);
  let end = Math.min(total, proportionalEnd + overlap);
  if (end - start > maxEntries) {
    const center = Math.floor((proportionalStart + proportionalEnd) / 2);
    start = Math.max(0, center - Math.floor(maxEntries / 2));
    end = Math.min(total, start + maxEntries);
    start = Math.max(0, end - maxEntries);
  }
  const selected = evidence.entries.slice(start, end);
  return {
    context: {
      format: evidence.metadata.format,
      macroName: evidence.metadata.macroName,
      alignment: "sequence_aligned_approximately_to_event_chunk",
      limitations: [
        "Action Macro 记录命令、输入、取点和选择过程，但条目没有与系统事件共用的稳定时间戳。",
        "该摘录按整体顺序近似分配到当前分段；必须与 candidateActions 和截图交叉验证。",
        "对象选择记录不能自动证明其对应的 resultEntityIds。"
      ],
      entryRange: [start + 1, end],
      totalEntries: total,
      entries: selected
    },
    audit: {
      available: true,
      selectedEntries: selected.length,
      entryRange: [start + 1, end],
      totalEntries: total,
      files: evidence.metadata.files
    }
  };
}

function decodeXml(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return bytes.subarray(3).toString("utf8");
  const prefix = bytes.subarray(0, Math.min(bytes.length, 200)).toString("ascii");
  if (/encoding\s*=\s*["']utf-16["']/i.test(prefix)) return bytes.toString("utf16le");
  return bytes.toString("utf8");
}

function tokenizeXml(xml) {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .match(/<[^>]+>|[^<]+/g)
    ?.map((token) => token.replace(/\s+/g, " ").trim())
    .filter((token) => token && !/^<\?/.test(token))
    .map((token) => token.slice(0, 800)) ?? [];
}

function appendMacroEntries(entries, formats, bytes, source) {
  if (bytes.length === 0) return;
  const text = decodeXml(bytes);
  try {
    const document = JSON.parse(text);
    const roots = orderedChildren(document?.ChildList);
    for (const root of roots) {
      if (entries.length >= 6000) break;
      entries.push({
        sequence: entries.length + 1,
        source,
        format: "actmx_json",
        node: summarizeActionNode(root)
      });
    }
    formats.add("actmx_json");
    return;
  } catch {
    // AutoCAD 旧版本可能仍输出 XML 格式，继续使用兼容解析。
  }

  for (const token of tokenizeXml(text)) {
    if (entries.length >= 6000) break;
    entries.push({ sequence: entries.length + 1, source, format: "actm_xml", xml: token });
  }
  if (entries.length > 0) formats.add("actm_xml");
}

function summarizeActionNode(node) {
  const properties = node?.PropertyBag ?? {};
  const data = simplifyMacroValue(properties.m_data);
  return {
    nodeType: shortType(node?.$type),
    ...(data !== undefined ? { data } : {}),
    ...(properties.m_prompt ? { prompt: properties.m_prompt } : {}),
    ...(properties.m_expectedCommand ? { expectedCommand: properties.m_expectedCommand } : {}),
    children: orderedChildren(node?.ChildList).map(summarizeActionNode)
  };
}

function simplifyMacroValue(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  const fields = value.Fields ?? value;
  if (Array.isArray(fields.List_0)) return fields.List_0;
  if (Array.isArray(value.List_0)) return value.List_0;
  const result = {};
  for (const [key, child] of Object.entries(fields)) {
    if (key === "$type") continue;
    if (child === null || ["string", "number", "boolean"].includes(typeof child)) result[key] = child;
    else if (Array.isArray(child)) result[key] = child.slice(0, 20);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function orderedChildren(childList) {
  return Object.entries(childList ?? {})
    .filter(([key, value]) => /^List_\d+$/.test(key) && value && typeof value === "object")
    .sort(([left], [right]) => Number(left.slice(5)) - Number(right.slice(5)))
    .map(([, value]) => value);
}

function shortType(value) {
  return String(value ?? "UnknownNode").split(".").pop();
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`无法读取 Action Recorder 清单 ${file}：${error.message}`);
  }
}
