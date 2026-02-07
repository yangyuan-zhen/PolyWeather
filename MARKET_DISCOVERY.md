# Polymarket Weather Market Discovery Technical Documentation

This document explains the technical implementation of how PolyWeather identifies and tracks weather markets on Polymarket.

## 1. Data Sources

We bypass high-level SDKs and interact directly with the **Polymarket Gamma API**, which is the primary metadata layer for Discovery.

- **Base URL:** `https://gamma-api.polymarket.com`
- **Endpoint:** `/markets`

## 2. Discovery Strategy

The system uses a multi-layered search approach to ensure no city segments are missed.

### 2.1 Keyword Triple-Search

Instead of one query, we execute three concurrent search patterns:

1.  `"highest temperature"`: Targets the primary question text.
2.  `"temperature in"`: Broad search for regional markets.
3.  `"daily weather"`: Fallback for markets with different naming conventions.

### 2.2 Prioritization

We apply specific sorting to find the **latest** available contracts (e.g., February 9th, 2026):

- `order=id` & `ascending=false`: Scans the newest created markets first.
- `active=true` & `closed=false`: Filters out resolved or expired contracts.

## 3. Filtering & Parsing Logic

Since Polymarket hosts thousands of events, we apply a strict "Weather Filter" in the code:

### 3.1 Text Validation

We inspect both the `question` and the `slug`:

- **Pattern Match:** Must contain `"highest temperature in"` or `"highest-temperature-in"`.
- **Exclusion:** (Implicitly handled by keyword search) filtered from sports or politics.

### 3.2 Negative Risk Market Handling

Weather markets on Polymarket are often structured as **Negative Risk** groups (where multiple outcomes like "70°F or higher" and "68-69°F" belong to one event).

**Technical Challenge:** In the API's list view, the `activeTokenId` field is often `null` for these complex markets.
**Our Solution:**

1.  Check `clobTokenIds`.
2.  If it's a JSON string (common in Gamma), parse it into a Python list.
3.  If `activeTokenId` is missing, we treat the first token ID in the list as the **"YES" Token**.
4.  This allows us to fetch the real-time orderbook/price even for markets that haven't fully "activated" in the front-end metadata.

## 4. Market Data Structure

Every market found is normalized into this structure for the Decision Engine:

- `condition_id`: The UMA condition ID for resolution.
- `active_token_id`: The specific ERC1155 token ID we want to buy/monitor.
- `group_id`: The `negRiskMarketID`, which allows the bot to understand that specific temperature ranges (e.g., 70°F vs 72°F) are related to the same city.
- `slug`: Used for generating direct dashboard links.

## 5. Frequency & Caching

- **Discovery Frequency:** The system rescans for new cities/dates every **5 minutes**.
- **Caching:** Found markets are stored in an internal memory cache (`_weather_markets_cache`) to reduce API pressure and avoid rate limits.

---

_Created on: 2026-02-07_
_PolyWeather System Documentation_
