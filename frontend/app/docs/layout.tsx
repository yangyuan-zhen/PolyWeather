import { I18nProvider } from "@/hooks/useI18n";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
