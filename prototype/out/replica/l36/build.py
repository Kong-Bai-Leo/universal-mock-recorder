# -*- coding: utf-8 -*-
"""课时36 复刻脚本生成器: 偏移(OFFSET) 与 拉长(LENGTHEN)。

所有命令与数值均来自 cv\\cmdmont 命令行回显(证据等级 C):
  OFFSET 偏移距离 100 (59.5s) / 500 (70.6s) / 1000 (86.4s 起, 全片默认值)
  OFFSET 删除(E)=是 + 距离 1000 (530-535s)
  OFFSET 图层(L)=当前(C) (885-893s)
  LENGTHEN 增量(DE) 长度增量 100 (656.4s)
  LENGTHEN 增量(DE) 角度(A) 角度增量 30 (768.2s)
  LENGTHEN 百分比(P) 150 (693.3s) / 200 (830.7s)
  LENGTHEN 总计(T) 角度(A) 总角度 150 (739.0s)
源对象(被偏移/被拉长的线、弧、圆)在视频里是徒手画的, 这里按各演示分区
用整数坐标重建, 只保证命令与参数忠实, 源对象尺寸不声称与视频等值。
"""
import os

OUT = "C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l36"

L = ["FILEDIA 0", "OSMODE 0"]

# ---------------------------------------------------------------- 偏移演示
# A. 直线偏移: 100 / 500 / 1000 (59.5s / 70.6s / 86.4s)
L.append("_.LINE 0,0 0,2000 ")
L.append("_.ZOOM _W -1500,-500 3500,2500")
L.append("_.OFFSET 100 0,1000 200,1000 ")
L.append("_.OFFSET 500 0,1000 200,1000 ")
L.append("_.OFFSET 1000 0,1000 200,1000 ")

# B. 圆偏移 1000 (203.6s 画圆, 207-223s 偏移)
L.append("_.CIRCLE 6000,1000 400")
L.append("_.ZOOM _W 3500,-1500 8500,3500")
L.append("_.OFFSET 1000 6400,1000 7800,1000 ")

# C. 圆弧偏移 1000 (165s 画弧, 172-186s 偏移)
L.append("_.ARC _C 12000,1000 12800,1000 _A 120")
L.append("_.ZOOM _W 9500,-1500 14500,3500")
L.append("_.OFFSET 1000 12800,1000 14000,1000 ")

# D. 偏移后删除源对象 = 是, 距离 1000 (530.1-535.4s)
L.append("_.LINE 18000,0 18000,2000 ")
L.append("_.ZOOM _W 16500,-500 20500,2500")
L.append("_.OFFSET _E _Y 1000 18000,1000 19000,1000 ")

# ---------------------------------------------------------------- 拉长演示
# E. 增量(DE) 长度增量 100 (656.4s): 1000 长的线 -> 1100
L.append("_.LINE 0,-3000 1000,-3000 ")
L.append("_.ZOOM _W -500,-3800 2000,-2200")
L.append("_.LENGTHEN _DE 100 990,-3000 ")

# F. 百分比(P) 150 (693.3s): 1000 -> 1500
L.append("_.LINE 0,-5000 1000,-5000 ")
L.append("_.ZOOM _W -500,-5800 2000,-4200")
L.append("_.LENGTHEN _P 150 990,-5000 ")

# G. 百分比(P) 200 (830.7s): 1000 -> 2000
L.append("_.LINE 0,-7000 1000,-7000 ")
L.append("_.ZOOM _W -500,-7800 2500,-6200")
L.append("_.LENGTHEN _P 200 990,-7000 ")

# H. 增量(DE) 角度(A) 角度增量 30 (768.2s): 60 度弧 -> 90 度
L.append("_.ARC _C 6000,-3000 6800,-3000 _A 60")
L.append("_.ZOOM _W 4800,-4200 7400,-1800")
L.append("_.LENGTHEN _DE _A 30 6800,-3000 ")

# I. 总计(T) 角度(A) 总角度 150 (739.0s): 60 度弧 -> 150 度
L.append("_.ARC _C 12000,-3000 12800,-3000 _A 60")
L.append("_.ZOOM _W 10800,-4200 13400,-1800")
L.append("_.LENGTHEN _T _A 150 12800,-3000 ")

L.append("_.ZOOM _E")
L.append("_.SAVEAS 2018 %s/l36.dwg" % OUT)
L.append("_.DXFOUT %s/l36.dxf 16" % OUT)

path = os.path.join(OUT.replace("/", os.sep), "l36.scr")
with open(path, "w", encoding="ascii", newline="\n") as fh:
    fh.write("\n".join(L) + "\n")
print("wrote", path, len(L), "lines")
