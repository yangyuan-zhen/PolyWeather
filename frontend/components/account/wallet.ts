import type { Eip6963ProviderDetail, EvmProvider, InjectedProviderOption } from "./types";
import { WALLETCONNECT_POLYGON_RPC_URL, WALLETCONNECT_PROJECT_ID } from "./constants";

let walletConnectProviderCache: EvmProvider | null = null;
let walletConnectProviderChainId: number | null = null;
export const eip6963Providers = new Map<string, Eip6963ProviderDetail>();

export function isWalletConnectResetError(error: unknown): boolean {
  const source = error as any;
  const message = String(
    source?.shortMessage ||
      source?.message ||
      source?.reason ||
      source?.data?.message ||
      source?.cause?.message ||
      source?.error?.message ||
      (error instanceof Error ? error.message : "") ||
      (typeof error === "string" ? error : ""),
  ).toLowerCase();
  return (
    message.includes("connection request reset") ||
    message.includes("pairing aborted") ||
    message.includes("pairing attempt") ||
    message.includes("unable to connect")
  );
}

export async function resetWalletConnectProvider(): Promise<void> {
  if (walletConnectProviderCache?.disconnect) {
    try {
      await walletConnectProviderCache.disconnect();
    } catch {
      // ignore
    }
  }
  walletConnectProviderCache = null;
  walletConnectProviderChainId = null;
}

export function getEvmProvider(): EvmProvider | null {
  return listInjectedProviders()[0]?.provider || null;
}

export function getEip6963Providers(): Eip6963ProviderDetail[] {
  return Array.from(eip6963Providers.values());
}

export function detectWalletLabel(
  provider: EvmProvider | null,
  detail?: Eip6963ProviderDetail,
): string {
  if (!provider && !detail) return "EVM 钱包";
  const announcedName = String(detail?.info?.name || "").trim();
  const announcedRdns = String(detail?.info?.rdns || "").toLowerCase();
  
  if (
    provider?.isOkxWallet ||
    announcedName.toLowerCase().includes("okx") ||
    announcedRdns.includes("okx")
  ) {
    return "OKX Wallet";
  }
  if (
    provider?.isRabby ||
    announcedName.toLowerCase().includes("rabby") ||
    announcedRdns.includes("rabby")
  ) {
    return "Rabby";
  }
  if (
    provider?.isBitKeep ||
    announcedName.toLowerCase().includes("bitget") ||
    announcedRdns.includes("bitkeep") ||
    announcedRdns.includes("bitget")
  ) {
    return "Bitget Wallet";
  }
  if (
    (provider as any)?.isBinance ||
    (provider as any)?.bnbSign ||
    announcedName.toLowerCase().includes("binance") ||
    announcedRdns.includes("binance")
  ) {
    return "Binance Web3 Wallet";
  }
  if (
    provider?.isMetaMask ||
    announcedName.toLowerCase().includes("metamask") ||
    announcedRdns.includes("metamask")
  ) {
    return "MetaMask";
  }
  if (announcedName) return announcedName;
  return "EVM 钱包";
}

export function collectInjectedProviders(): EvmProvider[] {
  if (typeof window === "undefined") return [];
  const out: EvmProvider[] = [];
  const seen = new Set<EvmProvider>();

  const push = (provider: unknown) => {
    if (!provider || typeof provider !== "object") return;
    const candidate = provider as EvmProvider;
    if (typeof candidate.request !== "function") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push(candidate);
  };

  const root = window.ethereum;
  if (Array.isArray(root?.providers)) {
    root.providers.forEach(push);
  }
  push(root);
  push(window.okxwallet?.ethereum);
  push(window.okexchain);
  push(window.rabby);
  push(window.bitkeep?.ethereum);

  return out;
}

export function getInjectedProviderStableId(
  provider: EvmProvider,
  index: number,
  detail?: Eip6963ProviderDetail,
): string {
  const rdns = String(detail?.info?.rdns || "").toLowerCase();
  const announcedName = String(detail?.info?.name || "")
    .toLowerCase()
    .trim();
  if (rdns) return `rdns:${rdns}`;
  if (announcedName) return `name:${announcedName}`;
  if (provider.isOkxWallet || rdns.includes("okx")) return `okx:${index}`;
  if (provider.isMetaMask || rdns.includes("metamask"))
    return `metamask:${index}`;
  if (provider.isRabby || rdns.includes("rabby")) return `rabby:${index}`;
  if (
    provider.isBitKeep ||
    rdns.includes("bitkeep") ||
    rdns.includes("bitget")
  ) {
    return `bitget:${index}`;
  }
  return `evm:${index}`;
}

export function listInjectedProviders(): InjectedProviderOption[] {
  const detailByProvider = new Map<EvmProvider, Eip6963ProviderDetail>();
  getEip6963Providers().forEach((detail) => {
    if (detail?.provider && typeof detail.provider.request === "function") {
      detailByProvider.set(detail.provider, detail);
    }
  });
  const candidates = collectInjectedProviders();
  detailByProvider.forEach((_detail, provider) => {
    if (!candidates.includes(provider)) {
      candidates.push(provider);
    }
  });
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  const out: InjectedProviderOption[] = [];
  candidates.forEach((provider, index) => {
    const detail = detailByProvider.get(provider);
    const label = detectWalletLabel(provider, detail);
    const key = getInjectedProviderStableId(provider, index, detail);
    if (seen.has(key)) return;
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel && seenLabels.has(normalizedLabel)) return;
    seen.add(key);
    if (normalizedLabel) seenLabels.add(normalizedLabel);
    out.push({
      key,
      provider,
      label,
      mode: "auto",
    });
  });
  return out;
}

export function getEvmWalletLabel(provider: EvmProvider | null): string {
  return detectWalletLabel(provider);
}

export async function getWalletConnectProvider(
  chainId: number,
  rpcUrl: string,
): Promise<EvmProvider> {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      "WalletConnect 未配置：缺少 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID。",
    );
  }
  if (walletConnectProviderCache && walletConnectProviderChainId === chainId) {
    return walletConnectProviderCache;
  }
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const rpcMap: Record<number, string> = {
    [chainId]: rpcUrl || WALLETCONNECT_POLYGON_RPC_URL,
  };
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://polyweather-pro.vercel.app";
  const provider = (await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [chainId],
    optionalChains: [chainId],
    showQrModal: true,
    methods: [
      "eth_sendTransaction",
      "personal_sign",
      "eth_signTypedData",
      "eth_signTypedData_v4",
      "eth_sign",
      "eth_call",
      "eth_chainId",
      "eth_accounts",
      "eth_requestAccounts",
    ],
    events: ["accountsChanged", "chainChanged", "disconnect"],
    rpcMap,
    metadata: {
      name: "PolyWeather",
      description: "PolyWeather Pro checkout",
      url: origin,
      icons: [`${origin}/favicon.ico`],
    },
  })) as unknown as EvmProvider;
  walletConnectProviderCache = provider;
  walletConnectProviderChainId = chainId;
  return provider;
}

