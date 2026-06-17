"""API tests: fleet stats, CSV export/import round-trip, and request validation."""

import io


def test_stats(client, seeded_pack):
    s = client.get("/api/stats").json()
    assert s["total_packs"] == 1
    assert s["total_capacity_mah"] == 1300
    assert s["cycles_30d"] == 2
    assert sum(s["health"].values()) == 1


def test_export_has_bom_and_content(client, seeded_pack):
    res = client.get("/api/export.csv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    text = res.text
    assert text.startswith("﻿")                    # UTF-8 BOM for Excel
    assert "pack_name" in text
    assert "Tattu 1300 #1" in text
    assert "4.18;4.17;4.18;4.16" in text                # semicolon-joined cells


def test_import_roundtrip(client):
    csv_text = (
        "pack_name,brand,cell_count,capacity_mah,chemistry,sticker,max_cycles,"
        "timestamp,cycle_type,pack_voltage,cell_voltages,source,notes\r\n"
        "Nano 850,B,3,850,LiPo,,150,2026-06-16T14:30:00+00:00,discharge,11.1,"
        "3.70;3.71;3.69,manual,first\r\n"
        "Nano 850,B,3,850,LiPo,,150,2026-06-16T15:00:00+00:00,charge,12.6,"
        "4.20;4.19;4.20,manual,second\r\n"
    )
    files = {"file": ("voltlog-export.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    r = client.post("/api/import", files=files).json()
    assert r == {"packs_created": 1, "cycles_added": 2, "skipped": 0}

    packs = client.get("/api/packs").json()
    assert len(packs) == 1
    assert packs[0]["name"] == "Nano 850"
    assert packs[0]["capacity_mah"] == 850
    assert packs[0]["metrics"]["total_logged"] == 2


def test_import_skips_invalid_rows(client):
    csv_text = (
        "pack_name,cell_count,cycle_type\r\n"
        "Good,4,discharge\r\n"
        ",4,discharge\r\n"            # no name -> skipped
        "NoCells,,discharge\r\n"      # no cell count -> skipped
        "BadType,4,explode\r\n"       # invalid cycle_type -> skipped (pack still made)
    )
    files = {"file": ("x.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    r = client.post("/api/import", files=files).json()
    assert r["cycles_added"] == 1
    assert r["skipped"] == 3


def test_import_rejects_missing_header(client):
    files = {"file": ("bad.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")}
    res = client.post("/api/import", files=files)
    assert res.status_code == 400


def test_export_import_full_roundtrip(client, seeded_pack):
    """Export from a seeded DB, re-import the bytes, and confirm it parses."""
    csv_bytes = client.get("/api/export.csv").content
    files = {"file": ("voltlog-export.csv", io.BytesIO(csv_bytes), "text/csv")}
    r = client.post("/api/import", files=files).json()
    # Same pack name already exists -> appends its 2 cycles, creates no new pack.
    assert r["packs_created"] == 0
    assert r["cycles_added"] == 2


import pytest


@pytest.mark.parametrize("body", [
    {"name": "X", "cell_count": 0},                       # below min
    {"name": "X", "cell_count": 99},                      # above max
    {"name": "", "cell_count": 4},                        # empty name
    {"name": "X", "cell_count": 4, "capacity_mah": -5},   # negative capacity
    {"name": "X", "cell_count": 4, "max_cycles": 0},      # non-positive max_cycles
])
def test_pack_validation_rejects(client, body):
    assert client.post("/api/packs", json=body).status_code == 422


@pytest.mark.parametrize("body", [
    {"pack_id": 1, "cycle_type": "bogus"},                          # bad type
    {"pack_id": 1, "cycle_type": "charge", "pack_voltage": -1},     # negative voltage
    {"pack_id": 1, "cycle_type": "charge", "cell_voltages": [6.0]}, # cell out of range
    {"pack_id": 1, "cycle_type": "charge", "cell_voltages": []},    # empty list
])
def test_cycle_validation_rejects(client, body):
    assert client.post("/api/cycles", json=body).status_code == 422


def test_valid_pack_and_cycle_accepted(client):
    pid = client.post("/api/packs", json={"name": "OK", "cell_count": 6}).json()["id"]
    res = client.post("/api/cycles", json={
        "pack_id": pid, "cycle_type": "storage", "pack_voltage": 23.1,
        "cell_voltages": [3.85, 3.85, 3.85, 3.85, 3.85, 3.85],
    })
    assert res.status_code == 200
