import telebot
import json
import os
import time
import re
from datetime import datetime
from src.utils.config_loader import load_config
from src.utils.notifier import TelegramNotifier
from src.data_collection.polymarket_api import PolymarketClient


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
        bot.send_message(message.chat.id, "🔍 正在检索最早结算的市场信号...")

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

            # 过滤掉已结束的市场（价格接近0或100）和无日期的
            active_signals = []
            for s in signals.values():
                price = s.get("price", 50)
                if 5 <= price <= 95 and s.get("target_date"):
                    active_signals.append(s)
            
            if not active_signals:
                bot.send_message(message.chat.id, "📭 当前没有值得关注的活跃市场。")
                return

            # 按日期排序，优先最早结算的
            active_signals.sort(key=lambda x: x.get("target_date", "9999-99-99"))
            
            # 获取最早的日期
            earliest_date = active_signals[0].get("target_date")
            
            # 只取最早日期的市场
            earliest_markets = [s for s in active_signals if s.get("target_date") == earliest_date]
            
            # 按"机会价值"排序：接近锁定区间（85-95¢）的优先
            def opportunity_score(s):
                price = s.get("price", 50)
                buy_yes = s.get("buy_yes", price)
                buy_no = s.get("buy_no", 100 - price)
                # 计算距离锁定区间的距离
                max_price = max(buy_yes, buy_no)
                if 85 <= max_price <= 95:
                    return 100 + max_price  # 已在锁定区间，最高优先
                elif max_price > 70:
                    return max_price  # 接近锁定
                else:
                    return max_price / 2  # 远离锁定
            
            earliest_markets.sort(key=opportunity_score, reverse=True)
            top_markets = earliest_markets[:5]

            # 构建消息
            msg_lines = [
                f"🎯 <b>即将结算市场 ({earliest_date})</b>\n",
                f"共 {len(earliest_markets)} 个活跃选项\n"
            ]
            
            for i, s in enumerate(top_markets, 1):
                city = s.get("city", "Unknown")
                option = s.get("option", "Unknown")
                prediction = s.get("prediction", "N/A")
                buy_yes = s.get("buy_yes", s.get("price", 50))
                buy_no = s.get("buy_no", 100 - s.get("price", 50))
                volume = s.get("volume", 0)
                url = s.get("url", "")
                
                # 解析选项区间
                import re
                range_match = re.search(r'(\d+)-(\d+)', option)
                below_match = re.search(r'(\d+).*or below', option, re.I)
                higher_match = re.search(r'(\d+).*or higher', option, re.I)
                
                # 判断预测与区间关系
                analysis = ""
                try:
                    pred_val = float(re.search(r'[\d.]+', str(prediction)).group())
                    if range_match:
                        low, high = int(range_match.group(1)), int(range_match.group(2))
                        if pred_val < low:
                            analysis = f"预测{pred_val}°低于{low}° → 买NO ✓"
                        elif pred_val > high:
                            analysis = f"预测{pred_val}°高于{high}° → 买NO ✓"
                        else:
                            analysis = f"预测{pred_val}°在区间内 → 买YES ✓"
                    elif below_match:
                        threshold = int(below_match.group(1))
                        if pred_val <= threshold:
                            analysis = f"预测{pred_val}°≤{threshold}° → 买YES ✓"
                        else:
                            analysis = f"预测{pred_val}°高于{threshold}° → 买NO ✓"
                    elif higher_match:
                        threshold = int(higher_match.group(1))
                        if pred_val >= threshold:
                            analysis = f"预测{pred_val}°≥{threshold}° → 买YES ✓"
                        else:
                            analysis = f"预测{pred_val}°低于{threshold}° → 买NO ✓"
                except:
                    analysis = f"预测: {prediction}"
                
                # 判断最佳方向
                if buy_no >= 85:
                    direction = f"Buy No {buy_no}¢"
                    lock_status = "🔒锁定" if buy_no >= 95 else "⏳接近锁定"
                    confidence = "🔥" if buy_no >= 90 else "⭐"
                elif buy_yes >= 85:
                    direction = f"Buy Yes {buy_yes}¢"
                    lock_status = "🔒锁定" if buy_yes >= 95 else "⏳接近锁定"
                    confidence = "🔥" if buy_yes >= 90 else "⭐"
                elif buy_no >= 70:
                    direction = f"Buy No {buy_no}¢"
                    lock_status = "👀观望"
                    confidence = "💡"
                elif buy_yes >= 70:
                    direction = f"Buy Yes {buy_yes}¢"
                    lock_status = "👀观望"
                    confidence = "💡"
                else:
                    direction = f"Yes:{buy_yes}¢ No:{buy_no}¢"
                    lock_status = "⚖️均衡"
                    confidence = "📊"
                
                # 提取修复后的精确当地时间
                local_time = s.get("local_time", "")
                time_only = local_time.split(" ")[1] if " " in local_time else ""
                time_suffix = f" | 🕒{time_only}" if time_only else ""
                
                msg_lines.append(
                    f"{confidence} <b>{i}. {city} {option}</b>\n"
                    f"   💡 {analysis}\n"
                    f"   📊 {direction} | {lock_status}{time_suffix}\n"
                )
            
            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

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

            # 如果持仓超过20个，生成 HTML 文件
            if len(positions) > 20:
                html_path = generate_portfolio_html(data)
                with open(html_path, "rb") as f:
                    bot.send_document(
                        message.chat.id, 
                        f, 
                        caption=f"📊 完整持仓报告 ({len(positions)}个持仓)\n💳 余额: ${balance:.2f}"
                    )
                return

            # 精简版消息
            msg_lines = ["📊 <b>模拟交易报告</b>"]

            if positions:
                positions_by_date = {}
                for pid, pos in positions.items():
                    target_date = pos.get("target_date") or "未知"
                    if target_date not in positions_by_date:
                        positions_by_date[target_date] = {"count": 0, "pnl": 0, "cost": 0}
                    positions_by_date[target_date]["count"] += 1
                    positions_by_date[target_date]["pnl"] += pos.get("pnl_usd", 0)
                    positions_by_date[target_date]["cost"] += pos.get("cost_usd", 0)
                
                msg_lines.append(f"\n📌 <b>持仓概览</b> (共{len(positions)}个)")
                for target_date in sorted(positions_by_date.keys()):
                    info = positions_by_date[target_date]
                    icon = "📈" if info["pnl"] >= 0 else "📉"
                    msg_lines.append(f"{icon} {target_date}: {info['count']}笔 ${info['cost']:.0f}投入 {info['pnl']:+.2f}$")
                
                total_pnl = sum(p.get("pnl_usd", 0) for p in positions.values())
                total_cost = sum(p.get("cost_usd", 0) for p in positions.values())
                msg_lines.append(f"<b>💰 合计: ${total_cost:.0f}投入 {total_pnl:+.2f}$</b>")

                msg_lines.append("\n📋 <b>最新持仓:</b>")
                recent_positions = list(positions.values())[-5:]
                for pos in reversed(recent_positions):
                    pnl = pos.get("pnl_usd", 0)
                    icon = "🟢" if pnl >= 0 else "🔴"
                    pred = pos.get("predicted_temp", "")
                    pred_text = f"预测:{pred}" if pred else ""
                    msg_lines.append(f"{icon} {pos['city']} {pos['option']} {pred_text} {pnl:+.2f}$")

            trades = data.get("trades", [])
            if trades:
                msg_lines.append("\n📝 <b>最近操作:</b>")
                for t in reversed(trades[-3:]):
                    t_type = "🛒" if t["type"] == "BUY" else "💰"
                    t_time = t.get("time", "").split(" ")[1] if " " in t.get("time", "") else ""
                    msg_lines.append(f"• {t_time} {t_type} {t['city']} {t['option']}")

            if history:
                total_trades = len(history)
                wins = sum(1 for p in history if p.get("pnl_usd", 0) > 0)
                total_cost = sum(p.get("cost_usd", 0) for p in history)
                total_profit = sum(p.get("pnl_usd", 0) for p in history)
                win_rate = (wins / total_trades) * 100 if total_trades > 0 else 0
                msg_lines.append(f"\n📈 <b>历史:</b> {total_trades}笔 胜率{win_rate:.0f}% 盈亏{total_profit:+.2f}$")

            msg_lines.append(f"\n💳 余额: <b>${balance:.2f}</b>")

            bot.reply_to(message, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            bot.reply_to(message, f"❌ 获取持仓失败: {e}")


    def generate_portfolio_html(data):
        """生成漂亮的 HTML 持仓报告"""
        from datetime import datetime, timedelta
        
        positions = data.get("positions", {})
        history = data.get("history", [])
        balance = data.get("balance", 1000.0)
        
        # 按日期分组
        positions_by_date = {}
        for pid, pos in positions.items():
            target_date = pos.get("target_date") or "未知"
            if target_date not in positions_by_date:
                positions_by_date[target_date] = []
            positions_by_date[target_date].append(pos)
        
        total_pnl = sum(p.get("pnl_usd", 0) for p in positions.values())
        total_cost = sum(p.get("cost_usd", 0) for p in positions.values())
        
        # 生成 HTML
        now_bj = (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")
        
        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PolyWeather 持仓报告</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }}
        h1 {{ color: #00d4ff; text-align: center; }}
        .summary {{ background: #16213e; padding: 15px; border-radius: 10px; margin-bottom: 20px; }}
        .summary-item {{ display: inline-block; margin-right: 30px; }}
        .positive {{ color: #00ff88; }}
        .negative {{ color: #ff4757; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
        th {{ background: #0f3460; padding: 10px; text-align: left; }}
        td {{ padding: 8px; border-bottom: 1px solid #333; }}
        .date-header {{ background: #0f3460; padding: 10px; margin-top: 20px; border-radius: 5px; }}
        .footer {{ text-align: center; margin-top: 30px; color: #666; }}
    </style>
</head>
<body>
    <h1>📊 PolyWeather 持仓报告</h1>
    <div class="summary">
        <div class="summary-item">💳 余额: <b>${balance:.2f}</b></div>
        <div class="summary-item">📦 持仓: <b>{len(positions)}</b> 个</div>
        <div class="summary-item">💰 投入: <b>${total_cost:.2f}</b></div>
        <div class="summary-item">📈 浮盈: <b class="{'positive' if total_pnl >= 0 else 'negative'}">{total_pnl:+.2f}$</b></div>
    </div>
"""
        
        for target_date in sorted(positions_by_date.keys()):
            date_positions = positions_by_date[target_date]
            date_pnl = sum(p.get("pnl_usd", 0) for p in date_positions)
            date_cost = sum(p.get("cost_usd", 0) for p in date_positions)
            
            html += f"""
    <div class="date-header">
        📅 <b>{target_date}</b> | {len(date_positions)}笔 | 投入${date_cost:.0f} | 
        <span class="{'positive' if date_pnl >= 0 else 'negative'}">{date_pnl:+.2f}$</span>
    </div>
    <table>
        <tr><th>城市</th><th>选项</th><th>方向</th><th>入场</th><th>当前</th><th>预测</th><th>盈亏</th></tr>
"""
            for pos in date_positions:
                pnl = pos.get("pnl_usd", 0)
                pnl_class = "positive" if pnl >= 0 else "negative"
                pred = pos.get("predicted_temp", "-")
                html += f"""        <tr>
            <td>{pos.get('city', '-')}</td>
            <td>{pos.get('option', '-')}</td>
            <td>{pos.get('side', '-')}</td>
            <td>{pos.get('entry_price', 0)}¢</td>
            <td>{pos.get('current_price', 0)}¢</td>
            <td>{pred}</td>
            <td class="{pnl_class}">{pnl:+.2f}$</td>
        </tr>
"""
            html += "    </table>\n"
        
        html += f"""
    <div class="footer">
        生成时间: {now_bj} (北京时间) | PolyWeather Monitor
    </div>
</body>
</html>"""
        
        html_path = "data/portfolio_report.html"
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)
        
        return html_path

    @bot.message_handler(func=lambda m: True)
    def handle_city_query(message):
        """输入城市名直查当日天气市场"""
        import re
        from datetime import datetime
        
        query = message.text.strip()
        if len(query) < 2 or query.startswith("/"):
            return

        bot.send_chat_action(message.chat.id, "typing")
        
        try:
            # 1. 优先从本地全量市场缓存读取 (速度快，不依赖实时全量扫描)
            cache_path = "data/all_markets.json"
            if not os.path.exists(cache_path):
                # 扫码还没完成的情形
                bot.reply_to(message, "⏳ 系统正在进行首次数据同步（约需1分钟），请稍后再试。")
                return
                
            with open(cache_path, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            
            pm = PolymarketClient(config["polymarket"])
            
            # 2. 筛选匹配城市及日期的市场
            today_str = datetime.now().strftime("%Y-%m-%d")
            city_markets = []
            
            for m_id, m in cached_data.items():
                title = m.get("event_title", "") + m.get("question", "") + m.get("full_title", "")
                if query.lower() in title.lower():
                    # 提取并验证日期
                    target_date = m.get("target_date")
                    if not target_date:
                        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', title)
                        target_date = date_match.group(1) if date_match else "Unknown"
                    
                    if target_date != "Unknown" and target_date < today_str:
                        continue
                        
                    m["target_date"] = target_date
                    city_markets.append(m)
            
            if not city_markets:
                if message.chat.type == "private":
                    bot.reply_to(message, f"❌ 未找到相关的活跃天气市场。\n提示：请确保输入的是城市常用名（如 Seattle, London）。")
                return

            # 获取最早日期
            valid_dates = [m["target_date"] for m in city_markets if m["target_date"] != "Unknown"]
            if not valid_dates:
                 bot.reply_to(message, "❌ 该城市目前没有已标明结算日期的活跃市场。")
                 return
                 
            earliest_date = min(valid_dates)
            target_markets = [m for m in city_markets if m["target_date"] == earliest_date]
            
            # 3. 构建报告
            msg_lines = [
                f"🌡️ <b>{query.upper()} 概率报告 ({earliest_date})</b>\n",
                "隐含概率 (Midpoint) 及买入报价：\n"
            ]
            
            # 批量获取实时价格 (确保报价最新)
            price_reqs = []
            for m in target_markets:
                t_ids = m.get("tokens", [])
                if len(t_ids) >= 1:
                    price_reqs.append({"token_id": t_ids[0], "side": "ask"})
                    price_reqs.append({"token_id": t_ids[0], "side": "bid"})
            
            price_map = pm.get_multiple_prices(price_reqs)
            
            for m in target_markets:
                tid = m.get("active_token_id") or (m.get("tokens", [])[0] if m.get("tokens") else None)
                if not tid: continue
                
                # 获取中点价 (概率)
                mid = pm.get_midpoint(tid)
                prob = f"{mid*100:.1f}%" if mid is not None else "N/A"
                
                # 获取报价
                buy_yes = price_map.get(f"{tid}:ask")
                bid_yes = price_map.get(f"{tid}:bid")
                buy_no = (1.0 - bid_yes) if bid_yes is not None else None
                
                yes_str = f"{int(buy_yes*100)}¢" if buy_yes else "??¢"
                no_str = f"{int(buy_no*100)}¢" if buy_no else "??¢"
                
                opt = m.get("option") or m.get("question") or ""
                # 简化选项显示
                opt = re.sub(r'.*temperature in.*be ', '', opt, flags=re.I)
                
                msg_lines.append(
                    f"🔹 <b>{opt}</b>\n"
                    f"   └ 隐含概率: <code>{prob}</code>\n"
                    f"   └ 买入 是:{yes_str} | 买入 否:{no_str}\n"
                )
            
            msg_lines.append(f"\n🔗 <a href='https://polymarket.com/event/{target_markets[0]['slug']}'>在 Polymarket 查看</a>")
            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML", disable_web_page_preview=True)

        except Exception as e:
            logger.error(f"城市直查失败: {e}")
            if message.chat.type == "private":
                bot.reply_to(message, "❌ 抱歉，数据处理出现异常。")

    @bot.message_handler(commands=["status"])
    def get_status(message):
        bot.reply_to(
            message, "✅ 监控引擎正在运行中...\n7x24h 实时扫码 Polymarket 气温市场。"
        )

    import logging
    # 强制关闭 telebot 内部的刷屏日志
    telebot.logger.setLevel(logging.CRITICAL)
    
    while True:
        try:
            bot.infinity_polling(timeout=60, long_polling_timeout=60)
        except (KeyboardInterrupt, SystemExit):
            print("\n检测到退出信号，机器人正在关机...")
            break
        except Exception as e:
            print(f"Bot 轮询连接异常: {e}")
            time.sleep(10)


if __name__ == "__main__":
    start_bot()
