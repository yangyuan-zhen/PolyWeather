"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import styles from "./DocsLayout.module.css";
import {
  DocsLocale,
  DocsPage,
  DocsPageContent,
} from "@/content/docs/docs";
import { DOCS_GROUPS } from "@/content/docs/docs.config";
import { DOCS_PAGES } from "@/content/docs/docs";
import { useI18n } from "@/hooks/useI18n";

function DocsHeader() {
  const { locale, setLocale } = useI18n();

  return (
    <header className={styles.docsHeader}>
      <div className={styles.brandWrap}>
        <Link href="/" className={styles.brandLink}>
          PolyWeather
        </Link>
        <span className={styles.brandSubtitle}>
          {locale === "zh-CN" ? "产品文档中心" : "Product Documentation"}
        </span>
      </div>

      <div className={styles.headerActions}>
        <Link href="/" className={styles.headerGhost}>
          {locale === "zh-CN" ? "返回主站" : "Back to App"}
        </Link>
        <div className={styles.langSwitch} role="group" aria-label="Language switch">
          <button
            type="button"
            className={clsx(styles.langButton, locale === "zh-CN" && styles.langButtonActive)}
            onClick={() => setLocale("zh-CN")}
          >
            中文
          </button>
          <button
            type="button"
            className={clsx(styles.langButton, locale === "en-US" && styles.langButtonActive)}
            onClick={() => setLocale("en-US")}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );
}

function DocsSidebar({
  currentSlug,
  locale,
  open,
  onClose,
}: {
  currentSlug: string;
  locale: DocsLocale;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open && <button type="button" className={styles.mobileSidebarBackdrop} onClick={onClose} aria-label="Close menu" />}
      <aside className={clsx(styles.sidebar, open && styles.sidebarOpen)}>
        {DOCS_GROUPS.map((group) => {
          const pages = DOCS_PAGES.filter((page) => page.group === group.id);
          return (
            <div key={group.id} className={styles.sidebarGroup}>
              <div className={styles.sidebarTitle}>{group.title[locale]}</div>
              {pages.map((page) => {
                const title = page.content[locale].title;
                const href = `/docs/${page.slug}`;
                return (
                  <Link
                    key={page.slug}
                    href={href}
                    className={clsx(styles.sidebarLink, currentSlug === page.slug && styles.sidebarLinkActive)}
                    onClick={onClose}
                  >
                    {title}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </aside>
    </>
  );
}

function DocsToc({ page, locale }: { page: DocsPageContent; locale: DocsLocale }) {
  return (
    <aside className={styles.toc}>
      <div className={styles.tocTitle}>{locale === "zh-CN" ? "本页目录" : "On this page"}</div>
      {page.sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={styles.tocLink}>
          {section.title}
        </a>
      ))}
    </aside>
  );
}

function BlockRenderer({ block }: { block: DocsPageContent["sections"][number]["blocks"][number] }) {
  switch (block.type) {
    case "paragraph":
      return <p className={styles.paragraph}>{block.text}</p>;
    case "callout":
      return (
        <div className={clsx(styles.callout, block.tone === "warning" && styles.calloutWarning, block.tone === "success" && styles.calloutSuccess, (!block.tone || block.tone === "info") && styles.calloutInfo)}>
          {block.title ? <div className={styles.calloutTitle}>{block.title}</div> : null}
          <p className={styles.calloutText}>{block.text}</p>
        </div>
      );
    case "bullets":
    case "steps":
      return (
        <ul className={styles.list}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "image":
      return (
        <figure>
          <img src={block.src} alt={block.alt} />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    default:
      return null;
  }
}

export function DocsScreen({ page }: { page: DocsPage }) {
  const pathname = usePathname();
  const { locale } = useI18n();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const localizedPage = useMemo(() => page.content[locale], [locale, page]);
  const currentSlug = pathname?.split("/").filter(Boolean).at(-1) || page.slug;

  return (
    <div className={styles.docsShell}>
      <DocsHeader />
      <div className={styles.docsFrame}>
        <DocsSidebar
          currentSlug={currentSlug}
          locale={locale}
          open={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />

        <main className={styles.content}>
          <div className={styles.contentInner}>
            <button type="button" className={clsx(styles.headerButton, styles.mobileMenuButton)} onClick={() => setMobileSidebarOpen(true)}>
              {locale === "zh-CN" ? "打开导航" : "Open navigation"}
            </button>
            <h1 className={styles.pageTitle}>{localizedPage.title}</h1>
            <p className={styles.pageDescription}>{localizedPage.description}</p>
            {localizedPage.sections.map((section) => (
              <section key={section.id} id={section.id} className={styles.section}>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
                {section.blocks.map((block, index) => (
                  <BlockRenderer key={`${section.id}-${index}`} block={block} />
                ))}
              </section>
            ))}
          </div>
        </main>

        <DocsToc page={localizedPage} locale={locale} />
      </div>
    </div>
  );
}
