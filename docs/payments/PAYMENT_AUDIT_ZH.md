# PolyWeather 支付审计与防护说明

最后更新：`2026-03-21`

## 1. 当前已落地的防护

### 链下运行态

- 支付事件扫描与确认循环已把运行态写入 SQLite：
  - `payment_runtime_state`
  - `payment_audit_events`
- 关键循环现在会记录：
  - `event_loop_started`
  - `event_loop_cycle`
  - `event_loop_error`
  - `confirm_loop_started`
  - `confirm_loop_cycle`
  - `confirm_loop_error`

### 事件确认边界

- 后端只认链上 `OrderPaid` 事件。
- 前端提交 intent 不会直接视为支付完成。
- `confirm_loop` 会再次按链上交易与确认数校验 intent。
- 若确认失败，当前会明确把 intent / transaction 落为失败态，而不是长期停留在 `submitted`。

当前已显式识别的失败原因包括：

- `receiver_mismatch`
- `sender_mismatch`
- `event_mismatch`
- `tx_reverted`

### RPC 多节点容灾

- 支持 `POLYWEATHER_PAYMENT_RPC_URLS`
- 格式示例：

```env
POLYWEATHER_PAYMENT_RPC_URLS=https://polygon-rpc.com,https://polygon-bor-rpc.publicnode.com
```

- 启动时按顺序探活。
- 当前节点断连或收据查询失败时，会自动切换到下一个可用 RPC。

### 事件重放

- 已提供脚本：
  - [replay_payment_events.py](/E:/web/PolyWeather/scripts/replay_payment_events.py)

用途：
- 审计某个区块范围内的 `OrderPaid`
- 事后补查漏单
- 排查 RPC 抖动导致的监听遗漏

命令示例：

```bash
python scripts/replay_payment_events.py --from-block 10000000 --to-block 10001000
```

### 运行态检查

- 已提供接口：
  - `GET /api/payments/runtime`

可查看：
- checkout 配置摘要
- 当前活跃 RPC
- 候选 RPC 列表
- event loop 最新状态
- 最近审计事件

### Ops 事故单

现在 `/ops` 已提供单独的支付异常单列表，默认展示：

- `payment_intent_failed`

支持：

- 按 `reason` 过滤
- 标记已处理

这让下面这类事故不再需要翻日志定位：

- 已付款但未开通
- 打到旧收款地址
- 交易事件不匹配

## 2. 当前合约的授权边界

合约源码：
- [PolyWeatherCheckout.sol](/E:/web/PolyWeather/contracts/PolyWeatherCheckout.sol)

当前边界：

1. `owner`
- 可执行：
  - `setTreasury`
  - `setTokenAllowed`

2. 普通用户
- 只能调用：
  - `pay(orderId, planId, amount, token)`

3. 代币边界
- 只有 `allowedToken[token] == true` 的 token 可支付

4. 订单边界
- 同一个 `orderId` 只能成功支付一次

## 3. 重入与重复支付判断

当前合约的 `pay` 逻辑顺序是：

1. 检查 token allowlist
2. 检查 `amount > 0`
3. 检查 `paidOrder[orderId] == false`
4. 先写入 `paidOrder[orderId] = true`
5. 再执行 `transferFrom`
6. 发出 `OrderPaid`

这意味着：

- 同一 `orderId` 的重复支付会被拦住
- 典型“转账外部调用后再回调重复执行同订单”的路径会被 `paidOrder` 状态挡住

但要注意：

- 当前合约没有 `Pausable`
- 当前合约没有 `SafeERC20`
- 当前合约没有在链上校验 `planId -> amount`

所以它属于：
- **最小可用支付合约**
- 不是“全功能强防护合约”

## 4. 当前静态审计结论

已提供脚本：
- [check_payment_contract_security.py](/E:/web/PolyWeather/scripts/check_payment_contract_security.py)

命令：

```bash
python scripts/check_payment_contract_security.py
```

输出会检查这些项目：

- 是否有 `onlyOwner`
- `setTreasury` / `setTokenAllowed` 是否受 owner 保护
- constructor / setter 是否检查零地址
- 是否校验 allowlist
- 是否校验 `amount > 0`
- 是否校验重复订单
- 是否在 `transferFrom` 前写入 `paidOrder`
- 是否有 pause 开关
- 是否使用 SafeERC20
- 是否在链上绑定套餐价格

## 5. 当前主要剩余风险

1. 单地址 owner
- 建议把 `owner` 迁移到多签钱包

2. 无暂停开关
- 发现紧急问题时，无法直接暂停 `pay`

3. 金额校验主要在链下
- 当前 `planId / amount / token` 绑定主要靠后端 intent 和确认逻辑

4. ERC20 兼容性假设
- 当前使用 `IERC20.transferFrom`
- 升级版合约更建议改为 OpenZeppelin `SafeERC20`

## 6. 推荐操作

### 每次支付配置变更后

执行：

```bash
python scripts/check_payment_contract_security.py
python scripts/replay_payment_events.py --from-block <from> --to-block <to>
```

### 线上巡检

执行：

```bash
curl http://127.0.0.1:8000/api/payments/runtime
```

重点看：

- `rpc.active_rpc_url`
- `rpc.configured_rpc_count`
- `event_loop_state.last_scanned_block`
- `recent_audit_events`

如果你在 `/ops` 或脚本里看到：

- `receiver_mismatch`

其含义通常不是“缓存没刷新”，而是：

- 用户这笔交易的 `to` 地址不是当前生产收款合约
- 常见原因是旧页面、旧 deployment、旧钱包会话，或历史收款地址仍被命中

此时应优先做：

1. 确认链上真实 `to` 地址
2. 确认当前 `/api/payments/config` 返回的 `receiver_contract`
3. 如确已收款，再走人工恢复或补开订阅

### 按邮箱恢复最近支付

已提供脚本：

- [reconcile_subscription_by_email.py](/E:/web/PolyWeather/scripts/reconcile_subscription_by_email.py)

命令：

```bash
docker compose exec polyweather_web python scripts/reconcile_subscription_by_email.py --email user@example.com
```

适用场景：

- 用户声称已付费但未开通
- 需要快速确认最近一笔 intent 是否能自动恢复

## 7. 下一版合约建议

如果后续升级合约，优先级建议：

1. `Ownable` -> 多签 owner
2. `SafeERC20`
3. `Pausable`
4. 链上 plan/amount/token 绑定
5. 必要时增加 rescue/sweep 能力
