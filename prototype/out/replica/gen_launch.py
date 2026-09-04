# -*- coding: utf-8 -*-
"""生成 _launch.ps1: 用 Start-Process 分离启动 probe.py, 使其不随本会话的任务树被杀。
用法: py -3.11 gen_launch.py 86 87 88 ...
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROTO = os.path.abspath(os.path.join(HERE, "..", ".."))
idx = json.load(open(os.path.join(HERE, "_index.json"), encoding="utf-8"))
PYEXE = sys.executable
probe = os.path.join(PROTO, "cv", "probe.py")

lines = []
for n in sys.argv[1:]:
    out = os.path.join(HERE, "l" + n, "cv")
    os.makedirs(out, exist_ok=True)
    args = '@("{}","{}","{}","--no-slices")'.format(
        probe.replace("\\", "\\\\"), idx[n]["path"].replace("\\", "\\\\"), out.replace("\\", "\\\\"))
    lines.append('Start-Process -FilePath "{}" -ArgumentList {} -WindowStyle Hidden'
                 .format(PYEXE.replace("\\", "\\\\"), args))

p = os.path.join(HERE, "_launch.ps1")
with open(p, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
print(p)
print("\n".join(lines))
