# -*- coding: utf-8 -*-
"""固定并发度的 probe 调度器: 保持 N 个 probe.py 同时跑, 已完成的课跳过。
用法: py -3.11 probe_pool.py <并发数> <课时...>
完成判据: lN/cv/cmdmont 非空。已在运行的课(命令行里出现 lN\\cv)不重复启动。
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.abspath(os.path.join(HERE, "..", ".."))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))
PY = sys.executable

conc = int(sys.argv[1])
todo = list(sys.argv[2:])


def done(n):
    d = os.path.join(HERE, f"l{n}", "cv", "cmdmont")
    return os.path.isdir(d) and len(os.listdir(d)) > 0


def running_elsewhere():
    """已有其它进程在跑的课时号(避免重复劳动)。"""
    out = set()
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
                            "Where-Object { $_.CommandLine -match 'probe.py' } | "
                            "ForEach-Object { $_.CommandLine }"],
                           capture_output=True, text=True, errors="replace", timeout=60)
        for line in r.stdout.splitlines():
            import re
            m = re.search(r"replica[\\/]l(\d+)[\\/]cv", line)
            if m:
                out.add(m.group(1))
    except Exception:
        pass
    return out


live = {}   # n -> Popen
while todo or live:
    for n, p in list(live.items()):
        if p.poll() is not None:
            print(f"[{time.strftime('%H:%M:%S')}] l{n} finished rc={p.returncode} "
                  f"mont={len(os.listdir(os.path.join(HERE, f'l{n}', 'cv', 'cmdmont'))) if done(n) else 0}",
                  flush=True)
            del live[n]
    busy = running_elsewhere()
    while todo and len(live) < conc:
        n = todo.pop(0)
        if done(n):
            print(f"[{time.strftime('%H:%M:%S')}] l{n} already done, skip", flush=True)
            continue
        if n in busy and n not in live:
            print(f"[{time.strftime('%H:%M:%S')}] l{n} already running elsewhere, defer", flush=True)
            todo.append(n)
            if all(x in busy or done(x) for x in todo):
                time.sleep(60)
            break
        out = os.path.join(HERE, f"l{n}", "cv")
        os.makedirs(out, exist_ok=True)
        p = subprocess.Popen([PY, os.path.join(PROTO, "cv", "probe.py"),
                              idx[n]["path"], out, "--no-slices"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        live[n] = p
        busy.add(n)
        print(f"[{time.strftime('%H:%M:%S')}] l{n} started pid={p.pid}", flush=True)
    time.sleep(20)
print("all done", flush=True)
