import os
from dotenv import load_dotenv

def load_config():
    """
    Load configuration from environment variables and config files
    """
    load_dotenv()
    
    def get_env_or_none(key):
        val = os.getenv(key)
        if not val or "your_" in val.lower() or val.strip() == "":
            return None
        return val

    config = {
        "polymarket": {
            "api_key": get_env_or_none("POLYMARKET_API_KEY"),
            "secret_key": get_env_or_none("POLYMARKET_SECRET_KEY"),
            "passphrase": get_env_or_none("POLYMARKET_PASSPHRASE"),
            "wallet_address": get_env_or_none("POLYMARKET_WALLET_ADDRESS"),
            "proxy": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY"),
        },
        "weather": {
            "openweather_api_key": get_env_or_none("OPENWEATHER_API_KEY"),
            "wunderground_api_key": get_env_or_none("WUNDERGROUND_API_KEY"),
            "visualcrossing_api_key": get_env_or_none("VISUALCROSSING_API_KEY"),
            "proxy": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY"),
        },
        "telegram": {
            "bot_token": os.getenv("TELEGRAM_BOT_TOKEN"),
            "chat_id": os.getenv("TELEGRAM_CHAT_ID"),
            "proxy": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY"),
        },
        "config": {
            "weights": {
                "statistical_prediction": 0.50,
                "data_source_consensus": 0.15,
                "market_volume_signal": 0.15,
                "orderbook_analysis": 0.10,
                "technical_indicators": 0.05,
                "onchain_whale_signal": 0.05
            }
        },
        "app": {
            "log_level": os.getenv("LOG_LEVEL", "INFO"),
            "env": os.getenv("ENV", "development"),
            "proxy": os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY"),
        }
    }
    
    return config
