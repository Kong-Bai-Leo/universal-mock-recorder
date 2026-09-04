# -*- coding: utf-8 -*-
"""修正 l127(在 l126 基础上加课时127 的底板)与 l15(渐变填充)。"""
import re

R = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica"

# ---- l127 = l126 构造 + 课时127 的 EXTRUDE 200 底板 ----
t = open(R + r"\l126\l126.scr", encoding="ascii").read().replace("/l126/l126", "/l127/l127")
add = ("_.BOX -60,-120,-200 460,120,0\n"
       "_.UNION\n0,0\n-60,-120,-200\n\n")
t = re.sub(r"(?m)^_\.ZOOM _E$", add + "_.ZOOM _E", t, count=1)
open(R + r"\l127\l127.scr", "w", encoding="ascii").write(t)

# ---- l15 渐变: -HATCH _P _G <名称> <角度> 然后拾取内部点 ----
b = f"{R}/l15/l15".replace("\\", "/")
out = ["FILEDIA 0", "OSMODE 0",
       "_.RECTANG 0,0 140,100", "_.RECTANG 160,0 300,100", "_.RECTANG 320,0 460,100",
       "_.ZOOM _W -60,-60 520,160"]
for name, ang, pt in (("GR_LINEAR", 0, "70,50"),
                      ("GR_CYLIN", 0, "230,50"),
                      ("GR_SPHER", 45, "390,50")):
    out += ["_.-HATCH", "_P", "_G", name, str(ang), pt, ""]
out += ["_.ZOOM _E", f"_.SAVEAS 2018 {b}.dwg", f"_.DXFOUT {b}.dxf 16"]
open(R + r"\l15\l15.scr", "w", encoding="ascii").write("\n".join(out) + "\n")
print("l127 + l15 written")
