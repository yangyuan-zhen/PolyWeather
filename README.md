# 🌡️ PolyWeather: Intelligent Weather Quant Analysis Bot

PolyWeather is a weather analysis tool specifically designed for prediction markets like **Polymarket**. It aggregates multi-source forecasts, real-time airport METAR observations, and incorporates AI-driven decision support to help users evaluate weather-related risks more scientifically.

---

## ✨ Core Features

### 1. 🧬 Dynamic Ensemble Blending (DEB Algorithm)

The system automatically tracks the historical performance of various weather models (ECMWF, GFS, ICON, GEM, JMA) in specific cities:

- **Error-Based Weighting**: Dynamically adjusts weights for each model based on their Mean Absolute Error (MAE) over the past 7 days.
- **Blended Forecast**: Provides a "Blended High Temperature" recommendation corrected for historical biases.
- **Concurrency Optimization**: Built-in singleton cache and file locking mechanism to support high-concurrency queries and ensure data safety.

### 2. 🤖 AI Intelligent Analysis (Groq LLaMA 3.3)

Integrates the LLaMA 70B model to interpret rapidly changing meteorological data:

- **Logical Deduction**: Considers dynamic factors such as wind speed, wind direction, cloud cover, and solar radiation to judge temperature trends.
- **Confidence Scoring**: Provides a confidence score from 1-10 for the current market conditions.
- **Automatic Cooldown Determination**: When temperature drop is observed or the forecast peak has passed, the AI provides a definitive market conclusion.

### 3. ⏱️ Real-time Airport Observations (Zero-Cache METAR)

- **Live Passthrough**: Bypasses CDN caching via dynamic headers to obtain first-hand METAR reports from airports.
- **Settlement Warning**: Automatically calculates the Wunderground settlement boundary (X.5 rounding line) to warn of potential volatility.

### 4. 📈 Historical Data Collection

- Includes `fetch_history.py` to retrieve up to 3 years of hourly historical weather data for any city, supporting future algorithm development.

---

## ⚡ Deployment

### Requirements

- **Python 3.11+**
- Install dependencies: `pip install -r requirements.txt`
- **Environment Variables**: Set `TELEGRAM_BOT_TOKEN` and `GROQ_API_KEY` in your `.env` file.

### VPS Quick Deployment

1. Clone the repository and install dependencies.
2. Configure your `.env` file.
3. Use the following script for one-click updates and restarts:

```bash
cat > ~/update.sh << 'EOF'
#!/bin/bash
cd ~/PolyWeather
git fetch origin
git reset --hard origin/main
pkill -f bot_listener.py
sleep 1
nohup python3 bot_listener.py > bot.log 2>&1 &
echo "✅ PolyWeather Restarted!"
EOF
chmod +x ~/update.sh
```

---

## 🕹️ Bot Commands

| Command             | Description                                                           |
| :------------------ | :-------------------------------------------------------------------- |
| `/city [city_name]` | Get in-depth weather analysis, live tracking, and AI-driven insights. |
| `/id`               | View the Chat ID of the current conversation.                         |
| `/help`             | Display help information.                                             |

### Supported City Examples

`lon` (London), `par` (Paris), `ank` (Ankara), `nyc` (New York), `chi` (Chicago), `ba` (Buenos Aires), etc.

---

## 🏗️ Architecture

- **Data Layer**: Interfaces with Open-Meteo, NOAA, MGM, and other data sources.
- **Algorithm Layer**: DEB dynamic weighting system + concurrency caching mechanism.
- **Decision Layer**: Real-time trading logic analysis based on Groq API.

---

## 💡 Trading Tips

1. **Reference DEB Blended Value**: When models diverge, the DEB corrected value is usually more reliable than a single forecast.
2. **Observe AI Confidence**: A confidence score below 5 indicates high uncertainty in the current meteorological environment.
3. **Watch Settlement Boundaries**: When the observed high is near X.5, be wary of rounding jumps during Wunderground settlements.

---

_Updated 2026_
