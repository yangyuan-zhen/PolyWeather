# 🌡️ PolyWeather: Polymarket Weather Trading Monitor

An intelligent monitoring and alerting system based on multi-source real-time meteorological data and Polymarket market pricing deviation analysis.

## 🚀 Quick Start

```bash
python run.py
```

This command launches:

1.  **Monitoring Engine**: Scans markets 24/7, providing **85¢-95¢ Price Alerts** and **Market Anomalies**.
2.  **Command Listener**: Handles Telegram commands and returns real-time signals.

---

## 🤖 Telegram Bot Commands

| Command   | Description             | Usage                                        |
| :-------- | :---------------------- | :------------------------------------------- |
| `/signal` | **Get Trading Signals** | Returns top 3 markets with highest deviation |
| `/status` | **Check Status**        | Confirm if the monitoring engine is online   |
| `/help`   | **Help**                | Display all available commands               |

---

## 📢 Alerting Dimensions

### 1. 📂 City Alert Summaries (Push)

- **Optimization**: All anomalies for the same city are merged into a **single report** per scan cycle to prevent spamming.
- **Content**: Includes Price Alerts and Market Anomalies (Whales/Volume).

### 2. ⚡ Price Alerts

- **Trigger**: Buy Yes or Buy No price enters the **85¢-95¢** range.
- **Purpose**: High-probability / Near-settlement reminders, ideal for closing or reaping positions.

### 3. 👀 Market Anomalies

- **Whale Inflow**: Detection of large single trades (>$5,000) with imbalanced buy/sell ratios.
- **Volume Spikes**: Sudden increase in trading volume (>2x historical standard deviation).

### 4. 🎯 Trading Signals (Query)

- Comparison between weather forecasts and market pricing.
- Includes: City, bucket, local time, expected temperature (unit-aware), and deviation score.

---

## 🛠️ Configuration (.env)

Duplicate `.env.example` to `.env` and fill in your credentials:

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Polymarket API (Used for real-time prices & trade history)
POLYMARKET_API_KEY=your_api_key_here

# Proxy (Optional)
HTTPS_PROXY=http://127.0.0.1:7890
```

---

## 📋 Core Features

- ✅ **Smart Merged Push**: City-based alert aggregation for a clean interface.
- ✅ **High-Speed Price Sync**: Utilizes CLOB batch API for instant price updates without 404s.
- ✅ **Timezone Adaptation**: All timestamps are automatically adjusted to Beijing Time (UTC+8).
- ✅ **Smart Date Selection**: Automatically targets the earliest active market date and rolls over after settlement.
- ✅ **Unit Sensitivity**: US markets display Fahrenheit (°F), while others use Celsius (°C).
- ✅ **Data Persistence**: Local JSON storage for signals and push history to ensure no duplicates after restart.

---
