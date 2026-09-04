# -*- coding: utf-8 -*-
"""è¯¾æ—¶13/14/15 å¡«å……ç³»åˆ—: è¾¹ç•Œ + å›¾æ¡ˆå¡«å…… / ç”¨æˆ·å®šä¹‰å¡«å…… / æ¸å˜å¡«å……ã€‚
å‘½ä»¤åºåˆ—å–è‡ªå„è¯¾ CV å‘½ä»¤æµ(HATCH æ‹¾å–å†…éƒ¨ç‚¹ / ç‰¹æ€§ P / ç”¨æˆ·å®šä¹‰ U / GRADIENT)ã€‚"""
import os

R = r"C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica"


def save(n, body):
    b = f"{R}/l{n}/l{n}".replace("\\", "/")
    out = ["FILEDIA 0", "OSMODE 0"] + body + [
        "_.ZOOM _E",
        f"_.SAVEAS 2018 {b}.dwg",
        f"_.DXFOUT {b}.dxf 16"]
    os.makedirs(f"{R}\\l{n}", exist_ok=True)
    open(f"{R}\\l{n}\\l{n}.scr", "w", encoding="ascii").write("\n".join(out) + "\n")
    print(f"l{n}: {len(out)} lines")


# ---- è¯¾æ—¶13 å›¾æ¡ˆå¡«å……åŸºæœ¬æ“ä½œ: åœ† / çŸ©å½¢ / æ­£äº”è¾¹å½¢ ä¸‰ç§è¾¹ç•Œ ----
b13 = []
b13 += ["_.CIRCLE 60,60 50"]
b13 += ["_.RECTANG 150,10 290,110"]
b13 += ["_.POLYGON 5 380,60 _I 50"]
b13 += ["_.ZOOM _W -60,-60 500,180"]
b13 += ["_.-HATCH _P ANSI31 1 0 60,60 "]
b13 += ["_.-HATCH _P AR-CONC 1 0 220,60 "]
b13 += ["_.-HATCH _P NET 4 0 380,60 "]
save(13, b13)

# ---- è¯¾æ—¶14 ç”¨æˆ·å®šä¹‰å¡«å……: è§’åº¦/é—´è·/åŒå‘ ä¸‰ç»„å¯¹ç…§ ----
b14 = []
b14 += ["_.RECTANG 0,0 140,100", "_.RECTANG 160,0 300,100", "_.RECTANG 320,0 460,100", "_.ZOOM _W -60,-60 520,160"]
for i, (ang, sp, dbl) in enumerate([(0, 8, "_N"), (45, 8, "_N"), (45, 8, "_Y")]):
    x = i * 160
    b14 += [f"_.-HATCH _P _U {ang} {sp} {dbl} {x + 70},50 "]
save(14, b14)

# ---- è¯¾æ—¶15 æ¸å˜å¡«å……: å•è‰² / åŒè‰² / ä¸åŒè§’åº¦ ----
b15 = []
b15 += ["_.RECTANG 0,0 140,100", "_.RECTANG 160,0 300,100", "_.RECTANG 320,0 460,100", "_.ZOOM _W -60,-60 520,160"]
b15 += ["_.-GRADIENT _P _ONECOLOR 5 _CE 0 150 _S 70,50 "]
b15 += ["_.-GRADIENT _P _TWOCOLOR 5 3 _CE 0 _S 230,50 "]
b15 += ["_.-GRADIENT _P _TWOCOLOR 1 2 _AN 45 _S 390,50 "]
save(15, b15)


