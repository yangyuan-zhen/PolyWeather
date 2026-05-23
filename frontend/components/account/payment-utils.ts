import type { EvmProvider } from "./types";
import { WALLET_REQUEST_TIMEOUT_MS } from "./constants";
import { isWalletConnectResetError } from "./wallet";

export function toPaddedHex(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

export function toPaddedAddress(address: string) {
  return String(address || "")
    .toLowerCase()
    .replace(/^0x/, "")
    .padStart(64, "0");
}

export function buildAllowanceCalldata(owner: string, spender: string) {
  return `0xdd62ed3e${toPaddedAddress(owner)}${toPaddedAddress(spender)}`;
}

export function buildApproveCalldata(spender: string, amount: bigint) {
  return `0x095ea7b3${toPaddedAddress(spender)}${toPaddedHex(amount)}`;
}

export function buildBalanceOfCalldata(owner: string) {
  return `0x70a08231${toPaddedAddress(owner)}`;
}

export async function requestWalletWithTimeout<T>(
  provider: EvmProvider,
  args: { method: string; params?: unknown[] },
  actionLabel = "钱包操作",
  timeoutMs = WALLET_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return (await Promise.race([
      provider.request(args),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${actionLabel}长时间无响应，请确认钱包弹窗是否被拦截；如使用 Binance Web3 Wallet，请回到钱包确认或重新连接后再试。`,
            ),
          );
        }, timeoutMs);
      }),
    ])) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function formatTokenUnits(amount: bigint, decimals: number) {
  const safeDecimals =
    Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 6;
  const base = 10n ** BigInt(safeDecimals);
  const whole = amount / base;
  const fraction = amount % base;
  if (fraction === 0n) return whole.toString();
  const rawFraction = fraction.toString().padStart(safeDecimals, "0");
  const trimmed = rawFraction.replace(/0+$/, "");
  return `${whole.toString()}.${trimmed}`;
}

export type NormalizedPaymentError = {
  message: string;
  pending: boolean;
  userRejected: boolean;
};

export function normalizePaymentError(error: unknown): NormalizedPaymentError {
  const source = error as any;
  const code = Number(
    source?.code ??
      source?.error?.code ??
      source?.data?.code ??
      source?.cause?.code ??
      NaN,
  );
  const messageCandidates = [
    source?.shortMessage,
    source?.message,
    source?.reason,
    source?.data?.message,
    source?.cause?.message,
    source?.error?.message,
    error instanceof Error ? error.message : "",
    typeof error === "string" ? error : "",
  ];
  const rawMessage = messageCandidates
    .find(
      (item) =>
        typeof item === "string" &&
        item.trim() &&
        item.trim().toLowerCase() !== "[object object]",
    )
    ?.trim();
  const lower = String(rawMessage || "").toLowerCase();

  if (
    lower.includes("confirm pending") ||
    lower.includes("payment pending timeout")
  ) {
    return {
      message: "链上交易已提交，正在确认中，请稍后刷新查看状态。",
      pending: true,
      userRejected: false,
    };
  }

  if (isWalletConnectResetError(error)) {
    return {
      message:
        "WalletConnect 连接已重置，请重新扫码连接；若仍失败，请先在钱包里断开旧连接后再试。",
      pending: false,
      userRejected: false,
    };
  }

  const userRejected =
    code === 4001 ||
    /user rejected|user denied|rejected request|cancelled|canceled|拒绝|取消|签名请求已拒绝/.test(
      lower,
    );
  if (userRejected) {
    return {
      message: "你已取消钱包操作。",
      pending: false,
      userRejected: true,
    };
  }

  const insufficientGas =
    (code === -32000 &&
      /insufficient funds/.test(lower) &&
      /(gas|fee|native|pol|matic)/.test(lower)) ||
    /not enough pol|insufficient (pol|matic)|insufficient funds for gas|network fee|网络费|手续费/.test(
      lower,
    );
  if (insufficientGas) {
    return {
      message: "钱包 POL 不足，无法支付链上手续费，请先充值少量 POL 后重试。",
      pending: false,
      userRejected: false,
    };
  }

  if (rawMessage) {
    return {
      message: rawMessage,
      pending: false,
      userRejected: false,
    };
  }

  try {
    return {
      message: JSON.stringify(error),
      pending: false,
      userRejected: false,
    };
  } catch {
    return {
      message: "发生未知错误，请稍后重试。",
      pending: false,
      userRejected: false,
    };
  }
}

