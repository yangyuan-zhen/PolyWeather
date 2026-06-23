"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, BookOpen, Menu, Search } from "lucide-react";
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
          <ArrowLeft size={16} aria-hidden="true" />
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
                    aria-current={currentSlug === page.slug ? "page" : undefined}
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
        <div
          className={clsx(styles.callout, block.tone === "warning" && styles.calloutWarning, block.tone === "success" && styles.calloutSuccess, (!block.tone || block.tone === "info") && styles.calloutInfo)}
          role="note"
        >
          {block.title ? <div className={styles.calloutTitle}>{block.title}</div> : null}
          <p className={styles.calloutText}>{block.text}</p>
        </div>
      );
    case "bullets":
      return (
        <ul className={clsx(styles.list, styles.bulletList)}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className={clsx(styles.list, styles.stepList)}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "link":
      return (
        <div>
          <a
            href={block.href}
            target="_blank"
            rel="noreferrer"
            className={styles.linkCard}
          >
            {block.label}
          </a>
          {block.caption ? <p className={styles.linkCaption}>{block.caption}</p> : null}
        </div>
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
  const [searchQuery, setSearchQuery] = useState("");
  const localizedPage = useMemo(() => page.content[locale], [locale, page]);
  const currentSlug = pathname?.split("/").filter(Boolean).at(-1) || page.slug;
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return DOCS_PAGES.flatMap((doc) => {
      const content = doc.content[locale];
      const sectionText = content.sections
        .flatMap((section) => [
          section.title,
          ...section.blocks.flatMap((block) => {
            if (block.type === "paragraph") return [block.text];
            if (block.type === "callout") return [block.title || "", block.text];
            if (block.type === "bullets" || block.type === "steps") return block.items;
            if (block.type === "link") return [block.label, block.caption || ""];
            if (block.type === "image") return [block.alt, block.caption || ""];
            return [];
          }),
        ])
        .join(" ");
      const haystack = `${content.title} ${content.description} ${sectionText}`.toLowerCase();
      if (!haystack.includes(query)) return [];
      const matchedSection =
        content.sections.find((section) => section.title.toLowerCase().includes(query)) ||
        content.sections.find((section) =>
          section.blocks.some((block) => {
            if (block.type === "paragraph") return block.text.toLowerCase().includes(query);
            if (block.type === "callout") return `${block.title || ""} ${block.text}`.toLowerCase().includes(query);
            if (block.type === "bullets" || block.type === "steps") return block.items.join(" ").toLowerCase().includes(query);
            return false;
          }),
        ) ||
        content.sections[0];
      return [{
        slug: doc.slug,
        title: content.title,
        description: content.description,
        sectionId: matchedSection?.id,
        sectionTitle: matchedSection?.title,
      }];
    }).slice(0, 8);
  }, [locale, searchQuery]);

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
              <Menu size={16} aria-hidden="true" />
              {locale === "zh-CN" ? "目录" : "Contents"}
            </button>
            <div className={styles.pageIntro}>
              <div className={styles.introKicker}>
                <BookOpen size={16} aria-hidden="true" />
                {locale === "zh-CN" ? "PolyWeather 产品手册" : "PolyWeather Product Manual"}
              </div>
              <h1 className={styles.pageTitle}>{localizedPage.title}</h1>
              <p className={styles.pageDescription}>{localizedPage.description}</p>
              <div className={styles.searchWrap}>
                <Search size={16} aria-hidden="true" />
                <input
                  className={styles.searchInput}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={locale === "zh-CN" ? "搜索文档、章节或关键词" : "Search docs, sections, or keywords"}
                  aria-label={locale === "zh-CN" ? "搜索文档" : "Search docs"}
                />
              </div>
              {searchQuery.trim() ? (
                <div className={styles.searchResults}>
                  {searchResults.length === 0 ? (
                    <div className={styles.searchEmpty}>
                      {locale === "zh-CN" ? "没有匹配文档" : "No matching docs"}
                    </div>
                  ) : (
                    searchResults.map((result) => (
                      <Link
                        key={`${result.slug}-${result.sectionId || "top"}`}
                        href={`/docs/${result.slug}${result.sectionId ? `#${result.sectionId}` : ""}`}
                        className={styles.searchResult}
                      >
                        <span>{result.title}</span>
                        <small>{result.sectionTitle || result.description}</small>
                      </Link>
                    ))
                  )}
                </div>
              ) : null}
              <div className={styles.pageMeta} aria-label={locale === "zh-CN" ? "文档范围" : "Document scope"}>
                <span>{locale === "zh-CN" ? "当前工作台" : "Current terminal"}</span>
                <span>{locale === "zh-CN" ? `${DOCS_PAGES.length} 篇文档` : `${DOCS_PAGES.length} docs`}</span>
                <span>{locale === "zh-CN" ? `${localizedPage.sections.length} 个章节` : `${localizedPage.sections.length} sections`}</span>
              </div>
            </div>
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
