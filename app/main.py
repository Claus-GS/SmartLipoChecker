"""FastAPI app for the LiPo tracker: packs, cycles, and health endpoints."""

import csv
import hashlib
import html
import io
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import database as db
from . import health

app = FastAPI(title="Voltlog")

db.init_db()


# ---------- Validation bounds ----------

MAX_CELL_COUNT = 24            # largest pack we'll accept (cells in series)
CELL_VOLTAGE_MAX = 5.0         # well above LiHV full charge (~4.45V), catches typos
PACK_VOLTAGE_MAX = MAX_CELL_COUNT * CELL_VOLTAGE_MAX
CYCLE_TYPES = ("charge", "discharge", "storage")

QUAD_STATUSES = ("active", "down", "retired")
MAINT_STATUSES = ("open", "done")
MAX_FLIGHT_SEC = 24 * 3600     # sanity bound on a single logged flight


def _validate_cell_voltages(v):
    """Reject empty lists, oversized packs, and physically implausible cells."""
    if v is None:
        return v
    if len(v) == 0:
        raise ValueError("cell_voltages cannot be empty; omit the field instead")
    if len(v) > MAX_CELL_COUNT:
        raise ValueError(f"too many cell voltages (max {MAX_CELL_COUNT})")
    for cv in v:
        if not 0 < cv <= CELL_VOLTAGE_MAX:
            raise ValueError(f"cell voltage {cv} out of range (0, {CELL_VOLTAGE_MAX}]")
    return v


# ---------- Request models ----------

class PackCreate(BaseModel):
    name: str = Field(min_length=1)
    brand: Optional[str] = None
    cell_count: int = Field(ge=1, le=MAX_CELL_COUNT)
    capacity_mah: Optional[int] = Field(default=None, gt=0)
    chemistry: str = "LiPo"
    sticker: Optional[str] = None
    max_cycles: Optional[int] = Field(default=None, gt=0)
    notes: Optional[str] = None


class CycleCreate(BaseModel):
    pack_id: int
    cycle_type: str  # "charge", "discharge", or "storage"
    pack_voltage: Optional[float] = Field(default=None, gt=0, le=PACK_VOLTAGE_MAX)
    cell_voltages: Optional[List[float]] = None
    source: str = "manual"
    notes: Optional[str] = None
    timestamp: Optional[str] = None

    @field_validator("cycle_type")
    @classmethod
    def _check_type(cls, v):
        if v not in CYCLE_TYPES:
            raise ValueError(f"cycle_type must be one of {CYCLE_TYPES}")
        return v

    @field_validator("cell_voltages")
    @classmethod
    def _check_cv(cls, v):
        return _validate_cell_voltages(v)


# ---------- Helpers ----------

def _row_to_cycle(row) -> dict:
    c = dict(row)
    c["cell_voltages"] = json.loads(c["cell_voltages"]) if c["cell_voltages"] else None
    return c


def _pack_flight_stats(conn, pack_id) -> dict:
    """Real-world flight usage for a pack, from the flight log."""
    row = conn.execute(
        """SELECT COUNT(*) AS n,
                  COALESCE(SUM(duration_sec), 0) AS secs,
                  MAX(timestamp) AS last
           FROM flights WHERE pack_id = ?""",
        (pack_id,),
    ).fetchone()
    return {
        "flight_count": row["n"],
        "total_flight_sec": row["secs"],
        "last_flown": row["last"],
    }


# ---------- Pack endpoints ----------

@app.post("/api/packs")
def create_pack(pack: PackCreate):
    with db.get_db() as conn:
        cur = conn.execute(
            """INSERT INTO packs
            (name, brand, cell_count, capacity_mah, chemistry, sticker, max_cycles, date_added, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pack.name,
                pack.brand,
                pack.cell_count,
                pack.capacity_mah,
                pack.chemistry,
                pack.sticker,
                pack.max_cycles,
                datetime.now(timezone.utc).isoformat(),
                pack.notes,
            ),
        )
        pack_id = cur.lastrowid
    return {"id": pack_id}


@app.get("/api/packs")
def list_packs():
    with db.get_db() as conn:
        packs = conn.execute("SELECT * FROM packs ORDER BY name COLLATE NOCASE").fetchall()
        result = []
        for p in packs:
            rows = conn.execute(
                "SELECT * FROM cycles WHERE pack_id = ? ORDER BY timestamp",
                (p["id"],),
            ).fetchall()
            cycles = [_row_to_cycle(r) for r in rows]
            metrics = health.compute_metrics(dict(p), cycles)
            metrics.update(_pack_flight_stats(conn, p["id"]))
            result.append({**dict(p), "metrics": metrics})
    return result


@app.get("/api/packs/{pack_id}")
def get_pack(pack_id: int):
    with db.get_db() as conn:
        p = conn.execute("SELECT * FROM packs WHERE id = ?", (pack_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Pack not found")
        return dict(p)


class PackUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    brand: Optional[str] = None
    cell_count: Optional[int] = Field(default=None, ge=1, le=MAX_CELL_COUNT)
    capacity_mah: Optional[int] = Field(default=None, gt=0)
    chemistry: Optional[str] = None
    sticker: Optional[str] = None
    max_cycles: Optional[int] = Field(default=None, gt=0)
    notes: Optional[str] = None


@app.patch("/api/packs/{pack_id}")
def update_pack(pack_id: int, pack: PackUpdate):
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM packs WHERE id = ?", (pack_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Pack not found")

        updates = {k: v for k, v in pack.model_dump(exclude_unset=True).items()}
        if not updates:
            return dict(existing)

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE packs SET {set_clause} WHERE id = ?",
            (*updates.values(), pack_id),
        )
        return dict(conn.execute("SELECT * FROM packs WHERE id = ?", (pack_id,)).fetchone())


@app.delete("/api/packs/{pack_id}")
def delete_pack(pack_id: int):
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM packs WHERE id = ?", (pack_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Pack not found")
        conn.execute("DELETE FROM packs WHERE id = ?", (pack_id,))
    return {"ok": True}


# ---------- Cycle endpoints ----------

@app.post("/api/cycles")
def create_cycle(cycle: CycleCreate):
    if cycle.cycle_type not in ("charge", "discharge", "storage"):
        raise HTTPException(400, "cycle_type must be 'charge', 'discharge', or 'storage'")

    with db.get_db() as conn:
        pack = conn.execute(
            "SELECT id FROM packs WHERE id = ?", (cycle.pack_id,)
        ).fetchone()
        if not pack:
            raise HTTPException(404, "Pack not found")

        timestamp = cycle.timestamp or datetime.now(timezone.utc).isoformat()
        cur = conn.execute(
            """INSERT INTO cycles
            (pack_id, timestamp, cycle_type, pack_voltage, cell_voltages, source, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                cycle.pack_id,
                timestamp,
                cycle.cycle_type,
                cycle.pack_voltage,
                json.dumps(cycle.cell_voltages) if cycle.cell_voltages else None,
                cycle.source,
                cycle.notes,
            ),
        )
        cycle_id = cur.lastrowid
    return {"id": cycle_id}


@app.get("/api/packs/{pack_id}/cycles")
def get_cycles(pack_id: int):
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM cycles WHERE pack_id = ? ORDER BY timestamp",
            (pack_id,),
        ).fetchall()
    return [_row_to_cycle(r) for r in rows]


class CycleUpdate(BaseModel):
    cycle_type: Optional[str] = None
    pack_voltage: Optional[float] = Field(default=None, gt=0, le=PACK_VOLTAGE_MAX)
    cell_voltages: Optional[List[float]] = None
    timestamp: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("cycle_type")
    @classmethod
    def _check_type(cls, v):
        if v is not None and v not in CYCLE_TYPES:
            raise ValueError(f"cycle_type must be one of {CYCLE_TYPES}")
        return v

    @field_validator("cell_voltages")
    @classmethod
    def _check_cv(cls, v):
        return _validate_cell_voltages(v)


@app.get("/api/cycles/{cycle_id}")
def get_cycle(cycle_id: int):
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM cycles WHERE id = ?", (cycle_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Cycle not found")
        return _row_to_cycle(row)


@app.patch("/api/cycles/{cycle_id}")
def update_cycle(cycle_id: int, cycle: CycleUpdate):
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM cycles WHERE id = ?", (cycle_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Cycle not found")

        if cycle.cycle_type and cycle.cycle_type not in ("charge", "discharge", "storage"):
            raise HTTPException(400, "cycle_type must be 'charge', 'discharge', or 'storage'")

        updates = {}
        if cycle.cycle_type is not None:
            updates["cycle_type"] = cycle.cycle_type
        if cycle.pack_voltage is not None:
            updates["pack_voltage"] = cycle.pack_voltage
        if cycle.cell_voltages is not None:
            updates["cell_voltages"] = json.dumps(cycle.cell_voltages)
        if cycle.timestamp is not None:
            updates["timestamp"] = cycle.timestamp
        if cycle.notes is not None:
            updates["notes"] = cycle.notes

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE cycles SET {set_clause} WHERE id = ?",
                (*updates.values(), cycle_id),
            )
        return _row_to_cycle(conn.execute(
            "SELECT * FROM cycles WHERE id = ?", (cycle_id,)
        ).fetchone())


@app.delete("/api/cycles/{cycle_id}")
def delete_cycle(cycle_id: int):
    with db.get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM cycles WHERE id = ?", (cycle_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Cycle not found")
        conn.execute("DELETE FROM cycles WHERE id = ?", (cycle_id,))
    return {"ok": True}


@app.get("/api/packs/{pack_id}/health")
def get_health(pack_id: int):
    with db.get_db() as conn:
        p = conn.execute("SELECT * FROM packs WHERE id = ?", (pack_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Pack not found")
        rows = conn.execute(
            "SELECT * FROM cycles WHERE pack_id = ? ORDER BY timestamp",
            (pack_id,),
        ).fetchall()
        flight_stats = _pack_flight_stats(conn, pack_id)

    cycles = [_row_to_cycle(r) for r in rows]
    metrics = health.compute_metrics(dict(p), cycles)
    metrics.update(flight_stats)
    return {"metrics": metrics}


# ---------- Fleet stats ----------

@app.get("/api/stats")
def fleet_stats():
    """Aggregate dashboard metrics across every pack."""
    health_buckets = {"healthy": 0, "watch": 0, "check": 0, "no data": 0}
    charge_buckets = {"charged": 0, "storage": 0, "spent": 0, "unknown": 0}
    total_capacity = 0
    needs_attention = 0
    retired = 0

    with db.get_db() as conn:
        packs = conn.execute("SELECT * FROM packs").fetchall()
        for p in packs:
            rows = conn.execute(
                "SELECT * FROM cycles WHERE pack_id = ? ORDER BY timestamp",
                (p["id"],),
            ).fetchall()
            cycles = [_row_to_cycle(r) for r in rows]
            m = health.compute_metrics(dict(p), cycles)

            health_buckets[m["status"]] = health_buckets.get(m["status"], 0) + 1
            charge_buckets[m["charge_state"]] = charge_buckets.get(m["charge_state"], 0) + 1
            total_capacity += p["capacity_mah"] or 0
            if p["brand"] == "Retired":
                retired += 1
            if (
                m["storage_warning"]
                or m["retirement_warning"]
                or (m["last_used_days"] is not None and m["last_used_days"] > health.LAST_USED_STALE_DAYS)
            ):
                needs_attention += 1

        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        cycles_30d = conn.execute(
            "SELECT COUNT(*) AS n FROM cycles WHERE timestamp >= ?", (cutoff,)
        ).fetchone()["n"]

        # Ops aggregates (quads / flights / maintenance).
        quad_count = conn.execute("SELECT COUNT(*) AS n FROM quads").fetchone()["n"]
        flights_30d = conn.execute(
            "SELECT COUNT(*) AS n FROM flights WHERE timestamp >= ?", (cutoff,)
        ).fetchone()["n"]
        total_flight_sec = conn.execute(
            "SELECT COALESCE(SUM(duration_sec), 0) AS s FROM flights"
        ).fetchone()["s"]
        open_maintenance = conn.execute(
            "SELECT COUNT(*) AS n FROM maintenance WHERE status = 'open'"
        ).fetchone()["n"]

    return {
        "total_packs": len(packs),
        "total_capacity_mah": total_capacity,
        "health": health_buckets,
        "charge": charge_buckets,
        "needs_attention": needs_attention,
        "cycles_30d": cycles_30d,
        "retired": retired,
        "quad_count": quad_count,
        "flights_30d": flights_30d,
        "total_flight_sec": total_flight_sec,
        "open_maintenance": open_maintenance,
    }


# ---------- CSV export / import ----------

EXPORT_COLUMNS = [
    "pack_id", "pack_name", "brand", "cell_count", "capacity_mah", "chemistry",
    "sticker", "max_cycles", "timestamp", "cycle_type", "pack_voltage",
    "cell_voltages", "source", "notes",
]


@app.get("/api/export.csv")
def export_csv():
    """Export every cycle joined to its pack as a single CSV file."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(EXPORT_COLUMNS)

    with db.get_db() as conn:
        rows = conn.execute(
            """SELECT c.timestamp, c.cycle_type, c.pack_voltage, c.cell_voltages,
                      c.source, c.notes,
                      p.id AS pack_id, p.name AS pack_name, p.brand, p.cell_count,
                      p.capacity_mah, p.chemistry, p.sticker, p.max_cycles
               FROM cycles c JOIN packs p ON p.id = c.pack_id
               ORDER BY p.name COLLATE NOCASE, c.timestamp""",
        ).fetchall()

    for r in rows:
        cell_voltages = ""
        if r["cell_voltages"]:
            cell_voltages = ";".join(str(v) for v in json.loads(r["cell_voltages"]))
        writer.writerow([
            r["pack_id"], r["pack_name"], r["brand"], r["cell_count"],
            r["capacity_mah"], r["chemistry"], r["sticker"], r["max_cycles"],
            r["timestamp"], r["cycle_type"], r["pack_voltage"], cell_voltages,
            r["source"], r["notes"],
        ])

    # Prepend a UTF-8 BOM so spreadsheet apps (Excel) detect the encoding and
    # don't mangle non-ASCII notes into mojibake. /api/import reads utf-8-sig,
    # so the BOM round-trips cleanly back in.
    return Response(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="voltlog-export.csv"'},
    )


def _parse_float(val):
    try:
        return float(val) if val not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _parse_int(val):
    try:
        return int(val) if val not in (None, "") else None
    except (TypeError, ValueError):
        return None


@app.post("/api/import")
async def import_csv(file: UploadFile = File(...)):
    """Import packs and cycles from a CSV produced by /api/export.csv.

    Packs are matched by name (find-or-create); their cycles are appended.
    The whole import runs in one transaction so a bad file can't half-apply.
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded CSV")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "pack_name" not in reader.fieldnames:
        raise HTTPException(400, "CSV must include a 'pack_name' column")

    packs_created = 0
    cycles_added = 0
    skipped = 0
    name_to_id: dict = {}

    with db.get_db() as conn:
        for row in reader:
            name = (row.get("pack_name") or "").strip()
            cell_count = _parse_int(row.get("cell_count"))
            if not name or not cell_count:
                skipped += 1
                continue

            pack_id = name_to_id.get(name)
            if pack_id is None:
                existing = conn.execute(
                    "SELECT id FROM packs WHERE name = ?", (name,)
                ).fetchone()
                if existing:
                    pack_id = existing["id"]
                else:
                    cur = conn.execute(
                        """INSERT INTO packs
                        (name, brand, cell_count, capacity_mah, chemistry, sticker, max_cycles, date_added, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            name,
                            row.get("brand") or None,
                            cell_count,
                            _parse_int(row.get("capacity_mah")),
                            row.get("chemistry") or "LiPo",
                            row.get("sticker") or None,
                            _parse_int(row.get("max_cycles")),
                            datetime.now(timezone.utc).isoformat(),
                            None,
                        ),
                    )
                    pack_id = cur.lastrowid
                    packs_created += 1
                name_to_id[name] = pack_id

            cycle_type = (row.get("cycle_type") or "").strip()
            if cycle_type not in ("charge", "discharge", "storage"):
                skipped += 1
                continue

            cell_voltages = None
            cv_raw = (row.get("cell_voltages") or "").strip()
            if cv_raw:
                parsed = [_parse_float(v) for v in cv_raw.split(";")]
                parsed = [v for v in parsed if v is not None]
                if parsed:
                    cell_voltages = json.dumps(parsed)

            conn.execute(
                """INSERT INTO cycles
                (pack_id, timestamp, cycle_type, pack_voltage, cell_voltages, source, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    pack_id,
                    (row.get("timestamp") or datetime.now(timezone.utc).isoformat()),
                    cycle_type,
                    _parse_float(row.get("pack_voltage")),
                    cell_voltages,
                    row.get("source") or "import",
                    row.get("notes") or None,
                ),
            )
            cycles_added += 1

    return {"packs_created": packs_created, "cycles_added": cycles_added, "skipped": skipped}


# ---------- Quad models ----------

class QuadCreate(BaseModel):
    name: str = Field(min_length=1)
    cls: Optional[str] = Field(default=None, alias="class")
    battery_cell_count: Optional[int] = Field(default=None, ge=1, le=MAX_CELL_COUNT)
    frame: Optional[str] = None
    fc: Optional[str] = None
    vtx: Optional[str] = None
    motors: Optional[str] = None
    prop: Optional[str] = None
    weight_g: Optional[int] = Field(default=None, gt=0)
    status: str = "active"
    notes: Optional[str] = None
    image_url: Optional[str] = None

    model_config = {"populate_by_name": True}

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v not in QUAD_STATUSES:
            raise ValueError(f"status must be one of {QUAD_STATUSES}")
        return v


class QuadUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    cls: Optional[str] = Field(default=None, alias="class")
    battery_cell_count: Optional[int] = Field(default=None, ge=1, le=MAX_CELL_COUNT)
    frame: Optional[str] = None
    fc: Optional[str] = None
    vtx: Optional[str] = None
    motors: Optional[str] = None
    prop: Optional[str] = None
    weight_g: Optional[int] = Field(default=None, gt=0)
    status: Optional[str] = None
    notes: Optional[str] = None
    image_url: Optional[str] = None

    model_config = {"populate_by_name": True}

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in QUAD_STATUSES:
            raise ValueError(f"status must be one of {QUAD_STATUSES}")
        return v


# Map between the API field "class" and the model attribute "cls" (class is a
# Python keyword). Stored column is "class".
def _quad_db_values(model, *, exclude_unset=False):
    data = model.model_dump(exclude_unset=exclude_unset, by_alias=False)
    if "cls" in data:
        data["class"] = data.pop("cls")
    return data


class QuadPartCreate(BaseModel):
    name: str = Field(min_length=1)
    category: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    position: Optional[int] = 0
    notes: Optional[str] = None
    purchased: Optional[bool] = False


class QuadPartUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    category: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    position: Optional[int] = None
    notes: Optional[str] = None
    purchased: Optional[bool] = None


def _quad_parts(conn, quad_id) -> list:
    # Unbought items first, then by manual position / insertion order, so the
    # "still to buy" list stays at the top as a checklist.
    rows = conn.execute(
        "SELECT * FROM quad_parts WHERE quad_id = ? ORDER BY purchased, position, id",
        (quad_id,),
    ).fetchall()
    parts = []
    for r in rows:
        d = dict(r)
        d["purchased"] = bool(d.get("purchased"))  # SQLite stores 0/1
        parts.append(d)
    return parts


def _quad_parts_summary(parts) -> dict:
    total = sum(p["price"] or 0 for p in parts)
    purchased = [p for p in parts if p.get("purchased")]
    purchased_total = sum(p["price"] or 0 for p in purchased)
    return {
        "part_count": len(parts),
        "total_price": total,
        "purchased_count": len(purchased),
        "purchased_price": purchased_total,
        "remaining_count": len(parts) - len(purchased),
        "remaining_price": total - purchased_total,
    }


# ---------- Quad endpoints ----------

@app.post("/api/quads")
def create_quad(quad: QuadCreate):
    vals = _quad_db_values(quad)
    vals["image_url"] = _cache_image(vals.get("image_url"))
    with db.get_db() as conn:
        cur = conn.execute(
            """INSERT INTO quads
            (name, class, battery_cell_count, frame, fc, vtx, motors, prop, weight_g, status, date_added, notes, image_url)
            VALUES (:name, :class, :battery_cell_count, :frame, :fc, :vtx, :motors, :prop, :weight_g, :status, :date_added, :notes, :image_url)""",
            {**vals, "date_added": datetime.now(timezone.utc).isoformat()},
        )
        quad_id = cur.lastrowid
    return {"id": quad_id}


def _quad_stats(conn, quad_id) -> dict:
    f = conn.execute(
        """SELECT COUNT(*) AS n, COALESCE(SUM(duration_sec), 0) AS secs, MAX(timestamp) AS last
           FROM flights WHERE quad_id = ?""",
        (quad_id,),
    ).fetchone()
    open_m = conn.execute(
        "SELECT COUNT(*) AS n FROM maintenance WHERE quad_id = ? AND status = 'open'",
        (quad_id,),
    ).fetchone()["n"]
    return {
        "flight_count": f["n"],
        "total_flight_sec": f["secs"],
        "last_flown": f["last"],
        "open_maintenance": open_m,
    }


@app.get("/api/quads")
def list_quads():
    with db.get_db() as conn:
        quads = conn.execute("SELECT * FROM quads ORDER BY name COLLATE NOCASE").fetchall()
        return [{**dict(q), "stats": _quad_stats(conn, q["id"])} for q in quads]


@app.get("/api/quads/{quad_id}")
def get_quad(quad_id: int):
    with db.get_db() as conn:
        q = conn.execute("SELECT * FROM quads WHERE id = ?", (quad_id,)).fetchone()
        if not q:
            raise HTTPException(404, "Quad not found")
        return {**dict(q), "stats": _quad_stats(conn, quad_id)}


@app.patch("/api/quads/{quad_id}")
def update_quad(quad_id: int, quad: QuadUpdate):
    updates = _quad_db_values(quad, exclude_unset=True)
    if updates.get("image_url"):
        updates["image_url"] = _cache_image(updates["image_url"])
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM quads WHERE id = ?", (quad_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Quad not found")
        if updates:
            set_clause = ", ".join(f'"{k}" = :{k}' for k in updates)
            conn.execute(
                f"UPDATE quads SET {set_clause} WHERE id = :_id",
                {**updates, "_id": quad_id},
            )
        return dict(conn.execute("SELECT * FROM quads WHERE id = ?", (quad_id,)).fetchone())


@app.delete("/api/quads/{quad_id}")
def delete_quad(quad_id: int):
    with db.get_db() as conn:
        existing = conn.execute("SELECT id FROM quads WHERE id = ?", (quad_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Quad not found")
        conn.execute("DELETE FROM quads WHERE id = ?", (quad_id,))
    return {"ok": True}


# ---------- Quad part (shopping list) endpoints ----------

@app.get("/api/quads/{quad_id}/parts")
def list_quad_parts(quad_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM quads WHERE id = ?", (quad_id,)).fetchone():
            raise HTTPException(404, "Quad not found")
        parts = _quad_parts(conn, quad_id)
        return {"parts": parts, **_quad_parts_summary(parts)}


@app.post("/api/quads/{quad_id}/parts")
def create_quad_part(quad_id: int, part: QuadPartCreate):
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM quads WHERE id = ?", (quad_id,)).fetchone():
            raise HTTPException(404, "Quad not found")
        image = _cache_image(part.image_url)  # host product images locally
        purchased = 1 if part.purchased else 0
        purchased_at = datetime.now(timezone.utc).isoformat() if purchased else None
        cur = conn.execute(
            """INSERT INTO quad_parts
            (quad_id, name, category, url, image_url, price, position, notes,
             purchased, purchased_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                quad_id, part.name, part.category, part.url, image, part.price,
                part.position or 0, part.notes, purchased, purchased_at,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        return {"id": cur.lastrowid}


@app.patch("/api/quad-parts/{part_id}")
def update_quad_part(part_id: int, part: QuadPartUpdate):
    updates = part.model_dump(exclude_unset=True)
    if updates.get("image_url"):
        updates["image_url"] = _cache_image(updates["image_url"])
    if "purchased" in updates:
        # Toggling purchased also stamps (or clears) when it was bought.
        bought = bool(updates["purchased"])
        updates["purchased"] = 1 if bought else 0
        updates["purchased_at"] = datetime.now(timezone.utc).isoformat() if bought else None
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM quad_parts WHERE id = ?", (part_id,)).fetchone():
            raise HTTPException(404, "Part not found")
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(
                f"UPDATE quad_parts SET {set_clause} WHERE id = :_id",
                {**updates, "_id": part_id},
            )
        row = dict(conn.execute("SELECT * FROM quad_parts WHERE id = ?", (part_id,)).fetchone())
        row["purchased"] = bool(row.get("purchased"))
        return row


@app.delete("/api/quad-parts/{part_id}")
def delete_quad_part(part_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM quad_parts WHERE id = ?", (part_id,)).fetchone():
            raise HTTPException(404, "Part not found")
        conn.execute("DELETE FROM quad_parts WHERE id = ?", (part_id,))
    return {"ok": True}


# ---------- Flight models ----------

class FlightCreate(BaseModel):
    quad_id: Optional[int] = None
    pack_id: Optional[int] = None
    timestamp: Optional[str] = None
    duration_sec: int = Field(gt=0, le=MAX_FLIGHT_SEC)
    location: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    weather_fetched_at: Optional[str] = None
    weather_temp_f: Optional[float] = None
    weather_wind_mph: Optional[float] = Field(default=None, ge=0)
    weather_gust_mph: Optional[float] = Field(default=None, ge=0)
    weather_precip_in: Optional[float] = Field(default=None, ge=0)
    weather_code: Optional[int] = None
    weather_source: Optional[str] = None
    notes: Optional[str] = None


class FlightUpdate(BaseModel):
    quad_id: Optional[int] = None
    pack_id: Optional[int] = None
    timestamp: Optional[str] = None
    duration_sec: Optional[int] = Field(default=None, gt=0, le=MAX_FLIGHT_SEC)
    location: Optional[str] = None
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    weather_fetched_at: Optional[str] = None
    weather_temp_f: Optional[float] = None
    weather_wind_mph: Optional[float] = Field(default=None, ge=0)
    weather_gust_mph: Optional[float] = Field(default=None, ge=0)
    weather_precip_in: Optional[float] = Field(default=None, ge=0)
    weather_code: Optional[int] = None
    weather_source: Optional[str] = None
    notes: Optional[str] = None


def _flight_row(conn, flight_id):
    return conn.execute(
        """SELECT f.*, q.name AS quad_name, p.name AS pack_name
           FROM flights f
           LEFT JOIN quads q ON q.id = f.quad_id
           LEFT JOIN packs p ON p.id = f.pack_id
           WHERE f.id = ?""",
        (flight_id,),
    ).fetchone()


def _require(conn, table, row_id, label):
    if row_id is not None and not conn.execute(
        f"SELECT 1 FROM {table} WHERE id = ?", (row_id,)
    ).fetchone():
        raise HTTPException(404, f"{label} not found")


# ---------- Flight endpoints ----------

@app.post("/api/flights")
def create_flight(flight: FlightCreate):
    with db.get_db() as conn:
        _require(conn, "quads", flight.quad_id, "Quad")
        _require(conn, "packs", flight.pack_id, "Pack")
        timestamp = flight.timestamp or datetime.now(timezone.utc).isoformat()
        cur = conn.execute(
            """INSERT INTO flights
            (quad_id, pack_id, timestamp, duration_sec, location, lat, lng,
             weather_fetched_at, weather_temp_f, weather_wind_mph, weather_gust_mph,
             weather_precip_in, weather_code, weather_source, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                flight.quad_id,
                flight.pack_id,
                timestamp,
                flight.duration_sec,
                flight.location,
                flight.lat,
                flight.lng,
                flight.weather_fetched_at,
                flight.weather_temp_f,
                flight.weather_wind_mph,
                flight.weather_gust_mph,
                flight.weather_precip_in,
                flight.weather_code,
                flight.weather_source,
                flight.notes,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        flight_id = cur.lastrowid

        # Flying a pack discharges it, so record a matching discharge cycle with
        # the voltages left blank. This flips the pack's charge_state to "spent"
        # and raises its "needs_values" flag, prompting the pilot to fill in the
        # resting voltages from the session page afterward.
        if flight.pack_id is not None:
            conn.execute(
                """INSERT INTO cycles
                (pack_id, timestamp, cycle_type, pack_voltage, cell_voltages, source, notes)
                VALUES (?, ?, 'discharge', NULL, NULL, 'flight', NULL)""",
                (flight.pack_id, timestamp),
            )
    return {"id": flight_id}


@app.get("/api/flights")
def list_flights(quad_id: Optional[int] = None, pack_id: Optional[int] = None,
                 limit: Optional[int] = None):
    clauses, params = [], []
    if quad_id is not None:
        clauses.append("f.quad_id = ?"); params.append(quad_id)
    if pack_id is not None:
        clauses.append("f.pack_id = ?"); params.append(pack_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        """SELECT f.*, q.name AS quad_name, p.name AS pack_name
           FROM flights f
           LEFT JOIN quads q ON q.id = f.quad_id
           LEFT JOIN packs p ON p.id = f.pack_id"""
        + where + " ORDER BY f.timestamp DESC"
    )
    if limit is not None:
        sql += " LIMIT ?"; params.append(limit)
    with db.get_db() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


@app.get("/api/flights/{flight_id}")
def get_flight(flight_id: int):
    with db.get_db() as conn:
        row = _flight_row(conn, flight_id)
        if not row:
            raise HTTPException(404, "Flight not found")
        return dict(row)


@app.patch("/api/flights/{flight_id}")
def update_flight(flight_id: int, flight: FlightUpdate):
    updates = flight.model_dump(exclude_unset=True)
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM flights WHERE id = ?", (flight_id,)).fetchone():
            raise HTTPException(404, "Flight not found")
        if "quad_id" in updates:
            _require(conn, "quads", updates["quad_id"], "Quad")
        if "pack_id" in updates:
            _require(conn, "packs", updates["pack_id"], "Pack")
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(
                f"UPDATE flights SET {set_clause} WHERE id = :_id",
                {**updates, "_id": flight_id},
            )
        return dict(_flight_row(conn, flight_id))


@app.delete("/api/flights/{flight_id}")
def delete_flight(flight_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM flights WHERE id = ?", (flight_id,)).fetchone():
            raise HTTPException(404, "Flight not found")
        conn.execute("DELETE FROM flights WHERE id = ?", (flight_id,))
    return {"ok": True}


# ---------- Maintenance models ----------

class MaintenanceCreate(BaseModel):
    quad_id: int
    flight_id: Optional[int] = None
    date: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    status: str = "open"

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v not in MAINT_STATUSES:
            raise ValueError(f"status must be one of {MAINT_STATUSES}")
        return v


class MaintenanceUpdate(BaseModel):
    flight_id: Optional[int] = None
    date: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in MAINT_STATUSES:
            raise ValueError(f"status must be one of {MAINT_STATUSES}")
        return v


# ---------- Maintenance endpoints ----------

@app.post("/api/maintenance")
def create_maintenance(item: MaintenanceCreate):
    with db.get_db() as conn:
        _require(conn, "quads", item.quad_id, "Quad")
        _require(conn, "flights", item.flight_id, "Flight")
        cur = conn.execute(
            """INSERT INTO maintenance
            (quad_id, flight_id, date, type, description, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                item.quad_id,
                item.flight_id,
                item.date or datetime.now(timezone.utc).isoformat(),
                item.type,
                item.description,
                item.status,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        maint_id = cur.lastrowid
    return {"id": maint_id}


@app.get("/api/maintenance")
def list_maintenance(quad_id: Optional[int] = None, status: Optional[str] = None):
    clauses, params = [], []
    if quad_id is not None:
        clauses.append("m.quad_id = ?"); params.append(quad_id)
    if status is not None:
        clauses.append("m.status = ?"); params.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = (
        "SELECT m.*, q.name AS quad_name FROM maintenance m "
        "LEFT JOIN quads q ON q.id = m.quad_id" + where + " ORDER BY m.date DESC"
    )
    with db.get_db() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


@app.patch("/api/maintenance/{maint_id}")
def update_maintenance(maint_id: int, item: MaintenanceUpdate):
    updates = item.model_dump(exclude_unset=True)
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM maintenance WHERE id = ?", (maint_id,)).fetchone():
            raise HTTPException(404, "Maintenance item not found")
        if "flight_id" in updates:
            _require(conn, "flights", updates["flight_id"], "Flight")
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(
                f"UPDATE maintenance SET {set_clause} WHERE id = :_id",
                {**updates, "_id": maint_id},
            )
        return dict(conn.execute("SELECT * FROM maintenance WHERE id = ?", (maint_id,)).fetchone())


@app.delete("/api/maintenance/{maint_id}")
def delete_maintenance(maint_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM maintenance WHERE id = ?", (maint_id,)).fetchone():
            raise HTTPException(404, "Maintenance item not found")
        conn.execute("DELETE FROM maintenance WHERE id = ?", (maint_id,))
    return {"ok": True}


# ---------- Build models ----------

BUILD_STATUSES = ("planned", "building", "active", "retired")


class BuildCreate(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = None
    status: str = "planned"
    notes: Optional[str] = None
    cover_image: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v not in BUILD_STATUSES:
            raise ValueError(f"status must be one of {BUILD_STATUSES}")
        return v


class BuildUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    cover_image: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in BUILD_STATUSES:
            raise ValueError(f"status must be one of {BUILD_STATUSES}")
        return v


class PartCreate(BaseModel):
    build_id: int
    name: str = Field(min_length=1)
    category: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    position: Optional[int] = 0
    notes: Optional[str] = None
    purchased: Optional[bool] = False


class PartUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    category: Optional[str] = None
    url: Optional[str] = None
    image_url: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    position: Optional[int] = None
    notes: Optional[str] = None
    purchased: Optional[bool] = None


# ---------- Build endpoints ----------

def _build_parts(conn, build_id) -> list:
    rows = conn.execute(
        "SELECT * FROM build_parts WHERE build_id = ? ORDER BY position, id",
        (build_id,),
    ).fetchall()
    parts = []
    for r in rows:
        d = dict(r)
        d["purchased"] = bool(d.get("purchased"))  # SQLite stores 0/1
        parts.append(d)
    return parts


def _build_summary(parts, own_cover=None) -> dict:
    """Part counts/costs and a cover image, split by purchase status.

    Cover precedence: the build's own cover_image if set, else the first part
    that has a picture (the original fall-back behaviour)."""
    cover = own_cover or next((p["image_url"] for p in parts if p["image_url"]), None)
    total = sum(p["price"] or 0 for p in parts)
    purchased = [p for p in parts if p.get("purchased")]
    purchased_total = sum(p["price"] or 0 for p in purchased)
    return {
        "part_count": len(parts),
        "cover_image": cover,
        "total_price": total,
        "purchased_count": len(purchased),
        "purchased_price": purchased_total,
        "remaining_count": len(parts) - len(purchased),
        "remaining_price": total - purchased_total,
    }


@app.post("/api/builds")
def create_build(build: BuildCreate):
    with db.get_db() as conn:
        cover = _cache_image(build.cover_image)
        cur = conn.execute(
            "INSERT INTO builds (name, description, status, cover_image, date_added, notes) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                build.name,
                build.description,
                build.status,
                cover,
                datetime.now(timezone.utc).isoformat(),
                build.notes,
            ),
        )
        return {"id": cur.lastrowid}


@app.get("/api/builds")
def list_builds():
    with db.get_db() as conn:
        builds = conn.execute("SELECT * FROM builds ORDER BY date_added DESC").fetchall()
        return [
            {**dict(b), **_build_summary(_build_parts(conn, b["id"]), b["cover_image"])}
            for b in builds
        ]


@app.get("/api/builds/{build_id}")
def get_build(build_id: int):
    with db.get_db() as conn:
        b = conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        if not b:
            raise HTTPException(404, "Build not found")
        parts = _build_parts(conn, build_id)
        return {**dict(b), "parts": parts, "own_cover": b["cover_image"],
                **_build_summary(parts, b["cover_image"])}


@app.patch("/api/builds/{build_id}")
def update_build(build_id: int, build: BuildUpdate):
    updates = build.model_dump(exclude_unset=True)
    if updates.get("cover_image"):
        updates["cover_image"] = _cache_image(updates["cover_image"])
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM builds WHERE id = ?", (build_id,)).fetchone():
            raise HTTPException(404, "Build not found")
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(
                f"UPDATE builds SET {set_clause} WHERE id = :_id",
                {**updates, "_id": build_id},
            )
        return dict(conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone())


@app.delete("/api/builds/{build_id}")
def delete_build(build_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM builds WHERE id = ?", (build_id,)).fetchone():
            raise HTTPException(404, "Build not found")
        conn.execute("DELETE FROM builds WHERE id = ?", (build_id,))
    return {"ok": True}


# ---------- Build part endpoints ----------

@app.post("/api/parts")
def create_part(part: PartCreate):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM builds WHERE id = ?", (part.build_id,)).fetchone():
            raise HTTPException(404, "Build not found")
        image = _cache_image(part.image_url)  # host product images locally
        purchased = 1 if part.purchased else 0
        purchased_at = datetime.now(timezone.utc).isoformat() if purchased else None
        cur = conn.execute(
            """INSERT INTO build_parts
            (build_id, name, category, url, image_url, price, position, notes,
             purchased, purchased_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                part.build_id, part.name, part.category, part.url,
                image, part.price, part.position or 0, part.notes,
                purchased, purchased_at,
            ),
        )
        return {"id": cur.lastrowid}


@app.get("/api/builds/{build_id}/parts")
def list_parts(build_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM builds WHERE id = ?", (build_id,)).fetchone():
            raise HTTPException(404, "Build not found")
        return _build_parts(conn, build_id)


@app.patch("/api/parts/{part_id}")
def update_part(part_id: int, part: PartUpdate):
    updates = part.model_dump(exclude_unset=True)
    if updates.get("image_url"):
        updates["image_url"] = _cache_image(updates["image_url"])
    if "purchased" in updates:
        # Toggling purchased also stamps (or clears) when it was bought.
        bought = bool(updates["purchased"])
        updates["purchased"] = 1 if bought else 0
        updates["purchased_at"] = datetime.now(timezone.utc).isoformat() if bought else None
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM build_parts WHERE id = ?", (part_id,)).fetchone():
            raise HTTPException(404, "Part not found")
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            conn.execute(
                f"UPDATE build_parts SET {set_clause} WHERE id = :_id",
                {**updates, "_id": part_id},
            )
        row = dict(conn.execute("SELECT * FROM build_parts WHERE id = ?", (part_id,)).fetchone())
        row["purchased"] = bool(row.get("purchased"))
        return row


@app.delete("/api/parts/{part_id}")
def delete_part(part_id: int):
    with db.get_db() as conn:
        if not conn.execute("SELECT id FROM build_parts WHERE id = ?", (part_id,)).fetchone():
            raise HTTPException(404, "Part not found")
        conn.execute("DELETE FROM build_parts WHERE id = ?", (part_id,))
    return {"ok": True}


# ---------- Link preview + local product-image caching ----------

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
IMAGE_EXTS = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
}
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _meta_content(text, prop):
    """Pull a <meta property|name="prop" content="..."> value, attr order agnostic."""
    for pat in (
        rf'<meta[^>]+?(?:property|name)=["\']{re.escape(prop)}["\'][^>]+?content=["\']([^"\']*)["\']',
        rf'<meta[^>]+?content=["\']([^"\']*)["\'][^>]+?(?:property|name)=["\']{re.escape(prop)}["\']',
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m and m.group(1).strip():
            return html.unescape(m.group(1).strip())
    return None


# Image fields used by shops that render product data in JS (so their OG/meta
# tags come back empty) — e.g. AliExpress' window.runParams. Value may be a
# single URL or the first item of a list, and may use escaped "\/" slashes.
_JSON_IMAGE_KEYS = (
    "imagePathList", "imageUrl", "mainImageUrl", "mainImage", "imgUrl",
    "primaryImage", "hdThumbImage", "image",
)


def _clean_json_url(raw):
    """Normalize a URL pulled from embedded JSON (unescape slashes, add scheme)."""
    u = html.unescape(raw).replace("\\/", "/").strip()
    if u.startswith("//"):
        u = "https:" + u
    return u


def _extract_image(text):
    """Find a representative product image from page HTML, trying many conventions."""
    for prop in ("og:image:secure_url", "og:image:url", "og:image",
                 "twitter:image:src", "twitter:image"):
        v = _meta_content(text, prop)
        if v:
            return v
    for pat in (
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']image_src["\']',
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return html.unescape(m.group(1).strip())
    # Embedded JSON image fields (AliExpress and other JS-rendered shops). Accept
    # a bare string value or the first element of a list. URLs may use escaped
    # "\/" slashes throughout, so capture up to the closing quote and clean after.
    url_val = r'((?:https?:)?(?:\\?/){2}[^"]+?)'
    for key in _JSON_IMAGE_KEYS:
        m = (re.search(rf'"{key}"\s*:\s*"{url_val}"', text)
             or re.search(rf'"{key}"\s*:\s*\[\s*"{url_val}"', text))
        if m:
            return _clean_json_url(m.group(1))
    # Last resort: first product-looking image on a known shop CDN. AliExpress
    # serves product photos from the /kf/ path; skip tiny sprite/icon dimensions.
    for mm in re.finditer(
        r'(?:https?:)?\\?/\\?/ae\d{2}\.alicdn\.com/kf/[^\s"\'<>\\]+?'
        r'\.(?:jpg|jpeg|png|webp)', text, re.IGNORECASE):
        if not re.search(r'/\d{1,3}x\d{1,3}\.\w+$', mm.group(0)):
            return _clean_json_url(mm.group(0))
    return None


def _extract_price(text):
    """Best-effort price from OG/product meta tags or JSON-LD."""
    for prop in ("product:price:amount", "og:price:amount"):
        v = _meta_content(text, prop)
        if v:
            try:
                return round(float(re.sub(r"[^0-9.]", "", v)), 2)
            except ValueError:
                pass
    m = re.search(r'"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?', text)
    if m:
        try:
            return round(float(m.group(1)), 2)
        except ValueError:
            pass
    return None


def _cache_image(url):
    """Download a remote image into /static/uploads and return its local path.

    Serving images from our own origin makes them display reliably (lots of shops
    block hot-linking) and keeps them even if the source link later rots. Any
    failure falls back to the original URL so the user still sees something.
    """
    if not url or not url.lower().startswith(("http://", "https://")):
        return url  # already local, or empty
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": _BROWSER_UA,
                     "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            ctype = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
            ext = IMAGE_EXTS.get(ctype)
            if not ext:
                guess = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
                ext = guess if guess in set(IMAGE_EXTS.values()) else None
            if not ext:
                return url
            data = resp.read(8_000_000)
        if not data:
            return url
        name = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + ext
        path = os.path.join(UPLOAD_DIR, name)
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(data)
        return f"/static/uploads/{name}"
    except Exception:
        return url


# Pasted shop links often carry a long tracking query string. AliExpress in
# particular serves a 404 page when its spm/pdp_ext_f blob is present, so the
# preview comes back empty. Reduce such links to the canonical bare item URL.
_ALI_ITEM_RE = re.compile(r"^/(?:item|i)/(\d+)\.html", re.IGNORECASE)


def _canonical_url(url):
    """Strip tracking params from links that misbehave with them (AliExpress)."""
    try:
        p = urllib.parse.urlparse(url)
    except ValueError:
        return url
    if "aliexpress." in (p.netloc or "").lower():
        m = _ALI_ITEM_RE.match(p.path or "")
        if m:
            return f"{p.scheme}://{p.netloc}/item/{m.group(1)}.html"
    return url


@app.get("/api/link-preview")
def link_preview(url: str):
    """Fetch a product page and return a locally-cached image, title, and price.

    Best-effort: shops that block bots or render via JS may yield nothing, in
    which case the user uploads a photo or pastes an image URL by hand.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(400, "Provide a full http(s) URL")
    url = _canonical_url(url)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=9) as resp:
            if "html" not in resp.headers.get("Content-Type", "").lower():
                return {"image": None, "title": None, "price": None}
            raw = resp.read(1_500_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
    except Exception:
        return {"image": None, "title": None, "price": None}

    # Anti-bot wall (e.g. AliExpress' tiny "punish"/captcha page served when the
    # server's IP is rate-limited). Flag it so the UI can say "try later / upload"
    # instead of a vague "couldn't read an image".
    if len(text) < 6000 and re.search(r"punish|captcha|slidetounlock|_____tmd_____",
                                       text, re.IGNORECASE):
        return {"image": None, "title": None, "price": None, "blocked": True}

    image = _extract_image(text)
    if image:
        image = urllib.parse.urljoin(url, image)   # resolve relative/protocol-relative
        image = _cache_image(image)                # host it locally so it always renders
    title = _meta_content(text, "og:title") or _meta_content(text, "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
        if m:
            title = html.unescape(re.sub(r"\s+", " ", m.group(1)).strip())
    return {"image": image, "title": title, "price": _extract_price(text)}


@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """Store a user-uploaded image under /static/uploads and return its URL."""
    ctype = (file.content_type or "").lower()
    ext = IMAGE_EXTS.get(ctype) or os.path.splitext(file.filename or "")[1].lower()
    if ext == ".jpeg":
        ext = ".jpg"
    if ext not in set(IMAGE_EXTS.values()):
        raise HTTPException(400, "Unsupported image type (use JPG, PNG, WebP, GIF, or AVIF)")
    data = await file.read()
    if len(data) > 8_000_000:
        raise HTTPException(400, "Image too large (max 8 MB)")
    name = hashlib.sha1(data).hexdigest()[:16] + ext
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(data)
    return {"url": f"/static/uploads/{name}"}


# ---------- Static frontend ----------

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def serve_index():
    return FileResponse(
        os.path.join(STATIC_DIR, "home.html"),
        media_type="text/html; charset=utf-8",
    )


@app.get("/packs")
def serve_packs_page():
    return FileResponse(
        os.path.join(STATIC_DIR, "index.html"),
        media_type="text/html; charset=utf-8",
    )


@app.get("/pack")
def serve_pack_page():
    return FileResponse(
        os.path.join(STATIC_DIR, "pack.html"),
        media_type="text/html; charset=utf-8",
    )


def _html_route(path, filename):
    @app.get(path)
    def _serve():
        return FileResponse(
            os.path.join(STATIC_DIR, filename),
            media_type="text/html; charset=utf-8",
        )
    return _serve


serve_quads_page = _html_route("/quads", "quads.html")
serve_quad_page = _html_route("/quad", "quad.html")
serve_flights_page = _html_route("/flights", "flights.html")
serve_session_page = _html_route("/session", "session.html")
serve_maintenance_page = _html_route("/maintenance", "maintenance.html")
serve_builds_page = _html_route("/builds", "builds.html")
serve_build_page = _html_route("/build", "build.html")


@app.get("/sw.js")
def serve_service_worker():
    # Served from the root so the worker's default scope covers the whole origin.
    return FileResponse(
        os.path.join(STATIC_DIR, "sw.js"),
        media_type="application/javascript",
    )
