# -*- coding: utf-8 -*-
"""把已抽好的命令行条带拼成蒙太奇(供批量读取)。"""
import glob
import os

import cv2
import numpy as np

D = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\l127\cmdstrips"
M = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\l127\cmdmont"
PER = 16
os.makedirs(M, exist_ok=True)
files = sorted(glob.glob(os.path.join(D, "cs_*.png")))
for k in range(0, len(files), PER):
    tiles = []
    for p in files[k:k + PER]:
        im = cv2.imread(p)
        t = int(os.path.basename(p)[3:8]) / 10
        cv2.putText(im, f"{t:.1f}s", (im.shape[1] - 120, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        cv2.line(im, (0, 0), (im.shape[1], 0), (0, 120, 0), 2)
        tiles.append(im)
    cv2.imwrite(os.path.join(M, f"m{k // PER:02d}.png"), np.vstack(tiles))
print("montages:", (len(files) + PER - 1) // PER)
