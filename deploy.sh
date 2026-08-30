#!/usr/bin/env bash
set -euo pipefail

NEW_TAG="${1:-latest}"
TAG_FILE="/var/lib/polyweather/.current_tag"
COMPOSE_DIR="/root/PolyWeather"
LOCK_FILE="${POLYWEATHER_DEPLOY_LOCK_FILE:-/var/lock/polyweather-deploy.lock}"

GHCR_PAT=""
if ! IFS= read -r GHCR_PAT && [ -z "$GHCR_PAT" ]; then
    echo "❌ GHCR token must be provided on stdin"
    exit 1
fi
if [ -z "$GHCR_PAT" ]; then
    echo "❌ GHCR token must be provided on stdin"
    exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "❌ Another PolyWeather deploy is already running"
    exit 1
fi

printf '%s' "$GHCR_PAT" | docker login ghcr.io -u yangyuan-zhen --password-stdin
unset GHCR_PAT

cd "$COMPOSE_DIR"
git fetch origin main && git reset --hard origin/main

PREVIOUS_TAG=""
if [ -f "$TAG_FILE" ]; then
    PREVIOUS_TAG=$(cat "$TAG_FILE")
    echo "Previous tag: $PREVIOUS_TAG"
fi

rollback_to_previous() {
    if [ -n "$PREVIOUS_TAG" ]; then
        echo "Rolling back to $PREVIOUS_TAG..."
        export IMAGE_TAG="$PREVIOUS_TAG"
        docker compose pull
        compose_up_retry "rollback" -d
        echo "✅ Rolled back to $PREVIOUS_TAG"
    else
        echo "⚠️  No previous tag to rollback to"
    fi
}

compose_up_retry() {
    local name="$1"
    shift
    local output=""

    for attempt in $(seq 1 6); do
        if output=$(docker compose up "$@" 2>&1); then
            echo "$output"
            return 0
        fi

        echo "$output"
        if echo "$output" | grep -qi "removal of container .* is already in progress"; then
            echo "Container removal is still in progress during ${name}; retry ${attempt}/6..."
            sleep 5
            continue
        fi

        return 1
    done

    echo "❌ docker compose up failed for ${name} after retries"
    return 1
}

read_env_file_value() {
    local key="$1"
    if [ ! -f ".env" ]; then
        return 0
    fi
    awk -F= -v key="$key" '
        $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
            value=$0
            sub("^[^=]*=", "", value)
            gsub("^[[:space:]]+|[[:space:]]+$", "", value)
            gsub(/^["'"'"']|["'"'"']$/, "", value)
            print value
        }
    ' .env | tail -n 1
}

stop_existing_bot_receivers() {
    echo "Stopping existing Telegram bot receivers..."
    docker compose stop polyweather || true

    local legacy_pattern='python(3)? .*bot_[l]istener\.py'
    if pgrep -af "$legacy_pattern" >/dev/null 2>&1; then
        echo "Stopping legacy host bot_listener.py processes..."
        pkill -TERM -f "$legacy_pattern" || true
        sleep 3
        if pgrep -af "$legacy_pattern" >/dev/null 2>&1; then
            echo "Force-stopping legacy host bot_listener.py processes..."
            pkill -KILL -f "$legacy_pattern" || true
        fi
    else
        echo "No legacy host bot_listener.py process found"
    fi
}

resolve_env_value() {
    local primary_key="$1"
    local fallback_key="${2:-}"
    local value="${!primary_key:-}"

    if [ -z "$value" ]; then
        value="$(read_env_file_value "$primary_key")"
    fi
    if [ -z "$value" ] && [ -n "$fallback_key" ]; then
        value="${!fallback_key:-}"
        if [ -z "$value" ]; then
            value="$(read_env_file_value "$fallback_key")"
        fi
    fi

    printf '%s' "$value"
}

export IMAGE_TAG="$NEW_TAG"
export POLYWEATHER_API_BASE_URL="${POLYWEATHER_FRONTEND_INTERNAL_API_BASE_URL:-http://polyweather_web:8000}"
resolved_supabase_url="$(resolve_env_value "SUPABASE_URL" "NEXT_PUBLIC_SUPABASE_URL")"
resolved_supabase_anon_key="$(resolve_env_value "SUPABASE_ANON_KEY" "NEXT_PUBLIC_SUPABASE_ANON_KEY")"
if [ -n "$resolved_supabase_url" ]; then
    export SUPABASE_URL="$resolved_supabase_url"
else
    unset SUPABASE_URL
fi
if [ -n "$resolved_supabase_anon_key" ]; then
    export SUPABASE_ANON_KEY="$resolved_supabase_anon_key"
else
    unset SUPABASE_ANON_KEY
fi
stop_existing_bot_receivers
pull_ok=0
for pull_attempt in $(seq 1 6); do
    docker compose pull && pull_ok=1 && break
    echo "Image pull failed or tag not ready, retry ${pull_attempt}/6..."
    sleep 10
done
if [ "$pull_ok" != "1" ]; then
    echo "❌ Image pull failed after retries"
    exit 1
fi

smoke_check() {
    local name="$1"
    local url="$2"
    local timeout="$3"
    local attempts="${4:-6}"
    local delay="${5:-5}"
    local output=""

    for i in $(seq 1 "$attempts"); do
        if output=$(curl -fsS -w "http=%{http_code} time=%{time_total}" -o /dev/null --max-time "$timeout" "$url" 2>&1); then
            echo "✅ $name ($output)"
            return 0
        fi
        if [ "$i" != "$attempts" ]; then
            echo "   $name retry $i/$attempts... ($output)"
            sleep "$delay"
        fi
    done

    echo "❌ $name ($output)"
    return 1
}

wait_for_local_service() {
    local name="$1"
    local url="$2"
    local timeout="${3:-5}"
    local attempts="${4:-30}"
    local delay="${5:-2}"

    for i in $(seq 1 "$attempts"); do
        if curl -fsSo /dev/null --max-time "$timeout" "$url"; then
            echo "✅ $name ready after attempt $i/$attempts"
            return 0
        fi
        if [ "$i" != "$attempts" ]; then
            echo "   $name warming $i/$attempts..."
            sleep "$delay"
        fi
    done

    echo "❌ $name did not become ready"
    return 1
}

warm_public_route() {
    local name="$1"
    local url="$2"
    local timeout="${3:-15}"
    local attempts="${4:-3}"
    local delay="${5:-2}"

    for i in $(seq 1 "$attempts"); do
        if curl -fsSo /dev/null --max-time "$timeout" "$url"; then
            echo "✅ warmed $name"
            return 0
        fi
        if [ "$i" != "$attempts" ]; then
            echo "   warm $name retry $i/$attempts..."
            sleep "$delay"
        fi
    done

    echo "⚠️  warm $name failed"
    return 0
}

wait_for_scan_terminal_snapshot() {
    local name="$1"
    local url="$2"
    local timeout="${3:-35}"
    local attempts="${4:-8}"
    local delay="${5:-5}"
    local output=""
    local body=""
    local compact=""
    local http_status=""
    local status=""

    for i in $(seq 1 "$attempts"); do
        if output=$(curl -sS -w "\nhttp=%{http_code}" --max-time "$timeout" "$url" 2>&1); then
            http_status="$(printf '%s\n' "$output" | sed -n 's/^http=//p' | tail -n 1)"
            body="$(printf '%s\n' "$output" | sed '$d')"
            if [ "$http_status" = "401" ]; then
                echo "✅ $name protected after attempt $i/$attempts (http=401)"
                return 0
            fi
            compact="$(printf '%s' "$body" | tr -d '\n\r\t ')"
            if printf '%s' "$compact" | grep -q '"status":"ready"'; then
                echo "✅ $name ready after attempt $i/$attempts"
                return 0
            fi
            if printf '%s' "$compact" | grep -q '"status":"stale"'; then
                echo "✅ $name stale snapshot available after attempt $i/$attempts"
                return 0
            fi
            if printf '%s' "$compact" | grep -q '"stale_reason":"市场扫描快照正在初始化"'; then
                echo "✅ $name initializing after attempt $i/$attempts"
                return 0
            fi
            if printf '%s' "$compact" | grep -q '"status":"partial"'; then
                echo "✅ $name partial snapshot (market data degraded) after attempt $i/$attempts"
                return 0
            fi
            if printf '%s' "$compact" | grep -q '"status":"failed"'; then
                echo "✅ $name failed snapshot (market data unavailable) after attempt $i/$attempts"
                return 0
            fi
            status="$(printf '%s' "$compact" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -n 1)"
            echo "   $name not ready attempt $i/$attempts http=${http_status:-unknown} status=${status:-unknown}"
        else
            echo "   $name request failed attempt $i/$attempts ($output)"
        fi
        if [ "$i" != "$attempts" ]; then
            sleep "$delay"
        fi
    done

    echo "❌ $name did not return a snapshot payload (ready/stale/partial/failed) or http=401"
    return 1
}

validate_frontend_api_base_url() {
    local api_base="${POLYWEATHER_API_BASE_URL:-}"
    if [ -z "$api_base" ]; then
        api_base="$(read_env_file_value "POLYWEATHER_API_BASE_URL")"
    fi
    local normalized
    normalized="$(printf '%s' "$api_base" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g; s#/*$##')"
    case "$normalized" in
        http://polyweather.top|https://polyweather.top|http://www.polyweather.top|https://www.polyweather.top)
            echo "❌ POLYWEATHER_API_BASE_URL must not point at the frontend site: $api_base"
            echo "   Use the internal backend URL http://polyweather_web:8000 or the backend API host https://api.polyweather.top."
            exit 1
            ;;
    esac
}

PUBLIC_SMOKE_RECHECK_DELAY_SEC="${POLYWEATHER_PUBLIC_SMOKE_RECHECK_DELAY_SEC:-20}"

run_public_smoke_checks() {
    local phase="${1:-initial}"
    local failed=0

    if [ "$phase" = "recheck" ]; then
        smoke_check "healthz recheck" "https://api.polyweather.top/healthz" 20 6 10 || failed=1
        smoke_check "frontend cities recheck" "https://polyweather.top/api/cities" 30 8 10 || failed=1
        smoke_check "frontend recheck" "https://www.polyweather.top/" 20 6 10 || failed=1
    else
        smoke_check "healthz" "https://api.polyweather.top/healthz" 15 3 5 || failed=1
        smoke_check "frontend cities" "https://polyweather.top/api/cities" 20 5 5 || failed=1
        smoke_check "frontend" "https://www.polyweather.top/" 15 3 5 || failed=1
    fi

    return "$failed"
}

validate_frontend_api_base_url

echo "Updating Redis dependency..."
compose_up_retry "redis" -d polyweather_redis

echo "Updating backend services..."
compose_up_retry "backend services" -d --no-deps polyweather_web polyweather

echo "Waiting for backend..."
wait_for_local_service "backend healthz" "http://127.0.0.1:8000/healthz" 5 30 5 || FAILED_BACKEND=1
FAILED_BACKEND="${FAILED_BACKEND:-0}"
if [ "$FAILED_BACKEND" = "1" ]; then
    echo "❌ Backend did not become healthy"
    rollback_to_previous
    exit 1
fi

echo "Updating observation collector..."
compose_up_retry "observation collector" -d --no-deps polyweather_collector

echo "Updating cache warmer..."
compose_up_retry "cache warmer" -d --no-deps polyweather_warmer

echo "Updating training settlement worker..."
compose_up_retry "training settlement" -d --no-deps polyweather_training_settlement

echo "Updating frontend..."
compose_up_retry "frontend" -d --no-deps polyweather_frontend

echo "Waiting for frontend..."
wait_for_local_service "frontend root" "http://127.0.0.1:3001/" 5 40 2 || FAILED_FRONTEND=1
wait_for_local_service "frontend terminal" "http://127.0.0.1:3001/terminal" 10 20 2 || FAILED_FRONTEND=1
wait_for_scan_terminal_snapshot "scan terminal snapshot" "http://127.0.0.1:3001/api/scan/terminal" 35 8 5 || FAILED_FRONTEND=1
FAILED_FRONTEND="${FAILED_FRONTEND:-0}"
if [ "$FAILED_FRONTEND" = "1" ]; then
    echo "❌ Frontend did not become healthy"
    rollback_to_previous
    exit 1
fi

warm_public_route "terminal" "https://polyweather.top/terminal" 20 4 3
warm_public_route "scan terminal" "https://polyweather.top/api/scan/terminal" 35 3 2
warm_public_route "auth snapshot" "https://polyweather.top/api/auth/me?prefer_snapshot=1" 10 3 2
warm_public_route "local cities recent stats" "http://127.0.0.1:8000/api/cities?refresh_deb_recent=1" 15 2 2
warm_public_route "cities" "https://polyweather.top/api/cities" 20 3 2

FAILED=0
run_public_smoke_checks || FAILED=1

if [ "$FAILED" = "1" ]; then
    echo "⚠️  Initial public smoke failed; retrying before rollback..."
    sleep "$PUBLIC_SMOKE_RECHECK_DELAY_SEC"
    FAILED=0
    run_public_smoke_checks "recheck" || FAILED=1
fi

if [ "$FAILED" = "1" ]; then
    echo "❌ Smoke tests failed. Rolling back..."
    rollback_to_previous
    exit 1
fi

mkdir -p "$(dirname "$TAG_FILE")"
echo "$NEW_TAG" > "$TAG_FILE"
docker image prune -af
echo "✅ Deployed $NEW_TAG"
