import json
from pathlib import Path

import pytest
from conftest import hop
from pydantic import ValidationError

from pogoscout_api.domain import risk
from pogoscout_api.domain.hops import SensorReading
from pogoscout_api.domain.risk_cases import build

CASES = Path(__file__).resolve().parents[3] / "contracts" / "risk.v1.cases.json"


def test_contract_cases_are_current() -> None:
    """The committed cases match the rules; the web client runs the same file."""
    assert json.loads(CASES.read_text()) == build()


@pytest.mark.parametrize("value", [0, 0.42, 1, 0.999])
def test_signal_strength_accepts_zero_to_one(value) -> None:
    assert SensorReading(value=value, status="ok").value == value


@pytest.mark.parametrize("value", [-0.1, 1.01, True, float("nan")])
def test_signal_strength_rejects_out_of_range(value) -> None:
    with pytest.raises(ValidationError):
        SensorReading(value=value, status="ok")


def test_matrix_follows_the_army_risk_table() -> None:
    assert risk.MATRIX["I"] == ("EH", "EH", "H", "H", "M")
    assert risk.MATRIX["III"] == ("H", "M", "M", "L", "L")
    assert [risk.probability(s) for s in (95, 80, 65, 52, 49)] == ["A", "B", "C", "D", "E"]


def test_hundredths_round_half_up() -> None:
    assert [risk.hundredths(v) for v in (0.125, 0.745, 0.5, 0.004)] == [13, 75, 50, 0]


def cell(x, y, metal=(0.05,), voc=(0.05,)):
    return risk.CellReadings(x, y, [(v, "ok") for v in metal], [(v, "ok") for v in voc])


def test_unknown_is_never_safe() -> None:
    failed = risk.CellReadings(0, 0, [(None, "error")], [(0.05, "ok")])
    result = risk.assess([failed, cell(1, 0)])
    [unassessed] = [c for c in result.cells if not c.assessed]
    assert unassessed.reasons == ["Metal sensor error"]
    assert result.verdict == "caution"
    assert "50% of surveyed cells not assessed" in result.verdict_reasons


def test_weak_readings_never_form_an_area() -> None:
    result = risk.assess([cell(0, 0, metal=(0.4,)), cell(1, 0, metal=(0.45,))])
    assert result.areas == []
    assert result.verdict_reasons == ["2 weak metal readings to re-survey"]


def test_areas_join_cells_up_to_two_apart() -> None:
    near = risk.assess([cell(0, 0, metal=(0.7,)), cell(2, 2, metal=(0.7,))])
    far = risk.assess([cell(0, 0, metal=(0.7,)), cell(3, 0, metal=(0.7,))])
    assert len(near.areas) == 1 and len(far.areas) == 2


def test_labels_never_name_mines_or_people() -> None:
    result = risk.assess([cell(0, 0, metal=(0.9,)), cell(5, 5, voc=(0.9,))])
    text = json.dumps(risk.to_json(result)).lower()
    assert "mine" not in text and "person" not in text and "people" not in text


def test_risk_endpoint(client, mission) -> None:
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F", metal=(0.82, "ok")))
    client.put(f"/api/v1/missions/{mission}/hops/2", json=hop("F", voc=(0.3, "ok")))
    body = client.get(f"/api/v1/missions/{mission}/risk").json()
    assert body["rules_version"] == "risk-1"
    assert body["verdict"] == "no_go"
    assert body["coverage"] == {"surveyed": 2, "assessed": 2}
    [area] = body["areas"]
    assert area["label"] == "Suspected explosive hazard"
    assert area["reasons"][0] == "Metal signal 0.82"
    assert client.get("/api/v1/missions/nope/risk").status_code == 404
