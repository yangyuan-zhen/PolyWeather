#!/bin/bash
cd ~/PolyWeather

echo "====================================="
echo "🔄 拉取最新代码..."
git pull origin main

echo "🛑 停止旧的机器人与 Web 服务进程..."
# 1. 杀掉 Python bot 和 web app
pkill -f "python bot_listener.py" || true
pkill -f "python web/app.py" || true
pkill -f "uvicorn" || true
# 2. 杀掉依然占用 8000 端口的僵尸进程 (确保 FastAPI 能重启)
fuser -k 8000/tcp 2>/dev/null || true
lsof -t -i:8000 | xargs kill -9 2>/dev/null || true

echo "🚀 后台启动新的服务..."
nohup python bot_listener.py > bot.log 2>&1 &
nohup python web/app.py > web.log 2>&1 &

echo "✅ 机器人与网页版 (Port: 8000) 已更新并重启！"
echo "====================================="
