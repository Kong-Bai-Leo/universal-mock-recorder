# -*- coding: utf-8 -*-
"""课时127 = 课时126 的连体构件 + 课时127 命令流里的 EXTRUDE 200 底板。

注:无头下该模型的最终 UNION 与 ZOOM _E 都会挂死(实体规模过大),
底板保留为独立实体,已在 MANIFEST 标注。
"""
R = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica"
OUT = "C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l127/l127"

body = []
for line in open(R + r"\l126\l126.scr", encoding="ascii").read().splitlines():
    if line.startswith(("_.SAVEAS", "_.DXFOUT")) or line.strip() == "_.ZOOM _E":
        continue
    # 连续空行 = 连续回车 = 重入上一条命令, 合并成一个
    if not line.strip() and body and not body[-1].strip():
        continue
    body.append(line)
# 课时127 追加的底板(命令行确认 EXTRUDE 200 -> 等价 BOX)
body.append("_.BOX -60,-120,-200 460,120,0")
# 尾部空行会重入上一条命令 -> 清掉
while body and not body[-1].strip():
    body.pop()
body += [f"_.SAVEAS 2018 {OUT}.dwg", f"_.DXFOUT {OUT}.dxf 16"]
open(R + r"\l127\l127.scr", "w", encoding="ascii").write("\n".join(body) + "\n")
print("l127.scr:", len(body), "lines")
