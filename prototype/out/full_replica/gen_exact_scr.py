# -*- coding: utf-8 -*-
"""按 measurements.json 的实测像素几何 1:1 生成 AutoCAD 复刻脚本。
每景整体缩放归入网格单元(景间相对比例因视频缩放级别不同而不可知),
景内比例/位置严格保留实测值。y 轴翻转(图像坐标->CAD坐标)。"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, "measurements.json"), encoding="utf-8"))

# s6 基线取宽 ROI 轮次的实测(240,356)并吸附到顶点; 斜线下端吸附到同一顶点
M["s6_corner_tan"]["lines"] = [[240.0, 356.5, 507.5, 357.0], [385.5, 178.0, 507.5, 357.0]]
# s4 斜线下端吸附到与基线的交点
M["s4_corner_3p"]["lines"] = [[513.0, 439.0, 667.0, 439.0], [515.6, 439.0, 586.8, 303.1]]

LABELS = {
    "s1_center_radius": "S1 CENTER-RADIUS @213s",
    "s2_concentric": "S2 CENTER-DIAMETER @237s",
    "s3_squares_2p": "S3 2P MIDPOINT INSCRIBED @314s",
    "s4_corner_3p": "S4 3P ON CORNER @386s",
    "s5_2p_compare": "S5 2P COMPARE @458s",
    "s6_corner_tan": "S6 TAN-TAN ON CORNER @498s",
    "s7_flange": "S7 FLANGE COMPOSITE @666s",
    "s8_rings": "S8 OLYMPIC RINGS @872s",
}
ORDER = list(LABELS)

PITCH = 50000.0
CELL = 30000.0

lines_out = ["FILEDIA 0", "OSMODE 0"]


def emit_scene(name, cx_cell, cy_cell):
    sc = M[name]
    pts = []
    for c in sc["circles"]:
        pts += [(c[0] - c[2], c[1] - c[2]), (c[0] + c[2], c[1] + c[2])]
    for q in sc.get("quads", []):
        pts += [(q[0], q[1]), (q[2], q[3])]
    for l in sc.get("lines", []):
        pts += [(l[0], l[1]), (l[2], l[3])]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    s = CELL / max(w, h)
    mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2

    def T(x, y):  # 图像像素 -> 图纸坐标(y翻转)
        return cx_cell + (x - mx) * s, cy_cell - (y - my) * s

    for c in sc["circles"]:
        x, y = T(c[0], c[1])
        lines_out.append(f"_.CIRCLE {x:.2f},{y:.2f} {c[2] * s:.2f}")
    for q in sc.get("quads", []):
        x0, y0 = T(q[0], q[1])
        x1, y1 = T(q[2], q[3])
        lines_out.append(f"_.RECTANG {x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f}")
    for l in sc.get("lines", []):
        x0, y0 = T(l[0], l[1])
        x1, y1 = T(l[2], l[3])
        lines_out.append(f"_.LINE {x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f} ")
    lines_out.append(
        f"_.TEXT _J _C {cx_cell:.2f},{cy_cell - CELL / 2 - 4500:.2f} 1900 0 {LABELS[name]}")


for i, name in enumerate(ORDER):
    emit_scene(name, (i % 4) * PITCH, -(i // 4) * PITCH)

lines_out.append("_.ZOOM _E")
lines_out.append("_.DXFOUT C:/Users/aaron/orca/universal-mock-recorder/prototype/out/full_replica/lesson8_exact.dxf 16")
with open(os.path.join(HERE, "lesson8_exact.scr"), "w", encoding="ascii") as fh:
    fh.write("\n".join(lines_out) + "\n")
print(len(lines_out), "commands")
