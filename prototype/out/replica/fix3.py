# -*- coding: utf-8 -*-
"""课时15 渐变填充的无头替代 + 课时127 底板。

无头 accoreconsole 里 `-GRADIENT` 命令不存在, `-HATCH _P _G <名称> <角度>` 之后
还有一步交互提示无法从脚本满足(三种序列均挂起)。这里退化为 SOLID 实色填充,
保留"三个矩形各自被填充"的可见结果, 渐变色阶本身未复现 —— 已在 MANIFEST 标注。
"""
import re

R = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica"

b = f"{R}/l15/l15".replace("\\", "/")
out = ["FILEDIA 0", "OSMODE 0",
       "_.RECTANG 0,0 140,100", "_.RECTANG 160,0 300,100", "_.RECTANG 320,0 460,100",
       "_.ZOOM _W -60,-60 520,160"]
for color, pt in ((5, "70,50"), (3, "230,50"), (6, "390,50")):
    out += [f"_.-HATCH _CO {color} _P _S {pt} "]
out += ["_.ZOOM _E", f"_.SAVEAS 2018 {b}.dwg", f"_.DXFOUT {b}.dxf 16"]
open(R + r"\l15\l15.scr", "w", encoding="ascii").write("\n".join(out) + "\n")

# l127: 在 l126 构造上追加课时127 的底板(EXTRUDE 200 -> 等价 BOX)
t = open(R + r"\l126\l126.scr", encoding="ascii").read().replace("/l126/l126", "/l127/l127")
add = "_.BOX -60,-120,-200 460,120,0\n_.UNION\n0,0\n-60,-120,-200\n\n"
t = re.sub(r"(?m)^_\.ZOOM _E$", add + "_.ZOOM _E", t, count=1)
open(R + r"\l127\l127.scr", "w", encoding="ascii").write(t)
print("ok")
