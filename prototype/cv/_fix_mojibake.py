# -*- coding: utf-8 -*-
"""修复被 PowerShell 读写循环双重编码的源文件。

PS 5.1 的 Get-Content 用 ANSI 读 UTF-8 文件 -> 得到 mojibake,
再以 UTF-8 写回 -> 文件被双重编码。逆操作: utf-8 读 -> latin-1 编 -> utf-8 解。
"""
import io
import sys


def fix(path):
    s = io.open(path, encoding="utf-8", errors="strict").read()
    # PS 5.1 用系统代码页(中文环境常是 cp1252/gbk 的解释)读 UTF-8 -> mojibake
    for codec in ("cp1252", "latin-1"):
        try:
            rec = s.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if rec == s:
            continue
        io.open(path, "w", encoding="utf-8", newline="\n").write(rec)
        print(f"{path}: 已修复(via {codec})")
        return True
    print(f"{path}: 无需修复")
    return False


if __name__ == "__main__":
    for p in sys.argv[1:]:
        fix(p)
