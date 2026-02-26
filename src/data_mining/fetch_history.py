import os
import sys
import json
import logging
from datetime import datetime
import pandas as pd
import requests

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_historical_data_for_city(city_info, output_dir):
    city_name = city_info['city']
    lat = city_info['latitude']
    lon = city_info['longitude']
    
    # We will fetch data from Jan 1, 2023 to yesterday (or to latest available)
    start_date = "2023-01-01"
    end_date = "2025-12-31"  # API handles dates in the future up to latest available archive usually 
    # For safety let's use a dynamic yesterday end_date
    import datetime
    today = datetime.datetime.now()
    yesterday = (today - datetime.timedelta(days=2)).strftime("%Y-%m-%d")
    
    url = (
        f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}"
        f"&start_date={start_date}&end_date={yesterday}"
        "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
        "cloud_cover,shortwave_radiation,precipitation,surface_pressure"
        "&timezone=auto"
    )
    
    logging.info(f"Downloading historical data for {city_name} (Lat: {lat}, Lon: {lon})...")
    
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        data = response.json()
        
        if "hourly" not in data:
            logging.error(f"Failed to find 'hourly' data for {city_name}.")
            return
            
        hourly_data = data["hourly"]
        
        # Convert to pandas DataFrame
        df = pd.DataFrame(hourly_data)
        
        # Save to CSV
        output_path = os.path.join(output_dir, f"{city_name.replace(' ', '_').lower()}_historical.csv")
        df.to_csv(output_path, index=False)
        
        logging.info(f"✅ Successfully saved historical data for {city_name} to {output_path}. Shape: {df.shape}")
        
    except requests.exceptions.RequestException as e:
        logging.error(f"❌ Network error while fetching data for {city_name}: {e}")
    except Exception as e:
        logging.error(f"❌ Error processing data for {city_name}: {e}")

def main():
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    config_path = os.path.join(project_root, 'config', 'config.yaml')
    output_dir = os.path.join(project_root, 'data', 'historical')
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Load config
    try:
        import yaml
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
    except Exception as e:
        logging.error(f"Failed to load {config_path}: {e}")
        sys.exit(1)
        
    cities = config.get('cities', [])
    if not cities:
        logging.warning("No cities found in config.yaml")
        return
        
    for city_info in cities:
        fetch_historical_data_for_city(city_info, output_dir)
        
if __name__ == "__main__":
    main()
