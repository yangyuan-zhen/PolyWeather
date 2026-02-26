import os
import requests
from loguru import logger

def get_ai_analysis(weather_insights: str, city_name: str, temp_symbol: str) -> str:
    """
    通过 Groq API (LLaMA 3.3 70B) 对天气态势进行极速交易分析
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY 未配置，跳过 AI 分析")
        return ""
    
    try:
        # Groq 完全兼容 OpenAI 的 API 格式，直接用 requests 简单直观
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

【输出要求】
1. **禁止废话**，整体控制在 100 字以内。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 🎲 盘口: [必须明确指出最热时段（如：预计最热在 14:00-16:00）以及当前的博弈区间（如：锁定在 27°C 或 28°C 之间博弈）。若已明确降温，请直接给出死盘结论（如：已过最热点且降温，锁定在 X 度结算，悬念终止）。]
- 💡 逻辑: [不要重复模版例子！请使用一句话提炼机场实测(如风速风向、云量、气温变化趋势)及热力动力因子。例如：实测吹强劲西南风(15kt)伴随云量减少，辐射加热强劲，破预报阻力非常小。]
- 🎯 置信度: [1-10]/10
"""

        payload = {
            "model": "llama-3.3-70b-versatile", # 使用标准稳定的 70B 模型
            "messages": [
                {"role": "system", "content": "你是不讲废话、只看数据的专业气象分析师。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.5,
            "max_tokens": 150
        }

        # 索非亚直连应该没问题
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        
        result = response.json()
        content = result['choices'][0]['message']['content'].strip()
        
        return content
    except Exception as e:
        logger.error(f"Groq API 调用失败: {e}")
        return f"\n⚠️ Groq 分析暂不可用 ({str(e)[:30]})"
