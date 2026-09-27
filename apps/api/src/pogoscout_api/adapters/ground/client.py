"""HTTP adapter for the ground-classification service (`GET {url}/latest`, `GET {url}/health`).

Every reading is checked before it is trusted: label membership, confidence range, a numeric
capture time and a JPEG that decodes. The response is kept, minus the image bytes, for
`raw_response`. There are no retries here: the caller fetches once per hop.
"""

import base64
import binascii
import io
import time
from dataclasses import dataclass
from typing import Literal

import httpx
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from pogoscout_api.domain.ground_labels import GROUND_LABELS

HEALTH_CACHE_S = 10.0
GroundHealth = Literal["ok", "offline"]


class GroundUnavailable(Exception):
    """The service could not be reached, timed out or failed with a 5xx."""

    def __init__(self, message: str, *, raw: dict | None = None) -> None:
        super().__init__(message)
        self.raw = raw


class GroundInvalid(Exception):
    """The service answered, but with a reading that failed a check."""

    def __init__(self, message: str, *, raw: dict | None = None) -> None:
        super().__init__(message)
        self.raw = raw


@dataclass(frozen=True)
class GroundReading:
    label: str
    confidence: float
    captured_at: float  # Unix seconds, on the clock this platform shares with the service
    age_s: float
    model_version: str
    image: bytes  # the landing-area crop, JPEG
    raw: dict  # the response without `image_jpeg_b64`


class LatestResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str
    # Strict: a number, not a numeric string or a boolean.
    confidence: float = Field(strict=True, ge=0, le=1, allow_inf_nan=False)
    captured_at: float = Field(strict=True, allow_inf_nan=False)
    age_s: float = Field(strict=True, allow_inf_nan=False)
    model_version: str = Field(min_length=1)
    image_jpeg_b64: str


def _without_image(body: object) -> dict:
    if not isinstance(body, dict):
        return {"body": body}
    return {k: v for k, v in body.items() if k != "image_jpeg_b64"}


def _decode_jpeg(encoded: str) -> bytes:
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image is not valid base64") from exc
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = image.format
            image.load()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError("image does not decode") from exc
    if image_format != "JPEG":
        raise ValueError(f"image is {image_format}, not JPEG")
    return data


def verify_latest(body: object) -> GroundReading:
    """Pure validation of a decoded /latest body. Raises GroundInvalid."""
    raw = _without_image(body)
    try:
        response = LatestResponse.model_validate(body)
    except ValidationError as exc:
        fields = ", ".join(".".join(str(p) for p in e["loc"]) or "body" for e in exc.errors())
        raise GroundInvalid(f"invalid response: schema ({fields})", raw=raw) from exc
    if response.label not in GROUND_LABELS:
        raise GroundInvalid(f"invalid response: label {response.label!r} not in ground-v1", raw=raw)
    try:
        image = _decode_jpeg(response.image_jpeg_b64)
    except ValueError as exc:
        raise GroundInvalid(f"invalid response: {exc}", raw=raw) from exc
    return GroundReading(
        label=response.label,
        confidence=response.confidence,
        captured_at=response.captured_at,
        age_s=response.age_s,
        model_version=response.model_version,
        image=image,
        raw=raw,
    )


class GroundClient:
    def __init__(
        self,
        base_url: str,
        timeout_s: float = 0.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.transport = transport
        self._health: tuple[float, GroundHealth, str | None] | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout_s, transport=self.transport
        )

    async def latest(self) -> GroundReading | None:
        """The latest confident reading, or None before the first one (503).

        Raises GroundUnavailable if the service can't be reached, times out or fails with a
        5xx, and GroundInvalid if the reading fails a check. Each fetch also refreshes the
        cached health, so a service that stops answering shows as offline straight away.
        """
        try:
            async with self._client() as client:
                response = await client.get("/latest")
        except httpx.TimeoutException as exc:
            self._note_health("offline", None)
            raise GroundUnavailable(f"timeout: {type(exc).__name__}") from exc
        except httpx.TransportError as exc:
            self._note_health("offline", None)
            raise GroundUnavailable(f"unreachable: {type(exc).__name__}") from exc

        try:
            body: object = response.json()
        except ValueError:
            body = {"body": response.text[:2000]}
        if response.status_code == 503:
            self._note_health("ok", None)  # up, just no confident label yet
            return None
        if response.status_code >= 500:
            raise GroundUnavailable(f"HTTP {response.status_code}", raw=_without_image(body))
        if response.status_code != 200:
            raise GroundInvalid(f"HTTP {response.status_code}", raw=_without_image(body))
        reading = verify_latest(body)
        self._note_health("ok", reading.model_version)
        return reading

    def _note_health(self, status: GroundHealth, model_version: str | None) -> None:
        if model_version is None and status == "ok" and self._health:
            model_version = self._health[2]
        self._health = (time.monotonic(), status, model_version)

    async def health(self) -> tuple[GroundHealth, str | None]:
        now = time.monotonic()
        if self._health and now - self._health[0] < HEALTH_CACHE_S:
            return self._health[1], self._health[2]
        status: GroundHealth = "offline"
        model_version: str | None = None
        try:
            async with self._client() as client:
                response = await client.get("/health")
            if response.status_code == 200:
                status = "ok"
                body = response.json()
                if isinstance(body, dict) and isinstance(body.get("model_version"), str):
                    model_version = body["model_version"]
        except (httpx.HTTPError, ValueError):
            pass
        self._health = (now, status, model_version)
        return status, model_version
