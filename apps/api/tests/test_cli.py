import pytest

from pogoscout_api import cli
from pogoscout_api.config import Settings
from pogoscout_api.replay.scenario import ImageEvent


def test_reset_requires_yes_and_deletes_db_and_images(tmp_path, monkeypatch, capsys) -> None:
    db = tmp_path / "dev.sqlite3"
    images = tmp_path / "images" / "m"
    images.mkdir(parents=True)
    (images / "1.png").write_bytes(b"x")
    for suffix in ("", "-wal", "-shm"):
        (tmp_path / f"dev.sqlite3{suffix}").write_bytes(b"x")
    config = Settings(
        _env_file=None, database_url=f"sqlite+pysqlite:///{db}", image_dir=tmp_path / "images"
    )
    monkeypatch.setattr(cli, "settings", config)

    assert cli.reset_dev_data(confirmed=False) == 2
    assert "refusing" in capsys.readouterr().out
    assert db.exists() and images.exists()

    assert cli.reset_dev_data(confirmed=True) == 0
    assert not any(tmp_path.iterdir())


def test_reset_cli_exit_code(monkeypatch) -> None:
    monkeypatch.setattr("sys.argv", ["pogoscout-dev", "reset"])
    monkeypatch.setattr(cli, "reset_dev_data", lambda confirmed: 0 if confirmed else 2)
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 2


def test_demo_set_is_the_long_term_story() -> None:
    by_id = {d.mission_id: d for d in cli.DEMO_SET}
    assert by_id["PS-0925-01"].scenario_id == "district_sweep_v1"
    assert by_id["PS-0925-01"].live_fraction == 0.85
    assert by_id["PS-0924-04"].scenario_id == "canal_corridor_v1"
    assert by_id["PS-0924-02"].status == "aborted"
    assert by_id["PS-0923-01"].scenario_id == "park_connector_v1"


@pytest.mark.parametrize(
    "fields", [{}, {"file": "images/hop_001.png", "generate": True}, {"generate": False}]
)
def test_image_event_needs_exactly_one_source(fields) -> None:
    base = {"seq": 1, "at_ms": 0, "hop_id": 1, "mock_label": "soil", "mock_confidence": 0.9}
    with pytest.raises(ValueError):
        ImageEvent.model_validate({**base, **fields})
    assert ImageEvent.model_validate({**base, "generate": True}).file is None
