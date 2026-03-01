# 🌡️ PolyWeather: Intelligent Weather Quant Analysis Bot

PolyWeather is a weather analysis tool built for prediction markets like **Polymarket**. It aggregates multi-source forecasts, real-time airport METAR observations, a math-based probability engine, and AI-driven decision support to help users evaluate weather trading risks more scientifically.

<p align="center">
  <img src="docs/images/demo_ankara.png" alt="PolyWeather Demo - Ankara Live Analysis" width="420">
  <br>
  <em>📊 Live query: DEB Blended Forecast + Settlement Probability + Groq AI Decision</em>
</p>

---

## ✨ Core Features

### 1. 🧬 Dynamic Ensemble Blending (DEB Algorithm)

The system automatically tracks the historical performance of weather models (ECMWF, GFS, ICON, GEM, JMA) per city:

- **Error-Based Weighting**: Dynamically adjusts model weights based on their Mean Absolute Error (MAE) over the past 7 days. Lower error = higher weight.
- **Blended Forecast**: Provides a bias-corrected "DEB Blended High Temperature" recommendation.
- **Self-Learning**: Requires at least 2 days of observations before activating weight differentiation. Uses equal-weight averaging during cold start.
- **Accuracy Tracking**: Use the `/deb` command to view DEB's historical WU settlement hit rate and MAE, compared against individual models.
- **Auto-Cleanup**: Only retains the last 14 days of records to prevent unbounded data growth.

### 2. 🎲 Math Probability Engine (Settlement Probability)

Automatically computes the probability for each possible WU settlement integer using a Gaussian distribution:

- **Distribution Center μ**: Weighted average of DEB/multi-model median (70%) and ensemble median (30%). Auto-corrects upward when METAR max exceeds μ.
- **Standard Deviation σ — Three-Layer Pipeline**:
  1. **Ensemble Base**: σ = (P90-P10) / 2.56
  2. **MAE Floor**: Uses DEB’s historical MAE as σ minimum—prevents ensembles from underestimating true uncertainty
  3. **Shock Score Amplifier**: σ × (1 + 0.5 × shock_score) when weather is changing rapidly
- **Time Decay**: Before peak σ×1.0 → During peak σ×0.7 → After peak σ×0.3
- **Observed Floor**: Temperatures below the current METAR max WU value are excluded

#### 💥 Shock Score: Weather Disruption Soft Scorer (0~1)

Evaluates environmental stability from the last 4 METAR observations. Higher = more unstable = wider σ:

| Component             | Weight | Trigger                                                           |
| :-------------------- | :----- | :---------------------------------------------------------------- |
| Wind Direction Change | 0~0.4  | Angle difference × wind speed amplifier (weak winds downweighted) |
| Cloud Cover Jump      | 0~0.35 | Cloud code escalation (FEW→BKN, etc.)                             |
| Pressure Change       | 0~0.25 | >2hPa change within 2 hours                                       |

### 3. 🤖 AI Deep Analysis (Groq LLaMA 3.3 70B)

Feeds wind speed, wind direction, cloud cover, solar radiation, and METAR trend data into LLaMA 70B:

- **Logical Reasoning**: 2-3 sentences analyzing airport dynamics, explicitly referencing Open-Meteo forecast and DEB blended values as benchmarks.
- **Time Awareness**: Analysis considers how much time remains until the predicted peak, judging remaining warming potential.
- **Market Call**: Explicitly states the expected peak time window and specific temperature betting range. Calls "dead market" when cooling is confirmed.
- **Confidence Score**: Quantitative 1-10 confidence rating.
- **High Availability**: Built-in auto-retry + fallback model degradation (70B → 8B) to withstand Groq API 500/503 outages.

### 4. ⏱️ Real-time Airport Observations (Zero-Cache METAR)

- **Precise Timing**: Extracts actual observation time from raw METAR text (`rawOb`), not the API's rounded `reportTime`. Accurate to the minute.
- **Live Passthrough**: Bypasses CDN caching via dynamic headers to obtain first-hand METAR reports.
- **Settlement Warning**: Automatically calculates the Wunderground settlement boundary (X.5 rounding line).
- **Anomaly Filtering**: Automatically filters out -9999 sentinel values from sources like MGM to prevent garbage data in output.

### 5. 📈 Historical Data Collection

- Includes `fetch_history.py` to retrieve up to 3 years of hourly historical weather data (temperature, humidity, radiation, pressure, 10+ dimensions), providing data foundation for future ML models (XGBoost/MOS).

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

| Command             | Description                                                                                                                         |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------- |
| `/city [city_name]` | Get weather analysis, settlement probabilities, METAR tracking, and AI insights.                                                    |
| `/deb [city_name]`  | View DEB accuracy: daily hit/miss breakdown, bias analysis (underestimate/overestimate), model MAE comparison, trading suggestions. |
| `/id`               | View the Chat ID of the current conversation.                                                                                       |
| `/help`             | Display help information.                                                                                                           |

### Supported Cities

`lon` (London), `par` (Paris), `ank` (Ankara), `nyc` (New York), `chi` (Chicago), `dal` (Dallas), `mia` (Miami), `atl` (Atlanta), `sea` (Seattle), `tor` (Toronto), `sel` (Seoul), `ba` (Buenos Aires), `wel` (Wellington), etc.

---

## 🏗️ Architecture

```mermaid
graph TD
    User[User] -->|Query Command| Bot[bot_listener.py Core Scheduler]

    subgraph Data Acquisition
        Bot --> Collector[WeatherDataCollector]
        Collector --> OM[Open-Meteo Forecast/Ensemble]
        Collector --> MM[Multi-Model ECMWF/GFS/ICON/GEM/JMA]
        Collector --> METAR["Live Airport METAR (rawOb precise time)"]
    end

    subgraph Algorithm Layer
        Collector --> Peak[Peak Hour Prediction]
        Collector --> DEB[DEB Dynamic Weighting]
        DEB --> DB[(daily_records Database)]
        Peak --> Prob[Gaussian Probability Engine]
        Collector --> Prob
        METAR --> Shock[Shock Score]
        Shock --> Prob
        Collector --> Logic[Settlement Boundary / Trend Analysis]
    end

    subgraph AI Decision Layer
        DEB --> AI[Groq LLaMA 70B]
        Prob --> AI
        Logic --> AI
        METAR --> AI
    end

    AI -->|Market Call + Logic + Confidence| Bot
    Bot -->|DEB Blend + Probability + AI Analysis| User
```

---

## 💡 Trading Tips

1. **Watch Settlement Probability**: The probability engine is math-based and more objective than AI judgment. When one temperature has > 65% probability, the direction is relatively clear.
2. **Observe Time Decay**: Probabilities auto-lock as time progresses. After peak hours, the engine narrows σ dramatically, concentrating results around the observed max.
3. **Reference DEB Blended Value**: When models diverge, the DEB corrected value is usually more reliable than any single forecast.
4. **Observe AI Confidence**: A score below 5 indicates high uncertainty—consider staying on the sidelines.
5. **Watch Settlement Boundaries**: When the observed high is near X.5, be wary of rounding jumps during WU settlements.
6. **Distribution Center μ**: The μ value shown in the probability display represents the algorithm's expected most likely actual high temperature—compare it directly with the Polymarket odds.

---

_Updated 2026-03-01_
