# KiCad 腿

KiCad 10.0.6，`pcbnew` Python 绑定。**目前只有 S0 驱动面普查**，没有 IO 采集、没有回放、没有视频复刻。

## 已有什么

`gen_kicad_inventory.py` → `kicad_inventory.json`：

| 指标 | 实测 |
|---|---|
| 类 | 179 |
| 元素（类 × 自有方法） | 2402 |
| 参数全部可取样 且 有参数 | **709** |
| docstring 解析失败 | 53 |

用 KiCad 自带的 python 跑（不是系统 python）：

```bash
~/Applications/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 \
    gen_kicad_inventory.py
```

## 与 Blender / AutoCAD 的结构性差别

Blender 的 `bpy.ops` 是一张**算子分发表**，一次 `get_rna_type()` 就拿到类型、默认值、软上下限、枚举取值。
AutoCAD 的 CUIx 是一棵**命令树**，宏里带 CLI 命令名。

`pcbnew` 两者都不是——它是 **SWIG 绑定的对象模型**，没有分发表。只能按「类 × 自有方法」枚举，
参数类型从 docstring 抠，**拿不到默认值，也拿不到取值范围**。

这直接决定了下一步的难点：`examples.json` 那种「每原子 ≥3 条真实用法、主参数非默认」的要求，
在 KiCad 上没有默认值可参照，得靠真机试跑反推。

值语义、能自动取样的参数类型只有这些：
`int / double / float / bool / long / unsigned int / wxString / VECTOR2I / EDA_ANGLE / PCB_LAYER_ID`。
其余（指针 / 容器 / 回调）不能自动取样——709 这个数就是这么筛出来的。

## 还缺什么

- ❌ S1 workflow 分类（709 个可驱动原子分别属于哪条真人工作流：布局 / 布线 / 封装 / 覆铜 / DRC / 制造输出）
- ❌ S2 IO 采集：需要一个 `.kicad_pcb` 快照器（对标 `acad_snap.py` / `max_snap.ms`），
  好消息是 `.kicad_pcb` 是 s-expression 纯文本，解析比 DXF 容易
- ❌ 回放通道：`kicad-cli` + pcbnew 脚本，无头可行性未验证
- ❌ 视频复刻：CV 那半边（`prototype/cv/`）只对 AutoCAD 深色主题标定过
