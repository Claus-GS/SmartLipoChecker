"""Per-quad shopping list (parts to buy) CRUD + summary + cascade tests."""


def _quad(client, name="Apex 5"):
    return client.post("/api/quads", json={"name": name}).json()["id"]


def test_add_list_and_summary(client):
    qid = _quad(client)
    assert client.get(f"/api/quads/{qid}/parts").json()["parts"] == []

    client.post(f"/api/quads/{qid}/parts", json={
        "name": "T-Motor F40", "category": "Motors", "price": 19.99, "url": "http://x",
    })
    client.post(f"/api/quads/{qid}/parts", json={
        "name": "GoPro mount", "price": 5.0, "purchased": True,
    })

    data = client.get(f"/api/quads/{qid}/parts").json()
    assert data["part_count"] == 2
    assert data["remaining_count"] == 1
    assert data["purchased_count"] == 1
    assert round(data["remaining_price"], 2) == 19.99
    # Unbought items sort first.
    assert data["parts"][0]["name"] == "T-Motor F40"
    assert data["parts"][0]["purchased"] is False
    assert data["parts"][1]["purchased"] is True


def test_toggle_purchased_stamps_time(client):
    qid = _quad(client)
    pid = client.post(f"/api/quads/{qid}/parts", json={"name": "Props"}).json()["id"]

    bought = client.patch(f"/api/quad-parts/{pid}", json={"purchased": True}).json()
    assert bought["purchased"] is True
    assert bought["purchased_at"] is not None

    cleared = client.patch(f"/api/quad-parts/{pid}", json={"purchased": False}).json()
    assert cleared["purchased"] is False
    assert cleared["purchased_at"] is None


def test_update_and_delete_part(client):
    qid = _quad(client)
    pid = client.post(f"/api/quads/{qid}/parts", json={"name": "VTX"}).json()["id"]

    client.patch(f"/api/quad-parts/{pid}", json={"name": "VTX 1.6W", "price": 28.5})
    part = client.get(f"/api/quads/{qid}/parts").json()["parts"][0]
    assert part["name"] == "VTX 1.6W"
    assert part["price"] == 28.5

    assert client.delete(f"/api/quad-parts/{pid}").json() == {"ok": True}
    assert client.get(f"/api/quads/{qid}/parts").json()["parts"] == []


def test_parts_validation_and_404s(client):
    qid = _quad(client)
    assert client.post(f"/api/quads/{qid}/parts", json={"name": ""}).status_code == 422
    assert client.post(f"/api/quads/{qid}/parts", json={"name": "x", "price": -1}).status_code == 422
    assert client.post("/api/quads/9999/parts", json={"name": "x"}).status_code == 404
    assert client.get("/api/quads/9999/parts").status_code == 404
    assert client.patch("/api/quad-parts/9999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/quad-parts/9999").status_code == 404


def test_image_url_is_cached_on_create_and_update(client, monkeypatch):
    import app.main as main
    # Avoid real network: pretend the cacher localised the image.
    monkeypatch.setattr(main, "_cache_image", lambda u: "/static/uploads/abc.png" if u else u)

    qid = _quad(client)
    pid = client.post(f"/api/quads/{qid}/parts", json={
        "name": "Camera", "image_url": "https://shop/x.png",
    }).json()["id"]
    assert client.get(f"/api/quads/{qid}/parts").json()["parts"][0]["image_url"] == "/static/uploads/abc.png"

    updated = client.patch(f"/api/quad-parts/{pid}", json={"image_url": "https://shop/y.png"}).json()
    assert updated["image_url"] == "/static/uploads/abc.png"


def test_deleting_quad_removes_its_parts(client):
    qid = _quad(client)
    pid = client.post(f"/api/quads/{qid}/parts", json={"name": "Frame"}).json()["id"]
    client.delete(f"/api/quads/{qid}")
    # Part is gone with the quad (ON DELETE CASCADE).
    assert client.patch(f"/api/quad-parts/{pid}", json={"name": "x"}).status_code == 404
