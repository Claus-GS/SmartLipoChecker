"""SQLite setup and connection helper for the LiPo tracker."""

import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lipo_tracker.db"
)

@contextmanager
def get_db():
    """Yield a SQLite connection with row access by column name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _column_exists(conn, table, column):
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]
    return column in cols


# Ordered schema migrations. Each runs once, gated by PRAGMA user_version, so a
# fresh database gets every step and an existing one only gets what it's missing.
# Steps must be idempotent (guard column adds) so legacy DBs created by the old
# try/except ALTER path migrate cleanly. Append new steps; never edit old ones.

def _m1_initial(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS packs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            brand TEXT,
            cell_count INTEGER NOT NULL,
            capacity_mah INTEGER,
            chemistry TEXT DEFAULT 'LiPo',
            date_added TEXT NOT NULL,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pack_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            cycle_type TEXT NOT NULL,
            pack_voltage REAL,
            cell_voltages TEXT,
            source TEXT DEFAULT 'manual',
            notes TEXT,
            FOREIGN KEY (pack_id) REFERENCES packs (id) ON DELETE CASCADE
        );
        """
    )


def _m2_add_sticker(conn):
    if not _column_exists(conn, "packs", "sticker"):
        conn.execute("ALTER TABLE packs ADD COLUMN sticker TEXT")


def _m3_add_max_cycles(conn):
    if not _column_exists(conn, "packs", "max_cycles"):
        conn.execute("ALTER TABLE packs ADD COLUMN max_cycles INTEGER")


def _m4_quads(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            class TEXT,
            frame TEXT,
            fc TEXT,
            vtx TEXT,
            motors TEXT,
            prop TEXT,
            weight_g INTEGER,
            status TEXT DEFAULT 'active',
            date_added TEXT NOT NULL,
            notes TEXT
        );
        """
    )


def _m5_flights(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS flights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quad_id INTEGER REFERENCES quads (id) ON DELETE SET NULL,
            pack_id INTEGER REFERENCES packs (id) ON DELETE SET NULL,
            timestamp TEXT NOT NULL,
            duration_sec INTEGER,
            location TEXT,
            notes TEXT,
            created_at TEXT NOT NULL
        );
        """
    )


def _m6_maintenance(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS maintenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quad_id INTEGER REFERENCES quads (id) ON DELETE CASCADE,
            flight_id INTEGER REFERENCES flights (id) ON DELETE SET NULL,
            date TEXT NOT NULL,
            type TEXT,
            description TEXT,
            status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL
        );
        """
    )


def _m7_quad_battery_cell_count(conn):
    if not _column_exists(conn, "quads", "battery_cell_count"):
        conn.execute("ALTER TABLE quads ADD COLUMN battery_cell_count INTEGER")


def _m8_builds(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS builds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'planned',
            date_added TEXT NOT NULL,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS build_parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            build_id INTEGER NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            category TEXT,
            url TEXT,
            image_url TEXT,
            price REAL,
            position INTEGER DEFAULT 0,
            notes TEXT
        );
        """
    )


def _m9_build_cover(conn):
    if not _column_exists(conn, "builds", "cover_image"):
        conn.execute("ALTER TABLE builds ADD COLUMN cover_image TEXT")


def _m10_quad_image(conn):
    if not _column_exists(conn, "quads", "image_url"):
        conn.execute("ALTER TABLE quads ADD COLUMN image_url TEXT")


def _m11_flight_coords(conn):
    # Map-picked flight location: keep the existing free-text `location` as the
    # human label and store the picked point separately so flights can be plotted.
    if not _column_exists(conn, "flights", "lat"):
        conn.execute("ALTER TABLE flights ADD COLUMN lat REAL")
    if not _column_exists(conn, "flights", "lng"):
        conn.execute("ALTER TABLE flights ADD COLUMN lng REAL")


def _m12_flight_weather(conn):
    # Weather is stored as a point-in-time snapshot from the session logger.
    # Values are optional so manual/backfilled flights can stay lightweight.
    for column, ddl in (
        ("weather_fetched_at", "TEXT"),
        ("weather_temp_f", "REAL"),
        ("weather_wind_mph", "REAL"),
        ("weather_gust_mph", "REAL"),
        ("weather_precip_in", "REAL"),
        ("weather_code", "INTEGER"),
        ("weather_source", "TEXT"),
    ):
        if not _column_exists(conn, "flights", column):
            conn.execute(f"ALTER TABLE flights ADD COLUMN {column} {ddl}")


def _m13_part_purchased(conn):
    # Per-part purchase tracking so a build splits into "to buy" vs "purchased"
    # and acts as a shopping checklist. purchased_at records when it was ticked.
    if not _column_exists(conn, "build_parts", "purchased"):
        conn.execute("ALTER TABLE build_parts ADD COLUMN purchased INTEGER DEFAULT 0")
    if not _column_exists(conn, "build_parts", "purchased_at"):
        conn.execute("ALTER TABLE build_parts ADD COLUMN purchased_at TEXT")


def _m14_quad_parts(conn):
    # Per-quad shopping list: parts the pilot wants to buy for a given quad.
    # Mirrors build_parts but scoped to a quad and intentionally lighter (no
    # cached product image) — it's a wishlist / buy-later checklist.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS quad_parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quad_id INTEGER NOT NULL REFERENCES quads (id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            category TEXT,
            url TEXT,
            price REAL,
            purchased INTEGER DEFAULT 0,
            purchased_at TEXT,
            position INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT NOT NULL
        );
        """
    )


def _m15_quad_part_image(conn):
    # Product image for shopping-list parts (fetched from a link or uploaded),
    # mirroring build_parts.image_url.
    if not _column_exists(conn, "quad_parts", "image_url"):
        conn.execute("ALTER TABLE quad_parts ADD COLUMN image_url TEXT")


MIGRATIONS = [
    _m1_initial,
    _m2_add_sticker,
    _m3_add_max_cycles,
    _m4_quads,
    _m5_flights,
    _m6_maintenance,
    _m7_quad_battery_cell_count,
    _m8_builds,
    _m9_build_cover,
    _m10_quad_image,
    _m11_flight_coords,
    _m12_flight_weather,
    _m13_part_purchased,
    _m14_quad_parts,
    _m15_quad_part_image,
]
SCHEMA_VERSION = len(MIGRATIONS)


def init_db():
    """Bring the database up to the current schema version.

    Tracks applied migrations with SQLite's PRAGMA user_version (0 on a brand-new
    file). Each pending migration runs in order, then user_version is bumped, all
    in one transaction so a failure can't leave the schema half-applied.
    """
    with get_db() as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for index, migration in enumerate(MIGRATIONS, start=1):
            if version < index:
                migration(conn)
                # user_version doesn't accept bound params; index is our own int.
                conn.execute(f"PRAGMA user_version = {index}")
