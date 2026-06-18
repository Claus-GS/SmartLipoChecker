"""Quad CRUD and stat-enrichment tests."""


def test_create_and_get_quad(client):
    qid = client.post("/api/quads", json={
        "name": "Apex 5", "class": "5\"", "battery_cell_count": 6,
        "fc": "DJI N3", "weight_g": 650,
    }).json()["id"]

    q = client.get(f"/api/quads/{qid}").json()
    assert q["name"] == "Apex 5"
    assert q["class"] == "5\""          # alias round-trips to the DB column
    assert q["battery_cell_count"] == 6
    assert q["fc"] == "DJI N3"
    assert q["stats"]["flight_count"] == 0


def test_list_and_update_quad(client):
    qid = client.post("/api/quads", json={"name": "Whoop"}).json()["id"]
    client.patch(f"/api/quads/{qid}", json={
        "status": "down", "motors": "0802", "battery_cell_count": 1,
    })
    q = [x for x in client.get("/api/quads").json() if x["id"] == qid][0]
    assert q["status"] == "down"
    assert q["motors"] == "0802"
    assert q["battery_cell_count"] == 1


def test_quad_stats_reflect_flights(client):
    qid = client.post("/api/quads", json={"name": "Apex 5"}).json()["id"]
    client.post("/api/flights", json={"quad_id": qid, "duration_sec": 200})
    client.post("/api/flights", json={"quad_id": qid, "duration_sec": 100})
    q = client.get(f"/api/quads/{qid}").json()
    assert q["stats"]["flight_count"] == 2
    assert q["stats"]["total_flight_sec"] == 300


def test_quad_validation(client):
    assert client.post("/api/quads", json={"name": ""}).status_code == 422
    assert client.post("/api/quads", json={"name": "X", "status": "bogus"}).status_code == 422
    assert client.post("/api/quads", json={"name": "X", "weight_g": 0}).status_code == 422
    assert client.post("/api/quads", json={"name": "X", "battery_cell_count": 0}).status_code == 422


def test_delete_quad(client):
    qid = client.post("/api/quads", json={"name": "Gone"}).json()["id"]
    assert client.delete(f"/api/quads/{qid}").status_code == 200
    assert client.get(f"/api/quads/{qid}").status_code == 404
