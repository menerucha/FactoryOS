# FactoryOS — AI-Powered Worker Productivity Dashboard

A production-style full-stack web application that ingests computer vision events from AI-powered CCTV cameras and displays real-time productivity metrics for a factory floor.

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose installed

### Run with Docker (recommended)
```bash
git clone <repo-url>
cd factory-dashboard
docker-compose up --build
```

- **Dashboard**: http://localhost:3000  
- **API Docs**: http://localhost:8000/docs  
- **Health check**: http://localhost:8000/api/health

The database is **auto-seeded on first run** with 3 days of realistic event data across 6 workers × 6 workstations (~1,500+ events).

### Run locally without Docker

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
REACT_APP_API_URL=http://localhost:8000 npm start
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/events` | Ingest a single CV event |
| `POST` | `/api/events/batch` | Ingest a batch of events |
| `GET` | `/api/metrics` | Get computed productivity metrics |
| `GET` | `/api/events/recent?limit=50` | Get recent raw events |
| `POST` | `/api/seed` | **Wipe and re-seed dummy data** (for evaluators) |
| `GET` | `/api/workers` | List all workers |
| `GET` | `/api/workstations` | List all workstations |
| `GET` | `/api/health` | Health check |

### Ingest a single event
```bash
curl -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2026-01-15T10:15:00Z",
    "worker_id": "W1",
    "workstation_id": "S3",
    "event_type": "working",
    "confidence": 0.93,
    "count": 0
  }'
```

### Refresh dummy data (evaluators)
```bash
curl -X POST http://localhost:8000/api/seed
```

### Filter metrics
```bash
# Per-worker
curl "http://localhost:8000/api/metrics?worker_id=W1"

# Per-station
curl "http://localhost:8000/api/metrics?station_id=S3"

# Last 7 days only
curl "http://localhost:8000/api/metrics?days=7"
```

---

## 🗄️ Database Schema

SQLite with WAL mode for concurrent reads. Three tables:

```sql
workers (
    worker_id  TEXT PRIMARY KEY,   -- "W1" – "W6"
    name       TEXT NOT NULL,
    shift_hours REAL DEFAULT 8.0
)

workstations (
    station_id   TEXT PRIMARY KEY,  -- "S1" – "S6"
    name         TEXT NOT NULL,
    station_type TEXT NOT NULL       -- assembly, qc, packaging, welding, inspection
)

events (
    id              TEXT PRIMARY KEY,  -- UUID
    timestamp       TEXT NOT NULL,     -- ISO 8601 UTC
    worker_id       TEXT NOT NULL,
    workstation_id  TEXT NOT NULL,
    event_type      TEXT NOT NULL,     -- working | idle | absent | product_count
    confidence      REAL DEFAULT 1.0,
    count           INTEGER DEFAULT 0,
    received_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(timestamp, worker_id, workstation_id, event_type)  -- dedup key
)
```

**Indexes:** `(timestamp)`, `(worker_id)`, `(workstation_id)` for query performance.

---

## 📊 Metric Definitions & Assumptions

### Core Assumption: Event Sampling Interval
The CV system emits one `working` or `idle` event **every 5 minutes** of observed activity (configurable via `EVENT_INTERVAL_MINUTES` in `main.py`). Each event therefore represents **5 minutes** of that state.

### Worker-Level Metrics

| Metric | Formula | Notes |
|--------|---------|-------|
| **Active Time** | `COUNT(working events) × 5 min` | Time the CV system observed the worker actively working |
| **Idle Time** | `COUNT(idle events) × 5 min` | Time observed at station but not working |
| **Absent Time** | `COUNT(absent events) × 5 min` | Time not detected at workstation |
| **Utilization %** | `active_minutes / (days_present × 8h × 60) × 100` | Denominator is scheduled shift time (8h/day) |
| **Units Produced** | `SUM(count) WHERE event_type = 'product_count'` | Direct count from CV product detection events |
| **Units per Hour** | `total_units / (active_time_min / 60)` | Rate during active time only (excludes idle) |

### Workstation-Level Metrics

| Metric | Formula |
|--------|---------|
| **Occupancy Time** | `COUNT(working + idle events) × 5 min` — station has a person |
| **Utilization %** | `active_minutes / (active_days × 8h × 60) × 100` |
| **Units Produced** | `SUM(product_count events)` at this station |
| **Throughput / hr** | `total_units / (active_minutes / 60)` |

### Factory-Level Metrics

| Metric | Formula |
|--------|---------|
| **Total Productive Time** | `SUM(active_time_min)` across all workers |
| **Total Production Count** | `SUM(total_units)` across all workers |
| **Average Production Rate** | `total_units / (total_active_hours)` |
| **Average Utilization** | `MEAN(utilization_pct)` across all workers |

### Production Event Aggregation
`product_count` events are **count-only** — they carry the number of units produced since the last count event. They are **decoupled from time-tracking events**: a `product_count` after a `working` block captures output from that block. Time-based metrics (`active_time_min`, `utilization_pct`) are derived purely from `working`/`idle` events; production volume is derived purely from `product_count` events. This mirrors how real CV systems work — a separate detection head counts completed products.

---

## 🏗️ Architecture

### Edge → Backend → Dashboard

```
┌─────────────────────────────────────────────────────────┐
│  FACTORY FLOOR (Edge)                                   │
│                                                         │
│  IP Camera → CV Model (YOLO/etc.) → Event Emitter      │
│              (on-device inference)   (Python agent)    │
│                                         │               │
│                              POST /api/events           │
└─────────────────────────────────────────────────────────┘
                                 │
                    HTTP / HTTPS + TLS
                                 │
┌─────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI + SQLite/Postgres)                    │
│                                                         │
│  /api/events  →  Dedup check  →  Persist               │
│  /api/metrics →  Aggregate queries  →  JSON response   │
└─────────────────────────────────────────────────────────┘
                                 │
                           REST API calls
                                 │
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (React + Recharts)                            │
│                                                         │
│  Overview  /  Workers  /  Stations  /  Event Log       │
└─────────────────────────────────────────────────────────┘
```

---

## ❓ Theoretical Questions

### 1. Handling Intermittent Connectivity, Duplicates, and Out-of-Order Timestamps

**Intermittent Connectivity:**  
The edge agent should implement a **local event buffer** (SQLite on-device or a Redis queue). Events accumulate when connectivity is lost and are flushed in order when the connection resumes, using a `POST /api/events/batch` call with retry + exponential backoff. This is a standard outbox pattern. The backend must handle batches arriving seconds or days late.

**Duplicate Events:**  
The `events` table has a `UNIQUE` constraint on `(timestamp, worker_id, workstation_id, event_type)`. Any retry of the same event silently becomes `INSERT OR IGNORE` — zero data corruption, zero error to the caller. The batch ingest endpoint returns both `inserted` and `skipped_duplicates` counts for observability. Idempotency keys (a UUID generated at the edge) can further guarantee dedup across distributed backends.

**Out-of-Order Timestamps:**  
All timestamps are stored as-received ISO 8601 strings and indexed. Aggregate queries use `timestamp` for grouping, not `received_at`. This means a batch of late events (e.g., from an edge buffer that was offline for 6 hours) is correctly attributed to the original work period. For real-time dashboards, a small **watermark window** (e.g., ignore events older than 24h for live metrics but include them in historical queries) prevents stale data from distorting current-shift KPIs.

---

### 2. Model Versioning, Drift Detection, and Retraining

**Model Versioning:**  
Each CV event payload should include a `model_version` field (e.g., `"cv_model_version": "yolo11-factory-v2.1.3"`). Store this in the events table. This allows post-hoc analysis: "did our confidence distributions change after deploying v2.1.3?" and enables A/B testing of models on different cameras. Use a model registry (MLflow, W&B Artifacts, or even a simple S3 bucket with versioned paths) to track model binaries, training metadata, and evaluation scores.

**Drift Detection:**  
Two types of drift matter here:
- **Data drift** (input distribution shift): Monitor the rolling mean and variance of the `confidence` field per `event_type`. A sudden drop in average confidence for `working` events (e.g., confidence drops from 0.92 → 0.74 over a week) suggests the model is less certain — possibly due to lighting changes, PPE additions, or new worker body types. Use a statistical test (KS-test or Population Stability Index) on a sliding window.
- **Concept drift** (output reliability shift): Compare model-labeled `working` events against ground truth labels from periodic human audits of 5% of footage. Track the precision/recall on this audited sample weekly. If precision on `product_count` events drops below a threshold (e.g., 90%), trigger retraining.

**Triggering Retraining:**  
Implement an automated pipeline: (1) nightly job computes confidence statistics and audit metrics; (2) if drift score exceeds threshold OR audit precision < target, open a Jira ticket / Slack alert; (3) a data engineer pulls the flagged window of raw video + model predictions, labels corrections, and adds to the training set; (4) CI pipeline retrains and evaluates the model; (5) canary deploy to one camera for 48h, compare metrics, promote or rollback.

---

### 3. Scaling: 5 Cameras → 100+ Cameras → Multi-Site

**5 cameras (current):**  
SQLite + single FastAPI process. Simple, zero ops overhead. Works well up to ~10 cameras or ~100 events/minute.

**100+ cameras (single site):**  
- Replace SQLite with **PostgreSQL** (TimescaleDB extension for time-series performance)
- Move event ingestion to an **async message queue** (Kafka or AWS SQS) between edge agents and the API. The API becomes a producer, and a separate worker process consumes and persists. This decouples ingest throughput from DB write latency and handles traffic spikes (e.g., shift start when 100 cameras send events simultaneously)
- Add a **Redis** cache layer in front of the metrics endpoint with a 60-second TTL — metrics don't need to be recomputed on every dashboard reload
- Horizontally scale the FastAPI service with Kubernetes or ECS behind a load balancer
- Add a **time-series partitioning** strategy: partition the events table by month so old data queries don't scan recent data

**Multi-site (global):**  
- Each factory site gets its **own regional backend** (edge-local API + DB) for latency and resilience — a Tokyo plant can keep working even if the central cloud is unreachable
- A **central aggregation layer** (read replicas or event streaming to a data warehouse like BigQuery or Snowflake) pulls data from all sites for cross-site dashboards and corporate reporting
- Use a **tenant ID** or `site_id` field added to all tables; the central dashboard can query globally or filter by site
- Authentication and authorization via an IdP (Okta/Auth0): plant managers see only their site; corporate can see all
- For the CV models themselves: models are trained centrally but deployed per-site, with per-site fine-tuning possible (e.g., a site with unusual PPE) while keeping a shared base model

---

## 🔧 Assumptions & Trade-offs

| Decision | Rationale |
|----------|-----------|
| SQLite over Postgres | Zero-dependency setup for local dev/eval. Swap `sqlite3` for `asyncpg` + Postgres in production |
| 5-minute event sampling interval | Assumed from typical CV system behavior. Configurable in `main.py` |
| One-worker-per-station assignment in seed | Simplification for demo. In production a worker can move between stations; queries group by `worker_id` regardless |
| `product_count` decoupled from time tracking | Mirrors real CV pipelines: activity detection and object counting are separate model heads |
| Utilization denominator = 8h scheduled | Fairer than total tracked time (rewards full-shift presence). Change `shift_hours` per worker for flexible shifts |
| No auth on API | Appropriate for internal factory network / demo. Add OAuth2/Bearer tokens for production |

---

## 🛠️ Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLite, Uvicorn
- **Frontend**: React 18, Recharts, CSS3
- **Containerization**: Docker, Docker Compose, Nginx
