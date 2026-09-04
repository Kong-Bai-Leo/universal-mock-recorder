# -*- coding: utf-8 -*-
"""l48 智能标注 —— 回放脚本生成器。

几何来源(M): 帧 130s(标注开始之前的干净终态底图) 的像素测量
    geo.json     圆 / 直线 / 折线 / 矩形
    geoarc.json  圆弧  c=(606.6,359.4) r=104.3 a0=40 a1=136
比例尺(M): 6.0 单位/px, 原点平移使图形落在视频里读到的绝对坐标区间
    (坐标标注回显 1092.28 / 1358.28 / 7377.94;动态输入坐标提示
     X 1954 / 2087 / 2972 / 5405, Y 962 / 1066 / 1920 / 2092 / 2251)
标注参数(C): 457.9s "当前设置: 偏移(DIMDLI) 3.750000"  -> ISO 默认模板
             494.9s "指定偏移距离 <3.750000>: 300"      -> DIMDLI = 300
             510.2s "指定偏移距离 <300.000000>: 100"     -> DIMDLI = 100
DIMSCALE(M): 由 502s 帧标注文字像素高度反推 ≈ 8
"""
import math
import os

B = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
S = 6.0


def P(px, py):
    return (px - 189.0) * S + 900.0, (489.0 - py) * S + 900.0


def F(px, py):
    x, y = P(px, py)
    return f"{x:.1f},{y:.1f}"


def FF(x, y):
    return f"{x:.1f},{y:.1f}"


# --- 实体几何(像素 -> 图纸) ---
cc = P(238.2, 384.6)                      # 圆心
cr = 49.5 * S                             # 圆半径
la0, la1 = P(346, 291), P(445, 290)       # 直线 A(水平短线)
lb0, lb1 = P(341, 345), P(447, 325)       # 直线 B(斜线)
pl = [P(347, 418), P(407, 377), P(454, 433), P(502, 358), P(571, 413)]   # 折线
lc0, lc1 = P(615, 329), P(524, 487)       # 直线 C
ld0, ld1 = P(655, 475), P(524, 488)       # 直线 D
ac = P(606.6, 359.4)                      # 圆弧圆心
ar = 104.3 * S
a0, a1 = 40.0, 136.0
astart = (ac[0] + ar * math.cos(math.radians(a0)), ac[1] + ar * math.sin(math.radians(a0)))
aend = (ac[0] + ar * math.cos(math.radians(a1)), ac[1] + ar * math.sin(math.radians(a1)))
amid = (ac[0] + ar * math.cos(math.radians(88)), ac[1] + ar * math.sin(math.radians(88)))
rA, rB = P(751, 435), P(990, 435)         # 矩形下边两角
rC, rD = P(990, 270), P(751, 270)         # 矩形上边两角

L = [
    "FILEDIA 0",
    "OSMODE 0",
    "CMDECHO 1",
    # ---------- 底图几何 ----------
    f"_.LINE {FF(*la0)}", FF(*la1), "",
    f"_.LINE {FF(*lb0)}", FF(*lb1), "",
    f"_.LINE {FF(*lc0)}", FF(*lc1), "",
    f"_.LINE {FF(*ld0)}", FF(*ld1), "",
    f"_.PLINE {FF(*pl[0])}", FF(*pl[1]), FF(*pl[2]), FF(*pl[3]), FF(*pl[4]), "",
    f"_.CIRCLE {FF(*cc)}", f"{cr:.1f}",
    f"_.ARC _C {FF(*ac)}", FF(*astart), FF(*aend),
    f"_.RECTANG {FF(*rD)}", FF(*rB),
    "_.ZOOM _E",
    "_.ZOOM 0.85x",
    # ---------- 标注变量: ISO 默认 + 由帧反推的整体比例 ----------
    "DIMTXT 2.5", "DIMASZ 2.5", "DIMEXE 1.25", "DIMEXO 0.625", "DIMDLI 3.75",
    "DIMSCALE 8",
    # ---------- 线性 (DIM 默认行为) ----------
    f"_.DIMLINEAR {FF(*rA)}", FF(*rB), FF(rA[0], rA[1] - 260),
    # ---------- 对齐 (DIM 对齐/自动识别斜线) ----------
    f"_.DIMALIGNED {FF(*lb0)}", FF(*lb1), FF(lb0[0] + 40, lb0[1] - 220),
    # ---------- 角度 (DIM 角度(A), 顶点方式) ----------
    "_.DIMANGULAR", "", FF(*ld1), FF(*lc0), FF(*ld0),
    FF(ld1[0] + 330, ld1[1] + 200),
    # ---------- 基线 DIMDLI=300 (C) ----------
    "DIMDLI 300",
    f"_.DIMLINEAR {FF(*pl[0])}", FF(*pl[1]), FF(pl[0][0], pl[0][1] - 300),
    f"_.DIMBASELINE {FF(*pl[2])}", "", "",
    # ---------- 基线 DIMDLI=100 (C) ----------
    "DIMDLI 100",
    f"_.DIMBASELINE", "_S", FF(*pl[1]), FF(*pl[3]), "", "",
    # ---------- 连续 ----------
    f"_.DIMLINEAR {FF(*pl[3])}", FF(*pl[4]), FF(pl[3][0], pl[3][1] - 700),
    f"_.DIMCONTINUE", FF(pl[4][0] + 400, pl[4][1]), "", "",
    # ---------- 坐标 ----------
    f"_.DIMORDINATE {FF(*rC)}", FF(rC[0] + 500, rC[1] + 300),
    f"_.DIMORDINATE {FF(*rD)}", FF(rD[0], rD[1] + 500),
    # ---------- 半径 / 直径 (圆) ----------
    "_.DIMRADIUS", FF(cc[0] + cr, cc[1]), FF(cc[0] + cr + 300, cc[1] + 300),
    "_.DIMDIAMETER", FF(cc[0] - cr, cc[1]), FF(cc[0] - cr - 300, cc[1] - 300),
    # ---------- 弧长 (圆弧) ----------
    "_.DIMARC", FF(*amid), FF(amid[0], amid[1] + 300),
    # ---------- 折弯半径 (圆弧) ----------
    "_.DIMJOGGED", FF(*amid), FF(ac[0] + 1200, ac[1] + 1400),
    FF(amid[0] + 500, amid[1] + 900), FF(amid[0] + 250, amid[1] + 450),
    "_.ZOOM _E",
    f"_.DXFOUT {B}/l48.dxf 16",
    f"_.SAVEAS 2018 {B}/l48.dwg",
    "",
]

open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "l48.scr"),
     "w", encoding="gbk").write("\n".join(L))
print("wrote l48.scr")
