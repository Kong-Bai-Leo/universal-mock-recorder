# -*- coding: utf-8 -*-
"""扫描视频找 PPT 全屏白底幻灯片(规格书)。用法: py -3.11 findslide.py <lesson> [maxsec] [step]"""
import json, os, sys
import cv2, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))
n = sys.argv[1]
maxsec = float(sys.argv[2]) if len(sys.argv) > 2 else 150.0
step = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
cap = cv2.VideoCapture(idx[n]["path"])
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
maxsec = min(maxsec, total / fps - 1)
runs = []
t = 0.0
while t < maxsec:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
    ok, img = cap.read()
    if not ok:
        break
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    # 只看中部, 避开任务栏/浏览器条
    c = g[int(h*0.15):int(h*0.90), int(w*0.05):int(w*0.95)]
    whitefrac = float((c > 200).mean())
    blackfrac = float((c < 40).mean())
    runs.append((t, whitefrac, blackfrac))
    t += step
cap.release()
print(f"l{n} fps={fps:.2f} dur={total/fps:.0f}s   t  white%  black%")
for t, wf, bf in runs:
    mark = "  <== SLIDE" if wf > 0.55 else ("  <- cad" if bf > 0.5 else "")
    print(f"{t:7.0f}  {wf:6.2f}  {bf:6.2f}{mark}")
