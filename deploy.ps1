$VPS = "root@172.245.214.111"
$PROJECT = "/root/PolyWeather"

Write-Host "🚀 Deploying to $VPS..." -ForegroundColor Cyan

ssh $VPS @"
cd $PROJECT || exit 1
git pull || exit 1
docker compose stop polyweather || true
pkill -TERM -f 'python(3)? .*bot_[l]istener\.py' || true
sleep 2
pkill -KILL -f 'python(3)? .*bot_[l]istener\.py' || true
docker compose up -d --build
"@

Write-Host "✅ Deploy complete. Checking health..." -ForegroundColor Green
Start-Sleep 8
ssh $VPS "curl -s http://localhost:8000/healthz"
