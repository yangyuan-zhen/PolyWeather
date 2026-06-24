import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MethodologyDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  METHODOLOGY_PAGES,
  absolutePublicUrl,
  getMethodologyPage,
  methodologyPath,
} from "@/content/public-content";

type MethodologyPageParams = {
  slug: string;
};

export function generateStaticParams() {
  return METHODOLOGY_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<MethodologyPageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getMethodologyPage(slug);

  if (!page) {
    return {
      title: "Methodology not found",
    };
  }

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: methodologyPath(page),
    },
    openGraph: {
      type: "article",
      title: page.title,
      description: page.description,
      url: methodologyPath(page),
      modifiedTime: page.updatedAt,
    },
  };
}

export default async function MethodologyDetailPage({
  params,
}: {
  params: Promise<MethodologyPageParams>;
}) {
  const { slug } = await params;
  const page = getMethodologyPage(slug);

  if (!page) {
    notFound();
  }

  const pathname = methodologyPath(page);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: page.description,
    dateModified: page.updatedAt,
    mainEntityOfPage: absolutePublicUrl(pathname),
    author: {
      "@type": "Organization",
      name: "PolyWeather",
      url: "https://polyweather.top",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MethodologyDetailPageView page={page} />
    </>
  );
}
