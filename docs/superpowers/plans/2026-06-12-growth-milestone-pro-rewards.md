# Growth Milestone Pro Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically extend active paid Pro memberships when verified-user growth milestones are reached.

**Architecture:** A low-frequency Bot-owned loop reads Supabase Auth and payment data, stores daily growth history in SQLite, and grants idempotent milestone-specific bonus subscriptions. SQLite settlement and payout records prevent duplicate processing and support retries.

**Tech Stack:** Python, SQLite, Supabase REST/Auth Admin API, Telegram Bot runtime, pytest

---

### Task 1: Define milestone and eligibility policy

**Files:**
- Create: `src/bot/growth_milestone_reward_loop.py`
- Test: `tests/test_growth_milestone_reward_loop.py`

- [ ] Write failing tests for the 600/750/1000/100-step milestone schedule and paid-member eligibility intersection.
- [ ] Run `python -m pytest tests/test_growth_milestone_reward_loop.py -q` and confirm failure because the module is missing.
- [ ] Implement pure policy helpers and Supabase query helpers.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Persist history and settlement state

**Files:**
- Modify: `src/database/db_manager.py`
- Test: `tests/test_growth_milestone_reward_loop.py`

- [ ] Write failing tests for daily snapshot upsert, payout idempotency, and milestone settlement.
- [ ] Run the focused tests and confirm the new DB methods are missing.
- [ ] Add `user_growth_snapshots`, `growth_milestone_runs`, and `growth_milestone_payouts`.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Run and announce automatic settlement

**Files:**
- Modify: `src/bot/growth_milestone_reward_loop.py`
- Modify: `src/bot/runtime_coordinator.py`
- Modify: `src/utils/config_validation.py`
- Modify: `.env.example`
- Test: `tests/test_growth_milestone_reward_loop.py`
- Test: `tests/test_bot_runtime_coordinator.py`

- [ ] Write failing tests for idempotent bonus grants and runtime-loop registration.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement the settlement loop, retry behavior, and bilingual announcement.
- [ ] Re-run focused tests and confirm they pass.

### Task 4: Record baseline and publishable announcement

**Files:**
- Create: `docs/operations/user-growth-history.json`
- Create: `docs/social/2026-06-12-growth-rewards-x-post.md`
- Create: `docs/social/assets/polyweather-588-growth-rewards.png`

- [ ] Record the verified 2026-06-12 baseline.
- [ ] Write the English X announcement with accurate total-user and verified-user wording.
- [ ] Save the generated social image in the repository.

### Task 5: Verify and deploy

- [ ] Run focused backend tests.
- [ ] Run `python -m ruff check src/bot/growth_milestone_reward_loop.py src/bot/runtime_coordinator.py src/database/db_manager.py tests/test_growth_milestone_reward_loop.py tests/test_bot_runtime_coordinator.py`.
- [ ] Run the broader relevant test suite.
- [ ] Commit and push to `main`.
- [ ] Check GitHub Actions and production health.

