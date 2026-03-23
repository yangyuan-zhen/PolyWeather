# PolyWeatherCheckout PolygonScan 验证（v1.5.1）

最后更新：`2026-03-20`

## 1. 目标

对生产收款合约完成源码验证，降低钱包风控误报并提升用户信任。

当前说明：

- **现网合约仍为 V1**：`contracts/PolyWeatherCheckout.sol`
- **V2 只是升级草案**：`contracts/PolyWeatherCheckoutV2.sol`
- 当前 PolygonScan 验证流程默认针对 V1

## 2. 当前部署参数（示例）

- 链：Polygon Mainnet（`chainId=137`）
- 合约：`PolyWeatherCheckout`
- 编译器：`v0.8.24+commit.e11b9ed9`
- 优化器：`Enabled`，`runs=200`

> 实际地址以线上配置为准：`POLYWEATHER_PAYMENT_RECEIVER_CONTRACT`。

## 3. 构造参数编码

使用仓库脚本生成构造参数：

```bash
python scripts/encode_checkout_constructor.py \
  --token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 \
  --treasury 0xe581D578EF101c80e3F32263e97E6eA28A0B170e
```

将输出填入 PolygonScan 的 `Constructor Arguments ABI-encoded`。

## 4. PolygonScan 操作步骤

1. 打开合约页 -> `Contract` -> `Verify and Publish`。
2. 选择 `Solidity (Single file)`。
3. 粘贴 `contracts/PolyWeatherCheckout.sol` 源码。
4. 填写编译器/优化器参数。
5. 粘贴构造参数并提交。

## 5. 验证后检查

- `Read Contract`：可见 `owner / treasury / allowedToken / paidOrder`
- `Write Contract`：可见 `pay / setTreasury / setTokenAllowed`
- 标签显示 `Contract Source Code Verified`

## 6. 双币种开启（USDC + USDC.e）

验证后可通过 `setTokenAllowed` 开启两种代币：

- USDC.e: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Native USDC: `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`

## 7. V2 说明（尚未部署）

如果后续升级到 V2，请改用：

```bash
python scripts/encode_checkout_v2_constructor.py \
  --owner 0xYourMultiSig \
  --treasury 0xYourTreasury \
  --signer 0xYourBackendSigner
```

V2 相关文档：

- [PAYMENT_UPGRADE_V2_ZH.md](/E:/web/PolyWeather/docs/payments/PAYMENT_UPGRADE_V2_ZH.md)
- [PAYMENT_AUDIT_ZH.md](/E:/web/PolyWeather/docs/payments/PAYMENT_AUDIT_ZH.md)

## 8. 说明

- 源码验证能显著降低“欺诈/不可信”误报，但钱包风险缓存更新存在延迟。
- 生产商用环境可使用私有升级版合约；公开仓库保留标准实现与验证流程。
