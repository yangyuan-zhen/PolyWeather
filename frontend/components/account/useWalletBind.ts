"use client";

import { useCallback, useEffect } from "react";
import type {
  BoundWallet,
  ConnectBindOptions,
  Eip6963ProviderDetail,
  EvmProvider,
  InjectedProviderOption,
  PaymentChainOption,
  ProviderMode,
  ProviderSelection,
} from "./types";
import {
  WALLETCONNECT_POLYGON_RPC_URL,
  WALLET_TRANSACTION_REQUEST_TIMEOUT_MS,
} from "./constants";
import { shortAddress } from "./formatters";
import {
  normalizePaymentError,
  readPaymentApiErrorMessage,
  requestWalletWithTimeout,
} from "./payment-utils";
import {
  eip6963Providers,
  getEvmProvider,
  getEvmWalletLabel,
  getWalletConnectProvider,
  isWalletConnectResetError,
  listInjectedProviders,
  resetWalletConnectProvider,
} from "./wallet";

// ============================================================
export interface UseWalletBindParams {
  isEn: boolean;
  walletConnectEnabled: boolean;
  copy: Record<string, string>;
  chainId: number;

  // Shared wallet state + setters
  boundWallets: BoundWallet[];
  setBoundWallets: React.Dispatch<React.SetStateAction<BoundWallet[]>>;
  walletAddress: string;
  setWalletAddress: React.Dispatch<React.SetStateAction<string>>;
  selectedWallet: string;
  setSelectedWallet: React.Dispatch<React.SetStateAction<string>>;
  providerMode: ProviderMode;
  setProviderMode: React.Dispatch<React.SetStateAction<ProviderMode>>;
  injectedProviderOptions: InjectedProviderOption[];
  setInjectedProviderOptions: React.Dispatch<React.SetStateAction<InjectedProviderOption[]>>;
  selectedInjectedProviderKey: string;
  setSelectedInjectedProviderKey: React.Dispatch<React.SetStateAction<string>>;

  // Payment UI state setters
  setPaymentBusy: (v: boolean) => void;
  setPaymentInfo: (v: string) => void;
  setPaymentError: (v: string) => void;
  setShowOverlay: (v: boolean) => void;
  clearPaymentMessages: () => void;

  // Derived values from master
  authIsAuthenticated: boolean;

  // Callbacks from master (must be stable via useCallback)
  getValidAccessToken: () => Promise<string>;
  buildAuthedHeaders: (withJson?: boolean, requireAuth?: boolean) => Promise<Record<string, string>>;
  loadSnapshot: () => Promise<void>;
  loadPaymentSnapshot: () => Promise<void>;
}

// ============================================================
export function useWalletBind(params: UseWalletBindParams) {
  const {
    isEn,
    walletConnectEnabled,
    copy,
    chainId,
    boundWallets,
    setBoundWallets,
    walletAddress,
    setWalletAddress,
    selectedWallet,
    setSelectedWallet,
    providerMode,
    setProviderMode,
    injectedProviderOptions,
    setInjectedProviderOptions,
    selectedInjectedProviderKey,
    setSelectedInjectedProviderKey,
    setPaymentBusy,
    setPaymentInfo,
    setPaymentError,
    setShowOverlay,
    clearPaymentMessages,
    authIsAuthenticated,
    getValidAccessToken,
    buildAuthedHeaders,
    loadSnapshot,
    loadPaymentSnapshot,
  } = params;

  // ── EIP-6963 Provider sync ──────────────────────────────
  useEffect(() => {
    const syncProviders = () => {
      const nextOptions = listInjectedProviders();
      setInjectedProviderOptions(nextOptions);
      setSelectedInjectedProviderKey((current) => {
        if (current && nextOptions.some((row) => row.key === current)) {
          return current;
        }
        return nextOptions[0]?.key || "";
      });
    };

    const handleAnnounce = (event: Event) => {
      const customEvent = event as CustomEvent<Eip6963ProviderDetail>;
      const detail = customEvent.detail;
      if (!detail?.provider || typeof detail.provider.request !== "function") return;
      const uuid = String(detail.info?.uuid || "").trim();
      const fallbackKey = `${String(detail.info?.rdns || "wallet").toLowerCase()}:${String(detail.info?.name || "wallet").toLowerCase()}`;
      eip6963Providers.set(uuid || fallbackKey, detail);
      syncProviders();
    };

    syncProviders();
    if (typeof window === "undefined") return;
    window.addEventListener("eip6963:announceProvider", handleAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.addEventListener("ethereum#initialized", syncProviders as EventListener, { once: false });
    return () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounce as EventListener);
      window.removeEventListener("ethereum#initialized", syncProviders as EventListener);
    };
  }, []);

  // ── resolvePaymentProvider ──────────────────────────────
  const resolvePaymentProvider = useCallback(
    async (mode: ProviderMode = "auto", preferredInjectedKey = ""): Promise<ProviderSelection> => {
      const targetChainId = Number(chainId || 137);
      if (mode !== "walletconnect") {
        const injectedOptions = listInjectedProviders();
        const injected = injectedOptions.find((row) => row.key === preferredInjectedKey)?.provider || getEvmProvider();
        const label = injectedOptions.find((row) => row.key === preferredInjectedKey)?.label || getEvmWalletLabel(injected);
        if (injected) return { provider: injected, label, mode: "auto" };
      }
      if (!walletConnectEnabled) {
        throw new Error("未检测到浏览器扩展钱包，且 WalletConnect 未启用。请配置 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID 或安装 EVM 钱包扩展。");
      }
      const wcProvider = await getWalletConnectProvider(targetChainId, WALLETCONNECT_POLYGON_RPC_URL);
      const existingAccounts = (await wcProvider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (!Array.isArray(existingAccounts) || existingAccounts.length === 0) {
        if (typeof wcProvider.connect === "function") {
          try { await wcProvider.connect({ chains: [targetChainId] }); }
          catch (err) {
            if (!isWalletConnectResetError(err)) throw err;
            await resetWalletConnectProvider();
            const freshProvider = await getWalletConnectProvider(targetChainId, WALLETCONNECT_POLYGON_RPC_URL);
            if (typeof freshProvider.connect === "function") await freshProvider.connect({ chains: [targetChainId] });
            return { provider: freshProvider, label: "WalletConnect", mode: "walletconnect" };
          }
        }
      }
      return { provider: wcProvider, label: "WalletConnect", mode: "walletconnect" };
    },
    [chainId, walletConnectEnabled],
  );

  // ── Low-level helpers ──────────────────────────────────
  const waitForReceipt = async (txHash: string, provider?: EvmProvider, timeoutMs = 120000, pollMs = 3000) => {
    const eth = provider || getEvmProvider();
    if (!eth) throw new Error(copy.noWalletProvider);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = await requestWalletWithTimeout<{ status?: string } | null>(
        eth,
        { method: "eth_getTransactionReceipt", params: [txHash] },
        "查询授权交易确认",
        15_000,
      );
      if (receipt && receipt.status) {
        if (receipt.status === "0x1") return receipt;
        throw new Error(copy.txReverted.replace("{txHash}", txHash));
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(copy.txConfirmTimeout.replace("{txHash}", txHash));
  };

  const signBindMessage = async (eth: EvmProvider, address: string, message: string): Promise<string> => {
    try {
      return (await eth.request({ method: "personal_sign", params: [message, address] })) as string;
    } catch {
      return (await eth.request({ method: "personal_sign", params: [address, message] })) as string;
    }
  };

  const ensureTargetChain = async (
    eth: EvmProvider,
    targetChainId: number,
    chain?: PaymentChainOption,
  ): Promise<void> => {
    const currentChainIdHex = String(
      (await requestWalletWithTimeout<string>(eth, { method: "eth_chainId" }, copy.chainReadError)) || "",
    );
    const targetChainHex = `0x${targetChainId.toString(16)}`;
    if (currentChainIdHex.toLowerCase() === targetChainHex.toLowerCase()) return;
    const chainName =
      String(chain?.name || "").trim() ||
      (targetChainId === 1 ? "Ethereum Mainnet" : targetChainId === 137 ? "Polygon Mainnet" : `Chain ${targetChainId}`);
    const nativeSymbol =
      String(chain?.native_currency_symbol || "").trim() ||
      (targetChainId === 137 ? "POL" : "ETH");
    const explorerBase = String(chain?.block_explorer_url || "").trim() ||
      (targetChainId === 1 ? "https://etherscan.io" : targetChainId === 137 ? "https://polygonscan.com" : "");
    const defaultRpc =
      targetChainId === 137
        ? "https://polygon-rpc.com"
        : targetChainId === 1
          ? "https://ethereum-rpc.publicnode.com"
          : "";
    try {
      await requestWalletWithTimeout(
        eth,
        { method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] },
        copy.chainSwitchError,
      );
    } catch (err: any) {
      const code = Number(err?.code);
      if (code === 4902 || targetChainId === 137) {
        try {
          const addParams: Record<string, any> = {
            chainId: targetChainHex,
            chainName,
            nativeCurrency: { name: nativeSymbol, symbol: nativeSymbol, decimals: 18 },
          };
          if (defaultRpc) addParams.rpcUrls = [defaultRpc];
          if (explorerBase) addParams.blockExplorerUrls = [explorerBase];
          await requestWalletWithTimeout(
            eth,
            {
              method: "wallet_addEthereumChain",
              params: [addParams],
            },
            isEn ? `Add ${chainName}` : `添加 ${chainName}`,
          );
          return;
        } catch (addErr: any) { err = addErr; }
      }
      throw new Error(
        `${
          isEn
            ? `Please manually switch to ${chainName} in your wallet and try again.`
            : `请在钱包中手动切换到 ${chainName} 后再试。`
        } (${err?.message || (isEn ? "Network switch failed" : "网络切换失败")})`,
      );
    }
  };

  // ── connectAndBindWallet ────────────────────────────────
  const connectAndBindWallet = async (mode: ProviderMode = "auto", options: ConnectBindOptions = {}): Promise<boolean> => {
    clearPaymentMessages();
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforeBind);
      return false;
    }

    setPaymentBusy(true);
    try {
      const providerSelection = await resolvePaymentProvider(mode, selectedInjectedProviderKey);
      const eth = providerSelection.provider;
      const walletLabel = providerSelection.label;
      const binanceBindHint = walletLabel.toLowerCase().includes("binance") ? copy.binanceBindHint : "";

      let accessToken: string;
      try { accessToken = await getValidAccessToken(); }
      catch (tokenErr) {
        setPaymentError(normalizePaymentError(tokenErr).message);
        setPaymentBusy(false);
        return false;
      }
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const accounts = await requestWalletWithTimeout<string[]>(eth, { method: "eth_requestAccounts" }, "连接绑定钱包");
      const address = String(accounts?.[0] || "").toLowerCase();
      if (!address) throw new Error(isEn ? "Wallet account is empty." : "钱包账户为空");

      const existingWallet = boundWallets.find((w) => String(w.address || "").toLowerCase() === address);
      if (existingWallet) {
        setWalletAddress(address);
        setSelectedWallet(address);
        setPaymentInfo(`${walletLabel} 已绑定: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`);
        await Promise.all([loadSnapshot(), loadPaymentSnapshot()]);
        if (options.openOverlayAfterBind) setShowOverlay(true);
        setPaymentBusy(false);
        return true;
      }

      setWalletAddress(address);
      const challengeRes = await fetch("/api/payments/wallets/challenge", {
        method: "POST", headers: authHeaders, body: JSON.stringify({ address }),
      });
      if (!challengeRes.ok) {
        const message = await readPaymentApiErrorMessage(challengeRes);
        throw new Error(copy.challengeFailed.replace("{raw}", message));
      }

      const challengeJson = (await challengeRes.json()) as { nonce?: string; message?: string };
      const message = String(challengeJson.message || "");
      const nonce = String(challengeJson.nonce || "");
      if (!message || !nonce) throw new Error(copy.challengeInvalid);

      const signature = await signBindMessage(eth, address, message);
      const verifyRes = await fetch("/api/payments/wallets/verify", {
        method: "POST", headers: authHeaders, body: JSON.stringify({ address, nonce, signature }),
      });
      if (!verifyRes.ok) {
        const message = await readPaymentApiErrorMessage(verifyRes);
        throw new Error(copy.verifyFailedRaw.replace("{raw}", message));
      }

      setPaymentInfo(`${walletLabel} 绑定成功: ${shortAddress(address)}。${binanceBindHint || "现在可点击“立即订阅并激活服务”。"}`);
      setProviderMode(providerSelection.mode);
      if (options.openOverlayAfterBind) setShowOverlay(true);
      await Promise.all([loadSnapshot(), loadPaymentSnapshot()]);
      return true;
    } catch (error) {
      setPaymentInfo("");
      setPaymentError(normalizePaymentError(error).message);
      return false;
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── handleUnbindWallet ──────────────────────────────────
  const handleUnbindWallet = async (address: string) => {
    const target = String(address || "").toLowerCase();
    if (!target) return;
    if (!authIsAuthenticated) {
      setPaymentError(copy.loginBeforeBind);
      return;
    }
    const confirmed = window.confirm(copy.unbindConfirm.replace("{address}", shortAddress(target)));
    if (!confirmed) return;

    setPaymentBusy(true);
    clearPaymentMessages();
    try {
      const headers = await buildAuthedHeaders(true, false);
      const res = await fetch("/api/payments/wallets", {
        method: "DELETE", headers, body: JSON.stringify({ address: target }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = String(parsed?.detail || parsed?.error || raw);
          if (detail.trim().startsWith("{")) {
            try {
              const nested = JSON.parse(detail);
              detail = String(nested?.detail || nested?.error || detail);
            } catch { /* ignore nested parse failure */ }
          }
        } catch { /* ignore */ }
        throw new Error(detail || copy.httpError.replace("{status}", String(res.status)).replace("{raw}", ""));
      }

      let data: Record<string, unknown> = {};
      try { data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; }
      catch { data = {}; }

      const newPrimary = String(data?.new_primary || "").toLowerCase();
      const selectedWalletNorm = String(selectedWallet || "").toLowerCase();
      const walletAddressNorm = String(walletAddress || "").toLowerCase();
      if (selectedWalletNorm === target) setSelectedWallet(newPrimary || "");
      if (walletAddressNorm === target) setWalletAddress(newPrimary || "");
      setBoundWallets((prev) => prev.filter((row) => String(row.address || "").toLowerCase() !== String(target)));
      await loadPaymentSnapshot();
      setPaymentInfo(newPrimary ? copy.unbindDonePrimary.replace("{address}", shortAddress(newPrimary)) : copy.unbindDone);
    } catch (error) {
      const message = normalizePaymentError(error).message;
      const lower = String(message || "").toLowerCase();
      if (lower.includes("unauthorized") || lower.includes("session required") || lower.includes("401")) {
        setPaymentError(`${copy.unbindFailed}: ${copy.authExpired}`);
        return;
      }
      setPaymentError(`${copy.unbindFailed}: ${message}`);
    } finally {
      setPaymentBusy(false);
    }
  };

  // ── Derived values ──────────────────────────────────────
  const paymentWalletLabel = String(
    selectedWallet || walletAddress || boundWallets.find((row) => row.is_primary)?.address || boundWallets[0]?.address || "",
  ).toLowerCase();

  const hasPayingWallet = Boolean(String(selectedWallet || walletAddress || boundWallets[0]?.address || "").trim());

  // ==========================================================
  return {
    resolvePaymentProvider,
    connectAndBindWallet,
    handleUnbindWallet,
    waitForReceipt,
    signBindMessage,
    ensureTargetChain,
    paymentWalletLabel,
    hasPayingWallet,
  };
}
