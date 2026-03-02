const BASE = process.env.REACT_APP_API_URL || "";

export async function fetchMetrics(params) {
  params = params || {};
  var q = new URLSearchParams();
  if (params.worker_id) q.set("worker_id", params.worker_id);
  if (params.station_id) q.set("station_id", params.station_id);
  if (params.days) q.set("days", params.days);
  var res = await fetch(BASE + "/api/metrics?" + q);
  if (!res.ok) throw new Error("Failed to fetch metrics");
  return res.json();
}

export async function fetchRecentEvents(limit) {
  limit = limit || 50;
  var res = await fetch(BASE + "/api/events/recent?limit=" + limit);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

export async function ingestEvent(event) {
  var res = await fetch(BASE + "/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event)
  });
  if (!res.ok) {
    var err = await res.json();
    throw new Error(err.detail || "Failed");
  }
  return res.json();
}

export async function reseedData() {
  var res = await fetch(BASE + "/api/seed", { method: "POST" });
  if (!res.ok) throw new Error("Reseed failed");
  return res.json();
}