
import os
import json
from src.utils.config_loader import load_config
from src.utils.notifier import TelegramNotifier

def send_test_template():
    config_data = load_config()
    notifier = TelegramNotifier(config_data["telegram"])
    
    city = "Nyc"
    target_date = "2026-02-07"
    
    # 模拟异动信号数据
    alerts = [
        {
            "market": target_date,
            "msg": (
                "🟢 <b>26°F+</b>\n"
                "执行动作: <b>BUY YES</b> ⬆️\n"
                "Ask: 80¢ | Bid: -- | Mid: 79.5¢\n"
                "Spread: 1.2¢ | 深度: $1,847\n"
                "流动性: ✅ 充裕 | 可交易: ✅\n"
                "📐 预测偏差: -3.0°F (预测 23.0°F)"
            ),
            "bought": True,
            "amount": 7.0,
            "confidence": "⭐中置信"
        },
        {
            "market": target_date,
            "msg": (
                "🔴 <b>18-19°F</b>\n"
                "执行动作: <b>SELL YES</b> ⬇️\n"
                "Ask: -- | Bid: 5.0¢ | Mid: 4.5¢\n"
                "Spread: 0.5¢ | 深度: $312\n"
                "流动性: ✅ 正常 | 可交易: ✅\n"
                "📐 预测偏差: -4.0°F (预测 23.0°F)"
            ),
            "bought": False,
            "amount": 0.0,
            "confidence": ""
        }
    ]
    
    strategy_tips = [
        "预测温度 23.0°F 落在 22-23°F 区间，市场与模型一致",
        "26°F+ 区间出现主力大额买入，建议跟随",
        "18-19°F 流动性正常但偏差过大，已执行调仓"
    ]
    
    print("🚀 正在发送测试模板到 Telegram...")
    notifier.send_combined_alert(
        city=city,
        alerts=alerts,
        local_time="10:56 EST",
        forecast_temp="23.0°F",
        total_volume=40113,
        brackets_count=7,
        strategy_tips=strategy_tips
    )
    print("✅ 发送成功！请检查手机。")

if __name__ == "__main__":
    send_test_template()
