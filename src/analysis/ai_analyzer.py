import os
import google.generativeai as genai
from loguru import logger

def get_ai_analysis(weather_insights: str, city_name: str, temp_symbol: str) -> str:
    """
    调用 Gemini API 对天气态势进行简短的交易分析
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY 未配置，跳过 AI 分析")
        return ""
    
    try:
        genai.configure(api_key=api_key)
        # 使用最新的 Gemini 3 Flash 预览版模型
        model = genai.GenerativeModel('gemini-3-flash-preview')

        prompt = f"""
你是一个专业的天气衍生品（如 Polymarket）交易员。你的任务是根据当前天气数据推测今日最高温度趋势，进行交易决策。
请严格根据以下我提供的【{city_name}】的实时天气数据和规则策略进行分析。

【参考数据与态势】
{weather_insights}

【输出要求】
1. 语言必须极端简练，直击要害，整体不超过60个字。
2. 必须给出一个明确的操作建议。假设市场针对的是“今天温度是否会涨到预报峰值”，结论可以是：下注YES（看涨）、下注NO（看跌）、或 观望。
3. 必须包含 1-10 的信心指数。
4. 严格按照以下HTML格式输出，不要带任何 Markdown 代码块标记（如 ```html）:

🤖 <b>Gemini AI 决策</b>
- 💡 逻辑: [一句话说明核心支撑逻辑，例如：最热时段已过且低于预报3度，涨水无望。]
- 🎯 建议: <b>[下注YES / 下注NO / 观望]</b> (信心: [1-10]/10)
"""
        # 强制使用 REST 传输方式，这对代理更友好
        response = model.generate_content(prompt, transport='rest')
        text = response.text.strip()
        
        # 简单清理可能的 markdown 标记
        text = text.replace("```html", "").replace("```markdown", "").replace("```", "").strip()
        
        return text
    except Exception as e:
        logger.error(f"Gemini API 调用失败: {e}")
        return f"\n⚠️ Gemini 分析暂不可用 ({str(e)[:30]})"
