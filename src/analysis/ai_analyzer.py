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
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    prompt = f"""
你是一个专业的天气衍生品（如 Polymarket）交易员。你的任务是分析当前天气特征，判断今日实测最高温是否能达到或超过预报中的【最高值】。

请综合以下提供的【{city_name}】气象特征进行深度推理。

【气象特征与事实】
{weather_insights}

【分析优先级】（按此顺序逐项检查，前置项可推翻后置项的结论）

P1 **实况节奏**（最高优先级）：
  - 近2-4条METAR的温度走势：连涨/持平/回落？
  - 触发阈值：连续2报创新高 → 升温未止；连续2报未创新高且已过峰值窗 → 偏死盘。
  - 低辐射时段(<100W/m²)仍在升温 → 暖平流驱动，预报往往低估。

P2 **阻碍因子**：
  - 触发阈值：湿度>80% 且 云量BKN/OVC持续2报 → 判定压温有效。
  - 降水已出现(非trace) → 强压温。
  - 若阻碍条件未满足，不可凭"多云"单因子就判断"升温受限"。

P3 **数学概率**：
  - 参考我提供的结算概率分布，但不可用概率去压过 P1 实况节奏。
  - 概率是辅助判据，实测趋势是主判据。

P4 **预报背景**（最低优先级）：
  - DEB融合值和预报可用于判断上沿空间和回落节奏，但当实测已超预报时，不可作为"难以升温"的主论据。
  - 结算边界：温度处于 X.5 进位线附近时需特别预警。

【输出要求】
1. **禁止废话**，整体控制在 300 字以内。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 🎲 盘口: [必须明确指出最热时段（如：预计最热在 14:00-16:00）以及当前的博弈区间（如：锁定在 27°C 或 28°C 之间博弈）。死盘判定条件：峰值窗口已过 + 连续2条METAR未创新高 + 云量回补或降水增强 → 直接判定死盘并说明理由。]
- 💡 逻辑: [用 3-5 句话深度分析，优先结论清晰：①说明当前时间距预计最热时段还有多久；②如果实测已超过 DEB 融合值和预报值，说明预报集体低估——此时降低预报值的参考权重（不可作为"难以升温"的主论据），重点分析当前风速云量等动力条件是否支持继续冲击下一个 WU 整数，同时可参考预报判断上沿空间和回落节奏；③如果实测还没到预报值，分析能否在剩余时间追上。请使用具体数值。]
- 🎯 置信度: [1-10]/10
"""

    for model in MODELS:
        for attempt in range(2):  # 每个模型最多重试 2 次
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是不讲废话、只看数据的专业气象分析师。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.5,
                    "max_tokens": 250
                }

                response = requests.post(url, json=payload, headers=headers, timeout=15)
                response.raise_for_status()
                
                result = response.json()
                content = result['choices'][0]['message']['content'].strip()
                
                if model != MODELS[0]:
                    logger.info(f"Groq 降级到备用模型 {model} 成功")
                return content
                
            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response is not None else 0
                if status in (500, 502, 503) and attempt == 0:
                    logger.warning(f"Groq {model} 返回 {status}，{1.5}s 后重试...")
                    time.sleep(1.5)
                    continue
                else:
                    logger.warning(f"Groq {model} 失败 (HTTP {status})，尝试下一个模型...")
                    break  # 换下一个模型
            except Exception as e:
                logger.warning(f"Groq {model} 异常: {e}，尝试下一个模型...")
                break

    logger.error("所有 Groq 模型均不可用")
    return "\n⚠️ Groq AI 暂时不可用，请稍后再试"

