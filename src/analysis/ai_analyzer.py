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
你是一个专业的天气衍生品交易员。你的任务是分析当前气象实况，判断今日实测最高温的结算落点。
结算基准为合约指定源（通常为 METAR 口径整数四舍五入），以下用"结算值"代替具体源名称。

请综合以下提供的【{city_name}】气象特征进行深度推理。

【气象特征与事实】
{weather_insights}

【分析框架】（按此顺序逐项检查，前置项可约束后置项的结论）

P0 **预报失准检测**：
  - 若数据含"🚨 预报崩盘"或"⚠️ 预报差距"标记，判定预报失准。
  - 失准等级：轻(偏差2-3°) / 中(3-5°) / 重(>5°)。
  - 但"失准"≠"已定局"：还需检查近2报斜率是否≤0 且 风向/云量不支持二次抬升，才能判定结算锁定。
  - 若斜率仍>0或有暖平流迹象，应注明"预报偏高但仍有上行空间"。

P1 **实况节奏**：
  - 近2-4条METAR的温度走势：连涨/持平/回落？
  - 连续2报创新高 → 升温未止；连续2报未创新高且斜率≤0 → 偏死盘。
  - 升温出现在低辐射时段 → 可能有多因子叠加（平流/混合层/热岛），不可单因子归因。

P2 **阻碍因子**（需结合城市特性判断）：
  - 降水已出现(非trace) → 强压温。
  - 高湿度+厚云层持续2报以上 → 压温可能有效，但阈值因城市（海洋型 vs 大陆型）而异，不可套用固定数值。
  - 若仅单因子（如仅多云），不足以断定"升温受限"。

P3 **概率与一致性校验**：
  - 参考结算概率分布，与 P1 实况做一致性检查。
  - 若概率分布与实况趋势矛盾，以实况为准并说明偏离原因。
  - 概率可辅助判断边界进位风险（如 X.5 线附近）。

P4 **预报背景**（最低优先级）：
  - 可参考 DEB/预报做上沿空间评估。
  - 当实测已显著偏离预报时，禁止继续引用预报值作为目标。

【输出要求】
1. 正常场景控制在 300 字左右；异常场景（预报失准/极端走势）可扩展到 450 字。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 🎲 盘口: [给出结算判断。用"已确认底线 X{temp_symbol}"表示下限确定；用"上沿待确认，关注 Y{temp_symbol}"表示仍有变数。若预报严重失准，注明失准等级和原因。禁止在升温未止时用"锁定"。]
- 💡 逻辑: [3-5 句深度分析。含具体数值。预报失准时重点分析偏差成因。正常时分析实测与预报的动态博弈。]
- 🎯 置信度: [1-10]/10

3. **禁止输出分析框架本身**。不要输出 P0/P1/P2/P3/P4 的分析过程或标题。只输出上方三行格式，不要多余内容。
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
                    "max_tokens": 400,
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
