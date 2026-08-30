# -*- coding: utf-8 -*-
"""按实测标定讲师标注的判定阈值。

课时8 的 285-305s 实测(讲师荧光笔圈画段):
  真标注段 annotRatio = 0.19 ~ 0.33
  非标注段 annotRatio = 0.000 ~ 0.005
原阈值 0.45 定高了, 一个都没抓到。改为 0.15 —— 保守留出余量,
宁可把 0.12 的边界段留作 unattributed_change 交给 agent 判, 也不误删真实操作。
"""
import ast
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()
OLD = 'elif ep.get("annotRatio", 0) >= 0.45:'
NEW = 'elif ep.get("annotRatio", 0) >= ANNOT_RATIO_GATE:'
if OLD in src:
    src = src.replace(OLD, NEW, 1)

if "ANNOT_RATIO_GATE" not in src.split("def ")[0]:
    anchor = "CMD_PER_MONTAGE = 16"
    assert anchor in src
    src = src.replace(
        anchor,
        anchor + "\nANNOT_RATIO_GATE = 0.15   # 讲师标注判定(课时8 实测: 真标注 0.19~0.33, 非标注 <0.01)",
        1)

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
ast.parse(src)
print("gate:", "ANNOT_RATIO_GATE = 0.15" in src, "| used:", NEW in src)
