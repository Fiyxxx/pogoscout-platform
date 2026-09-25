from conftest import cell_at, drain, hop, png, upload

from pogoscout_api.adapters.classifier import (
    ClassifyRequest,
    ClassifyResult,
    DisabledClassifierClient,
    RetryableClassifierError,
)


class ScriptedClassifier:
    """Raises the scripted errors in order, then succeeds."""

    name = "http"

    def __init__(self, errors: list[RetryableClassifierError]) -> None:
        self.errors = list(errors)
        self.calls = 0

    async def classify(self, request: ClassifyRequest) -> ClassifyResult:
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return ClassifyResult(
            status="succeeded",
            label="gravel",
            confidence=0.9,
            model_version="material-model 0.3.0",
            taxonomy_version=request.taxonomy_version,
            raw={"ok": True},
        )

    async def health(self):
        return "ok", "material-model 0.3.0"


def setup(client) -> None:
    client.post("/api/v1/missions", json={"name": "w", "mission_id": "w"})
    client.put("/api/v1/missions/w/hops/1", json=hop("F"))
    assert upload(client, "w", 1, png()).status_code == 201


def history(client) -> list[str]:
    obs = cell_at(client, "w", 0, 1)["observations"][0]
    return [c["status"] for c in obs["classification_history"]]


def test_mock_job_success_flow(client) -> None:
    setup(client)
    cell = cell_at(client, "w", 0, 1)
    assert cell["material"]["status"] == "queued"
    assert cell["quality"] == "pending" and cell["flags"] == ["pending"]
    assert drain(client) == 1
    cell = cell_at(client, "w", 0, 1)
    assert cell["material"]["status"] == "succeeded" and cell["material"]["label"] == "soil"
    assert cell["material"]["model_version"] == "mock-material 0.1.0"
    assert cell["material"]["taxonomy_version"] == "pogo-materials-v2"
    assert cell["material"]["requested_at"] and cell["material"]["completed_at"]
    assert history(client) == ["queued", "succeeded"]
    assert drain(client) == 0


def test_retries_then_succeeds(make_client) -> None:
    classifier = ScriptedClassifier([RetryableClassifierError("timeout")] * 2)
    client = make_client(classifier_client=classifier)
    setup(client)
    drain(client)
    assert classifier.calls == 3
    assert history(client) == ["queued", "retrying", "retrying", "succeeded"]
    messages = [e["message"] for e in client.get("/api/v1/missions/w/events").json()]
    assert any("attempt 1" in m and "retrying" in m for m in messages)


def test_retries_exhausted_fail(make_client) -> None:
    classifier = ScriptedClassifier([RetryableClassifierError("timeout")] * 5)
    client = make_client(classifier_client=classifier, max_attempts=3)
    setup(client)
    drain(client)
    assert classifier.calls == 3
    cell = cell_at(client, "w", 0, 1)
    assert history(client) == ["queued", "retrying", "retrying", "failed"]
    assert cell["quality"] == "failed" and "failed" in cell["flags"]
    assert "after 3 attempts" in cell["material"]["error"]


def test_unreachable_service_becomes_unavailable(make_client) -> None:
    error = RetryableClassifierError("unreachable", unavailable=True)
    client = make_client(classifier_client=ScriptedClassifier([error] * 5), max_attempts=2)
    setup(client)
    drain(client)
    assert cell_at(client, "w", 0, 1)["material"]["status"] == "unavailable"


def test_backoff_defers_retry(make_client) -> None:
    classifier = ScriptedClassifier([RetryableClassifierError("timeout")])
    client = make_client(classifier_client=classifier, retry_base_s=60)
    setup(client)
    drain(client)
    assert classifier.calls == 1 and history(client) == ["queued", "retrying"]
    assert cell_at(client, "w", 0, 1)["quality"] == "pending"


def test_disabled_classifier(make_client) -> None:
    client = make_client(classifier_client=DisabledClassifierClient())
    setup(client)
    drain(client)
    cell = cell_at(client, "w", 0, 1)
    assert cell["material"]["status"] == "unavailable" and cell["quality"] == "failed"


def test_background_worker_runs_in_lifespan(make_client) -> None:
    import time

    client = make_client(worker_enabled=True, worker_poll_s=0.02)
    setup(client)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if cell_at(client, "w", 0, 1)["material"]["status"] == "succeeded":
            break
        time.sleep(0.02)
    assert cell_at(client, "w", 0, 1)["material"]["status"] == "succeeded"
