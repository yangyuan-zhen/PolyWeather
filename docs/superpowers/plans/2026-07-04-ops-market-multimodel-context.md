# Ops Market Multimodel Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ops market opportunities evaluate and display full multi-model context instead of relying mainly on DEB and median.

**Architecture:** Keep the existing Ops opportunities API and page. Extend each opportunity row with multi-model source values and bucket-relative counts, then use those counts in the late NO filter so high/low multi-model consensus is preserved for manual review.

**Tech Stack:** Python FastAPI service code, pytest, Next.js React TypeScript, business state tests.

---

### Task 1: Backend Multi-Model Signals

**Files:**
- Modify: `web/services/ops/market_opportunities.py`
- Test: `tests/test_ops_market_opportunities.py`

- [ ] **Step 1: Add tests**

Add tests asserting opportunities include `model_cluster_sources`, `model_min`, `model_max`, `models_in_bucket`, `models_above_bucket`, `models_below_bucket`, and `models_above_deb`.

- [ ] **Step 2: Implement source extraction**

Create helper functions to parse `row["model_cluster_sources"]`, classify model values against a market option, and return counts plus min/max.

- [ ] **Step 3: Return fields on opportunity rows**

Include the new fields in every row produced by `build_market_opportunity_rows`.

- [ ] **Step 4: Verify**

Run `python -m pytest tests/test_ops_market_opportunities.py -q`.

### Task 2: Conservative Late NO Filtering

**Files:**
- Modify: `web/services/ops/market_opportunities.py`
- Test: `tests/test_ops_market_opportunities.py`

- [ ] **Step 1: Update tests**

Change the late NO tests so rows are filtered only when multi-model consensus is inside the target bucket, and preserved when models mostly sit above or below the target bucket.

- [ ] **Step 2: Implement filtering**

Pass model relation counts into `_is_late_priced_no_noise`; return `False` when outside-bucket model count is greater than inside-bucket count.

- [ ] **Step 3: Verify**

Run `python -m pytest tests/test_ops_market_opportunities.py -q`.

### Task 3: Frontend Display

**Files:**
- Modify: `frontend/components/ops/market-opportunities/MarketOpportunitiesPageClient.tsx`
- Test: `frontend/components/ops/__tests__/opsMarketOpportunities.test.ts`

- [ ] **Step 1: Add frontend assertions**

Assert the Ops market opportunities page includes `多模型`, `models_above_bucket`, and `model_cluster_sources`.

- [ ] **Step 2: Display compact context**

Add a `多模型` column showing min/max range, in/high/low bucket counts, and compact source values.

- [ ] **Step 3: Verify**

Run `cd frontend && npm run test:business` and `cd frontend && npm run typecheck`.

### Task 4: Final Validation and Deploy

**Files:**
- No new source files.

- [ ] **Step 1: Run full checks**

Run `python -m ruff check .`, `python -m pytest`, `cd frontend && npm run test:business`, and `cd frontend && npm run typecheck`.

- [ ] **Step 2: Commit and push**

Commit the backend and frontend changes, push `main`, monitor GitHub Actions, and smoke check production.
