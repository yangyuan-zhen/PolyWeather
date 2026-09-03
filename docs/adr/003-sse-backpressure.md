# ADR-003 SSE 背压：队列满丢头 + 240s 断连，保持现状

- 现状：`sse_manager` 单连接队列 256 满丢头；`MAX_CONNECTION 240s` 强制断开；
  `GET /api/events` 按 `since_revision` 重放，gap 过大直接 `resync_required` 全量。
- 决策：不改。重放/断线续播已有 `test_sse_replay` 与本轮 chaos（fallback 切换期
  重连）覆盖。
- 下一步：弱网前端若 resync 频繁，可调大 `replay_limit` 或按城市分流订阅。
