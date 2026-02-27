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

【分析重点】
1. **动力来源**：对比太阳辐射(W/m²)与最高温出现时间。如果低辐射时段气温冲高，说明是强暖平流，预报往往低估这种惯性。
2. **阻碍因子**：由于高湿度(>80%)、降水或全阴天气导致的升温失速。
3. **结算推演**：根据我提供给你的【博弈区间】以及【当前所处时段(是否过了最热期)】推断并告诉我最终结算温度落在哪个区间的希望更大。
4. **结算边界**：如果当前温度处于 X.5 这种进位/舍位边缘，需特别预警。
5. **概率参考**：我已经通过数学模型计算好了结算概率分布（见【气象特征与事实】中的"数学概率分布"），请在你的逻辑分析中参考它来判断最终结算方向。

【输出要求】
1. **禁止废话**，整体控制在 200 字以内。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 🎲 盘口: [必须明确指出最热时段（如：预计最热在 14:00-16:00）以及当前的博弈区间（如：锁定在 27°C 或 28°C 之间博弈）。若已明确降温，请直接给出死盘结论。]
- 💡 逻辑: [用 2-3 句话深度分析：①先说明当前时间距预计最热时段还有多久，还有多少升温窗口；②当前风速风向和云量对升温的促进/阻碍；③综合剩余时间和动力因子，判断从现在的实测温度到预报值还能涨多少。请使用具体数值，不要忽略时间因素。]
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

