# -*- coding: utf-8 -*-
"""扫描整片命令行区域,内容变化时保存原生分辨率条带(时间序)。"""
import cv2
import os

import numpy as np

SRC = r'D:\Black Myth\CAD零基础入门到精通教程，设计+建模+绘图轻松搞定（浅显易懂）\123-课时123：三维实操案例1（拱形门效果）-1080P 高清-AVC.mp4'
OUT = r'C:\Users\aaron\orca\universal-mock-recorder\prototype\out\l123\cmdstrips'
BAND = (0, 916, 1500, 1006)   # x0,y0,x1,y1
STEP_FRAMES = 12              # ~0.5s
DIFF_MEAN = 2.5

os.makedirs(OUT, exist_ok=True)
cap = cv2.VideoCapture(SRC)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
x0, y0, x1, y1 = BAND
last = None
saved = 0
fi = 0
while fi < total:
    ok, f = cap.read()
    if not ok:
        break
    if fi % STEP_FRAMES == 0:
        strip = f[y0:y1, x0:x1]
        g = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
        if last is None or float(np.mean(cv2.absdiff(g, last))) > DIFF_MEAN:
            t = fi / fps
            cv2.imwrite(os.path.join(OUT, f"cs_{int(t*10):05d}.png"), strip)
            saved += 1
            last = g
    fi += 1
cap.release()
print(f"saved {saved} strips")
