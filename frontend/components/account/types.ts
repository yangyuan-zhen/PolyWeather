export type AuthMeResponse = {
  authenticated?: boolean;
  user_id?: string | null;
  email?: string | null;
  points?: number;
  weekly_points?: number;
  weekly_rank?: number | string | null;
  entitlement_mode?: string | null;
  auth_required?: boolean;
  subscription_required?: boolean;
  subscription_active?: boolean | null;
  subscription_plan_code?: string | null;
  subscription_source?: string | null;
  subscription_is_trial?: boolean | null;
  subscription_starts_at?: string | null;
  subscription_expires_at?: string | null;
  subscription_total_expires_at?: string | null;
  subscription_queued_days?: number | null;
  subscription_queued_count?: number | null;
  telegram_pricing?: TelegramPricing | null;
  referral?: ReferralSummary | null;
};

export type ReferralSummary = {
  code?: string;
  discount_usdc?: string;
  discounted_monthly_amount_usdc?: string;
  reward_days?: number;
  reward_points?: number;
  monthly_reward_limit?: number;
  monthly_reward_days_limit?: number;
  monthly_reward_points_limit?: number;
  monthly_reward_count?: number;
  monthly_reward_days?: number;
  monthly_reward_points?: number;
  applied_code?: string;
  attribution_status?: string;
};

export type TelegramPricing = {
  configured?: boolean;
  telegram_id?: number | null;
  telegram_status?: string | null;
  is_group_member?: boolean;
  amount_usdc?: string;
  pricing_source?: string;
};

export type PaymentPlan = {
  plan_code: string;
  plan_id: number;
  amount_usdc: string;
  duration_days: number;
};

export type PaymentTokenOption = {
  code: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chain_id?: number;
  chain_code?: string;
  chain_name?: string;
  receiver_contract?: string;
  direct_receiver_address?: string;
  explorer_tx_url?: string;
  supports_contract_checkout?: boolean;
  supports_direct_transfer?: boolean;
  is_default?: boolean;
};

export type PaymentChainOption = {
  chain_id: number;
  code?: string;
  name?: string;
  native_currency_symbol?: string;
  block_explorer_url?: string;
  explorer_tx_url?: string;
  is_default?: boolean;
};

export type PointsRedemptionConfig = {
  enabled?: boolean;
  points_per_usdc?: number;
  max_discount_usdc?: number;
  max_discount_usdc_by_plan?: Record<string, number>;
};

export type PaymentConfig = {
  enabled?: boolean;
  configured?: boolean;
  chain_id?: number;
  default_chain_id?: number;
  token_address?: string;
  token_decimals?: number;
  default_token_address?: string;
  chains?: PaymentChainOption[];
  tokens?: PaymentTokenOption[];
  receiver_contract?: string;
  confirmations?: number;
  points_redemption?: PointsRedemptionConfig;
  plans?: PaymentPlan[];
};

export type BoundWallet = {
  chain_id: number;
  address: string;
  status: string;
  is_primary: boolean;
  verified_at?: string | null;
};

export type CreatedIntent = {
  intent?: {
    intent_id: string;
    order_id_hex: string;
    plan_code: string;
    amount_usdc: string;
    allowed_wallet?: string | null;
  };
  tx_payload?: {
    chain_id: number;
    to: string;
    data: string;
    value: string;
    amount_units: string;
    token_address: string;
    token_symbol?: string;
    token_decimals?: number;
  };
  direct_payment?: {
    chain_id: number;
    chain?: string;
    chain_name?: string;
    token_symbol?: string;
    token_address: string;
    token_decimals?: number;
    receiver_address: string;
    amount_units: string;
    amount_usdc: string;
    intent_id: string;
    expires_at: string;
    explorer_tx_url?: string;
  };
};

export type IntentStatusResponse = {
  intent?: {
    intent_id?: string;
    status?: string;
    tx_hash?: string | null;
  };
};

declare global {
  interface Window {
    ethereum?: EvmProvider;
    okxwallet?: {
      ethereum?: EvmProvider;
    };
    okexchain?: EvmProvider;
    rabby?: EvmProvider;
    bitkeep?: {
      ethereum?: EvmProvider;
    };
  }
}

export type EvmProvider = {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  providers?: EvmProvider[];
  connect?: (args?: any) => Promise<void>;
  disconnect?: () => Promise<void>;
  session?: unknown;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isBitKeep?: boolean;
};

export type ProviderMode = "auto" | "walletconnect";

export type ProviderSelection = {
  provider: EvmProvider;
  label: string;
  mode: ProviderMode;
};

export type InjectedProviderOption = ProviderSelection & {
  key: string;
};

export type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: EvmProvider;
};

export type ConnectBindOptions = {
  openOverlayAfterBind?: boolean;
};

export type PaymentRecoveryState = {
  intentId: string;
  txHash: string;
  userId: string;
  createdAt: number;
};

