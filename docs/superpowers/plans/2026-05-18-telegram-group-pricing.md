# Telegram Group Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add Telegram Login verification so backend decides Pro price: group member 5U, non-member 10U.

**Architecture:** Keep Supabase as the website account session, add Telegram Login as an identity link/price verification step. Backend verifies Telegram Login hash, checks getChatMember, stores the Telegram link in existing supabase_bindings, and payment intent creation recalculates price server-side.

**Tech Stack:** FastAPI, existing DBManager bindings, Telegram Bot HTTP API, Next.js proxy routes, React account center, pytest.

---

### Task 1: Telegram auth service

**Files:**
- Create: src/auth/telegram_group_pricing.py
- Test: 	ests/test_telegram_group_pricing.py

- [ ] Verify Telegram Login payload HMAC using bot token.
- [ ] Call Telegram getChatMember and treat member, dministrator, creator as group members.
- [ ] Return 5U/10U pricing payload.

### Task 2: Backend auth route

**Files:**
- Modify: web/core.py
- Modify: web/services/auth_api.py
- Modify: web/routers/auth.py

- [ ] Add TelegramLoginRequest model.
- [ ] Add POST /api/auth/telegram/login requiring Supabase identity.
- [ ] Link Telegram id to current Supabase user via DBManager.bind_supabase_identity.
- [ ] Return Telegram member status and effective price.

### Task 3: Payment dynamic price

**Files:**
- Modify: src/payments/contract_checkout.py
- Modify: web/services/payment_api.py

- [ ] At payment intent creation, check linked Telegram id and group membership.
- [ ] Override pro_monthly amount to 5U for members, 10U otherwise.
- [ ] Store pricing source in metadata.

### Task 4: Frontend Telegram Login entry

**Files:**
- Modify: rontend/components/account/AccountCenter.tsx
- Create: rontend/app/api/auth/telegram/login/route.ts

- [ ] Load Telegram Login widget with configured bot username.
- [ ] Send payload to backend proxy.
- [ ] Show group/member price status before checkout.

### Task 5: Verification

**Commands:**
- python -m pytest tests\test_telegram_group_pricing.py tests\test_direct_payment.py tests\test_payments_runtime.py -q
- python -m py_compile src\auth\telegram_group_pricing.py src\payments\contract_checkout.py web\core.py web\services\auth_api.py
- python -m ruff check src\auth\telegram_group_pricing.py src\payments\contract_checkout.py web\core.py web\services\auth_api.py tests\test_telegram_group_pricing.py
- cd frontend; npm run typecheck
