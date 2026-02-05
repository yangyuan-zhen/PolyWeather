import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
import sys
sys.path.insert(0, '..')

st.set_page_config(
    page_title="Polymarket Trading Dashboard",
    page_icon="📊",
    layout="wide"
)

# Custom CSS
st.markdown("""
<style>
    .stMetric {
        background-color: #1e1e1e;
        padding: 15px;
        border-radius: 10px;
    }
    .stMetric label {
        color: #888;
    }
    .stMetric [data-testid="stMetricValue"] {
        color: #00ff88;
    }
</style>
""", unsafe_allow_html=True)

# Header
st.title("📊 Polymarket Trading Dashboard")
st.markdown("---")

# Sidebar
with st.sidebar:
    st.header("⚙️ Settings")
    market_id = st.text_input("Market ID", "weather-ankara-temperature")
    refresh_rate = st.slider("Refresh Rate (seconds)", 10, 300, 60)
    st.markdown("---")
    st.header("📈 Quick Stats")
    st.metric("Total PnL", "$0.00", "+0%")
    st.metric("Open Positions", "0")
    st.metric("Win Rate", "N/A")

# Main content
col1, col2, col3, col4 = st.columns(4)

with col1:
    st.metric(
        label="Current Price",
        value="$0.92",
        delta="+2.3%"
    )

with col2:
    st.metric(
        label="Model Prediction",
        value="7.2°C",
        delta="+0.5°C"
    )

with col3:
    st.metric(
        label="Confidence Score",
        value="0.78",
        delta="+0.05"
    )

with col4:
    st.metric(
        label="Signal",
        value="BUY",
        delta="Strong"
    )

st.markdown("---")

# Charts
col_left, col_right = st.columns(2)

with col_left:
    st.subheader("📉 Price History")
    
    # Demo price data
    dates = pd.date_range(start=datetime.now() - timedelta(days=7), periods=168, freq='H')
    prices = [0.85 + i * 0.0005 + (i % 24) * 0.001 for i in range(168)]
    
    df_prices = pd.DataFrame({
        'Date': dates,
        'Price': prices
    })
    
    fig_price = px.line(df_prices, x='Date', y='Price', 
                        template='plotly_dark',
                        color_discrete_sequence=['#00ff88'])
    fig_price.update_layout(
        height=300,
        margin=dict(l=0, r=0, t=0, b=0)
    )
    st.plotly_chart(fig_price, use_container_width=True)

with col_right:
    st.subheader("🌡️ Temperature Forecast")
    
    # Demo temperature data
    forecast_dates = pd.date_range(start=datetime.now(), periods=72, freq='H')
    temps = [5 + (i % 24) * 0.3 + (i // 24) * 0.5 for i in range(72)]
    
    df_temp = pd.DataFrame({
        'Date': forecast_dates,
        'Temperature': temps
    })
    
    fig_temp = px.line(df_temp, x='Date', y='Temperature',
                       template='plotly_dark',
                       color_discrete_sequence=['#ff6b6b'])
    fig_temp.update_layout(
        height=300,
        margin=dict(l=0, r=0, t=0, b=0)
    )
    st.plotly_chart(fig_temp, use_container_width=True)

st.markdown("---")

# Decision Factors
st.subheader("🎯 Decision Factors")

factors_col1, factors_col2 = st.columns(2)

with factors_col1:
    # Factor scores
    factors = {
        'Statistical Prediction': 0.85,
        'Data Consensus': 0.90,
        'Volume Signal': 0.65,
        'Orderbook Analysis': 0.72,
        'Technical Indicators': 0.58,
        'Whale Signal': 0.45
    }
    
    fig_factors = go.Figure(go.Bar(
        x=list(factors.values()),
        y=list(factors.keys()),
        orientation='h',
        marker_color=['#00ff88' if v > 0.65 else '#ffaa00' if v > 0.4 else '#ff6b6b' 
                     for v in factors.values()]
    ))
    fig_factors.update_layout(
        template='plotly_dark',
        height=250,
        margin=dict(l=0, r=0, t=0, b=0),
        xaxis_title="Score",
        xaxis_range=[0, 1]
    )
    st.plotly_chart(fig_factors, use_container_width=True)

with factors_col2:
    # Order book visualization
    st.markdown("**📚 Order Book**")
    
    bids = [
        {"price": 0.91, "size": 500},
        {"price": 0.90, "size": 800},
        {"price": 0.89, "size": 1200},
    ]
    asks = [
        {"price": 0.93, "size": 600},
        {"price": 0.94, "size": 400},
        {"price": 0.95, "size": 900},
    ]
    
    orderbook_df = pd.DataFrame({
        'Bid Price': [b['price'] for b in bids],
        'Bid Size': [b['size'] for b in bids],
        'Ask Price': [a['price'] for a in asks],
        'Ask Size': [a['size'] for a in asks]
    })
    
    st.dataframe(orderbook_df, use_container_width=True, hide_index=True)

st.markdown("---")

# Recent Trades
st.subheader("📝 Recent Trades")

trades_df = pd.DataFrame({
    'Time': ['10:30:15', '10:28:42', '10:25:11'],
    'Side': ['BUY', 'BUY', 'SELL'],
    'Price': ['$0.92', '$0.91', '$0.88'],
    'Amount': ['$100', '$150', '$75'],
    'Status': ['✅ Filled', '✅ Filled', '✅ Filled']
})

st.dataframe(trades_df, use_container_width=True, hide_index=True)

# Footer
st.markdown("---")
st.markdown("*Last updated: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "*")
