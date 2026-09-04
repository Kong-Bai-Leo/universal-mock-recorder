# -*- coding: utf-8 -*-
"""修复 audit.py 查出的历史遗留问题(课时 4 与 123-127)。

123-127 是本管线早期做的, 当时产物在 out/lNNN/ 下, 后来复制进 out/replica/lNNN/
但 (a) 没带 cv/ 目录 -> 审计报"违反 R1", (b) .scr 里的 SAVEAS 仍指向旧路径
-> 重跑会写错地方。这里把 cv/ 归位并修正路径。
课时4 是纯设置课(无图形), 补一份 commands.md 说明, 否则审计判"成品为空且无说明"。
"""
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)          # .../prototype/out

# --- 1) 123-127: 把早期的 cv 产物归位到 replica ---
for n in ("123", "124", "125", "126", "127"):
    for src in (os.path.join(OUT, f"l{n}", "cv"), os.path.join(OUT, f"l{n}")):
        if not os.path.isdir(src):
            continue
        # 早期布局有两种: out/lN/cv/cmdmont 或 out/lN/cmdmont
        for sub in ("cmdmont", "cmdstrips"):
            s = os.path.join(src, sub)
            d = os.path.join(HERE, f"l{n}", "cv", sub)
            if os.path.isdir(s) and not os.path.isdir(d):
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copytree(s, d)
                print(f"l{n}: 复制 {sub} ({len(os.listdir(s))} 个)")
        for f in ("manifest.json", "actions.json", "episodes.json",
                  "input_events.json", "trajectory.json"):
            s = os.path.join(src, f)
            d = os.path.join(HERE, f"l{n}", "cv", f)
            if os.path.exists(s) and not os.path.exists(d):
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(s, d)

# --- 2) 123-127: 修正 .scr 里的输出路径 ---
for n in ("123", "124", "125", "126", "127"):
    p = os.path.join(HERE, f"l{n}", f"l{n}.scr")
    if not os.path.exists(p):
        continue
    t = open(p, encoding="ascii", errors="replace").read()
    want = f"C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l{n}/l{n}"
    t2 = re.sub(r"(_\.SAVEAS\s+\S+\s+)\S+\.dwg", lambda m: m.group(1) + want + ".dwg", t)
    t2 = re.sub(r"(_\.DXFOUT\s+)\S+\.dxf", lambda m: m.group(1) + want + ".dxf", t2)
    if t2 != t:
        open(p, "w", encoding="ascii").write(t2)
        print(f"l{n}: 修正 SAVEAS/DXFOUT 路径")

# --- 3) 课时4: 补证据说明 ---
p4 = os.path.join(HERE, "l4", "commands.md")
if not os.path.exists(p4):
    os.makedirs(os.path.dirname(p4), exist_ok=True)
    open(p4, "w", encoding="utf-8").write("""# 课时4 文件样板设置 —— 命令流与证据

**本课无图形产物**:全程是对话框设置,视频里画的两个圆是试画,随后被 ERASE 删除。
成品 `l4.dwg` 因此是一份"空图纸 + 已配置的系统变量",这是忠实结果,不是失败。

## 命令流(读完全部 6 张蒙太奇)

`_new` → 选择样板对话框 → `PASTECLIP` → 多次 `_Options`/`OP` → `CIRCLE` 试画
→ `<栅格 关>` → `_erase 找到 2 个` → `_SAVEAS`

## 从对话框读出的设置(证据等级 C)

| 系统变量 | 值 | 出处 |
|---|---|---|
| VIEWRES | 1000 | 显示选项卡「圆弧和圆的平滑度」 |
| SPLINESEGS | 8 | 「每条多段线曲线的线段数」 |
| FACETRES | 0.5 | 「渲染对象的平滑度」 |
| ISOLINES | 4 | 「每个曲面的轮廓素线」 |
| CURSORSIZE | 5 | 「十字光标大小」 |
| XDWGFADECTL | 50 | 「外部参照显示」淡入度 |
| XFADECTL | 70 | 「在位编辑和注释性表达」 |
| SAVETIME | 10 | 打开和保存选项卡「保存间隔分钟数」 |
| GRIDMODE | 0 | 命令行 `<栅格 关>` |
| 保存格式 | AutoCAD 2004 | 「另存为」下拉框 |

## 独立验证

视频命令行显示 `_erase 找到 2 个`;回放日志同样是 `2 found` —— 试画的两个圆数量一致。

## 做不到的部分

OPTIONS 里属于**应用级(注册表)**而非图纸级的项(颜色主题、右键自定义、文件路径等)
无法随 DWG 保存,只能作为会话变量设置,重开 AutoCAD 不保留。
""")
    print("l4: 补 commands.md")

print("done")
