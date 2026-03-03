import os
import time
import requests
from loguru import logger

# 主力模型 + 备用模型（当主力 500 时自动降级）
MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]


def get_ai_analysis(weather_insights: str, city_name: str, temp_symbol: str) -> str:
    """
    通过 Groq API (LLaMA 3.3 70B) 对天气态势进行极速交易分析
    内置自动重试 + 模型降级机制
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY 未配置，跳过 AI 分析")
        return ""

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    prompt = f"""
你是一个专业的天气衍生品（如 Polymarket）交易员。你的任务是分析当前天气特征，判断今日实测最高温是否能达到或超过预报中的【最高值】。

请综合以下提供的【{city_name}】气象特征进行深度推理。

【气象特征与事实】
{weather_insights}

【分析优先级】（按此顺序逐项检查，前置项可推翻后置项的结论）

P0 **预报崩盘检测**（最最高优先级）：
  - 如果数据中出现"🚨 预报崩盘"标记，说明所有模型集体严重高估。
  - 此时你必须：① 直接宣布预报失准/崩盘；② 以实测最高温为结算锚点；③ 分析可能导致崩盘的原因（冷平流、降水、云量压制等）；④ 禁止再讨论"冲击"预报值。
  - 如果峰值窗口已过且实测远低于预报，结算已基本确定，应直接给出结算值。

P1 **实况节奏**：
  - 近2-4条METAR的温度走势：连涨/持平/回落？
  - 触发阈值：连续2报创新高 → 升温未止；连续2报未创新高且已过峰值窗 → 偏死盘。
  - 低辐射时段(<100W/m²)仍在升温 → 暖平流驱动，预报往往低估。

P2 **阻碍因子**：
  - 触发阈值：湿度>80% 且 云量BKN/OVC持续2报 → 判定压温有效。
  - 降水已出现(非trace) → 强压温。
  - 若阻碍条件未满足，不可凭"多云"单因子就判断"升温受限"。

P3 **数学概率**：
  - 参考我提供的结算概率分布，但不可用概率去压过 P0/P1 实况。
  - 概率是辅助判据，实测趋势是主判据。

P4 **预报背景**（最低优先级）：
  - DEB融合值和预报可用于判断上沿空间和回落节奏。
  - 但当实测已远低于预报时，预报值已失去参考意义，不可继续引用。
  - 结算边界：温度处于 X.5 进位线附近时需特别预警。

【输出要求】
1. **禁止废话**，整体控制在 300 字以内。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 🎲 盘口: [若预报崩盘，直接给出"预报集体失准，WU结算锁定X°C"。否则：明确指出最热时段以及博弈焦点。区分"已确认WU底线 X°C"与"仍有概率冲击 Y°C"。禁止在升温未止时使用"锁定"等封顶措辞。若符合死盘条件，请直接给出死盘结论并说明理由。]
- 💡 逻辑: [用 3-5 句话深度分析。如果预报崩盘，重点分析崩盘原因和实测偏差。如果正常，分析实测与预报的博弈和动力条件。需包含具体数值。]
- 🎯 置信度: [1-10]/10
"""

    # Use proxy if configured
    proxies = {}
    proxy_url = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
    if proxy_url:
        proxies = {"http": proxy_url, "https": proxy_url}

    for model in MODELS:
        for attempt in range(2):  # 每个模型最多重试 2 次
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "你是不讲废话、只看数据的专业气象分析师。",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.5,
                    "max_tokens": 250,
                }

                response = requests.post(
                    url, json=payload, headers=headers, timeout=15, proxies=proxies
                )
                response.raise_for_status()

                result = response.json()
                content = result["choices"][0]["message"]["content"].strip()

                if model != MODELS[0]:
                    logger.info(f"Groq 降级到备用模型 {model} 成功")
                return content

            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response is not None else 0
                error_body = ""
                try:
                    error_body = e.response.text
                except:
                    pass
                logger.warning(
                    f"Groq {model} 失败 (HTTP {status}): {error_body}. 尝试下一个..."
                )
                if status in (500, 502, 503) and attempt == 0:
                    time.sleep(1.5)
                    continue
                else:
                    break  # 换下一个模型
            except Exception as e:
                logger.warning(f"Groq {model} 异常: {str(e)}，尝试下一个模型...")
                break

    logger.error("所有 Groq 模型均不可用")
    return "\n⚠️ Groq AI 暂时不可用，请稍后再试"
