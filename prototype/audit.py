# -*- coding: utf-8 -*-
"""复刻成果验收器 —— 主控用来检查 subagent 的产出质量。

不只看"文件在不在", 而是查证据链与回放质量:
  A1 无 CV 产物        -> 违反铁律 R1(必须由 CV 走完整段视频)
  A2 成品为空          -> DXF 里 0 个实体
  A3 脚本过于单薄      -> 有效命令行数过少, 可能是敷衍
  A4 回放日志有错      -> Invalid / Unknown command / TIMEOUT / 未知命令
  A5 输出路径不对      -> .scr 没写到本课目录, 可能覆盖别人的产物
  A6 缺少证据说明      -> 没有 commands.md 也没有 geo.json, 无法追溯数值来源

用法:
    py -3.11 audit.py             # 审全部有产出的课
    py -3.11 audit.py 16 17 18    # 审指定课
    py -3.11 audit.py --strict    # 把"证据说明缺失"也算作失败
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPLICA = os.path.join(HERE, "out", "replica")

BAD_LOG = [
    ("TIMEOUT", "回放超时被杀"),
    ("Unknown command", "命令不存在"),
    ("*Invalid selection*", "选择集无效"),
    ("Invalid point", "坐标无效"),
    ("Invalid option keyword", "选项关键字无效"),
    ("Valid hatch boundary not found", "填充边界未找到"),
    ("Requires a TAN object-snap", "TTR 切点拾取失败"),
    ("Point or option keyword required", "缺少必需的点/关键字"),
]


def audit_one(n, strict=False):
    b = os.path.join(REPLICA, f"l{n}")
    scr = os.path.join(b, f"l{n}.scr")
    dwg = os.path.join(b, f"l{n}.dwg")
    dxf = os.path.join(b, f"l{n}.dxf")
    issues, notes = [], []

    if not os.path.exists(scr) and not os.path.exists(dwg):
        return None                                   # 还没做, 不算问题

    # A1 CV 产物
    mont = os.path.join(b, "cv", "cmdmont")
    n_mont = len(os.listdir(mont)) if os.path.isdir(mont) else 0
    if n_mont == 0:
        issues.append("A1 无 CV 产物(违反 R1)")
    else:
        notes.append(f"蒙太奇{n_mont}")

    # A2 成品是否为空
    ents = 0
    vj = os.path.join(b, "verify.json")
    if os.path.exists(vj):
        try:
            with open(vj, encoding="utf-8") as fh:
                counts = json.load(fh).get("counts", {})
            ents = sum(counts.values())
            notes.append("+".join(f"{k}{v}" for k, v in
                                  sorted(counts.items(), key=lambda x: -x[1])[:4]))
        except Exception:
            issues.append("A2 verify.json 损坏")
    elif os.path.exists(dxf):
        issues.append("A2 未跑 verify")
    if os.path.exists(dwg) and os.path.exists(vj) and ents == 0:
        # 课时4 那类纯设置课允许为空, 但要有 commands.md 说明
        if not os.path.exists(os.path.join(b, "commands.md")):
            issues.append("A2 成品为空且无说明")

    # A3 脚本单薄
    if os.path.exists(scr):
        with open(scr, encoding="ascii", errors="replace") as fh:
            lines = [l for l in fh.read().splitlines() if l.strip()]
        cmds = [l for l in lines if l.lstrip().startswith("_.")]
        notes.append(f"脚本{len(lines)}行/{len(cmds)}命令")
        if len(cmds) < 3:
            issues.append(f"A3 脚本仅 {len(cmds)} 条命令")
        # A5 输出路径
        body = "\n".join(lines)
        m = re.search(r"_\.SAVEAS\s+\S+\s+(\S+)", body)
        if m and f"/l{n}/l{n}.dwg" not in m.group(1).replace("\\", "/"):
            issues.append(f"A5 SAVEAS 路径可疑: {m.group(1)[-48:]}")
    else:
        issues.append("A3 有 dwg 但无 .scr(无法复现)")

    # A4 回放日志
    log = os.path.join(b, "log.txt")
    if os.path.exists(log):
        try:
            with open(log, encoding="utf-8", errors="replace") as fh:
                t = fh.read().replace("\x00", "")
            hits = [d for k, d in BAD_LOG if k in t]
            if hits:
                issues.append("A4 日志: " + "; ".join(sorted(set(hits))[:3]))
        except Exception:
            pass

    # A6 证据说明
    has_ev = (os.path.exists(os.path.join(b, "commands.md"))
              or os.path.exists(os.path.join(b, "geo.json")))
    if not has_ev:
        (issues if strict else notes).append("A6 无 commands.md/geo.json")

    return {"n": n, "issues": issues, "notes": notes}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    ns = args or sorted(
        (d[1:] for d in os.listdir(REPLICA)
         if d.startswith("l") and os.path.isdir(os.path.join(REPLICA, d))),
        key=lambda x: int(x) if x.isdigit() else 9999)

    rows, nbad = [], 0
    for n in ns:
        if not n.isdigit():
            continue
        r = audit_one(n, strict)
        if r is None:
            continue
        if r["issues"]:
            nbad += 1
        rows.append(r)

    print(f"{'lesson':>6}  {'verdict':<8}  detail")
    print("-" * 78)
    for r in rows:
        v = "FAIL" if r["issues"] else "ok"
        detail = "; ".join(r["issues"]) if r["issues"] else " ".join(r["notes"])
        print(f"{r['n']:>6}  {v:<8}  {detail[:150]}")
    print("-" * 78)
    print(f"{len(rows)} 课已产出, {nbad} 课有问题")


if __name__ == "__main__":
    main()
