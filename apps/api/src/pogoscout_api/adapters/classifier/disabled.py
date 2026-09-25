from pogoscout_api.adapters.classifier.base import (
    ClassifierHealth,
    ClassifierName,
    ClassifyRequest,
    ClassifyResult,
)


class DisabledClassifierClient:
    name: ClassifierName = "disabled"

    async def classify(self, request: ClassifyRequest) -> ClassifyResult:
        return ClassifyResult(status="unavailable", error="classifier disabled")

    async def health(self) -> tuple[ClassifierHealth, str | None]:
        return "offline", None
