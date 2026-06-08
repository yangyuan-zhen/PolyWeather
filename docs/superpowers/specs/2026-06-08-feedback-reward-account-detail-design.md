# Feedback Reward Account Detail Design

## Goal

Show users which submitted feedback earned points, how many points were awarded, and why.

The first implementation focuses on account-page visibility. The later ops workflow for automatic reward issuance should reuse the same fields and display contract.

## Current Context

- `user_feedback` already stores each submitted feedback item with `status`, `message`, `user_id`, `user_email`, timestamps, and context JSON.
- `/api/feedback` already returns the current user's feedback list.
- `AccountFeedbackPanel` already renders the current user's feedback in the account page.
- Current points balance is shown through `/api/auth/me`, but account UI has no per-feedback reward source detail.
- Existing points grant helpers update `users.points`; feedback-specific rewards are not yet linked back to a feedback row.

## Scope

In scope:

- Add feedback reward metadata to feedback rows.
- Return reward metadata through the existing current-user feedback API.
- Display feedback reward details in the account page next to the matching feedback item.
- Keep the data contract ready for future ops automation: a processed feedback item can carry reward points and a human-readable reason.

Out of scope for this phase:

- Building the ops action that decides and grants points.
- Sending push/email/Telegram notifications after ops processing.
- Rebuilding a general points ledger for all point sources.
- Merging historical Supabase referral ledger entries into the account page.

## Data Model

Extend `user_feedback` with nullable columns:

- `reward_points INTEGER DEFAULT 0`
- `reward_reason TEXT DEFAULT ''`
- `rewarded_at TIMESTAMP`
- `reward_status TEXT DEFAULT ''`

Recommended `reward_status` values:

- empty string: no reward decision recorded
- `granted`: points were awarded for this feedback
- `skipped`: reviewed but no points awarded
- `pending`: reward decision is queued or awaiting processing

The display should treat `reward_points > 0` as the strongest signal that the user earned points.

## API Contract

`DBManager._feedback_row_to_dict()` should include:

- `reward_points`
- `reward_reason`
- `rewarded_at`
- `reward_status`

`GET /api/feedback` should continue using the same response shape:

```json
{
  "feedback": [
    {
      "id": 123,
      "status": "resolved",
      "message": "Hong Kong COWIN reading looked stale",
      "reward_points": 300,
      "reward_reason": "Valid data freshness report",
      "rewarded_at": "2026-06-08T12:00:00",
      "reward_status": "granted"
    }
  ]
}
```

The frontend proxy does not need a new route if it transparently forwards the existing payload.

## Account UI

`AccountFeedbackPanel` should show reward detail inside each feedback row:

- Granted reward: `+300 points` plus reward reason.
- Skipped reward: a muted note that no points were awarded, with reason if available.
- Pending reward: a small pending label.
- No reward metadata: render nothing extra to avoid noise.

The account page should remain dense and scannable. Reward content belongs inside the existing feedback row, not in a separate marketing-style card.

## Future Ops Workflow

The later feedback-processing feature can use a single backend operation:

1. Update feedback status.
2. Grant points to the matching user.
3. Write `reward_points`, `reward_reason`, `rewarded_at`, and `reward_status = granted` back to the same feedback row.

If the grant fails, the operation should not mark the feedback as granted. It should either keep `reward_status = pending` or return a clear ops error.

## Error Handling

- Missing reward fields should default to zero or empty strings in API responses.
- If old SQLite databases do not have the new columns, `DBManager` migration should add them with `_ensure_column`.
- Account UI should tolerate partial payloads without crashing.
- Reward reason should be bounded in storage and display to avoid oversized rows.

## Testing

Backend tests:

- Existing feedback rows serialize reward fields with defaults.
- Updating reward metadata for a feedback row returns the fields in `/api/feedback`.
- Old rows without rewards still list normally.

Frontend tests:

- Account feedback panel displays `+N points` and reason for rewarded feedback.
- Skipped and pending reward states render without implying points were granted.
- Rows without reward metadata do not show an empty reward block.

## Rollout

This is a backward-compatible schema and UI change. Existing feedback rows keep working with empty reward metadata. The account page can ship before the ops reward action; it will simply show reward details once rows carry those fields.
