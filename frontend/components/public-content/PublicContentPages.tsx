import Link from "next/link";
import { LandingLocaleToggle } from "@/components/landing/LandingLocaleToggle";
import type { LandingLocale } from "@/components/landing/landingLocale";
import {
  METHODOLOGY_PAGES,
  PUBLIC_CONTENT_COPY,
  PUBLIC_BRIEFS,
  SOURCE_PAGES,
  absolutePublicUrl,
  briefPath,
  methodologyPath,
  sourcePath,
  localizeBrief,
  localizeBriefs,
  localizeMethodologyPage,
  localizeSourcePage,
  type MethodologyPage,
  type PublicBrief,
  type SourcePage,
} from "@/content/public-content";
import {
  PublicContentAnalytics,
  PublicContentCta,
  PublicContentOutboundLink,
} from "./PublicContentAnalytics";

const pageShell =
  "min-h-screen bg-[#f4f7fb] text-slate-950";
const contentWrap =
  "mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8";
const panel =
  "rounded-lg border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]";
const sectionTitle =
  "text-sm font-semibold uppercase tracking-[0.08em] text-slate-500";
const bodyText = "text-sm leading-6 text-slate-700";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50";

function PublicHeader({ locale = "en-US" }: { locale?: LandingLocale }) {
  const copy = PUBLIC_CONTENT_COPY[locale];

  return (
    <header className="border-b border-slate-200 bg-white/90">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link className="text-base font-black text-slate-950" href="/">
          PolyWeather
        </Link>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <nav className="flex flex-wrap gap-2 text-sm font-semibold text-slate-700">
            <Link className="rounded-md px-2.5 py-1.5 hover:bg-slate-100" href="/briefs">
              {locale === "en-US" ? "Briefs" : "简报"}
            </Link>
            <Link className="rounded-md px-2.5 py-1.5 hover:bg-slate-100" href="/methodology">
              {copy.methodology}
            </Link>
            <Link className="rounded-md px-2.5 py-1.5 hover:bg-slate-100" href="/sources">
              {copy.sources}
            </Link>
            <Link className="rounded-md px-2.5 py-1.5 hover:bg-slate-100" href="/docs/intro">
              {copy.docs}
            </Link>
          </nav>
          <LandingLocaleToggle locale={locale} />
        </div>
      </div>
    </header>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="grid gap-4 border-b border-slate-200 bg-white">
      <div className={`${contentWrap} py-10 sm:py-12`}>
        <p className={sectionTitle}>{eyebrow}</p>
        <div className="max-w-3xl space-y-4">
          <h1 className="text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
            {title}
          </h1>
          <p className="text-base leading-7 text-slate-700">{description}</p>
        </div>
      </div>
    </section>
  );
}

function SourceLinks({ locale = "en-US", slugs }: { locale?: LandingLocale; slugs: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {slugs.map((slug) => {
        const source = SOURCE_PAGES.find((entry) => entry.slug === slug);
        if (!source) return null;
        const localizedSource = localizeSourcePage(source, locale);
        return (
          <Link
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            href={sourcePath(localizedSource)}
            key={slug}
          >
            {localizedSource.title}
          </Link>
        );
      })}
    </div>
  );
}

function MethodologyLinks({ locale = "en-US", slugs }: { locale?: LandingLocale; slugs: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {slugs.map((slug) => {
        const page = METHODOLOGY_PAGES.find((entry) => entry.slug === slug);
        if (!page) return null;
        const localizedPage = localizeMethodologyPage(page, locale);
        return (
          <Link
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            href={methodologyPath(localizedPage)}
            key={slug}
          >
            {localizedPage.title}
          </Link>
        );
      })}
    </div>
  );
}

function BriefCard({
  brief,
  locale = "en-US",
  readBriefLabel,
}: {
  brief: PublicBrief;
  locale?: LandingLocale;
  readBriefLabel: string;
}) {
  return (
    <article className={`${panel} flex flex-col gap-5 p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-700">
            {brief.cityName} / {brief.date}
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            <Link href={briefPath(brief)}>{brief.title}</Link>
          </h2>
        </div>
        <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
          {brief.settlementSource}
        </span>
      </div>
      <p className={bodyText}>{brief.description}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {brief.signals.map((signal) => (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={signal.label}>
            <p className="text-xs font-semibold text-slate-500">{signal.label}</p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-950">{signal.value}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{signal.detail}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link className={secondaryButton} href={briefPath(brief)}>
          {readBriefLabel}
        </Link>
        <SourceLinks locale={locale} slugs={brief.sourceSlugs.slice(0, 2)} />
      </div>
    </article>
  );
}

export function BriefsIndexPageView({ locale = "en-US" }: { locale?: LandingLocale }) {
  const copy = PUBLIC_CONTENT_COPY[locale];
  const briefs = localizeBriefs(locale);

  return (
    <div className={pageShell}>
      <PublicHeader locale={locale} />
      <PageIntro
        description={copy.briefIndexDescription}
        eyebrow={copy.briefIndexEyebrow}
        title={copy.briefIndexTitle}
      />
      <div className={contentWrap}>
        <section className="grid gap-4">
          {briefs.map((brief) => (
            <BriefCard
              brief={brief}
              key={`${brief.city}-${brief.date}`}
              locale={locale}
              readBriefLabel={copy.readBrief}
            />
          ))}
        </section>
        <section className={`${panel} grid gap-5 p-5 md:grid-cols-2`}>
          <div>
            <p className={sectionTitle}>{copy.methodology}</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {copy.methodologyPanelTitle}
            </h2>
            <p className={`${bodyText} mt-3`}>
              {copy.methodologyPanelBody}
            </p>
            <div className="mt-4">
              <MethodologyLinks locale={locale} slugs={["deb", "settlement-sources"]} />
            </div>
          </div>
          <div>
            <p className={sectionTitle}>{copy.sourceNotes}</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              {copy.sourcePanelTitle}
            </h2>
            <p className={`${bodyText} mt-3`}>
              {copy.sourcePanelBody}
            </p>
            <div className="mt-4">
              <SourceLinks locale={locale} slugs={["mgm", "metar", "hko", "noaa"]} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function BriefDetailPageView({
  brief,
  locale = "en-US",
}: {
  brief: PublicBrief;
  locale?: LandingLocale;
}) {
  const copy = PUBLIC_CONTENT_COPY[locale];
  const localizedBrief = localizeBrief(brief, locale);

  return (
    <div className={pageShell}>
      <PublicContentAnalytics
        eventType="brief_view"
        onceKey={`brief:${localizedBrief.city}:${localizedBrief.date}`}
        payload={{ city: localizedBrief.city, date: localizedBrief.date, source: localizedBrief.settlementSource }}
      />
      <PublicHeader locale={locale} />
      <PageIntro
        description={localizedBrief.description}
        eyebrow={`${localizedBrief.cityName}, ${localizedBrief.countryName} / ${localizedBrief.date}`}
        title={localizedBrief.title}
      />
      <div className={contentWrap}>
        <section className="grid gap-5 lg:grid-cols-[1.6fr_0.9fr]">
          <article className={`${panel} p-5`}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {localizedBrief.signals.map((signal) => (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={signal.label}>
                  <p className="text-xs font-semibold text-slate-500">{signal.label}</p>
                  <p className="mt-1 font-mono text-2xl font-black text-slate-950">{signal.value}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{signal.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-5">
              <BriefSection title={copy.detailLabels.debRead} body={localizedBrief.debRead} />
              <BriefSection title={copy.detailLabels.settlementSourceRead} body={localizedBrief.sourceRead} />
              <BriefSection title={copy.detailLabels.modelContext} body={localizedBrief.modelRead} />
              <BriefSection title={copy.detailLabels.riskNotes} body={localizedBrief.riskRead} />
            </div>
          </article>
          <aside className={`${panel} h-fit p-5`}>
            <p className={sectionTitle}>{copy.snapshot}</p>
            <dl className="mt-4 grid gap-3 text-sm">
              <InfoRow label={copy.market} value={localizedBrief.market} />
              <InfoRow label={copy.settlementSource} value={localizedBrief.settlementSource} />
              <InfoRow label={copy.updated} value={formatDateTime(localizedBrief.updatedAt, locale)} />
              <InfoRow label={copy.freshness} value={localizedBrief.dataFreshness} />
            </dl>
            <div className="mt-5 flex flex-col gap-3">
              <PublicContentCta
                className={primaryButton}
                href="/terminal"
                payload={{ city: localizedBrief.city, date: localizedBrief.date, cta: "terminal" }}
              >
                {localizedBrief.primaryCtaLabel}
              </PublicContentCta>
              <Link className={secondaryButton} href="/briefs">
                {copy.allPublicBriefs}
              </Link>
            </div>
          </aside>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className={`${panel} p-5`}>
            <p className={sectionTitle}>{copy.checksBeforeActing}</p>
            <ul className="mt-4 grid gap-3">
              {localizedBrief.checkpoints.map((checkpoint) => (
                <li className={bodyText} key={checkpoint}>
                  {checkpoint}
                </li>
              ))}
            </ul>
          </div>
          <div className={`${panel} p-5`}>
            <p className={sectionTitle}>{copy.distributionCopy}</p>
            <p className={`${bodyText} mt-4`}>{localizedBrief.distributionText}</p>
            <div className="mt-4">
              <PublicContentOutboundLink
                className={secondaryButton}
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(localizedBrief.distributionText)}&url=${encodeURIComponent(absolutePublicUrl(briefPath(localizedBrief)))}`}
                payload={{ city: localizedBrief.city, date: localizedBrief.date, destination: "x_intent" }}
              >
                {copy.shareOnX}
              </PublicContentOutboundLink>
            </div>
          </div>
        </section>

        <section className={`${panel} grid gap-5 p-5 md:grid-cols-2`}>
          <div>
            <p className={sectionTitle}>{copy.methodologyLinks}</p>
            <div className="mt-4">
              <MethodologyLinks locale={locale} slugs={localizedBrief.methodologySlugs} />
            </div>
          </div>
          <div>
            <p className={sectionTitle}>{copy.sourceLinks}</p>
            <div className="mt-4">
              <SourceLinks locale={locale} slugs={localizedBrief.sourceSlugs} />
            </div>
          </div>
        </section>

        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {localizedBrief.notFinancialAdvice}
        </p>
      </div>
    </div>
  );
}

function BriefSection({ body, title }: { body: string; title: string }) {
  return (
    <section>
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <p className={`${bodyText} mt-2`}>{body}</p>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="leading-6 text-slate-800">{value}</dd>
    </div>
  );
}

export function MethodologyIndexPageView() {
  return (
    <div className={pageShell}>
      <PublicHeader />
      <PageIntro
        description="Public methodology pages explain how PolyWeather handles DEB blending, settlement-source priority, freshness, and source reconciliation for prediction-market weather analysis."
        eyebrow="Methodology"
        title="How PolyWeather reads weather markets"
      />
      <div className={contentWrap}>
        <section className="grid gap-4 md:grid-cols-2">
          {METHODOLOGY_PAGES.map((page) => (
            <article className={`${panel} p-5`} key={page.slug}>
              <p className={sectionTitle}>{formatDate(page.updatedAt)}</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                <Link href={methodologyPath(page)}>{page.title}</Link>
              </h2>
              <p className={`${bodyText} mt-3`}>{page.description}</p>
              <Link className={`${secondaryButton} mt-5`} href={methodologyPath(page)}>
                Read methodology
              </Link>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

export function MethodologyDetailPageView({ page }: { page: MethodologyPage }) {
  return (
    <div className={pageShell}>
      <PublicContentAnalytics
        eventType="methodology_view"
        onceKey={`methodology:${page.slug}`}
        payload={{ slug: page.slug, content_type: "methodology" }}
      />
      <PublicHeader />
      <PageIntro description={page.description} eyebrow="Methodology" title={page.title} />
      <div className={contentWrap}>
        <article className={`${panel} p-5`}>
          <p className="max-w-3xl text-base leading-7 text-slate-700">{page.summary}</p>
          <div className="mt-8 grid gap-8">
            {page.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-black text-slate-950">{section.heading}</h2>
                <p className={`${bodyText} mt-3`}>{section.body}</p>
                <ul className="mt-4 grid gap-3">
                  {section.bullets.map((bullet) => (
                    <li className={bodyText} key={bullet}>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

export function SourcesIndexPageView() {
  return (
    <div className={pageShell}>
      <PublicHeader />
      <PageIntro
        description="Source pages separate official observations, airport observations, and model guidance so readers can inspect why PolyWeather prioritizes settlement-relevant evidence."
        eyebrow="Sources"
        title="Weather source notes for public audit"
      />
      <div className={contentWrap}>
        <section className="grid gap-4 md:grid-cols-2">
          {SOURCE_PAGES.map((source) => (
            <article className={`${panel} p-5`} key={source.slug}>
              <p className={sectionTitle}>{source.operator}</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                <Link href={sourcePath(source)}>{source.title}</Link>
              </h2>
              <p className={`${bodyText} mt-3`}>{source.description}</p>
              <Link className={`${secondaryButton} mt-5`} href={sourcePath(source)}>
                Read source note
              </Link>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

export function SourceDetailPageView({ source }: { source: SourcePage }) {
  return (
    <div className={pageShell}>
      <PublicHeader />
      <PageIntro description={source.description} eyebrow="Source note" title={source.title} />
      <div className={contentWrap}>
        <article className={`${panel} grid gap-6 p-5 lg:grid-cols-[0.9fr_1.4fr]`}>
          <dl className="grid gap-3 text-sm">
            <InfoRow label="Operator" value={source.operator} />
            <InfoRow label="Coverage" value={source.coverage} />
            <InfoRow label="Cadence" value={source.cadence} />
            <InfoRow label="Settlement use" value={source.settlementUse} />
          </dl>
          <div>
            <p className={sectionTitle}>Reliability notes</p>
            <ul className="mt-4 grid gap-3">
              {source.reliabilityNotes.map((note) => (
                <li className={bodyText} key={note}>
                  {note}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <p className={sectionTitle}>Related methodology</p>
              <div className="mt-4">
                <MethodologyLinks slugs={source.relatedMethodologySlugs} />
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function formatDateTime(value: string, locale: LandingLocale = "en-US") {
  return new Intl.DateTimeFormat(locale === "en-US" ? "en" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}
