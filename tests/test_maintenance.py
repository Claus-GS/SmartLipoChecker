"""Maintenance log tests: CRUD, status toggle, filters, cascade delete."""

import pytest


@pytest.fixture
def quad(client):
    return client.post("/api/quads", json={"name": "Apex 5"}).json()["id"]


def test_create_and_list(client, quad):
    client.post("/api/maintenance", json={
        "quad_id": quad, "type": "motor swap", "description": "rear-left",
    })
    items = client.get("/api/maintenance", params={"quad_id": quad}).json()
    assert len(items) == 1
    assert items[0]["type"] == "motor swap"
    assert items[0]["quad_name"] == "Apex 5"
    assert items[0]["status"] == "open"


def test_status_toggle_and_filter(client, quad):
    mid = client.post("/api/maintenance", json={"quad_id": quad, "type": "Repair"}).json()["id"]
    assert len(client.get("/api/maintenance", params={"status": "open"}).json()) == 1
    client.patch(f"/api/maintenance/{mid}", json={"status": "done"})
    assert len(client.get("/api/maintenance", params={"status": "open"}).json()) == 0
    assert len(client.get("/api/maintenance", params={"status": "done"}).json()) == 1


def test_validation(client, quad):
    assert client.post("/api/maintenance", json={"quad_id": quad, "status": "bogus"}).status_code == 422
    # quad must exist
    assert client.post("/api/maintenance", json={"quad_id": 9999}).status_code == 404


def test_cascade_delete_with_quad(client, quad):
    client.post("/api/maintenance", json={"quad_id": quad, "type": "Inspection"})
    assert len(client.get("/api/maintenance").json()) == 1
    client.delete(f"/api/quads/{quad}")
    assert client.get("/api/maintenance").json() == []   # cascaded


def test_delete_maintenance(client, quad):
    mid = client.post("/api/maintenance", json={"quad_id": quad}).json()["id"]
    assert client.delete(f"/api/maintenance/{mid}").status_code == 200
    assert client.get("/api/maintenance").json() == []
