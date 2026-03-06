# Commercialization Plan

## Product Direction

PolyWeather is being positioned as a paid weather intelligence product built around:
- Web dashboard subscription
- Telegram paid group subscription
- Fast, rules-based weather alerting
- High-confidence Ankara specialization

Current pricing target:
- Web dashboard: $5 / month
- Telegram paid group: $1 / month

Current payment direction under discussion:
- Polygon / USDC

Important current state:
- Polymarket market-price integration has been removed from the codebase
- The current product focuses on weather intelligence, not exchange/orderbook execution data

## Production Architecture

### Web
- Next.js frontend on Vercel
- Public URL: `https://polyweather-pro.vercel.app/`
- FastAPI backend serves API only

### Backend
- FastAPI on VPS
- Shared analysis layer for web and bot
- City data cache in-process

### Telegram
- Bot runs on VPS
- Paid group receives proactive alerts
- Push engine includes dedupe, cooldown, and late-day suppression

## Alert Product Strategy

Current alert strategy is weather-first:
- Ankara Center reached DEB
- Momentum spike
- Forecast breakthrough
- Advection / nearby lead station

Operational controls already implemented:
- Same city + same trigger type only pushes once while active
- City-level cooldown
- Peak-passed suppression for late-day rollover

Ankara special handling:
- Center signal only uses `Ankara (Bolge/Center)` / `17130`
- This should remain a product differentiator and be documented clearly in sales copy

## Recommended Subscription Structure

### Tier A: Telegram Group
- Price: $1 / month
- Value proposition:
  - Real-time proactive weather alerts
  - Fast anomaly delivery
  - Focused operational signal, minimal clutter
- Suggested restrictions:
  - No raw API access
  - No historical analytics export
  - No advanced chart controls

### Tier B: Web Dashboard
- Price: $5 / month
- Value proposition:
  - Full city dashboard
  - Trend and nearby-station visualization
  - Multi-model comparison
  - Historical view
- Suggested restrictions:
  - View-only unless future premium tools are added

### Bundle Option
- Optional future bundle: Web + Group
- Use only if conversion data shows users want both together

## Payment Roadmap

### Phase 1: Manual Ops
- User pays manually
- Operator manually activates web access / Telegram access
- Lowest engineering cost, fastest launch

### Phase 2: Polygon / USDC Automation
- Generate unique deposit address or payment intent
- Confirm on-chain payment
- Activate subscription automatically
- Telegram bot issues one-time group invite link

### Phase 3: Full Subscription Management
- Renewal reminders
- Grace period handling
- Automatic expiry / revocation
- Self-serve billing status page

## Recommended Near-Term Roadmap

### Step 1: Stabilize Current Product
- Finish cleaning docs and deployment flow
- Keep Vercel as the only web entry point
- Keep backend API-only
- Tune Telegram cooldown and trigger quality

### Step 2: Launch Manual Paid Beta
- Start with a small paid Telegram group
- Start web dashboard on invite basis
- Track which alert types users actually value

### Step 3: Add Access Control
- Web login and session layer
- Subscription table in backend
- Telegram membership verification

### Step 4: Add Polygon / USDC Collection
- Payment detection
- Subscription activation
- One-time Telegram invite issuance

## Metrics To Track

Minimum metrics before scaling:
- Alert-to-action usefulness feedback
- Daily active dashboard users
- Telegram retention after first payment cycle
- Most valuable cities by engagement
- False-positive complaint rate for alerts

## Constraints To Keep In Mind

- The current system is strongest in weather intelligence, not execution plumbing
- Ankara is a differentiated niche and should be treated as premium signal inventory
- Over-pushing alerts will destroy paid-group value faster than under-pushing
- Payment automation should come after alert quality is operationally stable

Last updated: 2026-03-06
