# -*- coding: utf-8 -*-
"""课时7 多段线: 按命令行确认的宽度参数(300 / 0->1000 / 1000)与圆弧链构建。"""
B = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica\l7"
out = ["FILEDIA 0", "OSMODE 0", "PLINEWID 0"]
out.append("_.PLINE 0,0 _W 300 300 2000,0 3000,1200 5000,1200 ")
out.append("_.PLINE 0,-2500 _W 0 1000 4000,-2500 ")
out.append("_.PLINE 0,-5000 _W 1000 1000 4000,-5000 ")
# 圆弧链: 每个 token 单独一行, 用圆心(_CE)确定, 避免空格解析歧义
out += ["_.PLINE", "0,-8000", "_W", "0", "0", "_A"]
for i in range(6):
    out += ["_CE", f"{2000 * i + 1000},-8000", f"{2000 * i + 2000},-8000"]
out.append("")
out += ["_.ZOOM _E",
        "_.SAVEAS 2018 C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l7/l7.dwg",
        "_.DXFOUT C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l7/l7.dxf 16"]
open(B + r"\l7.scr", "w", encoding="ascii").write("\n".join(out) + "\n")
print("written", len(out))
