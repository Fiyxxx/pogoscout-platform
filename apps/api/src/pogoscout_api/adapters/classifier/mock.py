"""Deterministic mock classifier for development and replay.

Uses the dev-only `label_hint`/`confidence_hint` when present. Otherwise it picks the mock
palette colour nearest to the image's average colour, with confidence falling off with distance.
"""

import asyncio
import io
import math

from PIL import Image

from pogoscout_api.adapters.classifier.base import (
    ClassifierHealth,
    ClassifierName,
    ClassifyRequest,
    ClassifyResult,
)
from pogoscout_api.domain.materials import MATERIAL_LABELS
from pogoscout_api.replay.generate import MOCK_IMAGE_COLOURS

DEFAULT_HINT_CONFIDENCE = 0.9
HEADER_ROWS = 64  # the synthetic stamp band at the top of mock screenshots


def average_colour(data: bytes) -> tuple[float, float, float]:
    with Image.open(io.BytesIO(data)) as img:
        rgb = img.convert("RGB")
        if rgb.height > HEADER_ROWS * 2:
            rgb = rgb.crop((0, HEADER_ROWS, rgb.width, rgb.height))
        pixel = rgb.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    r, g, b = pixel  # type: ignore[misc]
    return float(r), float(g), float(b)


def nearest_material(colour: tuple[float, float, float]) -> tuple[str, float]:
    label, distance = min(
        ((name, math.dist(colour, ref)) for name, ref in MOCK_IMAGE_COLOURS.items()),
        key=lambda item: item[1],
    )
    confidence = round(max(0.35, min(0.97, 0.97 - distance / 150)), 2)
    return label, confidence


def mock_classify(request: ClassifyRequest, model_version: str) -> ClassifyResult:
    if request.label_hint in MATERIAL_LABELS:
        label = request.label_hint
        confidence = (
            request.confidence_hint
            if request.confidence_hint is not None
            else DEFAULT_HINT_CONFIDENCE
        )
    else:
        try:
            label, confidence = nearest_material(average_colour(request.image))
        except OSError as exc:
            return ClassifyResult(status="failed", error=f"unreadable image: {exc}")
    raw = {
        "schema_version": "1.0",
        "request_id": request.request_id,
        "mission_id": request.mission_id,
        "hop_id": request.hop_id,
        "image_sha256": request.image_sha256,
        "status": "succeeded",
        "label": label,
        "confidence": confidence,
        "model_version": model_version,
        "taxonomy_version": request.taxonomy_version,
    }
    return ClassifyResult(
        status="succeeded",
        label=label,
        confidence=confidence,
        model_version=model_version,
        taxonomy_version=request.taxonomy_version,
        raw=raw,
    )


class MockClassifierClient:
    name: ClassifierName = "mock"

    def __init__(self, model_version: str, latency_s: float = 0.0) -> None:
        self.model_version = model_version
        self.latency_s = latency_s

    async def classify(self, request: ClassifyRequest) -> ClassifyResult:
        if self.latency_s > 0:
            await asyncio.sleep(self.latency_s)
        return mock_classify(request, self.model_version)

    async def health(self) -> tuple[ClassifierHealth, str | None]:
        return "ok", self.model_version
