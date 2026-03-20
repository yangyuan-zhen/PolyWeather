# PolyWeather 支付合约升级方案（V2）

最后更新：`2026-03-20`

## 1. 目标

本次 V2 方案对应三个明确目标：

1. 把 `owner` 迁到多签地址
2. 升级到 `SafeERC20 + Pausable + ReentrancyGuard`
3. 把“链上 plan 绑定”和“EIP-712 授权支付”都纳入设计，而不是只在链下校验

合约草案：
- [PolyWeatherCheckoutV2.sol](/E:/web/PolyWeather/contracts/PolyWeatherCheckoutV2.sol)

构造参数编码脚本：
- [encode_checkout_v2_constructor.py](/E:/web/PolyWeather/scripts/encode_checkout_v2_constructor.py)

## 2. V2 新增能力

### 多签 owner

V2 constructor 不再默认 `msg.sender` 作为唯一 owner，而是显式传入：

- `initialOwner`
- `initialTreasury`
- `initialSigner`

这意味着：
- 部署后可直接把多签地址设为 `owner`
- 不需要先单签部署再补 transfer

### SafeERC20

V2 内置最小 `SafeERC20` 封装：

- `safeTransferFrom`
- `safeTransfer`

相比直接依赖 `IERC20.transferFrom -> bool`：
- 对非标准 ERC20 的兼容性更稳
- 出错边界更明确

### Pausable

V2 增加：

- `pause()`
- `unpause()`

支付入口：

- `payPlan(...)`
- `payAuthorized(...)`

都受 `whenNotPaused` 保护。

一旦发现：
- treasury 配置错误
- token allowlist 配置错误
- 签名器异常
- 链上风控问题

可以直接暂停支付入口。

### ReentrancyGuard

V2 增加 `nonReentrant`，保护：

- `payPlan`
- `payAuthorized`
- `rescueToken`

虽然当前订单去重已经能挡住典型重复支付路径，但 `ReentrancyGuard` 仍然是更稳的防线。

### 链上套餐绑定

V2 新增：

- `setPlan(planId, token, amount, active)`
- `planConfig[planId][token]`

正式支付入口 `payPlan` 会：

1. 校验 token 已 allowed
2. 校验 `planId + token` 的 plan 已 active
3. 从链上读取 amount
4. 按链上配置收款

这意味着：
- `planId / amount / token` 绑定不再完全依赖链下

### EIP-712 授权支付

V2 同时保留第二条入口：

- `payAuthorized(...)`

它适合：
- 临时折扣
- 特殊活动价
- 不想每次都上链改 `setPlan`

校验字段包括：

- `orderId`
- `payer`
- `planId`
- `token`
- `amount`
- `nonce`
- `deadline`

签名人地址由：

- `signer`

统一控制。

## 3. 两条支付路径怎么选

### 路线 A：链上套餐绑定优先

优点：
- 最直观
- 合约级约束最强
- 更容易审计

缺点：
- 套餐改价需要 owner 交易

适合：
- 月付/季付/年付这类稳定商品

### 路线 B：EIP-712 授权优先

优点：
- 活动价灵活
- 不必每次改链上 plan

缺点：
- 需要管理 signer 密钥
- 风险从 owner 单点，部分转移到 signer 运维

适合：
- 促销
- 临时折扣
- 白名单价格

### 当前建议

生产建议不是二选一，而是：

1. **稳定套餐** 走 `payPlan`
2. **特殊场景** 走 `payAuthorized`

这样：
- 主流程更稳
- 特殊价仍保留灵活性

## 4. 推荐迁移步骤

1. 先部署 V2 到测试环境
2. `owner` 直接用多签地址
3. 配置 `treasury`
4. 配置 `allowedToken`
5. 配置 `planId/token/amount`
6. 仅在需要活动价时再配置 `signer`
7. 用事件重放脚本和运行态接口验证
8. 再切生产前端/后端配置到新 `receiver_contract`

## 5. 构造参数编码

示例：

```bash
python scripts/encode_checkout_v2_constructor.py \
  --owner 0xYourMultiSig \
  --treasury 0xYourTreasury \
  --signer 0xYourBackendSigner
```

## 6. 当前判断

V2 已经把这三件事做成了明确方案：

1. 多签 owner
2. SafeERC20 + Pausable + ReentrancyGuard
3. 链上 plan 绑定 + EIP-712 授权

它现在是**升级草案**，不是现网已部署合约。

如果要真正上线，下一步就是：

1. 做一次测试网或本地链验证
2. 更新 PolygonScan 验证文档
3. 修改后端 `receiver_contract` 配置
