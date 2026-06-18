"""Tests for builds, parts, and per-part purchase tracking."""


def _make_build(client, name="Test build"):
    return client.post("/api/builds", json={"name": name}).json()["id"]


def _add_part(client, build_id, name="Part", **kw):
    body = {"build_id": build_id, "name": name, **kw}
    return client.post("/api/parts", json=body).json()["id"]


def _find(client, build_id, part_id):
    parts = client.get(f"/api/builds/{build_id}/parts").json()
    return next(p for p in parts if p["id"] == part_id)


def test_part_defaults_to_not_purchased(client):
    b = _make_build(client)
    pid = _add_part(client, b, name="Frame", price=20)
    part = _find(client, b, pid)
    assert part["purchased"] is False
    assert part["purchased_at"] is None


def test_create_part_marked_purchased_stamps_timestamp(client):
    b = _make_build(client)
    pid = _add_part(client, b, name="Motors", price=48, purchased=True)
    part = _find(client, b, pid)
    assert part["purchased"] is True
    assert part["purchased_at"]  # non-empty ISO timestamp


def test_toggle_purchased_sets_then_clears_timestamp(client):
    b = _make_build(client)
    pid = _add_part(client, b, name="VTX", price=30)

    r = client.patch(f"/api/parts/{pid}", json={"purchased": True})
    assert r.status_code == 200
    assert r.json()["purchased"] is True
    assert r.json()["purchased_at"]

    r = client.patch(f"/api/parts/{pid}", json={"purchased": False})
    assert r.status_code == 200
    assert r.json()["purchased"] is False
    assert r.json()["purchased_at"] is None


def test_editing_other_fields_leaves_purchased_untouched(client):
    b = _make_build(client)
    pid = _add_part(client, b, name="ESC", price=25)
    client.patch(f"/api/parts/{pid}", json={"purchased": True})
    client.patch(f"/api/parts/{pid}", json={"price": 27.5})
    part = _find(client, b, pid)
    assert part["purchased"] is True
    assert part["price"] == 27.5


def test_build_summary_splits_purchased_and_remaining(client):
    b = _make_build(client)
    bought = _add_part(client, b, name="Frame", price=20)
    _add_part(client, b, name="Motors", price=48)
    client.patch(f"/api/parts/{bought}", json={"purchased": True})

    summary = client.get(f"/api/builds/{b}").json()
    assert summary["part_count"] == 2
    assert summary["total_price"] == 68
    assert summary["purchased_count"] == 1
    assert summary["purchased_price"] == 20
    assert summary["remaining_count"] == 1
    assert summary["remaining_price"] == 48

    # The list endpoint surfaces the same split for cards.
    listed = next(x for x in client.get("/api/builds").json() if x["id"] == b)
    assert listed["purchased_count"] == 1
    assert listed["purchased_price"] == 20
