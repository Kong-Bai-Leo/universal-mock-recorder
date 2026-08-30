# -*- coding: utf-8 -*-
"""把"模态对话框"检测扩成"光标合法缺席"检测,并据此修正 doctor 的误报。

调查过程(不是猜的):
  1. doctor 标了 13 课 "LOW cursor signal"(49%~70%);
  2. 先假设是对话框遮挡 -> 加 dialog_present() 检测 -> 课时46 实测 dialogFrames=0,
     **假设被自己的检测证伪**;
  3. 抽出真正的 "none" 帧来看 -> 课时46 全程在 **MTEXT 就地文字编辑器** 里:
     画面上是带背景色块的文字编辑框 + "文字编辑器"功能区选项卡。
  4. 结论: 编辑器接管画布时 AutoCAD 显示**文本 I 形光标而非全屏十字线**,
     "找不到十字线"是正确行为, 不是 CV 失效。

所以判据改成: 统计"光标合法缺席"的帧 —— 画布被模态对话框覆盖, **或**
画布内出现明显的彩色填充块(就地编辑器的文字背景色, 深色主题画布里不会有)。
doctor 用"非合法缺席帧"作分母算命中率, 并单独报告缺席占比。
"""
import ast
import io
import os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8").read()

OLD = '''    def dialog_present(self, gray):
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
'''

NEW = '''    def cursor_absent_ok(self, gray, bgr):
        """光标"合法缺席": 此时本来就不该有全屏十字线, 不算 CV 失效。

        两种情形(均已在真实素材上验证):
          a) 模态对话框覆盖画布 —— 大片浅灰底(亮度 150~245)超过画布 8%;
          b) 就地编辑器接管画布(MTEXT/表格/属性)—— 画布里出现明显的
             **彩色填充块**(编辑框背景色)。深色主题的画布本身是近黑 + 白/黄线条,
             不会有成片的高饱和彩色, 所以这个判据不会误伤正常绘图。
        """
        x0, y0, x1, y1 = self.c["canvas"]
        roi = gray[y0:y1, x0:x1]
        if roi.size == 0:
            return False
        if int(((roi > 150) & (roi < 245)).sum()) > 0.08 * roi.size:
            return True                      # (a) 对话框
        c = bgr[y0:y1, x0:x1].astype(np.int16)
        mx = c.max(axis=2)
        mn = c.min(axis=2)
        colored = ((mx - mn) > 60) & (mx > 80)   # 高饱和且不暗 = 编辑框底色
        return int(colored.sum()) > 0.02 * roi.size   # (b) 就地编辑器
'''

if "cursor_absent_ok" not in src:
    assert OLD in src, "dialog_present anchor not found"
    src = src.replace(OLD, NEW, 1)

src = src.replace("            if self.dialog_present(gray):\n                n_dialog += 1",
                  "            if self.cursor_absent_ok(gray, bgr):\n                n_dialog += 1", 1)
src = src.replace('"dialogFrames": n_dialog}', '"cursorAbsentOkFrames": n_dialog}', 1)

io.open(P, "w", encoding="utf-8", newline="\n").write(src)
ast.parse(io.open(P, encoding="utf-8").read())
s = io.open(P, encoding="utf-8").read()
for k in ("def cursor_absent_ok", "self.cursor_absent_ok(gray, bgr)", '"cursorAbsentOkFrames"'):
    print(f"  {k}: {k in s}")
