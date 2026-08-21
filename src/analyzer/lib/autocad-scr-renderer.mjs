export function renderAutoCadScr(plan) {
  const script = plan?.nativeScript;
  if (!script || script.format !== "autocad_scr" || !Array.isArray(script.lines) || script.lines.length === 0) {
    const details = script?.warnings?.join("；") || "录制中缺少生成精确 AutoCAD SCR 所需的业务坐标或尺寸";
    throw new Error(`无法生成可运行的 AutoCAD SCR：${details}`);
  }

  const lines = protectCoordinateInputsFromRunningOsnap(
    normalizeAutoCadGeometry(script.lines.map(normalizeLine))
  );
  if (lines.some((line) => /[\r\n]/.test(line)))
    throw new Error("nativeScript 的每个元素只能表示一行 SCR 输入");
  assertCommandLineSafe(lines);

  // AutoCAD SCRIPT 以换行模拟 Enter；文件末尾保留换行，确保最后一项被提交。
  return lines.join("\r\n") + "\r\n";
}

function protectCoordinateInputsFromRunningOsnap(lines) {
  const protectedLines = [];
  for (const line of lines) {
    if (isCoordinateInput(line) && !isObjectSnapOverride(protectedLines.at(-1))) {
      protectedLines.push("_NON");
    }
    protectedLines.push(line);
  }
  return protectedLines;
}

function isCoordinateInput(value) {
  const decimal = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const cartesian = new RegExp(`^@?${decimal},${decimal}(?:,${decimal})?$`);
  const polar = new RegExp(`^@?${decimal}<${decimal}$`);
  return cartesian.test(value) || polar.test(value);
}

function isObjectSnapOverride(value) {
  if (typeof value !== "string") return false;
  return new Set([
    "_END", "_MID", "_CEN", "_GCE", "_NOD", "_QUA", "_INT", "_APP",
    "_EXT", "_INS", "_PER", "_TAN", "_NEA", "_PAR", "_NON"
  ]).has(value.toUpperCase());
}

function normalizeAutoCadGeometry(inputLines) {
  const lines = [...inputLines];
  const circles = collectSimpleCircles(lines);
  if (circles.length > 0) normalizeAxisAlignedLineCircleSnaps(lines, circles);
  expandWindowSelectionBounds(lines);
  return lines;
}

function collectSimpleCircles(lines) {
  const circles = [];
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (commandName(lines[index]) !== "CIRCLE") continue;
    const center = parsePoint(lines[index + 1]);
    const radius = parseFiniteNumber(lines[index + 2]);
    if (center && radius !== null && radius > 0) circles.push({ center, radius });
  }
  return circles;
}

function normalizeAxisAlignedLineCircleSnaps(lines, circles) {
  for (let index = 0; index < lines.length; index += 1) {
    if (commandName(lines[index]) !== "LINE") continue;
    const pointIndexes = [];
    for (let cursor = index + 1; cursor < lines.length && lines[cursor] !== ""; cursor += 1) {
      if (commandName(lines[cursor])) break;
      if (!parsePoint(lines[cursor])) break;
      pointIndexes.push(cursor);
    }
    for (let pointIndex = 1; pointIndex < pointIndexes.length; pointIndex += 1) {
      const previousIndex = pointIndexes[pointIndex - 1];
      const currentIndex = pointIndexes[pointIndex];
      const previous = parsePoint(lines[previousIndex]);
      const current = parsePoint(lines[currentIndex]);
      const scale = Math.max(1, Math.abs(previous.x), Math.abs(previous.y), Math.abs(current.x), Math.abs(current.y));
      const axisTolerance = scale * 1e-10;
      if (Math.abs(previous.x - current.x) <= axisTolerance) {
        const snapped = snapVerticalPointToCircle(current, circles);
        if (snapped) lines[currentIndex] = formatPoint(snapped);
      } else if (Math.abs(previous.y - current.y) <= axisTolerance) {
        const snapped = snapHorizontalPointToCircle(current, circles);
        if (snapped) lines[currentIndex] = formatPoint(snapped);
      }
    }
  }
}

function snapVerticalPointToCircle(point, circles) {
  let best = null;
  for (const circle of circles) {
    const dx = point.x - circle.center.x;
    const square = circle.radius ** 2 - dx ** 2;
    if (square < 0) continue;
    const offset = Math.sqrt(square);
    for (const y of [circle.center.y + offset, circle.center.y - offset]) {
      best = chooseNearbySnap(point, { x: point.x, y }, circle.radius, best);
    }
  }
  return best?.point ?? null;
}

function snapHorizontalPointToCircle(point, circles) {
  let best = null;
  for (const circle of circles) {
    const dy = point.y - circle.center.y;
    const square = circle.radius ** 2 - dy ** 2;
    if (square < 0) continue;
    const offset = Math.sqrt(square);
    for (const x of [circle.center.x + offset, circle.center.x - offset]) {
      best = chooseNearbySnap(point, { x, y: point.y }, circle.radius, best);
    }
  }
  return best?.point ?? null;
}

function chooseNearbySnap(original, candidate, radius, currentBest) {
  const distance = Math.hypot(candidate.x - original.x, candidate.y - original.y);
  const tolerance = Math.max(1e-6, Math.abs(radius) * 1e-6);
  if (distance > tolerance || (currentBest && distance >= currentBest.distance)) return currentBest;
  return { point: candidate, distance };
}

function expandWindowSelectionBounds(lines) {
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (lines[index].toUpperCase() !== "_W" && lines[index].toUpperCase() !== "W") continue;
    const first = parsePoint(lines[index + 1]);
    const second = parsePoint(lines[index + 2]);
    if (!first || !second) continue;
    const span = Math.max(Math.abs(second.x - first.x), Math.abs(second.y - first.y));
    const margin = Math.max(1e-6, span * 1e-4);
    lines[index + 1] = formatPoint({
      x: Math.min(first.x, second.x) - margin,
      y: Math.min(first.y, second.y) - margin
    });
    lines[index + 2] = formatPoint({
      x: Math.max(first.x, second.x) + margin,
      y: Math.max(first.y, second.y) + margin
    });
  }
}

function commandName(line) {
  if (typeof line !== "string" || !/^_?[.]?-?[A-Za-z]/.test(line)) return null;
  return line.toUpperCase().replace(/^_?[.]?/, "").replace(/^-/, "");
}

function parsePoint(value) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(value);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parseFiniteNumber(value) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPoint(point) {
  return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

function formatNumber(value) {
  const normalized = Math.abs(value) < 5e-11 ? 0 : value;
  return normalized.toFixed(10).replace(/\.?0+$/, "");
}

function assertCommandLineSafe(lines) {
  const unsafeArrayCommands = new Set(["ARRAY", "ARRAYPOLAR", "ARRAYRECT", "ARRAYPATH"]);
  for (const line of lines) {
    const command = line.toUpperCase().replace(/^_?[.]?/, "");
    if (unsafeArrayCommands.has(command)) {
      throw new Error(
        `SCR 中的 ${line} 会进入关联阵列界面，提示顺序不稳定；请使用 _.-ARRAY 生成完整命令行阵列序列`
      );
    }
  }
}

function normalizeLine(value) {
  if (typeof value !== "string") throw new Error("SCR 行必须是字符串");
  return value.replace(/^\uFEFF/, "").trim();
}
