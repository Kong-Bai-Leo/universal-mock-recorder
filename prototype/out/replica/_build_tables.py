# -*- coding: utf-8 -*-
"""课时61 插入表格 / 62 编辑表格。

证据:
  D  「插入表格」对话框(700s 帧, 逐项读出):
       表格样式 = 材料表样式
       插入方式 = 指定插入点(I)
       列数(C) = 5      列宽(D) = 20
       数据行数(R) = 5  行高(G) = 5 行
       第一行单元样式 = 标题 / 第二行 = 表头 / 其他行 = 数据
       插入选项 = 从空表格开始(S)
  C  命令行: `_table` → `指定插入点:` / `指定第一个角点:` → `指定第二角点:`;
     随后多次 `TABLEEDIT`(编辑单元)
剔除: 805.7/808.1/853.7s `*取消*`;794.2–803.3s 夹点点位置反复未确认;
     多次 `TABLEEDIT` 打开即关闭。

做不到: **单元格里填的具体文字**在命令行没有回显(TABLEEDIT 是就地编辑器),
        只能确认"编辑过哪些单元", 内容不编造 —— 表格建出来是空的。
"""
import os

R = os.path.dirname(os.path.abspath(__file__))

COLS, COLW, ROWS, ROWH = 5, 20, 5, 5      # 全部来自对话框(D 级)


def emit(n, body, note):
    b = f"{R}/l{n}/l{n}".replace("\\", "/")
    out = ["FILEDIA 0", "OSMODE 0"] + body + [
        "_.ZOOM _E", f"_.SAVEAS 2018 {b}.dwg", f"_.DXFOUT {b}.dxf 16", "_.ZOOM _E"]
    d = os.path.join(R, f"l{n}")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, f"l{n}.scr"), "w", encoding="utf-8-sig").write("\n".join(out) + "\n")
    open(os.path.join(d, "commands.md"), "w", encoding="utf-8").write(note)
    print(f"l{n}.scr: {len(out)} lines")


# 表格样式: 材料表样式(对话框读出的名字)
# -TABLESTYLE 无头下不可用于新建, 用 -TABLE 的样式参数直接引用 Standard,
# 并把样式名写进说明 —— 不假装建出了同名样式。
def table_body(extra=None):
    # -TABLE 只问「列数 / 行数」, 列宽与行高要在"指定插入点"那一问里
    # 用 Width / Height 选项设置, 设完才给插入点。
    body = [
        "_.-TABLE",
        str(COLS),          # 列数
        str(ROWS),          # 数据行数
        "_W", str(COLW),    # 列宽 20
        "_H", str(ROWH),    # 行高 5
        "0,0",              # 插入点(对话框: 指定插入点方式)
    ]
    return body + (extra or [])


emit(61, table_body(), """# 课时61 插入表格

## 证据
「插入表格」对话框(700s)逐项读出(D 级):
表格样式=**材料表样式**、插入方式=指定插入点(I)、插入选项=从空表格开始(S)、
**列数 5 / 列宽 20 / 数据行数 5 / 行高 5 行**、
第一行单元样式=标题、第二行=表头、其他行=数据。

命令行(C 级):`_table` → `指定插入点:` / `指定第一个角点:` → `指定第二角点:`,
随后多次 `TABLEEDIT`。

## 剔除
805.7 / 808.1 / 853.7s `*取消*`;794.2–803.3s 夹点点位置反复未确认;
多次 TABLEEDIT 打开即关闭未改动。

## 做不到
1. **表格样式「材料表样式」无法在无头下新建** —— `-TABLESTYLE` 不支持创建带
   标题/表头/数据三级单元样式的样式;这里用 Standard 样式建表,
   行列尺寸严格用对话框读出的 5/20/5/5。
2. **单元格文字没有任何回显**(TABLEEDIT 是就地编辑器),表格建出来是空的,
   不编造内容。
""")

emit(62, table_body(), """# 课时62 编辑表格

## 证据
承接课时61 的表格(列数 5 / 列宽 20 / 数据行数 5 / 行高 5,均为对话框读出)。
本课命令流以 `TABLEEDIT` 反复进出为主,配合夹点调整列宽行高。

## 做不到
1. `TABLEEDIT` 的单元内容编辑是**就地编辑器**,无头下无法驱动,
   编辑动作与文字内容均无回显 —— 未复现,表格保持空白。
2. 夹点拉伸调整列宽/行高的**目标值**没有回显,未复现。
""")
