from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _meaningful_requirement_lines(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def test_python_dependency_builds_use_lock_files() -> None:
    assert (ROOT / "requirements.lock").is_file()
    assert (ROOT / "requirements-dev.lock").is_file()

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY requirements.lock ." in dockerfile
    assert "pip install --prefer-binary --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock" in dockerfile
    assert "pip install --prefer-binary -r requirements.txt" not in dockerfile

    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.lock -r requirements-dev.lock" in ci
    assert "pip install -r requirements.txt -r requirements-dev.txt" not in ci


def test_requirement_input_files_keep_upper_bounds() -> None:
    for path in (ROOT / "requirements.txt", ROOT / "requirements-dev.txt"):
        for line in _meaningful_requirement_lines(path):
            assert "<" in line, f"{path.name} entry lacks an upper bound: {line}"


def test_frontend_runtime_env_files_are_not_tracked_or_in_docker_context() -> None:
    if shutil.which("git") is None or not (ROOT / ".git").exists():
        pytest.skip("git metadata is required for tracking policy checks")

    tracked = subprocess.run(
        [
            "git",
            "ls-files",
            "--",
            "frontend/.env.local",
            "frontend/.env.production",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert tracked.stdout.strip() == ""

    frontend_gitignore = (ROOT / "frontend" / ".gitignore").read_text(
        encoding="utf-8"
    )
    assert ".env.local" in frontend_gitignore
    assert ".env.production" in frontend_gitignore

    frontend_dockerignore = (ROOT / "frontend" / ".dockerignore").read_text(
        encoding="utf-8"
    )
    assert ".env" in frontend_dockerignore
    assert ".env.*" in frontend_dockerignore
    assert "!.env.example" in frontend_dockerignore
