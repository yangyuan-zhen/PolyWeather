import { notFound } from "next/navigation";
import { DocsScreen } from "@/components/docs/DocsScreen";
import { DOCS_PAGES, getDocsPage } from "@/content/docs/docs";

export function generateStaticParams() {
  return DOCS_PAGES.map((page) => ({ slug: [page.slug] }));
}

export default async function DocsDetailPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const resolvedParams = await params;
  if ((resolvedParams.slug?.length || 0) > 1) {
    notFound();
  }

  const slug = resolvedParams.slug?.[0] || "intro";
  const page = getDocsPage(slug);

  if (!page) {
    notFound();
  }

  return <DocsScreen page={page} />;
}
