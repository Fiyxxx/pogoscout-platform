import hashlib

from conftest import cell_at, drain, hop, png, upload


def test_image_idempotent_and_conflict(client, mission) -> None:
    data = png()
    first = upload(client, mission, 1, data)
    assert first.status_code == 201
    record = first.json()
    assert record["sha256"] == hashlib.sha256(data).hexdigest()
    assert record["bytes"] == len(data) and record["content_type"] == "image/png"
    assert record["url"] == f"/api/v1/missions/{mission}/hops/1/image"

    again = upload(client, mission, 1, data)
    assert again.status_code == 200 and again.json()["sha256"] == record["sha256"]
    assert upload(client, mission, 1, png((1, 2, 3))).status_code == 409

    served = client.get(record["url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png" and served.content == data

    kinds = [e["kind"] for e in client.get(f"/api/v1/missions/{mission}/events").json()]
    assert kinds.count("image_stored") == 1 and kinds.count("classification_queued") == 1
    assert "hop_conflict" in kinds


def test_image_before_hop_then_hop_arrives(client, mission) -> None:
    assert upload(client, mission, 1, png(), label_hint="sand", confidence_hint=0.91).status_code
    drain(client)
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
    cell = cell_at(client, mission, 0, 1)
    assert cell["material"]["label"] == "sand" and cell["material"]["confidence"] == 0.91
    assert cell["observations"][0]["image"]["hop_id"] == 1
    assert cell["quality"] == "complete"


def test_image_validation(make_client) -> None:
    client = make_client(max_image_bytes=200)
    client.post("/api/v1/missions", json={"name": "v", "mission_id": "v"})
    assert upload(client, "v", 1, b"GIF89a....", "image/gif").status_code == 422
    assert upload(client, "v", 1, png(), "image/jpeg").status_code == 422  # declared != actual
    assert upload(client, "v", 1, png(size=(400, 400))).status_code == 422  # too large
    assert upload(client, "v", 1, png(), label_hint="lava").status_code == 422
    assert upload(client, "v", 1, png(), confidence_hint=1.5).status_code == 422
    assert upload(client, "nope", 1, png()).status_code == 404
    assert client.get("/api/v1/missions/v/hops/1/image").status_code == 404


def test_jpeg_accepted(client, mission) -> None:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), (40, 40, 40)).save(buffer, format="JPEG")
    response = upload(client, mission, 2, buffer.getvalue(), "image/jpeg")
    assert response.status_code == 201 and response.json()["content_type"] == "image/jpeg"
    served = client.get(response.json()["url"])
    assert served.headers["content-type"] == "image/jpeg"
