import telebot
import json
import os
import time
import re
from datetime import datetime
from src.utils.config_loader import load_config
from src.utils.notifier import TelegramNotifier


def start_bot():
    config = load_config()
    bot_token = config["telegram"]["bot_token"]
    chat_id = config["telegram"]["chat_id"]

    if not bot_token:
        print("Error: TELEGRAM_BOT_TOKEN not found.")
        return

    bot = telebot.TeleBot(bot_token)
    notifier = TelegramNotifier(config["telegram"])

    print(f"Bot is starting and listening for commands...")

    @bot.message_handler(commands=["start", "help"])
    def send_welcome(message):
        welcome_text = (
            "🌡️ <b>PolyWeather 监控机器人</b>\n\n"
            "可用指令:\n"
            "/signal - 获取当前高置信度交易信号\n"
            "/status - 检查监控系统状态\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "💡 <b>直接输入城市名称</b> (如: <code>Seattle</code> 或 <code>London</code>) 即可查询该城市当天的最高温市场报价。"
        )
        bot.reply_to(message, welcome_text, parse_mode="HTML")

    @bot.message_handler(commands=["id"])
    def get_chat_id(message):
        bot.reply_to(
            message,
            f"🎯 当前聊天的 Chat ID 是: <code>{message.chat.id}</code>",
            parse_mode="HTML",
        )
        print(f"USER REQUEST IDENTIFIER: Chat ID found: {message.chat.id}")

    @bot.message_handler(commands=["signal"])
    def get_signals(message):
        # 仅响应授权的 Chat ID (可选)
        # if str(message.chat.id) != str(chat_id): return

        bot.send_message(message.chat.id, "🔍 正在检索当前最值得关注的天气信号...")

        try:
            if not os.path.exists("data/active_signals.json"):
                bot.send_message(
                    message.chat.id, "📭 目前暂无活跃信号，请等待系统完成下一轮扫描。"
                )
                return

            with open("data/active_signals.json", "r", encoding="utf-8") as f:
                signals = json.load(f)

            if not signals:
                bot.send_message(
                    message.chat.id, "📭 当前市场定价较为合理，暂无高偏差机会。"
                )
                return

            # 按分数排序并取前 3 个
            sorted_signals = sorted(
                signals.values(), key=lambda x: x["score"], reverse=True
            )[:3]

            for s in sorted_signals:
                notifier.send_signal(
                    market_name=s["city"],
                    full_title=s["full_title"],
                    option=s["option"],
                    score=round(s["score"] * 5, 1),
                    prediction=s["prediction"],
                    confidence=int(s["score"] * 100),
                    analysis_list=[f"偏差解析: {s['rationale']}"],
                    price=s["price"],
                    market_url=s["url"],
                    local_time=s["local_time"],
                    target_date=s["target_date"],
                )
                time.sleep(0.5)

        except Exception as e:
            bot.send_message(message.chat.id, f"❌ 获取信号时出错: {e}")

    @bot.message_handler(commands=["status"])
    def get_status(message):
        bot.reply_to(
            message, "✅ 监控引擎正在运行中...\n7x24h 实时扫码 Polymarket 气温市场。"
        )

    bot.infinity_polling()


if __name__ == "__main__":
    start_bot()
