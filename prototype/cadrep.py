# -*- coding: utf-8 -*-
"""cadrep —— 录屏视频 → CAD 复刻 的阶段化流水线 CLI。

视频在持续增加, 所以这个工具是**增量、可续跑**的:每个阶段有明确的产物,
产物在就跳过, 不在就跑。任何时候 `status` 都能看到每课卡在哪一阶段。

阶段:
    S0 discover  扫描视频目录 -> 课时清单(编号/标题/路径/大小)
    S1 probe     CV 全片探测  -> cv/{manifest,trajectory,episodes,actions,input_events}.json
                                 cv/cmdstrips/, cv/cmdmont/, [cv/slices/, cv/index.html]
    S2 read      读命令流     -> commands.md          (agent 人工;CV 只备料)
    S3 measure   终态几何测量 -> geo.json + geo_overlay.png
    S4 build     生成回放脚本 -> lN.scr
    S5 replay    AutoCAD 回放 -> lN.dwg + lN.dxf + log.txt
    S6 verify    校验         -> verify.json

用法:
    py -3.11 cadrep.py status                      # 全部课时的阶段进度表
    py -3.11 cadrep.py discover                    # 刷新课时清单(视频有新增时跑)
    py -3.11 cadrep.py doctor --all                # CV 质量门禁: 哪些课证据不足
    py -3.11 cadrep.py probe 16 17 18              # 对指定课时跑 S1
    py -3.11 cadrep.py probe --todo --limit 4      # 对还没跑过 S1 的前 4 课
    py -3.11 cadrep.py measure 16 --t 800          # S3
    py -3.11 cadrep.py build 16                    # S4(仅测量转脚本这一类)
    py -3.11 cadrep.py replay 16                   # S5+S6
    py -3.11 cadrep.py verify --all                # 重新校验全部成品

注意: 本文件含中文, **不要用 PowerShell 的 Get-Content/Set-Content 改写**
      (PS 5.1 会按系统代码页读 UTF-8, 造成不可逆的 mojibake)。用 Python 或编辑器。
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CV = os.path.join(HERE, "cv")
REPLICA = os.path.join(HERE, "out", "replica")
INDEX = os.path.join(REPLICA, "_index.json")
PY = [sys.executable] if sys.executable else ["py", "-3.11"]

VIDEO_ROOT = r"D:\Black Myth"
# 只扫描名字里含这些关键词的子目录。
#
# 为什么要过滤: VIDEO_ROOT 下混着大量《黑神话:悟空》游戏直播录屏(105 个,
# 且仍在下载)。已抽帧实证: 画面是游戏场景 + HUD + 主播摄像头, **没有任何
# AutoCAD 界面** —— 没有命令行、没有控件、没有可复刻的图纸, 本管线对它们
# 无从下手(CV 层的命令行条带、按键覆盖层、十字光标三个信号全部不存在)。
# 抽样证据: out/_scope_check/scope.png
#
# 新增别的软件教程目录时, 往这里加关键词即可; 若该软件界面布局不同,
# cv/layout.py 会自动检测分区, 不必手工标定。
VIDEO_DIR_KEYWORDS = ["CAD"]
VIDEO_EXT = {".mp4", ".mkv", ".flv", ".avi", ".ts", ".webm"}

STAGES = ["S1 probe", "S2 read", "S3 measure", "S4 build", "S5 replay", "S6 verify"]


def video_dirs():
    out = []
    if not os.path.isdir(VIDEO_ROOT):
        return out
    for name in os.listdir(VIDEO_ROOT):
        p = os.path.join(VIDEO_ROOT, name)
        if os.path.isdir(p) and any(k in name for k in VIDEO_DIR_KEYWORDS):
            out.append(p)
    return out


# ---------------------------------------------------------------- S0 discover
def discover(save=True):
    """扫描视频目录, 解析课时号与标题。忽略未下载完的临时文件。"""
    items = {}
    for d in video_dirs():
        for name in os.listdir(d):
            path = os.path.join(d, name)
            if not os.path.isfile(path):
                continue
            stem, ext = os.path.splitext(name)
            if ext.lower() not in VIDEO_EXT:
                continue
            if os.path.exists(path + ".aria2"):      # 还在下载, 读会截断
                continue
            m = re.match(r"^(\d+)-(.*?)(?:-\d+P.*)?$", stem)
            if not m:
                continue                              # 无编号(通常是下载中的哈希名)
            n = m.group(1)
            items[n] = {"n": n, "title": m.group(2), "path": path,
                        "size_mb": round(os.path.getsize(path) / 1048576, 1)}
    out = dict(sorted(items.items(), key=lambda kv: int(kv[0])))
    if save:
        os.makedirs(REPLICA, exist_ok=True)
        with open(INDEX, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
    return out


def load_index():
    if os.path.exists(INDEX):
        with open(INDEX, encoding="utf-8") as fh:
            return json.load(fh)
    return discover()


# ---------------------------------------------------------------- 阶段状态
def lesson_dir(n):
    return os.path.join(REPLICA, f"l{n}")


def stage_state(n):
    b = lesson_dir(n)
    mont = os.path.join(b, "cv", "cmdmont")
    return {
        "S1 probe": os.path.isdir(mont) and len(os.listdir(mont)) > 0,
        "S2 read": os.path.exists(os.path.join(b, "commands.md")),
        "S3 measure": os.path.exists(os.path.join(b, "geo.json")),
        "S4 build": os.path.exists(os.path.join(b, f"l{n}.scr")),
        "S5 replay": os.path.exists(os.path.join(b, f"l{n}.dwg")),
        "S6 verify": os.path.exists(os.path.join(b, "verify.json")),
    }


def status():
    idx = load_index()
    hdr = "lesson  " + "  ".join(s.split()[0] for s in STAGES) + "   title"
    print(hdr)
    print("-" * len(hdr))
    done = {s: 0 for s in STAGES}
    for n, it in idx.items():
        st = stage_state(n)
        for s in STAGES:
            done[s] += 1 if st[s] else 0
        marks = "  ".join((" ok" if st[s] else " . ") for s in STAGES)
        print(f"{n:>6}  {marks}   {it['title']}")
    print("-" * len(hdr))
    total = len(idx)
    print("total " + "  ".join(f"{s.split()[0]}={done[s]}/{total}" for s in STAGES))


# ---------------------------------------------------------------- 各阶段执行
def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def probe(ns, no_slices=True):
    idx = load_index()
    for n in ns:
        it = idx.get(n)
        if not it:
            print(f"l{n}: not in index (run discover first)")
            continue
        out = os.path.join(lesson_dir(n), "cv")
        os.makedirs(out, exist_ok=True)
        cmd = PY + [os.path.join(CV, "probe.py"), it["path"], out]
        if no_slices:
            cmd.append("--no-slices")
        r = _run(cmd)
        print(f"l{n}: {(r.stdout or r.stderr).strip()[:200]}")


def measure(ns, t, roi, color, extra):
    idx = load_index()
    for n in ns:
        it = idx.get(n)
        if not it:
            continue
        b = lesson_dir(n)
        os.makedirs(b, exist_ok=True)
        cmd = PY + [os.path.join(CV, "measure.py"), it["path"], str(t),
                    os.path.join(b, "geo"), "--color", color]
        if roi:
            cmd += ["--roi", roi]
        cmd += extra
        r = _run(cmd)
        print(f"l{n}: {(r.stdout or r.stderr).strip()[:200]}")


def build(ns, flipy):
    for n in ns:
        b = lesson_dir(n)
        src = os.path.join(b, "geo.json")
        if not os.path.exists(src):
            print(f"l{n}: no geo.json (run measure, or hand-write the .scr)")
            continue
        cmd = PY + [os.path.join(CV, "to_scr.py"), src,
                    os.path.join(b, f"l{n}.scr"), os.path.join(b, f"l{n}"),
                    "--flipy", str(flipy)]
        r = _run(cmd)
        print(f"l{n}: {(r.stdout or r.stderr).strip()[:200]}")


def replay(ns, timeout):
    for n in ns:
        r = _run(["powershell", "-NoProfile", "-File",
                  os.path.join(HERE, "run_lesson.ps1"), n, str(timeout)])
        head = (r.stdout or r.stderr).strip().splitlines()
        print(f"l{n}: " + (" | ".join(head[:2]) if head else "(no output)"))
        verify([n], quiet=True)


def verify(ns, quiet=False):
    for n in ns:
        b = lesson_dir(n)
        dxf = os.path.join(b, f"l{n}.dxf")
        if not os.path.exists(dxf):
            if not quiet:
                print(f"l{n}: no dxf")
            continue
        r = _run(PY + [os.path.join(HERE, "verify.py"), dxf, "--json"])
        try:
            data = json.loads(r.stdout)
        except Exception:
            if not quiet:
                print(f"l{n}: verify failed {(r.stderr or '')[:120]}")
            continue
        with open(os.path.join(b, "verify.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        counts = ", ".join(f"{k}x{v}" for k, v in
                           sorted(data.get("counts", {}).items(), key=lambda x: -x[1]))
        print(f"l{n}: {counts or '(empty)'}")


# ---------------------------------------------------------------- watch
def watch(interval=180, auto_probe=True, once=False):
    """盯着视频目录, 新视频一到齐就自动接住并跑 S1。

    视频是持续下载的, 这个命令让流水线自己接活:
      * 每 interval 秒重扫一次目录;
      * `.aria2` 伴随文件还在 = 没下完 -> 跳过, 下一轮再看;
      * 新出现的已编号课时立即跑 S1(CV 全片探测), 跑完打印一行提示;
      * S2 起需要人/agent 介入, 这里只备料并列出待办。
    """
    import time

    known = set(load_index())
    print(f"[watch] 起始 {len(known)} 课; 每 {interval}s 重扫一次。Ctrl+C 停止。")
    while True:
        pending = [f for d in video_dirs() for f in os.listdir(d)
                   if f.endswith(".aria2")]
        idx = discover()
        new = [n for n in idx if n not in known]
        if new:
            print(f"[watch] 新到 {len(new)} 课: {', '.join(sorted(new, key=int))}")
            if auto_probe:
                probe(new)
            known |= set(new)
            todo = [n for n in idx if not stage_state(n)["S5 replay"]]
            print(f"[watch] 待建模 {len(todo)} 课: {', '.join(sorted(todo, key=int))}")
        else:
            done = sum(1 for n in idx if stage_state(n)["S5 replay"])
            extra = f"; {len(pending)} 个下载进行中" if pending else ""
            print(f"[watch] 无新课({len(idx)} 课, 已出成品 {done}){extra}")
        if once:
            return
        time.sleep(interval)


# ---------------------------------------------------------------- doctor
# CV 质量门禁: 光标信号率低 / 没检到按键覆盖层 / 没有命令行条带,
# 都意味着下游 agent 拿不到足够证据, 需要人工介入换参数或换素材。
GATES = {
    "cursor_rate": 0.70,      # 光标直接命中率下限
    "min_inputs": 5,          # 输入事件数下限(为 0 说明没有按键可视化覆盖层)
    "min_montages": 1,        # 命令行蒙太奇数下限
}


def doctor(ns):
    rows, bad = [], 0
    for n in ns:
        mf = os.path.join(lesson_dir(n), "cv", "manifest.json")
        if not os.path.exists(mf):
            rows.append((n, "-", "-", "-", "-", "S1 not run"))
            continue
        try:
            with open(mf, encoding="utf-8") as fh:
                m = json.load(fh)
        except Exception as e:
            rows.append((n, "-", "-", "-", "-", f"manifest broken: {e}"))
            bad += 1
            continue
        modes = m.get("cursorModes", {})
        scanned = max(1, m.get("scanned", 1))
        # 光标"合法缺席"的帧(模态对话框 / 就地编辑器接管画布)不该计入分母 ——
        # 那些时刻 AutoCAD 本来就不显示全屏十字线, 找不到是正确行为。
        absent_ok = m.get("cursorAbsentOkFrames", 0)
        denom = max(1, scanned - absent_ok)
        lost = max(0, modes.get("none", 0) - absent_ok)
        hit = (denom - lost) / denom
        inputs = m.get("inputEvents", 0)
        monts = m.get("cmdMontages", 0)
        layout = m.get("layout", "?")

        flags = []
        if hit < GATES["cursor_rate"]:
            flags.append(f"LOW cursor signal {hit:.0%}")
        if inputs < GATES["min_inputs"]:
            flags.append(f"only {inputs} input events (key overlay missing?)")
        if monts < GATES["min_montages"]:
            flags.append("no command strips")
        if layout.startswith("detected:"):
            flags.append("auto-detected layout, review it")
        if absent_ok > 0.30 * scanned:
            flags.append(f"dialog/editor {absent_ok / scanned:.0%} of frames")
        if flags:
            bad += 1
        rows.append((n, f"{hit:.0%}", str(inputs), str(monts), layout,
                     "; ".join(flags) or "OK"))

    w = max([len(r[4]) for r in rows] + [8])
    print(f"{'lesson':>6}  {'curs':>5}  {'inp':>5}  {'mont':>5}  {'layout':<{w}}  diagnosis")
    for r in rows:
        print(f"{r[0]:>6}  {r[1]:>5}  {r[2]:>5}  {r[3]:>5}  {r[4]:<{w}}  {r[5]}")
    print(f"\n{bad} of {len(rows)} lessons flagged")


# ---------------------------------------------------------------- CLI
def pick(args, stage_key=None):
    idx = load_index()
    if getattr(args, "all", False):
        return list(idx)
    if getattr(args, "todo", False) and stage_key:
        todo = [n for n in idx if not stage_state(n)[stage_key]]
        return todo[: args.limit] if args.limit else todo
    return args.lessons


def main():
    ap = argparse.ArgumentParser(prog="cadrep")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("lessons", nargs="*")
        p.add_argument("--all", action="store_true")
        p.add_argument("--todo", action="store_true", help="only lessons missing this stage")
        p.add_argument("--limit", type=int, default=0)

    sub.add_parser("status")
    sub.add_parser("discover")
    p = sub.add_parser("probe"); common(p); p.add_argument("--slices", action="store_true")
    p = sub.add_parser("measure"); common(p)
    p.add_argument("--t", type=float, required=True)
    p.add_argument("--roi", default="185,140,1200,590")
    p.add_argument("--color", default="white")
    p.add_argument("--extra", nargs=argparse.REMAINDER, default=[])
    p = sub.add_parser("build"); common(p); p.add_argument("--flipy", type=float, default=597)
    p = sub.add_parser("replay"); common(p); p.add_argument("--timeout", type=int, default=420)
    p = sub.add_parser("verify"); common(p)
    p = sub.add_parser("doctor"); common(p)
    p = sub.add_parser("watch")
    p.add_argument("--interval", type=int, default=180, help="重扫间隔(秒)")
    p.add_argument("--once", action="store_true", help="只扫一次就退出")
    p.add_argument("--no-probe", action="store_true", help="只报告新课, 不自动跑 S1")

    a = ap.parse_args()
    if a.cmd == "status":
        return status()
    if a.cmd == "discover":
        idx = discover()
        print(f"found {len(idx)} numbered lessons: {', '.join(idx)}")
        return
    if a.cmd == "probe":
        return probe(pick(a, "S1 probe"), no_slices=not a.slices)
    if a.cmd == "measure":
        return measure(pick(a, "S3 measure"), a.t, a.roi, a.color, a.extra)
    if a.cmd == "build":
        return build(pick(a, "S4 build"), a.flipy)
    if a.cmd == "replay":
        return replay(pick(a, "S5 replay"), a.timeout)
    if a.cmd == "verify":
        return verify(pick(a, "S6 verify"))
    if a.cmd == "doctor":
        return doctor(pick(a) or list(load_index()))
    if a.cmd == "watch":
        return watch(a.interval, auto_probe=not a.no_probe, once=a.once)


if __name__ == "__main__":
    main()
