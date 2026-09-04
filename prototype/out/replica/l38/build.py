# -*- coding: utf-8 -*-
"""课时38「其它工具说明」复刻脚本生成器。

命令清单全部来自 cv\\cmdmont 命令行回显(证据等级 C):
  BREAK 打断 / BREAK 第一点(F)          61-104s, 116-152s, 169-229s
  BREAKATPOINT 打断于点                 250.1s, 332-346s
  JOIN 合并 -> "2 条直线已合并为 1 条直线"  319.2s
  HATCH 图案填充                         419-428s
  WIPEOUT 区域覆盖 + 边框(F)=关(OFF)      473-495s, 734-754s
  DRAWORDER 最后(B) / 最前(F)            550-587s
  TEXTTOFRONT 前置[文字/标注/引线/全部]   760.3s
  MTEXT 文字高度 2.5                     688.3s
  SCALE 比例因子 10                      697.0s
  DIMLINEAR 标注文字 = 649.33            786.2s
  OVERKILL 15 个重叠对象或线段已删除      845.3s; 2 个重复项已删除  882.2s
  MOVE / COPY                            636s, 854-871s
被操作的源对象在视频里是徒手画的, 这里按分区用整数坐标重建;
只声称命令与参数忠实, 不声称源对象尺寸与视频等值。
唯一例外: 649.33 长的线段是刻意造出来的, 目的是让 DIMLINEAR 的
标注回读值与视频 786.2s 的 "标注文字 = 649.33" 完全一致。
"""
import os

OUT = "C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l38"
L = ["FILEDIA 0", "OSMODE 0", "CMDDIA 0"]

# A. BREAK: 1000 长的线, 打断掉 400..600 -> 剩两段
L.append("_.LINE 0,0 1000,0 ")
L.append("_.ZOOM _W -200,-3200 6200,1200")
L.append("_.BREAK 400,0 600,0")

# B. BREAK 第一点(F): 另一条线, 显式指定第一打断点
L.append("_.LINE 0,-300 1000,-300 ")
L.append("_.BREAK 200,-300 _F 300,-300 700,-300")

# C. BREAKATPOINT 打断于点: 一条线一分为二
L.append("_.LINE 0,-600 1000,-600 ")
L.append("_.BREAKATPOINT 300,-600 500,-600")

# D. JOIN 合并: 两条共线线段 -> 1 条 (319.2s 回显)
L.append("_.LINE 0,-900 400,-900 ")
L.append("_.LINE 400,-900 1000,-900 ")
L.append("_.JOIN 200,-900 700,-900 ")

# E. SCALE 比例因子 10 (697.0s): r=50 的圆 -> r=500
L.append("_.CIRCLE 3000,-1800 50")
L.append("_.SCALE 3050,-1800 ")
L.append("3000,-1800 10")

# F. DIMLINEAR: 长度刻意取 649.33, 使标注回读 = 视频 786.2s 的值
L.append("_.LINE 0,-2600 649.33,-2600 ")
L.append("_.DIMLINEAR 0,-2600 649.33,-2600 320,-2900")

# G. WIPEOUT 区域覆盖 + 边框关 (473-495s / 734-754s)
L.append("_.WIPEOUT 5000,-400 5800,-400 5800,200 5000,200 _C")
L.append("_.WIPEOUT _F _OFF")

# H. DRAWORDER 最后(B) / 最前(F) (550-587s)
L.append("_.CIRCLE 5400,-100 250")
L.append("_.DRAWORDER 5650,-100  _B")
L.append("_.DRAWORDER 5650,-100  _F")

# I. HATCH 图案填充 (419-428s): 先 ZOOM 覆盖边界, 再拾取内部点
L.append("_.RECTANG 7000,-400 7800,200")
L.append("_.ZOOM _W 6800,-600 8000,400")
L.append("_.-HATCH _P ANSI31 1 0 7400,-100 ")
L.append("_.ZOOM _W -200,-3200 8200,1200")

# J. 文字: 视频用 MTEXT(文字高度 2.5); 无头下 MTEXT 走就地编辑器会挂,
#    降级为 TEXT 并保持同一文字高度 —— 已在报告中写明。
L.append("_.TEXT 0,-3000 2.5 0 L38")

# K. COPY / MOVE (854-871s)
L.append("_.COPY 3500,-1800  2000,-1800 2000,-1000")
L.append("_.MOVE 150,-300  0,0 0,-100")

# L. OVERKILL 删除重复对象 (845.3s / 882.2s): 造两条完全重合的线再删重
L.append("_.LINE 0,-3100 800,-3100 ")
L.append("_.LINE 0,-3100 800,-3100 ")
L.append("_.-OVERKILL _C -100,-3200 900,-3000 ")
L.append("_D")

L.append("_.ZOOM _E")
L.append("_.SAVEAS 2018 %s/l38.dwg" % OUT)
L.append("_.DXFOUT %s/l38.dxf 16" % OUT)

path = os.path.join(OUT.replace("/", os.sep), "l38.scr")
with open(path, "w", encoding="ascii", newline="\n") as fh:
    fh.write("\n".join(L) + "\n")
print("wrote", path, len(L), "lines")
