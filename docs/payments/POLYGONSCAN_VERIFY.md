# PolyWeatherCheckout PolygonScan 验证

目标合约地址：`0xD8101B3cA351fD7a9c00d2eBF226f6461Af33F10`  
链：Polygon Mainnet (`chainId=137`)

## 1. 准备参数

- 编译器版本：`v0.8.24+commit.e11b9ed9`
- 优化器：`Enabled`
- Runs：`200`
- 许可证：`MIT`
- 合约路径：`contracts/PolyWeatherCheckout.sol`
- 合约名：`PolyWeatherCheckout`

构造参数顺序（新版多代币合约）：

1. `_token` = `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`（初始允许代币）
2. `_treasury` = `0xe581D578EF101c80e3F32263e97E6eA28A0B170e`

## 2. 构造参数编码

可直接用本仓库脚本：

```bash
python scripts/encode_checkout_constructor.py \
  --token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 \
  --treasury 0xe581D578EF101c80e3F32263e97E6eA28A0B170e
```

输出应为：

```text
0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000e581d578ef101c80e3f32263e97e6ea28a0b170e
```

把这串填到 PolygonScan 的 `Constructor Arguments ABI-encoded`。

## 3. PolygonScan 页面操作

1. 打开合约页面 -> `Contract` -> `Verify and Publish`.
2. 选择 `Solidity (Single file)`。
3. 粘贴 `contracts/PolyWeatherCheckout.sol` 全部源码。
4. 按上面参数填写编译器和优化器。
5. 粘贴编码后的构造参数，提交验证。

## 4. 验证后检查

验证成功后确认：

- `Read Contract` 有 `owner / treasury / allowedToken / paidOrder`
- `Write Contract` 有 `pay / setTreasury / setTokenAllowed`
- `Contract` 标签显示 `Contract Source Code Verified`

## 5. 同时开启 USDC.e + Native USDC

验证后在 `Write Contract` 调用：

- `setTokenAllowed(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174, true)`  // USDC.e
- `setTokenAllowed(0x3c499c542cef5e3811e1192ce70d8cc03d5c3359, true)`  // Native USDC

> 说明：钱包风控中的“欺诈/不可信”提示来自钱包安全引擎（如 Blockaid），源码验证能显著降低误报频率，但不保证 100% 立刻消失，通常需一段时间同步信誉缓存。
