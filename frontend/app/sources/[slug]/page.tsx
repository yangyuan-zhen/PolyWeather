import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourceDetailPageView } from "@/components/public-content/PublicContentPages";
import {
  SOURCE_PAGES,
  absolutePublicUrl,
  getSourcePage,
  sourcePath,
} from "@/content/public-content";

type SourcePageParams = {
  slug: string;
};

export function generateStaticParams() {
  return SOURCE_PAGES.map((source) => ({ slug: source.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SourcePageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const source = getSourcePage(slug);

  if (!source) {
    return {
      title: "Source not found",
    };
  }

  return {
    title: source.title,
    description: source.description,
    alternates: {
      canonical: sourcePath(source),
    },
    openGraph: {
      type: "article",
      title: source.title,
      description: source.description,
      url: sourcePath(source),
      modifiedTime: source.updatedAt,
    },
  };
}

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<SourcePageParams>;
}) {
  const { slug } = await params;
  const source = getSourcePage(slug);

  if (!source) {
    notFound();
  }

  const pathname = sourcePath(source);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: source.title,
    description: source.description,
    url: absolutePublicUrl(pathname),
    dateModified: source.updatedAt,
    creator: {
      "@type": "Organization",
      name: source.operator,
    },
    includedInDataCatalog: {
      "@type": "DataCatalog",
      name: "PolyWeather source notes",
      url: absolutePublicUrl("/sources"),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SourceDetailPageView source={source} />
    </>
  );
}
