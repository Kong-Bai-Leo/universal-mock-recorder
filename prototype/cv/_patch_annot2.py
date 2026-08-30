# -*- coding: utf-8 -*-
"""补上 _patch_annot.py 因检查逻辑误判而跳过的那一处:episode 聚合时累计标注占比。"""
import ast
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()

if 'cur.setdefault("annot"' in src:
    print("already patched")
else:
    OLD = '            cur["i1"], cur["peak"], gap = i, max(cur["peak"], fc["px"]), 0'
    NEW = (OLD + '\n            cur.setdefault("annot", []).append(fc.get("annot", 0.0))')
    assert OLD in src, "anchor not found"
    src = src.replace(OLD, NEW, 1)
    io.open(P, "w", encoding="utf-8", newline="\n").write(src)
    print("patched")

ast.parse(io.open(P, encoding="utf-8").read())
s = io.open(P, encoding="utf-8").read()
for k in ('_annot_ratio', 'cur.setdefault("annot"', '"annotRatio"', 'presenter_annotation'):
    print(f"  {k}: {k in s}")
