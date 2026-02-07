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
/city Chicago
```

**Real-time Output:**

> 📍 **Chicago 天气详情**  
> ⏱️ 生成时间: 12:45:30  
> ════════════════════  
> 🕐 当地时间: 12:45
>
> 📊 **Open-Meteo 7天预测**  
> 👉 今天: 最高 22.4°F (NWS: 23°F)  
>  02-08: 最高 26.2°F  
>  02-09: 最高 37.2°F
>
> ✈️ **机场实测 (KORD)**  
>  🌡️ 21.0°F (今日最高: 23.0°F)  
>  💨 风速: 4kt  
>  🕐 观测: 12:00 (当地)
>
> 💡 **态势分析**  
> ⏱️ **预计峰值时刻**：今天 14:00 - 16:00 之间。  
> 🎯 **博弈建议**：关注该时段实测能否站稳 22.4°F。  
> 📈 **升温进程中**：距离峰值还有约 1.4° 空间，正向高点冲击。

---

## ✨ Key Features

### 1. 🏛️ Multi-Source Data Fusion

The bot aggregates data from multiple authoritative sources:

| Source         | Data Type                      | Coverage          |
| -------------- | ------------------------------ | ----------------- |
| **Open-Meteo** | 7-day forecast                 | Global            |
| **NWS**        | Official US forecast           | US cities only ⚠️ |
| **METAR**      | Real-time airport observations | Global airports   |

- **⚠️ Divergence Alerts**: When Open-Meteo and NWS disagree by >1°F, the bot flags it for your attention.

### 2. ⏱️ Peak Timing Prediction

For each city, the bot analyzes the hourly forecast curve to identify:

- **Exact peak window**: e.g., "14:00 - 16:00"
- **Betting recommendation**: Monitor real-time data during this window

### 3. 📊 Today's High Tracking

METAR data is filtered by **local calendar day** using UTC offset:

- Only observations from **local midnight onwards** are counted
- Ensures "Today's High" is accurate, not polluted by yesterday's warm afternoon

### 4. ✈️ High-Fidelity Airport Data (METAR)

Directly connected to **NOAA Aviation Weather**, the bot fetches raw METAR data from major international airports.

- Automatic conversion from UTC to **City Local Time**.
- Real-time station observations (Temperature, Wind, Dew Point).

### 5. ⚡ Ultra-Fresh Data (Cache Busting)

Engineered to bypass ISP and proxy caches:

- Every request includes a **micro-timestamp token**.
- Forces weather servers (Open-Meteo/NOAA/NWS) to deliver fresh results instead of stale cached snapshots.

---

## 🎯 Betting Strategy Tips

1. **Check model consensus**: If Open-Meteo and NWS agree, confidence is high.
2. **Watch the peak window**: Monitor METAR during predicted peak hours.
3. **Use "Today's High"**: Track the actual recorded maximum vs forecast.
4. **Interpret ⚠️ warnings**: Divergence means uncertainty—proceed with caution.

---

## 🏗️ Architecture Note

The project contains a legacy **Monitoring Engine** and **Paper Trading System** (located in `main.py`). These features are currently **deactivated** to prioritize high-speed on-demand weather reporting.

- To re-enable monitoring: Uncomment `monitor_thread.start()` in `run.py`.
- Documentation for inactive features: See [MARKET_DISCOVERY.md](./MARKET_DISCOVERY.md) and [PAPER_TRADING_GUIDE.md](./PAPER_TRADING_GUIDE.md).
