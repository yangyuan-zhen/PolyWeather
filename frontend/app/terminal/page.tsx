import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PolyWeather Terminal | Offline",
  description: "Weather scan terminal is currently offline.",
};

export default function TerminalPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-black tracking-tight text-slate-900">Terminal Offline</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        天气扫描终端已下线。当前版本不再提供扫描与比价功能，核心天气数据仍可通过 API 访问。
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Weather scan terminal is offline. Core weather data remains available via API.
      </p>
      <a href="/docs" className="mt-6 inline-flex items-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">
        查看文档 / Docs
      </a>
    </main>
  );
}
