import requests
import html
from loguru import logger
from datetime import datetime


class TelegramNotifier:
    """
    Telegram 消息推送模块
    支持信号推送、预警推送和市场异常提醒
    """

    def __init__(self, config: dict):
        self.config = config
        self.token = config.get("bot_token")
        self.chat_id = config.get("chat_id")
        self.proxy = config.get("proxy")

        self.session = requests.Session()
        if self.proxy:
            if not self.proxy.startswith("http"):
                self.proxy = f"http://{self.proxy}"
            self.session.proxies = {"http": self.proxy, "https": self.proxy}

        logger.info("Telegram 通知器初始化完成。")

    @staticmethod
    def _escape_html(text: str) -> str:
        """Escape HTML special characters"""
        if not isinstance(text, str):
            text = str(text)
        return html.escape(text, quote=False)

    def _send_message(self, text: str):
        """发送 Telegram 消息的主函数"""
        if not self.token or not self.chat_id:
            logger.warning("未配置 Telegram Token 或 Chat ID，无法发送消息。")
            return

        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        # 调试输出：确保 ID 正确读取
        logger.debug(f"DEBUG: Tnotifier using ChatID={self.chat_id}")

        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }

        try:
            response = self.session.post(url, json=payload, timeout=10)
            if response.status_code != 200:
                error_msg = response.text
                if "chat not found" in error_msg.lower():
                    logger.error(
                        f"Telegram 消息发送失败 (400): Chat ID {self.chat_id} 无效或机器人尚未被加入该聊天。请在 Telegram 中发送 /id 给机器人确认正确的 Chat ID。"
                    )
                else:
                    logger.error(
                        f"Telegram 消息发送失败 ({response.status_code}): {error_msg}"
                    )
                return False
            logger.info("Telegram 消息发送成功。")
            return True
        except Exception as e:
            logger.error(f"Telegram 请求异常: {e}")
            return False

    def send_signal(
        self,
        market_name: str,
        full_title: str,
        option: str,
        score: float,
        prediction: str,
        confidence: int,
        analysis_list: list,
        price: float,
        market_url: str,
        local_time: str = None,
        target_date: str = None,
    ):
        """发送交易信号推送"""
        stars = "⭐" * int(score) + "☆" * (5 - int(score))
        timestamp_utc = datetime.utcnow().strftime("%H:%M")

        analysis_text = "\n".join(
            [
                f"✅ {self._escape_html(item)}" if "✅" not in item else item
                for item in analysis_list
            ]
        )

        local_time_text = (
            f"🕒 当地时间: <b>{self._escape_html(local_time)}</b>\n"
            if local_time
            else ""
        )
        target_date_text = self._escape_html(target_date) if target_date else "待定"

        text = (
            f"🎯 <b>交易信号 #{self._escape_html(market_name.split(' ')[0])}</b>\n\n"
            f"📍 城市: <b>{self._escape_html(market_name)}</b>\n"
            f"🏆 市场: <i>{self._escape_html(full_title)}</i>\n"
            f"📝 选项: <b>{self._escape_html(option)}</b>\n"
            f"💰 当前价格: <b>{price}¢</b>\n"
            f"═══════════════════\n"
            f"📊 信号评分: {stars} ({score}/5)\n"
            f"🤖 模型预测: {self._escape_html(prediction)}\n"
            f"📈 置信度: {confidence}%\n\n"
            f"分析汇总:\n"
            f"{analysis_text}\n"
            f"═══════════════════\n"
            f"{local_time_text}"
            f"📅 结算日期: <b>{target_date_text}</b>\n"
            f"🔗 <a href='{market_url}'>点击进入市场</a>\n\n"
            f"⏰ 信号时间: {timestamp_utc} UTC"
        )
        return self._send_message(text)

    def send_combined_alert(self, city: str, alerts: list, local_time: str = None):
        """发送合并后的城市预警"""
        if not alerts:
            return

        from datetime import datetime, timedelta

        # UTC+8 北京时间
        timestamp_bj = (datetime.utcnow() + timedelta(hours=8)).strftime("%H:%M")

        items_text = ""
        for a in alerts:
            type_icon = "⚡" if a["type"] == "price" else "🐋"
            items_text += f"{type_icon} <b>{a['market']}</b>: {a['msg']}\n"

        text = (
            f"🔔 <b>城市监控报告 #{self._escape_html(city)}</b>\n\n"
            f"📍 城市: {self._escape_html(city)}\n"
            f"📊 <b>实时异动:</b>\n"
            f"{items_text}\n"
            f"═══════════════════\n"
            f"🕒 当地时间: {self._escape_html(local_time or 'N/A')}\n"
            f"⏰ 预警时间: {timestamp_bj} (北京时间)"
        )
        return self._send_message(text)

    def send_anomaly(
        self,
        city_tag: str,
        market_name: str,
        detected_anomaly: str,
        stats: dict,
        whales: list,
        current_price: float,
        local_time: str = None,
    ):
        """发送市场异常推送"""
        from datetime import datetime, timedelta

        # UTC+8 北京时间
        timestamp_bj = (datetime.utcnow() + timedelta(hours=8)).strftime("%H:%M")

        whale_text = "\n".join([f"- {self._escape_html(w)}" for w in whales])
        stats_text = "\n".join(
            [
                f"{self._escape_html(k)}: {self._escape_html(v)}"
                for k, v in stats.items()
            ]
        )
        local_time_text = (
            f"🕒 当地时间: <b>{self._escape_html(local_time)}</b>\n"
            if local_time
            else ""
        )

        text = (
            f"👀 <b>市场异常 #{self._escape_html(city_tag)}</b>\n\n"
            f"📍 城市: {self._escape_html(city_tag)}\n"
            f"🏆 市场: {self._escape_html(market_name)}\n\n"
            f"🚨 <b>检测到异常:</b>\n"
            f"{self._escape_html(detected_anomaly)}\n"
            f"{stats_text}\n\n"
            f"🐋 <b>大户动向:</b>\n"
            f"{whale_text}\n\n"
            f"💰 当前价格: <b>{current_price}¢</b>\n"
            f"═══════════════════\n"
            f"{local_time_text}"
            f"⏰ 信号时间: {timestamp_bj} (北京时间)"
        )
        return self._send_message(text)

    def send_alert(
        self,
        city_tag: str,
        market_name: str,
        price: float,
        trigger: str,
        prev_price: float,
        change: str,
        quick_analysis: list,
        local_time: str = None,
    ):
        """发送价格预警推送"""
        from datetime import datetime, timedelta

        # UTC+8 北京时间
        timestamp_bj = (datetime.utcnow() + timedelta(hours=8)).strftime("%H:%M")

        analysis_text = "\n".join(
            [f"- {self._escape_html(item)}" for item in quick_analysis]
        )
        local_time_text = (
            f"🕒 当地时间: <b>{self._escape_html(local_time)}</b>\n"
            if local_time
            else ""
        )

        text = (
            f"⚡ <b>价格预警 #{self._escape_html(city_tag)}</b>\n\n"
            f"📍 城市: {self._escape_html(city_tag)}\n"
            f"🏆 市场: {self._escape_html(market_name)}\n"
            f"💰 报价: <b>{price}¢ ↗️</b>\n\n"
            f"触发条件: {self._escape_html(trigger)}\n"
            f"变动详情: {prev_price}¢ -> {price}¢ ({self._escape_html(change)})\n\n"
            f"📊 <b>快速分析:</b>\n"
            f"{analysis_text}\n\n"
            f"═══════════════════\n"
            f"{local_time_text}"
            f"⏰ 预警时间: {timestamp_bj} (北京时间)"
        )
        return self._send_message(text)
