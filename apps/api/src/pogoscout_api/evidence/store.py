"""Filesystem screenshot store: `{image_dir}/{mission_id}/{hop_id}.{png|jpg}` plus SHA-256."""

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

CONTENT_TYPES: dict[str, str] = {"image/png": "png", "image/jpeg": "jpg"}


class InvalidImage(ValueError):
    pass


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sniff_content_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def validate_image(data: bytes, declared: str | None, max_bytes: int) -> str:
    """Return the verified content type, or raise InvalidImage."""
    if not data:
        raise InvalidImage("image is empty")
    if len(data) > max_bytes:
        raise InvalidImage(f"image exceeds {max_bytes} bytes")
    actual = sniff_content_type(data)
    if actual is None:
        raise InvalidImage("image must be image/png or image/jpeg")
    declared = (declared or "").split(";")[0].strip().lower()
    if declared == "image/jpg":
        declared = "image/jpeg"
    if declared not in ("", "application/octet-stream", actual):
        raise InvalidImage(f"declared content type {declared} does not match {actual}")
    return actual


@dataclass(frozen=True)
class ImageStore:
    root: Path

    def relative_path(self, mission_id: str, hop_id: int, content_type: str) -> str:
        return f"{mission_id}/{hop_id}.{CONTENT_TYPES[content_type]}"

    def write(self, relative: str, data: bytes) -> None:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)

    def read(self, relative: str) -> bytes:
        return (self.root / relative).read_bytes()

    def absolute(self, relative: str) -> Path:
        return self.root / relative
