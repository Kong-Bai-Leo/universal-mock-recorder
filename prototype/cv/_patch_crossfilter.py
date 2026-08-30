# -*- coding: utf-8 -*-
"""修复 measure.py 误删长直线的问题(课时41 agent 报告),并顺带修复文件里的乱码注释。

原判据: 亮像素跨度 > 62% 画布 即视为十字光标线并整行/整列抹掉。
问题: 图纸里贯穿画布的长直线(轴线、参照线)也满足, 被一起删了。

改进两点:
  1) 阈值提到 92% —— 十字光标贯穿**整个**画布, 图元很少这么长;
  2) 加"细"约束 —— 光标线宽 1~3px, 邻域里同样长的列/行 <=3 条才算光标,
     宽线(图元)即使够长也保留。
"""
import ast
import io
import os
import re

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "measure.py")
src = io.open(P, encoding="utf-8").read()


def repair_mojibake_line(line):
    """尽力修复单行的 cp1252/latin-1 双重编码;修不了就原样返回。"""
    if all(ord(ch) < 128 for ch in line):
        return line
    for codec in ("cp1252", "latin-1"):
        try:
            fixed = line.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if fixed != line:
            return fixed
    return line


if "cross_span" in src:
    print("filter: already patched")
else:
    OLD = ("    col, row = bw.sum(axis=0), bw.sum(axis=1)\n"
           "    for c in np.where(col > 0.62 * (y1 - y0))[0]:\n"
           "        bw[:, max(0, c - 2):c + 3] = 0\n"
           "    for r in np.where(row > 0.62 * (x1 - x0))[0]:\n"
           "        bw[max(0, r - 2):r + 3, :] = 0\n"
           "    return bw * 255")
    NEW = ('    # 去掉贯穿全屏的十字光标线。判据同时要求"够长"和"够细":\n'
           '    # 光标线贯穿整个画布且只有 1~3px 宽, 而图纸里的长直线(轴线/参照线)\n'
           '    # 通常更宽或不贯穿 —— 只按长度判会误删它们。\n'
           "    col, row = bw.sum(axis=0), bw.sum(axis=1)\n"
           "    Hh, Ww = bw.shape\n"
           "    for c in np.where(col > cross_span * (y1 - y0))[0]:\n"
           "        lo, hi = max(0, c - 4), min(Ww, c + 5)\n"
           "        if int((col[lo:hi] > cross_span * (y1 - y0)).sum()) <= 3:\n"
           "            bw[:, max(0, c - 2):c + 3] = 0\n"
           "    for r in np.where(row > cross_span * (x1 - x0))[0]:\n"
           "        lo, hi = max(0, r - 4), min(Hh, r + 5)\n"
           "        if int((row[lo:hi] > cross_span * (x1 - x0)).sum()) <= 3:\n"
           "            bw[max(0, r - 2):r + 3, :] = 0\n"
           "    return bw * 255")
    assert OLD in src, "anchor not found"
    src = src.replace(OLD, NEW, 1)
    src = re.sub(r'def clean\(frame, canvas, color="any"\):',
                 'def clean(frame, canvas, color="any", cross_span=0.92):', src, count=1)
    src = src.replace("bw = clean(frame, canvas, args.color)",
                      "bw = clean(frame, canvas, args.color, args.cross_span)", 1)
    src = src.replace(
        'ap.add_argument("--color", default="any", choices=["any", "white", "yellow"])',
        'ap.add_argument("--color", default="any", choices=["any", "white", "yellow"])\n'
        '    ap.add_argument("--cross-span", type=float, default=0.92, dest="cross_span",\n'
        '                    help="十字光标线判定的画布跨度比例(越大越保守)")', 1)
    print("filter: patched")

# 顺带修复乱码注释(逐行尽力而为, 修不了的保持原样)
lines = src.split("\n")
fixed = [repair_mojibake_line(l) for l in lines]
nfix = sum(1 for a, b in zip(lines, fixed) if a != b)
src = "\n".join(fixed)

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
ast.parse(io.open(P, encoding="utf-8").read())
s = io.open(P, encoding="utf-8").read()
print(f"mojibake lines repaired: {nfix}")
print("cross_span:", "cross_span=0.92" in s, "| CLI:", "--cross-span" in s)
