# 🌡️ PolyWeather: Real-time Weather Query & Analysis Bot

An intelligent weather information bot designed to provide ultra-fast, live meteorological data, high-fidelity forecasts, and smart trend analysis. Built for speed and accuracy, it bypasses network caching to deliver the most up-to-date reports from global weather stations.

## 🚀 Quick Start

### Requirements

- **Python 3.11+**
- Dependencies: `pip install -r requirements.txt`

### Running Locally (Windows/Linux)

```bash
# Windows
py -3.11 run.py

# Linux/VPS
python3 run.py
```

_Note: The system is currently in **Weather Query Mode**. Active market monitoring and automated trading modules are suspended._

---

## 🤖 Telegram Bot Commands

| Command        | Description            | Usage                                          |
| :------------- | :--------------------- | :--------------------------------------------- |
| `/city [name]` | **Query City Weather** | Get detailed forecasts, METAR & trend analysis |
| `/id`          | **Get Chat ID**        | Retrieve your current Telegram Chat ID         |
| `/help`        | **Help**               | Display all available commands                 |

### /city Command Example

```
/city London
```

**Real-time Output:**

> 📍 **London 天气详情**  
> ⏱️ 生成时间: 00:41:17  
> ═══ ═══ ═══ ═══ ═══ ═══  
> 🕐 当地时间: 16:41
>
> 📊 **Open-Meteo 7天预测**  
> 👉 今天: 最高 12°C  
>  02-09: 最高 11°C
>
> ✈️ **机场实测 (EGLC)**  
>  🌡️ 10.0°C  
>  💨 风速: 12kt  
>  🕐 观测: 16:20 (当地)
>
> 💡 **态势分析**  
> 📉 **处于降温期**：气温已开始从峰值下滑，今日大概率不会再反弹。  
> 🍃 **清劲风**：空气流动快，虽然有助于散热，但可能伴随阵风引起微小波动。

---

## ✨ Key Features

### 1. 💡 Intelligent Trend Analysis

The bot doesn't just show numbers; it performs a **Live vs. Forecast** analysis:

- **Peak Detection**: Determines if the daily high has likely already passed.
- **Atmospheric Physics**: Uses humidity and dew point to predict if the temperature will "stall" at night.
- **Volatility Alerts**: Flags high wind speeds that might cause rapid temperature swings.

### 2. ✈️ High-Fidelity Airport Data (METAR)

Directly connected to **NOAA Aviation Weather**, the bot fetches raw METAR data from major international airports.

- Automatic conversion from UTC to **City Local Time**.
- Real-time station observations (Temperature, Wind, Dew Point).

### 3. ⚡ Ultra-Fresh Data (Cache Busting)

Engineered to bypass ISP and proxy caches:

- Every request includes a **micro-timestamp token**.
- Forces weather servers (Open-Meteo/NOAA) to deliver fresh results instead of stale cached snapshots.

---

## 🏗️ Architecture Note

The project contains a legacy **Monitoring Engine** and **Paper Trading System** (located in `main.py`). These features are currently **deactivated** to prioritize high-speed on-demand weather reporting.

- To re-enable monitoring: Uncomment `monitor_thread.start()` in `run.py`.
- Documentation for inactive features: See [MARKET_DISCOVERY.md](./MARKET_DISCOVERY.md) and [PAPER_TRADING_GUIDE.md](./PAPER_TRADING_GUIDE.md).
