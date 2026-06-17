"""Flight log tests: linkage, validation, pack integration, FK delete behavior."""

import pytest


@pytest.fixture
def quad_and_pack(client):
    qid = client.post("/api/quads", json={"name": "Apex 5"}).json()["id"]
    pid = client.post("/api/packs", json={"name": "GNB 1300", "cell_count": 6}).json()["id"]
    return qid, pid


def test_create_flight_links_names(client, quad_and_pack):
    qid, pid = quad_and_pack
    fid = client.post("/api/flights", json={
        "quad_id": qid, "pack_id": pid, "duration_sec": 222, "location": "field",
    }).json()["id"]
    f = client.get(f"/api/flights/{fid}").json()
    assert f["quad_name"] == "Apex 5"
    assert f["pack_name"] == "GNB 1300"
    assert f["duration_sec"] == 222


def test_flight_filters(client, quad_and_pack):
    qid, pid = quad_and_pack
    qid2 = client.post("/api/quads", json={"name": "Other"}).json()["id"]
    client.post("/api/flights", json={"quad_id": qid, "pack_id": pid, "duration_sec": 60})
    client.post("/api/flights", json={"quad_id": qid2, "duration_sec": 90})
    assert len(client.get("/api/flights", params={"quad_id": qid}).json()) == 1
    assert len(client.get("/api/flights", params={"pack_id": pid}).json()) == 1
    assert len(client.get("/api/flights").json()) == 2


def test_flight_validation(client, quad_and_pack):
    qid, pid = quad_and_pack
    assert client.post("/api/flights", json={"duration_sec": 0}).status_code == 422
    assert client.post("/api/flights", json={"duration_sec": -5}).status_code == 422
    # references that don't exist -> 404
    assert client.post("/api/flights", json={"quad_id": 9999, "duration_sec": 60}).status_code == 404
    assert client.post("/api/flights", json={"pack_id": 9999, "duration_sec": 60}).status_code == 404


def test_pack_metrics_include_flight_time(client, quad_and_pack):
    qid, pid = quad_and_pack
    client.post("/api/flights", json={"quad_id": qid, "pack_id": pid, "duration_sec": 180})
    pack = [p for p in client.get("/api/packs").json() if p["id"] == pid][0]
    assert pack["metrics"]["flight_count"] == 1
    assert pack["metrics"]["total_flight_sec"] == 180
    # also on the health endpoint
    h = client.get(f"/api/packs/{pid}/health").json()
    assert h["metrics"]["total_flight_sec"] == 180


def test_deleting_quad_preserves_flights(client, quad_and_pack):
    qid, pid = quad_and_pack
    fid = client.post("/api/flights", json={"quad_id": qid, "pack_id": pid, "duration_sec": 120}).json()["id"]
    client.delete(f"/api/quads/{qid}")
    f = client.get(f"/api/flights/{fid}").json()
    assert f["quad_id"] is None        # history kept, link nulled
    assert f["pack_id"] == pid         # pack link intact


def test_deleting_pack_preserves_flights(client, quad_and_pack):
    qid, pid = quad_and_pack
    fid = client.post("/api/flights", json={"quad_id": qid, "pack_id": pid, "duration_sec": 120}).json()["id"]
    client.delete(f"/api/packs/{pid}")
    f = client.get(f"/api/flights/{fid}").json()
    assert f["pack_id"] is None
    assert f["quad_id"] == qid
