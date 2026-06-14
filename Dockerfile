# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    TZ=UTC

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    gcc libhdf5-dev libnetcdf-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.lock .

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -r requirements.lock

COPY . .

CMD ["python", "bot_listener.py"]
