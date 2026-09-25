import csv
import io
import re

import pytest
from conftest import drain


@pytest.fixture
def replayed(client) -> str:
    client.post("/api/v1/replays", json={"scenario_id": "failures_v1", "mission_id": "x"})
    for _ in range(19):
        client.post("/api/v1/missions/x/replay/step")
    drain(client)
    return "x"


def test_archive(client, replayed) -> None:
    response = client.get(f"/api/v1/missions/{replayed}/export/archive.json")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    archive = response.json()
    assert archive["mission"]["id"] == replayed
    assert len(archive["hops"]) == 9 and len(archive["images"]) == 8
    assert [r["hop_id"] for r in archive["rejected_hops"]] == [3]
    statuses = {c["status"] for c in archive["classifications"]}
    assert statuses == {"queued", "succeeded"}
    assert all(c["raw_response"] for c in archive["classifications"] if c["status"] == "succeeded")
    assert archive["events"][0]["id"] < archive["events"][-1]["id"]
    assert len(archive["cells"]["cells"]) == 8


def test_csvs(client, replayed) -> None:
    hops = client.get(f"/api/v1/missions/{replayed}/export/hops.csv")
    assert hops.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(hops.text)))
    assert [int(r["hop_id"]) for r in rows] == list(range(1, 10))
    assert rows[5]["metal_status"] == "error" and rows[5]["metal_value"] == ""
    assert rows[2]["conflicting_resend"] == "yes"
    assert rows[3]["classification_status"] == "none"

    cells = list(
        csv.DictReader(io.StringIO(client.get("/api/v1/missions/x/export/cells.csv").text))
    )
    assert len(cells) == 8
    revisit = next(c for c in cells if c["hop_ids"] == "1;9")
    assert revisit["quality"] == "low_confidence" and revisit["confidence"] == "0.55"


def test_report(client, replayed) -> None:
    client.patch("/api/v1/missions/x", json={"status": "aborted", "status_note": "Link lost"})
    response = client.get(f"/api/v1/missions/{replayed}/report")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/html")
    html = response.text
    for text in (
        "Failure modes",
        "Flagged cells",
        "mock-material 0.1.0",
        "pogo-materials-v2",
        "aborted: Link lost",
        "Synthetic mock data",
        "@media print",
        "2026-09-25 08:00:00 UTC to 2026-09-25 08:00:32 UTC",
    ):
        assert text in html
    assert "—" not in html
    assert re.search(r"\bmines?\b|\bhuman", html.lower()) is None


def test_exports_unknown_mission(client) -> None:
    for path in ("export/archive.json", "export/hops.csv", "export/cells.csv", "report"):
        assert client.get(f"/api/v1/missions/nope/{path}").status_code == 404
