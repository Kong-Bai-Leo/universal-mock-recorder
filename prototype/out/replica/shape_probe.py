# -*- coding: utf-8 -*-
"""连通域轮廓测量: 从一帧里把白色几何按连通域切开, 每块报告
包围盒 / 多边形逼近顶点 / 圆度, 供 agent 逐个判形。纯测量, 不做语义判断。
用法: py -3.11 shape_probe.py <video> <t_sec> <out_prefix> [--roi x0,y0,x1,y1] [--minarea N]
"""
import argparse
import json
import sys

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("t", type=float)
    ap.add_argument("out")
    ap.add_argument("--roi", default="0,128,1245,597")
    ap.add_argument("--minarea", type=int, default=120)
    ap.add_argument("--dilate", type=int, default=2)
    a = ap.parse_args()

    x0, y0, x1, y1 = (int(v) for v in a.roi.split(","))
    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, a.t * 1000)
    ok, fr = cap.read()
    if not ok:
        sys.exit("frame read failed")
    sub = fr[y0:y1, x0:x1]
    b, g, r = (sub[:, :, i].astype(int) for i in range(3))
    gray = cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY)
    white = (gray > 90) & (abs(r - b) < 45) & (abs(g - b) < 45)
    bw = (white.astype(np.uint8)) * 255
    # 去掉贯穿全屏的十字光标线
    col, row = (bw > 0).sum(axis=0), (bw > 0).sum(axis=1)
    for c in np.where(col > 0.55 * bw.shape[0])[0]:
        bw[:, max(0, c - 2):c + 3] = 0
    for rr in np.where(row > 0.55 * bw.shape[1])[0]:
        bw[max(0, rr - 2):rr + 3, :] = 0
    k = np.ones((a.dilate * 2 + 1, a.dilate * 2 + 1), np.uint8)
    closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(closed, 8)
    vis = sub.copy()
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < a.minarea:
            continue
        m = (lab == i).astype(np.uint8) * 255
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cs, key=cv2.contourArea)
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        (cx, cy), rad = cv2.minEnclosingCircle(c)
        item = {
            "id": i,
            "bbox_px": [int(x + x0), int(y + y0), int(x + w + x0), int(y + h + y0)],
            "size_px": [int(w), int(h)],
            "area_px": int(area),
            "perimeter_px": round(float(peri), 1),
            "nverts": int(len(approx)),
            "verts_px": [[int(p[0][0] + x0), int(p[0][1] + y0)] for p in approx],
            "minEnclosingCircle": [round(cx + x0, 1), round(cy + y0, 1), round(rad, 1)],
        }
        if len(c) >= 5:
            (ex, ey), (ma, mi), ang = cv2.fitEllipse(c)
            item["fitEllipse"] = {"c": [round(ex + x0, 1), round(ey + y0, 1)],
                                  "axes": [round(ma, 1), round(mi, 1)],
                                  "angle": round(ang, 1)}
        out.append(item)
        cv2.drawContours(vis, [c], -1, (0, 255, 255), 1)
        cv2.putText(vis, str(i), (x, max(10, y - 3)), 0, 0.4, (0, 128, 255), 1)
    cv2.imwrite(a.out + "_shapes.png", vis)
    cv2.imwrite(a.out + "_bw.png", closed)
    json.dump(out, open(a.out + "_shapes.json", "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
