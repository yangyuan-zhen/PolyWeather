# Growth Milestone Pro Rewards Design

## Goal

Reward active paid Pro members with additional membership time when PolyWeather
reaches verified-user growth milestones.

## Confirmed Rules

- Growth is measured using verified Supabase Auth users.
- The historical launch baseline is:
  - 588 total registered users
  - 573 verified users
  - recorded on 2026-06-12
- Milestones and rewards:
  - 600 verified users: +1 Pro day
  - 750 verified users: +2 Pro days
  - 1000 verified users: +3 Pro days
  - every additional 100 verified users after 1000: +3 Pro days
- Each milestone settles at most once.
- Only users who currently have active membership access and have at least one
  confirmed real payment are eligible.
- Trial-only, manual-grant-only, and reward-only users are excluded.

## Architecture

The Telegram Bot process already acts as the single background-job owner. A new
growth milestone loop runs there on a low-frequency interval. It reads verified
Auth-user counts, writes one daily growth snapshot, checks unsettled milestones,
selects eligible paid members, and grants an append-only bonus subscription
window.

SQLite stores daily snapshots, milestone settlement summaries, and per-user
payout records. Supabase stores the actual bonus subscription. The bonus source
contains the milestone number so a retry can detect an already-issued reward.

## Failure Handling

- Supabase read failures do not advance or settle a milestone.
- Successful user payouts are recorded individually.
- Failed payouts are retried on the next loop run.
- A milestone is marked settled only when all eligible payouts succeed.
- Bonus subscription writes use a milestone-specific source as an additional
  idempotency guard.

## Notification

After a milestone settles, the Bot posts one concise bilingual group
announcement when announcements are enabled. It includes the milestone, reward
days, and rewarded member count.

