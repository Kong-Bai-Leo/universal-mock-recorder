# -*- coding: utf-8 -*-
"""细笔画曲线追踪: 二值掩膜 -> 每条曲线的有序点列(拟合点)。

纯几何测量, 不做语义判断。开曲线用像素图的"图直径"路径(BFS 两次)取中心线;
闭曲线(直径路径覆盖率低)退化为外轮廓。输出可直接喂给 AutoCAD SPLINE 拟合点。

用法: py -3.11 curve_trace.py <mask.png> <out.json> [--minarea N] [--eps E] [--maxpts N]
"""
import argparse
import json
from collections import deque

import cv2
import numpy as np


def diameter_path(pix):
    """pix: set of (x,y). 返回 8 邻接图上最长最短路(近似中心线)。"""
    idx = {p: i for i, p in enumerate(pix)}
    nb = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]

    def bfs(src):
        dist = {src: 0}
        par = {src: None}
        q = deque([src])
        last = src
        while q:
            u = q.popleft()
            last = u
            for dx, dy in nb:
                v = (u[0] + dx, u[1] + dy)
                if v in idx and v not in dist:
                    dist[v] = dist[u] + 1
                    par[v] = u
                    q.append(v)
        return last, dist, par

    a, _, _ = bfs(next(iter(pix)))
    b, dist, par = bfs(a)
    path = []
    cur = b
    while cur is not None:
        path.append(cur)
        cur = par[cur]
    path.reverse()
    return path, len(dist)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mask")
    ap.add_argument("out")
    ap.add_argument("--minarea", type=int, default=120)
    ap.add_argument("--eps", type=float, default=1.6)
    ap.add_argument("--maxpts", type=int, default=48)
    a = ap.parse_args()

    m = cv2.imread(a.mask, cv2.IMREAD_GRAYSCALE)
    bw = (m > 127).astype(np.uint8)
    n, lab, st, ce = cv2.connectedComponentsWithStats(bw, 8)
    res = []
    vis = cv2.cvtColor(bw * 60, cv2.COLOR_GRAY2BGR)
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if area < a.minarea:
            continue
        ys, xs = np.nonzero(lab == i)
        pix = set(zip(xs.tolist(), ys.tolist()))
        path, reached = diameter_path(pix)
        cover = len(path) / max(1, len(pix))
        closed = cover < 0.42
        if closed:
            mm = ((lab == i).astype(np.uint8)) * 255
            cs, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            c = max(cs, key=cv2.contourArea)
            pts = c.reshape(-1, 2)
        else:
            pts = np.array(path, dtype=np.int32)
        eps = a.eps
        for _ in range(30):
            ap2 = cv2.approxPolyDP(pts.reshape(-1, 1, 2).astype(np.int32), eps, closed)
            if len(ap2) <= a.maxpts:
                break
            eps *= 1.25
        simp = [[int(p[0][0]), int(p[0][1])] for p in ap2]
        res.append({"id": int(i), "bbox": [int(x), int(y), int(x + w), int(y + h)],
                    "npix": int(area), "closed": bool(closed),
                    "coverage": round(cover, 3), "rawlen": int(len(pts)),
                    "npts": len(simp), "pts": simp})
        col = (0, 255, 255) if not closed else (0, 128, 255)
        cv2.polylines(vis, [np.array(simp, np.int32)], closed, col, 1)
        for p in simp:
            cv2.circle(vis, tuple(p), 2, (0, 0, 255), -1)
        cv2.putText(vis, str(i), (x, max(10, y - 4)), 0, 0.45, (255, 255, 0), 1)
    cv2.imwrite(a.out.replace(".json", "_overlay.png"), vis)
    json.dump(res, open(a.out, "w"), indent=1)
    for r in res:
        print(r["id"], "bbox", r["bbox"], "npix", r["npix"], "closed", r["closed"],
              "cover", r["coverage"], "npts", r["npts"])


if __name__ == "__main__":
    main()
