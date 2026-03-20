from __future__ import annotations

import os
import re
from typing import Any, Dict, List


def _has(pattern: str, text: str) -> bool:
    return re.search(pattern, text, re.MULTILINE | re.DOTALL) is not None


def analyze_checkout_contract(source_path: str) -> Dict[str, Any]:
    path = os.path.abspath(source_path)
    with open(path, "r", encoding="utf-8") as fh:
        source = fh.read()

    checks = {
        "has_only_owner_modifier": _has(r"modifier\s+onlyOwner\s*\(", source),
        "owner_set_in_constructor": _has(r"owner\s*=\s*msg\.sender\s*;", source),
        "owner_injected_in_constructor": _has(r"constructor\s*\(\s*address\s+initialOwner", source),
        "set_treasury_only_owner": _has(
            r"function\s+setTreasury\s*\([^)]*\)\s*external\s+onlyOwner", source
        ),
        "set_token_allowed_only_owner": _has(
            r"function\s+setTokenAllowed\s*\([^)]*\)\s*external\s+onlyOwner", source
        ),
        "zero_address_guard_in_constructor": _has(
            r"constructor\s*\([^)]*\)\s*\{\s*require\(\s*_token\s*!=\s*address\(0\)\s*&&\s*_treasury\s*!=\s*address\(0\)",
            source,
        )
        or _has(
            r"constructor[\s\S]*?require\(\s*initialTreasury\s*!=\s*address\(0\)",
            source,
        ),
        "zero_address_guard_in_setters": _has(
            r"function\s+setTreasury[\s\S]*?require\(\s*_treasury\s*!=\s*address\(0\)",
            source,
        )
        and _has(
            r"function\s+setTokenAllowed[\s\S]*?require\(\s*token\s*!=\s*address\(0\)",
            source,
        )
        or (
            _has(
                r"function\s+setTreasury[\s\S]*?require\(\s*newTreasury\s*!=\s*address\(0\)",
                source,
            )
            and _has(
                r"function\s+setTokenAllowed[\s\S]*?require\(\s*token\s*!=\s*address\(0\)",
                source,
            )
        ),
        "allowed_token_check": _has(r"require\(\s*allowedToken\[token\]", source),
        "amount_non_zero_check": _has(r"require\(\s*amount\s*>\s*0", source),
        "duplicate_order_check": _has(r"require\(\s*!paidOrder\[orderId\]", source),
        "paid_order_written_before_transfer": _has(
            r"paidOrder\[orderId\]\s*=\s*true\s*;\s*require\(IERC20\(token\)\.transferFrom",
            source,
        )
        or _has(
            r"paidOrder\[orderId\]\s*=\s*true\s*;\s*IERC20\(token\)\.safeTransferFrom",
            source,
        ),
        "emits_order_paid": _has(r"emit\s+OrderPaid\s*\(", source),
        "uses_safe_erc20": _has(r"SafeERC20", source),
        "has_pause_switch": _has(r"\bpaused\b|\bPausable\b|\bwhenNotPaused\b", source),
        "has_reentrancy_guard": _has(r"nonReentrant|ReentrancyGuard", source),
        "has_rescue_function": _has(
            r"function\s+(rescue|sweep|withdraw|recover)", source
        ),
        "binds_plan_amount_onchain": _has(
            r"mapping\s*\(\s*uint256\s*=>[\s\S]*PlanConfig|planAmount|require\(\s*amount\s*==|function\s+setPlan",
            source,
        ),
        "has_signature_authorization": _has(
            r"EIP712Domain|AUTHORIZED_PAYMENT_TYPEHASH|function\s+payAuthorized",
            source,
        ),
    }

    strengths: List[str] = []
    risks: List[Dict[str, Any]] = []

    if checks["has_only_owner_modifier"] and checks["set_treasury_only_owner"]:
        strengths.append("关键管理函数受 onlyOwner 保护。")
    if checks["allowed_token_check"]:
        strengths.append("支付代币有 allowlist，避免任意 token 进入收款流程。")
    if checks["duplicate_order_check"] and checks["paid_order_written_before_transfer"]:
        strengths.append("订单去重状态在外部 transferFrom 前写入，能拦住同订单重复支付与典型重入重放。")
    if checks["emits_order_paid"]:
        strengths.append("链上事件 OrderPaid 明确，可作为链下审计与补单的唯一确认源。")
    if checks["has_reentrancy_guard"]:
        strengths.append("支付入口包含 ReentrancyGuard，能进一步收紧外部调用期间的重入风险。")
    if checks["has_pause_switch"]:
        strengths.append("合约具备暂停开关，便于紧急止损。")
    if checks["binds_plan_amount_onchain"]:
        strengths.append("套餐金额已支持链上绑定，不再完全依赖链下校验。")
    if checks["has_signature_authorization"]:
        strengths.append("支持 EIP-712 授权支付，可在链上金额绑定之外增加签名边界。")

    if checks["uses_safe_erc20"]:
        strengths.append("使用了 SafeERC20 包装，兼容性更稳。")
    else:
        risks.append(
            {
                "id": "erc20_transfer_assumption",
                "severity": "medium",
                "title": "依赖 IERC20.transferFrom 直接返回 bool",
                "detail": "当前合约直接调用 IERC20.transferFrom。对非标准 ERC20 的兼容性弱于 SafeERC20，建议如未来升级合约时改为 OpenZeppelin SafeERC20。",
            }
        )

    if not checks["has_pause_switch"]:
        risks.append(
            {
                "id": "no_pause_switch",
                "severity": "medium",
                "title": "缺少紧急暂停开关",
                "detail": "一旦发现代币配置错误、接收地址异常或链上风险，当前合约无法直接暂停 pay。建议升级版合约加入 Pausable。",
            }
        )

    if not checks["binds_plan_amount_onchain"] and not checks["has_signature_authorization"]:
        risks.append(
            {
                "id": "offchain_price_enforcement",
                "severity": "medium",
                "title": "套餐金额与 planId 绑定主要靠链下校验",
                "detail": "合约事件只记录 planId 与 amount，本身不校验 planId 对应价格。当前依赖后端 intent/confirm 流程校验，后续升级可考虑链上 plan 配置或签名校验。",
            }
        )

    if not checks["has_rescue_function"]:
        risks.append(
            {
                "id": "no_rescue_function",
                "severity": "low",
                "title": "缺少误转资产救援函数",
                "detail": "当前合约把资金直接转 treasury，不太容易残留余额，但若未来支持更多资产或误转到合约地址，缺少救援路径。",
            }
        )

    if not checks["owner_injected_in_constructor"]:
        risks.append(
            {
                "id": "single_owner_admin",
                "severity": "medium",
                "title": "owner 为单地址管理模型",
                "detail": "setTreasury 和 setTokenAllowed 由单一 owner 控制。生产建议用多签地址持有 owner，降低单点密钥失窃风险。",
            }
        )

    runtime_controls = [
        "后端只认链上 OrderPaid 事件，不认前端自报支付成功。",
        "payment event loop 与 confirm loop 已写入 SQLite 审计事件，可做对账与回放。",
        "支持 POLYWEATHER_PAYMENT_RPC_URLS 多 RPC 容灾，单节点故障时可轮换。",
    ]

    recommendations = [
        "生产 owner 建议迁移到多签钱包。",
        "下一版合约优先补 SafeERC20 与 Pausable。",
        "若要进一步收紧授权边界，可把 planId/amount/token 绑定做进链上或 EIP-712 签名校验。",
        "每次合约地址或 allowed token 变更后，都运行静态检查与链上回放脚本。",
    ]

    return {
        "contract_path": path,
        "contract_name": "PolyWeatherCheckoutV2" if "PolyWeatherCheckoutV2" in source else "PolyWeatherCheckout",
        "summary": {
            "strength_count": len(strengths),
            "risk_count": len(risks),
            "highest_severity": "medium" if risks else "none",
        },
        "checks": checks,
        "strengths": strengths,
        "runtime_controls": runtime_controls,
        "risks": risks,
        "recommendations": recommendations,
    }
