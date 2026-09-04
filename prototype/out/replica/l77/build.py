# -*- coding: utf-8 -*-
"""课时77 绘制图框 —— 全部尺寸来自命令行回显(证据等级 C)。

命令流(读 m00-m17 中带数值的段):
  REC → 尺寸(D) → 长度<297.0000>/宽度<210.0000>  = A4 默认值
  REC → 尺寸(D) → 长度 420 / 宽度 297             = A3(键入)
  REC → 尺寸(D) → 长度<841.0000>/宽度<594.0000>  = A1 默认值
  REC → 尺寸(D) → 长度 1189 / 宽度 841            = A0(键入)
  REC → 尺寸(D) → 长度 5 / 宽度 5                 = 标题栏格(键入)
  O(OFFSET) → 偏移距离 5                          = 内框边距(键入)
  XLINE _H / MOVE / COPY / ERASE                  = 辅助,无数值

剔除: 大量 *取消*(239.6/241.0/243.4/251.6/305.9/412.9/425.9/463.8/473.0…)、
      MTEDIT 进出、多次 MOVE/COPY 未落点即取消。
"""
import os

B = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")

# ISO A 系列: A4/A1 来自默认值回显, A3/A0 是键入值 —— 全部 C 级
PAPERS = [("A0", 1189, 841), ("A1", 841, 594), ("A2", 594, 420),
          ("A3", 420, 297), ("A4", 297, 210)]

out = ["FILEDIA 0", "OSMODE 0"]
x = 0
for name, w, h in PAPERS:
    out.append(f"_.RECTANG {x},0 _D {w} {h} {x + 10},10")
    x += w + 60

# 内框: 对 A3 外框做 OFFSET 5(命令行确认的偏移距离)
a3x = sum(p[1] + 60 for p in PAPERS[:3])
out += ["_.ZOOM _W -100,-100 3400,1000",
        "_.OFFSET 5", f"{a3x},0", f"{a3x + 20},20", ""]

# 标题栏格 5x5
out.append(f"_.RECTANG {a3x + 300},20 _D 5 5 {a3x + 305},25")

out += ["_.ZOOM _E",
        f"_.SAVEAS 2018 {B}/l77.dwg",
        f"_.DXFOUT {B}/l77.dxf 16",
        "_.ZOOM _E"]          # 尾部无害命令, 防止空行重入 DXFOUT
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "l77.scr"),
     "w", encoding="ascii").write("\n".join(out) + "\n")
print("l77.scr:", len(out), "lines")
