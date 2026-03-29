# PolyWeather TimesFM Service

This service isolates official `timesfm` inference from the main PolyWeather backend.

## What it does

- runs on Python 3.11+
- installs official upstream `google-research/timesfm`
- accepts recent `actual_high` or other temperature series payloads
- returns point forecasts for the next 1 to 3 days

## Local run

```bash
cd timesfm_service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
git clone https://github.com/google-research/timesfm.git ../.timesfm-src
pip install ../.timesfm-src
uvicorn app:app --host 0.0.0.0 --port 8011
```

## Docker

Build and run through the repo `docker-compose.yml`, or directly:

```bash
docker compose --profile timesfm up --build polyweather_timesfm
docker build -f timesfm_service/Dockerfile -t polyweather-timesfm .
docker run --rm -p 8011:8011 polyweather-timesfm
```
