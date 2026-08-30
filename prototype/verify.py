# -*- coding: utf-8 -*-
"""复刻结果验证器: 解析 DXF, 输出实体清单 + 几何摘要 + 标注文字回读。

用法: py -3.11 verify.py <file.dxf> [--json]
标注文字是 AutoCAD 从回放几何自己量出来的, 是独立于脚本输入的旁证。
"""
import json
import re
import sys
from collections import Counter


def groups(block):
    """把一个实体块解析成 {组码: [值...]}。块首行是实体类型(值), 从第二行起才是码/值对。"""
    out = {}
    lines = block.split("\n")[1:]
    for i in range(0, len(lines) - 1, 2):
        code = lines[i].strip()
        val = lines[i + 1].strip()
        if code.lstrip("-").isdigit():
            out.setdefault(int(code), []).append(val)
    return out


def num(g, code, i=0):
    try:
        return round(float(g[code][i]), 4)
    except (KeyError, IndexError, ValueError):
        return None


def main():
    path = sys.argv[1]
    txt = open(path, encoding="utf-8", errors="ignore").read()
    ents = txt.split("ENTITIES", 1)[1].split("ENDSEC", 1)[0]
    # 以 "\n  0\n<TYPE>" 切分实体
    parts = re.split(r"\n\s{2}0\n", ents)
    counter = Counter()
    detail = {"CIRCLE": [], "ARC": [], "LINE": [], "LWPOLYLINE": [],
              "DIMENSION": [], "TEXT": [], "ELLIPSE": [], "HATCH": [],
              "3DSOLID": [], "POINT": [], "SPLINE": []}
    for p in parts:
        head = p.split("\n", 1)[0].strip()
        if not head:
            continue
        counter[head] += 1
        if head not in detail:
            continue
        g = groups(p)
        if head == "CIRCLE":
            detail[head].append({"c": [num(g, 10), num(g, 20), num(g, 30)], "r": num(g, 40)})
        elif head == "ARC":
            detail[head].append({"c": [num(g, 10), num(g, 20)], "r": num(g, 40),
                                 "a0": num(g, 50), "a1": num(g, 51)})
        elif head == "LINE":
            detail[head].append({"p0": [num(g, 10), num(g, 20)], "p1": [num(g, 11), num(g, 21)]})
        elif head == "ELLIPSE":
            detail[head].append({"c": [num(g, 10), num(g, 20)],
                                 "major": [num(g, 11), num(g, 21)], "ratio": num(g, 40)})
        elif head == "LWPOLYLINE":
            n = num(g, 90)
            xs = [round(float(v), 4) for v in g.get(10, [])]
            ys = [round(float(v), 4) for v in g.get(20, [])]
            detail[head].append({"n": int(n) if n else 0,
                                 "pts": list(zip(xs, ys))[:12],
                                 "closed": "1" in g.get(70, [])})
        elif head == "DIMENSION":
            detail[head].append({"text": (g.get(1, [""])[0] or "<measured>"),
                                 "type": num(g, 70)})
        elif head == "TEXT":
            detail[head].append({"s": g.get(1, [""])[0], "at": [num(g, 10), num(g, 20)]})
        elif head == "HATCH":
            detail[head].append({"pattern": g.get(2, [""])[0], "solid": num(g, 70)})

    summary = {"file": path.split("\\")[-1], "counts": dict(counter)}
    for k, v in detail.items():
        if v:
            summary[k] = v[:24]

    if "--json" in sys.argv:
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return
    print(f"== {summary['file']} ==")
    print("实体:", ", ".join(f"{k}×{v}" for k, v in sorted(counter.items(), key=lambda x: -x[1])))
    for k in ("CIRCLE", "ARC", "ELLIPSE", "LINE", "LWPOLYLINE", "HATCH", "TEXT", "DIMENSION"):
        if summary.get(k):
            print(f"-- {k}")
            for it in summary[k][:16]:
                print("   ", json.dumps(it, ensure_ascii=False))


if __name__ == "__main__":
    main()
