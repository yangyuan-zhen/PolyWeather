# Live Temperature Chart Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `LiveTemperatureThresholdChart.tsx` so chart data generation and SSE patch merge logic live in focused pure modules, while the visible chart behavior stays unchanged.

**Architecture:** Keep the React component as the orchestration/rendering layer. Move types, constants, time helpers, series builders, fallback rules, and patch merge into adjacent modules under `frontend/components/dashboard/scan-terminal/`. Preserve existing test exports through the component file during the first split to avoid changing test callers.

**Tech Stack:** Next.js/React, TypeScript, Recharts, existing business-state test runner.

---

## Files

- Create: `frontend/components/dashboard/scan-terminal/temperature-chart-logic.ts`
- Modify: `frontend/components/dashboard/scan-terminal/LiveTemperatureThresholdChart.tsx`
- Modify: `frontend/components/dashboard/scan-terminal/__tests__/ssePatchArchitecture.test.ts`
- Verify: `frontend/components/dashboard/scan-terminal/__tests__/temperatureDefaultVisibilityPolicy.test.ts`

## Tasks

- [ ] Add a failing architecture test that rejects keeping all chart data builders inside `LiveTemperatureThresholdChart.tsx`.
- [ ] Extract pure chart logic into `temperature-chart-logic.ts`.
- [ ] Import extracted functions/types back into `LiveTemperatureThresholdChart.tsx`.
- [ ] Keep the current test-only exports stable from `LiveTemperatureThresholdChart.tsx`.
- [ ] Run `npm run test:business`, `npm run typecheck`, and `npm run build`.
