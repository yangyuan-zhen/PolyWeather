$VPS = "root@172.245.214.111"
$PROJECT = "/root/PolyWeather"

Write-Host "🚀 Deploying to $VPS..." -ForegroundColor Cyan

ssh $VPS "cd $PROJECT && git pull && docker compose up -d --build"

Write-Host "✅ Deploy complete. Checking health..." -ForegroundColor Green
Start-Sleep 8
ssh $VPS "curl -s http://localhost:8000/healthz"
