# -*- coding: utf-8 -*-
"""挑每课的终态画布帧: 在给定时间窗内找画布白色几何像素最多、且没有大面积弹窗的帧。
用法: py -3.11 endframe.py <lesson> [from_frac] [to_frac] [step_sec]
产物: lN/frames/end_<秒>.png (最优 2 帧) 并打印候选表。
"""
import json, os, sys
import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))
n = sys.argv[1]
f0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.55
f1 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.99
step = float(sys.argv[4]) if len(sys.argv) > 4 else 6.0

cap = cv2.VideoCapture(idx[n]["path"])
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
dur = total / fps
rows = []
t = dur * f0
while t < dur * f1:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
    ok, img = cap.read()
    if ok:
        h, w = img.shape[:2]
        # acad1080 canvas
        c = img[int(h*0.18):int(h*0.84), int(w*0.01):int(w*0.99)]
        b, g, r = cv2.split(c)
        white = ((b > 165) & (g > 165) & (r > 165)).sum()
        # 弹窗/对话框: 中灰面积大
        gray = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
        popup = ((gray > 55) & (gray < 190)).mean()
        rows.append((t, int(white), float(popup), img))
    t += step
cap.release()
rows.sort(key=lambda r: (-(r[1]) if r[2] < 0.10 else 0))
d = os.path.join(HERE, f"l{n}", "frames")
os.makedirs(d, exist_ok=True)
print(f"l{n} dur={dur:.0f}s  top candidates:")
saved = []
for t, white, popup, img in rows:
    if popup >= 0.10:
        continue
    if any(abs(t - u) < 25 for u in saved):
        continue
    saved.append(t)
    p = os.path.join(d, f"end_{int(t):05d}.png")
    cv2.imwrite(p, img)
    print(f"  t={t:6.0f}s white={white:7d} popup={popup:.3f} -> {os.path.basename(p)}")
    if len(saved) >= 2:
        break
