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
3. **模型 spread**：多模型极差如果很大，说明结算极具博弈价值。
4. **结算边界**：如果当前温度处于 X.5 这种进位/舍位边缘，需特别预警。

【输出要求】
1. **禁止废话**，整体控制在 80 字以内。
2. 严格按照以下 HTML 格式输出:

🤖 <b>Groq AI 决策</b>
- 💡 逻辑: [简述动力来源/阻碍因子。例如：暖平流强势推高，且辐射极低时段创新高，极大概率超预报。]
- ⏰ 时机: [理想 / 较好 / 谨慎 / 不建议] (信心: [1-10]/10)
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
