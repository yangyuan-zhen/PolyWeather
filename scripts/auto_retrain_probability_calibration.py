import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.analysis.probability_calibration import DEFAULT_CALIBRATION_FILE  # noqa: E402


ARTIFACT_DIR = os.path.join(PROJECT_ROOT, "artifacts", "probability_calibration")


def _runtime_calibration_dir() -> str:
    runtime_dir = str(os.getenv("POLYWEATHER_RUNTIME_DATA_DIR") or "").strip()
    if runtime_dir:
        return os.path.join(runtime_dir, "probability_calibration")
    return ARTIFACT_DIR


DEFAULT_CANDIDATE_ROOT = os.path.join(_runtime_calibration_dir(), "candidates")
DEFAULT_DECISION_REPORT = os.path.join(
    _runtime_calibration_dir(),
    "auto_retrain_report.json",
)


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _env_float(name: str, default: float) -> float:
    value = _sf(os.getenv(name))
    return value if value is not None else default


def _env_int(name: str, default: int) -> int:
    value = _sf(os.getenv(name))
    return int(value) if value is not None else default


def _load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: str, payload: Dict[str, Any]) -> None:
    output_dir = os.path.dirname(os.path.abspath(path))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _run_python(args: List[str], *, stream: bool = False) -> Dict[str, Any]:
    command = [sys.executable, *args]
    if stream:
        completed = subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            text=True,
            check=False,
        )
        return {
            "command": command,
            "returncode": completed.returncode,
            "stdout": "",
            "stderr": "",
        }
    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def _append_blocker(blockers: List[str], condition: bool, message: str) -> None:
    if condition:
        blockers.append(message)


def judge_candidate(
    evaluation_report: Dict[str, Any],
    *,
    min_samples: int,
    max_delta_crps: float,
    max_delta_mae: float,
    min_delta_bucket_hit_rate: float,
) -> Dict[str, Any]:
    summary = evaluation_report.get("summary") or {}
    delta = summary.get("delta") or {}
    sample_count = int(summary.get("sample_count") or 0)
    delta_crps = _sf(delta.get("crps"))
    delta_mae = _sf(delta.get("mae"))
    delta_hit = _sf(delta.get("bucket_hit_rate"))

    blockers: List[str] = []
    _append_blocker(
        blockers,
        sample_count < min_samples,
        f"sample_count {sample_count} < {min_samples}",
    )
    _append_blocker(
        blockers,
        delta_crps is None or delta_crps > max_delta_crps,
        f"delta_crps {delta_crps} > {max_delta_crps}",
    )
    _append_blocker(
        blockers,
        delta_mae is None or delta_mae > max_delta_mae,
        f"delta_mae {delta_mae} > {max_delta_mae}",
    )
    _append_blocker(
        blockers,
        delta_hit is None or delta_hit < min_delta_bucket_hit_rate,
        f"delta_bucket_hit_rate {delta_hit} < {min_delta_bucket_hit_rate}",
    )

    return {
        "decision": "promote" if not blockers else "hold",
        "ready_for_promotion": not blockers,
        "blocking_reasons": blockers,
        "thresholds": {
            "min_samples": min_samples,
            "max_delta_crps": max_delta_crps,
            "max_delta_mae": max_delta_mae,
            "min_delta_bucket_hit_rate": min_delta_bucket_hit_rate,
        },
        "metrics": {
            "sample_count": sample_count,
            "delta_crps": delta_crps,
            "delta_mae": delta_mae,
            "delta_bucket_hit_rate": delta_hit,
        },
    }


def _promote(candidate_path: str, target_path: str) -> str:
    target_dir = os.path.dirname(os.path.abspath(target_path))
    if target_dir:
        os.makedirs(target_dir, exist_ok=True)
    backup_path = os.path.join(
        target_dir,
        "default.backup-{ts}.json".format(
            ts=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        ),
    )
    if os.path.exists(target_path):
        shutil.copy2(target_path, backup_path)
    shutil.copy2(candidate_path, target_path)
    return backup_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train an EMOS candidate, evaluate it, and optionally promote it behind gates."
    )
    parser.add_argument("--candidate-root", default=DEFAULT_CANDIDATE_ROOT)
    parser.add_argument("--target", default=DEFAULT_CALIBRATION_FILE)
    parser.add_argument("--decision-output", default=DEFAULT_DECISION_REPORT)
    parser.add_argument(
        "--promote-if-passed",
        action="store_true",
        help="Copy the candidate over the active calibration file only if gates pass.",
    )
    parser.add_argument(
        "--run-tests",
        action="store_true",
        help="Run focused probability tests before promotion.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print child script progress while training and evaluating.",
    )
    parser.add_argument(
        "--snapshot-limit",
        type=int,
        default=_env_int("POLYWEATHER_EMOS_TRAINING_SNAPSHOT_LIMIT", 0),
        help="Optional max number of recent probability snapshots to load from SQLite.",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=_env_int("POLYWEATHER_EMOS_AUTO_MIN_SAMPLES", 50),
    )
    parser.add_argument(
        "--max-delta-crps",
        type=float,
        default=_env_float("POLYWEATHER_EMOS_AUTO_MAX_DELTA_CRPS", 0.0),
        help="Candidate EMOS CRPS may not be worse than legacy by more than this.",
    )
    parser.add_argument(
        "--max-delta-mae",
        type=float,
        default=_env_float("POLYWEATHER_EMOS_AUTO_MAX_DELTA_MAE", 0.05),
    )
    parser.add_argument(
        "--min-delta-bucket-hit-rate",
        type=float,
        default=_env_float("POLYWEATHER_EMOS_AUTO_MIN_DELTA_BUCKET_HIT_RATE", -0.05),
        help="Soft guard only; bucket hit rate is boundary-sensitive.",
    )
    args = parser.parse_args()

    version = "emos-auto-{ts}".format(
        ts=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    )
    candidate_dir = os.path.join(args.candidate_root, version)
    os.makedirs(candidate_dir, exist_ok=True)
    candidate_path = os.path.join(candidate_dir, "default.json")
    evaluation_path = os.path.join(candidate_dir, "evaluation_report.json")
    decision_path = os.path.join(candidate_dir, "decision_report.json")

    fit_args = [
            "scripts/fit_probability_calibration.py",
            "--output",
            candidate_path,
            "--version",
            version,
    ]
    if args.verbose:
        fit_args.append("--verbose")
    if args.snapshot_limit and args.snapshot_limit > 0:
        fit_args.extend(["--snapshot-limit", str(args.snapshot_limit)])
    fit_result = _run_python(
        fit_args,
        stream=args.verbose,
    )
    if fit_result["returncode"] != 0:
        payload = {
            "ok": False,
            "version": version,
            "stage": "fit",
            "fit": fit_result,
        }
        _write_json(decision_path, payload)
        _write_json(args.decision_output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return fit_result["returncode"] or 1

    eval_result = _run_python(
        [
            "scripts/evaluate_probability_calibration.py",
            "--calibration-file",
            candidate_path,
            "--output",
            evaluation_path,
        ],
        stream=args.verbose,
    )
    if eval_result["returncode"] != 0:
        payload = {
            "ok": False,
            "version": version,
            "stage": "evaluate",
            "candidate_path": candidate_path,
            "fit": fit_result,
            "evaluate": eval_result,
        }
        _write_json(decision_path, payload)
        _write_json(args.decision_output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return eval_result["returncode"] or 1

    evaluation_report = _load_json(evaluation_path)
    decision = judge_candidate(
        evaluation_report,
        min_samples=args.min_samples,
        max_delta_crps=args.max_delta_crps,
        max_delta_mae=args.max_delta_mae,
        min_delta_bucket_hit_rate=args.min_delta_bucket_hit_rate,
    )

    test_result = None
    if args.run_tests and decision["ready_for_promotion"]:
        test_result = _run_python(
            [
                "-m",
                "pytest",
                "tests/test_probability_calibration.py",
                "tests/test_probability_rollout.py",
                "tests/test_trend_engine.py",
            ]
        )
        if test_result["returncode"] != 0:
            decision["decision"] = "hold"
            decision["ready_for_promotion"] = False
            decision.setdefault("blocking_reasons", []).append(
                "focused tests failed"
            )

    promoted = False
    backup_path = None
    if args.promote_if_passed and decision["ready_for_promotion"]:
        backup_path = _promote(candidate_path, args.target)
        promoted = True

    payload = {
        "ok": True,
        "version": version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_dir": candidate_dir,
        "candidate_path": candidate_path,
        "evaluation_path": evaluation_path,
        "target_path": args.target,
        "promote_requested": bool(args.promote_if_passed),
        "promoted": promoted,
        "backup_path": backup_path,
        "decision": decision,
        "fit": fit_result,
        "evaluate": eval_result,
        "tests": test_result,
    }
    _write_json(decision_path, payload)
    _write_json(args.decision_output, payload)
    print(json.dumps(payload["decision"], ensure_ascii=False, indent=2))
    print(f"candidate: {candidate_path}")
    print(f"evaluation: {evaluation_path}")
    print(f"decision: {decision_path}")
    if promoted:
        print(f"promoted to {args.target}; backup: {backup_path}")
    elif args.promote_if_passed:
        print("not promoted; gates did not pass")
    else:
        print("not promoted; run with --promote-if-passed to allow gated promotion")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
