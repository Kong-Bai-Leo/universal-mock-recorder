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
    crop: item.crop ?? null,
    upscale: Number.isFinite(Number(item.upscale)) ? Number(item.upscale) : 1
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
  return screenshots.map((item, index) => {
    const optimizedItem = optimized[index];
    const imageMapping = {
      sourceSize: {
        width: optimizedItem.sourceWidth,
        height: optimizedItem.sourceHeight
      },
      cropRect: {
        x: optimizedItem.cropLeft,
        y: optimizedItem.cropTop,
        width: optimizedItem.cropWidth,
        height: optimizedItem.cropHeight
      },
      outputSize: {
        width: optimizedItem.outputWidth,
        height: optimizedItem.outputHeight
      },
      scale: optimizedItem.scale,
      lossless: optimizedItem.lossless === true,
      jpegQuality: optimizedItem.jpegQuality
    };
    if (Number.isFinite(item.crop?.centerX) && Number.isFinite(item.crop?.centerY)) {
      imageMapping.clickInSource = {
        x: item.crop.centerX,
        y: item.crop.centerY
      };
      imageMapping.clickInCrop = {
        x: item.crop.centerX - imageMapping.cropRect.x,
        y: item.crop.centerY - imageMapping.cropRect.y
      };
      imageMapping.clickInOutput = {
        x: imageMapping.clickInCrop.x * imageMapping.scale,
        y: imageMapping.clickInCrop.y * imageMapping.scale
      };
    }
    return {
      ...item,
      path: optimizedItem.path,
      imageMapping,
      label: `${item.label}${formatImageMappingLabel(imageMapping)}`
    };
  });
}

function formatImageMappingLabel(mapping) {
  const crop = mapping.cropRect;
  const source = mapping.sourceSize;
  const output = mapping.outputSize;
  const click = mapping.clickInSource;
  return "（图像坐标映射：" +
    `原图=${source.width}x${source.height}；` +
    `cropRectOriginal=[${crop.x},${crop.y},${crop.width},${crop.height}]；` +
    `输出=${output.width}x${output.height}；scale=${Number(mapping.scale).toFixed(6)}；` +
    (click
      ? `clickOriginal=[${click.x},${click.y}]；clickCrop=[${mapping.clickInCrop.x},${mapping.clickInCrop.y}]；`
      : "") +
    `lossless=${mapping.lossless}；jpegQuality=${mapping.jpegQuality}。` +
    "局部坐标映射回原图：original=(cropRect.xy + local/scale)）";
}
