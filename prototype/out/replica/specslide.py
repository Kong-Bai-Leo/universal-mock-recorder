# -*- coding: utf-8 -*-
"""为每课找出 PPT 全屏规格幻灯片(白底 + 内嵌黑色 CAD 图), 存成 lN/frames/spec_*.png。

判据: 中部白底占比高(演示模式白底), 且存在较大黑色矩形块(CAD 截图)。
用法: py -3.11 specslide.py 85 86 87 ...
"""
import json, os, sys
import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))


def scan(n, maxsec=140.0, step=2.5):
    cap = cv2.VideoCapture(idx[n]["path"])
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    end = min(maxsec, total / fps - 1)
    d = os.path.join(HERE, f"l{n}", "frames")
    os.makedirs(d, exist_ok=True)
    best = []
    t = 0.0
    while t < end:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, img = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = g.shape
        c = g[int(h*0.10):int(h*0.95), int(w*0.02):int(w*0.98)]
        wf = float((c > 200).mean())
        bf = float((c < 45).mean())
        # 演示模式: 白底为主, 黑图占 15%~55%
        if wf > 0.40 and 0.10 < bf < 0.60:
            best.append((wf, bf, t, img))
        t += step
    cap.release()
    if not best:
        print(f"l{n}: no slide candidate")
        return
    # 按黑图面积(图越大越清楚)排序, 取时间上分散的前 3 张
    best.sort(key=lambda r: -r[1])
    picked, times = [], []
    for wf, bf, t, img in best:
        if any(abs(t - u) < 12 for u in times):
            continue
        times.append(t); picked.append((t, bf, wf, img))
        if len(picked) >= 3:
            break
    for t, bf, wf, img in sorted(picked):
        p = os.path.join(d, f"spec_{int(t):04d}.png")
        cv2.imwrite(p, img)
        print(f"l{n}: t={t:.0f}s white={wf:.2f} black={bf:.2f} -> {p}")


for n in sys.argv[1:]:
    scan(n)
