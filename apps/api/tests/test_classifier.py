import hashlib
import json

import httpx
import pytest
from conftest import FIXTURE_DIR, png

from pogoscout_api.adapters.classifier import (
    ClassifyRequest,
    DisabledClassifierClient,
    HttpClassifierClient,
    MockClassifierClient,
    RetryableClassifierError,
    build_classifier,
)
from pogoscout_api.config import Settings
from pogoscout_api.replay.generate import MOCK_IMAGE_COLOURS


def request(image: bytes | None = None, **overrides) -> ClassifyRequest:
    image = image or png()
    values = {
        "request_id": "inf_1",
        "mission_id": "m-1",
        "hop_id": 4,
        "image_sha256": hashlib.sha256(image).hexdigest(),
        "taxonomy_version": "pogo-materials-v2",
        "image": image,
        "content_type": "image/png",
    }
    values.update(overrides)
    return ClassifyRequest(**values)


def good_response(req: ClassifyRequest, **overrides) -> dict:
    body = {
        "schema_version": "1.0",
        "request_id": req.request_id,
        "mission_id": req.mission_id,
        "hop_id": req.hop_id,
        "image_sha256": req.image_sha256,
        "status": "succeeded",
        "label": "mud",
        "confidence": 0.83,
        "model_version": "material-model 0.3.0",
        "taxonomy_version": "pogo-materials-v2",
        "classified_at": "2026-09-25T08:14:33Z",
    }
    body.update(overrides)
    return body


async def test_mock_uses_hints_and_is_deterministic() -> None:
    client = MockClassifierClient("mock-material 0.1.0")
    hinted = await client.classify(request(label_hint="water", confidence_hint=0.97))
    assert (hinted.status, hinted.label, hinted.confidence) == ("succeeded", "water", 0.97)
    assert hinted.model_version == "mock-material 0.1.0"
    assert hinted.raw is not None and hinted.raw["request_id"] == "inf_1"

    fixture_image = (FIXTURE_DIR / "park_connector_v1/images/hop_001.png").read_bytes()
    a = await client.classify(request(fixture_image))
    b = await client.classify(request(fixture_image))
    assert a.label == b.label == "mud" and a.confidence == b.confidence
    assert 0 <= a.confidence <= 1


@pytest.mark.parametrize("label", list(MOCK_IMAGE_COLOURS))
async def test_mock_nearest_colour(label) -> None:
    result = await MockClassifierClient("m").classify(request(png(MOCK_IMAGE_COLOURS[label])))
    assert result.label == label and result.confidence == 0.97


async def test_disabled_is_unavailable() -> None:
    client = DisabledClassifierClient()
    assert (await client.classify(request())).status == "unavailable"
    assert await client.health() == ("offline", None)


def test_build_classifier_selects_adapter() -> None:
    assert build_classifier(Settings(_env_file=None, classifier="disabled")).name == "disabled"
    assert build_classifier(Settings(_env_file=None, classifier="http")).name == "http"
    assert build_classifier(Settings(_env_file=None)).name == "mock"


def http_client(handler) -> HttpClassifierClient:
    return HttpClassifierClient("http://ml.test", 1.0, transport=httpx.MockTransport(handler))


async def test_http_success_sends_contract_fields() -> None:
    req = request()
    seen: dict = {}

    def handler(r: httpx.Request) -> httpx.Response:
        seen["url"] = str(r.url)
        seen["body"] = r.content
        return httpx.Response(200, json=good_response(req))

    result = await http_client(handler).classify(req)
    assert result.status == "succeeded" and result.label == "mud" and result.confidence == 0.83
    assert result.model_version == "material-model 0.3.0"
    assert result.raw["classified_at"] == "2026-09-25T08:14:33Z"
    assert seen["url"] == "http://ml.test/api/v1/classify"
    for field in (b"request_id", b"mission_id", b"hop_id", b"image_sha256", b"taxonomy_version"):
        assert b'name="' + field + b'"' in seen["body"]
    assert b'name="image"' in seen["body"]


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"request_id": "inf_other"}, "request_id mismatch"),
        ({"mission_id": "m-2"}, "mission_id mismatch"),
        ({"hop_id": 5}, "hop_id mismatch"),
        ({"image_sha256": "0" * 64}, "image_sha256 mismatch"),
        ({"label": "lava"}, "not in taxonomy"),
        ({"confidence": 1.4}, "schema"),
        ({"taxonomy_version": "pogo-materials-v1"}, "taxonomy_version"),
        ({"status": "weird"}, "schema"),
    ],
)
async def test_http_rejects_invalid_responses(overrides, reason) -> None:
    req = request()
    body = good_response(req, **overrides)
    result = await http_client(lambda r: httpx.Response(200, json=body)).classify(req)
    assert result.status == "failed" and reason in result.error
    assert result.raw == body  # the raw response is always kept


async def test_http_malformed_body_and_model_failure() -> None:
    req = request()
    malformed = await http_client(lambda r: httpx.Response(200, text="not json")).classify(req)
    assert malformed.status == "failed" and malformed.raw == {"body": "not json"}

    body = good_response(req, status="failed", label=None, confidence=None, error="blurry")
    failed = await http_client(lambda r: httpx.Response(200, json=body)).classify(req)
    assert failed.status == "failed" and failed.error == "blurry"

    bad_request = await http_client(lambda r: httpx.Response(422, json={"detail": "x"})).classify(
        req
    )
    assert bad_request.status == "failed" and bad_request.error == "HTTP 422"


async def test_http_transient_errors_are_retryable() -> None:
    def timeout(r):
        raise httpx.ReadTimeout("slow", request=r)

    def refused(r):
        raise httpx.ConnectError("refused", request=r)

    with pytest.raises(RetryableClassifierError) as exc:
        await http_client(timeout).classify(request())
    assert not exc.value.unavailable and "timeout" in str(exc.value)

    with pytest.raises(RetryableClassifierError) as exc:
        await http_client(refused).classify(request())
    assert exc.value.unavailable

    with pytest.raises(RetryableClassifierError):
        await http_client(lambda r: httpx.Response(503, json={"detail": "busy"})).classify(
            request()
        )


async def test_http_health_and_missing_url() -> None:
    client = http_client(lambda r: httpx.Response(200, json={"model_version": "mm 0.3.0"}))
    assert await client.health() == ("ok", "mm 0.3.0")

    def refused(r):
        raise httpx.ConnectError("refused", request=r)

    assert (await http_client(refused).health())[0] == "offline"
    unconfigured = HttpClassifierClient(None)
    assert (await unconfigured.classify(request())).status == "unavailable"
    assert await unconfigured.health() == ("offline", None)


def test_ml_contract_example_is_accepted() -> None:
    """The published example response in contracts/ validates against the adapter."""
    from pogoscout_api.adapters.classifier.http import verify_response

    example = json.loads((FIXTURE_DIR.parent / "contracts/ml-classify.v1.example.json").read_text())
    req = request(
        request_id=example["request"]["request_id"],
        mission_id=example["request"]["mission_id"],
        hop_id=example["request"]["hop_id"],
        image_sha256=example["request"]["image_sha256"],
    )
    assert verify_response(req, example["response"]).status == "succeeded"
