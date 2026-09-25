from pogoscout_api.adapters.classifier.base import (
    ClassifierClient,
    ClassifyRequest,
    ClassifyResult,
    RetryableClassifierError,
)
from pogoscout_api.adapters.classifier.disabled import DisabledClassifierClient
from pogoscout_api.adapters.classifier.http import HttpClassifierClient
from pogoscout_api.adapters.classifier.mock import MockClassifierClient
from pogoscout_api.config import Settings

__all__ = [
    "ClassifierClient",
    "ClassifyRequest",
    "ClassifyResult",
    "DisabledClassifierClient",
    "HttpClassifierClient",
    "MockClassifierClient",
    "RetryableClassifierError",
    "build_classifier",
]


def build_classifier(config: Settings) -> ClassifierClient:
    if config.classifier == "http":
        return HttpClassifierClient(config.ml_service_url, config.classifier_timeout_s)
    if config.classifier == "disabled":
        return DisabledClassifierClient()
    return MockClassifierClient(config.mock_model_version, config.mock_latency_s)
