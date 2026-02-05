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
            "/portfolio - 查看当前模拟交易报告\n"
            "/status - 检查监控系统状态\n"
            "/id - 获取当前聊天的 Chat ID"
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
                signals.values(), key=lambda x: x.get("score", 0), reverse=True
            )[:3]

            for s in sorted_signals:
                notifier.send_signal(
                    market_name=s["city"],
                    full_title=s["full_title"],
                    option=s["option"],
                    score=round(s.get("score", 0) * 5, 1),
                    prediction=s["prediction"],
                    confidence=int(s.get("score", 0) * 100),
                    analysis_list=[f"偏差解析: {s.get('rationale', 'N/A')}"],
                    price=s["price"],
                    market_url=s["url"],
                    local_time=s["local_time"],
                    target_date=s["target_date"],
                )
                time.sleep(0.5)

        except Exception as e:
            bot.send_message(message.chat.id, f"❌ 获取信号时出错: {e}")

    @bot.message_handler(commands=["portfolio"])
    def get_portfolio(message):
        """查看模拟仓位"""
        try:
            if not os.path.exists("data/paper_positions.json"):
                bot.reply_to(message, "📭 目前没有任何模拟记录。")
                return

            with open("data/paper_positions.json", "r", encoding="utf-8") as f:
                data = json.load(f)

            positions = data.get("positions", {})
            history = data.get("history", [])
            balance = data.get("balance", 1000.0)

            if not positions and not history:
                bot.reply_to(
                    message,
                    f"📭 目前没有任何模拟记录。\n可用余额: <b>${balance:.2f}</b>",
                    parse_mode="HTML",
                )
                return

            msg_lines = ["📊 <b>模拟交易报告 (北京时间)</b>\n" + "═" * 15]

            # 1. 活跃持仓
            if positions:
                msg_lines.append("📌 <b>当前持仓:</b>")
                total_pnl = 0
                for pid, pos in positions.items():
                    pnl_usd = pos.get("pnl_usd", 0)
                    total_pnl += pnl_usd
                    icon = "🟢" if pnl_usd >= 0 else "🔴"
                    msg_lines.append(
                        f"{icon} {pos['city']} {pos['option']} ({pos['side']}): {pnl_usd:+.2f}$"
                    )
                msg_lines.append(f"<b>持仓小计: {total_pnl:+.2f}$</b>\n")

            # 2. 最近交易记录 (最新 5 笔)
            trades = data.get("trades", [])
            if trades:
                msg_lines.append("\n📝 <b>最近操作:</b>")
                # 取末尾 5 笔交易并展示
                recent_trades = trades[-5:]
                for t in reversed(recent_trades):
                    t_type = "🛒 买入" if t["type"] == "BUY" else "💰 卖出"
                    t_time = t.get("time", "").split(" ")[1] # 仅显示时间
                    msg_lines.append(
                        f"• {t_time} {t_type} {t['city']} {t['option']} ({t['price']}¢)"
                    )

            # 3. 历史汇总统计
            if history:
                total_trades = len(history)
                wins = sum(1 for p in history if p.get("pnl_usd", 0) > 0)
                win_rate = (wins / total_trades) * 100 if total_trades > 0 else 0
                msg_lines.append("\n📈 <b>历史战绩:</b>")
                msg_lines.append(f"累计成交: {total_trades} 笔")
                msg_lines.append(f"综合胜率: <b>{win_rate:.1f}%</b>")

            footer = "\n" + "═" * 15 + "\n" + f"💳 虚拟账户余额: <b>${balance:.2f}</b>"
            msg_lines.append(footer)

            bot.reply_to(message, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            bot.reply_to(message, f"❌ 获取持仓失败: {e}")

    @bot.message_handler(commands=["status"])
    def get_status(message):
        bot.reply_to(
            message, "✅ 监控引擎正在运行中...\n7x24h 实时扫码 Polymarket 气温市场。"
        )

    bot.infinity_polling()


if __name__ == "__main__":
    start_bot()
