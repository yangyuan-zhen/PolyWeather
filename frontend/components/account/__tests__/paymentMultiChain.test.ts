import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountDir = path.join(projectRoot, "components", "account");
  const useAccountPaymentSource = fs.readFileSync(
    path.join(accountDir, "useAccountPayment.ts"),
    "utf8",
  );
  const usePaymentFlowSource = fs.readFileSync(
    path.join(accountDir, "usePaymentFlow.ts"),
    "utf8",
  );
  const useWalletBindSource = fs.readFileSync(
    path.join(accountDir, "useWalletBind.ts"),
    "utf8",
  );
  const accountCenterSource = fs.readFileSync(
    path.join(accountDir, "AccountCenter.tsx"),
    "utf8",
  );
  const opsPaymentsSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "payments", "PaymentsPageClient.tsx"),
    "utf8",
  );

  assert(
    useAccountPaymentSource.includes("selectedPaymentChainId") &&
      useAccountPaymentSource.includes("setSelectedPaymentChainId"),
    "account payment state must track the selected payment chain separately from the legacy default chain",
  );
  assert(
    usePaymentFlowSource.includes("chain_id: selectedPaymentChainId") ||
      usePaymentFlowSource.includes("chain_id: targetChainId"),
    "payment intent creation must send the selected chain_id to the backend",
  );
  assert(
    !usePaymentFlowSource.includes("请在 Polygon 网络转"),
    "manual transfer instructions must not hard-code Polygon after Ethereum USDC is supported",
  );
  assert(
    useWalletBindSource.includes("chainName") &&
      useWalletBindSource.includes("wallet_addEthereumChain") &&
      useWalletBindSource.includes("Ethereum Mainnet"),
    "wallet network switching must use chain metadata instead of hard-coded Polygon-only add-network params",
  );
  assert(
    accountCenterSource.includes("availableChainList") &&
      accountCenterSource.includes("setSelectedPaymentChainId") &&
      accountCenterSource.includes("paymentNetwork"),
    "account center must expose a payment network selector when multiple chains are configured",
  );
  assert(
    opsPaymentsSource.includes("etherscan.io") &&
      opsPaymentsSource.includes("polygonscan.com"),
    "ops payment tx links must route Ethereum payments to Etherscan and Polygon payments to Polygonscan",
  );
}
