# -*- coding: utf-8 -*-
"""屏幕布局:已知配置 + 从视频自动检测。

换视频源时不必手工标定 —— 靠"时间方差"把屏幕分成三类区域:
  * 常驻不变(功能区/任务栏/状态栏): 跨帧方差极低 + 非纯色
  * 画布:                          跨帧方差最高的大块连续区域
  * 命令行:                        画布下方、浅色背景、方差中等的横带
按键可视化覆盖层则是"间歇出现的浅色小块",按出现率定位。

用法:
    from cv.layout import resolve
    name, cfg = resolve(video_path, prefer="auto")
"""
import json
import os

import cv2
import numpy as np

# ---------------------------------------------------------------- 已知布局
LAYOUTS = {
    # 课时4-41: 1280x720, AutoCAD 深色主题, 单视口
    "acad720": {
        "size": (1280, 720),
        "taskbar_y": 675,
        "cmdline_y": (598, 675),
        "ribbon_y": 125,
        "canvas": (0, 128, 1245, 597),
        "cross_canvas": (0, 128, 1245, 597),
        "key_zone": (1060, 585, 1255, 672),
        "cmd_band": (0, 598, 1050, 672),
        "view3d_x": None,
        "cross_col_min": 280,
        "cross_row_min": 430,
        "ui_change_min_px": 160,
    },
    # 课时123-127: 1920x1080, 三维工作空间, 左2D/右3D 双视口
    "acad1080": {
        "size": (1920, 1080),
        "taskbar_y": 1008,
        "cmdline_y": (916, 1008),
        "ribbon_y": 165,
        "canvas": (5, 185, 1910, 908),
        "cross_canvas": (5, 185, 955, 908),
        "key_zone": (1600, 938, 1835, 1008),
        "cmd_band": (0, 916, 1500, 1006),
        "view3d_x": 958,
        "cross_col_min": 380,
        "cross_row_min": 500,
        "ui_change_min_px": 300,
    },
}

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "layout_cache.json")


# ---------------------------------------------------------------- 采样
def sample_frames(path, n=24):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        raise SystemExit(f"无法读取视频: {path}")
    # 跳过片头片尾(常有转场/标题页)
    lo, hi = int(total * 0.12), int(total * 0.92)
    idx = np.linspace(lo, max(lo + 1, hi), n).astype(int)
    frames = []
    for i in idx:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, f = cap.read()
        if ok:
            frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
    cap.release()
    if len(frames) < 4:
        raise SystemExit(f"采样帧不足: {path}")
    return np.stack(frames)


# ---------------------------------------------------------------- 检测
def _runs(mask):
    """把布尔序列切成连续 True 段 [(start, end), ...]。"""
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append((s, i))
            s = None
    if s is not None:
        out.append((s, len(mask)))
    return out


def detect(path, n=24):
    """返回一个 layout 配置 dict(结构与 LAYOUTS 的条目一致)。

    判据用**亮度分层**而不是时间方差 —— AutoCAD 深色主题下画布是近黑底,
    功能区/状态栏是中灰, 命令行是浅灰, 这个对比比"哪里在动"稳得多
    (空白画布不动, 而功能区悬停高亮和讲师标注反而在动)。
    """
    st = sample_frames(path, n)
    k, H, W = st.shape
    var = st.astype(np.float32).var(axis=0)
    mean = st.astype(np.float32).mean(axis=0)
    row_mean = mean.mean(axis=1)
    row_med = np.median(mean, axis=1)          # 中位数抗干扰(画布里的线条不影响)

    # --- 画布: 最大的一段"暗行" ---
    dark_thr = max(np.percentile(row_med, 20) + 12, 55)
    runs = _runs(row_med < dark_thr)
    runs = [r for r in runs if r[1] - r[0] > H * 0.15]
    if not runs:
        raise SystemExit("布局检测失败: 找不到画布区(暗行段)")
    top, bot = max(runs, key=lambda r: r[1] - r[0])

    # --- 命令行: 画布下方最亮的一段 ---
    below = row_med[bot:]
    if len(below):
        bright = _runs(below > max(np.percentile(row_med, 60), 110))
        bright = [r for r in bright if r[1] - r[0] >= 3]
        if bright:
            b0, b1 = max(bright, key=lambda r: r[1] - r[0])
            cmd_lo, cmd_hi = bot + b0, bot + b1
        else:
            cmd_lo, cmd_hi = bot, min(H, bot + int(H * 0.10))
    else:
        cmd_lo, cmd_hi = bot, H

    taskbar_y = min(H, cmd_hi)
    ribbon_y = top

    # --- 画布左右边界: 画布行里的暗列 ---
    col_med = np.median(mean[top:bot], axis=0)
    dcols = np.where(col_med < dark_thr + 20)[0]
    x0, x1 = (int(dcols.min()), int(dcols.max()) + 1) if len(dcols) else (0, W)

    # --- 双视口: 画布中部一条静止的亮竖线(视口分隔) ---
    view3d_x = None
    if x1 - x0 > W * 0.6:
        c0, c1 = x0 + int((x1 - x0) * 0.35), x0 + int((x1 - x0) * 0.65)
        seg_bright = col_med[c0:c1]
        seg_var = var[top:bot, c0:c1].mean(axis=0)
        base = np.median(col_med[x0:x1])
        cand = np.where((seg_bright > base + 18) & (seg_var < np.percentile(seg_var, 25)))[0]
        if len(cand):
            view3d_x = int(c0 + cand[len(cand) // 2])

    # --- 按键覆盖层: 屏幕下部 15%、右侧, 间歇出现的浅色块 ---
    kz = _detect_key_zone(st, max(0, H - int(H * 0.20)), H, W)

    # --- 命令行文字带: 覆盖层左侧 ---
    cmd_x1 = (kz[0] - 10) if kz else int(W * 0.82)

    return {
        "size": (W, H),
        "taskbar_y": int(taskbar_y),
        "cmdline_y": (int(cmd_lo), int(cmd_hi)),
        "ribbon_y": int(ribbon_y),
        "canvas": (int(x0), int(top), int(x1), int(bot)),
        "cross_canvas": (int(x0), int(top), int(view3d_x or x1), int(bot)),
        "key_zone": tuple(int(v) for v in (kz or (int(W * 0.83), cmd_lo, W - 20, taskbar_y))),
        "cmd_band": (0, int(cmd_lo), int(cmd_x1), int(min(H, taskbar_y))),
        "view3d_x": view3d_x,
        "cross_col_min": int((bot - top) * 0.60),
        "cross_row_min": int((x1 - x0) * 0.40),
        "ui_change_min_px": int(W * H / 5760),   # 720p->160, 1080p->360
        "_detected": True,
    }


def _detect_key_zone(st, y0, y1, W):
    """按键可视化覆盖层: 间歇出现的浅色小块。返回 (x0,y0,x1,y1) 或 None。"""
    if y1 - y0 < 8:
        return None
    band = st[:, y0:y1, :]
    # 每帧中"浅灰"像素(覆盖层底色)的掩码
    on = ((band > 90) & (band < 205)).astype(np.float32)
    rate = on.mean(axis=0)                 # 每像素出现率
    # 出现率在 (0.05, 0.85) 之间 = 间歇出现, 排除常驻 UI 与从不出现的区域
    cand = ((rate > 0.05) & (rate < 0.85)).astype(np.uint8)
    if cand.sum() < 200:
        return None
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((5, 9), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    best = None
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        # 覆盖层尺寸约束: 宽 5%~30% 屏宽, 高 3%~14% 屏高, 且位于右侧
        if not (W * 0.05 <= w <= W * 0.30):
            continue
        if not (band.shape[1] * 0.15 <= h <= band.shape[1] * 0.95):
            continue
        if x < W * 0.55:
            continue
        if area < w * h * 0.35:
            continue
        if best is None or area > best[4]:
            best = (x, y, w, h, area)
    if best is None:
        return None
    x, y, w, h, _ = best
    # 安全边距: 覆盖层的浅色底可能只覆盖一部分, 框太紧会切掉按键文字
    px, py = int(w * 0.30) + 8, int(h * 0.30) + 6
    return (max(0, x - px), max(0, y0 + y - py),
            min(W, x + w + px), min(st.shape[1], y0 + y + h + py))


# ---------------------------------------------------------------- 解析
def resolve(path, prefer="auto", use_cache=True):
    """返回 (布局名, 配置)。prefer 可以是 'auto' / 已知布局名 / 'detect'(强制检测)。"""
    if prefer in LAYOUTS:
        return prefer, LAYOUTS[prefer]

    cap = cv2.VideoCapture(path)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    if prefer == "auto":
        for name, cfg in LAYOUTS.items():
            if cfg["size"] == (w, h):
                return name, cfg

    cache = {}
    if use_cache and os.path.exists(CACHE):
        try:
            cache = json.load(open(CACHE, encoding="utf-8"))
        except Exception:
            cache = {}
    key = os.path.basename(path)
    if use_cache and key in cache:
        c = cache[key]
        c["size"] = tuple(c["size"])
        for f in ("cmdline_y", "canvas", "cross_canvas", "key_zone", "cmd_band"):
            c[f] = tuple(c[f])
        return f"detected:{key}", c

    cfg = detect(path)
    cache[key] = cfg
    try:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1,
                  default=lambda o: list(o) if isinstance(o, tuple) else o)
    except Exception:
        pass
    return f"detected:{key}", cfg


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        name, cfg = resolve(p, prefer="detect", use_cache=False)
        print(os.path.basename(p))
        print(" ", json.dumps({k: v for k, v in cfg.items() if not k.startswith("_")},
                              ensure_ascii=False, default=list))
