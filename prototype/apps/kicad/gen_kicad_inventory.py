#!/usr/bin/env python3
"""KiCad 组件清单：对标 gen_workspace_inventory.py。

和 Blender 的关键差别：bpy.ops 是一张算子分发表，一次 get_rna_type() 就能拿到
类型/默认值/软上下限/枚举取值。pcbnew 是 SWIG 绑定的对象模型，没有分发表——
只能按「类 × 自有方法」枚举，参数类型从 docstring 里解析，**拿不到默认值和范围**。

用 KiCad 自带的 python 跑：
  ~/Applications/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3 \
      scripts/gen_kicad_inventory.py
"""
import inspect
import json
import os
import re
import sys

import pcbnew

SIG = re.compile(r'^\s*(\w+)\((.*?)\)\s*(?:->\s*(.+))?$')
# 值语义的参数类型 —— 这些能自动取样；其余（指针/容器/回调）不能
SCALAR = {"int", "double", "float", "bool", "long", "unsigned int", "wxString",
          "VECTOR2I", "EDA_ANGLE", "PCB_LAYER_ID"}


def parse_params(fn):
    """从 SWIG docstring 抠参数表。拿不到默认值和范围，只有类型。"""
    doc = (fn.__doc__ or "")
    for line in doc.splitlines():
        m = SIG.match(line.strip())
        if not m:
            continue
        args = [a.strip() for a in m.group(2).split(",") if a.strip()]
        out = []
        for a in args[1:]:                      # 跳过 self
            parts = a.rsplit(" ", 1)
            if len(parts) != 2:
                continue
            ty, nm = parts[0].strip(), parts[1].strip()
            out.append({"type": ty, "name": nm,
                        "samplable": ty.split("<")[0].strip() in SCALAR})
        return out
    return None


def survey():
    classes = {n: getattr(pcbnew, n) for n in dir(pcbnew)
               if not n.startswith("_") and inspect.isclass(getattr(pcbnew, n))}
    elements, skipped = [], 0
    for cname, cls in sorted(classes.items()):
        own = [m for m in cls.__dict__ if not m.startswith("_")]
        for m in own:
            fn = getattr(cls, m, None)
            if not inspect.isroutine(fn):
                continue
            # 只要状态变更：Set* 或动作动词开头；Get/Is/Has 是只读
            if m.startswith(("Get", "Is", "Has", "Clone", "Hit", "View", "Visit")):
                continue
            ps = parse_params(fn)
            if ps is None:
                skipped += 1
                continue
            elements.append({
                "id": f"{cname}.{m}", "cls": cname, "method": m,
                "params": ps,
                "n_params": len(ps),
                "all_samplable": bool(ps) and all(p["samplable"] for p in ps),
            })
    return elements, skipped, len(classes)


def main():
    els, skipped, ncls = survey()
    out = {"kicad_version": pcbnew.GetBuildVersion(),
           "n_classes": ncls, "n_elements": len(els),
           "n_doc_unparsed": skipped, "elements": els}
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(root, "kicad_inventory.json")
    json.dump(out, open(p, "w"), indent=1)

    samplable = [e for e in els if e["all_samplable"]]
    zero = [e for e in els if e["n_params"] == 0]
    print(f"KiCad {out['kicad_version']}")
    print(f"  类                       {ncls}")
    print(f"  状态变更方法（自有）     {len(els)}")
    print(f"  └ 参数全部可自动取样     {len(samplable)}")
    print(f"  └ 无参（纯动作）         {len(zero)}")
    print(f"  docstring 解析失败       {skipped}")
    print(f"  → {p}")

    from collections import Counter
    c = Counter(e["cls"] for e in samplable)
    print("\n可取样方法最多的 15 个类：")
    for k, v in c.most_common(15):
        print(f"  {k:28s} {v:4d}")


main()
