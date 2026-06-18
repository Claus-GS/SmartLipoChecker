# Voltlog — FPV operations dashboard

A local web app for FPV pilots that tracks **packs**, **quads**, **flights**, and
**maintenance** in one place. Log charge/discharge/storage cycles with per-cell voltages
and get rule-based battery health (cell spread, storage-voltage hazard, retirement,
last-used) — then log flights against a quad and a
pack so every battery shows real flight time, every aircraft shows its hours, and open
maintenance jobs surface on the dashboard.

## Quick start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run
uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000

> The entrypoint is **`app.main:app`** (the `app/` package), not `app:app`.

## Project structure

```
lipo-tracker/
├── app/
│   ├── main.py         # FastAPI app: pack/cycle/stats/export/import routes
│   ├── database.py     # SQLite connection + versioned migrations (PRAGMA user_version)
│   ├── health.py       # Rule-based health metrics
│   └── static/         # Frontend (vanilla JS + Chart.js via CDN)
│       ├── index.html, app.js          # Dashboard: pack grid, fleet/ops stats, CSV, PWA
│       ├── pack.html, pack.js          # Pack detail: log form, voltage chart, history
│       ├── quads.html/.js, quad.html/.js     # Aircraft list + detail
│       ├── builds.html/.js, build.html/.js    # Build planner: parts list + purchase tracking
│       ├── flights.html/.js            # Flight log + monthly totals
│       ├── maintenance.html/.js        # Maintenance jobs
│       ├── common.js                   # Shared theme/SW/format helpers (secondary pages)
│       ├── style.css                   # Dark/light instrument-panel theme + top nav
│       ├── manifest.webmanifest, sw.js, icon.svg   # Installable PWA shell
├── lipo_tracker.db     # SQLite database (auto-created / auto-migrated on first run)
├── requirements.txt
└── tests/              # pytest suite (health metrics, CSV round-trip, validation)
```

## Features

- **Packs** — name, grade (A/B/C/Retired), cell count, capacity, chemistry, sticker
  label, max-cycles, notes. Full create/edit/delete.
- **Cycles** — charge / discharge / storage, pack voltage, per-cell voltages, source,
  notes, timestamp. Editable history table.
- **Quick batch log (1S)** — on a 1S pack's page, enter how many packs you just used
  and tap **Charged** (4.35 V) or **Storage** (3.85 V) to log them in one go — one cycle
  per pack, no per-cell entry. Built for whoop-style fleets flown and charged as a batch;
  charged packs left sitting still trip the storage-hazard warning.
- **Health metrics** — cell-spread status (healthy / watch / check), spread trend,
  storage-voltage hazard (pack left charged too long), retirement warning, last-used,
  pack age.
- **Charge state** — separate from health, each pack shows whether it's **Charged**
  (ready to fly), in **Storage**, or **Spent**, derived from its last logged cycle. The
  Packs dashboard summarizes how many are *ready to fly* and the charge chips filter the
  grid to just the charged ones — so in the field you grab the right packs (a "healthy"
  pack sitting at storage voltage is not the same as a charged one).
- **Fleet dashboard** — summary bar (total packs, capacity, cycles in last 30 days,
  needs-attention count) with a health-distribution doughnut; filter + sort.
- **Per-cell voltage chart** — Chart.js line chart per cycle type.
- **CSV export / import** — one-click backup and bulk entry (see format below).
- **Quads** — your aircraft (class, frame, FC/stack, VTX, motors, props, AUW, status).
  Each quad shows total flight time, # flights, last flown, and open maintenance.
- **Flight log** — log a flight against a quad and (optionally) the pack flown, with date,
  duration, location, and notes. Drives per-pack and per-quad flight stats; monthly totals
  on the Flights tab.
- **Maintenance** — per-quad jobs (crash, motor/prop swap, repair, inspection) with an
  open/done status; open jobs roll up to the dashboard.
- **Builds** — plan a quad build as a parts list. Each part has a name, category, price,
  product link, and image (auto-fetched from the product page via **Fetch image**,
  uploaded, or pasted). Parts group by category with per-group and total cost, and a
  **Copy links** button copies the current tab's links for a shopping run. Tick a part's
  checkbox to mark it **purchased**: it moves to the **Purchased** tab and the build splits
  into *to buy* vs *bought* with running totals, so a build doubles as a shopping checklist.
  Each build shows a cover image (an explicit one, or the first part's photo).
- **PWA** — installable, works offline (cached shell), light/dark theme toggle, and
  storage-hazard notifications while the app is open.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/packs | List packs (each with computed `metrics`) |
| POST   | /api/packs | Create a pack |
| GET    | /api/packs/{id} | Get a pack |
| PATCH  | /api/packs/{id} | Update a pack |
| DELETE | /api/packs/{id} | Delete a pack (cascades cycles) |
| POST   | /api/cycles | Log a cycle |
| GET    | /api/packs/{id}/cycles | Cycle history |
| GET    | /api/cycles/{id} | Get a cycle |
| PATCH  | /api/cycles/{id} | Update a cycle |
| DELETE | /api/cycles/{id} | Delete a cycle |
| GET    | /api/packs/{id}/health | Metrics + AI summary |
| GET    | /api/stats | Fleet + ops aggregates for the dashboard |
| GET    | /api/export.csv | Export all cycles + pack info as CSV |
| POST   | /api/import | Import packs/cycles from a CSV file |
| GET/POST | /api/quads | List (with stats) / create quads |
| GET/PATCH/DELETE | /api/quads/{id} | Get / update / delete a quad |
| GET/POST | /api/flights | List (filter by `quad_id`/`pack_id`) / log a flight |
| GET/PATCH/DELETE | /api/flights/{id} | Get / update / delete a flight |
| GET/POST | /api/maintenance | List (filter by `quad_id`/`status`) / add a job |
| PATCH/DELETE | /api/maintenance/{id} | Update (e.g. mark done) / delete a job |
| GET/POST | /api/builds | List (with cost + purchase summary) / create a build |
| GET/PATCH/DELETE | /api/builds/{id} | Get (with parts) / update / delete a build |
| GET/POST | /api/builds/{id}/parts, /api/parts | List a build's parts / add a part |
| PATCH/DELETE | /api/parts/{id} | Update a part (incl. `purchased`) / delete a part |
| GET    | /api/link-preview?url= | Scrape a product page for image/title/price |
| POST   | /api/upload-image | Upload an image (part, build cover, or quad photo) |

### Validation

Requests are range-checked (HTTP 422 on violation): `cell_count` 1–24,
`capacity_mah`/`max_cycles` > 0, `pack_voltage` and each per-cell voltage in
`(0, 5.0]` V (pack voltage up to 24×5 V), and `cycle_type` ∈ {charge, discharge,
storage}.

## CSV format

One **row per cycle**; repeat the pack columns to attach multiple cycles to a pack.
Packs are matched by `pack_name` (find-or-create). Header must include `pack_name`.

```
pack_name,brand,cell_count,capacity_mah,chemistry,sticker,max_cycles,timestamp,cycle_type,pack_voltage,cell_voltages,source,notes
```

- `cell_count` (required, 1–24) and a valid `cycle_type` (required) — rows missing
  either are skipped.
- `cell_voltages` is semicolon-separated, e.g. `4.18;4.17;4.18;4.16`.
- `timestamp` is ISO-8601 (defaults to now if blank).
- Exports include a UTF-8 BOM so spreadsheets read non-ASCII notes correctly; imports
  read it back transparently. Use the dashboard's **Template** button for a starter file.

## Database & migrations

SQLite, auto-created at `lipo_tracker.db`. Schema changes are applied by an ordered
migration runner in `app/database.py` keyed off `PRAGMA user_version` — a fresh DB
gets every migration; an existing one only gets what it's missing. To add a schema
change, append an idempotent migration step to `MIGRATIONS` (never edit old steps).

## Tests

```bash
pip install pytest
python -m pytest
```

Covers health-metric computation, CSV export/import round-trip, request validation, the
migration runner, and the quads / flights / maintenance endpoints (including FK delete
behavior and pack flight-stat integration).

## Credits

This project was built in conjunction with **Claude Opus** (Anthropic) and **Codex**.
