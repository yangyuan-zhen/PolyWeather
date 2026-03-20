from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "VERSION"
CHANGELOG_FILE = ROOT / "CHANGELOG.md"


def parse_version(raw: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", raw.strip())
    if not match:
        raise ValueError(f"Invalid version: {raw!r}")
    return tuple(int(part) for part in match.groups())


def format_version(parts: tuple[int, int, int]) -> str:
    return ".".join(str(part) for part in parts)


def bump(parts: tuple[int, int, int], level: str) -> tuple[int, int, int]:
    major, minor, patch = parts
    if level == "patch":
        return major, minor, patch + 1
    if level == "minor":
        return major, minor + 1, 0
    if level == "major":
        return major + 1, 0, 0
    raise ValueError(f"Unsupported bump level: {level}")


def ensure_changelog_entry(version: str) -> None:
    text = CHANGELOG_FILE.read_text(encoding="utf-8")
    if re.search(rf"^## {re.escape(version)} - ", text, flags=re.MULTILINE):
        return
    heading = f"## {version} - TBD"
    lines = text.splitlines()
    if not lines:
        updated = f"# Changelog\n\n{heading}\n\n- TBD\n"
    else:
        updated = "\n".join([lines[0], "", heading, "", "- TBD", "", *lines[1:]]) + "\n"
    CHANGELOG_FILE.write_text(updated, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/bump_version.py [patch|minor|major|X.Y.Z]")

    current = parse_version(VERSION_FILE.read_text(encoding="utf-8"))
    arg = sys.argv[1].strip()

    if re.fullmatch(r"\d+\.\d+\.\d+", arg):
        new_version = arg
    else:
        new_version = format_version(bump(current, arg))

    VERSION_FILE.write_text(new_version + "\n", encoding="utf-8")
    ensure_changelog_entry(new_version)
    print(f"Bumped version: {format_version(current)} -> {new_version}")
    print("Next step: python scripts/sync_version.py")


if __name__ == "__main__":
    main()
