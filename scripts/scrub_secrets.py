#!/usr/bin/env python
"""Scrub secrets from the codebase for GitHub-safe public reference.

Run this on the public/github-safe branch before committing.
It redacts hardcoded API keys, tokens, and replaces .env files.
"""

from __future__ import annotations

import re
import os
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Patterns to redact (value -> REDACTED)
SECRET_PATTERNS: list[tuple[str, str]] = [
    # Hardcoded tokens in settlement_sources.py
    (
        r'IMGW_METEO_API_TOKEN\s*=\s*"[^"]*"',
        'IMGW_METEO_API_TOKEN = os.environ.get("IMGW_METEO_API_TOKEN", "")',
    ),
    (
        r'NOAA_WRH_MESO_TOKEN\s*=\s*"[^"]*"',
        'NOAA_WRH_MESO_TOKEN = os.environ.get("NOAA_WRH_MESO_TOKEN", "")',
    ),
    # mesoToken in tmp files
    (
        r"var\s+mesoToken\s*=\s*'[^']*'",
        "var mesoToken = 'REDACTED'",
    ),
    (
        r"mesoToken\s*=\s*'[^']*'",
        "mesoToken = 'REDACTED'",
    ),
    # Any bare synopticdata URLs with tokens
    (
        r"https://api\.synopticdata\.com/v2/stations/timeseries\?[^\"'\s]*token=[^\"'&\s]+",
        "https://api.synopticdata.com/v2/stations/timeseries?token=REDACTED",
    ),
]

# Files to delete entirely (temp files with secrets)
DELETE_FILES: list[str] = [
    "tmp_apikey.js",
    "tmp_obs.js",
]

# Files to replace with .example counterparts
REPLACE_WITH_EXAMPLE: dict[str, str] = {
    ".env": ".env.example",
    ".env.local": ".env.example",
    "frontend/.env.local": "frontend/.env.example",
}


def scrub_file(path: Path) -> bool:
    """Apply secret patterns to a single file. Returns True if changed."""
    try:
        content = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError):
        return False

    original = content
    for pattern, replacement in SECRET_PATTERNS:
        content = re.sub(pattern, replacement, content)

    if content != original:
        path.write_text(content, encoding="utf-8")
        print(f"  SCRUBBED: {path.relative_to(REPO_ROOT)}")
        return True
    return False


def main() -> None:
    print("=== Scrubbing secrets for GitHub-safe reference ===\n")

    changes = 0

    # 1. Delete known temp files with secrets
    for fname in DELETE_FILES:
        fpath = REPO_ROOT / fname
        if fpath.exists():
            fpath.unlink()
            print(f"  DELETED: {fname}")
            changes += 1

    # 2. Replace .env files with .example
    for target, example in REPLACE_WITH_EXAMPLE.items():
        target_path = REPO_ROOT / target
        example_path = REPO_ROOT / example
        if target_path.exists() and example_path.exists():
            shutil.copy2(example_path, target_path)
            print(f"  REPLACED: {target} -> {example}")
            changes += 1
        elif target_path.exists() and not example_path.exists():
            target_path.unlink()
            print(f"  DELETED: {target} (no .example to replace with)")
            changes += 1

    # 3. Scrub hardcoded secrets in source files
    src_dirs = [
        REPO_ROOT / "src",
        REPO_ROOT / "web",
        REPO_ROOT / "frontend",
        REPO_ROOT / "scripts",
    ]
    for src_dir in src_dirs:
        if not src_dir.is_dir():
            continue
        for fpath in src_dir.rglob("*.py"):
            if scrub_file(fpath):
                changes += 1
        for fpath in src_dir.rglob("*.js"):
            if scrub_file(fpath):
                changes += 1
        for fpath in src_dir.rglob("*.ts"):
            if scrub_file(fpath):
                changes += 1
        for fpath in src_dir.rglob("*.tsx"):
            if scrub_file(fpath):
                changes += 1

    # 4. Also check root-level configs
    for fpath in REPO_ROOT.glob("*.yaml"):
        if scrub_file(fpath):
            changes += 1
    for fpath in REPO_ROOT.glob("*.yml"):
        if scrub_file(fpath):
            changes += 1
    for fpath in REPO_ROOT.glob("*.json"):
        if scrub_file(fpath):
            changes += 1

    print(f"\n=== Done: {changes} changes made ===")


if __name__ == "__main__":
    main()
