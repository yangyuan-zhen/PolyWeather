export function createAccountCopy(isEn: boolean): Record<string, string> {
  return {
      backHome: isEn ? "Back to Home" : "返回首页",
      accountCenter: isEn ? "Account Center" : "账户中心",
      loadingAccount: isEn ? "Loading account info..." : "加载账户信息中...",
      refresh: isEn ? "Refresh" : "刷新",
      signOut: isEn ? "Sign Out" : "退出",
      signIn: isEn ? "Sign In" : "登录",
      upgradePro: isEn ? "Upgrade Pro" : "升级 Pro",
      guestUser: isEn ? "Guest User" : "游客用户",
      joinedAt: isEn ? "Joined" : "加入时间",
      totalPoints: isEn ? "Total Points" : "总积分 (荣誉)",
      weeklyPoints: isEn ? "Weekly Points" : "本周积分 (竞技)",
      weeklyRank: isEn ? "Weekly Rank" : "周排行 (竞技)",
      weeklyRewards: isEn ? "Weekly Rewards" : "周榜奖励",
      membershipDetails: isEn ? "Membership Details" : "会员权限详情",
      identityStatus: isEn ? "Identity Status" : "身份状态",
      authMode: isEn ? "Auth Mode" : "鉴权模式",
      weatherEngine: isEn ? "Weather Engine" : "气象引擎",
      intradayAnalysis: isEn ? "Intraday Analysis" : "今日内分析",
      historyFuture: isEn
        ? "Future-date + Decision Card Analysis"
        : "未来日期分析 + 城市决策卡",
      smartPush: isEn
        ? "Cross-platform Smart Weather Push"
        : "全平台智能气象查询",
      deepMode: isEn
        ? "Deep mode (incl. high-temp window)"
        : "深度版（含高温时段）",
      compactVisible: isEn ? "Compact visible" : "简版可见",
      enabled: isEn ? "Enabled" : "已开启",
      locked: isEn ? "Locked" : "锁定",
      boundEmail: isEn ? "Bound Email" : "绑定邮箱",
      loginMethod: isEn ? "Sign-in Method" : "登录方式",
      renewalDate: isEn ? "Renewal Date" : "续费日期",
      accessUntil: isEn ? "Access Until" : "可用至",
      authResult: isEn ? "Auth Result" : "鉴权结果",
      passed: isEn ? "Passed" : "通过",
      restricted: isEn ? "Restricted" : "受限",
      telegramBind: isEn ? "Telegram Bot Binding" : "Telegram Bot 绑定",
      telegramHint: isEn
        ? "Use one-click Telegram binding first to sync notifications and access. After binding, refresh this page and submit your Telegram group join request."
        : "优先使用「一键绑定 Telegram Bot」同步通知与权限。绑定完成后刷新本页，再提交 Telegram 群组入群申请。",
      telegramFallbackHint: isEn
        ? "Fallback copy method: only use this if one-click binding does not open Telegram correctly. Copy the command below and send it to @polyyuanbot. After binding, refresh this page to show the group entry."
        : "兜底复制方式：仅在一键绑定无法正常打开 Telegram 时使用。请复制下方命令并发送给 @polyyuanbot。绑定完成后刷新本页，即可显示入群入口。",
      paymentManualSupport: isEn
        ? "If payment succeeds but Pro is still not activated, email yhrsc30@gmail.com. This project is currently maintained by one developer, so manual recovery may be needed in edge cases."
        : "如果付款成功后 Pro 仍未开通，请发邮件到 yhrsc30@gmail.com。当前项目由我一人维护，极少数边缘情况可能需要人工补开。给你带来的不便，敬请谅解！",
      telegramBotLink: isEn
        ? "Open Bot (@polyyuanbot)"
        : "打开机器人 (@polyyuanbot)",
      telegramBotBindLink: isEn ? "One-click Telegram Binding" : "一键绑定 Telegram Bot",
      telegramGroupLink: isEn ? "Join Telegram Group" : "加入 Telegram 群组",
      telegramTopicsGroupLink: isEn
        ? "Real-time Weather Updates"
        : "城市实测温度群",
      copyCommand: isEn ? "Copy fallback command" : "复制兜底命令",
      paymentMgmt: isEn ? "Payment Management" : "支付管理",
      paymentToken: isEn ? "Payment Token" : "支付币种",
      paymentAccount: isEn ? "Subscription Account" : "订阅归属账号",
      paymentWallet: isEn ? "Paying Wallet" : "付款钱包",
      paymentReceiver: isEn ? "Receiver Contract" : "当前收款合约",
      paymentNetwork: isEn ? "Payment Network" : "支付网络",
      paymentHost: isEn ? "Payment Host" : "支付域名",
      primary: "Primary",
      polygonChain: isEn ? "Polygon Network" : "Polygon 网络",
      noWallet: isEn ? "No payment wallet bound yet." : "未绑定任何付款钱包",
      bindExt: isEn
        ? "Bind Browser Wallet (EVM Extension)"
        : "绑定浏览器钱包（EVM扩展）",
      bindQr: isEn
        ? "Bind via QR (WalletConnect)"
        : "扫码绑定（WalletConnect）",
      walletConnectMissing: isEn
        ? "WalletConnect disabled: please configure"
        : "未启用 WalletConnect：请配置",
      walletExtensionDetected: isEn
        ? "Detected browser wallets"
        : "检测到的浏览器钱包",
      walletExtensionChoose: isEn
        ? "Choose extension wallet"
        : "选择浏览器钱包",
      walletRecoveryBusy: isEn
        ? "Recovering Pro entitlement after on-chain payment..."
        : "正在根据链上支付恢复 Pro 权限...",
      walletRecoveryDone: isEn
        ? "Pro entitlement recovered."
        : "Pro 权限已恢复。",
      walletRecoveryFailed: isEn
        ? "A recent on-chain payment is still syncing to your subscription. Please refresh in a minute or contact support."
        : "检测到最近的链上支付流程，但订阅状态仍在同步中。请稍后刷新，或联系管理员处理。",
      unbind: isEn ? "Unbind" : "解绑",
      unbindConfirm: isEn
        ? "Unbind wallet {address}? You can bind it again later."
        : "确认解绑钱包 {address}？后续可重新绑定。",
      unbindDone: isEn ? "Wallet unbound." : "钱包已解绑。",
      unbindDonePrimary: isEn
        ? "Wallet unbound. New primary: {address}"
        : "钱包已解绑，新的主钱包：{address}",
      unbindFailed: isEn ? "Failed to unbind wallet" : "解绑钱包失败",
      authExpired: isEn
        ? "Session expired. Please sign out and sign in again."
        : "登录会话已失效，请退出后重新登录。",
      payNow: isEn ? "Subscribe & Activate" : "立即订阅并激活服务",
      connectAndPay: isEn ? "Connect Wallet & Pay" : "连接钱包并支付",
      loginBeforeBind: isEn
        ? "Please sign in before binding wallet."
        : "请先登录后再绑定钱包。",
      loginBeforePay: isEn
        ? "Please sign in before payment."
        : "请先登录后再支付。",
      bindFirstBeforePay: isEn
        ? "Please bind a wallet first."
        : "请先绑定钱包。",
      payNotReady: isEn
        ? "Payment service is not fully configured."
        : "支付服务未配置完成。",
      paymentHostBlocked: isEn
        ? "Payments are disabled on this host. Please return to the production site: {host}"
        : "当前域名不允许发起支付，请回到主站后重试：{host}",
      paymentGuardHint: isEn
        ? "Payment will be credited to the current account and bound wallet shown below."
        : "支付将记入下方显示的当前账号和绑定钱包，请先核对。",
      openBindFlow: isEn
        ? "Please bind a wallet first. Opening bind flow..."
        : "请先完成钱包绑定，正在拉起绑定流程...",
      walletBoundCreatingOrder: isEn
        ? "Wallet bound. Creating order and sending payment..."
        : "钱包已绑定，正在创建订单并发起支付...",
      proMember: "PRO MEMBER",
      freeTier: "FREE TIER",
      proPendingSync: isEn ? "Activated (pending sync)" : "已开通（待同步）",
      noProSubscription: isEn ? "No Pro subscription" : "暂无 Pro 订阅",
      proEndsSoonTitle: isEn ? "Pro renewal due soon" : "Pro 即将到期",
      proEndsSoonBody: isEn
        ? "Your Pro membership will expire soon. Renew now to avoid interruption."
        : "你的 Pro 会员即将到期。现在续费可避免权限中断。",
      proExpiredTitle: isEn ? "Pro expired" : "Pro 已到期",
      proExpiredBody: isEn
        ? "Your Pro membership has expired. Renew now to restore premium access."
        : "你的 Pro 会员已到期。立即续费可恢复高级权限。",
      renewNow: isEn ? "Renew Now" : "立即续费",
      daysLeft: isEn ? "{days} days left" : "剩余 {days} 天",
      queuedExtensionSummary: isEn
        ? "Current plan until {current}. Queued extension: +{days} days. Total access until {total}."
        : "当前订阅至 {current}，已排队延长 +{days} 天，总可用至 {total}。",
      paymentMethodLabel: isEn ? "Payment Method" : "请选择支付方式",
      paymentMethodWallet: isEn ? "Wallet Quick Pay" : "钱包快捷支付",
      paymentMethodManual: isEn ? "Manual On-chain Transfer" : "手动链上转账",
      paymentWalletDesc: isEn
        ? "Option 1: Bind your EVM wallet (e.g. MetaMask extension or WalletConnect QR scan) to sign and pay via smart contract. Credits are credited instantly."
        : "方式一：绑定您的 EVM 钱包（如 MetaMask 扩展或 WalletConnect 扫码），通过智能合约自动签名付款，额度即时到账。",
      paymentGasWarning: isEn
        ? "Your wallet needs a small amount of POL for gas fees; USDC alone may not complete authorization or payment. Please confirm your wallet is on Polygon network and keep some POL before paying."
        : "钱包里需要少量 POL 作为 gas 手续费；只有 USDC 可能无法完成授权或支付。请确认当前钱包在 Polygon 网络，并预留一点 POL 后再支付。",
      paymentManualDesc: isEn
        ? "Option 2: Transfer directly to the platform's receiver contract without binding a wallet. After the transfer, submit the transaction hash (Tx Hash) and the system will verify and activate Pro automatically."
        : "方式二：无需将钱包绑定到账号，直接向平台收款合约转账。转账完成后提交交易哈希（Tx Hash）系统会自动验签并开通 Pro。",
      paymentManualTitle: isEn
        ? "Manual Transfer (No Wallet Binding)"
        : "手动转账（无需绑定钱包）",
      paymentManualHint: isEn
        ? "Create an order first, transfer to the specified receiver address, then submit the tx hash here. Do not mix with the wallet payment channel."
        : "先创建订单，向指定收款地址转账，完成后在此处提交 tx hash。请勿与钱包付款通道重复混用。",
      paymentManualCreate: isEn ? "Create Transfer Order" : "创建转账订单",
      paymentAmount: isEn ? "Amount" : "金额",
      paymentReceiverLabel: isEn ? "Receiver" : "收款地址",
      paymentTxHash: "Tx Hash",
      paymentCopyAddress: isEn ? "Copy" : "复制",
      paymentManualSubmit: isEn
        ? "Submit Tx Hash & Confirm"
        : "提交 tx hash 并自动确认",
      chainReadError: isEn ? "Reading wallet network" : "读取钱包网络",
      chainSwitchError: isEn ? "Switch wallet network" : "切换钱包网络",
      chainAddPolygon: isEn ? "Add Polygon network" : "添加 Polygon 网络",
      chainSwitchPrompt: isEn
        ? "Please manually switch to Polygon network in your wallet and try again."
        : "请在钱包中手动切换到 Polygon 网络后再试。",
    };
}
