# ADR-002 Gate 跨进程锁只过期不释放，保持现状

- 现状：`observation_source_gate._acquire_cross_process_cooldown` 拿 DB 锁后靠 TTL
  过期互斥；`interval < ttl` 时多进程可互相饿死（返回旧值/None），但均为可解释
  的降级（记 `no_results`，不崩溃）。
- 决策：不改锁语义。`DB_LOCK_ENABLED=false` 可旁路（测试用）。
- 下一步：需要时给锁加 owner 心跳 + 主动释放；当前失败 cooldown 仅 30s，影响面小。
