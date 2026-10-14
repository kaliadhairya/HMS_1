# Workload measurement against the stated envelope (completion C3)

The blueprint's envelope is 200 beds, 1,000 OPD visits a day and 200
concurrent users. Its targets are:
- reads: p95 under 250 ms;
- commands: p95 under 500 ms;
- committed worklist updates: p95 within 2 s.

The blueprint calls these a *planning assumption, not measured capacity*.
This file records what was actually measured, where, and what it does **not**
show.

## How it was measured

- Tool: `e2e/workload.js`. It is repeatable and runs on a throwaway copy only:
  `node workload.js --minutes N --scale S --out file.json --api-pid PID`.
- **Model at scale 1 (the busiest hour):**
  - 250 visits/hour (1,000/day × peak factor 2 ÷ 8-hour OPD day). Each visit
    is: register patient, issue token, record vitals, read chart and vitals,
    open consultation, save note, sign. About 1 visit in 10 ends in an
    admission request.
  - Inpatient vital signs at 200 beds × 6 a day.
  - 200 signed-in users (50 doctors, 80 nurses, 30 front desk, 15 lab,
    15 pharmacy, 10 admin) on 72 separate accounts. Each polls their main
    screen every 15–30 s, plus the 5-second event catch-up every page makes.
  - Event freshness: listening sockets (one per doctor account, one per other
    role) record arrival time minus the committing transaction's time.
- `--scale` multiplies every rate.
- **Server time** is measured at the client on the same host (loopback), so it
  includes HTTP and JSON overhead.
- Raw results: `docs/clinical-final/evidence/c3/*.json` (every operation's
  distribution, plus a backlog/CPU/memory sample every 5 s).

### Environment (an explicit limit on what this shows)

| | |
|---|---|
| Host | Developer laptop, Intel i5-1235U (12 threads), 15 GB RAM, shared with other work |
| API | One Node v24.13.0 process, workers in the same process (`HMS_PROCESS_ROLE=all`) |
| Database | PostgreSQL **16.15** in Docker on the same laptop, shared with other databases; copy of a production backup plus test data |
| Network | Loopback only, no hospital network, no TLS, no browser rendering |
| Code | `870a078` (`completion/claude-final`) |

A 4-second frontend build ran once during the scale-1 run, and the scale-1
run's last pacing sleep overran its end time (no requests were sent after
the end). Neither changes the figures below materially.

## Results

p95 latency in milliseconds; every run had 0 errors except the restart run.

| Operation | Kind | 1× (52 req/s) | 3× (157 req/s) | 10× (423 req/s) |
|---|---|---|---|---|
| Event catch-up (every page) | read | 13.8 | 12.5 | 327 |
| Doctor OPD queue | read | 15.4 | 13.8 | 275 |
| Nurse worklist | read | 15.2 | 14.0 | 283 |
| Nurse inpatients | read | 26.2 | 19.2 | 341 |
| Front desk patient search | read | 31.5 | 28.3 | 697 |
| Lab work queue | read | 28.5 | 21.3 | 331 |
| Patient chart | read | 23.8 | 18.1 | 903 |
| Register patient | command | 84.9 | 145.9 | **1,040** |
| Issue token | command | 16.9 | 23.1 | 419 |
| Record vitals | command | 32.0 | 30.8 | 353 |
| Open consultation | command | 25.6 | 22.9 | 362 |
| Save note | command | 44.4 | 32.5 | 380 |
| Sign consultation | command | 30.4 | 28.3 | 393 |
| **Event freshness** (worklist update reaches the screen) | event | 496 | 510 | 784 |

| Observation | 1× | 3× | 10× |
|---|---|---|---|
| Visits completed (all signed) | 43 | 119 | 195 (in 5 min) |
| API CPU p95 (one core = 100%) | 27% | 51% | 105% (saturated) |
| API memory max | 304 MB | 407 MB | 449 MB |
| Outbox: most undelivered / oldest | 1 / 0.4 s | 1 / 0.3 s | 2 / 0.6 s |
| DB connections / active max | 26 / 3 | 27 / 3 | 26 / 8 |

### Against the targets

- **At the stated envelope (1×) and 3× it, every target is met by a wide
  margin:**
  - reads p95 ≤ 32 ms (target 250);
  - commands p95 ≤ 146 ms (target 500);
  - worklist updates p95 ≈ 0.5 s (target 2 s).
- **At 10×, the single API process saturates one CPU core.** Event freshness
  still meets its target (p95 0.8 s). But some reads (search 697 ms, chart
  903 ms) and patient registration (p95 1.04 s) exceed theirs. 10× is far
  beyond the envelope; the limit is the single Node process, not the
  database, which had at most 8 active queries.
- **Registration is the slowest command and grows fastest with load** (85 →
  146 → 1,040 ms). It is the first thing to look at if the envelope is ever
  raised (UHID assignment and duplicate checks).
- Freshness is bounded below by the dispatcher interval
  (`OUTBOX_DISPATCH_INTERVAL_MS`, 500 ms), which explains the ≈0.3 s median.

### Failure and backlog: API process killed under load

At 1×, the API process was killed with SIGKILL 3 minutes into a 6-minute run
(20:25:28Z) and restarted. It was ready again 11 s later (20:25:39Z).

- During the outage, 538 requests failed **at connection** (status 599 in the
  report: no answer, so nothing was committed). That was 420 event catch-ups,
  117 screen polls and 1 registration. Every screen then caught up on its
  next poll.
- One visit's registration failed with a connection error and was not
  retried, so 29 visits started and 28 were signed. No request got an
  ambiguous answer: commands that were committed were answered.
- Events were not lost. The outbox never held more than 1 undelivered event
  (oldest 0.2 s). Events committed while the dispatcher was down are
  delivered through the catch-up endpoint, which every page polls.
- After the restart, latencies returned to the 1× figures.

## What this does not show (open gates)

- The target hosting (AWS Mumbai, PostgreSQL 18 Multi-AZ, private workers),
  the hospital network and TLS were not measured. "p95 end-to-end under one
  second on the agreed hospital network" needs that network.
- Browser rendering and "immediate local interaction feedback under 100 ms"
  are not covered by this tool.
- A database failover, a disk-full event and a regional disaster-recovery
  drill (RPO ≤ 5 min, RTO ≤ 60 min) are not exercised here. Recovery drills
  belong to B6/B7.
- Monthly availability (99.95%) can only be measured in operation.
- The laptop and database were shared with other work. Treat the 1× and 3×
  margins as comfortable, and the 10× knee as indicative only.

Rerun on the target environment with the same tool and record that run's
environment table alongside these numbers.
