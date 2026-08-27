import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Builds one aligned comparison image per TRIM click. Keeping baseline,
 * selection and settled-after frames in one image prevents the vision model
 * from accidentally comparing frames from adjacent TRIM clicks.
 */
export async function composeTrimEvidence(actions, recordingDir, outputDirectory, options = {}) {
  if (actions.length === 0 || process.platform !== "win32") return [];
  await fs.mkdir(outputDirectory, { recursive: true });
  const scriptPath = path.resolve(
    options.trimEvidenceScriptPath ?? "scripts/compose-trim-evidence.ps1");
  const items = actions.map((action, index) => ({
    id: action.sourceEventIds?.join("+") || `trim-${index + 1}`,
    baselinePath: action.persistentBaselineScreenshot &&
      action.persistentBaselineScreenshot !== action.screenshotBefore
      ? resolveRecordingPath(recordingDir, action.persistentBaselineScreenshot)
      : null,
    beforePath: resolveRecordingPath(recordingDir, action.screenshotBefore),
    selectionPath: resolveRecordingPath(recordingDir, action.screenshotSelection),
    afterPath: resolveRecordingPath(recordingDir, action.screenshotAfter),
    clickX: action.at?.x,
    clickY: action.at?.y,
    cropWidth: options.trimEvidenceCropWidth ?? 760,
    cropHeight: options.trimEvidenceCropHeight ?? 600
  }));
  const manifestPath = path.join(outputDirectory, "trim-evidence-input.json");
  await fs.writeFile(manifestPath, JSON.stringify(items), "utf8");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-OutputDirectory", outputDirectory,
    "-InputManifest", manifestPath,
    "-MaxWidth", String(options.trimEvidenceMaxWidth ?? 2200),
    "-MaxHeight", String(options.trimEvidenceMaxHeight ?? 800),
    "-JpegQuality", String(options.trimEvidenceJpegQuality ?? 95)
  ], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  const generated = JSON.parse(stdout.trim());
  if (!Array.isArray(generated) || generated.length !== actions.length)
    throw new Error("TRIM 对比图生成器返回的文件数量不正确");

  return generated.map((item, index) => {
    const action = actions[index];
    const eventIds = action.sourceEventIds ?? [];
    const mapping = {
      sourceSize: { width: item.sourceWidth, height: item.sourceHeight },
      cropRect: {
        x: item.cropLeft,
        y: item.cropTop,
        width: item.cropWidth,
        height: item.cropHeight
      },
      panelSizeBeforeScale: { width: item.cropWidth, height: item.cropHeight },
      headerHeightBeforeScale: item.headerHeight,
      outputSize: { width: item.outputWidth, height: item.outputHeight },
      scale: item.scale,
      panelOrder: item.panelOrder,
      clickInSource: { x: item.clickX, y: item.clickY },
      clickInCrop: { x: item.clickX - item.cropLeft, y: item.clickY - item.cropTop }
    };
    return {
      path: item.path,
      evidenceRole: "trim_click_aligned_comparison",
      sourceScreenshots: item.sourceScreenshots,
      sourceEventIds: eventIds,
      imageMapping: mapping,
      label: `${eventIds.join("+")}（TRIM 单次点击的严格配对证据；面板从左到右=${item.panelOrder.join(" / ")}；` +
        `黄圈中心是同一个 clickOriginal=[${item.clickX},${item.clickY}]；` +
        `cropRectOriginal=[${item.cropLeft},${item.cropTop},${item.cropWidth},${item.cropHeight}]；` +
        `scale=${Number(item.scale).toFixed(6)}。必须只比较本图各面板：以 immediate_before 到 settled_after 为本次点击的主差分，找出永久消失或缩短的几何，并令该 pair 的 operation/resultGeometry 与之完全一致；persistent_baseline 仅用于连续状态复核。` +
        `面板内原图映射：original=[${item.cropLeft},${item.cropTop}]+panelLocal/scale）`
    };
  });
}

function resolveRecordingPath(recordingDir, file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.join(recordingDir, file);
}
