from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "VERSION"
VERSION = VERSION_FILE.read_text(encoding="utf-8").strip()
DISPLAY_VERSION = f"v{VERSION}"


TEXT_REPLACEMENTS = {
    ROOT / "README.md": [
        (r"- Version: `v[\d.]+`", f"- Version: `{DISPLAY_VERSION}`"),
    ],
    ROOT / "README_ZH.md": [
        (r"- 版本：`v[\d.]+`", f"- 版本：`{DISPLAY_VERSION}`"),
    ],
    ROOT / "FRONTEND_REDESIGN_REPORT.md": [
        (r"前端交付与重构报告（v[\d.]+）", f"前端交付与重构报告（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "API_ZH.md": [
        (r"PolyWeather API 文档（v[\d.]+）", f"PolyWeather API 文档（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "SUPABASE_SETUP_ZH.md": [
        (r"Supabase \+ 登录 \+ 支付接入说明（v[\d.]+）", f"Supabase + 登录 + 支付接入说明（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "TECH_DEBT.md": [
        (r"技术债与工程待办（v[\d.]+）", f"技术债与工程待办（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "TECH_DEBT_ZH.md": [
        (r"技术债与工程待办（v[\d.]+）", f"技术债与工程待办（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "payments" / "POLYGONSCAN_VERIFY.md": [
        (r"PolyWeatherCheckout PolygonScan 验证（v[\d.]+）", f"PolyWeatherCheckout PolygonScan 验证（{DISPLAY_VERSION}）"),
    ],
    ROOT / "docs" / "deep-research-report.md": [
        (r"README 标注 `v[\d.]+`", f"README 标注 `{DISPLAY_VERSION}`"),
    ],
}


def sync_text_file(path: Path, replacements: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    updated = text
    for pattern, replacement in replacements:
        updated = re.sub(pattern, replacement, updated)
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def sync_frontend_package() -> None:
    path = ROOT / "frontend" / "package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != VERSION:
        data["version"] = VERSION
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    for path, replacements in TEXT_REPLACEMENTS.items():
        sync_text_file(path, replacements)
    sync_frontend_package()
    print(f"Synchronized version to {VERSION}")


if __name__ == "__main__":
    main()
