# -*- coding: utf-8 -*-
"""从视频抓帧到 png。用法: py -3.11 grab.py <lesson> <sec> [<sec>...] [--crop x,y,w,h] [--out DIR]"""
import json, os, sys
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))

args = sys.argv[1:]
crop = None
outdir = None
if "--crop" in args:
    i = args.index("--crop"); crop = tuple(int(v) for v in args[i+1].split(",")); del args[i:i+2]
if "--out" in args:
    i = args.index("--out"); outdir = args[i+1]; del args[i:i+2]
n = args[0]
secs = [float(s) for s in args[1:]]
path = idx[n]["path"]
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
d = outdir or os.path.join(HERE, f"l{n}", "frames")
os.makedirs(d, exist_ok=True)
print(f"l{n} fps={fps:.2f} frames={total} dur={total/fps:.0f}s")
for s in secs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(s*fps))
    ok, img = cap.read()
    if not ok:
        print(f"  {s}s: read failed"); continue
    if crop:
        x, y, w, h = crop; img = img[y:y+h, x:x+w]
    p = os.path.join(d, f"t{int(s):05d}.png")
    cv2.imwrite(p, img)
    print(f"  {s}s -> {p}")
cap.release()
