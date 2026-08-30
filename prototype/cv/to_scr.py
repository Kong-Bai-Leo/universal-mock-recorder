# -*- coding: utf-8 -*-
"""æµ‹é‡ JSON -> AutoCAD è„šæœ¬ã€‚åƒç´ åæ ‡è½¬å›¾çº¸åæ ‡(y ç¿»è½¬), é»˜è®¤ 1px = 1 å•ä½ã€‚

用法: py -3.11 cv/to_scr.py <measure.json> <out.scr> <out_basename> [--scale S] [--flipy H]
      [--origin x,y] [--title TEXT]
ç»å¯¹æ¯”ä¾‹ä¸å¯ä»Žå¾’æ‰‹å†…å®¹è¿˜åŽŸæ—¶, ä¿æŒåƒç´ æ¯”ä¾‹å¹¶åœ¨æŠ¥å‘Šä¸­è¯´æ˜Ž â€”â€” ä¸çŒœã€‚
"""
import argparse
import json
import math
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("scr")
    ap.add_argument("base", help="è¾“å‡º dwg/dxf çš„å®Œæ•´è·¯å¾„(ä¸å«æ‰©å±•å)")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--flipy", type=float, default=720.0)
    ap.add_argument("--origin", default="0,0")
    ap.add_argument("--dwgver", default="2018")
    args = ap.parse_args()

    ox, oy = (float(v) for v in args.origin.split(","))
    d = json.load(open(args.src, encoding="utf-8"))
    s = args.scale

    def T(p):
        return ((p[0] - ox) * s, (args.flipy - p[1] - oy) * s)

    out = ["FILEDIA 0", "OSMODE 0"]
    for c in d.get("circles", []):
        x, y = T([c[0], c[1]])
        out.append(f"_.CIRCLE {x:.3f},{y:.3f} {c[2] * s:.3f}")
    for L in d.get("lines", []):
        x0, y0 = T(L["p0"])
        x1, y1 = T(L["p1"])
        out.append(f"_.LINE {x0:.3f},{y0:.3f} {x1:.3f},{y1:.3f} ")
    for e in d.get("ellipses", []):
        cx, cy = T(e["c"])
        rot = -math.radians(e["rot"])          # 图像 y 向下 -> 翻转后旋向取反
        ax, ay = e["a"] * s * math.cos(rot), e["a"] * s * math.sin(rot)
        out.append(f"_.ELLIPSE {cx - ax:.3f},{cy - ay:.3f} {cx + ax:.3f},{cy + ay:.3f} "
                   f"{e['b'] * s:.3f}")
    for a in d.get("arcs", []):
        cx, cy = T([a["c"][0], a["c"][1]])
        r = a["r"] * s
        a0, a1 = a["a0"], a["a1"]
        inc = (a1 - a0) % 360 or 360
        sx = cx + r * math.cos(math.radians(a0))
        sy = cy + r * math.sin(math.radians(a0))
        out.append(f"_.ARC _C {cx:.3f},{cy:.3f} {sx:.3f},{sy:.3f} _A {inc:.3f}")
    out.append("_.ZOOM _E")
    b = args.base.replace("\\", "/")
    out.append(f"_.SAVEAS {args.dwgver} {b}.dwg")
    out.append(f"_.DXFOUT {b}.dxf 16")
    os.makedirs(os.path.dirname(args.scr), exist_ok=True)
    with open(args.scr, "w", encoding="ascii") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"{len(d.get('circles', []))} circles, {len(d.get('lines', []))} lines -> {args.scr}")


if __name__ == "__main__":
    main()

