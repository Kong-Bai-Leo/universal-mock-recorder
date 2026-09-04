# -*- coding: utf-8 -*-
"""l42 其它辅助功能 —— 回放脚本生成器。

证据:
  C 命令行: 121.5s "指定下一点或 [放弃(U)]: 1000"  -> 直线长度 1000
  D 面板  : 290.0s 快捷特性面板 直线 长度 1000
  D 功能区: 300.0s 图案填充创建 -> 图案 ANSI31, 角度 0, 比例 10
  M 像素  : 590s 终态帧测量 (geo.json), 比例尺 k = 1000 / 161px = 6.2112 单位/px
            圆   c=(198.6,619.8)px r=138.9px
            矩形 (873,394)-(1209,590)px
            直线 (547,454)-(708,453)px  len=161px  <- 定标基准
  M 帧对比: 590s/620s/638s 矩形内填充被完全遮住 -> WIPEOUT 覆盖整个矩形
"""
import os

K = 1000.0 / 161.0          # 单位/像素
OX, OY = 547.0, 454.0       # 直线左端点作为原点


def P(px, py):
    return f"{(px - OX) * K:.1f},{(OY - py) * K:.1f}"


B = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")

rect = (P(873, 394), P(1209, 590))
c1, c2 = P(873, 394), P(1209, 590)
c3, c4 = P(1209, 394), P(873, 590)

lines = [
    "FILEDIA 0",
    "OSMODE 0",
    "CMDECHO 1",
    # 直线: 长度 1000 (C 级证据)
    "_.LINE 0,0",
    "1000,0",
    "",
    # 圆 (M)
    f"_.CIRCLE {P(198.6, 619.8)}",
    f"{138.9 * K:.1f}",
    # 矩形 (M)
    f"_.RECTANG {c1}",
    f"{c2}",
    "_.ZOOM _E",
    "_.ZOOM 0.8x",
    # 图案填充 ANSI31 比例 10 角度 0 (D), 边界 = 上一个对象(矩形)
    "_.-HATCH _P",
    "ANSI31",
    "10",
    "0",
    "_S",
    "_L",
    "",
    "",
    # 区域覆盖: 覆盖整个填充矩形 (M)
    "_.WIPEOUT",
    c1,
    c3,
    c2,
    c4,
    "_C",
    "_.ZOOM _E",
    f"_.DXFOUT {B}/l42.dxf 16",
    f"_.SAVEAS 2018 {B}/l42.dwg",
    "",
]

open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "l42.scr"),
     "w", encoding="gbk").write("\n".join(lines))
print("wrote l42.scr")
