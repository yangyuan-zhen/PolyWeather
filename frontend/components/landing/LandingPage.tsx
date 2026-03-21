import Link from "next/link";
import {
  ArrowRight,
  Bot,
  ChartColumnIncreasing,
  ChevronRight,
  Compass,
  MapPinned,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import styles from "./LandingPage.module.css";

const problemCards = [
  {
    title: "普通天气预报不等于结算判断",
    body: "大多数天气产品只给一个最高温数字。温度市场真正关心的是最终会落进哪个结算桶，以及这个判断有多稳。",
    points: ["不是看“几度左右”", "而是看结算桶概率", "以及当前市场是否错价"],
  },
  {
    title: "单一数据源不够稳",
    body: "机场实测、官方结算源、集合预报、多模型 spread 会互相打架。PolyWeather 的价值，在于把这些冲突信息组织成决策视图。",
    points: ["METAR / HKO / CWA", "Open-Meteo ensemble", "DEB 融合与回看"],
  },
  {
    title: "交易需要即时上下文",
    body: "当日高温窗口、max so far、模型崩盘、盘口偏移，都比一个静态 forecast 更接近真实交易判断。",
    points: ["今日日内分析", "历史对账", "market scan 与 edge"],
  },
];

const featureCards = [
  {
    icon: Radar,
    title: "多源天气",
    body: "整合 METAR、官方源、Open-Meteo、ensemble 与 multi-model，不把风险押在单一来源上。",
  },
  {
    icon: Target,
    title: "结算概率",
    body: "把 forecast 变成 settlement-focused bucket distribution，而不是只给一个模糊最高温。",
  },
  {
    icon: ChartColumnIncreasing,
    title: "错价扫描",
    body: "把模型概率和市场报价放在一张桌子上，直接判断 signal、risk 和 tradable 状态。",
  },
  {
    icon: Bot,
    title: "双端交付",
    body: "Web 仪表盘负责看全局，Telegram Bot 负责高频使用与即时查询。",
  },
];

const trustCards = [
  {
    title: "官方参考出口",
    body: "重点城市已经补上官方气象机构、机场页面与 METAR 入口。用户可以自己交叉验证，不必盲信结论。",
    points: ["Singapore / Wellington / Hong Kong", "机场实测与国家气象机构", "降低临近结算争议成本"],
  },
  {
    title: "历史对账与日内分析",
    body: "不只给今天的判断，也给你过去表现与 intraday 结构，帮助理解模型稳定性而不是只看单点结果。",
    points: ["历史最高温对账", "今日日内曲线", "模型与实测偏差回看"],
  },
];

export function LandingPage() {
  return (
    <main className={styles.page}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-12%] top-[-8%] h-[420px] w-[420px] rounded-full bg-cyan-400/12 blur-3xl" />
        <div className="absolute right-[-12%] top-[8%] h-[360px] w-[360px] rounded-full bg-blue-500/12 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[28%] h-[320px] w-[320px] rounded-full bg-sky-900/40 blur-3xl" />
      </div>

      <section className="pt-6 md:pt-10">
        <div className={styles.shell}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-slate-950/70 text-cyan-300 shadow-glow">
                <Compass size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-[0.16em] text-slate-300 uppercase">
                  PolyWeather
                </div>
                <div className="text-xs text-slate-500">
                  Weather market intelligence
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="/dashboard" className={styles.secondaryButton}>
                打开 Dashboard
              </Link>
              <Link href="/auth/login?next=%2Faccount" className={styles.primaryButton}>
                登录账户
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <div className={styles.heroGrid}>
            <div className={`${styles.panel} ${styles.heroCard}`}>
              <div className={styles.heroEyebrow}>
                <Sparkles size={14} />
                Settlement-Focused Weather Intelligence
              </div>
              <h1 className={styles.heroTitle}>
                面向天气结算市场的实时概率情报平台
              </h1>
              <p className={styles.heroLead}>
                PolyWeather 把机场实测、官方结算源、ensemble 区间、多模型 spread
                与当日高温窗口，整理成结算导向概率、错价扫描和可操作的风控视图。
                不是做“明天大概多少度”的天气站，而是做“今天这个市场值不值得动”的决策终端。
              </p>

              <div className={styles.heroActions}>
                <Link href="/dashboard" className={styles.primaryButton}>
                  查看仪表盘
                  <ArrowRight size={16} />
                </Link>
                <Link href="/account" className={styles.secondaryButton}>
                  开通 Pro
                  <Wallet size={16} />
                </Link>
                <a
                  href="https://t.me/WeatherQuant_bot"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.secondaryButton}
                >
                  Telegram Bot
                  <ChevronRight size={16} />
                </a>
              </div>

              <div className={styles.bulletGrid}>
                <div className={styles.bulletItem}>
                  <Radar size={16} />
                  <div>
                    <strong>30 个城市，覆盖不同结算口径</strong>
                    <span>包括 METAR 城市、香港 HKO、台北 CWA，以及多地区风险分布。</span>
                  </div>
                </div>
                <div className={styles.bulletItem}>
                  <ShieldCheck size={16} />
                  <div>
                    <strong>不是黑箱结论</strong>
                    <span>已经补上官方参考链接、历史对账、今日日内分析和市场对照。</span>
                  </div>
                </div>
                <div className={styles.bulletItem}>
                  <MapPinned size={16} />
                  <div>
                    <strong>Dashboard + Bot 双端交付</strong>
                    <span>Web 看全局，Bot 处理高频操作，Pro 用于更完整的决策支持。</span>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.heroSide}>
              <div className={`${styles.panel} ${styles.signalCard}`}>
                <div className={styles.signalHeader}>
                  <div>
                    <h3>交易前真正需要看什么</h3>
                    <p>不是单一 forecast，而是结算、分布、盘口和时段上下文。</p>
                  </div>
                  <span className={styles.statusPill}>Live System</span>
                </div>

                <div className={styles.metricGrid}>
                  <div className={styles.metricCard}>
                    <label>覆盖城市</label>
                    <strong>30</strong>
                    <span>同时覆盖摄氏和华氏结算市场。</span>
                  </div>
                  <div className={styles.metricCard}>
                    <label>主要视角</label>
                    <strong>μ + 桶</strong>
                    <span>不只给中心值，还给 bucket distribution。</span>
                  </div>
                  <div className={styles.metricCard}>
                    <label>数据层</label>
                    <strong>实测 + 预报</strong>
                    <span>METAR、官方源、ensemble、multi-model 共同进入决策链。</span>
                  </div>
                  <div className={styles.metricCard}>
                    <label>交付端</label>
                    <strong>Web + Bot</strong>
                    <span>既能看地图，也能在 Telegram 里快速查询。</span>
                  </div>
                </div>

                <div className={styles.previewStrip}>
                  <div className={styles.previewRow}>
                    <span>今日日内分析</span>
                    <strong>高温窗口 + max so far</strong>
                  </div>
                  <div className={styles.previewRow}>
                    <span>历史对账</span>
                    <strong>按结算口径回看命中</strong>
                  </div>
                  <div className={styles.previewRow}>
                    <span>市场扫描</span>
                    <strong>模型概率 vs 市场价格</strong>
                  </div>
                </div>
              </div>

              <div className={`${styles.panel} ${styles.signalCard}`}>
                <div className={styles.signalHeader}>
                  <div>
                    <h3>当前产品定位</h3>
                    <p>从天气数据走到市场判断，而不是停留在天气展示。</p>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className={styles.previewRow}>
                    <span>Free</span>
                    <strong>基础看板与账户</strong>
                  </div>
                  <div className={styles.previewRow}>
                    <span>Pro</span>
                    <strong>完整分析、Bot 支持、更多上下文</strong>
                  </div>
                  <div className={styles.previewRow}>
                    <span>Ops</span>
                    <strong>会员、补分、支付异常单、运营视图</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>普通天气预报，不等于结算判断</h2>
            </div>
            <p>
              温度市场真正值钱的不是“明天最高温大概几度”，而是“今天最终更可能落进哪个桶，这个判断有多稳，市场价格有没有偏离”。
            </p>
          </div>

          <div className={styles.problemGrid}>
            {problemCards.map((card) => (
              <article key={card.title} className={`${styles.panel} ${styles.miniCard}`}>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <ul>
                  {card.points.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>把天气数据转成可交易的结算情报</h2>
            </div>
            <p>
              PolyWeather 的核心不是增加信息数量，而是把采集、概率、市场和交付整理成一个可执行工作流。
            </p>
          </div>

          <div className={styles.featureGrid}>
            {featureCards.map(({ icon: Icon, title, body }) => (
              <article key={title} className={`${styles.panel} ${styles.miniCard}`}>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/18 bg-cyan-400/8 text-cyan-300">
                  <Icon size={18} />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>不是黑箱结论，而是可验证的判断</h2>
            </div>
            <p>
              当市场接近结算，真正有价值的是可验证性。用户可以同时看官方参考、机场实测、历史对账和当日结构，而不是只看一个数字。
            </p>
          </div>

          <div className={styles.proofGrid}>
            {trustCards.map((card) => (
              <article key={card.title} className={`${styles.panel} ${styles.miniCard}`}>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <ul>
                  {card.points.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <article className={`${styles.panel} ${styles.previewPanel}`}>
            <div className={styles.previewTop}>
              <h3>一个页面看完当日温度交易所需信息</h3>
              <p>
                地图筛城市，侧边栏看风险，详情面板看今日日内分析、历史对账、官方参考和市场扫描。你不需要在多个天气网站、机场页和市场页之间来回切。
              </p>
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewMap}>
                <div className={styles.mapChip} style={{ left: "9%", top: "18%" }}>
                  <strong>London</strong>
                  <span>12°C</span>
                </div>
                <div className={styles.mapChip} style={{ left: "54%", top: "20%" }}>
                  <strong>Hong Kong</strong>
                  <span>17°C</span>
                </div>
                <div className={styles.mapChip} style={{ left: "22%", top: "54%" }}>
                  <strong>New York</strong>
                  <span>54°F</span>
                </div>
                <div className={styles.mapChip} style={{ left: "63%", top: "63%" }}>
                  <strong>Singapore</strong>
                  <span>31°C</span>
                </div>
              </div>

              <div className={styles.previewStack}>
                <div className={styles.stackCard}>
                  <h4>今日日内分析</h4>
                  <p>高温窗口、max so far、集合区间和死盘提示，解决“今天还有没有变盘空间”。</p>
                </div>
                <div className={styles.stackCard}>
                  <h4>历史对账</h4>
                  <p>把过去真实结算和模型表现放回同一张表里，避免只看当天情绪。</p>
                </div>
                <div className={styles.stackCard}>
                  <h4>官方参考</h4>
                  <p>重点城市直连国家气象机构、机场页面和 METAR，降低临近结算争议。</p>
                </div>
                <div className={styles.stackCard}>
                  <h4>支付与会员</h4>
                  <p>账户页支持浏览器钱包、订阅、积分与支付异常恢复，不再只是“有个付费按钮”。</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>从公开看板到 Pro 决策支持</h2>
            </div>
            <p>
              先让用户看到产品价值，再把更重的使用场景放到账户、Bot 和订阅能力里，不靠含糊营销话术成交。
            </p>
          </div>

          <div className={styles.pricingGrid}>
            <article className={`${styles.panel} ${styles.pricingCard}`}>
              <h3>Free</h3>
              <p>先理解产品逻辑，再决定是否进入更高频的使用方式。</p>
              <div className={styles.price}>
                <strong>$0</strong>
                <span>基础入口</span>
              </div>
              <ul>
                <li>地图与城市风险概览</li>
                <li>基础账户能力</li>
                <li>公开可见的页面与数据口径</li>
              </ul>
            </article>

            <article className={`${styles.panel} ${styles.pricingCard} ${styles.pricingCardAccent}`}>
              <h3>Pro</h3>
              <p>面向高频使用者、市场观察者和需要 Telegram 辅助的人群。</p>
              <div className={styles.price}>
                <strong>5 USDC</strong>
                <span>/ 月</span>
              </div>
              <ul>
                <li>完整分析、更多上下文与账户中心能力</li>
                <li>Telegram Bot 交互与更高频使用场景</li>
                <li>支付、积分、订阅与异常恢复链路</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <div className={styles.ctaGrid}>
            <article className={`${styles.panel} ${styles.ctaCard}`}>
              <h3>开始使用 PolyWeather</h3>
              <p>
                如果你只是想先看产品，直接打开 Dashboard。需要账户、订阅、支付与会员能力，再进入账户中心。
              </p>
              <div className={styles.ctaActions}>
                <Link href="/dashboard" className={styles.primaryButton}>
                  打开 Dashboard
                  <ArrowRight size={16} />
                </Link>
                <Link href="/account" className={styles.secondaryButton}>
                  进入账户中心
                </Link>
              </div>
            </article>

            <article className={`${styles.panel} ${styles.ctaCard}`}>
              <h3>高频使用更适合 Bot</h3>
              <p>
                如果你本来就习惯在 Telegram 中工作，用 Bot 会比网页切换更快。Web 负责看全局，Bot 负责高频查询和快速反馈。
              </p>
              <div className={styles.ctaActions}>
                <a
                  href="https://t.me/WeatherQuant_bot"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.secondaryButton}
                >
                  打开 Telegram Bot
                  <ChevronRight size={16} />
                </a>
              </div>
            </article>
          </div>

          <footer className={styles.footer}>
            <div className={styles.footerRow}>
              <span>PolyWeather is built for settlement-focused weather decision support, not generic consumer forecasting.</span>
              <div className={styles.footerLinks}>
                <Link href="/dashboard">Dashboard</Link>
                <Link href="/account">Account</Link>
                <Link href="/ops">Ops</Link>
              </div>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}
