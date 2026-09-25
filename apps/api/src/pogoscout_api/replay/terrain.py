"""Seeded terrain helpers for the large fixtures: smooth value noise and zone shapes.

Pure integer hashing (no Python `hash()`), so output is identical across runs and platforms.
"""

import math

MASK = 0xFFFFFFFF


def _hash(ix: int, iy: int, seed: int) -> float:
    """Deterministic lattice value in [0, 1)."""
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & MASK
    h = ((h ^ (h >> 13)) * 1274126177) & MASK
    h ^= h >> 16
    return h / 2**32


def _smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def value_noise(x: float, y: float, scale: float, seed: int) -> float:
    """Smoothstepped bilinear lattice noise in [0, 1). `scale` is cells per lattice step."""
    fx, fy = x / scale, y / scale
    ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = _smooth(fx - ix), _smooth(fy - iy)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    top = a + (b - a) * tx
    bottom = c + (d - c) * tx
    return top + (bottom - top) * ty


def fractal_noise(x: float, y: float, scale: float, seed: int) -> float:
    """Two octaves of value noise, still in [0, 1)."""
    return value_noise(x, y, scale, seed) * 0.7 + value_noise(x, y, scale / 2.5, seed + 101) * 0.3


def in_rect(
    x: int,
    y: int,
    box: tuple[int, int, int, int],
    *,
    seed: int,
    jitter: float = 1.2,
    scale: float = 3.0,
) -> bool:
    """Inside the inclusive box (x0, x1, y0, y1) with noise-perturbed, organic edges."""
    x0, x1, y0, y1 = box
    depth = min(x - x0, x1 - x, y - y0, y1 - y)
    return depth + (value_noise(x, y, scale, seed) - 0.5) * 2 * jitter >= 0


def ellipse_distance(x: int, y: int, cx: float, cy: float, rx: float, ry: float) -> float:
    """1.0 on the ellipse outline, < 1 inside."""
    return math.hypot((x - cx) / rx, (y - cy) / ry)
