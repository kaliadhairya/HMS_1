#!/usr/bin/env python3
"""Builds the HMS Grafana dashboards (deploy/grafana/dashboards/*.json).

Edit the panels here, then run: python3 deploy/grafana/build_dashboards.py
"""
import json
import os

PROM = {"type": "prometheus", "uid": "hms-prometheus"}
PG = {"type": "grafana-postgresql-datasource", "uid": "hms-postgres"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboards")

GREEN, AMBER, RED, BLUE = "green", "#EAB839", "red", "#5794F2"


def steps(*pairs):
    """steps(GREEN, (1, AMBER), (10, RED)) -> Grafana threshold steps."""
    out = [{"color": pairs[0], "value": None}]
    out += [{"color": c, "value": v} for v, c in pairs[1:]]
    return {"mode": "absolute", "steps": out}


class Layout:
    def __init__(self):
        self.y, self.panels, self.next_id = 0, [], 1

    def add(self, panel, w, h, x):
        panel["id"] = self.next_id
        self.next_id += 1
        panel["gridPos"] = {"h": h, "w": w, "x": x, "y": self.y}
        self.panels.append(panel)

    def row(self, title, cells, h):
        """cells: list of (panel, width)."""
        self.add({"type": "row", "title": title, "collapsed": False, "panels": []}, 24, 1, 0)
        self.y += 1
        x = 0
        for panel, w in cells:
            self.add(panel, w, h, x)
            x += w
        self.y += h

    def line(self, cells, h):
        x = 0
        for panel, w in cells:
            self.add(panel, w, h, x)
            x += w
        self.y += h


def prom(expr, legend=None, instant=False, fmt=None):
    t = {"refId": "A", "datasource": PROM, "expr": expr, "range": not instant, "instant": instant}
    if legend:
        t["legendFormat"] = legend
    if fmt:
        t["format"] = fmt
    return t


def sql(query, fmt="table"):
    return {"refId": "A", "datasource": PG, "rawQuery": True, "editorMode": "code",
            "format": fmt, "rawSql": " ".join(query.split())}


def stat(title, target, unit="short", thresholds=None, desc="", mappings=None, decimals=None,
         color_mode="background", text_size=None, graph=False):
    ds = target["datasource"]
    if thresholds is None and color_mode == "background":
        color_mode = "value"  # plain counts: no traffic-light background
    p = {
        "type": "stat", "title": title, "description": desc, "datasource": ds, "targets": [target],
        "fieldConfig": {"defaults": {"unit": unit, "thresholds": thresholds or steps(BLUE),
                                     "color": {"mode": "thresholds"}, "mappings": mappings or []},
                        "overrides": []},
        "options": {"colorMode": color_mode, "graphMode": "area" if graph else "none",
                    "justifyMode": "center", "textMode": "value", "wideLayout": True,
                    "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }
    if decimals is not None:
        p["fieldConfig"]["defaults"]["decimals"] = decimals
    if text_size:
        p["options"]["text"] = {"valueSize": text_size}
    return p


def gauge(title, target, unit, maxv, thresholds, desc=""):
    return {"type": "gauge", "title": title, "description": desc, "datasource": target["datasource"],
            "targets": [target],
            "fieldConfig": {"defaults": {"unit": unit, "min": 0, "max": maxv, "thresholds": thresholds,
                                         "color": {"mode": "thresholds"}}, "overrides": []},
            "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                        "showThresholdMarkers": True}}


def bargauge(title, target, unit="short", thresholds=None, desc="", maxv=None):
    d = {"unit": unit, "min": 0, "thresholds": thresholds or steps(BLUE), "color": {"mode": "thresholds"}}
    if maxv is not None:
        d["max"] = maxv
    return {"type": "bargauge", "title": title, "description": desc, "datasource": target["datasource"],
            "targets": [target], "fieldConfig": {"defaults": d, "overrides": []},
            "options": {"displayMode": "gradient", "orientation": "horizontal", "showUnfilled": True,
                        "valueMode": "color", "namePlacement": "left", "sizing": "auto",
                        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": True}}}


def series(title, targets, unit="short", desc="", stack=False, thresholds=None, overrides=None):
    custom = {"drawStyle": "line", "lineWidth": 2, "fillOpacity": 12, "showPoints": "never",
              "spanNulls": False, "stacking": {"mode": "normal" if stack else "none"}}
    if thresholds:
        custom["thresholdsStyle"] = {"mode": "dashed"}
    return {"type": "timeseries", "title": title, "description": desc, "datasource": targets[0]["datasource"],
            "targets": [dict(t, refId=chr(65 + i)) for i, t in enumerate(targets)],
            "fieldConfig": {"defaults": {"unit": unit, "custom": custom, "color": {"mode": "palette-classic"},
                                         "thresholds": thresholds or steps(GREEN)},
                            "overrides": overrides or []},
            "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
                        "tooltip": {"mode": "multi", "sort": "desc"}}}


def table(title, target, desc="", overrides=None):
    return {"type": "table", "title": title, "description": desc, "datasource": target["datasource"],
            "targets": [target],
            "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"}}},
                            "overrides": overrides or []},
            "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": False}}}


def dashboard(uid, title, desc, panels, refresh="30s", time_from="now-6h", tags=()):
    return {"uid": uid, "title": title, "description": desc, "tags": list(tags), "editable": True,
            "schemaVersion": 39, "version": 1, "refresh": refresh, "graphTooltip": 1,
            "time": {"from": time_from, "to": "now"}, "timezone": "browser",
            "panels": panels, "templating": {"list": []}, "annotations": {"list": []}}


UP = steps(RED, (1, GREEN))
UP_MAP = [{"type": "value", "options": {"0": {"text": "DOWN", "color": RED},
                                        "1": {"text": "UP", "color": GREEN}}}]
ERRORS_5XX = 'sum(increase(hms_http_requests_total{code=~"5.."}[1h])) or vector(0)'
FAILED_LOGINS = 'sum(increase(hms_http_requests_total{route=~"/api/auth/login.*",code=~"4.."}[1h])) or vector(0)'
P95 = 'histogram_quantile(0.95, sum(rate(hms_http_request_duration_seconds_bucket[5m])) by (le))'
LAB_WAITING = """SELECT COUNT(*) FROM hms_investigation_order_items
  WHERE lab_state IS NOT NULL AND lab_state NOT IN ('RELEASED','CANCELLED')"""
LAB_STUCK = LAB_WAITING + " AND created_at < now() - interval '2 hours'"
INTERFACE_FAILED = """SELECT COUNT(*) FROM hms_interface_messages
  WHERE status IN ('Failed','Rejected','Unmatched') AND created_at > now() - interval '24 hours'"""
OUTBOX_STUCK = "SELECT COUNT(*) FROM hms_outbox WHERE delivered_at IS NULL AND created_at < now() - interval '5 minutes'"
BEDS = """SELECT COALESCE(w.name, 'No ward') AS ward,
  COUNT(*) FILTER (WHERE b.status = 'Occupied') AS occupied, COUNT(*) AS total
  FROM hms_beds b LEFT JOIN hms_wards w ON w.id = b.ward_id WHERE b.is_active = 1
  GROUP BY 1 ORDER BY 1"""


def operations():
    L = Layout()
    L.row("Is everything okay?", [
        (stat("HMS", prom('max(up{job="hms-backend"}) or vector(0)', instant=True), mappings=UP_MAP,
              thresholds=UP, desc="Is the HMS server answering? Checked every 10 seconds.", text_size=40), 4),
        (stat("Running for", prom('time() - max(hms_process_start_time_seconds)', instant=True), unit="s",
              desc="Time since the server last restarted.", color_mode="value", decimals=0), 4),
        (stat("Server errors (1h)", prom(ERRORS_5XX, instant=True), thresholds=steps(GREEN, (1, AMBER), (10, RED)),
              desc="Requests that failed because of HMS itself (5xx), last hour. Should be 0.", decimals=0), 4),
        (stat("Pages load in (95%)", prom(P95), unit="s", thresholds=steps(GREEN, (0.3, AMBER), (1, RED)),
              desc="95 out of 100 requests finish within this time. Target: under 0.3 s.", graph=True), 4),
        (stat("Failed logins (1h)", prom(FAILED_LOGINS, instant=True), thresholds=steps(GREEN, (10, AMBER), (50, RED)),
              desc="Wrong passwords in the last hour. A spike can mean someone is guessing.", decimals=0), 4),
        (stat("Last backup copy", sql("""SELECT EXTRACT(EPOCH FROM now() - last_archived_time) AS "seconds ago"
              FROM pg_stat_archiver"""), unit="s", thresholds=steps(GREEN, (300, AMBER), (3600, RED)),
              desc="How long ago the last database change was copied to the backup archive. "
                   "Should stay under a few minutes while the hospital is working.", decimals=0), 4),
    ], 5)

    L.row("Is the hospital working? (today)", [
        (stat("Patients registered", sql("SELECT COUNT(*) FROM hms_patients WHERE created_at::date = CURRENT_DATE"),
              desc="New patient registrations today."), 4),
        (stat("OPD tokens", sql("SELECT COUNT(*) FROM hms_tokens WHERE token_date = CURRENT_DATE"),
              desc="OPD tokens issued today."), 4),
        (stat("Waiting now", sql("SELECT COUNT(*) FROM hms_tokens WHERE token_date = CURRENT_DATE AND status = 'Waiting'"),
              thresholds=steps(GREEN, (20, AMBER), (50, RED)), desc="Patients with a token who have not been seen yet."), 4),
        (stat("Longest wait", sql("""SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
              FROM hms_tokens WHERE token_date = CURRENT_DATE AND status = 'Waiting'"""), unit="s",
              thresholds=steps(GREEN, (1800, AMBER), (3600, RED)), desc="How long the earliest waiting patient has waited.",
              decimals=0), 4),
        (stat("Billed", sql("SELECT COALESCE(SUM(net_payable), 0) FROM hms_bills WHERE created_at::date = CURRENT_DATE"),
              unit="currencyINR", desc="Total of bills raised today.", color_mode="value", decimals=0), 4),
        (stat("Collected", sql("SELECT COALESCE(SUM(amount), 0) FROM hms_payments WHERE payment_date::date = CURRENT_DATE"),
              unit="currencyINR", thresholds=steps(GREEN), desc="Money received today.", color_mode="value", decimals=0), 4),
    ], 4)
    L.line([
        (bargauge("Beds occupied by ward", sql("""SELECT ward, ROUND(100.0 * occupied / NULLIF(total, 0)) AS "% full"
              FROM (""" + BEDS + ") t"), unit="percent", maxv=100,
              thresholds=steps(GREEN, (80, AMBER), (95, RED)), desc="Share of active beds occupied in each ward."), 8),
        (series("Prescriptions vs medicines handed out", [
            dict(sql("""SELECT date_trunc('hour', created_at) AS time, COUNT(*) AS "Prescriptions"
                 FROM hms_prescriptions WHERE $__timeFilter(created_at) GROUP BY 1 ORDER BY 1""", fmt="time_series")),
            dict(sql("""SELECT date_trunc('hour', created_at) AS time, COUNT(*) AS "Medicines handed out"
                 FROM hms_med_dispenses WHERE $__timeFilter(created_at) GROUP BY 1 ORDER BY 1""", fmt="time_series")),
        ], desc="Per hour. If the gap keeps growing, the pharmacy is falling behind."), 8),
        (series("Lab tests ordered vs results released", [
            dict(sql("""SELECT date_trunc('hour', created_at) AS time, COUNT(*) AS "Ordered"
                 FROM hms_investigation_order_items WHERE lab_state IS NOT NULL AND $__timeFilter(created_at)
                 GROUP BY 1 ORDER BY 1""", fmt="time_series")),
            dict(sql("""SELECT date_trunc('hour', updated_at) AS time, COUNT(*) AS "Released"
                 FROM hms_investigation_order_items WHERE lab_state = 'RELEASED' AND $__timeFilter(updated_at)
                 GROUP BY 1 ORDER BY 1""", fmt="time_series")),
        ], desc="Per hour. If the gap keeps growing, the lab is falling behind."), 8),
    ], 8)

    L.row("Is anything stuck?", [
        (stat("Labs waiting > 2h", sql(LAB_STUCK), thresholds=steps(GREEN, (1, AMBER), (5, RED)),
              desc="Lab tests ordered more than 2 hours ago with no released result."), 4),
        (stat("Critical labs unseen", sql("SELECT COUNT(*) FROM hms_lab_critical_tasks WHERE state = 'OPEN'"),
              thresholds=steps(GREEN, (1, RED)), desc="Dangerous results no doctor has confirmed seeing yet. Should be 0."), 4),
        (stat("Failed outside messages", sql(INTERFACE_FAILED), thresholds=steps(GREEN, (1, AMBER), (10, RED)),
              desc="Messages to or from outside systems (labs, government health records) that failed."), 4),
        (stat("Undelivered updates", sql(OUTBOX_STUCK), thresholds=steps(GREEN, (1, AMBER), (20, RED)),
              desc="Updates (for example live screen refreshes) older than 5 minutes that were not delivered."), 4),
        (stat("No discharge plan", sql("""SELECT COUNT(*) FROM hms_admissions a WHERE a.status = 'Active'
              AND a.admission_date < now() - interval '3 days'
              AND NOT EXISTS (SELECT 1 FROM hms_discharge_plans d WHERE d.admission_id = a.id)"""),
              thresholds=steps(GREEN, (1, AMBER)), desc="Patients admitted over 3 days ago with no discharge plan."), 4),
        (stat("Staff logged in", sql("""SELECT COUNT(DISTINCT user_id) FROM hms_sessions WHERE revoked_at IS NULL
              AND expires_at > now() AND last_seen_at > now() - interval '30 minutes'"""),
              desc="People active in HMS in the last 30 minutes.", color_mode="value"), 4),
    ], 4)
    L.line([
        (series("Live connections by role", [prom("sum(hms_active_socket_connections) by (role)", "{{role}}")],
                desc="Screens with live updates open, by staff role.", stack=True), 8),
        (series("Requests per minute, by result", [
            prom('sum(rate(hms_http_requests_total{code=~"2..|3.."}[2m])) * 60', "OK"),
            prom('sum(rate(hms_http_requests_total{code=~"4.."}[2m])) * 60', "Refused (4xx)"),
            prom('sum(rate(hms_http_requests_total{code=~"5.."}[2m])) * 60', "Server error (5xx)"),
        ], desc="Everything staff do in HMS, per minute.", stack=True, overrides=[
            {"matcher": {"id": "byName", "options": "OK"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": GREEN}}]},
            {"matcher": {"id": "byName", "options": "Refused (4xx)"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": AMBER}}]},
            {"matcher": {"id": "byName", "options": "Server error (5xx)"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": RED}}]},
        ]), 16),
    ], 8)

    L.row("Why is it slow or broken? (for developers)", [
        (bargauge("5 slowest pages (95% load within)", prom(
            'topk(5, histogram_quantile(0.95, sum(rate(hms_http_request_duration_seconds_bucket[15m])) by (le, route)))',
            "{{route}}", instant=True), unit="s", thresholds=steps(GREEN, (0.3, AMBER), (1, RED)),
            desc="Ranked by the time 95% of requests finish within, last 15 minutes."), 12),
        (bargauge("Pages that fail most (1h)", prom(
            'topk(5, sum(increase(hms_http_requests_total{code=~"5.."}[1h])) by (route)) > 0', "{{route}}", instant=True),
            thresholds=steps(AMBER, (10, RED)), desc="Server errors by page, last hour. Empty is good."), 12),
    ], 7)
    L.line([
        (stat("Database size", sql("SELECT pg_database_size(current_database())"), unit="bytes", color_mode="value",
              desc="Space the HMS database takes on disk."), 4),
        (gauge("Database connections in use", sql("""SELECT COUNT(*) * 100.0 / current_setting('max_connections')::int
              FROM pg_stat_activity"""), "percent", 100, steps(GREEN, (70, AMBER), (90, RED)),
              desc="Share of allowed database connections in use."), 4),
        (stat("Slow queries running (> 5 s)", sql("""SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'
              AND query_start < now() - interval '5 seconds' AND pid <> pg_backend_pid()"""),
              thresholds=steps(GREEN, (1, AMBER), (5, RED)), desc="Database queries running longer than 5 seconds right now."), 4),
        (stat("Backup copy failures", sql("SELECT failed_count FROM pg_stat_archiver"), thresholds=steps(GREEN, (1, RED)),
              desc="Times copying database changes to the backup archive failed since the database started."), 4),
        (series("Server memory", [prom("hms_process_resident_memory_bytes", "Memory used"),
                                  prom("hms_nodejs_heap_size_used_bytes", "App data (heap)")],
                unit="bytes", desc="Memory the HMS server uses. The container limit is 1 GB."), 8),
    ], 6)
    L.line([
        (table("Longest-running database queries", sql("""SELECT pid, now() - query_start AS running_for, state,
              left(query, 120) AS query FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid()
              ORDER BY query_start LIMIT 10"""), desc="What the database is doing right now."), 12),
        (series("Server CPU and responsiveness", [
            prom("rate(hms_process_cpu_seconds_total[2m]) * 100", "CPU %"),
            prom("hms_nodejs_eventloop_lag_p99_seconds * 1000", "Delay before handling work (ms)"),
        ], desc="CPU use, and how long work waits before the server picks it up (should stay under ~50 ms)."), 12),
    ], 8)

    return dashboard("hms-overview", "HMS Operations",
                     "Is HMS okay, is the hospital working, is anything stuck, and why.",
                     L.panels, tags=["hms"])


def office_board():
    L = Layout()
    big = 64
    L.line([
        (stat("Patients waiting", sql("SELECT COUNT(*) FROM hms_tokens WHERE token_date = CURRENT_DATE AND status = 'Waiting'"),
              thresholds=steps(GREEN, (20, AMBER), (50, RED)), text_size=big), 6),
        (stat("Longest wait", sql("""SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)
              FROM hms_tokens WHERE token_date = CURRENT_DATE AND status = 'Waiting'"""), unit="s", decimals=0,
              thresholds=steps(GREEN, (1800, AMBER), (3600, RED)), text_size=big), 6),
        (stat("Beds free", sql("SELECT COUNT(*) FROM hms_beds WHERE is_active = 1 AND status <> 'Occupied'"),
              thresholds=steps(RED, (1, AMBER), (5, GREEN)), text_size=big), 6),
        (stat("OPD patients today", sql("SELECT COUNT(*) FROM hms_tokens WHERE token_date = CURRENT_DATE"),
              text_size=big), 6),
    ], 7)
    L.line([
        (stat("Admitted now", sql("SELECT COUNT(*) FROM hms_admissions WHERE status = 'Active'"), text_size=big), 6),
        (stat("Discharged today", sql("SELECT COUNT(*) FROM hms_admissions WHERE discharge_date::date = CURRENT_DATE"),
              text_size=big, thresholds=steps(GREEN)), 6),
        (stat("Billed today", sql("SELECT COALESCE(SUM(net_payable), 0) FROM hms_bills WHERE created_at::date = CURRENT_DATE"),
              unit="currencyINR", decimals=0, text_size=48, color_mode="value"), 6),
        (stat("Collected today", sql("SELECT COALESCE(SUM(amount), 0) FROM hms_payments WHERE payment_date::date = CURRENT_DATE"),
              unit="currencyINR", decimals=0, text_size=48, color_mode="value", thresholds=steps(GREEN)), 6),
    ], 7)
    L.line([
        (bargauge("Beds by ward (% full)", sql("SELECT ward, ROUND(100.0 * occupied / NULLIF(total, 0)) AS \"% full\" FROM ("
                                               + BEDS + ") t"), unit="percent", maxv=100,
                  thresholds=steps(GREEN, (80, AMBER), (95, RED))), 12),
        (bargauge("OPD patients by department today", sql("""SELECT COALESCE(d.name, 'Other') AS department, COUNT(*) AS patients
              FROM hms_tokens t LEFT JOIN hms_departments d ON d.id = t.department_id
              WHERE t.token_date = CURRENT_DATE GROUP BY 1 ORDER BY 2 DESC LIMIT 10""")), 12),
    ], 10)
    return dashboard("hms-office", "Hospital Today", "Large-text board for the hospital office.",
                     L.panels, refresh="1m", time_from="now-24h", tags=["hms"])


if __name__ == "__main__":
    for d in (operations(), office_board()):
        with open(os.path.join(OUT, d["uid"] + ".json"), "w") as f:
            json.dump(d, f, indent=2)
            f.write("\n")
        print("wrote", d["uid"])
