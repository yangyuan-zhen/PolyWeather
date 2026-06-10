export function createAccountCopy(isEn: boolean): Record<string, string> {
  return {
      backHome: isEn ? "Back to Home" : "返回首页",
      accountCenter: isEn ? "Account Center" : "账户中心",
      loadingAccount: isEn ? "Loading account info..." : "加载账户信息中...",
      refresh: isEn ? "Refresh" : "刷新",
      signOut: isEn ? "Sign Out" : "退出",
      signIn: isEn ? "Sign In" : "登录",
      upgradePro: isEn ? "Upgrade Pro" : "升级 Pro",
      guestUser: isEn ? "Signed-out account" : "未登录账户",
      joinedAt: isEn ? "Joined" : "加入时间",
      totalPoints: isEn ? "Total Points" : "总积分 (荣誉)",
      weeklyPoints: isEn ? "This Month Invites" : "本月有效邀请",
      weeklyRank: isEn ? "Monthly Cap" : "月度上限",
      weeklyRewards: isEn ? "Referral Rewards" : "邀请奖励",
      membershipDetails: isEn ? "Membership Details" : "会员权限详情",
      identityStatus: isEn ? "Identity Status" : "身份状态",
      accountFeedbackTitle: isEn ? "My Feedback" : "我的反馈",
      accountFeedbackDescription: isEn
        ? "Recent reports you submitted and their current handling status."
        : "你最近提交过的反馈及当前处理状态。",
      authMode: isEn ? "Auth Mode" : "鉴权模式",
      weatherEngine: isEn ? "Weather Engine" : "气象引擎",
      intradayAnalysis: isEn ? "Intraday Analysis" : "今日内分析",
      historyFuture: isEn
        ? "Future-date + Multi-city Chart Monitoring"
        : "未来日期分析 + 多城市图表巡检",
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
        ? "Fallback copy method: click Copy to generate a 10-minute one-time /start bind command, send it to @polyyuanbot, then confirm binding in the Bot and refresh this page."
        : "兜底复制方式：点击复制会生成 10 分钟有效的一次性 /start bind 命令。请把它发送给 @polyyuanbot，并在 Bot 内确认绑定后刷新本页。",
      telegramBindCommandPlaceholder: isEn
        ? "Click Copy to generate a one-time /start bind command"
        : "点击复制生成一次性 /start bind 命令",
      telegramBindCommandCopied: isEn
        ? "One-time Telegram bind command generated and copied. Send it to @polyyuanbot, then confirm binding in the Bot."
        : "一次性 Telegram 绑定命令已生成并复制。请发送给 @polyyuanbot，然后在 Bot 内确认绑定。",
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
      proPlan: isEn ? "Pro Plan" : "Pro 套餐",
      monthlyPlan: isEn ? "Monthly" : "月付",
      quarterlyPlan: isEn ? "Quarterly" : "季度",
      trialBadge: isEn ? "3-day trial" : "3天试用",
      trialPaidGroupLocked: isEn
        ? "Trial users can use the core product experience, but the paid Telegram group is available to full Pro subscriptions only."
        : "3天试用用户可体验核心产品，但无法进入付费 Telegram 群；付费群仅对正式 Pro 开放。",
      referralTitle: isEn ? "Referral Code" : "邀请码",
      referralMyCode: isEn ? "My invite code" : "我的邀请码",
      referralApplyLabel: isEn ? "Use invite code" : "使用邀请码",
      referralApplyPlaceholder: isEn ? "Enter invite code" : "输入邀请码",
      referralApplyButton: isEn ? "Apply" : "应用",
      referralApplied: isEn
        ? "Referral code applied. Your first monthly payment is now discounted."
        : "邀请码已应用，首月 Pro 将按邀请价结算。",
      referralApplyFailed: isEn ? "Failed to apply referral code" : "邀请码应用失败",
      referralDiscountHint: isEn
        ? "Invite discount: first monthly Pro is 20 USDC."
        : "邀请首月价：Pro 月付 20 USDC。",
      referralRewardHint: isEn
        ? "When an invited user pays for Pro, you receive +3500 points."
        : "被邀请人成功付费后，邀请人获得 +3500 积分。",
      referralInviteLimit: isEn
        ? "Monthly referral reward cap: 10 paid invites, up to +35000 points."
        : "每月最多 10 个有效付费邀请奖励，最高 +35000 积分。",
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
      proPendingSync: isEn ? "Activated (pending sync)" : "已开通（待同步）",
      subscriptionChecking: isEn ? "Checking subscription" : "订阅同步中",
      subscriptionUnknown: isEn
        ? "Subscription status is syncing. Please refresh shortly."
        : "订阅状态正在同步，请稍后刷新。",
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
        ? "Option 2: Transfer directly to the platform's receiver address without binding a wallet. After the transfer, submit the transaction hash (Tx Hash) and the system will verify and activate Pro automatically."
        : "方式二：无需将钱包绑定到账号，直接向平台收款地址转账。转账完成后提交交易哈希（Tx Hash）系统会自动验签并开通 Pro。",
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
      // ── Payment status messages ──────────────────────────────────────
      orderAlreadyPaid: isEn
        ? "This order is already paid. Restoring subscription..."
        : "该订单已支付，正在恢复订阅...",
      orderExpired: isEn
        ? "Payment order expired (valid for 30 minutes). Please create a new order."
        : "支付订单已过期（30分钟有效），请重新创建订单。",
      paymentConfirmed: isEn
        ? "Payment confirmed. Transaction: {txHash}"
        : "支付确认成功，交易: {txHash}",
      txSubmitted: isEn
        ? "Transaction submitted: {txHash}, confirming on chain (status: {status})..."
        : "交易已提交: {txHash}，正在链上确认（状态: {status}）...",
      paymentPendingTimeout: isEn
        ? "Payment pending timeout."
        : "支付等待超时。",
      approvalDetected: isEn
        ? "Insufficient allowance detected. Requesting {symbol} approval..."
        : "检测到授权不足，正在发起 {symbol} 授权...",
      approvalDone: isEn
        ? "{symbol} approval successful. Sending payment..."
        : "{symbol} 授权成功，正在发起支付...",
      approvalSufficient: isEn
        ? "Allowance sufficient. Sending payment..."
        : "授权额度充足，正在发起支付...",
      approvalDoneCancelled: isEn
        ? "{symbol} approval completed. This payment was cancelled. You can pay again."
        : "{symbol} 授权已完成，本次支付已取消，可直接再次点击支付。",
      approvalDoneRetry: isEn
        ? "{symbol} approval completed but payment incomplete. Please retry."
        : "{symbol} 授权已完成，但支付未完成，请重试。",
      paymentConfigUpdated: isEn
        ? "Payment config updated. Switched to latest address {address}."
        : "检测到支付配置已更新，已切换到最新地址 {address}。",
      currentReceiver: isEn
        ? "Current receiver contract: {address}"
        : "当前收款合约: {address}",
      manualOrderCreated: isEn
        ? "Manual transfer order created. Send {amount} {symbol} on {chain} to {receiver}, then submit your tx hash below."
        : "手动转账订单已创建：请在 {chain} 转 {amount} {symbol} 到 {receiver}，完成后在下方提交 tx hash。",
      manualOrderRequired: isEn
        ? "Please create a manual transfer order first."
        : "请先创建手动转账订单。",
      txHashRequired: isEn
        ? "Please enter a valid tx hash."
        : "请输入有效的 tx hash。",
      verifying: isEn ? "Verifying..." : "验证中...",
      verifyAddressMatch: isEn
        ? "Receiver address and amount match"
        : "收款地址和金额匹配",
      verifyTxNotMined: isEn
        ? "Transaction not yet mined. Please wait."
        : "交易未上链，请等待",
      verifyAddressMismatch: isEn
        ? "Receiver address mismatch! Please transfer to the correct receiver address."
        : "收款地址不匹配！请转账到正确的收款地址。",
      verifyAmountLow: isEn
        ? "Transfer amount is insufficient."
        : "转账金额不足",
      verifyTxReverted: isEn
        ? "This transaction was reverted."
        : "该交易已回滚",
      verifyFailed: isEn ? "Verification failed: " : "验证失败: ",
      verifyUnknown: isEn ? "Unknown error" : "未知错误",
      // ── Telegram bind messages ────────────────────────────────────────
      telegramVerifySuccess: isEn
        ? "Telegram group membership verified. Member monthly price {amount} USDC is active."
        : "Telegram 群成员验证成功，群友月付价 {amount} USDC 已生效。",
      telegramBindClickHint: isEn
        ? "Open the Telegram Bot, click Start, and confirm binding. Then refresh this page to request group entry."
        : "已打开 Telegram Bot，请在 Bot 内点击 Start 并确认绑定；完成后刷新本页再申请入群。",
      telegramPopupBlocked: isEn
        ? "Popup blocked. Please click the link below to complete binding:"
        : "弹窗被拦截，请点击下方链接完成绑定：",
      telegramBindFailed: isEn
        ? "Failed to create Telegram bind link"
        : "创建 Telegram 绑定链接失败",
      telegramBindLinkMissing: isEn
        ? "Telegram bind link missing"
        : "Telegram 绑定链接缺失",
      // ── Wallet errors ──────────────────────────────────────────────────
      noWalletProvider: isEn
        ? "No EVM wallet provider found"
        : "未检测到 EVM 钱包插件",
      txReverted: isEn
        ? "Transaction reverted: {txHash}"
        : "交易已回滚: {txHash}",
      txConfirmTimeout: isEn
        ? "Transaction confirmation timeout: {txHash}"
        : "交易确认超时: {txHash}",
      queryIntentFailed: isEn
        ? "Query intent failed: {raw}"
        : "查询支付意向失败: {raw}",
      paymentStatus: isEn ? "Payment {status}" : "支付状态: {status}",
      createIntentFailed: isEn
        ? "Create intent failed: {raw}"
        : "创建支付意向失败: {raw}",
      intentPayloadInvalid: isEn
        ? "Intent payload invalid"
        : "支付意向数据无效",
      intentTokenInvalid: isEn
        ? "Intent token/amount invalid"
        : "支付币种或金额无效",
      submitTxFailed: isEn
        ? "Submit transaction failed: {raw}"
        : "提交交易失败: {raw}",
      confirmFailed: isEn
        ? "Confirm failed: {raw}"
        : "确认失败: {raw}",
      createManualIntentFailed: isEn
        ? "Create manual intent failed: {raw}"
        : "创建手动转账订单失败: {raw}",
      manualPaymentInvalid: isEn
        ? "Manual payment payload invalid"
        : "手动转账数据无效",
      bindFailed: isEn ? "Bind failed: {raw}" : "绑定失败: {raw}",
      challengeFailed: isEn
        ? "Challenge failed: {raw}"
        : "钱包验证挑战失败: {raw}",
      challengeInvalid: isEn
        ? "Challenge payload invalid"
        : "验证挑战数据无效",
      verifyFailedRaw: isEn ? "Verify failed: {raw}" : "钱包验证失败: {raw}",
      httpError: isEn ? "HTTP {status} {raw}" : "HTTP 错误 {status}: {raw}",
      loadConfigFailed: isEn
        ? "Load payment config failed: {raw}"
        : "加载支付配置失败: {raw}",
      // ── Points / Footer ────────────────────────────────────────────────
      pointsRule: isEn
        ? "Points rule: points are earned through successful paid referrals only. 500 points = 1 USDC. Monthly orders can use up to 3 USDC off; quarterly orders can use up to 8 USDC off."
        : "积分规则：积分仅通过有效付费邀请获得。500 积分 = 1 USDC。月付订单最多抵扣 3 USDC，季度订单最多抵扣 8 USDC。",
      pointsDiscount: isEn
        ? "Available: {points} points discounting ${amount}. Applied automatically on renewal."
        : "当前可用 {points} 积分抵扣 ${amount}，续费时会自动生效。",
      footerEngine: isEn
        ? "PolyWeather Global Meteorological Engine · Powered by AI"
        : "PolyWeather 全球气象引擎 · AI 驱动",
      binanceBindHint: isEn
        ? "Binance extension bound. If payment is stuck, please use WalletConnect QR payment."
        : "Binance 扩展已绑定；如支付卡住，请优先使用 WalletConnect 扫码支付。",
      walletBound: isEn
        ? "{label} bound: {address}. You can now pay to activate your subscription."
        : "{label} 已绑定: {address}。现在可点击「立即订阅并激活服务」。",
      walletBoundSuccess: isEn
        ? "{label} bound: {address}."
        : "{label} 绑定成功: {address}。",
    };
}
