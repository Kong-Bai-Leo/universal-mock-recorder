# -*- coding: utf-8 -*-
"""课时78 绘制图框补充 —— A3 图框 + 属性标题栏。

证据:
  C: 图框 A3 420x297、内框 OFFSET 5   <- 承接课时77 的命令行回显
  C: ATTDEF(命令行 `ATT / ATTDEF 指定起点:`)、MOVE 找到 35 个(整体搬动标题栏)
  M: 标题栏格线比例 —— 由 900s 终态帧测量(51 条白色线段)换算
  D: 标题栏文字 —— 从终态画布读出:设计/制图/校对/审批、平面布置图、
     PM-01-04、第01页、共19页

剔除: 大量 *取消*(356.3/357.2/378.8/380.8/386.0/386.5/389.9/677.5/678.0/
      679.9/683.3/683.7…)、MTEDIT 多次进出未改动、夹点拉伸全部取消、
      `_.erase 找到 1 个` ×2。

做不到: 标题栏各行列的**绝对毫米尺寸**在命令行没有回显(全鼠标拾取),
        这里按终态测量的比例映射到 A3 图框右下角 —— 属 M 级,不声称等值。
"""
import os

D = os.path.dirname(os.path.abspath(__file__))
B = D.replace("\\", "/")

W, H = 420.0, 297.0          # A3(课时77 命令行确认)
M = 5.0                      # 内框偏移(课时77 命令行确认 OFFSET 5)

# 标题栏: 由终态帧测量得到的比例(标题栏宽约占图幅 0.72,高约占 0.37)
TW, TH = 180.0, 50.0
TX, TY = W - M - TW, M       # 贴内框右下角
# 列分割比例(测量): 左大格 0.38 | 标签列 0.17 | 值列 0.25 | 右格 0.20
COLS = [0.0, 0.38, 0.55, 0.80, 1.0]
ROWS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

out = ["FILEDIA 0", "OSMODE 0", "TEXTSIZE 3.5",
       # TTF 字体没有"垂直"提示, 只有 backwards / upside-down 两问
       "_.-STYLE hei SimSun 0 1 0 _N _N"]

# 外框 + 内框
out.append(f"_.RECTANG 0,0 _D {W} {H} 10,10")
out.append(f"_.RECTANG {M},{M} _D {W - 2 * M} {H - 2 * M} {M + 10},{M + 10}")
out.append("_.ZOOM _W -20,-20 460,340")

# 标题栏外框
out.append(f"_.RECTANG {TX},{TY} _D {TW} {TH} {TX + 10},{TY + 10}")
# 竖分割线(跳过两端)
for c in COLS[1:-1]:
    x = TX + TW * c
    out.append(f"_.LINE {x:.3f},{TY:.3f} {x:.3f},{TY + TH:.3f} ")
# 横分割线(只在右半部分, 与终态一致: 左侧是大格)
for r in ROWS[1:-1]:
    y = TY + TH * r
    out.append(f"_.LINE {TX + TW * COLS[1]:.3f},{y:.3f} {TX + TW:.3f},{y:.3f} ")

# 属性定义(ATTDEF)。注意: 提示/默认值这两问会**吃掉整行**(文本可含空格),
# 所以每个 token 必须单独一行, 不能像 RECTANG 那样用空格串在一起。
def attdef(tag, prompt, default, x, y, h):
    out.extend(["_.-ATTDEF", "", tag, prompt, default,
                f"{x:.3f},{y:.3f}", str(h), "0"])


for tag, prompt, row in [("SJ", "设计", 1), ("ZT", "制图", 2),
                         ("JD", "校对", 3), ("SP", "审批", 4)]:
    attdef(tag, prompt, prompt,
           TX + TW * COLS[1] + 2, TY + TH * ROWS[len(ROWS) - 1 - row] + 1.5, 3.5)

attdef("TM", "图名", "平面布置图", TX + 6, TY + TH * 0.55, 5)
attdef("TH", "图号", "PM-01-04", TX + 6, TY + TH * 0.22, 5)
attdef("YM", "页码", "第01页", TX + TW * COLS[1] + 2, TY + 1.5, 3.5)
attdef("ZY", "总页", "共19页", TX + TW * COLS[2] + 2, TY + 1.5, 3.5)

out += ["_.ZOOM _E",
        f"_.SAVEAS 2018 {B}/l78.dwg",
        f"_.DXFOUT {B}/l78.dxf 16",
        "_.ZOOM _E"]
open(os.path.join(D, "l78.scr"), "w", encoding="utf-8-sig").write("\n".join(out) + "\n")
print("l78.scr:", len(out), "lines")
