import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function optimizeScreenshots(screenshots, outputDirectory, options = {}) {
  if (screenshots.length === 0) return [];
  if (process.platform !== "win32") return screenshots;
  const scriptPath = path.resolve(options.scriptPath ?? "scripts/optimize-screenshots.ps1");
  await fs.mkdir(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, "input-files.json");
  await fs.writeFile(manifestPath, JSON.stringify(screenshots.map((item) => ({
    path: item.path,
    crop: item.crop ?? null
  }))), "utf8");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-OutputDirectory", outputDirectory,
    "-MaxWidth", String(options.maxImageWidth ?? 1600),
    "-MaxHeight", String(options.maxImageHeight ?? 1000),
    "-JpegQuality", String(options.jpegQuality ?? 68),
    "-InputManifest", manifestPath
  ];
  const { stdout } = await execFileAsync("powershell.exe", args, {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  const optimized = JSON.parse(stdout.trim());
  if (!Array.isArray(optimized) || optimized.length !== screenshots.length)
    throw new Error("API 截图压缩器返回的文件数量不正确");
  return screenshots.map((item, index) => ({ ...item, path: optimized[index].path }));
}
