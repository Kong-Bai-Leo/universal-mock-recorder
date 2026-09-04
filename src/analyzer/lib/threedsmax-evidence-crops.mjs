// Recover labels/mode controls from the corresponding full frame, including old
// recordings whose narrow crop already lost them. Never borrow another event.
export function buildThreeDsMaxEvidenceCrop(action, evidence, fullFrameAvailable = false) {
  const kind = evidence?.kind;
  if (!["transform_type_in", "command_panel_parameters"].includes(kind)) return null;
  const [x, y, width, height] = evidence.pixelBounds ?? [];
  if (![width, height].every((v) => Number.isFinite(v) && v > 0)) return null;
  const windowWidth = action?.window?.width;
  const windowHeight = action?.window?.height;
  const relative = evidence.relativeBounds;
  if (fullFrameAvailable && [x, y, windowWidth, windowHeight, ...(relative ?? [])].every(Number.isFinite) &&
      relative?.length === 4 && windowWidth > 0 && windowHeight > 0) {
    const originX = x - Math.round(relative[0] * windowWidth);
    const originY = y - Math.round(relative[1] * windowHeight);
    const bounds = kind === "transform_type_in" ? [0.55, 0.91, 0.40, 0.085] : [0.84, 0.20, 0.16, 0.70];
    return {
      fromFullFrame: true,
      crop: {
        centerX: originX + (bounds[0] + bounds[2] / 2) * windowWidth,
        centerY: originY + (bounds[1] + bounds[3] / 2) * windowHeight,
        width: Math.round(bounds[2] * windowWidth),
        height: Math.round(bounds[3] * windowHeight)
      },
      upscale: kind === "transform_type_in" ? 2 : 1.5
    };
  }
  return {
    fromFullFrame: false,
    crop: { centerX: width / 2, centerY: height / 2, width, height },
    upscale: 2
  };
}
