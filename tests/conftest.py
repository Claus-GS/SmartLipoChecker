"""Shared fixtures: each test runs against its own fresh temporary database."""

import pytest

import app.database as db


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A TestClient backed by an isolated, migrated temp DB."""
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    db.init_db()

    from app.main import app
    from fastapi.testclient import TestClient

    return TestClient(app)


@pytest.fixture
def seeded_pack(client):
    """Create one pack with a charge + discharge cycle; return its id."""
    pid = client.post(
        "/api/packs",
        json={"name": "Tattu 1300 #1", "cell_count": 4, "capacity_mah": 1300, "brand": "A"},
    ).json()["id"]
    client.post("/api/cycles", json={
        "pack_id": pid, "cycle_type": "charge", "pack_voltage": 16.7,
        "cell_voltages": [4.18, 4.17, 4.18, 4.16],
    })
    client.post("/api/cycles", json={
        "pack_id": pid, "cycle_type": "discharge", "pack_voltage": 14.8,
        "cell_voltages": [3.70, 3.71, 3.69, 3.70],
    })
    return pid
