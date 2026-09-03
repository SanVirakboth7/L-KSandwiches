"""Trace a transparent raster silhouette into a compact, editable SVG path."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image


Point = tuple[int, int]


def perpendicular_distance(point: Point, start: Point, end: Point) -> float:
    if start == end:
        return math.dist(point, start)
    x, y = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    return numerator / math.hypot(y2 - y1, x2 - x1)


def rdp(points: list[Point], epsilon: float) -> list[Point]:
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    distances = [perpendicular_distance(point, start, end) for point in points[1:-1]]
    if not distances:
        return [start, end]
    max_distance = max(distances)
    if max_distance <= epsilon:
        return [start, end]
    index = distances.index(max_distance) + 1
    return rdp(points[: index + 1], epsilon)[:-1] + rdp(points[index:], epsilon)


def simplify_closed(points: list[Point], epsilon: float) -> list[Point]:
    ring = points[:-1] if points and points[0] == points[-1] else points[:]
    if len(ring) < 4:
        return ring
    first_index = min(range(len(ring)), key=lambda index: (ring[index][0], ring[index][1]))
    ring = ring[first_index:] + ring[:first_index]
    farthest_index = max(range(1, len(ring)), key=lambda index: math.dist(ring[0], ring[index]))
    first_half = rdp(ring[: farthest_index + 1], epsilon)
    second_half = rdp(ring[farthest_index:] + [ring[0]], epsilon)
    return first_half[:-1] + second_half[:-1]


def trace_loops(mask: np.ndarray) -> list[list[Point]]:
    height, width = mask.shape
    edges: dict[Point, list[Point]] = {}

    def add_edge(start: Point, end: Point) -> None:
        edges.setdefault(start, []).append(end)

    for y in range(height):
        for x in range(width):
            if not mask[y, x]:
                continue
            if y == 0 or not mask[y - 1, x]:
                add_edge((x, y), (x + 1, y))
            if x == width - 1 or not mask[y, x + 1]:
                add_edge((x + 1, y), (x + 1, y + 1))
            if y == height - 1 or not mask[y + 1, x]:
                add_edge((x + 1, y + 1), (x, y + 1))
            if x == 0 or not mask[y, x - 1]:
                add_edge((x, y + 1), (x, y))

    direction_index = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    turn_priority = {1: 0, 0: 1, 3: 2, 2: 3}
    loops: list[list[Point]] = []

    while edges:
        start = min(edges)
        current = start
        previous: Point | None = None
        loop = [start]

        while True:
            candidates = edges.get(current)
            if not candidates:
                raise RuntimeError(f"Open contour at {current}")
            if previous is None or len(candidates) == 1:
                next_point = candidates[0]
            else:
                incoming = direction_index[(current[0] - previous[0], current[1] - previous[1])]

                def candidate_rank(candidate: Point) -> int:
                    outgoing = direction_index[(candidate[0] - current[0], candidate[1] - current[1])]
                    return turn_priority[(outgoing - incoming) % 4]

                next_point = min(candidates, key=candidate_rank)

            candidates.remove(next_point)
            if not candidates:
                del edges[current]
            previous, current = current, next_point
            loop.append(current)
            if current == start:
                break

        if len(loop) >= 4:
            loops.append(loop)

    return loops


def trace_png(source: Path, destination: Path, color: str, epsilon: float) -> None:
    image = Image.open(source).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    mask = alpha >= 96
    loops = trace_loops(mask)
    paths: list[str] = []

    for loop in loops:
        simplified = simplify_closed(loop, epsilon)
        if len(simplified) < 3:
            continue
        commands = [f"M{simplified[0][0]} {simplified[0][1]}"]
        commands.extend(f"L{x} {y}" for x, y in simplified[1:])
        commands.append("Z")
        paths.append(" ".join(commands))

    width, height = image.size
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'fill="{color}" shape-rendering="geometricPrecision">\n'
        f'  <path fill-rule="evenodd" d="{" ".join(paths)}"/>\n'
        '</svg>\n'
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(svg, encoding="utf-8")
    print(f"Traced {len(loops)} contours: {source} -> {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--color", default="#292D32")
    parser.add_argument("--epsilon", type=float, default=1.35)
    args = parser.parse_args()
    trace_png(args.source, args.destination, args.color, args.epsilon)


if __name__ == "__main__":
    main()
