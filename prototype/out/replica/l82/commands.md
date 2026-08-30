# 课时82 视口及注释性补充 —— 命令流

蒙太奇覆盖: 21/21 (100%)

## 命令序列
RECTANG(尺寸 D) → MOVE → CANNOSCALE 切换 → DIMLINEAR ×N → MTEXT(注释性) →
NEWVIEW/-VIEW _RESTORE → -vports 视口锁定 on → ANNOALLVISIBLE → ANNOAUTOSCALE →
SCALELISTEDIT(比例列表编辑) → SAVEAS → 新建 Drawing1 → COPY

## 数值证据 (C)
| 值 | 出处 |
|---|---|
| RECTANG 长度 5 / 宽度 5 | 尺寸(D) 选项键入,图纸空间注释方块 |
| 标注文字 = 481 / 635 / 1821 / 1749 / 1889 / 2484 / 3750 / 4920 / 3899 / 5056 | DIMLINEAR 回显 |
| CANNOSCALE 1:10→1:5→1:20→1:40 | 系统变量回显 |
| ANNOALLVISIBLE 0→1 | 系统变量回显 |
| ANNOAUTOSCALE -4→4 | 系统变量回显 |
| MTEXT 高度 12.5(比例 1:5) / 50(比例 1:20),注释性 是 | 文字编辑器面板 (D) |
| 命名视图 "佩奇02" / "小猪佩奇03" | -VIEW _RESTORE 回显 |

## 推导结论
12.5 = 2.5×5,50 = 2.5×20,课时81 的 5 = 2.5×2 —— 三处一致,
说明该注释性文字样式的**图纸高度恒为 2.5**,模型显示高度 = 2.5 × 当前注释比例。
复刻件按图纸高度 2.5 建样式。

## 剔除
- RECTANG 之后一次 *取消*(t≈105.6s)
- SCALELISTEDIT 是对话框命令,只改比例列表,不产生图元

## 无法取得的证据
同课时81:源图纸为外部 DWG,几何绝对坐标无回显。
