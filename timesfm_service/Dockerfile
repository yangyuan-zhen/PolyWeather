FROM python:3.11-slim

WORKDIR /srv/timesfm_service

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TIMESFM_HOST=0.0.0.0 \
    TIMESFM_PORT=8011

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY timesfm_service/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements.txt

# Official upstream install path from google-research/timesfm README.
RUN git clone --depth 1 https://github.com/google-research/timesfm.git /tmp/timesfm \
    && pip install /tmp/timesfm

COPY timesfm_service /srv/timesfm_service

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${TIMESFM_PORT:-8011}"]
