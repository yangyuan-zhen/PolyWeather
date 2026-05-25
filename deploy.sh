#!/usr/bin/env bash
set -euo pipefail

GHCR_PAT="$1"
NEW_TAG="${2:-latest}"
TAG_FILE="/var/lib/polyweather/.current_tag"
COMPOSE_DIR="/root/PolyWeather"

echo "$GHCR_PAT" | docker login ghcr.io -u yangyuan-zhen --password-stdin

cd "$COMPOSE_DIR"
git fetch origin main && git reset --hard origin/main

PREVIOUS_TAG=""
if [ -f "$TAG_FILE" ]; then
    PREVIOUS_TAG=$(cat "$TAG_FILE")
    echo "Previous tag: $PREVIOUS_TAG"
fi

export IMAGE_TAG="$NEW_TAG"
docker compose pull
docker compose up -d

# Wait for backend to be ready (retry up to 60s)
echo "Waiting for backend..."
for i in $(seq 1 30); do
    sleep 5
    if curl -fsSo /dev/null --max-time 5 "https://api.polyweather.top/healthz"; then
        echo "✅ healthz ready after ${i}x5s"
        break
    fi
    echo "   retry $i/30..."
done

FAILED=0
curl -fsSo /dev/null --max-time 15 "https://api.polyweather.top/healthz" && echo "✅ healthz" || { echo "❌ healthz"; FAILED=1; }
curl -fsSo /dev/null --max-time 15 "https://api.polyweather.top/api/scan/terminal?limit=1" && echo "✅ scan" || { echo "❌ scan"; FAILED=1; }
curl -fsSo /dev/null --max-time 10 "https://www.polyweather.top/" && echo "✅ frontend" || { echo "❌ frontend"; FAILED=1; }

if [ "$FAILED" = "1" ]; then
    echo "❌ Smoke tests failed. Rolling back..."
    if [ -n "$PREVIOUS_TAG" ]; then
        export IMAGE_TAG="$PREVIOUS_TAG"
        docker compose pull
        docker compose up -d
        echo "✅ Rolled back to $PREVIOUS_TAG"
    else
        echo "⚠️  No previous tag to rollback to"
    fi
    exit 1
fi

mkdir -p "$(dirname "$TAG_FILE")"
echo "$NEW_TAG" > "$TAG_FILE"
echo "✅ Deployed $NEW_TAG"
