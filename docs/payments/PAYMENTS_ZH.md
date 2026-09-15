# PolyWeather 支付文档

> 由 PAYMENT_AUDIT_ZH.md + PAYMENT_UPGRADE_V2_ZH.md + POLYGONSCAN_VERIFY.md 合并（2026-09-15）

最后更新：`2026-09-15`

版本：`v1.9.1`

---

## 一、当前合约（V1，已部署）

合约源码：[contracts/PolyWeatherCheckout.sol](/E:/web/PolyWeather/contracts/PolyWeatherCheckout.sol)

当前属于**最小可用支付合约**，不是全功能强防护合约。

### 授权边界

1. `owner`
   - 可执行：`setTreasury`、`setTokenAllowed`
2. 普通用户
   - 只能调用：`pay(orderId, planId, amount, token)`
3. 代币边界
   - 只有 `allowedToken[token] == true` 的 token 可支付
4. 订单边界
   - 同一个 `orderId` 只能成功支付一次

### 重入与重复支付

`pay` 逻辑顺序：

1. 检查 token allowlist
2. 检查 `amount > 0`
3. 检查 `paidOrder[orderId] == false`
4. **先写入** `paidOrder[orderId] = true`
5. 再执行 `transferFrom`
6. 发出 `OrderPaid`

同一 `orderId` 的重复支付会被拦住；典型「转账外部调用后再回调重复执行同订单」的路径会被 `paidOrder` 状态挡住。

### 已知局限

- 没有 `Pausable`
- 没有 `SafeERC20`
- 没有在链上校验 `planId -> amount`

这些正是 V2 要解决的（见第五节）。

---

## 二、支付链路

当前支持两类链路：

### 1. Polygon checkout 合约

- 前端钱包支付会先切到 Polygon。
- 后端创建 intent 后给出合约 `tx_payload`。
- 确认时校验 `OrderPaid(orderId, payer, planId, amount, token)`。

### 2. Ethereum 主网 USDC 直转

- 前端展示 Ethereum 网络、USDC 合约、收款钱包和金额。
- 用户提交 tx hash 后，后端按 `intent.chain_id=1` 查询 Ethereum RPC。
- 确认时校验 USDC `Transfer(from, to, amount)` 的 `to`、`token_address` 和金额。
- 这条链路不依赖 Polygon checkout 合约，适合处理「用户钱包默认网络付款」的真实行为。

---

## 三、审计与防护（已落地）

### 链下运行态

支付事件扫描与确认循环已把运行态写入 SQLite：

- `payment_runtime_state`
- `payment_audit_events`

关键循环记录事件：

- `event_loop_started` / `event_loop_cycle` / `event_loop_error`
- `confirm_loop_started` / `confirm_loop_cycle` / `confirm_loop_error`

### 事件确认边界

- 后端只认链上可验证事件：checkout 合约路径认 `OrderPaid`，直转路径认对应链上 USDC `Transfer`。
- 前端提交 intent 不会直接视为支付完成。
- `confirm_loop` 会再次按 intent 的 `chain_id`、`token_address`、收款地址、金额与确认数校验链上交易。
- 若确认失败，当前会明确把 intent / transaction 落为失败态，而不是长期停留在 `submitted`。

已显式识别的失败原因：

- `receiver_mismatch`
- `sender_mismatch`
- `event_mismatch`
- `token_mismatch`
- `tx_reverted`

### RPC 多节点容灾

```env
POLYWEATHER_PAYMENT_RPC_URLS=https://polygon-rpc.com,https://polygon-bor-rpc.publicnode.com
POLYWEATHER_PAYMENT_RPC_URLS_BY_CHAIN_JSON={"137":["https://polygon-rpc.com","https://polygon-bor-rpc.publicnode.com"],"1":["https://ethereum-rpc.example"]}
```

- 启动时按顺序探活。
- 当前节点断连或收据查询失败时，会自动切换到下一个可用 RPC。
- 多链支付确认不会用默认链硬查交易；每笔 intent 会按自己的 `chain_id` 选择 RPC。

### Ops 事故单

`/ops` 提供支付异常单列表，默认展示 `payment_intent_failed`，支持按 `reason` 过滤和标记已处理。

这让以下事故不再需要翻日志定位：

- 已付款但未开通
- 打到旧收款地址
- 交易事件不匹配
- 用户在钱包默认 Ethereum 网络付款，但旧系统只按 Polygon intent 查账

---

## 四、巡检与恢复脚本

### 每次支付配置变更后

```bash
python scripts/check_payment_contract_security.py
python scripts/replay_payment_events.py --from-block <from> --to-block <to>
```

`check_payment_contract_security.py` 输出检查项：

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

### 线上巡检

```bash
curl http://127.0.0.1:8000/api/payments/runtime
```

重点看：

- `rpc.active_rpc_url`
- `rpc.configured_rpc_count`
- `event_loop_state.last_scanned_block`
- `recent_audit_events`

### `receiver_mismatch` 的含义

不是「缓存没刷新」，而是：

- 用户这笔交易的 `to` 地址不是当前生产收款合约
- 常见原因是旧页面、旧 deployment、旧钱包会话，或历史收款地址仍被命中

处理顺序：

1. 确认链上真实 `to` 地址
2. 确认当前 `/api/payments/config` 返回的 `receiver_contract`
3. 如确已收款，再走人工恢复或补开订阅

### 按邮箱恢复最近支付

```bash
docker compose exec polyweather_web python scripts/reconcile_subscription_by_email.py --email user@example.com
```

适用：用户声称已付费但未开通，需快速确认最近一笔 intent 是否能自动恢复。

### 事件重放

```bash
python scripts/replay_payment_events.py --from-block 10000000 --to-block 10001000
```

用途：审计某区块范围内的 `OrderPaid`、事后补查漏单、排查 RPC 抖动导致的监听遗漏。

---

## 五、V2 升级路线（草案，尚未部署）

> 现网合约仍为 V1；V2 只是升级草案。本文节既是升级计划，也记录 V1 的剩余风险。

### V1 主要剩余风险

1. 单地址 owner —— 建议迁移到多签钱包
2. 无暂停开关 —— 发现紧急问题时无法直接暂停 `pay`
3. 金额校验主要在链下 —— `planId / amount / token` 绑定主要靠后端 intent 和确认逻辑
4. ERC20 兼容性假设 —— 当前使用 `IERC20.transferFrom`，建议改用 `SafeERC20`

### V2 新增能力

合约草案：[contracts/PolyWeatherCheckoutV2.sol](/E:/web/PolyWeather/contracts/PolyWeatherCheckoutV2.sol)

1. **多签 owner**：constructor 显式传入 `initialOwner` / `initialTreasury` / `initialSigner`，部署后可直接把多签地址设为 `owner`，不需要先单签部署再补 transfer。
2. **SafeERC20**：内置最小 `safeTransferFrom` / `safeTransfer` 封装，对非标准 ERC20 兼容性更稳。
3. **Pausable**：`pause()` / `unpause()` 保护 `payPlan(...)` 与 `payAuthorized(...)`（`whenNotPaused`）。发现 treasury / allowlist / signer 异常时可直接暂停支付入口。
4. **ReentrancyGuard**：`nonReentrant` 保护 `payPlan`、`payAuthorized`、`rescueToken`。
5. **链上套餐绑定**：`setPlan(planId, token, amount, active)` + `planConfig[planId][token]`。`payPlan` 会校验 token allowed、plan active，并从链上读取 amount。
6. **EIP-712 授权支付**：`payAuthorized(...)` 适合临时折扣 / 活动价，校验 `orderId / payer / planId / token / amount / nonce / deadline`，签名人地址由 `signer` 统一控制。

### 两条支付路径怎么选

- **路线 A（链上套餐绑定 `payPlan`）**：合约级约束最强、更容易审计；缺点是套餐改价需要 owner 交易。适合月付/季付这类稳定商品。
- **路线 B（EIP-712 授权 `payAuthorized`）**：活动价灵活、不必每次改链上 plan；缺点是需要管理 signer 密钥，风险从 owner 单点部分转移到 signer 运维。适合促销、临时折扣、白名单价格。

**生产建议不是二选一**：稳定套餐走 `payPlan`，特殊场景走 `payAuthorized`。

### 推荐迁移步骤

1. 先部署 V2 到测试环境
2. `owner` 直接用多签地址
3. 配置 `treasury`
4. 配置 `allowedToken`
5. 配置 `planId/token/amount`
6. 仅在需要活动价时再配置 `signer`
7. 用事件重放脚本和运行态接口验证
8. 再切生产前端/后端配置到新 `receiver_contract`

---

## 六、PolygonScan 源码验证

对生产收款合约完成源码验证，降低钱包风控误报并提升用户信任。

当前 PolygonScan 验证流程默认针对 **V1**。

### 部署参数（示例）

- 链：Polygon Mainnet（`chainId=137`）
- 合约：`PolyWeatherCheckout`
- 编译器：`v0.8.24+commit.e11b9ed9`
- 优化器：`Enabled`，`runs=200`

> 实际地址以线上配置为准：`POLYWEATHER_PAYMENT_RECEIVER_CONTRACT`。

### 构造参数编码

```bash
python scripts/encode_checkout_constructor.py \
  --token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 \
  --treasury 0xe581D578EF101c80e3F32263e97E6eA28A0B170e
```

将输出填入 PolygonScan 的 `Constructor Arguments ABI-encoded`。

### 操作步骤

1. 打开合约页 -> `Contract` -> `Verify and Publish`。
2. 选择 `Solidity (Single file)`。
3. 粘贴 `contracts/PolyWeatherCheckout.sol` 源码。
4. 填写编译器/优化器参数。
5. 粘贴构造参数并提交。

### 验证后检查

- `Read Contract`：可见 `owner / treasury / allowedToken / paidOrder`
- `Write Contract`：可见 `pay / setTreasury / setTokenAllowed`
- 标签显示 `Contract Source Code Verified`

### 双币种开启（USDC + USDC.e）

验证后可通过 `setTokenAllowed` 开启两种代币：

- USDC.e: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Native USDC: `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`

### 说明

- 源码验证能显著降低「欺诈/不可信」误报，但钱包风险缓存更新存在延迟。
- 生产商用环境可使用私有升级版合约；公开仓库保留标准实现与验证流程。
- 升级到 V2 后，改用 `scripts/encode_checkout_v2_constructor.py`（`--owner / --treasury / --signer`）。
