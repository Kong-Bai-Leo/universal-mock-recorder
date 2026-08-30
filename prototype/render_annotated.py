# -*- coding: utf-8 -*-
"""把 cv_probe 的检测结果叠加渲染到原视频上,输出标注版 mp4 供人工检查。

用法: py -3.11 render_annotated.py <src.mp4> <probe_out_dir> <out.mp4> [start_s] [end_s]
"""
import json
import os
import sys

import cv2
import numpy as np

W, H = 1280, 720
KEY_ZONE = (1060, 585, 1255, 672)
TRAIL_FRAMES = 40          # 轨迹尾巴长度(帧)
INPUT_FLASH_S = 1.0        # 输入事件提示持续时间

MODE_COLOR = {"cross": (80, 220, 80), "diff": (0, 165, 255), "none": (140, 140, 140)}
TYPE_COLOR = {
    "click_like": (60, 60, 230),
    "click_or_key_at_pause": (200, 60, 200),
    "interactive_draw": (230, 200, 40),
    "move_with_preview": (60, 200, 230),
    "cmdline_echo": (230, 130, 40),
    "input_triggered_change": (180, 60, 120),
    "unattributed_change": (120, 120, 120),
    "scene_cut": (60, 60, 60),
}


def load(out_dir, name):
    with open(os.path.join(out_dir, name + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    src, probe_dir, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    start_s = float(sys.argv[4]) if len(sys.argv) > 4 else 0
    end_s = float(sys.argv[5]) if len(sys.argv) > 5 else 0

    traj = load(probe_dir, "trajectory")
    actions = load(probe_dir, "actions")
    inputs = load(probe_dir, "input_events")
    by_frame = {p["f"]: p for p in traj}
    t_total = traj[-1]["t"] if traj else 1

    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    f0 = int(start_s * fps)
    f1 = min(total, int(end_s * fps)) if end_s else total
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0)

    writer = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

    # 时间轴条预渲染(整片动作分布)
    bar = np.full((10, W, 3), 30, np.uint8)
    for a in actions:
        x0 = int(a["t0"] / t_total * W)
        x1 = max(x0 + 1, int(a["t1"] / t_total * W))
        bar[:, x0:x1] = TYPE_COLOR.get(a["type"], (255, 255, 255))

    kx0, ky0, kx1, ky1 = KEY_ZONE
    fi = f0
    while fi < f1:
        ok, frame = cap.read()
        if not ok:
            break
        t = fi / fps

        # 轨迹尾巴
        pts = [by_frame[f] for f in range(max(0, fi - TRAIL_FRAMES), fi + 1) if f in by_frame]
        for i in range(1, len(pts)):
            alpha = i / len(pts)
            col = MODE_COLOR.get(pts[i]["mode"], (200, 200, 200))
            col = tuple(int(c * (0.35 + 0.65 * alpha)) for c in col)
            cv2.line(frame, (pts[i - 1]["sx"], pts[i - 1]["sy"]), (pts[i]["sx"], pts[i]["sy"]), col, 2)
        if pts:
            p = pts[-1]
            cv2.circle(frame, (p["sx"], p["sy"]), 10, MODE_COLOR.get(p["mode"]), 2)

        # 当前动作
        y_label = 26
        for a in actions:
            if a["t0"] - 0.1 <= t <= a["t1"] + 0.4 and a["type"] != "scene_cut":
                col = TYPE_COLOR.get(a["type"], (255, 255, 255))
                if a.get("bbox"):
                    x0, y0, x1, y1 = a["bbox"]
                    if (x1 - x0) * (y1 - y0) < 0.5 * W * H:  # 全屏级包围盒没有信息量
                        cv2.rectangle(frame, (x0, y0), (x1, y1), col, 2)
                txt = f'{a["id"]} {a["type"]}  path={a.get("cursorPathPx", 0):.0f}px'
                cv2.rectangle(frame, (6, y_label - 16), (12 + 8 * len(txt), y_label + 6), (20, 20, 20), -1)
                cv2.putText(frame, txt, (10, y_label), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 1, cv2.LINE_AA)
                y_label += 26

        # 输入事件提示
        for k in inputs:
            if k["t0"] <= t <= k["t0"] + INPUT_FLASH_S:
                cv2.rectangle(frame, (kx0 - 3, ky0 - 3), (kx1 + 3, ky1 + 3), (0, 200, 255), 2)
                cv2.putText(frame, f'INPUT {k["id"]}', (kx0 - 3, ky0 - 12),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 255), 1, cv2.LINE_AA)
                cx, cy = k["cursorAt"]
                cv2.drawMarker(frame, (cx, cy), (0, 200, 255), cv2.MARKER_TILTED_CROSS, 22, 2)

        # 时间轴 + 播放头 + 时间码
        frame[H - 10:H, :] = bar
        px = int(t / t_total * W)
        frame[H - 14:H, max(0, px - 1):px + 2] = (255, 255, 255)
        cv2.putText(frame, f"t={t:7.2f}s", (W - 150, H - 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        writer.write(frame)
        fi += 1

    cap.release()
    writer.release()
    print(f"written: {dst} ({f1 - f0} frames)")


if __name__ == "__main__":
    main()
