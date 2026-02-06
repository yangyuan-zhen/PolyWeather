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

| Command      | Description             | Usage                                          |
| :----------- | :---------------------- | :--------------------------------------------- |
| `/signal`    | **Get Trading Signals** | Returns Top 5 markets with earliest settlement |
| `/portfolio` | **View Portfolio**      | Get real-time paper trading profit report      |
| `/status`    | **Check Status**        | Confirm if the monitoring engine is online     |
| `/help`      | **Help**                | Display all available commands                 |

---

## 🎯 Smart Dynamic Position Strategy

The system automatically decides the position size based on **Open-Meteo Weather Forecasts**, **Volume**, and **Price Locking Degree**:

| Condition Combination                      | Size    | Tag               | Description                      |
| ------------------------------------------ | ------- | ----------------- | -------------------------------- |
| Price ≥90¢ + Weather Support + High Volume | **$10** | 🔥High Confidence | Triple confirmation, Heavy stake |
| Price ≥90¢ + Weather Support               | **$7**  | ⭐Mid Confidence  | Double confirmation              |
| Price ≥92¢                                 | **$5**  | 📌Price Locked    | Pure price locking               |
| Other 85-91¢                               | **$3**  | 💡Probe           | Minimum stake for probing        |

### Weather Support Logic

- **Buy NO**: Open-Meteo predicted temperature is **outside** the option range (with ±2° tolerance).
- **Buy YES**: Open-Meteo predicted temperature **falls within** the option range.

### Volume Detection

- **High Volume**: Individual option volume ≥ $5,000.

---

## 📢 Alerting Dimensions

### 1. 📂 City Alert Summaries (Push)

- **Optimization**: All anomalies for the same city are merged into a **single report** per scan cycle to prevent spamming.
- **Price Source**: Uses real **Ask price** (actual executable price), not mid price
- **Push Format**:
  ```
  ⚡ 40-41°F (2026-02-06): Buy No 87¢ | Prediction:38°F [🛒 $10.0 🔥High Conf]

  💡 Strategy Tips:
  • Predicted temp 38.0°C falls within 40-41°F range, market aligns with model
  ```

### 2. ⚡ Price Alerts (Auto Paper Trade)

- **Trigger**: Buy Yes or Buy No price enters the **85¢-95¢** range.
- **Auto Action**: System executes a **$3-$10 Paper Trade** based on the dynamic position strategy.
- **Purpose**: High-probability / Near-settlement reminders.

### 3. 👀 Market Anomalies

- **Whale Inflow**: Large single trades (>$5,000) with imbalanced ratios.
- **Volume Spikes**: Sudden increase in volume (>2x historical std dev).

### 4. 📅 Daily PnL Summary

- **Trigger**: Triggered automatically around 23:55 (Beijing Time).
- **Content**: Summarizes daily floating PnL, balance changes, and win rate.

### 5. 🎯 Trading Signals (`/signal`)

Prioritizes markets with the **earliest settlement date**, sorted by opportunity value, returns **Top 5**:

```
🎯 Upcoming Settlement (2026-02-06)
43 active options

🔥 1. Dallas 76-77°F
   💡 Prediction 80.7° above 77° → Buy NO ✓
   📊 Buy No 94¢ | ⏳Near Lock

🔥 2. Atlanta 56-57°F
   💡 Prediction 60.4° above 57° → Buy NO ✓
   📊 Buy No 94¢ | ⏳Near Lock
```

**Lock Status**:

- 🔒Locked: Price ≥95¢
- ⏳Near Lock: Price 85-94¢
- 👀Watch: Price 70-84¢
- ⚖️Balanced: Price <70¢

---

## 📊 Paper Trading Report Format

Accessible via `/portfolio`. Reports are grouped by **Target Settlement Date**:

```
📊 Paper Trading Report
════════════════════

📈 【2026-02-06】 Subtotal: +2.45$
──────────────────
🟢 Chicago 40-41°F
   NO 87¢→92¢ Pred:38 | +0.47$
🟢 Chicago 32-33°F
   NO 94¢→98¢ Pred:38 | +0.12$

💰 Total Exposure PnL: +6.89$

📈 Historical Stats:
Trades: 18 | Win Rate: 100.0%
Total Cost: $90.00 | Total PnL: +12.50$ (+13.9%)

════════════════════
💳 Account Balance: $639.11
```

---

## 🛠️ Configuration (.env)

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Polymarket API (Used for real-time prices & trade history)
POLYMARKET_API_KEY=your_api_key_here

# Proxy (Optional, remove for VPS deployment)
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

## 🏗️ Project Architecture

This project is built entirely on the official **py-clob-client**:
- All interactions with Polymarket (market data, orderbook, trading) use `py-clob-client`
- Core API wrapper: `src/data_collection/polymarket_api.py`

## 📂 Data Files

| File | Description |
|------|-------------|
| `data/paper_positions.json` | Paper trading positions, balance, trade history |
| `data/pushed_signals.json` | Pushed signals record (anti-spam) |
| `data/active_signals.json` | Currently active trading signals |
| `data/all_markets.json` | Full market cache |
| `data/price_history.json` | Price history for trend calculation |

---

## 📋 Core Features

- ✅ **Smart Dynamic Positions**: Automatic adjustment ($3-$10) based on weather forecasts, volume, and locking degree.
- ✅ **Predicted Temp Tracking**: Records the Open-Meteo forecast at the time of purchase for retrospective analysis.
- ✅ **Smart Merged Push**: City-based alert aggregation for a clean interface.
- ✅ **Auto Paper Trading**: Built-in system for tracking performance within the 85-95¢ range.
- ✅ **High-Speed Price Sync**: Utilizes CLOB batch API for instant price updates without 404s.
- ✅ **Timezone Adaptation**: All timestamps are automatically adjusted to Beijing Time (UTC+8).
- ✅ **Smart Date Selection**: Automatically targets the earliest active market date.
- ✅ **Unit Sensitivity**: US markets use Fahrenheit (°F), others use Celsius (°C).
- ✅ **Data Persistence**: Local JSON storage ensures consistency after restarts.

---

## 🔄 VPS Update Instructions

```bash
# 1. Local update
git add . && git commit -m "update" && git push

# 2. VPS pull & restart
ssh root@VPS_IP "cd ~/PolyWeather && git pull && screen -S polyweather -X quit; screen -dmS polyweather python run.py"
```
