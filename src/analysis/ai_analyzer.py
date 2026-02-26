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
你是一个专业的天气衍生品（如 Polymarket）交易员。你的任务是根据当前天气数据推测今日最高温度趋势，进行交易决策。
请严格根据以下我提供的【{city_name}】的实时天气数据和规则策略进行分析。

【参考数据与态势】
{weather_insights}

【输出要求】
1. 语言必须极端简练，直击要害，整体不超过60个字。
2. 必须给出一个明确的操作建议（针对“今天温度是否会涨到预报峰值”）。结论可以是：下注YES、下注NO、或 观望。
3. 必须包含 1-10 的信心指数。
4. 严格按照以下HTML格式输出:

🤖 <b>Groq AI 决策</b>
- 💡 逻辑: [一句话说明核心支撑逻辑]
- 🎯 建议: <b>[下注YES / 下注NO / 观望]</b> (信心: [1-10]/10)
"""

        payload = {
            "model": "llama-3.3-70b-specdec", # 改用高性能版本
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
