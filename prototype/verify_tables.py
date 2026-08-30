# -*- coding: utf-8 -*-
"""样板类课时的验证器: 从 DXF 读回符号表(文字样式/标注样式/图层/线型/布局/视口)。

verify.py 只看 ENTITIES; 73-84 这类"样板 + 布局 + 打印"课的成果在 TABLES/OBJECTS 里,
所以单独回读, 作为 R5 的独立证据。

用法: py -3.11 verify_tables.py <file.dxf>
"""
import re
import sys
from collections import OrderedDict

# 需要回读的 DIM 变量(组码 -> 变量名), 见 DXF DIMSTYLE 表定义
DIMCODES = {
    3: "DIMPOST", 40: "DIMSCALE", 41: "DIMASZ", 42: "DIMEXO", 43: "DIMDLI",
    44: "DIMEXE", 45: "DIMRND", 46: "DIMDLE", 47: "DIMTP", 48: "DIMTM",
    140: "DIMTXT", 141: "DIMCEN", 142: "DIMTSZ", 143: "DIMALTF", 144: "DIMLFAC",
    147: "DIMGAP", 148: "DIMALTRND", 71: "DIMTOL", 72: "DIMLIM", 73: "DIMTIH",
    74: "DIMTOH", 75: "DIMSE1", 76: "DIMSE2", 77: "DIMTAD", 78: "DIMZIN",
    170: "DIMALT", 171: "DIMALTD", 172: "DIMTOFL", 173: "DIMSAH", 174: "DIMTIX",
    175: "DIMSOXD", 176: "DIMCLRD", 177: "DIMCLRE", 178: "DIMCLRT", 179: "DIMADEC",
    271: "DIMDEC", 272: "DIMTDEC", 273: "DIMALTU", 274: "DIMALTTD", 275: "DIMAUNIT",
    276: "DIMFRAC", 277: "DIMLUNIT", 278: "DIMDSEP", 279: "DIMTMOVE",
    280: "DIMJUST", 281: "DIMSD1", 282: "DIMSD2", 283: "DIMTOLJ", 284: "DIMTZIN",
    285: "DIMALTZ", 286: "DIMALTTZ", 289: "DIMATFIT", 340: "DIMTXSTY_h",
    341: "DIMLDRBLK_h", 342: "DIMBLK_h", 343: "DIMBLK1_h", 344: "DIMBLK2_h",
    371: "DIMLWD", 372: "DIMLWE",
}
STYLECODES = {2: "name", 40: "height", 41: "width", 50: "oblique",
              70: "flags", 42: "lastheight", 3: "font", 4: "bigfont"}
LAYERCODES = {2: "name", 62: "color", 6: "linetype", 370: "lineweight"}


def pairs(txt):
    ls = txt.split("\n")
    out = []
    for i in range(0, len(ls) - 1, 2):
        c = ls[i].strip()
        if c.lstrip("-").isdigit():
            out.append((int(c), ls[i + 1].strip()))
    return out


def records(txt, kind):
    """返回 TABLES 段里所有 kind 类型记录的 [(code,value)...] 列表。"""
    sec = txt.split("\nTABLES\n", 1)
    if len(sec) < 2:
        return []
    sec = sec[1].split("\nBLOCKS\n", 1)[0]
    recs, cur = [], None
    for c, v in pairs(sec):
        if c == 0:
            if cur is not None:
                recs.append(cur)
            cur = [] if v == kind else None
            continue
        if cur is not None:
            cur.append((c, v))
    if cur:
        recs.append(cur)
    return recs


def layouts(txt):
    """OBJECTS 段里的 LAYOUT 对象: 名称 + 打印配置(设备/纸张/打印区域/比例)。"""
    sec = txt.split("\nOBJECTS\n", 1)
    if len(sec) < 2:
        return []
    sec = sec[1]
    out, cur = [], None
    for c, v in pairs(sec):
        if c == 0:
            if cur:
                out.append(cur)
            cur = {} if v == "LAYOUT" else None
            continue
        if cur is None:
            continue
        if c == 1:
            # AcDbPlotSettings 的 1 是页面设置名, AcDbLayout 的 1 是布局名(后出现)
            cur["pagesetup"] = cur.get("pagesetup", v)
            cur["name"] = v
        elif c == 2 and "device" not in cur:
            cur["device"] = v
        elif c == 4 and "canonical" not in cur:
            cur["canonical"] = v
        elif c == 7 and "ctb" not in cur:
            cur["ctb"] = v
        elif c == 40 and "margins" not in cur:
            cur["margins"] = v
        elif c == 44 and "psize" not in cur:
            cur["psize_w"] = v
        elif c == 45 and "psize_h" not in cur:
            cur["psize_h"] = v
        elif c == 142 and "num" not in cur:
            cur["num"] = v
        elif c == 143 and "den" not in cur:
            cur["den"] = v
        elif c == 73 and "plottype" not in cur:
            cur["plottype"] = v
        elif c == 75 and "stdscale" not in cur:
            cur["stdscale"] = v
    if cur:
        out.append(cur)
    return [o for o in out if o.get("name")]


def viewports(txt):
    """ENTITIES 段的 VIEWPORT 实体: 纸空间尺寸 + 视图高度 -> 比例。"""
    if "\nENTITIES\n" not in txt:
        return []
    sec = txt.split("\nENTITIES\n", 1)[1].split("\nENDSEC", 1)[0]
    out, cur = [], None
    for c, v in pairs(sec):
        if c == 0:
            if cur:
                out.append(cur)
            cur = {} if v == "VIEWPORT" else None
            continue
        if cur is None:
            continue
        if c in (10, 20, 40, 41, 45, 68, 69) and c not in cur:
            cur[c] = v
    if cur:
        out.append(cur)
    res = []
    for v in out:
        try:
            h, vh = float(v.get(41, 0)), float(v.get(45, 0))
            sc = (h / vh) if vh else 0
        except ValueError:
            sc = 0
        res.append({"center": [v.get(10), v.get(20)], "w": v.get(40), "h": v.get(41),
                    "viewheight": v.get(45), "scale": round(sc, 6),
                    "1/x": (round(1 / sc, 3) if sc else None), "id": v.get(69)})
    return res


def main():
    txt = open(sys.argv[1], encoding="utf-8", errors="ignore").read()

    print("== TEXT STYLES ==")
    for r in records(txt, "STYLE"):
        d = OrderedDict()
        for c, v in r:
            if c in STYLECODES:
                d[STYLECODES[c]] = v
        if d.get("name"):
            print("  " + ", ".join(f"{k}={v}" for k, v in d.items()))

    print("== DIMSTYLES ==")
    for r in records(txt, "DIMSTYLE"):
        d = OrderedDict()
        for c, v in r:
            if c == 2:
                d["name"] = v
            elif c in DIMCODES:
                d.setdefault(DIMCODES[c], v)
        if d.get("name"):
            print("  " + ", ".join(f"{k}={v}" for k, v in d.items()))

    print("== LAYERS ==")
    for r in records(txt, "LAYER"):
        d = OrderedDict()
        for c, v in r:
            if c in LAYERCODES:
                d.setdefault(LAYERCODES[c], v)
        if d.get("name"):
            print("  " + ", ".join(f"{k}={v}" for k, v in d.items()))

    print("== LINETYPES ==")
    names = [v for r in records(txt, "LTYPE") for c, v in r if c == 2]
    print("  " + ", ".join(names))

    print("== LAYOUTS ==")
    for lo in layouts(txt):
        print("  " + ", ".join(f"{k}={v}" for k, v in lo.items()))

    print("== VIEWPORTS (paperspace) ==")
    for v in viewports(txt):
        print(f"  {v}")


main()
