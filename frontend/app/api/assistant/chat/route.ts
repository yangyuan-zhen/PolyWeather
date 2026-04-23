import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const AI_CACHE_TTL_MS =
  Number(process.env.POLYWEATHER_AI_ANSWER_CACHE_TTL_SEC || "240") * 1000;

type AssistantOpportunityContext = {
  city_name: string;
  city_display_name: string;
  airport?: string | null;
  risk_level: string;
  tradable: boolean;
  local_time?: string | null;
  current_temperature?: number | null;
  deb_prediction?: number | null;
  market_question?: string | null;
  market_label?: string | null;
  selected_date?: string | null;
  best_side?: string | null;
  yes_price?: number | null;
  no_price?: number | null;
  edge_percent?: number | null;
  market_probability?: number | null;
  model_probability?: number | null;
  status?: string | null;
};

type AssistantContextPayload = {
  snapshot_id?: string;
  locale?: string;
  generated_at?: string;
  totals?: {
    cities?: number;
    tradable_markets?: number;
    high_risk?: number;
    medium_risk?: number;
    low_risk?: number;
  };
  selected_city?: AssistantOpportunityContext | null;
  opportunities?: AssistantOpportunityContext[];
  glossary?: Array<{
    term: string;
    meaning: string;
  }>;
};

type AssistantChatRequest = {
  question?: string;
  locale?: string;
  snapshot_id?: string;
  context?: AssistantContextPayload;
};

type AssistantChatResponse = {
  answer: string;
  cached?: boolean;
  model?: string;
  refused?: boolean;
  snapshot_id?: string;
  suggestions?: string[];
};

type CachedAssistantReply = {
  expiresAt: number;
  payload: AssistantChatResponse;
};

const assistantAnswerCache = new Map<string, CachedAssistantReply>();

function normalizeQuestion(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

function normalizeLocale(value?: string | null) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function normalizeRiskLevel(value: string | undefined, locale: string) {
  const risk = String(value || "").toLowerCase();
  if (risk === "high") return locale === "en-US" ? "high risk" : "高风险";
  if (risk === "medium") return locale === "en-US" ? "watch list" : "重点观察";
  if (risk === "low") return locale === "en-US" ? "low risk" : "低波动";
  return locale === "en-US" ? "unrated" : "待评级";
}

function normalizePercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function normalizeProbability(value: number | null | undefined) {
  const percent = normalizePercent(value);
  return percent == null ? null : Number(percent.toFixed(1));
}

function normalizeCents(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function buildSnapshotId(context: AssistantContextPayload) {
  const source = JSON.stringify({
    totals: context.totals || {},
    selected_city: context.selected_city || null,
    opportunities: Array.isArray(context.opportunities)
      ? context.opportunities.slice(0, 52)
      : [],
  });
  return `snapshot-${hashText(source)}`;
}

function sanitizeContext(input?: AssistantContextPayload | null) {
  const opportunities = Array.isArray(input?.opportunities)
    ? input!.opportunities
        .slice(0, 52)
        .map((item) => ({
          city_name: String(item.city_name || "").trim(),
          city_display_name: String(item.city_display_name || "").trim(),
          airport: item.airport ? String(item.airport) : null,
          risk_level: String(item.risk_level || "").trim(),
          tradable: item.tradable === true,
          local_time: item.local_time ? String(item.local_time) : null,
          current_temperature: Number.isFinite(Number(item.current_temperature))
            ? Number(item.current_temperature)
            : null,
          deb_prediction: Number.isFinite(Number(item.deb_prediction))
            ? Number(item.deb_prediction)
            : null,
          market_question: item.market_question
            ? String(item.market_question).slice(0, 240)
            : null,
          market_label: item.market_label
            ? String(item.market_label).slice(0, 120)
            : null,
          selected_date: item.selected_date ? String(item.selected_date) : null,
          best_side: item.best_side ? String(item.best_side).toUpperCase() : null,
          yes_price: normalizeCents(item.yes_price),
          no_price: normalizeCents(item.no_price),
          edge_percent: normalizePercent(item.edge_percent),
          market_probability: normalizeProbability(item.market_probability),
          model_probability: normalizeProbability(item.model_probability),
          status: item.status ? String(item.status) : null,
        }))
        .filter((item) => item.city_name || item.city_display_name)
    : [];

  const selectedCity = input?.selected_city
    ? opportunities.find(
        (item) =>
          item.city_name === input.selected_city?.city_name ||
          item.city_display_name === input.selected_city?.city_display_name,
      ) || null
    : null;

  return {
    snapshot_id: String(input?.snapshot_id || "").trim() || buildSnapshotId(input || {}),
    locale: normalizeLocale(input?.locale),
    generated_at: input?.generated_at
      ? String(input.generated_at)
      : new Date().toISOString(),
    totals: {
      cities: Number(input?.totals?.cities || opportunities.length || 0),
      tradable_markets: Number(
        input?.totals?.tradable_markets ||
          opportunities.filter((item) => item.tradable).length ||
          0,
      ),
      high_risk: Number(input?.totals?.high_risk || 0),
      medium_risk: Number(input?.totals?.medium_risk || 0),
      low_risk: Number(input?.totals?.low_risk || 0),
    },
    selected_city: selectedCity,
    opportunities,
    glossary: Array.isArray(input?.glossary)
      ? input!.glossary.slice(0, 8).map((item) => ({
          term: String(item.term || "").slice(0, 64),
          meaning: String(item.meaning || "").slice(0, 220),
        }))
      : [],
  };
}

function buildCacheKey(question: string, locale: string, snapshotId: string) {
  return `${locale}::${snapshotId}::${question.toLowerCase()}`;
}

function buildSuggestions(
  locale: string,
  selectedCity?: AssistantOpportunityContext | null,
) {
  if (locale === "en-US") {
    return [
      "Which market is worth buying now?",
      "Rank current opportunities by edge",
      selectedCity?.city_display_name
        ? `Why is ${selectedCity.city_display_name} not recommended?`
        : "Explain what edge means",
    ];
  }
  return [
    "当前有哪些值得参与的市场？",
    "按 edge 排序",
    selectedCity?.city_display_name
      ? `为什么 ${selectedCity.city_display_name} 不建议参与？`
      : "解释一下 edge 是什么",
  ];
}

function findMentionedCity(
  question: string,
  context: ReturnType<typeof sanitizeContext>,
) {
  const normalizedQuestion = question.toLowerCase();
  return (
    context.opportunities.find((item) => {
      const candidates = [
        item.city_name,
        item.city_display_name,
        item.airport || "",
      ]
        .map((value) => value.toLowerCase())
        .filter(Boolean);
      return candidates.some((candidate) => normalizedQuestion.includes(candidate));
    }) || null
  );
}

function buildUnsupportedAnswer(locale: string) {
  return locale === "en-US"
    ? "I can only answer questions about the current PolyWeather market snapshot, such as opportunities, city-level reasoning, rankings, and metric definitions."
    : "我只能回答当前 PolyWeather 市场快照里的问题，例如当前机会、单城市分析、排序筛选和指标解释。";
}

function buildExplainAnswer(
  question: string,
  locale: string,
  context: ReturnType<typeof sanitizeContext>,
) {
  const normalized = question.toLowerCase();
  const glossaryMatch = context.glossary.find((item) =>
    normalized.includes(String(item.term || "").toLowerCase()),
  );
  if (glossaryMatch) {
    return glossaryMatch.meaning;
  }
  if (normalized.includes("edge")) {
    return locale === "en-US"
      ? "Edge is the gap between model probability and market-implied probability. Positive edge means the model is more bullish than the market."
      : "edge 是模型概率和市场隐含概率之间的差值。正 edge 表示模型比市场更乐观。";
  }
  if (normalized.includes("emos")) {
    return locale === "en-US"
      ? "EMOS is the calibrated probability ladder used here for the 24h max-temperature market buckets."
      : "EMOS 是这里用于 24 小时最高温市场分桶的校准概率分布。";
  }
  if (normalized.includes("deb")) {
    return locale === "en-US"
      ? "DEB is the system forecast anchor for the day's max temperature. It is one of the inputs used by the product, not the final trading decision."
      : "DEB 是系统对当日最高温的核心预测锚点之一，它是产品输入，不是最终交易决策本身。";
  }
  return buildUnsupportedAnswer(locale);
}

function buildOpportunityAnswer(
  question: string,
  locale: string,
  context: ReturnType<typeof sanitizeContext>,
) {
  const ranked = [...context.opportunities]
    .filter((item) => item.tradable)
    .sort((left, right) => (right.edge_percent || -999) - (left.edge_percent || -999));

  if (!ranked.length) {
    return locale === "en-US"
      ? "There is no tradable market in the current snapshot. The scan finished, but no live market passes the current filters."
      : "当前快照里没有可交易市场。也就是说扫描结果已经出来了，但没有市场通过当前可交易筛选。";
  }

  const wantsYes = /(^|\s)yes(\s|$)|买\s*yes|做多|buy yes/i.test(question);
  const wantsNo = /(^|\s)no(\s|$)|买\s*no|做空|buy no/i.test(question);
  const filtered = ranked.filter((item) => {
    if (wantsYes) return item.best_side === "YES";
    if (wantsNo) return item.best_side === "NO";
    return true;
  });
  const items = (filtered.length ? filtered : ranked).slice(0, 5);

  const lines = items.map((item, index) => {
    const sideText = item.best_side
      ? locale === "en-US"
        ? `preferred side ${item.best_side}`
        : `倾向 ${item.best_side}`
      : locale === "en-US"
        ? "side unavailable"
        : "方向待定";
    const edgeText =
      item.edge_percent == null ? "--" : `${item.edge_percent.toFixed(1)}%`;
    const yesText = item.yes_price == null ? "--" : `${Math.round(item.yes_price)}¢`;
    const noText = item.no_price == null ? "--" : `${Math.round(item.no_price)}¢`;
    return locale === "en-US"
      ? `${index + 1}. ${item.city_display_name}: ${item.market_label || item.market_question || "market unavailable"}, edge ${edgeText}, YES ${yesText}, NO ${noText}, ${sideText}.`
      : `${index + 1}. ${item.city_display_name}：${item.market_label || item.market_question || "市场信息缺失"}，edge ${edgeText}，YES ${yesText}，NO ${noText}，${sideText}。`;
  });

  return locale === "en-US"
    ? [`Top tradable markets in the current snapshot:`, ...lines].join("\n")
    : [`当前快照里最值得优先看的可交易市场如下：`, ...lines].join("\n");
}

function buildCityAnswer(
  locale: string,
  city: AssistantOpportunityContext,
) {
  const edgeText =
    city.edge_percent == null ? "--" : `${city.edge_percent.toFixed(1)}%`;
  const yesText = city.yes_price == null ? "--" : `${Math.round(city.yes_price)}¢`;
  const noText = city.no_price == null ? "--" : `${Math.round(city.no_price)}¢`;
  const modelText =
    city.model_probability == null
      ? "--"
      : `${city.model_probability.toFixed(1)}%`;
  const marketText =
    city.market_probability == null
      ? "--"
      : `${city.market_probability.toFixed(1)}%`;

  if (locale === "en-US") {
    return [
      `${city.city_display_name} is currently marked as ${normalizeRiskLevel(city.risk_level, locale)}.`,
      city.tradable
        ? `The active market is ${city.market_label || city.market_question || "unavailable"}, preferred side ${city.best_side || "unavailable"}, edge ${edgeText}, YES ${yesText}, NO ${noText}.`
        : `This city does not have a tradable market in the current snapshot.`,
      `Model probability ${modelText}, market-implied probability ${marketText}, current temperature ${
        city.current_temperature ?? "--"
      }, DEB ${
        city.deb_prediction ?? "--"
      }.`,
    ].join(" ");
  }

  return [
    `${city.city_display_name} 当前被归类为${normalizeRiskLevel(city.risk_level, locale)}。`,
    city.tradable
      ? `当前可交易市场是 ${city.market_label || city.market_question || "暂无"}，系统倾向 ${city.best_side || "待定"}，edge ${edgeText}，YES ${yesText}，NO ${noText}。`
      : "这个城市在当前快照里没有可交易市场。",
    `模型概率 ${modelText}，市场隐含概率 ${marketText}，当前温度 ${
      city.current_temperature ?? "--"
    }，DEB ${
      city.deb_prediction ?? "--"
    }。`,
  ].join("");
}

function detectUnsupported(question: string) {
  return /冷锋|台风百科|气象百科|why is the sky|what is a cold front|recipe|股票|crypto|足球|nba/i.test(
    question,
  );
}

function buildFallbackAnswer(
  question: string,
  locale: string,
  context: ReturnType<typeof sanitizeContext>,
) {
  if (detectUnsupported(question)) {
    return {
      answer: buildUnsupportedAnswer(locale),
      refused: true,
    };
  }

  const mentionedCity = findMentionedCity(question, context);
  if (mentionedCity) {
    return {
      answer: buildCityAnswer(locale, mentionedCity),
      refused: false,
    };
  }

  if (/edge|概率|probability|模型|emos|deb/i.test(question)) {
    return {
      answer: buildExplainAnswer(question, locale, context),
      refused: false,
    };
  }

  return {
    answer: buildOpportunityAnswer(question, locale, context),
    refused: false,
  };
}

async function generateWithGroq(params: {
  question: string;
  locale: string;
  context: ReturnType<typeof sanitizeContext>;
  fallbackAnswer: string;
}) {
  const apiKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!apiKey) {
    return {
      answer: params.fallbackAnswer,
      model: "rule-fallback",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              params.locale === "en-US"
                ? "You are the PolyWeather AI assistant. Answer only from the provided snapshot JSON. Do not invent cities, prices, probabilities, timing, or market status. If the snapshot lacks the needed data, say so directly. Refuse non-product or non-market questions."
                : "你是 PolyWeather AI 助手。只能基于提供的快照 JSON 回答，不得编造城市、价格、概率、时间或市场状态。如果快照没有所需数据，要直接说明。对于非产品、非市场问题要拒答。",
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                question: params.question,
                locale: params.locale,
                snapshot: {
                  snapshot_id: params.context.snapshot_id,
                  generated_at: params.context.generated_at,
                  totals: params.context.totals,
                  selected_city: params.context.selected_city,
                  opportunities: params.context.opportunities.slice(0, 18),
                  glossary: params.context.glossary,
                },
                fallback_reference: params.fallbackAnswer,
              },
              null,
              2,
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const answer = String(data.choices?.[0]?.message?.content || "").trim();
    if (!answer) {
      throw new Error("Groq returned empty content");
    }

    return {
      answer,
      model: GROQ_MODEL,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureAssistantAccess(request: NextRequest) {
  const auth = await buildBackendRequestHeaders(request);
  if (process.env.POLYWEATHER_AI_ALLOW_FREE === "true") {
    return { allowed: true, auth };
  }
  if (!API_BASE) {
    return { allowed: false, auth, reason: "API base missing" };
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: auth.headers,
      cache: "no-store",
    });
    if (!response.ok) {
      return { allowed: false, auth, reason: `auth ${response.status}` };
    }
    const profile = (await response.json()) as {
      subscription_active?: boolean | null;
    };
    return {
      allowed: profile.subscription_active === true,
      auth,
      reason: profile.subscription_active === true ? null : "pro_required",
    };
  } catch (error) {
    return { allowed: false, auth, reason: String(error) };
  }
}

export async function POST(request: NextRequest) {
  let parsedBody: AssistantChatRequest | null = null;
  try {
    parsedBody = (await request.json()) as AssistantChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = normalizeQuestion(String(parsedBody?.question || ""));
  if (!question) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const locale = normalizeLocale(parsedBody?.locale);
  const context = sanitizeContext(parsedBody?.context);
  const snapshotId =
    String(parsedBody?.snapshot_id || context.snapshot_id || "").trim() ||
    buildSnapshotId(context);

  const access = await ensureAssistantAccess(request);
  if (!access.allowed) {
    const response = NextResponse.json(
      {
        error: "assistant_requires_pro",
        detail:
          locale === "en-US"
            ? "PolyWeather AI assistant is a Pro feature."
            : "PolyWeather AI 对话助手属于 Pro 功能。",
      },
      { status: 402 },
    );
    return applyAuthResponseCookies(response, access.auth.response);
  }

  const cacheKey = buildCacheKey(question, locale, snapshotId);
  const cached = assistantAnswerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const response = NextResponse.json({
      ...cached.payload,
      cached: true,
      snapshot_id: snapshotId,
    });
    return applyAuthResponseCookies(response, access.auth.response);
  }

  const fallback = buildFallbackAnswer(question, locale, context);
  let answerPayload: AssistantChatResponse = {
    answer: fallback.answer,
    cached: false,
    refused: fallback.refused,
    snapshot_id: snapshotId,
    suggestions: buildSuggestions(locale, context.selected_city),
    model: "rule-fallback",
  };

  if (!fallback.refused) {
    try {
      const generated = await generateWithGroq({
        question,
        locale,
        context,
        fallbackAnswer: fallback.answer,
      });
      answerPayload = {
        ...answerPayload,
        answer: generated.answer,
        model: generated.model,
      };
    } catch {
      answerPayload = {
        ...answerPayload,
        answer: fallback.answer,
        model: "rule-fallback",
      };
    }
  }

  assistantAnswerCache.set(cacheKey, {
    expiresAt: Date.now() + AI_CACHE_TTL_MS,
    payload: answerPayload,
  });

  const response = NextResponse.json(answerPayload, {
    headers: {
      "Cache-Control": "no-store",
      "X-PolyWeather-Snapshot-Id": snapshotId,
    },
  });
  return applyAuthResponseCookies(response, access.auth.response);
}
