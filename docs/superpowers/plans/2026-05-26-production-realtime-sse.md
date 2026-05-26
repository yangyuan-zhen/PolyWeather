# Production Realtime SSE Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade PolyWeather terminal charts from in-process best-effort SSE patches to a replayable, city-scoped, versioned realtime observation stream for PM highest-temperature prediction workflows.

**Architecture:** Keep HTTP APIs as the full snapshot/source-of-truth layer. Add a short-window SQLite event log for SSE replay, version observations as `city_observation_patch.v1`, fan out live events through the existing SSE manager, and let the frontend subscribe only to visible cities with `since_revision` reconnect replay.

**Tech Stack:** FastAPI, SQLite/WAL via `DBManager`, in-process `asyncio.Queue` SSE fanout, React/Next.js `EventSource`, TypeScript external store hooks.

---

## Constraints

- Default replay retention is 6 hours because this event log is not the business history store.
- The retention can be raised with `POLYWEATHER_PATCH_EVENT_RETENTION_HOURS`, but the product does not need all-day patch retention.
- First production step is SQLite-only; Redis/Postgres pub/sub remains a later multi-instance extension.
- Existing legacy `city_patch` ingest and frontend handling must keep working during rollout.

## Tasks

- [ ] Backend schema tests
  - Add tests proving legacy collector payloads normalize to `city_observation_patch.v1`.
  - Cover runway point conversion from `amos.runway_obs.point_temperatures`.
  - Cover invalid payload rejection when city and useful observation data are missing.

- [ ] Backend schema implementation
  - Add `web/realtime_patch_schema.py`.
  - Normalize city/source/obs time/temp/max/runway payload fields.
  - Keep payload small and JSON-serializable.

- [ ] Event store tests
  - Add tests for monotonic SQLite revisions.
  - Add city-filtered replay tests.
  - Add retention cleanup tests for stale replay rows.

- [ ] Event store implementation
  - Add `observation_patch_events` table and indexes in `DBManager`.
  - Add `web/realtime_event_store.py` for append, replay, latest revision, and cleanup.
  - Use `POLYWEATHER_PATCH_EVENT_RETENTION_HOURS=6` as the default.

- [ ] SSE replay tests
  - Add tests for `/api/events?cities=...&since_revision=...`.
  - Verify replay only returns subscribed cities.
  - Verify replay over limit emits `resync_required`.

- [ ] SSE implementation
  - Update router to parse `cities`, `since_revision`, and bounded `replay_limit`.
  - Write normalized events to SQLite before broadcasting.
  - Update manager to track per-connection city subscriptions while keeping heartbeat behavior.

- [ ] Frontend SSE tests
  - Extend architecture tests for v1 schema, `cities`, `since_revision`, replay/resync handling.
  - Add chart merge coverage for v1 runway point payloads.

- [ ] Frontend SSE implementation
  - Update `use-sse-patches.ts` to normalize v1 and legacy patch events.
  - Track global `lastRevision`.
  - Reconnect with visible-city `cities` and `since_revision`.
  - Expose a resync signal for charts when the server cannot replay.

- [ ] Chart/list integration
  - Ensure visible charts register their city subscription.
  - Keep terminal row patching lightweight: current temp, current max, local time, revision.
  - Append v1 temp/runway points into existing chart series without forcing full-detail polling.

- [ ] Verification
  - Run targeted backend pytest files.
  - Run `npm run test:business`.
  - Run `npm run typecheck`.
  - Run `npm run build`.
