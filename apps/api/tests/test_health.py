from pogoscout_api.adapters.classifier import DisabledClassifierClient


def test_health(client) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "classifier": "mock",
        "classifier_status": "ok",
        "model_version": "mock-material 0.1.0",
    }


def test_health_disabled(make_client) -> None:
    body = make_client(classifier_client=DisabledClassifierClient()).get("/api/v1/health").json()
    assert body["classifier"] == "disabled" and body["classifier_status"] == "offline"
    assert body["model_version"] is None


def test_health_http_unconfigured(make_client) -> None:
    body = make_client(classifier="http", ml_service_url=None).get("/api/v1/health").json()
    assert body["classifier"] == "http" and body["classifier_status"] == "offline"
