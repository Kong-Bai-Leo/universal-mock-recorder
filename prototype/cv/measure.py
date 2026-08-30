# -*- coding: utf-8 -*-
"""ç»ˆæ€ç”»å¸ƒå‡ ä½•æµ‹é‡å™¨: ä»Žä¸€å¸§é‡Œæå–çº¿æ®µ/åœ†/åœ†å¼§, è¾“å‡º JSON + å åŠ æ ¡éªŒå›¾ã€‚

ç”¨äºŽå¾’æ‰‹ç»˜åˆ¶(å‘½ä»¤è¡Œæ²¡æœ‰ç•™ä¸‹åæ ‡)çš„å†…å®¹ â€”â€” ç”¨åƒç´ æµ‹é‡ä»£æ›¿çŒœæµ‹ã€‚
用法: py -3.11 cv/measure.py <video.mp4> <t_seconds> <out_prefix>
      [--roi x0,y0,x1,y1] [--layout acad720|acad1080] [--minlen N] [--minr N] [--maxr N]
"""
import argparse
import json
import math

import cv2
import numpy as np

CANVAS = {"acad720": (0, 128, 1245, 597), "acad1080": (5, 185, 1910, 908)}


def clean(frame, canvas, color="any", cross_span=0.92):
    """color: any=å…¨éƒ¨äº®åƒç´ ; white=å‡ ä½•(ç™½/ç°); yellow=æ ‡æ³¨(é»„)ã€‚
    AutoCAD æ·±è‰²ä¸»é¢˜ä¸‹å‡ ä½•é»˜è®¤ç™½è‰², æ ‡æ³¨é»˜è®¤é»„è‰² â€”â€” è¿™æ˜¯åˆ†ç¦»ä¸¤è€…çš„å¹²å‡€ä¿¡å·ã€‚"""
    x0, y0, x1, y1 = canvas
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    m = np.zeros_like(g)
    m[y0:y1, x0:x1] = 255
    g = cv2.bitwise_and(g, m)
    bw = (g > 90).astype(np.uint8)
    if color != "any":
        b, gr, r = frame[:, :, 0].astype(int), frame[:, :, 1].astype(int), frame[:, :, 2].astype(int)
        if color == "white":
            sel = (abs(r - b) < 45) & (abs(gr - b) < 45)
        else:  # yellow: R,G 高而 B 低
            sel = (r - b > 55) & (gr - b > 45)
        bw = (bw & sel.astype(np.uint8))
    # åŽ»æŽ‰è´¯ç©¿å…¨å±çš„åå­—å…‰æ ‡çº¿
    # 去掉贯穿全屏的十字光标线。判据同时要求"够长"和"够细":
    # 光标线贯穿整个画布且只有 1~3px 宽, 而图纸里的长直线(轴线/参照线)
    # 通常更宽或不贯穿 —— 只按长度判会误删它们。
    col, row = bw.sum(axis=0), bw.sum(axis=1)
    Hh, Ww = bw.shape
    for c in np.where(col > cross_span * (y1 - y0))[0]:
        lo, hi = max(0, c - 4), min(Ww, c + 5)
        if int((col[lo:hi] > cross_span * (y1 - y0)).sum()) <= 3:
            bw[:, max(0, c - 2):c + 3] = 0
    for r in np.where(row > cross_span * (x1 - x0))[0]:
        lo, hi = max(0, r - 4), min(Hh, r + 5)
        if int((row[lo:hi] > cross_span * (x1 - x0)).sum()) <= 3:
            bw[max(0, r - 2):r + 3, :] = 0
    return bw * 255


def ring_support(bw, x, y, r, tol=2.5):
    hits, n = 0, 72
    for k in range(n):
        a = 2 * math.pi * k / n
        px, py = x + r * math.cos(a), y + r * math.sin(a)
        ax0, ay0, ax1, ay1 = int(px - tol), int(py - tol), int(px + tol) + 1, int(py + tol) + 1
        if 0 <= ax0 and ax1 < bw.shape[1] and 0 <= ay0 and ay1 < bw.shape[0] and bw[ay0:ay1, ax0:ax1].any():
            hits += 1
    return hits / n


def arc_extent(bw, x, y, r, tol=2.5, n=360):
    """返回圆周上有像素支撑的角度区间列表 [(a0,a1)...] (度, CAD 逆时针) 与总覆盖率。"""
    hit = []
    for k in range(n):
        a = 2 * math.pi * k / n
        px, py = x + r * math.cos(a), y - r * math.sin(a)   # 图像 y 向下 -> CAD 角度取负
        x0, y0, x1, y1 = int(px - tol), int(py - tol), int(px + tol) + 1, int(py + tol) + 1
        ok = (0 <= x0 and x1 < bw.shape[1] and 0 <= y0 and y1 < bw.shape[0]
              and bw[y0:y1, x0:x1].any())
        hit.append(ok)
    cover = sum(hit) / n
    # 找连续段(环形), 容忍 <=6 度的缺口
    if cover > 0.97:
        return [], cover
    runs, i = [], 0
    while i < n and hit[i]:
        i += 1
    if i == n:
        return [], cover
    start = None
    gap = 0
    for k in range(n + 1):
        j = (i + k) % n
        if k == n:
            if start is not None:
                runs.append((start, (i + k - 1 - gap) % n))
            break
        if hit[j]:
            if start is None:
                start = j
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap > 6:
                    runs.append((start, (j - gap) % n))
                    start, gap = None, 0
    return [(a0 * 360.0 / n, a1 * 360.0 / n) for a0, a1 in runs
            if ((a1 - a0) % n) * 360.0 / n >= 12], cover


def seg_support(bw, p, q, tol=2):
    n, hits = 40, 0
    for k in range(n + 1):
        t = k / n
        x, y = p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])
        x0, y0, x1, y1 = int(x - tol), int(y - tol), int(x + tol) + 1, int(y + tol) + 1
        if 0 <= x0 and x1 < bw.shape[1] and 0 <= y0 and y1 < bw.shape[0] and bw[y0:y1, x0:x1].any():
            hits += 1
    return hits / (n + 1)


def merge_segments(segs, ang_tol=0.06, off_tol=6, gap=25):
    """åˆå¹¶å…±çº¿ä¸”é¦–å°¾æŽ¥è¿‘çš„çº¿æ®µã€‚"""
    out = []
    for s in sorted(segs, key=lambda s: -math.hypot(s[2] - s[0], s[3] - s[1])):
        a = math.atan2(s[3] - s[1], s[2] - s[0]) % math.pi
        merged = False
        for o in out:
            ao = math.atan2(o[3] - o[1], o[2] - o[0]) % math.pi
            if min(abs(a - ao), math.pi - abs(a - ao)) > ang_tol:
                continue
            # ç‚¹åˆ°ç›´çº¿è·ç¦»
            dx, dy = o[2] - o[0], o[3] - o[1]
            L = math.hypot(dx, dy) or 1
            d = abs((s[0] - o[0]) * dy - (s[1] - o[1]) * dx) / L
            if d > off_tol:
                continue
            pts = [(o[0], o[1]), (o[2], o[3]), (s[0], s[1]), (s[2], s[3])]
            far = max(((math.hypot(p[0] - q[0], p[1] - q[1]), p, q)
                       for p in pts for q in pts), key=lambda t: t[0])
            if far[0] > L + math.hypot(s[2] - s[0], s[3] - s[1]) + gap:
                continue
            o[0], o[1], o[2], o[3] = far[1][0], far[1][1], far[2][0], far[2][1]
            merged = True
            break
        if not merged:
            out.append(list(s))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("t", type=float)
    ap.add_argument("prefix")
    ap.add_argument("--roi", default=None)
    ap.add_argument("--layout", default="acad720")
    ap.add_argument("--minlen", type=int, default=40)
    ap.add_argument("--minr", type=int, default=10)
    ap.add_argument("--maxr", type=int, default=300)
    ap.add_argument("--support", type=float, default=0.7)
    ap.add_argument("--color", default="any", choices=["any", "white", "yellow"])
    ap.add_argument("--cross-span", type=float, default=0.92, dest="cross_span",
                    help="十字光标线判定的画布跨度比例(越大越保守)")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(args.t * fps))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("读帧失败")

    canvas = CANVAS[args.layout]
    bw = clean(frame, canvas, args.color, args.cross_span)
    if args.roi:
        x0, y0, x1, y1 = (int(v) for v in args.roi.split(","))
        roi = np.zeros_like(bw)
        roi[y0:y1, x0:x1] = bw[y0:y1, x0:x1]
    else:
        roi = bw

    circles = []
    blur = cv2.GaussianBlur(roi, (5, 5), 1.2)
    cir = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2, minDist=max(12, args.minr),
                           param1=120, param2=22, minRadius=args.minr, maxRadius=args.maxr)
    if cir is not None:
        for x, y, r in cir[0]:
            if ring_support(roi, x, y, r) >= args.support:
                if all(math.hypot(x - c[0], y - c[1]) > 10 or abs(r - c[2]) > 6 for c in circles):
                    circles.append([round(float(x), 1), round(float(y), 1), round(float(r), 1)])

    work = roi.copy()
    for c in circles:
        cv2.circle(work, (int(c[0]), int(c[1])), int(c[2]), 0, 9)
    segs = cv2.HoughLinesP(work, 1, np.pi / 360, args.minlen,
                           minLineLength=args.minlen, maxLineGap=8)
    raw = [tuple(int(v) for v in s[0]) for s in segs] if segs is not None else []
    lines = [s for s in merge_segments(raw)
             if seg_support(work, (s[0], s[1]), (s[2], s[3])) >= 0.8
             and math.hypot(s[2] - s[0], s[3] - s[1]) >= args.minlen]

    # 椭圆: 对轮廓做椭圆拟合(圆已在上一步吃掉, 这里只留明显非圆的)
    ellipses = []
    cnts, _ = cv2.findContours(roi, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    for c in cnts:
        if len(c) < 40 or cv2.arcLength(c, True) < 90:
            continue
        (ex, ey), (MA, ma), ang = cv2.fitEllipse(c)
        a, b = max(MA, ma) / 2, min(MA, ma) / 2
        if b < 8 or a > 400 or a / max(b, 1e-6) > 6:
            continue
        # 验证: 椭圆周上像素支撑
        hits, n = 0, 72
        for k in range(n):
            th = 2 * math.pi * k / n
            px = ex + a * math.cos(th) * math.cos(math.radians(ang - 90)) - \
                 b * math.sin(th) * math.sin(math.radians(ang - 90))
            py = ey + a * math.cos(th) * math.sin(math.radians(ang - 90)) + \
                 b * math.sin(th) * math.cos(math.radians(ang - 90))
            x0, y0, x1, y1 = int(px - 3), int(py - 3), int(px + 4), int(py + 4)
            if 0 <= x0 and x1 < roi.shape[1] and 0 <= y0 and y1 < roi.shape[0] and roi[y0:y1, x0:x1].any():
                hits += 1
        if hits / n < 0.85:
            continue
        if a / b < 1.12:           # 近圆的交给圆检测
            continue
        if any(math.hypot(ex - e["c"][0], ey - e["c"][1]) < 12 and abs(a - e["a"]) < 8
               for e in ellipses):
            continue
        ellipses.append({"c": [round(ex, 1), round(ey, 1)], "a": round(a, 1),
                         "b": round(b, 1), "rot": round((ang - 90) % 180, 1)})

    # 把覆盖率不足的"圆"拆成圆弧
    full, arcs = [], []
    for c in circles:
        runs, cover = arc_extent(roi, c[0], c[1], c[2])
        if cover > 0.9 or not runs:
            full.append(c)
        else:
            for a0, a1 in runs:
                arcs.append({"c": [c[0], c[1]], "r": c[2],
                             "a0": round(a0, 1), "a1": round(a1, 1)})
    circles = full

    ov = frame.copy()
    for c in circles:
        cv2.circle(ov, (int(c[0]), int(c[1])), int(c[2]), (0, 255, 0), 2)
    for a in arcs:
        cv2.ellipse(ov, (int(a["c"][0]), int(a["c"][1])), (int(a["r"]), int(a["r"])),
                    0, -a["a1"], -a["a0"], (255, 0, 255), 2)
    for e in ellipses:
        cv2.ellipse(ov, (int(e["c"][0]), int(e["c"][1])), (int(e["a"]), int(e["b"])), e["rot"], 0, 360, (255, 255, 0), 2)
    for s in lines:
        cv2.line(ov, (s[0], s[1]), (s[2], s[3]), (0, 200, 255), 2)
    cv2.imwrite(args.prefix + "_overlay.png", ov)
    data = {"t": args.t, "arcs": arcs, "circles": circles, "ellipses": ellipses,
            "lines": [{"p0": [s[0], s[1]], "p1": [s[2], s[3]],
                       "len": round(math.hypot(s[2] - s[0], s[3] - s[1]), 1),
                       "ang": round(math.degrees(math.atan2(-(s[3] - s[1]), s[2] - s[0])) % 180, 1)}
                      for s in lines]}
    with open(args.prefix + ".json", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(json.dumps({"circles": len(circles), "arcs": len(arcs), "ellipses": len(ellipses), "lines": len(lines)}, ensure_ascii=False))


if __name__ == "__main__":
    main()



