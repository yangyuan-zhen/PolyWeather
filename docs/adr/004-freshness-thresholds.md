# ADR-004 新鲜度双阈值：权威入口收敛到 data_quality

- 现状：`country_networks` 的 `sync_status`（stale>60m，管 intraday 可用性）与
  `observation_freshness` 画像（分源 `stale_after` 2700/3600s，管展示新鲜度）
  口径不同，同一 obs 可给出矛盾标签。
- 决策：API（`city_observation`）、快照（`data_quality_api`）、Ops 统一走
  `data_quality.evaluate_observation`；`sync_status` 仅保留为 intraday 可用标志，
  不再向展示层扩散。
- 下一步：若需彻底统一，把 `sync_status` 改为调用同一画像（小改动，另排期）。
