# -*- coding: utf-8 -*-
"""给 probe.py 增加 3D 视口光标检测(2D 十字线失败时的兜底)。"""
import io
import os
import re

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")
src = io.open(P, encoding="utf-8", errors="replace").read()

NEW_METHOD = '''
    def find_view3d_cursor(self, gray, last):
        """3D 视口没有全屏十字线, 只有一个小十字/方框光标。

        局部结构检测: 在右视口里找"短竖臂与短横臂相交"的点。
        只在 2D 十字线失败且存在 3D 视口时才跑, 不拖慢主路径。
        """
        vx = self.c.get("view3d_x")
        if not vx:
            return None
        cx0, cy0, cx1, cy1 = self.c["canvas"]
        x0 = max(int(vx), int(cx0))
        if cx1 - x0 < 40:
            return None
        roi = gray[cy0:cy1, x0:cx1]
        bw = (roi > 110).astype(np.uint8)
        if bw.sum() < 20:
            return None
        k = 11                                   # 光标臂长约 10~24px, 比图元短
        hor = cv2.dilate(cv2.erode(bw, np.ones((1, k), np.uint8)), np.ones((1, k), np.uint8))
        ver = cv2.dilate(cv2.erode(bw, np.ones((k, 1), np.uint8)), np.ones((k, 1), np.uint8))
        cross = (hor & ver).astype(np.uint8)
        if cross.sum() == 0:
            return None
        n, _, stats, cents = cv2.connectedComponentsWithStats(cross, 8)
        best, bestd = None, 1e18
        for i in range(1, n):
            _, _, w, h, area = stats[i]
            if area < 6 or w > 60 or h > 60:     # 排除大块实体填充
                continue
            px, py = cents[i][0] + x0, cents[i][1] + cy0
            d = (px - last[0]) ** 2 + (py - last[1]) ** 2
            if d < bestd:
                best, bestd = (int(px), int(py)), d
        if best and bestd <= CURSOR_JUMP_LIMIT ** 2:
            return best
        return None

    def key_zone_state(self, gray):'''

if "find_view3d_cursor" not in src:
    src = src.replace("\n    def key_zone_state(self, gray):", NEW_METHOD, 1)

# 在主扫描里接上: 十字线失败 -> 先试 3D 视口 -> 再回落到帧差分
OLD = """            mode = "none"
            if cross:
                last, mode = cross, "cross\""""
NEW = """            mode = "none"
            if cross:
                last, mode = cross, "cross"
            else:
                v3 = self.find_view3d_cursor(gray, last)
                if v3:
                    last, mode = v3, "view3d\""""
if 'mode = "view3d"' not in src:
    assert OLD in src, "主扫描锚点没找到"
    src = src.replace(OLD, NEW, 1)

io.open(P, "w", encoding="utf-8").write(src)
print("patched:", "find_view3d_cursor" in src, '| view3d mode:', 'mode = "view3d"' in src)
