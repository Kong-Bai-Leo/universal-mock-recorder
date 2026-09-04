# -*- coding: utf-8 -*-
"""课时52 标注样式-箭头与符号。

证据:
  C  `DIMRADIUS 标注文字 = 82.03`(命令行回显)-> 圆半径 82.03
  C  `DIMBREAK ... 1 个对象已修改`(命令行回显)-> 折断标注生效
  C  `D / DIMSTYLE` 反复开关标注样式管理器(箭头与符号选项卡)
  D  370s 画布: 两个圆带**直线型圆心标记**(十字线伸出圆外)-> DIMCEN < 0;
     矩形上方标注使用不同箭头形状;右下角为线型样例
  L  矩形尺寸与摆位(视频里徒手拾取, 命令行无回显)

剔除: 夹点编辑 *取消*(334.6/344.6/352.3s)、`_u 夹点编辑` 撤销、
      DIMSTYLE 多次打开即关闭。

做不到: 箭头大小 DIMASZ、圆心标记长度的**具体数值**在命令行没有回显,
        对话框帧未捕获到该选项卡 —— 这里用能从画面判定的**类型**
        (圆心标记=直线 DIMCEN 取负)而不编造数值, DIMASZ 保持默认。
"""
import os

D = os.path.dirname(os.path.abspath(__file__))
B = D.replace("\\", "/")

R = 82.03                     # C 级: DIMRADIUS 标注文字 = 82.03

out = ["FILEDIA 0", "OSMODE 0",
       "DIMASZ 2.5",          # 默认值, 未从视频取得 -> L
       "DIMCEN -5",           # D 级: 画面显示为直线型圆心标记(负值=直线)
       "DIMTXT 2.5",
       "_.ZOOM _W -40,-40 460,220"]

# 三个矩形: 演示不同箭头(实心闭合 / 建筑标记 / 无)
ARROWS = [("_.-DIMSTYLE", None), None, None]
RECTS = [(0, 0), (150, 0), (300, 0)]
for i, (x, y) in enumerate(RECTS):
    out.append(f"_.RECTANG {x},{y} _D 110 70 {x + 10},{y + 10}")

# 箭头样式: DIMBLK 用命令行设置(建筑标记 / 无), 逐个标注
out += ["DIMBLK .",           # 默认实心闭合箭头
        "_.DIMLINEAR 0,70 110,70 55,95"]
out += ["DIMBLK _ARCHTICK",
        "_.DIMLINEAR 150,70 260,70 205,95"]
out += ["DIMBLK _NONE",
        "_.DIMLINEAR 300,70 410,70 355,95"]

# 两个带圆心标记的圆 + 半径标注(82.03 为命令行确认值)
# 注意两点: (1) 拾取点必须落在**圆周**上, 点圆心会 "No Object Found";
#           (2) 拾取点还必须在**当前 ZOOM 窗口内**, 否则同样找不到对象。
# 圆心标记以系统变量 DIMCEN 落地(这正是本课要教的设置项);
# 不逐个画 DIMCENTER —— 它生成的十字线会挡住后续 DIMRADIUS 的拾取。
out += ["PICKBOX 10", "_.ZOOM _W -60,-240 480,140"]
for cx in (60, 260):
    out.append(f"_.CIRCLE {cx},-110 {R}")
# 每个 token 单独一行 —— 一行串联时"尺寸线位置"这一问吃不到参数
out += ["_.DIMRADIUS", f"60,{-110 + R:.2f}",       # 圆顶点
        f"{60 + R * 0.9:.2f},{-110 + R * 1.4:.2f}"]

out += ["_.ZOOM _E",
        f"_.SAVEAS 2018 {B}/l52.dwg",
        f"_.DXFOUT {B}/l52.dxf 16",
        "_.ZOOM _E"]
open(os.path.join(D, "l52.scr"), "w", encoding="utf-8-sig").write("\n".join(out) + "\n")
print("l52.scr:", len(out), "lines")
