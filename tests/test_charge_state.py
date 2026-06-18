"""Charge-state (charged vs storage) tracking on packs and in fleet stats."""


def _pack(client, name="P"):
    return client.post("/api/packs", json={"name": name, "cell_count": 4}).json()["id"]


def _cycle(client, pid, ctype):
    return client.post("/api/cycles", json={"pack_id": pid, "cycle_type": ctype})


def _metrics(client, pid):
    return next(p for p in client.get("/api/packs").json() if p["id"] == pid)["metrics"]


def test_pack_charge_state_tracks_last_cycle(client):
    pid = _pack(client)
    assert _metrics(client, pid)["charge_state"] == "unknown"

    _cycle(client, pid, "charge")
    assert _metrics(client, pid)["charge_state"] == "charged"

    _cycle(client, pid, "storage")
    assert _metrics(client, pid)["charge_state"] == "storage"


def test_logging_flight_discharges_pack_and_flags_values(client):
    pid = _pack(client)
    _cycle(client, pid, "charge")
    assert _metrics(client, pid)["charge_state"] == "charged"
    assert _metrics(client, pid)["needs_values"] is False

    # Flying the pack records a discharge cycle with blank voltages.
    fid = client.post("/api/flights", json={"pack_id": pid, "duration_sec": 180}).json()["id"]
    assert fid

    cycles = client.get(f"/api/packs/{pid}/cycles").json()
    flight_discharge = [c for c in cycles if c["source"] == "flight"]
    assert len(flight_discharge) == 1
    assert flight_discharge[0]["cycle_type"] == "discharge"
    assert flight_discharge[0]["pack_voltage"] is None
    assert flight_discharge[0]["cell_voltages"] is None

    m = _metrics(client, pid)
    assert m["charge_state"] == "spent"
    assert m["needs_values"] is True


def test_filling_values_clears_needs_values(client):
    pid = _pack(client)
    _cycle(client, pid, "charge")
    client.post("/api/flights", json={"pack_id": pid, "duration_sec": 120})

    cycle_id = next(c["id"] for c in client.get(f"/api/packs/{pid}/cycles").json()
                    if c["source"] == "flight")
    client.patch(f"/api/cycles/{cycle_id}",
                 json={"cell_voltages": [3.7, 3.7, 3.7, 3.7], "pack_voltage": 14.8})

    assert _metrics(client, pid)["needs_values"] is False


def test_stats_charge_buckets(client):
    a = _pack(client, "A"); _cycle(client, a, "charge")
    b = _pack(client, "B"); _cycle(client, b, "storage")
    _pack(client, "C")  # no cycles -> unknown

    charge = client.get("/api/stats").json()["charge"]
    assert charge["charged"] == 1
    assert charge["storage"] == 1
    assert charge["unknown"] == 1
    assert charge["spent"] == 0
