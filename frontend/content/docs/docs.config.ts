import type { DocsLocale, DocsNavGroup } from "./docs";

export const DOCS_GROUPS: DocsNavGroup[] = [
  {
    id: "getting-started",
    title: { "zh-CN": "开始", "en-US": "Getting Started" },
  },
  {
    id: "analysis",
    title: { "zh-CN": "分析逻辑", "en-US": "Analysis Logic" },
  },
  {
    id: "settlement",
    title: { "zh-CN": "结算与数据", "en-US": "Settlement & Data" },
  },
  {
    id: "history",
    title: { "zh-CN": "历史对账", "en-US": "History & Reconciliation" },
  },
  {
    id: "developer",
    title: { "zh-CN": "开发者", "en-US": "Developer" },
  },
];

export function getDocsGroupTitle(groupId: DocsNavGroup["id"], locale: DocsLocale) {
  return DOCS_GROUPS.find((group) => group.id === groupId)?.title[locale] || groupId;
}
