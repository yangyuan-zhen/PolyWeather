"""Check which cities have Open-Meteo cache entries in the web container."""
import time
from src.data_collection.weather_sources import WeatherDataCollector
from src.utils.config_loader import load_config

w = WeatherDataCollector(load_config())
print("Multi-model cache entries:")
for k in sorted(w._multi_model_cache.keys()):
    age = int(time.time() - w._multi_model_cache[k].get("t", 0))
    print(f"  {k}  age={age}s")

print(f"\nOM cache entries: {len(w._open_meteo_cache)}")
print(f"Multi-model cache entries: {len(w._multi_model_cache)}")
print(f"Rate limit until: {w._open_meteo_rate_limit_until}")
