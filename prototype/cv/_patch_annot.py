# -*- coding: utf-8 -*-
"""给 probe.py 增加"讲师标注特效"识别。

讲师用荧光笔/红笔在画面上圈画, 会产生大量与软件操作无关的画面变化,
之前全部落进 unattributed_change(课时8 全片 120 个)。
判据: 变化像素里"暖色高饱和"(红/橙)的占比 —— AutoCAD 自身的几何是白色、
标注是黄色(G 也高), 都不会被误判。
"""
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()

# 1) 帧扫描里统计标注色像素
OLD_CHANGE = """            traj.append(self._pt(fi, fps, last, mode))
            changes.append(self._change(blobs, last))"""
NEW_CHANGE = """            traj.append(self._pt(fi, fps, last, mode))
            ch = self._change(blobs, last)
            ch["annot"] = self._annot_ratio(bgr, mask)
            changes.append(ch)"""

# 2) 新方法
NEW_METHOD = '''
    @staticmethod
    def _annot_ratio(bgr, mask):
        """变化像素里"暖色高饱和"(讲师红/橙笔)的占比。

        AutoCAD 几何是白色(R≈G≈B), 标注是黄色(R,G 都高), 都不满足 G 低这一条,
        所以不会被误判成讲师标注。
        """
        n = int(mask.sum())
        if n < 40:
            return 0.0
        b = bgr[:, :, 0].astype(np.int16)
        g = bgr[:, :, 1].astype(np.int16)
        r = bgr[:, :, 2].astype(np.int16)
        warm = ((r > 120) & (r - b > 60) & (g < 190) & (r - g > 30)).astype(np.uint8)
        return round(float((warm & mask).sum()) / n, 3)

    def _change(self, blobs, last):'''

# 3) episode 聚合时带上标注占比
OLD_EP = """            cur["i1"], cur["peak"], gap = i, max(cur["peak"], fc["px"]), 0"""
NEW_EP = """            cur["i1"], cur["peak"], gap = i, max(cur["peak"], fc["px"]), 0
            cur.setdefault("annot", []).append(fc.get("annot", 0.0))"""

OLD_EPOUT = """            "dominantRegion": max(e["regions"], key=e["regions"].get) if e["regions"] else "unknown","""
NEW_EPOUT = """            "annotRatio": round(sum(e.get("annot") or [0]) / max(1, len(e.get("annot") or [1])), 3),
            "dominantRegion": max(e["regions"], key=e["regions"].get) if e["regions"] else "unknown","""

# 4) 动作归类: 标注占比高 -> presenter_annotation(agent 可批量丢弃)
OLD_TYPE = """            else:
                t = "unattributed_change\""""
NEW_TYPE = """            elif ep.get("annotRatio", 0) >= 0.45:
                t = "presenter_annotation"     # 讲师圈画, 非软件操作
            else:
                t = "unattributed_change\""""

patches = [
    ("annot ratio hook", OLD_CHANGE, NEW_CHANGE),
    ("annot method", "\n    def _change(self, blobs, last):", NEW_METHOD),
    ("episode annot", OLD_EP, NEW_EP),
    ("episode annot out", OLD_EPOUT, NEW_EPOUT),
    ("action type", OLD_TYPE, NEW_TYPE),
]

for name, old, new in patches:
    if new.strip().split("\n")[0] in src and name != "annot ratio hook":
        print(f"skip {name} (already patched)")
        continue
    if old not in src:
        print(f"!! anchor not found: {name}")
        continue
    src = src.replace(old, new, 1)
    print(f"ok {name}")

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
import ast
ast.parse(src)
print("syntax OK")
