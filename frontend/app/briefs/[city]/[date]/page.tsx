import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  PUBLIC_BRIEFS,
  absolutePublicUrl,
  briefPath,
  getBrief,
} from "@/content/public-content";

type BriefPageParams = {
  city: string;
  date: string;
};

export function generateStaticParams() {
  return PUBLIC_BRIEFS.map((brief) => ({
    city: brief.city,
    date: brief.date,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<BriefPageParams>;
}): Promise<Metadata> {
  const { city, date } = await params;
  const brief = getBrief(city, date);

  if (!brief) {
    return {
      title: "Brief not found",
    };
  }

  const pathname = briefPath(brief);

  return {
    title: brief.title,
    description: brief.description,
    alternates: {
      canonical: pathname,
    },
    openGraph: {
      type: "article",
      title: brief.title,
      description: brief.description,
      url: pathname,
      publishedTime: brief.publishedAt,
      modifiedTime: brief.updatedAt,
    },
    twitter: {
      card: "summary",
      title: brief.title,
      description: brief.description,
    },
  };
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<BriefPageParams>;
}) {
  const { city, date } = await params;
  const brief = getBrief(city, date);

  if (!brief) {
    notFound();
  }

  const pathname = briefPath(brief);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: brief.title,
      description: brief.description,
      datePublished: brief.publishedAt,
      dateModified: brief.updatedAt,
      mainEntityOfPage: absolutePublicUrl(pathname),
      author: {
        "@type": "Organization",
        name: "PolyWeather",
        url: "https://polyweather.top",
      },
      publisher: {
        "@type": "Organization",
        name: "PolyWeather",
        url: "https://polyweather.top",
      },
      about: [
        brief.cityName,
        brief.market,
        brief.settlementSource,
        "DEB forecast methodology",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Briefs",
          item: absolutePublicUrl("/briefs"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: brief.cityName,
          item: absolutePublicUrl(pathname),
        },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <BriefDetailPageView brief={brief} />
    </>
  );
}
