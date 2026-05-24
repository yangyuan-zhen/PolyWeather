import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CloudSun,
  Gauge,
  LineChart,
  LockKeyhole,
  Radar,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

const marketRows = [
  ["New York", "91.8°F", "+2.4", "High", "Long Yes"],
  ["Austin", "103.1°F", "+1.1", "Medium", "Wait"],
  ["Seoul", "83.4°F", "-0.7", "Low", "No Trade"],
  ["Tokyo", "88.2°F", "+1.8", "High", "Long Yes"],
  ["London", "72.6°F", "-0.2", "Low", "Observe"],
];

const coverage = [
  "Live airport observations",
  "DEB blend forecast",
  "Market-implied temperature",
  "Intraday settlement windows",
  "AI weather evidence",
  "Paid Telegram alerts",
];

const platformCards = [
  {
    icon: Radar,
    title: "Live Evidence",
    body: "Airport observations and official station data are structured for settlement-aware decisions.",
  },
  {
    icon: Gauge,
    title: "Decision Workflow",
    body: "City cards combine model forecast, current deviation, risk, and target contract context.",
  },
  {
    icon: ShieldCheck,
    title: "Paid Access",
    body: "The product workspace is locked until the user has an active subscription.",
  },
];

export function InstitutionalLandingPage() {
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white">
              <CloudSun size={20} />
            </span>
            <span>PolyWeather</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
            <a href="#platform" className="hover:text-slate-950">
              Platform
            </a>
            <a href="#coverage" className="hover:text-slate-950">
              Data Coverage
            </a>
            <a href="#pricing" className="hover:text-slate-950">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/auth/login?next=%2Fterminal"
              className="hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950 sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              href="/terminal"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Enter Product
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase text-blue-700">
              <LockKeyhole size={13} />
              Paid professional terminal
            </div>
            <h1 className="max-w-2xl text-4xl font-black leading-[1.05] tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
              Institutional weather market intelligence for paid users.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
              PolyWeather turns live METAR observations, DEB forecast blends,
              model probabilities, and market settlement logic into one
              professional decision workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/terminal"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-700 bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                Enter product
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/account"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
              >
                Subscribe / Manage account
              </Link>
            </div>
            <p className="mt-4 text-xs font-medium text-slate-500">
              No free product access. Subscription is required before the
              terminal opens.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <BarChart3 size={16} className="text-blue-700" />
                Weather Markets Dashboard
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Live
              </div>
            </div>
            <div className="grid gap-3 p-3 lg:grid-cols-[1fr_0.85fr]">
              <div className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <strong className="text-sm">Temperature Contracts</strong>
                  <span className="text-xs font-semibold text-slate-500">
                    Price / Edge / Signal
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {marketRows.map((row) => (
                    <div
                      key={row[0]}
                      className="grid grid-cols-[1.1fr_0.8fr_0.6fr_0.7fr_0.9fr] items-center gap-2 px-3 py-3 text-sm"
                    >
                      <span className="font-semibold">{row[0]}</span>
                      <span className="font-mono text-slate-700">{row[1]}</span>
                      <span
                        className={
                          row[2].startsWith("+")
                            ? "font-mono font-bold text-emerald-700"
                            : "font-mono font-bold text-red-600"
                        }
                      >
                        {row[2]}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        {row[3]}
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                        {row[4]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <strong className="text-sm">Model Stack</strong>
                    <LineChart size={16} className="text-blue-700" />
                  </div>
                  <div className="space-y-3">
                    {["DEB Blend", "Live METAR", "Market Implied"].map(
                      (label, index) => (
                        <div key={label}>
                          <div className="mb-1 flex justify-between text-xs font-semibold text-slate-500">
                            <span>{label}</span>
                            <span>{[82, 67, 74][index]}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full bg-blue-600"
                              style={{ width: `${[82, 67, 74][index]}%` }}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <TrendingUp size={16} />
                    Current Signal
                  </div>
                  <p className="text-sm leading-6 text-emerald-900">
                    New York high-temperature market shows a positive
                    observation deviation with confirmed airport evidence.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
            {platformCards.map(({ body, icon: Icon, title }) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5"
              >
                <Icon className="mb-4 text-blue-700" size={22} />
                <h2 className="text-lg font-bold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="coverage" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold uppercase text-blue-700">
                Data Coverage
              </p>
              <h2 className="mt-2 text-3xl font-black">
                Everything weather-market users need in one place.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              Built for repeat professional use: dense tables, clear status
              chips, restrained color, and fast entry into paid workflows.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold shadow-sm"
              >
                <CheckCircle2 size={17} className="text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="bg-slate-950 text-white">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase text-blue-300">
                Subscription Required
              </p>
              <h2 className="mt-2 text-3xl font-black">
                Product access starts after payment.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Users can read the landing page and account/payment guide
                publicly, but the decision terminal opens only for active paid
                accounts.
              </p>
            </div>
            <Link
              href="/account"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-blue-50"
            >
              <Activity size={16} />
              Subscribe now
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
