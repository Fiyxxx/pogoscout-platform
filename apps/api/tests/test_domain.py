import pytest
from conftest import hop
from pydantic import ValidationError

from pogoscout_api.domain.hops import HopPayload, SensorReading
from pogoscout_api.domain.projection import aggregate_sensor, project


def test_zero_is_a_valid_negative() -> None:
    assert SensorReading(value=0, status="ok").value == 0


@pytest.mark.parametrize(
    ("value", "status"), [(None, "ok"), (1, "missing"), (0, "error"), (2, "ok")]
)
def test_invalid_sensor_readings(value, status) -> None:
    with pytest.raises(ValidationError):
        SensorReading(value=value, status=status)


def test_movement_vector_must_match_command() -> None:
    bad = hop("F")
    bad["movement"]["dx"] = 1
    with pytest.raises(ValidationError):
        HopPayload.model_validate(bad)


def test_content_hash_ignores_key_order() -> None:
    a = HopPayload.model_validate(hop())
    b = HopPayload.model_validate(dict(reversed(list(hop().items()))))
    assert a.content_hash() == b.content_hash()


def test_aggregate_priority() -> None:
    ok0 = SensorReading(value=0, status="ok")
    ok1 = SensorReading(value=1, status="ok")
    err = SensorReading(value=None, status="error")
    miss = SensorReading(value=None, status="missing")
    assert aggregate_sensor([ok0, ok1]) == "detected"
    assert aggregate_sensor([err, ok0]) == "not_detected"
    assert aggregate_sensor([miss, err]) == "sensor_error"
    assert aggregate_sensor([miss]) == "missing"


def test_projection_pending_on_gap_and_revisit() -> None:
    hops = {i: HopPayload.model_validate(hop(c)) for i, c in [(1, "F"), (2, "B"), (4, "R")]}
    p = project(hops)
    assert [(h.x, h.y) for h in p.placed] == [(0, 1), (0, 0)]
    assert p.pending_hop_ids == [4]

    hops[3] = HopPayload.model_validate(hop("F"))
    p = project(hops)
    assert p.pending_hop_ids == []
    assert p.current == (1, 1)
    assert [h.hop_id for h in p.cells[(0, 1)].hops] == [1, 3]
