# -*- coding: utf-8 -*-
"""ç»Ÿä¸€ CV æŽ¢æµ‹å™¨ (converged) â€”â€” å½•å±è§†é¢‘ -> è¯æ®åŒ…,é›¶ OCRã€é›¶ VLMã€‚

åˆå¹¶äº†ä¸‰ä¸ªåŽŸåž‹: cv_probe.py(720p å¸ƒå±€)ã€cv_probe_l123.py(1080p åŒè§†å£)ã€
extract_cmdline.py(å‘½ä»¤è¡Œæ¡å¸¦)ã€‚æ‰€æœ‰åˆ†è¾¨çŽ‡/å¸ƒå±€å·®å¼‚æ”¶æ•›åˆ° LAYOUTS é…ç½®ã€‚

用法:
    py -3.11 cv/probe.py <video.mp4> <out_dir> [--layout auto|acad720|acad1080] \
                          [--start S] [--end S] [--no-slices]

è¾“å‡ºå¥‘çº¦(ä¸‹æ¸¸ agent åªä¾èµ–è¿™äº›æ–‡ä»¶):
    manifest.json      è§†é¢‘å…ƒæ•°æ® + é‡‡ç”¨çš„å¸ƒå±€ + å·¥å…·ç‰ˆæœ¬
    trajectory.json    é€å¸§å…‰æ ‡ {f,t,x,y,sx,sy,found,mode}
    input_events.json  è¾“å…¥äº‹ä»¶ {id,t0,fCrop,cursorAt}   <- æŒ‰é”®/é¼ æ ‡å¯è§†åŒ–è¦†ç›–å±‚
    episodes.json      UI å˜åŒ–ç‰‡æ®µ {id,t0,t1,bbox,peakPx,dominantRegion}
    actions.json       候选动作 {id,type,t0,t1,cursor,bbox,inputs,cursorPathPx}
    cmdstrips/         å‘½ä»¤è¡ŒåŒºåŸŸå˜åŒ–æ¡å¸¦(åŽŸç”Ÿåˆ†è¾¨çŽ‡, æ—¶é—´åº)
    cmdmont/           æ¡å¸¦è’™å¤ªå¥‡(æ¯å¼  N æ¡), ä¾› agent æ‰¹é‡è¯»å–
    slices/            æ¯ä¸ªåŠ¨ä½œçš„è¯æ®åŒ…(before/after å…¨å¸§ + ç‰¹å†™ + è½¨è¿¹å›¾)
    index.html         人工复核页

CV åªå›žç­”"å“ªé‡Œã€ä»€ä¹ˆæ—¶å€™ã€ä»€ä¹ˆèŒƒå›´å˜äº†";ä¸€åˆ‡"çœ‹æ‡‚"(è¯»å­—ã€åˆ¤è¯­ä¹‰)äº¤ç»™ agentã€‚
"""
import argparse
import json
import math
import os

import cv2
import numpy as np

VERSION = "cv-probe/3.0"

# ---------------------------------------------------------------- å¸ƒå±€é…ç½®
# ä¸€ä¸ªå¸ƒå±€ = è¯¥å½•åˆ¶çŽ¯å¢ƒçš„å±å¹•åˆ†åŒºã€‚æ¢è§†é¢‘æºåªéœ€æ–°å¢žä¸€æ¡,ç®—æ³•ä¸åŠ¨ã€‚
LAYOUTS = {
    # è¯¾æ—¶4-15: 1280x720, AutoCAD æ·±è‰²ä¸»é¢˜, å•è§†å£, è®²å¸ˆå¼€å…¨å±åå­—å…‰æ ‡+æŒ‰é”®å¯è§†åŒ–
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
    # è¯¾æ—¶123-127: 1920x1080, AutoCAD ä¸‰ç»´å·¥ä½œç©ºé—´, å·¦2D/å³3D åŒè§†å£
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

# ---------------------------------------------------------------- ç®—æ³•å¸¸é‡
DIFF_THRESH = 30
CURSOR_BLOB_MAX_AREA = 1200
CURSOR_JUMP_LIMIT = 220
EPISODE_GAP = 6
SCENE_CUT_RATIO = 0.45
PAUSE_SPEED = 2.5
PAUSE_MIN_FRAMES = 4
STABLE_MAX_PX = 120
KEY_ACTIVE_MIN_PX = 500
KEY_SPLIT_DIFF = 10.0
CMD_STEP_FRAMES = 12       # 命令行采样间隔(帧)
CMD_DIFF_MEAN = 2.5        # å‘½ä»¤è¡Œå†…å®¹å˜åŒ–é˜ˆå€¼
CMD_PER_MONTAGE = 16
ANNOT_RATIO_GATE = 0.15   # 讲师标注判定(课时8 实测: 真标注 0.19~0.33, 非标注 <0.01)


def pick_layout(name, w, h, path=None):
    """å·²çŸ¥å¸ƒå±€ä¼˜å…ˆ;åˆ†è¾¨çŽ‡ä¸è®¤è¯†æ—¶å›žè½åˆ° layout.py çš„è‡ªåŠ¨æ£€æµ‹ã€‚"""
    if name and name != "auto" and name in LAYOUTS:
        return name, LAYOUTS[name]
    for key, cfg in LAYOUTS.items():
        if cfg["size"] == (w, h):
            return key, cfg
    if path:
        try:
            from layout import resolve            # åŒç›®å½•
        except ImportError:
            from cv.layout import resolve
        return resolve(path, prefer="detect")
    raise SystemExit(f"æœªçŸ¥å¸ƒå±€ {w}x{h}: è¯·åœ¨ LAYOUTS ä¸­æ–°å¢žä¸€æ¡,æˆ–ç”¨ --layout æŒ‡å®š")



def union_cmd_band(src, cfg, n=14):
    """采样若干帧, 取"命令行亮带"y 范围的并集 —— 应对中途切换工作空间导致的移位。"""
    cap = cv2.VideoCapture(src)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    x0, y0, x1, y1 = cfg["cmd_band"]
    H = cfg["size"][1]
    lo, hi = y0, y1
    if total > 0:
        lo, hi = H, 0
        for i in np.linspace(int(total * 0.08), int(total * 0.95), n).astype(int):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, f = cap.read()
            if not ok:
                continue
            g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
            # 命令行是浅灰底: 在屏幕下部找"行中位亮度明显偏高"的连续行段
            band = np.median(g[int(H * 0.72):, x0:x1], axis=1)
            base = float(np.median(band))
            rows = np.where(band > base + 25)[0]
            if len(rows) < 3:
                continue
            a, b = int(H * 0.72) + int(rows.min()), int(H * 0.72) + int(rows.max()) + 1
            lo, hi = min(lo, a), max(hi, b)
        if lo >= hi:                       # 采样失败 -> 退回配置值
            lo, hi = y0, y1
    cap.release()
    # 留一点余量, 并且不超出配置的下界
    lo = max(0, lo - 4)
    hi = min(cfg["size"][1], max(hi + 4, y1))
    return (x0, lo, x1, hi)


class Probe:
    def __init__(self, cfg):
        self.c = cfg
        self.W, self.H = cfg["size"]

    def region_of(self, y, x=0):
        c = self.c
        if y < c["ribbon_y"]:
            return "ribbon"
        if y >= c["cmdline_y"][0]:
            return "cmdline"
        if c["view3d_x"] and x >= c["view3d_x"]:
            return "view3d"
        return "canvas"

    def find_crosshair(self, gray):
        """è®²å¸ˆå¼€äº†å…¨å±åå­—å…‰æ ‡: å½“å‰å¸§æœ€é•¿äº®ç«–çº¿/æ¨ªçº¿çš„äº¤ç‚¹å³å…‰æ ‡ã€‚"""
        x0, y0, x1, y1 = self.c["cross_canvas"]
        bright = (gray[y0:y1, x0:x1] > 100).astype(np.uint8)
        colcnt, rowcnt = bright.sum(axis=0), bright.sum(axis=1)
        ci, ri = int(colcnt.argmax()), int(rowcnt.argmax())
        if colcnt[ci] >= self.c["cross_col_min"] and rowcnt[ri] >= self.c["cross_row_min"]:
            return ci + x0, ri + y0
        return None

    def find_view3d_cursor(self, gray, last):
        """3D 视口没有全屏十字线, 只有一个小十字/方框光标。

        局部结构检测: 在右视口里找"短竖臂与短横臂相交"的点。
        只在 2D 十字线失败且存在 3D 视口时才跑, 不拖慢主路径。
        """
        vx = self.c.get("view3d_x")
        if not vx:
            return None
        cx0, cy0, cx1, cy1 = self.c["canvas"]
        x0 = max(int(vx), int(cx0))
        if cx1 - x0 < 40:
            return None
        roi = gray[cy0:cy1, x0:cx1]
        bw = (roi > 110).astype(np.uint8)
        if bw.sum() < 20:
            return None
        k = 11                                   # 光标臂长约 10~24px, 比图元短
        hor = cv2.dilate(cv2.erode(bw, np.ones((1, k), np.uint8)), np.ones((1, k), np.uint8))
        ver = cv2.dilate(cv2.erode(bw, np.ones((k, 1), np.uint8)), np.ones((k, 1), np.uint8))
        cross = (hor & ver).astype(np.uint8)
        if cross.sum() == 0:
            return None
        n, _, stats, cents = cv2.connectedComponentsWithStats(cross, 8)
        best, bestd = None, 1e18
        for i in range(1, n):
            _, _, w, h, area = stats[i]
            if area < 6 or w > 60 or h > 60:     # 排除大块实体填充
                continue
            px, py = cents[i][0] + x0, cents[i][1] + cy0
            d = (px - last[0]) ** 2 + (py - last[1]) ** 2
            if d < bestd:
                best, bestd = (int(px), int(py)), d
        if best and bestd <= CURSOR_JUMP_LIMIT ** 2:
            return best
        return None

    def cursor_absent_ok(self, gray, bgr):
        """光标"合法缺席": 此时本来就不该有全屏十字线, 不算 CV 失效。

        两种情形(均已在真实素材上验证):
          a) 模态对话框覆盖画布 —— 大片浅灰底(亮度 150~245)超过画布 8%;
          b) 就地编辑器接管画布(MTEXT/表格/属性)—— 画布里出现明显的
             **彩色填充块**(编辑框背景色)。深色主题的画布本身是近黑 + 白/黄线条,
             不会有成片的高饱和彩色, 所以这个判据不会误伤正常绘图。
        """
        x0, y0, x1, y1 = self.c["canvas"]
        roi = gray[y0:y1, x0:x1]
        if roi.size == 0:
            return False
        if int(((roi > 150) & (roi < 245)).sum()) > 0.08 * roi.size:
            return True                      # (a) 对话框
        c = bgr[y0:y1, x0:x1].astype(np.int16)
        mx = c.max(axis=2)
        mn = c.min(axis=2)
        colored = ((mx - mn) > 60) & (mx > 80)   # 高饱和且不暗 = 编辑框底色
        return int(colored.sum()) > 0.02 * roi.size   # (b) 就地编辑器

    def key_zone_state(self, gray):
        kx0, ky0, kx1, ky1 = self.c["key_zone"]
        kz = gray[ky0:ky1, kx0:kx1]
        if int(((kz > 90) & (kz < 200)).sum()) < KEY_ACTIVE_MIN_PX:
            return False, None
        return True, kz.copy()

    # ------------------------------------------------------------ ä¸»æ‰«æ
    def scan(self, src, start_s, end_s):
        cap = cv2.VideoCapture(src)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        f0 = int(start_s * fps)
        f1 = min(total, int(end_s * fps)) if end_s else total
        cap.set(cv2.CAP_PROP_POS_FRAMES, f0)

        kx0, ky0, kx1, ky1 = self.c["key_zone"]
        # 命令行带可能因中途切换工作空间而移位 -> 用采样并集
        bx0, by0, bx1, by1 = union_cmd_band(src, self.c)
        traj, changes, keyframes, strips = [], [], [], []
        n_dialog = 0
        prev = prev_cross = None
        last = (self.W // 2, self.H // 2)
        cmd_last = None

        fi = f0
        while fi < f1:
            ok, bgr = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

            # (a) å‘½ä»¤è¡Œæ¡å¸¦: å†…å®¹ä¸€å˜å°±ç•™æ¡£(åŽŸç”Ÿåˆ†è¾¨çŽ‡)
            if (fi - f0) % CMD_STEP_FRAMES == 0:
                strip = bgr[by0:by1, bx0:bx1]
                g = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
                if cmd_last is None or float(np.mean(cv2.absdiff(g, cmd_last))) > CMD_DIFF_MEAN:
                    strips.append((fi, fi / fps, strip.copy()))
                    cmd_last = g

            # (b) 输入事件覆盖层
            keyframes.append(self.key_zone_state(gray))
            if self.cursor_absent_ok(gray, bgr):
                n_dialog += 1

            cross = self.find_crosshair(gray)
            if prev is None:
                if cross:
                    last = cross
                traj.append(self._pt(fi, fps, last, "cross" if cross else "none"))
                changes.append({"px": 0, "bbox": None, "regions": {}})
                prev, prev_cross = gray, cross
                fi += 1
                continue

            # (c) å¸§å·®åˆ†, å‰”é™¤ä»»åŠ¡æ /è¦†ç›–å±‚/åå­—çº¿è‡ªèº«
            mask = (cv2.absdiff(gray, prev) > DIFF_THRESH).astype(np.uint8)
            mask[self.c["taskbar_y"]:, :] = 0
            mask[ky0:ky1, kx0:kx1] = 0
            for pt in (cross, prev_cross):
                if pt:
                    mask[:, max(0, pt[0] - 3):pt[0] + 4] = 0
                    mask[max(0, pt[1] - 3):pt[1] + 4, :] = 0

            mode = "none"
            if cross:
                last, mode = cross, "cross"
            else:
                v3 = self.find_view3d_cursor(gray, last)
                if v3:
                    last, mode = v3, "view3d"
            n, _, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
            cands, blobs = [], []
            for i in range(1, n):
                x, y, w, h, area = stats[i]
                if area <= CURSOR_BLOB_MAX_AREA and w <= 90 and h <= 90:
                    cands.append((cents[i][0], cents[i][1], area))
                if area > 40:
                    blobs.append((x, y, w, h, area))
            if not cross and cands:  # å…œåº•: è·ä¸Šä¸€ä½ç½®æœ€è¿‘ä¸”ä½ç§»å—é™çš„å°æ–‘å—
                cd = min(cands, key=lambda c: math.hypot(c[0] - last[0], c[1] - last[1]))
                if math.hypot(cd[0] - last[0], cd[1] - last[1]) <= CURSOR_JUMP_LIMIT:
                    last, mode = (int(cd[0]), int(cd[1])), "diff"
            traj.append(self._pt(fi, fps, last, mode))
            ch = self._change(blobs, last)
            ch["annot"] = self._annot_ratio(bgr, mask)
            changes.append(ch)
            prev, prev_cross = gray, cross
            fi += 1

        cap.release()
        return fps, f0, traj, changes, keyframes, strips, n_dialog

    def _pt(self, fi, fps, last, mode):
        return {"f": fi, "t": round(fi / fps, 3), "x": last[0], "y": last[1],
                "found": mode != "none", "mode": mode}

    @staticmethod
    def _annot_ratio(bgr, mask):
        """变化像素里"暖色高饱和"(讲师红/橙笔)的占比。

        AutoCAD 几何是白色(R≈G≈B), 标注是黄色(R,G 都高), 都不满足 G 低这一条,
        所以不会被误判成讲师标注。
        """
        n = int(mask.sum())
        if n < 40:
            return 0.0
        b = bgr[:, :, 0].astype(np.int16)
        g = bgr[:, :, 1].astype(np.int16)
        r = bgr[:, :, 2].astype(np.int16)
        warm = ((r > 120) & (r - b > 60) & (g < 190) & (r - g > 30)).astype(np.uint8)
        return round(float((warm & mask).sum()) / n, 3)

    def _change(self, blobs, last):
        px = 0
        bx0, by0, bx1, by1 = self.W, self.H, 0, 0
        regions = {}
        for x, y, w, h, area in blobs:
            cx, cy = x + w / 2, y + h / 2
            if math.hypot(cx - last[0], cy - last[1]) < 40 and area < 2500:
                continue  # 光标残迹
            px += int(area)
            bx0, by0 = min(bx0, x), min(by0, y)
            bx1, by1 = max(bx1, x + w), max(by1, y + h)
            r = self.region_of(cy, cx)
            regions[r] = regions.get(r, 0) + int(area)
        return {"px": px, "bbox": [int(bx0), int(by0), int(bx1), int(by1)] if px else None,
                "regions": regions}


# ---------------------------------------------------------------- åŽå¤„ç†
def smooth(traj, win=5):
    xs = [p["x"] for p in traj]
    ys = [p["y"] for p in traj]
    h = win // 2
    for i, p in enumerate(traj):
        lo, hi = max(0, i - h), min(len(traj), i + h + 1)
        p["sx"], p["sy"] = int(np.median(xs[lo:hi])), int(np.median(ys[lo:hi]))
    return traj


def group_inputs(keyframes, traj):
    """è¦†ç›–å±‚æ…¢æ·¡å‡º: åªæœ‰å†…å®¹å‡ºçŽ°/å˜åŒ–çš„çž¬é—´ t0 æ˜¯çœŸå®žæŒ‰é”®æ—¶åˆ», æ—¶é•¿æ— æ„ä¹‰ã€‚"""
    events, cur, ref = [], None, None
    for i, (active, crop) in enumerate(keyframes):
        if active:
            if cur is None:
                cur, ref = {"i0": i, "i1": i}, crop
            else:
                d = float(np.mean(cv2.absdiff(crop, ref))) \
                    if ref is not None and crop.shape == ref.shape else 99
                if d > KEY_SPLIT_DIFF:
                    events.append(cur)
                    cur = {"i0": i, "i1": i}
                else:
                    cur["i1"] = i
                ref = crop
        elif cur is not None:
            if cur["i1"] - cur["i0"] >= 1:
                events.append(cur)
            cur = ref = None
    if cur is not None:
        events.append(cur)
    return [{"id": f"in-{k:04d}", "f0": traj[e["i0"]]["f"], "f1": traj[e["i1"]]["f"],
             "t0": traj[e["i0"]]["t"], "t1": traj[e["i1"]]["t"],
             "fCrop": traj[min(e["i0"] + 1, e["i1"])]["f"],
             "cursorAt": [traj[e["i0"]]["x"], traj[e["i0"]]["y"]]}
            for k, e in enumerate(events)]


def group_episodes(changes, traj, min_px, W, H):
    eps, cur, gap = [], None, 0
    for i, fc in enumerate(changes):
        if fc["px"] >= min_px:
            if cur is None:
                cur = {"i0": i, "i1": i, "peak": 0, "bbox": None, "regions": {}}
            cur["i1"], cur["peak"], gap = i, max(cur["peak"], fc["px"]), 0
            cur.setdefault("annot", []).append(fc.get("annot", 0.0))
            if fc["bbox"]:
                b = fc["bbox"]
                cur["bbox"] = list(b) if cur["bbox"] is None else [
                    min(cur["bbox"][0], b[0]), min(cur["bbox"][1], b[1]),
                    max(cur["bbox"][2], b[2]), max(cur["bbox"][3], b[3])]
            for r, v in fc["regions"].items():
                cur["regions"][r] = cur["regions"].get(r, 0) + v
        elif cur is not None:
            gap += 1
            if gap > EPISODE_GAP:
                eps.append(cur)
                cur, gap = None, 0
    if cur is not None:
        eps.append(cur)

    out = []
    for k, e in enumerate(eps):
        area = (e["bbox"][2] - e["bbox"][0]) * (e["bbox"][3] - e["bbox"][1]) if e["bbox"] else 0
        out.append({
            "id": f"ep-{k:04d}", "f0": traj[e["i0"]]["f"], "f1": traj[e["i1"]]["f"],
            "t0": traj[e["i0"]]["t"], "t1": traj[e["i1"]]["t"], "peakPx": e["peak"],
            "bbox": e["bbox"], "bboxArea": int(area),
            "annotRatio": round(sum(e.get("annot") or [0]) / max(1, len(e.get("annot") or [1])), 3),
            "dominantRegion": max(e["regions"], key=e["regions"].get) if e["regions"] else "unknown",
            "regions": e["regions"],
            "sceneCut": area > SCENE_CUT_RATIO * W * H and e["peak"] > 0.25 * W * H,
        })
    return out


def find_pauses(traj):
    out, run = [], []
    for i in range(1, len(traj)):
        if math.hypot(traj[i]["x"] - traj[i - 1]["x"], traj[i]["y"] - traj[i - 1]["y"]) <= PAUSE_SPEED:
            run.append(i)
        else:
            if len(run) >= PAUSE_MIN_FRAMES:
                out.append({"i1": run[-1], "x": traj[run[-1]]["x"], "y": traj[run[-1]]["y"]})
            run = []
    if len(run) >= PAUSE_MIN_FRAMES:
        out.append({"i1": run[-1], "x": traj[run[-1]]["x"], "y": traj[run[-1]]["y"]})
    return out


def split_at_inputs(ep, inputs):
    """é•¿ç‰‡æ®µæŒ‰è¾“å…¥æ—¶åˆ»åˆ‡åˆ†(CAD ç‚¹å‡»-ç‚¹å‡»è¯­ä¹‰: æ¯æ¬¡è¾“å…¥å¼€å¯æ–°çš„ä¸€æ­¥)ã€‚"""
    cuts = sorted(k["t0"] for k in inputs if ep["t0"] + 0.3 < k["t0"] < ep["t1"] - 0.15)
    if not cuts or (ep["t1"] - ep["t0"]) < 1.2:
        return [(ep["t0"], ep["t1"], ep["f0"], ep["f1"])]
    ratio = (ep["f1"] - ep["f0"]) / max(0.04, ep["t1"] - ep["t0"])
    b = [ep["t0"]] + cuts + [ep["t1"]]
    return [(b[i], b[i + 1], ep["f0"] + int((b[i] - ep["t0"]) * ratio),
             ep["f0"] + int((b[i + 1] - ep["t0"]) * ratio)) for i in range(len(b) - 1)]


def assemble(episodes, pauses, inputs, traj):
    """æœ´ç´ è§„åˆ™å½’ç±»ã€‚CV åªç»™å€™é€‰ä¸Žä¾æ®, åˆ é™¤/æ”¹åˆ¤æƒå½’ agentã€‚"""
    acts = []
    for ep in episodes:
        if ep["sceneCut"]:
            acts.append({"type": "scene_cut", "episode": ep["id"], "t0": ep["t0"], "t1": ep["t1"]})
            continue
        for (t0, t1, f0, f1) in split_at_inputs(ep, inputs):
            i0 = next((i for i, p in enumerate(traj) if p["f"] >= f0), 0)
            near = None
            for p in pauses:
                if traj[p["i1"]]["t"] <= t0 + 0.08 and t0 - traj[p["i1"]]["t"] <= 0.6:
                    near = p
            seg = [p for p in traj if f0 <= p["f"] <= f1]
            moved = sum(math.hypot(seg[i]["sx"] - seg[i - 1]["sx"], seg[i]["sy"] - seg[i - 1]["sy"])
                        for i in range(1, len(seg))) if len(seg) > 1 else 0
            ins = [k["id"] for k in inputs if t0 - 0.45 <= k["t0"] <= t1 + 0.25]

            if ep["dominantRegion"] == "cmdline" and moved < 30:
                t = "cmdline_echo"
            elif moved > 60 and (t1 - t0) > 0.3 and ep["dominantRegion"] in ("canvas", "view3d"):
                t = "interactive_draw" if ins else "move_with_preview"
            elif ins and near is not None:
                t = "click_or_key_at_pause"
            elif near is not None:
                t = "click_like"
            elif ins:
                t = "input_triggered_change"
            elif ep.get("annotRatio", 0) >= ANNOT_RATIO_GATE:
                t = "presenter_annotation"     # 讲师圈画, 非软件操作
            else:
                t = "unattributed_change"

            cx = near["x"] if near else traj[i0]["x"]
            cy = near["y"] if near else traj[i0]["y"]
            acts.append({"type": t, "episode": ep["id"], "t0": round(t0, 2), "t1": round(t1, 2),
                         "f0": int(f0), "f1": int(f1), "cursor": [int(cx), int(cy)],
                         "bbox": ep["bbox"], "dominantRegion": ep["dominantRegion"],
                         "peakPx": ep["peakPx"], "inputs": ins, "cursorPathPx": round(moved, 1)})
    for k, a in enumerate(acts):
        a["id"] = f"act-{k:04d}"
    return acts


# ---------------------------------------------------------------- è½ç›˜
def write_cmd(out, strips, band):
    sdir, mdir = os.path.join(out, "cmdstrips"), os.path.join(out, "cmdmont")
    os.makedirs(sdir, exist_ok=True)
    os.makedirs(mdir, exist_ok=True)
    w = band[2] - band[0]
    files = []
    for fi, t, im in strips:
        p = os.path.join(sdir, f"cs_{int(t * 10):05d}.png")
        cv2.imwrite(p, im)
        files.append((im, t))
    for m in range(0, len(files), CMD_PER_MONTAGE):
        tiles = []
        for im, t in files[m:m + CMD_PER_MONTAGE]:
            im = im.copy()
            cv2.putText(im, f"{t:.1f}s", (w - 120, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
            cv2.line(im, (0, 0), (w, 0), (0, 120, 0), 2)
            tiles.append(im)
        cv2.imwrite(os.path.join(mdir, f"m{m // CMD_PER_MONTAGE:02d}.png"), np.vstack(tiles))
    return len(files), (len(files) + CMD_PER_MONTAGE - 1) // CMD_PER_MONTAGE


def crop(img, cx, cy, half):
    x0, y0 = max(0, int(cx) - half), max(0, int(cy) - half)
    x1, y1 = min(img.shape[1], int(cx) + half), min(img.shape[0], int(cy) + half)
    return img[y0:y1, x0:x1]


def write_slices(src, out, acts, inputs, changes, traj, f0, key_zone):
    cap = cv2.VideoCapture(src)
    sdir = os.path.join(out, "slices")
    os.makedirs(sdir, exist_ok=True)

    def grab(f):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, im = cap.read()
        return im if ok else None

    def idx(f):
        return max(0, min(len(changes) - 1, f - f0))

    def stable(f, step):
        j, run = idx(f) + step, 0
        while 0 <= j < len(changes):
            run = run + 1 if changes[j]["px"] <= STABLE_MAX_PX else 0
            if run >= 3:
                return traj[j]["f"]
            j += step
        return traj[0]["f"] if step < 0 else traj[-1]["f"]

    for a in acts:
        if a["type"] == "scene_cut":
            continue
        fb, fa = stable(a["f0"], -1), stable(a["f1"], 1)
        a["fBefore"], a["fAfter"] = int(fb), int(fa)
        before, after, trig = grab(fb), grab(fa), grab(a["f0"])
        if before is None or after is None:
            continue
        pre = os.path.join(sdir, a["id"])
        for tag, img in (("before", before.copy()), ("after", after.copy())):
            cv2.drawMarker(img, tuple(a["cursor"]), (0, 0, 255), cv2.MARKER_CROSS, 28, 2)
            cv2.circle(img, tuple(a["cursor"]), 16, (0, 0, 255), 2)
            cv2.imwrite(pre + f"_{tag}.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        if trig is not None:  # 目标特写: 原生分辨率, 让 agent 看清按的是哪个按钮
            cv2.imwrite(pre + "_target.png", crop(trig, a["cursor"][0], a["cursor"][1], 90))
        if a["bbox"]:
            x0, y0, x1, y1 = a["bbox"]
            mx, my = (x0 + x1) // 2, (y0 + y1) // 2
            half = max(60, (max(x1 - x0, y1 - y0) // 2) + 15)
            cv2.imwrite(pre + "_change_before.png", crop(before, mx, my, half))
            cv2.imwrite(pre + "_change_after.png", crop(after, mx, my, half))
        if a["type"] in ("interactive_draw", "move_with_preview"):
            img = after.copy()
            seg = [(p["sx"], p["sy"]) for p in traj if a["f0"] <= p["f"] <= a["f1"]]
            for i in range(1, len(seg)):
                cv2.line(img, seg[i - 1], seg[i], (0, 255, 255), 2)
            if seg:
                cv2.circle(img, seg[0], 8, (0, 255, 0), 2)
                cv2.circle(img, seg[-1], 8, (0, 0, 255), 2)
            cv2.imwrite(pre + "_path.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])

    kx0, ky0, kx1, ky1 = key_zone
    for k in inputs:
        im = grab(k["fCrop"])
        if im is not None:
            cv2.imwrite(os.path.join(sdir, k["id"] + ".png"), im[ky0:ky1, kx0:kx1])
    cap.release()


def write_index(out, acts):
    rows = []
    for a in acts:
        if a["type"] == "scene_cut":
            rows.append(f'<tr class=cut><td>{a["episode"]}</td><td colspan=5>scene_cut '
                        f'{a["t0"]}–{a["t1"]}s</td></tr>')
            continue
        imgs = "".join(f'<img src="slices/{a["id"]}_{s}.jpg" loading=lazy onerror="this.remove()">'
                       for s in ("before", "after", "path"))
        imgs += "".join(f'<img class=s src="slices/{a["id"]}_{s}.png" loading=lazy onerror="this.remove()">'
                        for s in ("target", "change_before", "change_after"))
        keys = " ".join(f'<img class=k src="slices/{k}.png">' for k in a.get("inputs", []))
        rows.append(f'<tr><td>{a["id"]}</td><td>{a["type"]}</td><td>{a["t0"]:.2f}–{a["t1"]:.2f}s</td>'
                    f'<td>{a["dominantRegion"]}<br>peak {a["peakPx"]}<br>path {a["cursorPathPx"]}</td>'
                    f'<td>{keys}</td><td class=imgs>{imgs}</td></tr>')
    html = ('<meta charset=utf-8><style>body{font:13px sans-serif;background:#111;color:#ddd}'
            'table{border-collapse:collapse}td{border:1px solid #333;padding:4px;vertical-align:top}'
            'img{height:130px;margin:2px}img.s{height:100px}img.k{height:44px}'
            '.cut td{color:#888}.imgs{max-width:1100px}</style><table>'
            '<tr><th>id<th>type<th>time<th>signal<th>inputs<th>evidence</tr>' + "".join(rows) + '</table>')
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--layout", default="auto")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--end", type=float, default=0)
    ap.add_argument("--no-slices", action="store_true")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps0 = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    name, cfg = pick_layout(args.layout, w, h, args.video)
    os.makedirs(args.out, exist_ok=True)

    probe = Probe(cfg)
    fps, f0, traj, changes, keyframes, strips, n_dialog = probe.scan(
        args.video, args.start, args.end)
    traj = smooth(traj)
    inputs = group_inputs(keyframes, traj)
    episodes = group_episodes(changes, traj, cfg["ui_change_min_px"], probe.W, probe.H)
    acts = assemble(episodes, find_pauses(traj), inputs, traj)
    nstrip, nmont = write_cmd(args.out, strips, cfg["cmd_band"])
    if not args.no_slices:
        write_slices(args.video, args.out, acts, inputs, changes, traj, f0, cfg["key_zone"])
    write_index(args.out, acts)

    for fn, data in (("trajectory", traj), ("episodes", episodes),
                     ("input_events", inputs), ("actions", acts)):
        with open(os.path.join(args.out, fn + ".json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)

    modes, types = {}, {}
    for p in traj:
        modes[p["mode"]] = modes.get(p["mode"], 0) + 1
    for a in acts:
        types[a["type"]] = types.get(a["type"], 0) + 1
    manifest = {"version": VERSION, "video": os.path.basename(args.video),
                "size": [w, h], "fps": fps0, "frames": nframes, "layout": name,
                "scanned": len(traj), "cursorModes": modes, "episodes": len(episodes),
                "inputEvents": len(inputs), "actionTypes": types,
                "cmdStrips": nstrip, "cmdMontages": nmont,
                "cursorAbsentOkFrames": n_dialog}
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()

