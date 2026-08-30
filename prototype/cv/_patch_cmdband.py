# -*- coding: utf-8 -*-
"""修复:命令行区域在视频中途移位导致后半段条带抓空。

成因(三维批次 agent 报告):部分课时中途切换工作空间(草图与注释 ↔ 三维基础),
功能区高度变化 → 命令行的 y 范围跟着移动;而 cmd_band 是整片固定的,
移位之后固定裁剪就抓到空白,后 60% 的命令流全部丢失。

修法:扫描开始前先采样 14 帧,逐帧定位"命令行亮带"的 y 范围,取**并集**作为
实际裁剪带。并集保证两种布局下的命令行都在裁剪区内,代价只是条带略高一点。
"""
import ast
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()

HELPER = '''
def union_cmd_band(src, cfg, n=14):
    """采样若干帧, 取"命令行亮带"y 范围的并集 —— 应对中途切换工作空间导致的移位。"""
    cap = cv2.VideoCapture(src)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    x0, y0, x1, y1 = cfg["cmd_band"]
    H = cfg["size"][1]
    lo, hi = y0, y1
    if total > 0:
        lo, hi = H, 0
        for i in np.linspace(int(total * 0.08), int(total * 0.95), n).astype(int):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
            ok, f = cap.read()
            if not ok:
                continue
            g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
            # 命令行是浅灰底: 在屏幕下部找"行中位亮度明显偏高"的连续行段
            band = np.median(g[int(H * 0.72):, x0:x1], axis=1)
            base = float(np.median(band))
            rows = np.where(band > base + 25)[0]
            if len(rows) < 3:
                continue
            a, b = int(H * 0.72) + int(rows.min()), int(H * 0.72) + int(rows.max()) + 1
            lo, hi = min(lo, a), max(hi, b)
        if lo >= hi:                       # 采样失败 -> 退回配置值
            lo, hi = y0, y1
    cap.release()
    # 留一点余量, 并且不超出配置的下界
    lo = max(0, lo - 4)
    hi = min(cfg["size"][1], max(hi + 4, y1))
    return (x0, lo, x1, hi)

'''

if "union_cmd_band" not in src:
    anchor = "class Probe:"
    assert anchor in src, "anchor not found"
    src = src.replace(anchor, HELPER + "\n" + anchor, 1)

OLD = '        bx0, by0, bx1, by1 = self.c["cmd_band"]'
NEW = ('        # 命令行带可能因中途切换工作空间而移位 -> 用采样并集\n'
       '        bx0, by0, bx1, by1 = union_cmd_band(src, self.c)')
if 'union_cmd_band(src, self.c)' not in src:
    assert OLD in src, "scan anchor not found"
    src = src.replace(OLD, NEW, 1)

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
ast.parse(io.open(P, encoding="utf-8").read())
s = io.open(P, encoding="utf-8").read()
print("helper:", "def union_cmd_band" in s, "| wired:", "union_cmd_band(src, self.c)" in s)
