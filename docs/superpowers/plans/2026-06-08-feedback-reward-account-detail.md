# Feedback Reward Account Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see which submitted feedback earned points, how many points were awarded, and the reward reason in the account page.

**Architecture:** Store reward metadata directly on `user_feedback` rows so the existing feedback list API can expose the reward source without a separate ledger join. The account feedback panel renders reward state inline with each feedback item and stays silent for rows with no reward metadata.

**Tech Stack:** Python SQLite `DBManager`, FastAPI feedback service, Next.js/React account components, TypeScript source-based business tests.

---

## File Structure

- Modify `src/database/db_manager.py`: add reward columns, serialize them, and add `update_user_feedback_reward()` for future ops reward workflows.
- Modify `tests/test_user_feedback.py`: add backend coverage for reward defaults and reward metadata round trip.
- Modify `frontend/types/ops.ts`: add optional reward fields to `UserFeedbackEntry`.
- Modify `frontend/components/account/AccountFeedbackPanel.tsx`: render reward labels and reasons inside each feedback row.
- Modify `frontend/components/account/__tests__/accountFeedbackPanel.test.ts`: assert the panel handles reward display states.

---

### Task 1: Backend Feedback Reward Metadata

**Files:**
- Modify: `tests/test_user_feedback.py`
- Modify: `src/database/db_manager.py`

- [ ] **Step 1: Write the failing backend test**

Add this test to `tests/test_user_feedback.py`:

```python
def test_user_feedback_reward_metadata_round_trip(tmp_path):
    db = DBManager(str(tmp_path / "polyweather-feedback-reward.db"))

    created = db.append_user_feedback(
        category="data",
        message="Hong Kong COWIN reading was stale.",
        user_id="user-reward",
        user_email="reward@example.com",
    )

    assert created["reward_points"] == 0
    assert created["reward_reason"] == ""
    assert created["reward_status"] == ""
    assert created["rewarded_at"] is None

    rewarded = db.update_user_feedback_reward(
        created["id"],
        points=300,
        reason="Valid data freshness report",
        status="granted",
    )

    assert rewarded is not None
    assert rewarded["reward_points"] == 300
    assert rewarded["reward_reason"] == "Valid data freshness report"
    assert rewarded["reward_status"] == "granted"
    assert rewarded["rewarded_at"]

    row = db.list_user_feedback(
        limit=10,
        user_id="user-reward",
        user_email="reward@example.com",
    )[0]
    assert row["id"] == created["id"]
    assert row["reward_points"] == 300
    assert row["reward_reason"] == "Valid data freshness report"
    assert row["reward_status"] == "granted"
    assert row["rewarded_at"] == rewarded["rewarded_at"]
```

- [ ] **Step 2: Run the backend test and verify it fails**

Run:

```powershell
python -m pytest tests/test_user_feedback.py::test_user_feedback_reward_metadata_round_trip -q
```

Expected: failure because `reward_points` is missing or `update_user_feedback_reward` is undefined.

- [ ] **Step 3: Add reward columns and serialization**

In `src/database/db_manager.py`, update `user_feedback` schema and migration:

```python
reward_points INTEGER DEFAULT 0,
reward_reason TEXT DEFAULT '',
rewarded_at TIMESTAMP,
reward_status TEXT DEFAULT ''
```

Add `_ensure_column()` calls for the same columns in the existing migration block.

Update every feedback `SELECT` to include:

```sql
reward_points, reward_reason, rewarded_at, reward_status
```

Update `_feedback_row_to_dict()` to return:

```python
"reward_points": max(0, int(row["reward_points"] or 0)),
"reward_reason": str(row["reward_reason"] or ""),
"rewarded_at": row["rewarded_at"],
"reward_status": str(row["reward_status"] or ""),
```

- [ ] **Step 4: Add reward update method**

Add this method near `update_user_feedback_status()` in `src/database/db_manager.py`:

```python
def update_user_feedback_reward(
    self,
    feedback_id: int,
    *,
    points: int,
    reason: str = "",
    status: str = "granted",
) -> Optional[Dict[str, Any]]:
    safe_points = max(0, int(points or 0))
    normalized_reason = str(reason or "").strip()[:500]
    normalized_status = str(status or "").strip().lower()[:40]
    if not normalized_status:
        normalized_status = "granted" if safe_points > 0 else "skipped"
    now = datetime.now().isoformat()
    with self._get_connection() as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            UPDATE user_feedback
            SET reward_points = ?,
                reward_reason = ?,
                reward_status = ?,
                rewarded_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                safe_points,
                normalized_reason,
                normalized_status,
                now,
                now,
                int(feedback_id),
            ),
        )
        row = conn.execute(
            """
            SELECT id, category, message, source, status, contact, user_id,
                   user_email, context_json, reward_points, reward_reason,
                   rewarded_at, reward_status, created_at, updated_at
            FROM user_feedback
            WHERE id = ?
            """,
            (int(feedback_id),),
        ).fetchone()
        conn.commit()
    return self._feedback_row_to_dict(row) if row else None
```

- [ ] **Step 5: Run backend tests**

Run:

```powershell
python -m pytest tests/test_user_feedback.py -q
```

Expected: all `test_user_feedback.py` tests pass.

---

### Task 2: Account Feedback Reward Display

**Files:**
- Modify: `frontend/types/ops.ts`
- Modify: `frontend/components/account/AccountFeedbackPanel.tsx`
- Modify: `frontend/components/account/__tests__/accountFeedbackPanel.test.ts`

- [ ] **Step 1: Write the failing frontend test**

Extend the final assertion in `frontend/components/account/__tests__/accountFeedbackPanel.test.ts` or add a new assertion:

```ts
assert(
  feedbackPanelSource.includes("reward_points") &&
    feedbackPanelSource.includes("reward_reason") &&
    feedbackPanelSource.includes("reward_status") &&
    feedbackPanelSource.includes("formatRewardPoints") &&
    feedbackPanelSource.includes("renderFeedbackReward") &&
    feedbackPanelSource.includes("奖励原因"),
  "account feedback panel must show per-feedback reward points and reward reasons",
);
```

- [ ] **Step 2: Run the frontend business test and verify it fails**

Run:

```powershell
cd frontend; npm run test:business -- accountFeedbackPanel
```

Expected: failure because the panel does not yet reference the reward fields.

- [ ] **Step 3: Extend frontend type**

Add optional fields to `UserFeedbackEntry` in `frontend/types/ops.ts`:

```ts
  reward_points?: number;
  reward_reason?: string;
  rewarded_at?: string | null;
  reward_status?: string;
```

- [ ] **Step 4: Add account reward rendering helpers**

In `AccountFeedbackPanel.tsx`, add helpers:

```tsx
function formatRewardPoints(points?: number) {
  const value = Math.max(0, Number(points || 0));
  return `+${value.toLocaleString()} points`;
}

function rewardStatusText(status?: string, isEn = false) {
  const key = String(status || "").toLowerCase();
  if (key === "pending") return isEn ? "Reward pending" : "奖励待处理";
  if (key === "skipped") return isEn ? "No points awarded" : "未发放积分";
  return isEn ? "Feedback reward" : "反馈奖励";
}

function renderFeedbackReward(entry: UserFeedbackEntry, isEn: boolean) {
  const points = Math.max(0, Number(entry.reward_points || 0));
  const rewardStatus = String(entry.reward_status || "").toLowerCase();
  const reason = String(entry.reward_reason || "").trim();
  if (points <= 0 && !rewardStatus && !reason) return null;
  const granted = points > 0 || rewardStatus === "granted";
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
      granted
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-50 text-slate-600"
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{rewardStatusText(rewardStatus, isEn)}</span>
        {points > 0 ? <span className="font-mono font-black">{formatRewardPoints(points)}</span> : null}
      </div>
      {reason ? (
        <div className="mt-1 leading-5 text-slate-600">
          {isEn ? "Reason" : "奖励原因"}: {reason}
        </div>
      ) : null}
      {entry.rewarded_at ? (
        <div className="mt-1 font-mono text-[11px] text-slate-400">
          {compactDate(entry.rewarded_at)}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Render reward detail in each feedback row**

Inside each feedback row, after the feedback message paragraph, add:

```tsx
{renderFeedbackReward(entry, isEn)}
```

- [ ] **Step 6: Run frontend business test**

Run:

```powershell
cd frontend; npm run test:business -- accountFeedbackPanel
```

Expected: `accountFeedbackPanel` passes.

---

### Task 3: Verification and Commit

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run targeted backend verification**

Run:

```powershell
python -m pytest tests/test_user_feedback.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run targeted frontend verification**

Run:

```powershell
cd frontend; npm run test:business -- accountFeedbackPanel
```

Expected: `accountFeedbackPanel` test passes.

- [ ] **Step 3: Run broader low-cost verification**

Run:

```powershell
python -m ruff check .
cd frontend; npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 4: Check status and commit**

Run:

```powershell
git status --short
git diff --check
git add docs/superpowers/plans/2026-06-08-feedback-reward-account-detail.md tests/test_user_feedback.py src/database/db_manager.py frontend/types/ops.ts frontend/components/account/AccountFeedbackPanel.tsx frontend/components/account/__tests__/accountFeedbackPanel.test.ts
git commit -m "Show feedback reward details in account"
```

Expected: commit succeeds with only planned files staged.

---

## Self-Review

- Spec coverage: reward metadata fields, existing API payload, account inline display, missing metadata fallback, and future ops reuse are covered.
- Scope control: the plan does not implement automatic reward issuance or external notifications.
- Type consistency: frontend fields use `reward_points`, `reward_reason`, `rewarded_at`, and `reward_status`, matching backend serialization.
