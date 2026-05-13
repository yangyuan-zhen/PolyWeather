"""市场监控网页版 — f-string 拼 HTML，零模板引擎依赖。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from loguru import logger

from web.analysis_service import _analyze

router = APIRouter()

# ── city config ──

_CITIES: List[Dict[str, Any]] = [
    {"key": "seoul",       "en_name": "Seoul",       "icao": "RKSI",    "airport": "Incheon",      "tz": 9,  "tz_abbr": "KST",  "rw": True},
    {"key": "busan",       "en_name": "Busan",       "icao": "RKPK",    "airport": "Gimhae",       "tz": 9,  "tz_abbr": "KST",  "rw": True},
    {"key": "tokyo",       "en_name": "Tokyo",       "icao": "44166",   "airport": "Haneda",       "tz": 9,  "tz_abbr": "JST",  "rw": False},
    {"key": "ankara",      "en_name": "Ankara",      "icao": "17128",   "airport": "Esenboğa",     "tz": 3,  "tz_abbr": "TRT",  "rw": False},
    {"key": "helsinki",    "en_name": "Helsinki",    "icao": "EFHK",    "airport": "Vantaa",       "tz": 3,  "tz_abbr": "EEST", "rw": False},
    {"key": "amsterdam",   "en_name": "Amsterdam",   "icao": "EHAM",    "airport": "Schiphol",     "tz": 2,  "tz_abbr": "CEST", "rw": False},
    {"key": "istanbul",    "en_name": "Istanbul",    "icao": "17058",   "airport": "Airport",      "tz": 3,  "tz_abbr": "TRT",  "rw": False},
    {"key": "paris",       "en_name": "Paris",       "icao": "LFPB",    "airport": "Le Bourget",   "tz": 2,  "tz_abbr": "CEST", "rw": False},
    {"key": "hong kong",   "en_name": "Hong Kong",   "icao": "HKO",     "airport": "Observatory",  "tz": 8,  "tz_abbr": "HKT",  "rw": False},
    {"key": "lau fau shan","en_name": "Lau Fau Shan","icao": "LFS",     "airport": "Lau Fau Shan", "tz": 8,  "tz_abbr": "HKT",  "rw": False},
    {"key": "taipei",      "en_name": "Taipei",      "icao": "466920",  "airport": "Songshan",     "tz": 8,  "tz_abbr": "TST",  "rw": False},
]

# ── helpers ──

def _sf(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return round(float(v), 1)
    except (ValueError, TypeError):
        return None

def _trend_info(icao: str) -> tuple:
    try:
        from src.utils.telegram_push import _check_rising_trend
        if _check_rising_trend(icao):
            return ("↑", "rising")
    except Exception:
        pass
    try:
        from src.database.db_manager import DBManager
        obs = DBManager().get_airport_obs_recent(icao, minutes=60)
        temps = [r.get("temp_c") for r in obs if r.get("temp_c") is not None]
        if len(temps) >= 4 and temps[-1] < temps[len(temps) // 2]:
            return ("↓", "falling")
    except Exception:
        pass
    return ("→", "flat")

def _obs_age(obs_time_str: Optional[str]) -> Optional[int]:
    if not obs_time_str:
        return None
    try:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(str(obs_time_str)[:26], fmt)
                dt = dt.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - dt).total_seconds()
                return max(0, int(age // 60))
            except (ValueError, TypeError):
                continue
        ts = float(obs_time_str)
        if ts > 1_000_000_000:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            age = (datetime.now(timezone.utc) - dt).total_seconds()
            return max(0, int(age // 60))
    except (ValueError, TypeError, OSError):
        pass
    return None

def _build_cards() -> tuple:
    cards = []
    for cfg in _CITIES:
        try:
            cw = _analyze(cfg["key"])
            ac = cw.get("airport_current") or {}
            cur = cw.get("current") or {}
            ct = _sf(ac.get("temp")) or _sf(cur.get("temp"))
            msf = ac.get("max_so_far")
            mtt = ac.get("max_temp_time") or ""
            obs = ac.get("obs_time") or ""
            local_time = cw.get("local_time") or ""
            new_high = (ct is not None and msf is not None and ct >= msf + 0.3)
            tsym, tcss = _trend_info(cfg["icao"])
            age = _obs_age(obs)

            rw_html = ""
            if cfg.get("rw"):
                amos = cw.get("amos") or {}
                rw_obs = (amos.get("runway_obs") or {}) if amos else {}
                pairs = rw_obs.get("runway_pairs") or []
                temps = rw_obs.get("temperatures") or []
                for (r1, r2), (t, _d) in zip(pairs, temps):
                    if t is not None:
                        rw_html += f'<div class="runway-row"><span class="runway-label">{r1}/{r2}</span><span class="runway-temp">{round(float(t),1):.1f}°C</span></div>\n'

            cards.append({
                "en_name": cfg["en_name"], "airport": cfg["airport"],
                "time": obs or local_time,
                "ct": ct, "msf": _sf(msf), "mtt": mtt,
                "tsym": tsym, "tcss": tcss, "age": age,
                "new_high": new_high, "rw_html": rw_html,
                "warm": ct is not None and ct >= 30,
            })
        except Exception:
            logger.exception("monitor: failed city {}", cfg["key"])

    cards.sort(key=lambda c: (c["ct"] is not None, c["ct"] or -999), reverse=True)
    return cards, datetime.now(timezone.utc).isoformat()

def _render(cards, gts):
    """Build card grid HTML."""
    cards_html = []
    for c in cards:
        nc = " new-high-card" if c["new_high"] else ""
        wc = " warm" if c["warm"] else ""
        nv = " new-high-val" if c["new_high"] else ""
        nh = '◆新高' if c["new_high"] else ""
        ct_str = f'{c["ct"]:.1f}' if c["ct"] is not None else "--"
        ct_na = ' na' if c["ct"] is None else ""
        msf_str = f'{c["msf"]:.1f}°C' if c["msf"] is not None else ""
        msf_na = ' na' if c["msf"] is None else ""
        mtt_str = f'<span class="max-time">{c["mtt"]}</span>' if c["mtt"] else ""
        age_str = f'{c["age"]} min ago' if c["age"] is not None else ""
        age_na = ' na' if c["age"] is None else ""

        cards_html.append(f'''<div class="card{nc}" data-new-high="{str(c['new_high']).lower()}">
  <div class="card-top">
    <span class="city-name">{c['en_name']}</span>
    <span class="airport">/ {c['airport']}</span>
    <span class="local-time">{c['time']}</span>{"<span class='badge new-high'>" + nh + "</span>" if nh else ""}
  </div>
  <div class="card-temp">
    <span class="temp-value{ct_na}{wc}{nv}">{ct_str}</span><span class="temp-unit">°C</span>
  </div>
  <div class="card-meta">
    <div class="meta-row">
      <span class="label">High</span>
      <span class="value{msf_na}">{msf_str}</span>{mtt_str}
      <span class="trend {c['tcss']}">{c['tsym']}</span>
    </div>
    <div class="meta-row">
      <span class="label">Obs</span>
      <span class="obs-age{age_na}">{age_str}</span>
    </div>
  </div>{"<div class='card-runway'><div class='runway-divider'></div>" + c['rw_html'] + "</div>" if c['rw_html'] else ""}
</div>''')

    return f'''<div id="card-grid" class="card-grid"
     hx-get="/m/cards" hx-trigger="every 30s" hx-swap="outerHTML" hx-indicator="#spinner">
<span style="display:block;grid-column:1/-1;text-align:right;margin-bottom:2px;font-size:13px;color:#5a6170">{gts[11:19] if len(gts) > 19 else gts}</span>
{chr(10).join(cards_html)}
</div>
<div id="spinner" class="htmx-indicator">Refreshing…</div>'''


PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Market Monitor — PolyWeather</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1117;color:#c8cdd4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh}
.page{max-width:1500px;margin:0 auto;padding:24px 28px}
.header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:28px;padding-bottom:14px;border-bottom:1px solid #1e2130}
.header h1{font-size:24px;font-weight:600;color:#e8eaed}
.header-r{display:flex;align-items:center;gap:12px}
.nbtn{background:none;border:1px solid #2a2e40;border-radius:6px;padding:3px 8px;font-size:16px;cursor:pointer;transition:border-color .2s}
.nbtn:hover{border-color:#4a5160}.nbtn.muted{opacity:.4}
.card-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:1100px){.card-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.card-grid{grid-template-columns:1fr}}
.card{background:#161822;border:1px solid #1e2130;border-radius:12px;padding:22px 26px;transition:border-color .3s,box-shadow .3s}
.card:hover{border-color:#2a2e40}
.card.new-high-card{border-color:rgba(124,58,237,.3)}
.card-top{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:15px;flex-wrap:wrap}
.city-name{color:#e0e3e8;font-weight:700}
.airport{color:#6a7180;font-weight:400}
.local-time{margin-left:auto;color:#4a5160;font-variant-numeric:tabular-nums;font-size:14px}
.badge{font-size:12px;padding:2px 7px;border-radius:4px;font-weight:600}
.badge.new-high{background:rgba(124,58,237,.18);color:#a78bfa}
.card-temp{margin:8px 0 10px;font-weight:700;line-height:1.15}
.temp-value{font-size:52px;color:#e8eaed;letter-spacing:-.03em}
.temp-value.na{color:#3a4050;font-size:32px}
.temp-value.warm{color:#f59e0b}
.temp-value.new-high-val{color:#c084fc}
.temp-unit{font-size:22px;color:#5a6170;margin-left:3px}
.card-meta{display:flex;flex-direction:column;gap:5px;margin-bottom:2px}
.meta-row{display:flex;align-items:baseline;gap:8px;font-size:14px}
.meta-row .label{color:#4a5160}
.meta-row .value{color:#9aa0b0;font-variant-numeric:tabular-nums}
.meta-row .value.na{color:#3a4050}
.meta-row .trend{margin-left:auto}
.trend{font-size:18px;font-weight:700}
.trend.rising{color:#34d399}
.trend.falling{color:#60a5fa}
.trend.flat{color:#5a6170}
.max-time{font-size:12px;color:#4a5160;margin-left:2px}
.obs-age{font-size:13px;color:#5a6170}
.obs-age.na{color:#3a4050}
.card-runway{margin-top:12px}
.runway-divider{height:1px;background:#1e2130;margin-bottom:8px}
.runway-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px}
.runway-label{color:#4a5160}
.runway-temp{color:#7a8290;font-variant-numeric:tabular-nums}
.htmx-indicator{text-align:center;padding:14px;font-size:14px;color:#3a4050;display:none}
.htmx-request .htmx-indicator,.htmx-request.htmx-indicator{display:block}
</style>
<meta http-equiv="refresh" content="120">
</head>
<body>
<div class="page">
<header class="header">
  <h1>🔥 Market Monitor</h1>
  <div class="header-r">
    <button id="notify-toggle" class="nbtn" onclick="toggleNotify()" title="新高提醒">
      <span id="notify-icon">🔔</span>
    </button>
    <span class="updated" id="update-time"></span>
  </div>
</header>
%s
</div>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<script>
var NF=localStorage.getItem('monitor_notify')!=='off';
var NH=JSON.parse(localStorage.getItem('monitor_notified_highs')||'{}');
function toggleNotify(){NF=!NF;localStorage.setItem('monitor_notify',NF?'on':'off');U();if(NF&&Notification.permission==='default')Notification.requestPermission()}
function U(){var i=document.getElementById('notify-icon');var b=document.getElementById('notify-toggle');if(NF){i.textContent='🔔';b.classList.remove('muted')}else{i.textContent='🔕';b.classList.add('muted')}}
function N(en,t){if(!NF||Notification.permission!=='granted')return;var k=en+'|'+t;var d=new Date().toDateString();if(NH._day!==d)NH={_day:d};if(NH[k])return;NH[k]=true;localStorage.setItem('monitor_notified_highs',JSON.stringify(NH));new Notification('🔴 New High — '+en,{body:t+'°C\\nNew daily high.',tag:k,requireInteraction:true})}
U();
(function(){let p={};document.body.addEventListener('htmx:afterSwap',function(e){if(e.detail.target.id!=='card-grid')return;document.querySelectorAll('.card').forEach(function(c){var n=c.querySelector('.city-name').textContent;var v=c.querySelector('.temp-value').textContent;var o=p[n];p[n]=v;if(o&&o!==v&&v!=='--'){c.style.transition='none';c.style.boxShadow='0 0 14px rgba(52,211,153,0.40)';requestAnimationFrame(function(){c.style.transition='box-shadow 2s ease-out';c.style.boxShadow=''})}if(c.dataset.newHigh==='true')N(n,v)})});var el=document.getElementById('update-time');if(el)el.textContent=new Date().toLocaleTimeString();})();
</script>
</body>
</html>"""


@router.get("/m", response_class=HTMLResponse)
async def monitor_page(request: Request):
    cards, gts = _build_cards()
    return HTMLResponse(PAGE_HTML % _render(cards, gts))

@router.get("/m/cards", response_class=HTMLResponse)
async def monitor_cards(request: Request):
    cards, gts = _build_cards()
    return HTMLResponse(_render(cards, gts))
