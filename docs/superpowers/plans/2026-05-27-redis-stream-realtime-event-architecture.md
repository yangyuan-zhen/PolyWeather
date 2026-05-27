# Redis Stream Realtime Event Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis Stream as the production realtime event store and live fanout source while preserving the existing SSE patch protocol.

**Architecture:** Keep `city_observation_patch.v1` and numeric `revision` as the browser contract. Add a Redis-backed event store beside the existing SQLite store, select it through an event-store factory, and let Redis-backed deployments fan out live events through a Redis subscriber loop instead of direct in-process ingest broadcast.

**Tech Stack:** FastAPI, redis-py, Redis Stream, SQLite fallback, pytest, existing frontend EventSource hook.

---

### Task 1: Redis Store Contract

**Files:**
- Create: `tests/test_redis_realtime_event_store.py`
- Create: `web/redis_realtime_event_store.py`

- [ ] **Step 1: Write failing tests**

Cover append, replay by city, replay gap, and fallback-independent event shape.

- [ ] **Step 2: Verify tests fail**

Run: `python -m pytest tests/test_redis_realtime_event_store.py -q`

Expected: fails because `web.redis_realtime_event_store` does not exist.

- [ ] **Step 3: Implement Redis store**

Add `RedisRealtimeEventStore` with `append_event`, `latest_revision`, `replay_events`, `replay_requires_resync`, and idempotent `start_live_subscription`.

- [ ] **Step 4: Verify tests pass**

Run: `python -m pytest tests/test_redis_realtime_event_store.py -q`

### Task 2: Store Factory And SSE Router

**Files:**
- Create: `web/realtime_event_store_factory.py`
- Modify: `web/routers/sse_router.py`
- Test: `tests/test_sse_replay.py`

- [ ] **Step 1: Write failing tests**

Cover `POLYWEATHER_EVENT_STORE=redis` selecting Redis, SQLite fallback when Redis is not configured, and Redis ingest not doing direct local broadcast.

- [ ] **Step 2: Verify tests fail**

Run: `python -m pytest tests/test_sse_replay.py tests/test_realtime_event_store_factory.py -q`

- [ ] **Step 3: Implement factory and router integration**

Use Redis store when configured; otherwise keep existing SQLite store. Ingest broadcasts directly only for stores that do not provide external live fanout.

- [ ] **Step 4: Verify tests pass**

Run: `python -m pytest tests/test_sse_replay.py tests/test_realtime_event_store_factory.py -q`

### Task 3: Dependency And Operational Config

**Files:**
- Modify: `requirements.txt`
- Modify: `docs/superpowers/specs/2026-05-27-redis-stream-realtime-event-architecture-design.md`

- [ ] **Step 1: Add redis-py dependency**

Add `redis>=5.0.0` to `requirements.txt`.

- [ ] **Step 2: Add final config notes**

Ensure the design doc names the runtime env vars used by code.

### Task 4: Verification

**Files:**
- No production edits unless tests reveal a gap.

- [ ] **Step 1: Run backend realtime tests**

Run:

```powershell
python -m pytest tests/test_realtime_patch_schema.py tests/test_realtime_event_store.py tests/test_redis_realtime_event_store.py tests/test_realtime_event_store_factory.py tests/test_sse_replay.py -q
```

- [ ] **Step 2: Run broader frontend/backend checks**

Run:

```powershell
cd frontend
npm run test:business
npm run typecheck
npm run build
```

- [ ] **Step 3: Inspect diff**

Run:

```powershell
git diff --check
git status --short
```
