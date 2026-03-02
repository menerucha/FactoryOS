from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import Optional, List
from datetime import datetime, timedelta
import sqlite3
import json
import os
import uuid

app = FastAPI(title="Factory Productivity API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.environ.get("DB_PATH", "factory.db")

# ── Schema ──────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS workers (
        worker_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shift_hours REAL DEFAULT 8.0
    );

    CREATE TABLE IF NOT EXISTS workstations (
        station_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        station_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        workstation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        count INTEGER DEFAULT 0,
        received_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (worker_id) REFERENCES workers(worker_id),
        FOREIGN KEY (workstation_id) REFERENCES workstations(station_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup
        ON events(timestamp, worker_id, workstation_id, event_type);

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_worker ON events(worker_id);
    CREATE INDEX IF NOT EXISTS idx_events_station ON events(workstation_id);
    """)
    conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    c = conn.cursor()

    workers = [
        ("W1", "Arjun Sharma"),
        ("W2", "Priya Nair"),
        ("W3", "Rahul Desai"),
        ("W4", "Sneha Kulkarni"),
        ("W5", "Vikram Joshi"),
        ("W6", "Meera Patel"),
    ]
    c.executemany("INSERT OR IGNORE INTO workers (worker_id, name) VALUES (?, ?)", workers)

    stations = [
        ("S1", "Assembly Line A", "assembly"),
        ("S2", "Assembly Line B", "assembly"),
        ("S3", "Quality Control", "qc"),
        ("S4", "Packaging Station", "packaging"),
        ("S5", "Welding Bay", "welding"),
        ("S6", "Inspection Desk", "inspection"),
    ]
    c.executemany(
        "INSERT OR IGNORE INTO workstations (station_id, name, station_type) VALUES (?, ?, ?)",
        stations
    )

    # Generate 3 days of realistic event data
    import random
    random.seed(42)
    base = datetime(2026, 1, 13, 8, 0, 0)  # shift start

    worker_ids = [w[0] for w in workers]
    station_ids = [s[0] for s in stations]
    assignment = dict(zip(worker_ids, station_ids))  # each worker has primary station

    events_batch = []
    for day in range(3):
        day_start = base + timedelta(days=day)
        for wid in worker_ids:
            sid = assignment[wid]
            t = day_start
            shift_end = day_start + timedelta(hours=8)
            while t < shift_end:
                # working block: 15-45 min
                work_dur = random.randint(15, 45)
                block_end = min(t + timedelta(minutes=work_dur), shift_end)
                # emit working events every 5 minutes in this block
                cur = t
                while cur < block_end:
                    events_batch.append((
                        str(uuid.uuid4()),
                        cur.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        wid, sid, "working",
                        round(random.uniform(0.80, 0.99), 2), 0
                    ))
                    cur += timedelta(minutes=5)
                t = block_end

                # product_count event after work block
                units = random.randint(1, 6)
                events_batch.append((
                    str(uuid.uuid4()),
                    t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    wid, sid, "product_count",
                    1.0, units
                ))

                if t >= shift_end:
                    break

                # idle block: 5-20 min
                idle_dur = random.randint(5, 20)
                idle_end = min(t + timedelta(minutes=idle_dur), shift_end)
                cur = t
                while cur < idle_end:
                    events_batch.append((
                        str(uuid.uuid4()),
                        cur.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        wid, sid, "idle",
                        round(random.uniform(0.75, 0.95), 2), 0
                    ))
                    cur += timedelta(minutes=5)
                t = idle_end

                # occasional absence
                if random.random() < 0.05 and t < shift_end:
                    abs_dur = random.randint(5, 15)
                    abs_end = min(t + timedelta(minutes=abs_dur), shift_end)
                    events_batch.append((
                        str(uuid.uuid4()),
                        t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        wid, sid, "absent",
                        round(random.uniform(0.85, 0.99), 2), 0
                    ))
                    t = abs_end

    c.executemany(
        "INSERT OR IGNORE INTO events (id, timestamp, worker_id, workstation_id, event_type, confidence, count) VALUES (?,?,?,?,?,?,?)",
        events_batch
    )
    conn.commit()
    conn.close()
    return len(events_batch)

init_db()
seed_db()

# ── Models ───────────────────────────────────────────────────────────────────
class EventIn(BaseModel):
    timestamp: str
    worker_id: str
    workstation_id: str
    event_type: str
    confidence: float = 1.0
    count: int = 0

    @validator("event_type")
    def valid_event_type(cls, v):
        allowed = {"working", "idle", "absent", "product_count"}
        if v not in allowed:
            raise ValueError(f"event_type must be one of {allowed}")
        return v

# ── Helpers ──────────────────────────────────────────────────────────────────
EVENT_INTERVAL_MINUTES = 5  # assumed sampling interval

def compute_metrics(conn, worker_filter=None, station_filter=None, days=None):
    c = conn.cursor()

    where_clauses = []
    params = []
    if worker_filter:
        where_clauses.append("e.worker_id = ?")
        params.append(worker_filter)
    if station_filter:
        where_clauses.append("e.workstation_id = ?")
        params.append(station_filter)
    if days:
        cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        where_clauses.append("e.timestamp >= ?")
        params.append(cutoff)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Worker metrics
    c.execute(f"""
    SELECT
        e.worker_id,
        w.name,
        SUM(CASE WHEN e.event_type='working' THEN {EVENT_INTERVAL_MINUTES} ELSE 0 END) AS active_minutes,
        SUM(CASE WHEN e.event_type='idle' THEN {EVENT_INTERVAL_MINUTES} ELSE 0 END) AS idle_minutes,
        SUM(CASE WHEN e.event_type='absent' THEN {EVENT_INTERVAL_MINUTES} ELSE 0 END) AS absent_minutes,
        SUM(CASE WHEN e.event_type='product_count' THEN e.count ELSE 0 END) AS total_units,
        COUNT(DISTINCT date(e.timestamp)) AS days_present,
        MIN(e.timestamp) AS first_event,
        MAX(e.timestamp) AS last_event
    FROM events e
    JOIN workers w ON e.worker_id = w.worker_id
    {where_sql}
    GROUP BY e.worker_id
    ORDER BY e.worker_id
    """, params)
    worker_rows = c.fetchall()

    workers_out = []
    for r in worker_rows:
        active = r["active_minutes"] or 0
        idle = r["idle_minutes"] or 0
        absent = r["absent_minutes"] or 0
        total_tracked = active + idle + absent
        shift_minutes = (r["days_present"] or 1) * 8 * 60
        utilization = round((active / shift_minutes * 100) if shift_minutes > 0 else 0, 1)
        active_hours = round(active / 60, 2)
        units_per_hour = round(r["total_units"] / active_hours, 2) if active_hours > 0 else 0
        workers_out.append({
            "worker_id": r["worker_id"],
            "name": r["name"],
            "active_time_min": active,
            "idle_time_min": idle,
            "absent_time_min": absent,
            "utilization_pct": utilization,
            "total_units": r["total_units"] or 0,
            "units_per_hour": units_per_hour,
            "days_present": r["days_present"] or 0,
        })

    # Station metrics
    c.execute(f"""
    SELECT
        e.workstation_id,
        ws.name,
        ws.station_type,
        SUM(CASE WHEN e.event_type IN ('working','idle') THEN {EVENT_INTERVAL_MINUTES} ELSE 0 END) AS occupancy_minutes,
        SUM(CASE WHEN e.event_type='working' THEN {EVENT_INTERVAL_MINUTES} ELSE 0 END) AS active_minutes,
        SUM(CASE WHEN e.event_type='product_count' THEN e.count ELSE 0 END) AS total_units,
        COUNT(DISTINCT date(e.timestamp)) AS active_days
    FROM events e
    JOIN workstations ws ON e.workstation_id = ws.station_id
    {where_sql}
    GROUP BY e.workstation_id
    ORDER BY e.workstation_id
    """, params)
    station_rows = c.fetchall()

    stations_out = []
    for r in station_rows:
        occ = r["occupancy_minutes"] or 0
        active = r["active_minutes"] or 0
        days = r["active_days"] or 1
        total_available = days * 8 * 60
        util = round((active / total_available * 100) if total_available > 0 else 0, 1)
        active_hours = round(active / 60, 2)
        throughput = round(r["total_units"] / active_hours, 2) if active_hours > 0 else 0
        stations_out.append({
            "station_id": r["workstation_id"],
            "name": r["name"],
            "station_type": r["station_type"],
            "occupancy_time_min": occ,
            "utilization_pct": util,
            "total_units": r["total_units"] or 0,
            "throughput_per_hour": throughput,
            "active_days": days,
        })

    # Factory level
    total_active = sum(w["active_time_min"] for w in workers_out)
    total_units = sum(w["total_units"] for w in workers_out)
    avg_util = round(sum(w["utilization_pct"] for w in workers_out) / len(workers_out), 1) if workers_out else 0
    total_active_hours = round(total_active / 60, 2)
    avg_rate = round(total_units / total_active_hours, 2) if total_active_hours > 0 else 0

    factory = {
        "total_productive_time_min": total_active,
        "total_production_count": total_units,
        "average_production_rate": avg_rate,
        "average_utilization_pct": avg_util,
        "worker_count": len(workers_out),
        "station_count": len(stations_out),
    }

    return {"factory": factory, "workers": workers_out, "stations": stations_out}

# ── Routes ────────────────────────────────────────────────────────────────────
@app.post("/api/events", status_code=201)
def ingest_event(event: EventIn):
    conn = get_db()
    try:
        event_id = str(uuid.uuid4())
        conn.execute(
            """INSERT OR IGNORE INTO events
               (id, timestamp, worker_id, workstation_id, event_type, confidence, count)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (event_id, event.timestamp, event.worker_id, event.workstation_id,
             event.event_type, event.confidence, event.count)
        )
        conn.commit()
        return {"status": "ok", "id": event_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

@app.post("/api/events/batch", status_code=201)
def ingest_events_batch(events: List[EventIn]):
    conn = get_db()
    inserted = 0
    skipped = 0
    try:
        for event in events:
            event_id = str(uuid.uuid4())
            cur = conn.execute(
                """INSERT OR IGNORE INTO events
                   (id, timestamp, worker_id, workstation_id, event_type, confidence, count)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (event_id, event.timestamp, event.worker_id, event.workstation_id,
                 event.event_type, event.confidence, event.count)
            )
            if cur.rowcount > 0:
                inserted += 1
            else:
                skipped += 1
        conn.commit()
        return {"status": "ok", "inserted": inserted, "skipped_duplicates": skipped}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

@app.get("/api/metrics")
def get_metrics(
    worker_id: Optional[str] = Query(None),
    station_id: Optional[str] = Query(None),
    days: Optional[int] = Query(None),
):
    conn = get_db()
    try:
        return compute_metrics(conn, worker_filter=worker_id, station_filter=station_id, days=days)
    finally:
        conn.close()

@app.get("/api/workers")
def get_workers():
    conn = get_db()
    rows = conn.execute("SELECT * FROM workers ORDER BY worker_id").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/workstations")
def get_workstations():
    conn = get_db()
    rows = conn.execute("SELECT * FROM workstations ORDER BY station_id").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/seed")
def reseed():
    """Wipe events and re-seed with fresh dummy data. Useful for evaluators."""
    conn = get_db()
    conn.execute("DELETE FROM events")
    conn.commit()
    conn.close()
    count = seed_db()
    return {"status": "seeded", "events_created": count}

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/events/recent")
def recent_events(limit: int = 50):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
