"""HTTP adapter for the separate material-model service (`POST {url}/api/v1/classify`).

Every response is verified before it is trusted: correlation fields, image hash, taxonomy
version, label membership and confidence range. The raw response is always kept.
"""

import time
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from pogoscout_api.adapters.classifier.base import (
    ClassifierHealth,
    ClassifierName,
    ClassifyRequest,
    ClassifyResult,
    RetryableClassifierError,
)
from pogoscout_api.domain.materials import MATERIAL_LABELS

HEALTH_CACHE_S = 10.0


class ClassifyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    request_id: str
    mission_id: str
    hop_id: int
    image_sha256: str
    status: Literal["succeeded", "failed"]
    label: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = None
    taxonomy_version: str
    error: str | None = None


def verify_response(request: ClassifyRequest, raw: object) -> ClassifyResult:
    """Pure validation of a decoded ML response against the request that produced it."""
    raw_dict = raw if isinstance(raw, dict) else {"body": raw}

    def failed(reason: str) -> ClassifyResult:
        return ClassifyResult(status="failed", error=f"invalid response: {reason}", raw=raw_dict)

    try:
        response = ClassifyResponse.model_validate(raw)
    except ValidationError as exc:
        fields = ", ".join(".".join(str(p) for p in e["loc"]) or "body" for e in exc.errors())
        return failed(f"schema ({fields})")
    expected = (request.request_id, request.mission_id, request.hop_id, request.image_sha256)
    got = (response.request_id, response.mission_id, response.hop_id, response.image_sha256)
    names = ("request_id", "mission_id", "hop_id", "image_sha256")
    for name, want, have in zip(names, expected, got, strict=True):
        if want != have:
            return failed(f"{name} mismatch")
    if response.taxonomy_version != request.taxonomy_version:
        return failed(f"taxonomy_version {response.taxonomy_version} != {request.taxonomy_version}")
    if response.status == "failed":
        return ClassifyResult(
            status="failed",
            model_version=response.model_version,
            taxonomy_version=response.taxonomy_version,
            error=response.error or "model reported failure",
            raw=raw_dict,
        )
    if response.label not in MATERIAL_LABELS:
        return failed(f"label {response.label!r} not in taxonomy")
    if response.confidence is None:
        return failed("confidence missing")
    if not response.model_version:
        return failed("model_version missing")
    return ClassifyResult(
        status="succeeded",
        label=response.label,
        confidence=response.confidence,
        model_version=response.model_version,
        taxonomy_version=response.taxonomy_version,
        raw=raw_dict,
    )


class HttpClassifierClient:
    name: ClassifierName = "http"

    def __init__(
        self,
        base_url: str | None,
        timeout_s: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.timeout_s = timeout_s
        self.transport = transport
        self._health: tuple[float, ClassifierHealth, str | None] | None = None

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=timeout, transport=self.transport)

    async def classify(self, request: ClassifyRequest) -> ClassifyResult:
        if not self.base_url:
            return ClassifyResult(status="unavailable", error="ML_SERVICE_URL not configured")
        extension = "png" if request.content_type == "image/png" else "jpg"
        files = {
            "image": (f"hop_{request.hop_id}.{extension}", request.image, request.content_type)
        }
        data = {
            "request_id": request.request_id,
            "mission_id": request.mission_id,
            "hop_id": str(request.hop_id),
            "image_sha256": request.image_sha256,
            "taxonomy_version": request.taxonomy_version,
        }
        try:
            async with self._client(self.timeout_s) as client:
                response = await client.post("/api/v1/classify", data=data, files=files)
        except httpx.TimeoutException as exc:
            raise RetryableClassifierError(f"timeout: {type(exc).__name__}") from exc
        except httpx.TransportError as exc:
            raise RetryableClassifierError(
                f"unreachable: {type(exc).__name__}", unavailable=True
            ) from exc

        try:
            body: object = response.json()
        except ValueError:
            body = {"body": response.text[:2000]}
        if response.status_code >= 500 or response.status_code == 429:
            raw = body if isinstance(body, dict) else {"body": body}
            raise RetryableClassifierError(f"HTTP {response.status_code}", raw=raw)
        if response.status_code >= 400:
            raw = body if isinstance(body, dict) else {"body": body}
            return ClassifyResult(status="failed", error=f"HTTP {response.status_code}", raw=raw)
        return verify_response(request, body)

    async def health(self) -> tuple[ClassifierHealth, str | None]:
        if not self.base_url:
            return "offline", None
        now = time.monotonic()
        if self._health and now - self._health[0] < HEALTH_CACHE_S:
            return self._health[1], self._health[2]
        status: ClassifierHealth
        model_version: str | None = None
        try:
            async with self._client(1.0) as client:
                response = await client.get("/api/v1/health")
            status = "ok" if response.status_code == 200 else "degraded"
            try:
                body = response.json()
                if isinstance(body, dict) and isinstance(body.get("model_version"), str):
                    model_version = body["model_version"]
            except ValueError:
                pass
        except httpx.HTTPError:
            status = "offline"
        self._health = (now, status, model_version)
        return status, model_version
