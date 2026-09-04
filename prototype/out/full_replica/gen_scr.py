# -*- coding: utf-8 -*-
"""生成课时8全部演示场景的 AutoCAD 复刻脚本(一张图,4x2 网格)。"""
import math

lines = ["FILEDIA 0", "OSMODE 0", "APERTURE 50"]

def circle(cx, cy, r):
    lines.append(f"_.CIRCLE {cx:.2f},{cy:.2f} {r:.2f}")

def rect(x0, y0, x1, y1):
    lines.append(f"_.RECTANG {x0:.2f},{y0:.2f} {x1:.2f},{y1:.2f}")

def tri(pts):
    p = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
    lines.append(f"_.LINE {p} _C")

def label(cx, y, text):
    lines.append(f"_.TEXT _J _C {cx:.2f},{y:.2f} 2200 0 {text}")

P = 50000            # 网格间距
cells = [(c * P, -r * P) for r in range(2) for c in range(4)]

# S1 圆心,半径 (视频 133-141s, 输入半径 100)
cx, cy = cells[0]
circle(cx, cy, 9000)
lines.append(f"_.LINE {cx:.2f},{cy:.2f} {cx+9000:.2f},{cy:.2f} ")
label(cx, cy - 16000, "1 CENTER-RADIUS (TYPED R=100)")

# S2 圆心,直径 同心圆 (221-237s)
cx, cy = cells[1]
circle(cx, cy, 9000)
circle(cx, cy, 4500)
label(cx, cy - 16000, "2 CENTER-DIAMETER CONCENTRIC")

# S3 四方块 + 两点内切圆 (250-330s; 方块4留空)
cx, cy = cells[2]
side, gap = 6800, 1600
x0 = cx - (4 * side + 3 * gap) / 2
for i in range(4):
    sx = x0 + i * (side + gap)
    rect(sx, cy - side / 2, sx + side, cy + side / 2)
    if i < 3:
        circle(sx + side / 2, cy, side / 2)
label(cx, cy - 16000, "3 2P INSCRIBED VIA MIDPOINTS")

# S4 三角形 + 三点过顶点圆 (362-394s) 3-4-5 直角三角形, 外接圆心在斜边中点
cx, cy = cells[3]
a, b = 16000, 12000
v = [(cx - a / 2, cy - b / 2), (cx + a / 2, cy - b / 2), (cx - a / 2, cy + b / 2)]
tri(v)
circle(cx, cy, math.hypot(a, b) / 2)
label(cx, cy - 16000, "4 3P THROUGH TRIANGLE VERTICES")

# S5 三角形 + 相切相切相切 内切圆 (466-498s)
cx, cy = cells[4]
v = [(cx - a / 2, cy - b / 2), (cx + a / 2, cy - b / 2), (cx - a / 2, cy + b / 2)]
tri(v)
r_in = (a + b - math.hypot(a, b)) / 2
circle(cx - a / 2 + r_in, cy - b / 2 + r_in, r_in)
label(cx, cy - 16000, "5 TAN-TAN-TAN INCIRCLE")

# S6 两点取角点 -> 圆超出方块 对比演示 (426-458s)
cx, cy = cells[5]
s = 12000
rect(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2)
circle(cx, cy, s / 2 * math.sqrt(2))
label(cx, cy - 16500, "6 2P ON CORNERS (OVERSHOOT DEMO)")

# S7 法兰盘组合: 外圆+同心内环+3孔 (626-682s)
cx, cy = cells[6]
circle(cx, cy, 12000)
circle(cx, cy, 4000)
circle(cx, cy, 2500)
for ang in (90, 210, 330):
    t = math.radians(ang)
    circle(cx + 7500 * math.cos(t), cy + 7500 * math.sin(t), 2000)
label(cx, cy - 16500, "7 CONCENTRIC + BOLT CIRCLES")

# S8 奥运五环 (790-880s, 2P D=20000 + TTR R=10000, 按比例 r=6000)
cx, cy = cells[7]
r = 6000
for dx in (-2 * r, 0, 2 * r):
    circle(cx + dx, cy + 5000, r)
yb = 5000 - r * math.sqrt(3)
for dx in (-r, r):
    circle(cx + dx, cy + yb, r)
label(cx, cy - 16500, "8 OLYMPIC RINGS 2P+TTR")

lines.append("_.ZOOM _E")
lines.append("_.DXFOUT C:/Users/aaron/orca/universal-mock-recorder/prototype/out/full_replica/lesson8_all.dxf 16")
with open(r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\full_replica\lesson8_all.scr", "w", encoding="ascii") as fh:
    fh.write("\n".join(lines) + "\n")
print(f"{len(lines)} commands")
