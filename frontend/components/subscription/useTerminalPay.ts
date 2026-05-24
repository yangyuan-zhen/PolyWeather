"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnlockProBilling } from "@/components/subscription/UnlockProOverlay";
import { computeBilling } from "@/lib/billing-utils";
import {
  WALLETCONNECT_POLYGON_RPC_URL,
  WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
} from "@/components/account/constants";
import {
  buildAllowanceCalldata,
  buildApproveCalldata,
  buildBalanceOfCalldata,
  requestWalletWithTimeout,
} from "@/components/account/payment-utils";
import { isPaymentHostAllowed, getCurrentPaymentHost } from "@/lib/payment-host";
import {
  getEvmProvider,
  getEvmWalletLabel,
  getWalletConnectProvider,
} from "@/components/account/wallet";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { EvmProvider, CreatedIntent } from "@/components/account/types";

const DEFAULT_CHAIN_ID = 137;
const INTENT_POLL_INTERVAL_MS = 5000;
const INTENT_POLL_TIMEOUT_MS = 180_000;

function normalizePaymentError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const e = err as Record<string, unknown>;
  return String(
    e.shortMessage || e.message || e.reason || e.error || fallback,
  );
}

export function useTerminalPay(params: {
  points: number;
  planPriceUsd: number;
  onPaid: () => void;
  isEn: boolean;
}) {
  const { points, planPriceUsd, onPaid, isEn } = params;

  const [paymentConfig, setPaymentConfig] = useState<Record<string, unknown> | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(true);
  const [payBusy, setPayBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((cfg) => {
        if (cancelled) return;
        setPaymentConfig(cfg || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const billing: UnlockProBilling = useMemo(() => {
    const raw = computeBilling({
      planPriceUsd,
      totalPoints: points,
      usePoints,
      redemptionCfg: (paymentConfig?.points_redemption as Record<string, unknown>) ?? null,
    });
    return {
      pointsEnabled: raw.pointsEnabled,
      isEligible: raw.canRedeem,
      pointsUsed: raw.pointsUsed,
      discountAmount: raw.discountAmount,
      finalPrice: raw.payAmount,
      maxDiscountUsd: raw.maxDiscountUsdc,
      pointsPerUsd: raw.pointsPerUsdc,
    };
  }, [planPriceUsd, points, usePoints, paymentConfig]);

  const chainId = useMemo(
    () => Number(paymentConfig?.chain_id || DEFAULT_CHAIN_ID),
    [paymentConfig],
  );

  const tokenAddress = useMemo(() => {
    const tokens = (paymentConfig?.tokens as Array<Record<string, unknown>>) || [];
    return String(tokens[0]?.address || "");
  }, [paymentConfig]);

  const tokenSymbol = useMemo(() => {
    const tokens = (paymentConfig?.tokens as Array<Record<string, unknown>>) || [];
    return String(tokens[0]?.symbol || "USDC");
  }, [paymentConfig]);

  const tokenDecimals = useMemo(() => {
    const tokens = (paymentConfig?.tokens as Array<Record<string, unknown>>) || [];
    return Number(tokens[0]?.decimals || 6);
  }, [paymentConfig]);

  const receiverAddress = useMemo(
    () => String(paymentConfig?.receiver_address || ""),
    [paymentConfig],
  );

  const connectWallet = useCallback(async (): Promise<string | null> => {
    try {
      let provider: EvmProvider | null = getEvmProvider();
      let label = getEvmWalletLabel(provider);

      if (!provider) {
        const wcId = String(
          process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
        ).trim();
        if (!wcId) {
          setErrorText(
            isEn
              ? "No wallet detected. Install MetaMask or configure WalletConnect."
              : "未检测到钱包插件，请安装 MetaMask 扩展。",
          );
          return null;
        }
        provider = await getWalletConnectProvider(
          chainId,
          WALLETCONNECT_POLYGON_RPC_URL,
        );
        label = "WalletConnect";
        const existing = (await provider
          .request({ method: "eth_accounts" })
          .catch(() => [])) as string[];
        if (!Array.isArray(existing) || existing.length === 0) {
          if (typeof provider.connect === "function") {
            await provider.connect({ chains: [chainId] });
          }
        }
      }

      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = String(accounts[0] || "").toLowerCase();
      if (!address) throw new Error("No account returned");

      setWalletAddress(address);
      return address;
    } catch (err) {
      setErrorText(normalizePaymentError(err, isEn ? "Wallet connection failed" : "钱包连接失败"));
      return null;
    }
  }, [chainId, isEn]);

  const handlePay = useCallback(async () => {
    if (payBusy) return;
    setPayBusy(true);
    setErrorText("");
    setInfoText("");

    try {
      const host = getCurrentPaymentHost();
      const allowed = await isPaymentHostAllowed(host);
      if (!allowed) throw new Error(isEn ? "Payment host not allowed" : "当前域名不在支付白名单中");

      // Get session token
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error(isEn ? "Session expired, please refresh" : "会话过期，请刷新页面");
      const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // Connect wallet
      let payingWallet = walletAddress;
      if (!payingWallet) {
        payingWallet = await connectWallet();
        if (!payingWallet) {
          setPayBusy(false);
          return;
        }
      }

      // Refresh payment config
      const cfgRes = await fetch("/api/payments/config", {
        headers: { Accept: "application/json" },
      });
      const latestCfg = cfgRes.ok ? await cfgRes.json() : paymentConfig;
      setPaymentConfig(latestCfg || paymentConfig);

      const targetChainId = Number(latestCfg?.chain_id || DEFAULT_CHAIN_ID);

      // Resolve provider for payment
      let eth = getEvmProvider();
      if (!eth) {
        const wcId = String(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();
        if (!wcId) throw new Error("No wallet available");
        eth = await getWalletConnectProvider(targetChainId, WALLETCONNECT_POLYGON_RPC_URL);
        const existing = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
        if (!Array.isArray(existing) || existing.length === 0) {
          if (typeof eth.connect === "function") {
            await eth.connect({ chains: [targetChainId] });
          }
        }
      }

      // Ensure target chain
      const currentChainHex = String(
        (await requestWalletWithTimeout<string>(eth, { method: "eth_chainId" }, "chainId", WALLET_TRANSACTION_REQUEST_TIMEOUT_MS)) || "",
      );
      const targetHex = `0x${targetChainId.toString(16)}`;
      if (currentChainHex.toLowerCase() !== targetHex.toLowerCase()) {
        try {
          await requestWalletWithTimeout(eth, {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetHex }],
          }, "switchChain");
        } catch (switchErr: unknown) {
          const code = Number((switchErr as Record<string, unknown>)?.code);
          if (code === 4902 || targetChainId === 137) {
            await requestWalletWithTimeout(eth, {
              method: "wallet_addEthereumChain",
              params: [{
                chainId: "0x89",
                chainName: "Polygon Mainnet",
                nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
                rpcUrls: ["https://polygon-rpc.com"],
                blockExplorerUrls: ["https://polygonscan.com"],
              }],
            }, "addChain");
          } else {
            throw switchErr;
          }
        }
      }

      // Create payment intent
      const resolvedToken = String(latestCfg?.tokens?.[0]?.address || tokenAddress);
      const intentRes = await fetch("/api/payments/intents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          plan_code: "pro_monthly",
          payment_mode: "strict",
          allowed_wallet: payingWallet,
          token_address: resolvedToken || undefined,
          use_points: billing.isEligible && usePoints,
          points_to_consume: billing.isEligible && usePoints ? billing.pointsUsed : 0,
          metadata: {
            source: "terminal",
            frontend_host: host || null,
          },
        }),
      });
      if (!intentRes.ok) {
        const errBody = await intentRes.json().catch(() => ({}));
        throw new Error(String(errBody?.detail || errBody?.message || `HTTP ${intentRes.status}`));
      }
      const created = (await intentRes.json()) as CreatedIntent;
      const intentId = String(created.intent?.intent_id || "");
      const txPayload = created.tx_payload;
      if (!intentId || !txPayload?.to || !txPayload?.data) {
        throw new Error(isEn ? "Invalid payment intent response" : "支付意图创建失败");
      }

      // Verify receiver
      const expectedReceiver = String(latestCfg?.receiver_address || receiverAddress);
      if (expectedReceiver && txPayload.to.toLowerCase() !== expectedReceiver.toLowerCase()) {
        throw new Error(isEn ? "Payment receiver mismatch" : "收款地址不匹配");
      }

      const resolvedTokenDecimals = Number(
        latestCfg?.tokens?.[0]?.decimals || tokenDecimals,
      );
      const amountUnits =
        typeof txPayload.amount_units === "string"
          ? BigInt(txPayload.amount_units)
          : BigInt(String(txPayload.value || 0));

      // Check balance
      const balanceHex = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_call",
          params: [
            { to: txPayload.token_address || resolvedToken, data: buildBalanceOfCalldata(payingWallet) },
            "latest",
          ],
        },
        "balanceOf",
      );
      const balance = BigInt(balanceHex || "0x0");
      if (balance < amountUnits) {
        throw new Error(isEn ? "Insufficient USDC balance" : "USDC 余额不足");
      }

      // Check allowance and approve if needed
      const allowanceHex = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_call",
          params: [
            { to: txPayload.token_address || resolvedToken, data: buildAllowanceCalldata(payingWallet, txPayload.to) },
            "latest",
          ],
        },
        "allowance",
      );
      const allowance = BigInt(allowanceHex || "0x0");
      if (allowance < amountUnits) {
        setInfoText(isEn ? "Approving USDC..." : "正在授权 USDC...");
        const approveHash = await requestWalletWithTimeout<string>(
          eth,
          {
            method: "eth_sendTransaction",
            params: [{
              from: payingWallet,
              to: txPayload.token_address || resolvedToken,
              data: buildApproveCalldata(txPayload.to, amountUnits),
            }],
          },
          "approve",
        );
        // Wait for approval receipt via simple polling
        const approveStart = Date.now();
        while (Date.now() - approveStart < 120_000) {
          const receipt = await requestWalletWithTimeout<Record<string, unknown> | null>(
            eth,
            { method: "eth_getTransactionReceipt", params: [approveHash] },
            "approveReceipt",
          ).catch(() => null);
          if (receipt?.status === "0x1" || receipt?.status === 1) break;
          if (receipt?.status === "0x0" || receipt?.status === 0) {
            throw new Error(isEn ? "USDC approval failed" : "USDC 授权失败");
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      // Send payment transaction
      setInfoText(isEn ? "Confirm in wallet..." : "请在钱包中确认交易...");
      const payHash = await requestWalletWithTimeout<string>(
        eth,
        {
          method: "eth_sendTransaction",
          params: [{ from: payingWallet, to: txPayload.to, data: txPayload.data }],
        },
        "pay",
      );
      setTxHash(payHash);

      // Submit
      const submitRes = await fetch(`/api/payments/intents/${intentId}/submit`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ tx_hash: payHash, from_address: payingWallet }),
      });
      if (!submitRes.ok && submitRes.status !== 409) {
        const errBody = await submitRes.json().catch(() => ({}));
        throw new Error(String(errBody?.detail || `HTTP ${submitRes.status}`));
      }

      // Confirm
      const confirmStart = Date.now();
      let confirmed = false;
      while (Date.now() - confirmStart < INTENT_POLL_TIMEOUT_MS) {
        const confirmRes = await fetch(`/api/payments/intents/${intentId}/confirm`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ tx_hash: payHash }),
        });
        if (confirmRes.ok) {
          setInfoText(isEn ? "Payment confirmed! Activating..." : "支付确认！正在激活...");
          confirmed = true;
          break;
        }
        if (confirmRes.status === 409 || confirmRes.status === 404 || confirmRes.status === 408) {
          await new Promise((r) => setTimeout(r, INTENT_POLL_INTERVAL_MS));
          continue;
        }
        const errBody = await confirmRes.json().catch(() => ({}));
        throw new Error(String(errBody?.detail || `HTTP ${confirmRes.status}`));
      }
      if (!confirmed) {
        throw new Error(isEn ? "Payment confirmation timeout" : "支付确认超时，请稍后检查订单状态");
      }

      setInfoText(isEn ? "Subscription activated!" : "订阅已激活！");
      onPaid();
    } catch (err) {
      setErrorText(normalizePaymentError(err, isEn ? "Payment failed" : "支付失败"));
    } finally {
      setPayBusy(false);
    }
  }, [
    payBusy, walletAddress, paymentConfig, billing, usePoints, chainId,
    tokenAddress, tokenDecimals, receiverAddress, isEn, connectWallet, onPaid,
  ]);

  return {
    billing,
    usePoints,
    setUsePoints,
    payBusy,
    errorText,
    infoText,
    txHash,
    chainId,
    tokenSymbol,
    walletAddress,
    connectWallet,
    handlePay,
  };
}
