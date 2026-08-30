# -*- coding: utf-8 -*-
"""清理源文件编码:去 BOM + 逐行修复 cp1252/latin-1 双重编码的乱码注释。

成因: PowerShell 5.1 的 Get-Content 按系统代码页读 UTF-8 文件, Set-Content 再写回,
      中文注释被双重编码。代码本身是 ASCII 所以照常运行, 但注释不可读。
修完后请只用 Python 或编辑器改这些文件。
"""
import ast
import io
import os
import sys


def repair_line(line):
    if all(ord(ch) < 128 for ch in line):
        return line
    for codec in ("cp1252", "latin-1"):
        try:
            fixed = line.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if fixed != line:
            return fixed
    return line


def clean(path, rounds=3):
    raw = io.open(path, "rb").read()
    text = raw.decode("utf-8-sig")            # 去 BOM
    total = 0
    for _ in range(rounds):                   # 可能被编码了不止一次
        lines = text.split("\n")
        fixed = [repair_line(l) for l in lines]
        n = sum(1 for a, b in zip(lines, fixed) if a != b)
        total += n
        text = "\n".join(fixed)
        if n == 0:
            break
    io.open(path, "w", encoding="utf-8", newline="\n").write(text)
    ok = True
    if path.endswith(".py"):
        try:
            ast.parse(text)
        except SyntaxError as e:
            ok = False
            print(f"  !! 语法错误: {e}")
    print(f"{os.path.basename(path)}: 修复 {total} 行, 语法 {'OK' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    for p in sys.argv[1:]:
        clean(p)
