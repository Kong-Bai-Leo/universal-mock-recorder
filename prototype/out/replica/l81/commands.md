# 课时81 视口与注释性 —— 命令流

蒙太奇覆盖: 16/16 (100%)

## 命令序列(去掉取消/重画)
COPY(CO) → MOVE(M) → MTEXT → DIMSTYLE(D) → DIMLINEAR ×N →
CANNOSCALE 切换 → ANNOAUTOSCALE 切换 → STYLE(改注释性) →
MSPACE/PSPACE 切换 → 布局1/模型 切换 → EXPLODE(X) →
VIEW(V)/NEWVIEW 命名视图"小佩奇" → -VIEW _RESTORE → MVIEW(MV) 新建视口 →
TEXTEDIT → ERASE

## 数值证据(C = 命令行回显)
| 值 | 出处 |
|---|---|
| 标注文字 = 201 | DIMLINEAR 回显 |
| 标注文字 = 170 | DIMLINEAR 回显(在 1:1 / 1:2 / 1:10 三种注释比例下各量一次) |
| 标注文字 = 150 | DIMLINEAR 回显 |
| 标注文字 = 202 | DIMLINEAR 回显 |
| 标注文字 = 441 | DIMLINEAR 回显 |
| 标注文字 = 462 | DIMLINEAR 回显 |
| CANNOSCALE 1:1→1:2→1:10→1:2→1:10 | 系统变量回显 |
| ANNOAUTOSCALE -4→4→-4 | 系统变量回显 |
| MTEXT 文字样式 5.宋体-2.5 / 高度 2.5 / 注释性 否 | 文字编辑器面板 (D) |
| MTEXT 文字样式 5.宋体-2.5(带注释性) / 高度 5 / 注释性 是 | 文字编辑器面板 (D) |

## 剔除(视频里出现但不进最终序列)
- BLOCK(B) 找到 32 个 → *取消*(t≈740s)
- DONUT(DO) → *取消*
- 夹点拉伸 → *取消*
- TEXTEDIT 反复进出

## 无法取得的证据
源图纸是外部 DWG(8.04代练),模型空间几何的绝对坐标从未在命令行出现,
只有上述 6 个标注读数;因此复刻件用这 6 个读数造参照线段,排列方式为推断。
