"""Backend contract for the 1S quick-batch logger (pack.js `logBatch`).

The frontend logs N identical cycles — one per 1S pack used — at a fixed
voltage (charged 4.35 V / storage 3.85 V). These tests pin the API behavior
that loop relies on, including how the resulting cycles drive health metrics.
"""

from datetime import datetime, timedelta, timezone


CHARGED_V = 4.35
STORAGE_V = 3.85


def _make_1s_pack(client, **overrides):
    body = {"name": "lava 1s x8", "cell_count": 1, "capacity_mah": 580, "chemistry": "LiHV"}
    body.update(overrides)
    return client.post("/api/packs", json=body).json()["id"]


def _log_batch(client, pid, cycle_type, voltage, count, timestamp=None):
    """Mimic pack.js logBatch(): one cycle per pack, all at the same voltage."""
    for i in range(count):
        res = client.post("/api/cycles", json={
            "pack_id": pid,
            "cycle_type": cycle_type,
            "pack_voltage": voltage,
            "cell_voltages": [voltage],
            "source": "batch",
            "notes": f"Batch {cycle_type} ({i + 1} of {count})",
            "timestamp": timestamp,
        })
        assert res.status_code == 200, res.text


def test_charged_batch_creates_one_cycle_per_pack(client):
    pid = _make_1s_pack(client)
    _log_batch(client, pid, "charge", CHARGED_V, count=8)

    cycles = client.get(f"/api/packs/{pid}/cycles").json()
    assert len(cycles) == 8
    assert all(c["cycle_type"] == "charge" for c in cycles)
    assert all(c["pack_voltage"] == CHARGED_V for c in cycles)
    assert all(c["cell_voltages"] == [CHARGED_V] for c in cycles)
    assert all(c["source"] == "batch" for c in cycles)

    metrics = client.get(f"/api/packs/{pid}/health").json()["metrics"]
    assert metrics["charge_count"] == 8
    assert metrics["total_logged"] == 8
    # 1S cells (length 1) carry no spread; status stays a plain "healthy".
    assert metrics["status"] == "healthy"
    assert metrics["latest_spread"] is None


def test_storage_batch_never_flags_storage_hazard(client):
    pid = _make_1s_pack(client)
    # Even backdated well past the hazard window, a storage batch must not warn.
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    _log_batch(client, pid, "storage", STORAGE_V, count=8, timestamp=old)

    metrics = client.get(f"/api/packs/{pid}/health").json()["metrics"]
    assert metrics["storage_warning"] is False


def test_charged_batch_left_sitting_flags_storage_hazard(client):
    pid = _make_1s_pack(client)
    # Charged packs left sitting beyond STORAGE_HAZARD_DAYS are the real hazard.
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    _log_batch(client, pid, "charge", CHARGED_V, count=8, timestamp=old)

    metrics = client.get(f"/api/packs/{pid}/health").json()["metrics"]
    assert metrics["storage_warning"] is True
    assert metrics["storage_days"] >= 3


def test_fresh_charged_batch_does_not_warn_yet(client):
    pid = _make_1s_pack(client)
    # Just charged today — not a hazard until it has been sitting a few days.
    _log_batch(client, pid, "charge", CHARGED_V, count=8)

    metrics = client.get(f"/api/packs/{pid}/health").json()["metrics"]
    assert metrics["storage_warning"] is False


def test_batch_cycles_survive_csv_roundtrip(client):
    pid = _make_1s_pack(client)
    _log_batch(client, pid, "charge", CHARGED_V, count=3)

    text = client.get("/api/export.csv").text
    assert text.count("lava 1s x8") == 3
    assert "batch" in text                       # source column preserved
    assert str(CHARGED_V) in text
