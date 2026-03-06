# Technical Debt

Last updated: 2026-03-06

## Current State

Overall system status: usable and deployable.

Stable pieces:
- Multi-source weather collection
- DEB forecast blending
- Web dashboard on Vercel
- FastAPI API backend
- Telegram proactive push loop
- Alert dedupe and cooldown
- Late-day peak suppression

Recently removed:
- Old FastAPI static web page
- Polymarket market-price integration
- `/tradealert` preview command

## High-Priority Debt

### 1. Bot orchestration is still too centralized
`bot_listener.py` is operational, but too much runtime behavior is still coordinated from a single entrypoint.

Impact:
- Harder to test
- Harder to evolve subscription logic
- Harder to isolate push bugs

Suggested direction:
- Keep moving push and analysis concerns into `src/utils` and `src/analysis`

### 2. Alert transparency needs better operator visibility
The system now pushes the correct trigger types more conservatively, but group operators still need better evidence lines.

Impact:
- Hard to audit why a message fired
- Hard to distinguish strong vs weak advection calls

Suggested direction:
- Add a compact `依据 / Evidence` line to alert messages
- Expose raw trigger metrics in a debug API or operator log

### 3. No persistent application store for subscriptions
Current architecture is ready for commercialization planning, but there is no real subscription state model yet.

Impact:
- No paid access enforcement
- No renewal logic
- No expiry / access revocation

Suggested direction:
- Add a database-backed subscription table before automating billing

## Medium-Priority Debt

### 4. Backtesting is still missing
The system has live rules, but no proper replay framework for validating whether rule changes improve quality.

Impact:
- Rule changes are hard to evaluate objectively
- Alert tuning is still partly manual

Suggested direction:
- Build a replay harness from stored observations and forecasts

### 5. Thresholds remain code-defined
Important thresholds are still embedded in Python.

Examples:
- Momentum slope threshold
- Peak-passed rollback threshold
- Advection lead delta threshold
- Cooldown defaults

Suggested direction:
- Extract to constants or structured config

### 6. Frontend still uses a legacy shell inside Next
The production frontend is on Vercel, but the page is still driven by `public/legacy/index.html` plus static scripts.

Impact:
- Slower UI evolution
- Harder component-level reuse
- Harder design-system integration

Suggested direction:
- Migrate the legacy dashboard into native Next components incrementally

## Low-Priority Debt

### 7. Caching is simple in-process cache only
Current cache is sufficient for the current deployment size, but not ideal long term.

Suggested direction:
- Move to Redis or another shared cache if multi-instance deployment is needed

### 8. Test tooling is not fully provisioned everywhere
The repository has tests, but some environments still do not have `pytest` installed.

Impact:
- Harder to run full verification on every host

Suggested direction:
- Standardize test dependencies in deployment and CI environments

## Immediate Next Steps

1. Add evidence lines to Telegram alerts
2. Finish cleaning backend naming after removal of old static web flow
3. Design subscription storage for commercialization
4. Start replay/backtest tooling for alert-quality tuning
