#!/bin/bash
set -e
VPS="root@38.54.27.70"
PROJECT="/root/PolyWeather"

echo "🚀 Deploying to $VPS..."

ssh "$VPS" "cd $PROJECT && git pull && docker compose up -d --build"

echo "✅ Deploy complete. Checking health..."
sleep 8
ssh "$VPS" "curl -s http://localhost:8000/healthz"
# deploy test
