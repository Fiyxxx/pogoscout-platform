"""Classifier port. The ML model lives in a separate repository and is reached by contract only."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

ClassifierName = Literal["mock", "http", "disabled"]
ClassifierHealth = Literal["ok", "degraded", "offline"]
TerminalStatus = Literal["succeeded", "failed", "unavailable"]


@dataclass(frozen=True)
class ClassifyRequest:
    request_id: str
    mission_id: str
    hop_id: int
    image_sha256: str
    taxonomy_version: str
    image: bytes
    content_type: str
    label_hint: str | None = None
    confidence_hint: float | None = None


@dataclass(frozen=True)
class ClassifyResult:
    status: TerminalStatus
    label: str | None = None
    confidence: float | None = None
    model_version: str | None = None
    taxonomy_version: str | None = None
    error: str | None = None
    raw: dict | None = None
    completed_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class RetryableClassifierError(Exception):
    """Transient failure (timeout, connection refused, 5xx). The worker retries with backoff.

    `unavailable` marks the service as unreachable, so exhausting retries yields `unavailable`
    rather than `failed`.
    """

    def __init__(self, message: str, *, unavailable: bool = False, raw: dict | None = None):
        super().__init__(message)
        self.unavailable = unavailable
        self.raw = raw


class ClassifierClient(Protocol):
    name: ClassifierName

    async def classify(self, request: ClassifyRequest) -> ClassifyResult:
        """Return a terminal result or raise RetryableClassifierError."""
        ...

    async def health(self) -> tuple[ClassifierHealth, str | None]:
        """(status, model_version)."""
        ...
