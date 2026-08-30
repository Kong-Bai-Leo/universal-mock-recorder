# -*- coding: utf-8 -*-
"""给 probe.py 增加"模态对话框"检测,修正 doctor 的光标信号率误报。

现象: 13 课被 doctor 标记 "LOW cursor signal"(49%~70%), 但它们清一色是
对话框密集型课程(多行文字、组与编辑、捕捉与栅格、三维界面)。

分析: 对话框打开时光标在画布之外, AutoCAD 显示的是普通箭头而非全屏十字线 ——
**没有十字线是正确行为**, 不是 CV 失效。用未加区分的分母算"信号率"就会误报。

修法: 逐帧判断画布区是否被大片浅灰(对话框底色)覆盖, 把这些帧单独计数;
doctor 用"非对话框帧"作分母算光标命中率, 同时报告对话框占比。
"""
import ast
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()

METHOD = '''
    def dialog_present(self, gray):
        """画布区是否被模态对话框覆盖。

        对话框是大片浅灰底(与深色画布对比强烈), 判据: 画布内亮度落在
        [150,245] 的像素超过画布面积的 8%。这个区间避开纯白文字与深色画布。
        """
        x0, y0, x1, y1 = self.c["canvas"]
        roi = gray[y0:y1, x0:x1]
        if roi.size == 0:
            return False
        light = int(((roi > 150) & (roi < 245)).sum())
        return light > 0.08 * roi.size

    def key_zone_state(self, gray):'''

if "def dialog_present" not in src:
    src = src.replace("\n    def key_zone_state(self, gray):", METHOD, 1)

# 扫描时统计
OLD1 = "        traj, changes, keyframes, strips = [], [], [], []"
NEW1 = ("        traj, changes, keyframes, strips = [], [], [], []\n"
        "        n_dialog = 0")
if "n_dialog = 0" not in src:
    assert OLD1 in src, "scan init anchor"
    src = src.replace(OLD1, NEW1, 1)

OLD2 = "            keyframes.append(self.key_zone_state(gray))"
NEW2 = ("            keyframes.append(self.key_zone_state(gray))\n"
        "            if self.dialog_present(gray):\n"
        "                n_dialog += 1")
if "n_dialog += 1" not in src:
    assert OLD2 in src, "keyframe anchor"
    src = src.replace(OLD2, NEW2, 1)

OLD3 = "        return fps, f0, traj, changes, keyframes, strips"
NEW3 = "        return fps, f0, traj, changes, keyframes, strips, n_dialog"
if "n_dialog\n" not in src.split("def scan")[1][:4000]:
    src = src.replace(OLD3, NEW3, 1)

OLD4 = "    fps, f0, traj, changes, keyframes, strips = probe.scan(args.video, args.start, args.end)"
NEW4 = ("    fps, f0, traj, changes, keyframes, strips, n_dialog = probe.scan(\n"
        "        args.video, args.start, args.end)")
if "n_dialog = probe.scan" not in src:
    assert OLD4 in src, "main scan call anchor"
    src = src.replace(OLD4, NEW4, 1)

OLD5 = '"cmdStrips": nstrip, "cmdMontages": nmont}'
NEW5 = ('"cmdStrips": nstrip, "cmdMontages": nmont,\n'
        '                "dialogFrames": n_dialog}')
if '"dialogFrames"' not in src:
    assert OLD5 in src, "manifest anchor"
    src = src.replace(OLD5, NEW5, 1)

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
ast.parse(io.open(P, encoding="utf-8").read())
s = io.open(P, encoding="utf-8").read()
for k in ("def dialog_present", "n_dialog += 1", '"dialogFrames"'):
    print(f"  {k}: {k in s}")
