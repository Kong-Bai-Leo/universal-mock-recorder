"""Infer canvas bounds and screenshot-to-screenshot viewport changes.

This is a proof of concept for the existing screenshot + events.jsonl recorder
pipeline. It does not use application-specific APIs or class-name allowlists.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


POINTER_EVENTS = {"mouse_move", "mouse_down", "mouse_up", "mouse_wheel"}
CANVAS_ROLES = {"ControlType.Pane", "ControlType.Document", "ControlType.Custom"}


@dataclass
class Rect:
    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return max(0, self.width) * max(0, self.height)

    def clipped(self, width: int, height: int) -> "Rect":
        left = max(0, self.x)
        top = max(0, self.y)
        right = min(width, self.x + self.width)
        bottom = min(height, self.y + self.height)
        return Rect(left, top, max(0, right - left), max(0, bottom - top))

    def as_list(self) -> list[int]:
        return [self.x, self.y, self.width, self.height]


def intersection_over_union(left: Rect, right: Rect) -> float:
    x1 = max(left.x, right.x)
    y1 = max(left.y, right.y)
    x2 = min(left.x + left.width, right.x + right.width)
    y2 = min(left.y + left.height, right.y + right.height)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = left.area + right.area - intersection
    return intersection / union if union else 0.0


def median_rect(rects: list[Rect]) -> Rect:
    values = np.array([rect.as_list() for rect in rects], dtype=np.float64)
    x, y, width, height = np.median(values, axis=0)
    return Rect(round(x), round(y), round(width), round(height))


def load_events(recording: Path) -> list[dict]:
    with (recording / "events.jsonl").open("r", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def infer_canvas_candidates(events: list[dict]) -> tuple[Rect | None, float, list[dict]]:
    clusters: list[dict] = []

    for event in events:
        if event.get("eventType") not in POINTER_EVENTS:
            continue
        target = event.get("target") or {}
        window = event.get("window") or {}
        if target.get("role") not in CANVAS_ROLES:
            continue
        try:
            candidate = Rect(
                int(target["x"]),
                int(target["y"]),
                int(target["width"]),
                int(target["height"]),
            )
            window_area = max(1, int(window["width"]) * int(window["height"]))
        except (KeyError, TypeError, ValueError):
            continue

        area_ratio = candidate.area / window_area
        if area_ratio < 0.22 or area_ratio > 0.96:
            continue
        x = event.get("x")
        y = event.get("y")
        if x is None or y is None:
            continue
        if not (candidate.x <= x < candidate.x + candidate.width and candidate.y <= y < candidate.y + candidate.height):
            continue

        event_weight = 0.08 if event["eventType"] == "mouse_move" else 1.0
        matching = next(
            (cluster for cluster in clusters if intersection_over_union(cluster["rect"], candidate) >= 0.90),
            None,
        )
        if matching is None:
            matching = {"rect": candidate, "rects": [], "weight": 0.0, "events": 0}
            clusters.append(matching)
        matching["rects"].append(candidate)
        matching["rect"] = median_rect(matching["rects"])
        matching["weight"] += event_weight
        matching["events"] += 1

    if not clusters:
        return None, 0.0, []

    clusters.sort(key=lambda item: (item["weight"], item["rect"].area), reverse=True)
    winner = clusters[0]
    total_weight = sum(item["weight"] for item in clusters)
    support = winner["weight"] / max(total_weight, 1e-6)
    stability = np.mean([
        intersection_over_union(winner["rect"], rect) for rect in winner["rects"]
    ])
    confidence = float(min(0.99, 0.55 * support + 0.45 * stability))

    serialized = [
        {
            "rect": item["rect"].as_list(),
            "weightedSupport": round(item["weight"], 3),
            "eventCount": item["events"],
        }
        for item in clusters[:5]
    ]
    return winner["rect"], confidence, serialized


def screenshot_pairs(events: list[dict], recording: Path) -> list[tuple[dict, Path, Path]]:
    pairs = []
    for event in events:
        before = event.get("screenshotBefore")
        after = event.get("screenshotAfter")
        if not before or not after:
            continue
        before_path = recording / before
        after_path = recording / after
        if before_path.exists() and after_path.exists():
            pairs.append((event, before_path, after_path))
    return pairs


def read_image(path: Path) -> np.ndarray | None:
    """Read an image from a Windows path that may contain non-ASCII text."""
    try:
        encoded = np.fromfile(path, dtype=np.uint8)
    except OSError:
        return None
    if encoded.size == 0:
        return None
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def resize_gray(image: np.ndarray, maximum_width: int = 1200) -> tuple[np.ndarray, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = min(1.0, maximum_width / gray.shape[1])
    if scale < 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return gray, scale


def estimate_regular_pitch(gray: np.ndarray, resize_scale: float) -> dict:
    """Estimate repeated vertical/horizontal line spacing (grids, tables, rulers)."""
    height, width = gray.shape
    roi = gray[
        max(0, round(height * 0.06)):max(1, round(height * 0.82)),
        max(0, round(width * 0.05)):max(1, round(width * 0.95)),
    ]
    if min(roi.shape) < 80:
        return {"x": None, "y": None, "confidence": 0.0}

    def profile_candidates(profile: np.ndarray) -> list[tuple[float, float]]:
        values = np.asarray(profile, dtype=np.float64)
        values -= cv2.GaussianBlur(values.reshape(1, -1), (0, 1), 25).reshape(-1)
        deviation = float(np.std(values))
        if deviation < 1e-6:
            return []
        values /= deviation
        correlation = np.correlate(values, values, mode="full")[len(values) - 1:]
        correlation /= max(correlation[0], 1e-6)
        minimum = max(5, round(10 * resize_scale))
        maximum = min(len(correlation) - 2, round(260 * resize_scale))
        peaks = [
            (lag, float(correlation[lag]))
            for lag in range(minimum, maximum + 1)
            if correlation[lag] > correlation[lag - 1] and correlation[lag] >= correlation[lag + 1]
        ]
        plausible = [(lag / max(resize_scale, 1e-6), score) for lag, score in peaks if score >= 0.10]
        return sorted(plausible, key=lambda item: item[1], reverse=True)[:16]

    gradient_x = np.abs(cv2.Sobel(roi, cv2.CV_32F, 1, 0, ksize=3))
    gradient_y = np.abs(cv2.Sobel(roi, cv2.CV_32F, 0, 1, ksize=3))
    candidates_x = profile_candidates(np.mean(gradient_x, axis=0))
    candidates_y = profile_candidates(np.mean(gradient_y, axis=1))
    common = []
    for pitch_x, score_x in candidates_x:
        for pitch_y, score_y in candidates_y:
            disagreement = abs(pitch_x - pitch_y) / max(pitch_x, pitch_y)
            if disagreement <= 0.07:
                common.append(((pitch_x + pitch_y) / 2, math.sqrt(score_x * score_y)))
    if not common:
        return {"x": None, "y": None, "confidence": 0.0}
    best_quality = max(quality for _, quality in common)
    stable = [item for item in common if item[1] >= max(0.12, best_quality * 0.72)]
    pitch, confidence = min(stable, key=lambda item: item[0])
    return {
        "x": round(pitch, 2),
        "y": round(pitch, 2),
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
    }


def estimate_similarity(before: np.ndarray, after: np.ndarray) -> dict:
    before_gray, scale = resize_gray(before)
    after_gray, _ = resize_gray(after)
    if before_gray.shape != after_gray.shape:
        return {"ok": False, "reason": "shape_mismatch"}

    grid_before = estimate_regular_pitch(before_gray, scale)
    grid_after = estimate_regular_pitch(after_gray, scale)

    orb = cv2.ORB_create(nfeatures=3500, fastThreshold=10)
    keypoints_a, descriptors_a = orb.detectAndCompute(before_gray, None)
    keypoints_b, descriptors_b = orb.detectAndCompute(after_gray, None)
    if descriptors_a is None or descriptors_b is None:
        return {"ok": False, "reason": "insufficient_features"}

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw_matches = matcher.knnMatch(descriptors_a, descriptors_b, k=2)
    good_matches = [pair[0] for pair in raw_matches if len(pair) == 2 and pair[0].distance < 0.76 * pair[1].distance]

    matrix = None
    inlier_ratio = 0.0
    inliers = 0
    if len(good_matches) >= 6:
        source = np.float32([keypoints_a[match.queryIdx].pt for match in good_matches])
        target = np.float32([keypoints_b[match.trainIdx].pt for match in good_matches])
        matrix, mask = cv2.estimateAffinePartial2D(
            source,
            target,
            method=cv2.RANSAC,
            ransacReprojThreshold=3.0,
            maxIters=3000,
            confidence=0.995,
            refineIters=20,
        )
        if mask is not None:
            inliers = int(mask.sum())
            inlier_ratio = inliers / len(good_matches)

    phase_shift, phase_response = cv2.phaseCorrelate(
        np.float32(before_gray),
        np.float32(after_gray),
    )

    direct_difference = cv2.absdiff(before_gray, after_gray)
    direct_changed = float(np.mean(direct_difference > 18))

    if matrix is None or inliers < 5:
        return {
            "ok": False,
            "reason": "ransac_failed",
            "matches": len(good_matches),
            "inliers": inliers,
            "phaseShift": [round(phase_shift[0] / scale, 2), round(phase_shift[1] / scale, 2)],
            "phaseResponse": round(float(phase_response), 4),
            "directChangedFraction": round(direct_changed, 5),
            "regularPitchBefore": grid_before,
            "regularPitchAfter": grid_after,
        }

    a, b, tx = matrix[0]
    c, d, ty = matrix[1]
    uniform_scale = math.sqrt(max(0.0, a * a + c * c))
    rotation_degrees = math.degrees(math.atan2(c, a))
    translation = math.hypot(tx, ty) / scale

    warped = cv2.warpAffine(
        before_gray,
        matrix,
        (after_gray.shape[1], after_gray.shape[0]),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
    )
    valid = cv2.warpAffine(
        np.full(before_gray.shape, 255, np.uint8),
        matrix,
        (after_gray.shape[1], after_gray.shape[0]),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
    ) > 0
    aligned_difference = cv2.absdiff(warped, after_gray)
    aligned_changed = float(np.mean((aligned_difference > 18)[valid])) if np.any(valid) else 1.0

    transform_strength = max(
        abs(uniform_scale - 1.0) / 0.015,
        abs(rotation_degrees) / 0.5,
        translation / 8.0,
    )
    alignment_gain = direct_changed / max(aligned_changed, 1e-6)
    reliable = inliers >= 10 and inlier_ratio >= 0.30

    pitch_ratios = []
    for axis in ("x", "y"):
        if grid_before[axis] and grid_after[axis]:
            pitch_ratios.append(grid_after[axis] / grid_before[axis])
    pitch_scale = float(np.median(pitch_ratios)) if pitch_ratios else None
    pitch_reliable = (
        pitch_scale is not None
        and min(grid_before["confidence"], grid_after["confidence"]) >= 0.22
        and max(grid_before["confidence"], grid_after["confidence"]) >= 0.60
    )

    if pitch_reliable and abs(pitch_scale - 1.0) >= 0.08:
        classification = "viewport_transform_grid_scale"
    elif reliable and transform_strength > 1.0 and alignment_gain > 1.25:
        classification = "viewport_transform"
    elif direct_changed < 0.002:
        classification = "no_meaningful_visual_change"
    elif reliable and transform_strength <= 1.0:
        classification = "localized_content_or_ui_change"
    else:
        classification = "large_change_or_uncertain"

    return {
        "ok": True,
        "classification": classification,
        "matches": len(good_matches),
        "inliers": inliers,
        "inlierRatio": round(inlier_ratio, 4),
        "scale": round(uniform_scale, 6),
        "rotationDegrees": round(rotation_degrees, 4),
        "translationPixels": round(translation, 3),
        "phaseShift": [round(phase_shift[0] / scale, 2), round(phase_shift[1] / scale, 2)],
        "phaseResponse": round(float(phase_response), 4),
        "directChangedFraction": round(direct_changed, 5),
        "alignedChangedFraction": round(aligned_changed, 5),
        "alignmentGain": round(alignment_gain, 3),
        "regularPitchBefore": grid_before,
        "regularPitchAfter": grid_after,
        "regularPitchScale": None if pitch_scale is None else round(pitch_scale, 4),
    }


def analyze(recording: Path) -> dict:
    events = load_events(recording)
    canvas, canvas_confidence, candidates = infer_canvas_candidates(events)
    pairs = screenshot_pairs(events, recording)
    pair_results = []

    for event, before_path, after_path in pairs:
        before = read_image(before_path)
        after = read_image(after_path)
        if before is None or after is None:
            continue
        height, width = before.shape[:2]
        region = (canvas or Rect(0, 0, width, height)).clipped(width, height)
        before_crop = before[region.y:region.y + region.height, region.x:region.x + region.width]
        after_crop = after[region.y:region.y + region.height, region.x:region.x + region.width]
        result = estimate_similarity(before_crop, after_crop)
        result.update({
            "eventId": event.get("id"),
            "eventType": event.get("eventType"),
            "before": before_path.name,
            "after": after_path.name,
        })
        pair_results.append(result)

    counts = defaultdict(int)
    for item in pair_results:
        counts[item.get("classification", item.get("reason", "unknown"))] += 1

    return {
        "recording": str(recording),
        "eventCount": len(events),
        "canvas": None if canvas is None else {
            "boundsScreen": canvas.as_list(),
            "aspectRatio": round(canvas.width / max(canvas.height, 1), 5),
            "confidence": round(canvas_confidence, 4),
            "method": "large UIA pane/document/custom + temporal pointer consensus",
        },
        "canvasCandidates": candidates,
        "screenshotPairCount": len(pair_results),
        "classifications": dict(counts),
        "pairs": pair_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("recording", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = analyze(args.recording.resolve())
    output = args.output or args.recording / "generated" / "cv-layout-report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "canvas": report["canvas"],
        "screenshotPairCount": report["screenshotPairCount"],
        "classifications": report["classifications"],
        "output": str(output),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
