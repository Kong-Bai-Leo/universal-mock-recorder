# -*- coding: utf-8 -*-
"""从选定帧精确测量场景几何(v3): 圆(霍夫+圆周支撑验证+残差最小二乘)、
轴对齐方块(线段配对)、三角形(线段聚类求交)。输出 JSON + 叠加校验图。"""
import cv2
import json
import math

import numpy as np

TRI_DEBUG = True
SRC = r'D:\Black Myth\CAD零基础入门到精通教程，设计+建模+绘图轻松搞定（浅显易懂）\8-课时8：圆形的绘制-720P 准高清-AVC.mp4'
OUT = r'C:\Users\aaron\orca\universal-mock-recorder\prototype\out\full_replica'
CANVAS = (0, 128, 1245, 600)

SCENES = [
    {"name": "s1_center_radius", "t": 213, "roi": (20, 140, 700, 590), "minR": 40, "maxR": 330,
     "lines": True, "support": 0.55},
    {"name": "s2_concentric", "t": 237, "roi": (450, 140, 950, 550), "minR": 14, "maxR": 260},
    {"name": "s3_squares_2p", "t": 314, "roi": (350, 200, 900, 360), "minR": 22, "maxR": 60,
     "quads": True, "gap": 18},
    {"name": "s4_corner_3p", "t": 386, "roi": (300, 150, 950, 570), "corner": True,
     "minR": 28, "maxR": 150, "support": 0.6, "minLen": 28},
    {"name": "s5_2p_compare", "t": 458, "roi": (10, 190, 830, 560), "minR": 20, "maxR": 220,
     "quads": True, "gap": 120},
    {"name": "s6_corner_tan", "t": 498, "roi": (300, 180, 640, 520), "corner": True,
     "minR": 25, "maxR": 140, "support": 0.6, "minLen": 28, "small_pass": True},
    {"name": "s7_flange", "t": 666, "roi": (400, 150, 700, 460), "minR": 8, "maxR": 130,
     "small_pass": True},
    {"name": "s8_rings", "t": 872, "roi": (100, 140, 860, 590), "minR": 30, "maxR": 130,
     "support": 0.6},
]


def clean_gray(frame, colT=430, rowT=900):
    x0, y0, x1, y1 = CANVAS
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mask = np.zeros_like(g)
    mask[y0:y1, x0:x1] = 255
    g = cv2.bitwise_and(g, mask)
    bw = (g > 90).astype(np.uint8)
    colcnt, rowcnt = bw.sum(axis=0), bw.sum(axis=1)
    for c in np.where(colcnt > colT)[0]:
        bw[:, max(0, c - 2):c + 3] = 0
    for r in np.where(rowcnt > rowT)[0]:
        bw[max(0, r - 2):r + 3, :] = 0
    return bw * 255


def ring_support(bw, x, y, r, tol=2.5):
    hits, n = 0, 72
    for k in range(n):
        a = 2 * math.pi * k / n
        px, py = x + r * math.cos(a), y + r * math.sin(a)
        ax0, ay0 = int(px - tol), int(py - tol)
        ax1, ay1 = int(px + tol) + 1, int(py + tol) + 1
        if 0 <= ax0 and ax1 < bw.shape[1] and 0 <= ay0 and ay1 < bw.shape[0]:
            if bw[ay0:ay1, ax0:ax1].any():
                hits += 1
    return hits / n


def hough_circles(roi, minR, maxR, support, minDist=None, param2=22):
    out = []
    blur = cv2.GaussianBlur(roi, (5, 5), 1.2)
    cir = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2,
                           minDist=minDist or max(14, minR),
                           param1=120, param2=param2, minRadius=minR, maxRadius=maxR)
    if cir is not None:
        for x, y, r in cir[0]:
            if ring_support(roi, x, y, r) >= support:
                out.append([round(float(x), 1), round(float(y), 1), round(float(r), 1)])
    return out


def segments(roi, minLen=45):
    segs = cv2.HoughLinesP(roi, 1, np.pi / 360, max(30, minLen), minLineLength=minLen, maxLineGap=8)
    return [tuple(int(v) for v in s[0]) for s in segs] if segs is not None else []


def merge_collinear(segs, axis, gap=40):
    """合并同轴共线且相近的线段(圆穿过边导致的截断)。axis=0 水平, 1 垂直。"""
    if axis == 0:
        items = [(min(s[0], s[2]), max(s[0], s[2]), (s[1] + s[3]) / 2)
                 for s in segs if abs(s[3] - s[1]) <= 3]
    else:
        items = [(min(s[1], s[3]), max(s[1], s[3]), (s[0] + s[2]) / 2)
                 for s in segs if abs(s[2] - s[0]) <= 3]
    items.sort(key=lambda a: (round(a[2] / 5), a[0]))
    merged = []
    for lo, hi, pos in items:
        if merged and abs(merged[-1][2] - pos) <= 4 and lo <= merged[-1][1] + gap:
            m = merged[-1]
            merged[-1] = (m[0], max(m[1], hi), (m[2] + pos) / 2)
        else:
            merged.append((lo, hi, pos))
    if axis == 0:
        return [(int(lo), int(p), int(hi), int(p)) for lo, hi, p in merged]
    return [(int(p), int(lo), int(p), int(hi)) for lo, hi, p in merged]


def axis_rects(segs, bw, min_side=25, gap=40, debug=False):
    """垂直线段配对 + 四边像素支撑验证成轴对齐矩形。"""
    V = [s for s in merge_collinear(segs, 1, gap) if abs(s[3] - s[1]) >= min_side]
    if debug:
        print("  V:", V)
    rects = []
    for v1 in V:
        for v2 in V:
            xa, xb = v1[0], v2[0]
            if not (min_side <= xb - xa <= 400):
                continue
            best = None
            for ya in {min(v1[1], v1[3]), min(v2[1], v2[3])}:
                for yb in {max(v1[1], v1[3]), max(v2[1], v2[3])}:
                    if abs((yb - ya) - (xb - xa)) > 0.45 * (xb - xa):
                        continue
                    sup = min(
                        seg_support(bw, (xa, ya), (xb, ya)),
                        seg_support(bw, (xa, yb), (xb, yb)),
                        seg_support(bw, (xa, ya), (xa, yb)),
                        seg_support(bw, (xb, ya), (xb, yb)),
                    )
                    if sup >= 0.55 and (best is None or sup > best[0]):
                        best = (sup, [int(xa), int(ya), int(xb), int(yb)])
            if best:
                rects.append(best[1])
    out = []
    for q in rects:
        if all(abs(q[0] - o[0]) > 10 or abs(q[1] - o[1]) > 10 for o in out):
            out.append(q)
    return out


def seg_support(bw, p, q, tol=2):
    n = 40
    hits = 0
    for k in range(n + 1):
        t = k / n
        x, y = p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])
        x0, y0, x1, y1 = int(x - tol), int(y - tol), int(x + tol) + 1, int(y + tol) + 1
        if 0 <= x0 and x1 < bw.shape[1] and 0 <= y0 and y1 < bw.shape[0] and bw[y0:y1, x0:x1].any():
            hits += 1
    return hits / (n + 1)


def triangle_from_segments(segs, bw, min_leg=30):
    """通用三角形: 最长水平段为底边, 两条最长非水平段为侧边, 求三交点并验证像素支撑。"""
    def length(s):
        return math.hypot(s[2] - s[0], s[3] - s[1])

    def inter(a, b):
        x1, y1, x2, y2 = a
        x3, y3, x4, y4 = b
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-9:
            return None
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    Hs = [s for s in merge_collinear(segs, 0) if abs(s[2] - s[0]) >= min_leg]
    sides = sorted([s for s in segs if abs(s[3] - s[1]) > 4], key=length, reverse=True)[:8]
    if TRI_DEBUG:
        print("  tri Hs:", Hs)
        print("  tri sides:", sides[:6])
    best = None
    for base in Hs:
        bx0, bx1 = sorted((base[0], base[2]))
        for i in range(len(sides)):
            for j in range(i + 1, len(sides)):
                d1, d2 = sides[i], sides[j]
                p1, p2 = inter(d1, base), inter(d2, base)
                apex = inter(d1, d2)
                if not (p1 and p2 and apex):
                    continue
                # 底边交点须在底边(允许少量外延), 顶点在底边上方
                if not (bx0 - 30 <= p1[0] <= bx1 + 30 and bx0 - 30 <= p2[0] <= bx1 + 30):
                    continue
                if abs(p1[0] - p2[0]) < 50 or apex[1] > base[1] - 25:
                    continue
                pts = [p1, p2, apex]
                sup = min(seg_support(bw, pts[a], pts[b]) for a, b in ((0, 1), (0, 2), (1, 2)))
                area = abs((p2[0] - p1[0]) * (apex[1] - base[1])) / 2
                if sup >= 0.55 and (best is None or area > best[0]):
                    best = (area, [[round(p[0], 1), round(p[1], 1)] for p in pts])
    return (best[1] if best else None), []


def fit_residual_circle(roi, tri_lines, rmin, rmax):
    """去掉三角形边像素后,对剩余亮点做最小二乘圆拟合(Kasa)。"""
    work = roi.copy()
    for s in tri_lines:
        cv2.line(work, (s[0], s[1]), (s[2], s[3]), 0, 9)
    ys, xs = np.nonzero(work)
    if len(xs) < 60:
        return None
    A = np.column_stack([xs, ys, np.ones_like(xs)]).astype(float)
    b = (xs.astype(float) ** 2 + ys.astype(float) ** 2)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = sol[0] / 2, sol[1] / 2
    r = math.sqrt(max(1e-9, sol[2] + cx * cx + cy * cy))
    if not (rmin <= r <= rmax):
        return None
    # 一轮内点重拟合
    d = np.abs(np.hypot(xs - cx, ys - cy) - r)
    keep = d < 6
    if keep.sum() > 60:
        A, b = A[keep], b[keep]
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        cx, cy = sol[0] / 2, sol[1] / 2
        r = math.sqrt(max(1e-9, sol[2] + cx * cx + cy * cy))
    return [round(cx, 1), round(cy, 1), round(r, 1)]


def extend_line(bw, seg, gap_tol=3):
    """沿线段方向向两端延伸,直到连续 gap_tol 像素无亮点。返回延伸后的端点。"""
    x0, y0, x1, y1 = seg
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L

    def walk(px, py, dx, dy):
        gap, t = 0, 0.0
        ex, ey = px, py
        while gap <= gap_tol:
            t += 1
            x, y = px + dx * t, py + dy * t
            ix, iy = int(round(x)), int(round(y))
            if not (2 <= ix < bw.shape[1] - 2 and 2 <= iy < bw.shape[0] - 2):
                break
            if bw[iy - 2:iy + 3, ix - 2:ix + 3].any():
                ex, ey, gap = x, y, 0
            else:
                gap += 1
        return ex, ey

    ax, ay = walk(x0, y0, -ux, -uy)
    bx, by = walk(x1, y1, ux, uy)
    return [round(ax, 1), round(ay, 1), round(bx, 1), round(by, 1)]


def main():
    cap = cv2.VideoCapture(SRC)
    results, tiles = {}, []
    for sc in SCENES:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(sc["t"] * 25))
        ok, frame = cap.read()
        bw = clean_gray(frame)
        x0, y0, x1, y1 = sc["roi"]
        roi = np.zeros_like(bw)
        roi[y0:y1, x0:x1] = bw[y0:y1, x0:x1]

        found = {"circles": [], "quads": [], "tri": None, "lines": []}
        segs = segments(roi, sc.get("minLen", 45))

        if sc.get("corner"):
            # 场景 = 两条线组成的"角" + 一个圆
            found["circles"] = hough_circles(roi, sc["minR"], sc["maxR"], sc["support"],
                                             param2=sc.get("param2", 22))
            if not found["circles"] and sc.get("seed"):
                # 种子精化: 只取种子圆环邻域内的亮像素做最小二乘
                sx, sy, sr = sc["seed"]
                work = roi.copy()
                for s in segs:
                    if math.hypot(s[2] - s[0], s[3] - s[1]) > 120:
                        cv2.line(work, (s[0], s[1]), (s[2], s[3]), 0, 9)
                ys0, xs0 = np.nonzero(work)
                cx, cy, r = float(sx), float(sy), float(sr)
                for band in (25, 6):
                    d = np.abs(np.hypot(xs0 - cx, ys0 - cy) - r)
                    xs, ys = xs0[d < band], ys0[d < band]
                    if len(xs) < 80:
                        break
                    A = np.column_stack([xs, ys, np.ones_like(xs)]).astype(float)
                    b = xs.astype(float) ** 2 + ys.astype(float) ** 2
                    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
                    cx, cy = sol[0] / 2, sol[1] / 2
                    r = math.sqrt(max(1e-9, sol[2] + cx * cx + cy * cy))
                else:
                    found["circles"].append([round(cx, 1), round(cy, 1), round(r, 1)])
            if sc.get("small_pass"):
                for c in hough_circles(roi, 8, 24, 0.6, minDist=10):
                    if all(math.hypot(c[0] - o[0], c[1] - o[1]) > 12 or abs(c[2] - o[2]) > 6
                           for o in found["circles"]):
                        found["circles"].append(c)
            work = roi.copy()
            for c in found["circles"]:
                cv2.circle(work, (int(c[0]), int(c[1])), int(c[2]), 0, 13)
            segs2 = segments(work, sc.get("minLen", 45))
            Hs = [s for s in merge_collinear(segs2, 0) if abs(s[2] - s[0]) >= 60]
            Ds = sorted([s for s in segs2 if abs(s[3] - s[1]) > 6 and abs(s[2] - s[0]) > 6],
                        key=lambda s: math.hypot(s[2] - s[0], s[3] - s[1]), reverse=True)
            if Hs:
                found["lines"].append(extend_line(roi, max(Hs, key=lambda s: abs(s[2] - s[0]))))
            if Ds:
                diag = extend_line(roi, list(Ds[0]))
                found["lines"].append(diag)
                if not Hs:
                    # 基线被圆擦除切碎: 从斜线下端(角顶点)沿水平向两侧行走重建
                    vx, vy = (diag[0], diag[1]) if diag[1] > diag[3] else (diag[2], diag[3])
                    base = extend_line(roi, [vx - 24, vy, vx - 6, vy])
                    if abs(base[2] - base[0]) > 40:
                        found["lines"].insert(0, base)
        else:
            found["circles"] = hough_circles(roi, sc["minR"], sc["maxR"], sc.get("support", 0.72))
            if sc.get("small_pass"):
                small = hough_circles(roi, 8, 40, 0.6, minDist=10)
                for c in small:
                    if all(math.hypot(c[0] - o[0], c[1] - o[1]) > 12 or abs(c[2] - o[2]) > 6
                           for o in found["circles"]):
                        found["circles"].append(c)
        if sc.get("quads"):
            if sc.get("debug"):
                print(sc["name"], "debug segments:")
            found["quads"] = axis_rects(segs, roi, gap=sc.get("gap", 40), debug=sc.get("debug", False))
        if sc["name"] == "s7_flange" and found["circles"]:
            # 径向剖面补测中心同心环: 对每个 r 计算圆周支撑度, 取局部峰
            oc = max(found["circles"], key=lambda c: c[2])
            profile = [(r, ring_support(roi, oc[0], oc[1], r)) for r in range(6, 45)]
            for i in range(1, len(profile) - 1):
                r, s_ = profile[i]
                if s_ >= 0.8 and s_ >= profile[i - 1][1] and s_ >= profile[i + 1][1]:
                    if all(abs(r - c[2]) > 4 or math.hypot(oc[0] - c[0], oc[1] - c[1]) > 10
                           for c in found["circles"]):
                        found["circles"].append([oc[0], oc[1], float(r)])
        if sc["name"] == "s7_flange" and len(found["circles"]) > 1:
            # 结构化后滤: 最大圆为外轮廓; 中心同心环按半径聚类; 螺栓圆按到中心距离归类
            outer = max(found["circles"], key=lambda c: c[2])
            keep, radii = [outer], []
            for c in sorted(found["circles"], key=lambda c: -c[2]):
                if c is outer:
                    continue
                d = math.hypot(c[0] - outer[0], c[1] - outer[1])
                if d < 15:  # 同心环
                    if all(abs(c[2] - r) >= 5 for r in radii):
                        radii.append(c[2])
                        keep.append([outer[0], outer[1], c[2]])
                elif c[2] < 0.4 * outer[2] and 0.35 * outer[2] < d < outer[2]:  # 螺栓圆
                    if all(math.hypot(c[0] - k[0], c[1] - k[1]) > 12 for k in keep[1:]):
                        keep.append(c)
            found["circles"] = keep
        if sc.get("lines"):
            # 只留不在圆周上的线段, 合并共线取最长
            keep = []
            for s in segs:
                mx, my = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
                if not any(abs(math.hypot(mx - c[0], my - c[1]) - c[2]) < 6 for c in found["circles"]):
                    keep.append(s)
            keep.sort(key=lambda s: -math.hypot(s[2] - s[0], s[3] - s[1]))
            merged = []
            for s in keep:
                dup = any(abs(math.atan2(s[3] - s[1], s[2] - s[0]) -
                              math.atan2(o[3] - o[1], o[2] - o[0])) < 0.1 and
                          abs((s[1] + s[3]) / 2 - (o[1] + o[3]) / 2) < 12 for o in merged)
                if not dup:
                    merged.append(s)
            found["lines"] = [list(s) for s in merged[:3]]

        results[sc["name"]] = {"t": sc["t"], "roi": sc["roi"], **found}

        ov = frame.copy()
        for x, y, r in found["circles"]:
            cv2.circle(ov, (int(x), int(y)), int(r), (0, 255, 0), 2)
            cv2.circle(ov, (int(x), int(y)), 2, (0, 0, 255), -1)
        for q in found["quads"]:
            cv2.rectangle(ov, (q[0], q[1]), (q[2], q[3]), (0, 200, 255), 2)
        if found["tri"]:
            cv2.polylines(ov, [np.array(found["tri"], dtype=np.int32)], True, (255, 100, 255), 2)
        for l in found["lines"]:
            cv2.line(ov, (int(l[0]), int(l[1])), (int(l[2]), int(l[3])), (255, 255, 0), 2)
        cv2.rectangle(ov, (x0, y0), (x1, y1), (80, 80, 80), 1)
        crop = ov[max(0, y0 - 20):min(720, y1 + 20), max(0, x0 - 20):min(1280, x1 + 20)]
        h = 300
        tile = cv2.resize(crop, (int(crop.shape[1] * h / crop.shape[0]), h))
        cv2.putText(tile, f'{sc["name"]} C{len(found["circles"])} Q{len(found["quads"])} '
                          f'T{1 if found["tri"] else 0} L{len(found["lines"])}',
                    (6, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        tiles.append(tile)
    cap.release()

    rows = []
    for i in range(0, len(tiles), 2):
        pair = tiles[i:i + 2]
        w = sum(t.shape[1] for t in pair)
        row = np.zeros((300, w, 3), np.uint8)
        x = 0
        for t in pair:
            row[:, x:x + t.shape[1]] = t
            x += t.shape[1]
        rows.append(row)
    W = max(r.shape[1] for r in rows)
    sheet = np.vstack([np.hstack([r, np.zeros((300, W - r.shape[1], 3), np.uint8)]) for r in rows])
    cv2.imwrite(OUT + r'\measure_overlay.png', sheet)
    with open(OUT + r'\measurements.json', 'w', encoding='utf-8') as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    for k, v in results.items():
        print(k, 'C', len(v["circles"]), 'Q', len(v["quads"]),
              'T', 1 if v["tri"] else 0, 'L', len(v["lines"]))


if __name__ == "__main__":
    main()
