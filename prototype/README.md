# CAD 视频复刻原型

从 AutoCAD 教学录屏抽出命令流，生成 `.scr`，用真 AutoCAD 无头回放，再解析 DXF 校验。

**复现的是过程**（同命令、同顺序、同参数），不是看终态另找一条路。

## 三条腿（成熟度差很多，别混着看）

管线拆成两半：**视频半边**（录屏 → CV → 命令流）和 **真机半边**（回放 → 解析原生输出校验）。
只有 AutoCAD 两半都通。

| 软件 | S0 驱动面 | 真机回放+校验 | 视频复刻 | 产出 |
|---|:---:|:---:|:---:|---|
| **AutoCAD** 2027 | ✅ CUIx 736 命令 | ✅ `.scr` → DXF | ✅ | 124 课，见 `STATUS.md` |
| **3ds Max** 2027 | ✅ 反射 507 类 | ✅ `.ms` → 场景 JSON | ❌ | 151 原子 / 358 用例，见 `apps/max/` |
| **KiCad** 10.0.6 | ✅ 2402 元素（709 可取样） | ❌ | ❌ | 只有清单，见 `apps/kicad/` |

3ds Max 和 KiCad 目前**没有视频那半边**——`cv/` 的布局识别只对 AutoCAD 深色主题
＋命令行回显标定过。它们现在贡献的是真机 oracle 半边，以及各自的驱动面普查方法
（三种软件的驱动面藏在三个完全不同的地方：CUIx zip 里的 XML、MaxScript 类反射、
SWIG 绑定的对象模型）。

| 文档 | 内容 |
|---|---|
| `SOP.md` | 单课作业规程、铁律 R1–R6、无头坑表 |
| `STAGE_PLAN.md` | S0–S6 流水线 |
| `STATUS.md` | 124 课盘点（机械完成 ≠ 独立数值验证） |
| `cadrep.py` | CLI：discover / probe / replay / verify / status |
| `audit.py` | 机械验收（文件/空图/日志），**不是** Claude 级审核 |
| `verify.py` | DXF 实体 + 标注回读 |
| `apps/max/` | 3ds Max 腿：快照 / fixture / IO harness + MaxScript 坑表 |
| `apps/kicad/` | KiCad 腿：pcbnew 驱动面清单 + 与 bpy/CUIx 的结构差异 |

```powershell
py -3.11 cadrep.py status
py -3.11 audit.py
py -3.11 cadrep.py replay 54
```

视频目录默认：`D:\Black Myth\CAD零基础入门到精通教程…`（本机，不入库）。

GitHub 只收源码、SOP、每课 `lN.scr` + `commands.md` + `verify.json`。
`out/**/*.png|jpg|dwg|dxf` 和 `cv/` 切片留在本机（约 13GB）。
