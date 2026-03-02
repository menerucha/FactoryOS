import React, { useState, useEffect, useCallback } from 'react';
import './index.css';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, Cell, PieChart, Pie, Legend
} from 'recharts';
import { fetchMetrics, fetchRecentEvents, ingestEvent, reseedData } from './api';

// ── Helpers ──────────────────────────────────────────────────────────────────
const initials = (name) => name.split(' ').map(n => n[0]).join('');
const fmtMin = (m) => {
  const h = Math.floor(m / 60), min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
};
const utilClass = (u) => u >= 70 ? 'util-high' : u >= 40 ? 'util-mid' : 'util-low';
const utilColor = (u) => u >= 70 ? '#22c55e' : u >= 40 ? '#f0a500' : '#ef4444';

// ── Components ────────────────────────────────────────────────────────────────

function Topbar({ onReseed, loading }) {
  return (
    <div className="topbar">
      <div className="topbar-logo">
        <div className="topbar-logo-dot" />
        FactoryOS
      </div>
      <div className="topbar-divider" />
      <span className="topbar-subtitle">AI Productivity Intelligence</span>
      <div className="topbar-right">
        <div className="live-badge">
          <div className="live-dot" /> Live
        </div>
        <button className="btn" onClick={onReseed} disabled={loading}>
          {loading ? '⟳ Seeding...' : '⟳ Reseed Data'}
        </button>
      </div>
    </div>
  );
}

function Sidebar({ page, setPage }) {
  const items = [
    { id: 'overview', icon: '◈', label: 'Overview' },
    { id: 'workers', icon: '◉', label: 'Workers' },
    { id: 'stations', icon: '▣', label: 'Workstations' },
    { id: 'events', icon: '⊞', label: 'Event Log' },
    { id: 'ingest', icon: '↑', label: 'Ingest Event' },
  ];
  return (
    <div className="sidebar">
      <div className="sidebar-section">Navigation</div>
      {items.map(i => (
        <div
          key={i.id}
          className={`sidebar-item${page === i.id ? ' active' : ''}`}
          onClick={() => setPage(i.id)}
        >
          <span className="sidebar-icon">{i.icon}</span>
          {i.label}
        </div>
      ))}
    </div>
  );
}

// ── Factory Overview ──────────────────────────────────────────────────────────
function OverviewPage({ data }) {
  if (!data) return <div className="loading"><div className="spinner" /> Loading metrics...</div>;
  const { factory, workers, stations } = data;

  const workerChartData = workers.map(w => ({
    name: w.name.split(' ')[0],
    utilization: w.utilization_pct,
    units: w.total_units,
  }));

  const stationChartData = stations.map(s => ({
    name: s.name.replace(' ', '\n'),
    throughput: s.throughput_per_hour,
    util: s.utilization_pct,
  }));

  const pieData = [
    { name: 'Active', value: workers.reduce((a, w) => a + w.active_time_min, 0), fill: '#22c55e' },
    { name: 'Idle', value: workers.reduce((a, w) => a + w.idle_time_min, 0), fill: '#f0a500' },
    { name: 'Absent', value: workers.reduce((a, w) => a + w.absent_time_min, 0), fill: '#ef4444' },
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Factory Overview</div>
        <div className="page-sub">AGGREGATE METRICS · ALL WORKERS · ALL STATIONS</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Production</div>
          <div className="stat-value stat-accent">{factory.total_production_count.toLocaleString()}</div>
          <div className="stat-unit">units produced</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Production Rate</div>
          <div className="stat-value stat-green">{factory.average_production_rate}</div>
          <div className="stat-unit">units / hour</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Utilization</div>
          <div className="stat-value" style={{ color: utilColor(factory.average_utilization_pct) }}>
            {factory.average_utilization_pct}%
          </div>
          <div className="stat-unit">across all workers</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Productive Time</div>
          <div className="stat-value stat-blue">{Math.round(factory.total_productive_time_min / 60)}h</div>
          <div className="stat-unit">{fmtMin(factory.total_productive_time_min)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Workers</div>
          <div className="stat-value">{factory.worker_count}</div>
          <div className="stat-unit">of 6 monitored</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Workstations</div>
          <div className="stat-value">{factory.station_count}</div>
          <div className="stat-unit">operational</div>
        </div>
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <div className="chart-title">Worker Utilization %</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={workerChartData} barSize={24}>
              <XAxis dataKey="name" tick={{ fill: '#4a5568', fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4a5568', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#111318', border: '1px solid #1e2530', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11 }}
                labelStyle={{ color: '#8892a4' }}
                itemStyle={{ color: '#f0a500' }}
              />
              <Bar dataKey="utilization" radius={[4, 4, 0, 0]}>
                {workerChartData.map((entry, i) => (
                  <Cell key={i} fill={utilColor(entry.utilization)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <div className="chart-title">Time Distribution</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#111318', border: '1px solid #1e2530', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11 }}
                formatter={(v) => fmtMin(v)}
              />
              <Legend wrapperStyle={{ fontFamily: 'DM Mono', fontSize: 11, color: '#8892a4' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <div className="chart-title">Station Throughput (units/hr)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stationChartData} barSize={20} layout="vertical">
              <XAxis type="number" tick={{ fill: '#4a5568', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#4a5568', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111318', border: '1px solid #1e2530', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11 }}
                labelStyle={{ color: '#8892a4' }}
              />
              <Bar dataKey="throughput" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <div className="chart-title">Units Produced per Worker</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={workerChartData} barSize={24}>
              <XAxis dataKey="name" tick={{ fill: '#4a5568', fontSize: 11, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4a5568', fontSize: 10, fontFamily: 'DM Mono' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111318', border: '1px solid #1e2530', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11 }}
                labelStyle={{ color: '#8892a4' }}
              />
              <Bar dataKey="units" fill="#f0a500" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Workers Page ──────────────────────────────────────────────────────────────
function WorkersPage({ data }) {
  const [selected, setSelected] = useState(null);
  if (!data) return <div className="loading"><div className="spinner" /> Loading...</div>;

  const worker = selected ? data.workers.find(w => w.worker_id === selected) : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Workers</div>
        <div className="page-sub">CLICK A ROW TO SEE DETAILS</div>
      </div>

      {worker && (
        <div className="detail-panel">
          <div className="detail-header">
            <div className="detail-name" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="worker-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{initials(worker.name)}</div>
              {worker.name}
              <span className="id-chip">{worker.worker_id}</span>
            </div>
            <button className="detail-close" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="detail-stats">
            <div className="mini-stat">
              <div className="mini-stat-label">Utilization</div>
              <div className="mini-stat-value" style={{ color: utilColor(worker.utilization_pct) }}>{worker.utilization_pct}%</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Total Units</div>
              <div className="mini-stat-value">{worker.total_units}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Units / Hour</div>
              <div className="mini-stat-value">{worker.units_per_hour}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Active Time</div>
              <div className="mini-stat-value" style={{ fontSize: 16 }}>{fmtMin(worker.active_time_min)}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Idle Time</div>
              <div className="mini-stat-value" style={{ fontSize: 16, color: '#f0a500' }}>{fmtMin(worker.idle_time_min)}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Days Present</div>
              <div className="mini-stat-value">{worker.days_present}</div>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Worker</th>
              <th>Utilization</th>
              <th>Active Time</th>
              <th>Idle Time</th>
              <th>Units Produced</th>
              <th>Units / Hour</th>
              <th>Days Present</th>
            </tr>
          </thead>
          <tbody>
            {data.workers.map(w => (
              <tr key={w.worker_id} className={selected === w.worker_id ? 'selected' : ''} onClick={() => setSelected(selected === w.worker_id ? null : w.worker_id)}>
                <td>
                  <div className="worker-name">
                    <div className="worker-avatar">{initials(w.name)}</div>
                    <div>
                      <div>{w.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>{w.worker_id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="progress-bar">
                      <div className={`progress-fill ${utilClass(w.utilization_pct)}`} style={{ width: `${w.utilization_pct}%` }} />
                    </div>
                    <span style={{ color: utilColor(w.utilization_pct), fontFamily: 'DM Mono', fontSize: 12 }}>{w.utilization_pct}%</span>
                  </div>
                </td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{fmtMin(w.active_time_min)}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{fmtMin(w.idle_time_min)}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--blue)' }}>{w.total_units.toLocaleString()}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{w.units_per_hour}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{w.days_present}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Stations Page ─────────────────────────────────────────────────────────────
function StationsPage({ data }) {
  const [selected, setSelected] = useState(null);
  if (!data) return <div className="loading"><div className="spinner" /> Loading...</div>;

  const TYPES = {
    assembly: '🔩',
    qc: '🔍',
    packaging: '📦',
    welding: '🔥',
    inspection: '✅',
  };

  const station = selected ? data.stations.find(s => s.station_id === selected) : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Workstations</div>
        <div className="page-sub">CLICK A ROW TO SEE DETAILS</div>
      </div>

      {station && (
        <div className="detail-panel">
          <div className="detail-header">
            <div className="detail-name" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>{TYPES[station.station_type] || '🏭'}</span>
              {station.name}
              <span className="id-chip">{station.station_id}</span>
            </div>
            <button className="detail-close" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="detail-stats">
            <div className="mini-stat">
              <div className="mini-stat-label">Utilization</div>
              <div className="mini-stat-value" style={{ color: utilColor(station.utilization_pct) }}>{station.utilization_pct}%</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Total Units</div>
              <div className="mini-stat-value">{station.total_units}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Throughput/hr</div>
              <div className="mini-stat-value">{station.throughput_per_hour}</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-label">Occupancy</div>
              <div className="mini-stat-value" style={{ fontSize: 16 }}>{fmtMin(station.occupancy_time_min)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Station</th>
              <th>Type</th>
              <th>Utilization</th>
              <th>Occupancy</th>
              <th>Units Produced</th>
              <th>Throughput / hr</th>
              <th>Active Days</th>
            </tr>
          </thead>
          <tbody>
            {data.stations.map(s => (
              <tr key={s.station_id} className={selected === s.station_id ? 'selected' : ''} onClick={() => setSelected(selected === s.station_id ? null : s.station_id)}>
                <td>
                  <div className="worker-name">
                    <span style={{ fontSize: 18 }}>{TYPES[s.station_type] || '🏭'}</span>
                    <div>
                      <div>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>{s.station_id}</div>
                    </div>
                  </div>
                </td>
                <td><span className="id-chip" style={{ textTransform: 'capitalize' }}>{s.station_type}</span></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="progress-bar">
                      <div className={`progress-fill ${utilClass(s.utilization_pct)}`} style={{ width: `${s.utilization_pct}%` }} />
                    </div>
                    <span style={{ color: utilColor(s.utilization_pct), fontFamily: 'DM Mono', fontSize: 12 }}>{s.utilization_pct}%</span>
                  </div>
                </td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{fmtMin(s.occupancy_time_min)}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--blue)' }}>{s.total_units.toLocaleString()}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--accent)' }}>{s.throughput_per_hour}</td>
                <td style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{s.active_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Event Log ─────────────────────────────────────────────────────────────────
function EventLogPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRecentEvents(100);
      setEvents(data);
    } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const types = ['all', 'working', 'idle', 'absent', 'product_count'];
  const filtered = filter === 'all' ? events : events.filter(e => e.event_type === filter);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Event Log</div>
        <div className="page-sub">MOST RECENT 100 EVENTS FROM CV SYSTEM</div>
      </div>

      <div className="filter-bar">
        <span className="filter-label">Type:</span>
        {types.map(t => (
          <span key={t} className={`filter-chip${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>
            {t}
          </span>
        ))}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /> Loading events...</div>
      ) : (
        <div className="event-log">
          <div className="event-row header">
            <span>Timestamp</span>
            <span>Worker</span>
            <span>Station</span>
            <span>Event Type</span>
            <span>Confidence</span>
            <span>Count</span>
          </div>
          {filtered.map(e => (
            <div key={e.id} className="event-row">
              <span style={{ color: 'var(--text3)' }}>{e.timestamp.replace('T', ' ').replace('Z', '')}</span>
              <span style={{ color: 'var(--text)' }}>{e.worker_id}</span>
              <span style={{ color: 'var(--text)' }}>{e.workstation_id}</span>
              <span><span className={`event-type-badge et-${e.event_type}`}>{e.event_type}</span></span>
              <span style={{ color: 'var(--text2)' }}>{(e.confidence * 100).toFixed(0)}%</span>
              <span style={{ color: e.count > 0 ? 'var(--blue)' : 'var(--text3)' }}>{e.count > 0 ? e.count : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ingest Form ───────────────────────────────────────────────────────────────
function IngestPage() {
  const [form, setForm] = useState({
    timestamp: new Date().toISOString().slice(0, 19) + 'Z',
    worker_id: 'W1',
    workstation_id: 'S1',
    event_type: 'working',
    confidence: '0.92',
    count: '0',
  });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await ingestEvent({
        ...form,
        confidence: parseFloat(form.confidence),
        count: parseInt(form.count),
      });
      setStatus({ ok: true, msg: `✓ Event ingested with ID: ${result.id}` });
    } catch (e) {
      setStatus({ ok: false, msg: `✗ ${e.message}` });
    }
    setLoading(false);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Ingest Event</div>
        <div className="page-sub">MANUALLY SEND A CV SYSTEM EVENT TO THE API</div>
      </div>

      <div className="form-card">
        <div className="form-row">
          <div className="form-group" style={{ flex: 2, minWidth: 240 }}>
            <label className="form-label">Timestamp (ISO 8601)</label>
            <input className="form-input" value={form.timestamp} onChange={e => set('timestamp', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Event Type</label>
            <select className="form-select" value={form.event_type} onChange={e => set('event_type', e.target.value)}>
              <option value="working">working</option>
              <option value="idle">idle</option>
              <option value="absent">absent</option>
              <option value="product_count">product_count</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Worker ID</label>
            <select className="form-select" value={form.worker_id} onChange={e => set('worker_id', e.target.value)}>
              {['W1','W2','W3','W4','W5','W6'].map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Station ID</label>
            <select className="form-select" value={form.workstation_id} onChange={e => set('workstation_id', e.target.value)}>
              {['S1','S2','S3','S4','S5','S6'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Confidence</label>
            <input className="form-input" type="number" step="0.01" min="0" max="1" value={form.confidence} onChange={e => set('confidence', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Count (product_count)</label>
            <input className="form-input" type="number" min="0" value={form.count} onChange={e => set('count', e.target.value)} />
          </div>
        </div>

        {status && (
          <div style={{
            background: status.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${status.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 12,
            fontFamily: 'DM Mono',
            fontSize: 12,
            color: status.ok ? '#22c55e' : '#ef4444',
          }}>
            {status.msg}
          </div>
        )}

        <button className="btn primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Sending...' : '↑ Send Event'}
        </button>
      </div>

      <div className="form-card" style={{ marginTop: 0 }}>
        <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Example cURL
        </div>
        <pre style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          fontFamily: 'DM Mono',
          fontSize: 11,
          color: 'var(--text2)',
          overflowX: 'auto',
          lineHeight: 1.7,
        }}>
{`curl -X POST http://localhost:8000/api/events \\
  -H "Content-Type: application/json" \\
  -d '{
    "timestamp": "2026-01-15T10:15:00Z",
    "worker_id": "W1",
    "workstation_id": "S3",
    "event_type": "working",
    "confidence": 0.93,
    "count": 0
  }'`}
        </pre>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchMetrics();
      setData(d);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const handleReseed = async () => {
    setLoading(true);
    try {
      await reseedData();
      await loadMetrics();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="app">
      <Topbar onReseed={handleReseed} loading={loading} />
      <Sidebar page={page} setPage={setPage} />
      <div className="main">
        {error && <div className="error-msg">⚠ API Error: {error} — Is the backend running?</div>}
        {page === 'overview' && <OverviewPage data={data} />}
        {page === 'workers' && <WorkersPage data={data} />}
        {page === 'stations' && <StationsPage data={data} />}
        {page === 'events' && <EventLogPage />}
        {page === 'ingest' && <IngestPage />}
      </div>
    </div>
  );
}
