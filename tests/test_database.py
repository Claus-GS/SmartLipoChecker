"""Tests for the PRAGMA user_version migration runner."""

import sqlite3

import app.database as db


def _columns(path, table):
    conn = sqlite3.connect(path)
    try:
        return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    finally:
        conn.close()


def _user_version(path):
    conn = sqlite3.connect(path)
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def _tables(path):
    conn = sqlite3.connect(path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def test_fresh_db_fully_migrated(tmp_path, monkeypatch):
    path = str(tmp_path / "fresh.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()

    assert _user_version(path) == db.SCHEMA_VERSION
    cols = _columns(path, "packs")
    assert {"sticker", "max_cycles", "cell_count", "chemistry"} <= set(cols)


def test_ops_tables_created(tmp_path, monkeypatch):
    path = str(tmp_path / "ops.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()
    assert {"quads", "flights", "maintenance"} <= _tables(path)
    assert "battery_cell_count" in _columns(path, "quads")
    assert {"lat", "lng", "weather_wind_mph", "weather_gust_mph", "weather_precip_in"} <= set(_columns(path, "flights"))
    assert db.SCHEMA_VERSION >= 7


def test_build_parts_purchase_columns(tmp_path, monkeypatch):
    path = str(tmp_path / "parts.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()
    assert {"purchased", "purchased_at"} <= set(_columns(path, "build_parts"))
    assert db.SCHEMA_VERSION >= 13


def test_init_is_idempotent(tmp_path, monkeypatch):
    path = str(tmp_path / "idem.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()
    db.init_db()  # second run must be a no-op, not an error
    assert _user_version(path) == db.SCHEMA_VERSION


def test_legacy_db_upgrades_without_error(tmp_path, monkeypatch):
    """A DB at version 0 that already has some added columns must migrate cleanly."""
    path = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE packs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand TEXT,
            cell_count INTEGER NOT NULL,
            capacity_mah INTEGER,
            chemistry TEXT DEFAULT 'LiPo',
            date_added TEXT NOT NULL,
            notes TEXT,
            sticker TEXT          -- already added by the old try/except path
        );
        CREATE TABLE cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pack_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            cycle_type TEXT NOT NULL,
            pack_voltage REAL,
            cell_voltages TEXT,
            source TEXT DEFAULT 'manual',
            notes TEXT
        );
        """
    )
    conn.commit()
    conn.close()
    assert _user_version(path) == 0
    assert "max_cycles" not in _columns(path, "packs")

    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db()  # must not raise "duplicate column: sticker"

    assert _user_version(path) == db.SCHEMA_VERSION
    assert "max_cycles" in _columns(path, "packs")
