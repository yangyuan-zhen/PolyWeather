# DEB 训练快照归档修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让训练结算分析在保持 panel 轻量返回的同时，可靠归档概率快照和日内 DEB 快照，使 lead 训练不再因 `panel/full` 模式不一致而全部回退到 lead=1。

**Architecture:** 为 `_analyze` 增加显式的 `archive_training_snapshots` 开关。训练 worker 通过默认分析 runner 开启该开关；普通 API 调用保持原行为。归档函数返回成功状态，由分析结果携带本次归档状态，训练结算结果汇总成功/失败数量，便于线上健康检查。

**Tech Stack:** Python 3.11、FastAPI 分析服务、SQLite repository、pytest。

---

### Task 1: 增加训练 runner 的归档契约回归测试

**Files:**
- Modify: `tests/test_training_settlement_service.py`
- Test: `tests/test_training_settlement_service.py`

- [ ] **Step 1: Write the failing test**

增加测试，替换 `_analyze`，断言默认训练 runner 使用 `detail_mode="panel"` 且传入 `archive_training_snapshots=True`。

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_training_settlement_service.py -k default_analysis_runner -q`

Expected: FAIL，因为当前 runner 没有传入归档开关。

- [ ] **Step 3: Implement the minimal code**

把训练默认 runner 改为调用 `_analyze(..., archive_training_snapshots=True)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_training_settlement_service.py -k default_analysis_runner -q`

Expected: PASS。

### Task 2: 增加分析服务的可选归档开关

**Files:**
- Modify: `web/analysis_service.py`
- Test: `tests/test_analysis_service.py`（若已有对应测试文件则追加；否则在现有 analysis 测试位置追加）

- [ ] **Step 1: Write the failing test**

验证 `archive_training_snapshots=False` 时不归档，`True` 时同时调用概率和日内快照归档函数，并且普通 full 分析仍保持归档行为。

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_analysis_service.py -k archive_training_snapshots -q`

Expected: FAIL，因为 `_analyze` 当前没有这个参数。

- [ ] **Step 3: Implement the minimal code**

新增 keyword-only 参数，归档条件改成 `normalized_detail_mode == "full" or archive_training_snapshots`，不改变返回 payload 的 detail mode。

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_analysis_service.py -k archive_training_snapshots -q`

Expected: PASS。

### Task 3: 汇总归档状态并验证全链路

**Files:**
- Modify: `web/analysis_service.py`
- Modify: `web/training_settlement_worker.py`
- Modify: `tests/test_training_settlement_service.py`

- [ ] **Step 1: Write the failing test**

验证归档函数失败时不会中断分析，但结果包含可识别的失败状态；训练结算结果汇总分析城市的归档成功/失败数量。

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_training_settlement_service.py -k snapshot -q`

Expected: FAIL，因为当前归档函数无状态返回且 worker 不汇总。

- [ ] **Step 3: Implement the minimal code**

让两个归档函数返回 bool，分析结果记录 `training_snapshot_archive`，worker 汇总 `archived/failed/skipped`，不改变异常降级策略。

- [ ] **Step 4: Run focused and full tests**

Run: `python -m pytest tests/test_training_settlement_service.py tests/test_analysis_service.py -q`

Expected: PASS。

Run: `python -m ruff check .`

Expected: `All checks passed!`。

Run: `python -m pytest -q`

Expected: all tests pass。

