# CAD 视频复刻原型

从 AutoCAD 教学录屏抽出命令流，生成 `.scr`，用真 AutoCAD 无头回放，再解析 DXF 校验。

**复现的是过程**（同命令、同顺序、同参数），不是看终态另找一条路。

| 文档 | 内容 |
|---|---|
| `SOP.md` | 单课作业规程、铁律 R1–R6、无头坑表 |
| `STAGE_PLAN.md` | S0–S6 流水线 |
| `STATUS.md` | 124 课盘点（机械完成 ≠ 独立数值验证） |
| `cadrep.py` | CLI：discover / probe / replay / verify / status |
| `audit.py` | 机械验收（文件/空图/日志），**不是** Claude 级审核 |
| `verify.py` | DXF 实体 + 标注回读 |

```powershell
py -3.11 cadrep.py status
py -3.11 audit.py
py -3.11 cadrep.py replay 54
```

视频目录默认：`D:\Black Myth\CAD零基础入门到精通教程…`（本机，不入库）。

GitHub 只收源码、SOP、每课 `lN.scr` + `commands.md` + `verify.json`。
`out/**/*.png|jpg|dwg|dxf` 和 `cv/` 切片留在本机（约 13GB）。
