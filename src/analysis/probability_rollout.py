from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional


def _load_json_file(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _sf(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _append_reason(reasons: List[str], condition: bool, message: str) -> None:
    if condition:
        reasons.append(message)


def _top_shadow_regressions(by_city: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for city, metrics in (by_city or {}).items():
        if not isinstance(metrics, dict):
            continue
        rows.append(
            {
                "city": city,
                "samples": int(metrics.get("samples") or 0),
                "delta_mae": _sf(metrics.get("delta_mae")),
                "delta_bucket_hit_rate": _sf(metrics.get("delta_bucket_hit_rate")),
                "delta_bucket_brier": _sf(metrics.get("delta_bucket_brier")),
            }
        )

    rows.sort(
        key=lambda row: (
            -(row["delta_bucket_brier"] or 0.0),
            row["delta_bucket_hit_rate"] or 0.0,
            -(row["delta_mae"] or 0.0),
        )
    )
    return rows[:limit]


def judge_probability_rollout(
    evaluation_report: Dict[str, Any],
    shadow_report: Dict[str, Any],
) -> Dict[str, Any]:
    thresholds = {
        "evaluation_min_samples": 80,
        "shadow_min_samples": 50,
        "max_delta_mae": 0.05,
        "min_delta_crps": -0.02,
        "min_delta_bucket_hit_rate": 0.0,
        "max_delta_bucket_brier_promote": 0.02,
        "max_delta_bucket_brier_observe": 0.15,
    }

    eval_summary = (evaluation_report or {}).get("summary") or {}
    eval_delta = eval_summary.get("delta") or {}
    shadow_summary = (shadow_report or {}).get("summary") or {}

    eval_samples = int(eval_summary.get("sample_count") or 0)
    shadow_samples = int(shadow_summary.get("samples") or 0)
    delta_crps = _sf(eval_delta.get("crps"))
    delta_mae = _sf(eval_delta.get("mae"))
    delta_hit = _sf(eval_delta.get("bucket_hit_rate"))
    shadow_delta_mae = _sf(shadow_summary.get("delta_mae"))
    shadow_delta_hit = _sf(shadow_summary.get("delta_bucket_hit_rate"))
    shadow_delta_brier = _sf(shadow_summary.get("delta_bucket_brier"))

    promote_reasons: List[str] = []
    _append_reason(
        promote_reasons,
        eval_samples < thresholds["evaluation_min_samples"],
        f"离线评估样本不足：{eval_samples} < {thresholds['evaluation_min_samples']}",
    )
    _append_reason(
        promote_reasons,
        shadow_samples < thresholds["shadow_min_samples"],
        f"shadow 样本不足：{shadow_samples} < {thresholds['shadow_min_samples']}",
    )
    _append_reason(
        promote_reasons,
        delta_crps is None or delta_crps > thresholds["min_delta_crps"],
        f"离线 CRPS 改善不足：delta={delta_crps}",
    )
    _append_reason(
        promote_reasons,
        delta_mae is None or delta_mae > thresholds["max_delta_mae"],
        f"离线 MAE 退化超限：delta={delta_mae}",
    )
    _append_reason(
        promote_reasons,
        delta_hit is None or delta_hit < thresholds["min_delta_bucket_hit_rate"],
        f"离线 bucket 命中率下降：delta={delta_hit}",
    )
    _append_reason(
        promote_reasons,
        shadow_delta_mae is None or shadow_delta_mae > thresholds["max_delta_mae"],
        f"shadow MAE 退化超限：delta={shadow_delta_mae}",
    )
    _append_reason(
        promote_reasons,
        shadow_delta_hit is None or shadow_delta_hit < thresholds["min_delta_bucket_hit_rate"],
        f"shadow bucket 命中率下降：delta={shadow_delta_hit}",
    )
    _append_reason(
        promote_reasons,
        shadow_delta_brier is None
        or shadow_delta_brier > thresholds["max_delta_bucket_brier_promote"],
        f"shadow bucket brier 退化超限：delta={shadow_delta_brier}",
    )

    if not promote_reasons:
        decision = "promote"
        summary = "离线与 shadow 指标均达标，可以考虑切换 emos_primary。"
    else:
        observe_reasons: List[str] = []
        _append_reason(
            observe_reasons,
            eval_samples < thresholds["evaluation_min_samples"],
            f"离线评估样本不足：{eval_samples}",
        )
        _append_reason(
            observe_reasons,
            delta_crps is None or delta_crps > thresholds["min_delta_crps"],
            f"离线 CRPS 改善不足：delta={delta_crps}",
        )
        _append_reason(
            observe_reasons,
            delta_mae is None or delta_mae > thresholds["max_delta_mae"],
            f"离线 MAE 退化超限：delta={delta_mae}",
        )
        _append_reason(
            observe_reasons,
            delta_hit is None or delta_hit < thresholds["min_delta_bucket_hit_rate"],
            f"离线 bucket 命中率下降：delta={delta_hit}",
        )
        _append_reason(
            observe_reasons,
            shadow_samples < thresholds["shadow_min_samples"],
            f"shadow 样本不足：{shadow_samples}",
        )
        _append_reason(
            observe_reasons,
            shadow_delta_mae is None or shadow_delta_mae > thresholds["max_delta_mae"],
            f"shadow MAE 退化超限：delta={shadow_delta_mae}",
        )
        _append_reason(
            observe_reasons,
            shadow_delta_hit is None or shadow_delta_hit < thresholds["min_delta_bucket_hit_rate"],
            f"shadow bucket 命中率下降：delta={shadow_delta_hit}",
        )
        _append_reason(
            observe_reasons,
            shadow_delta_brier is None
            or shadow_delta_brier > thresholds["max_delta_bucket_brier_observe"],
            f"shadow bucket brier 退化偏大：delta={shadow_delta_brier}",
        )

        if not observe_reasons:
            decision = "observe"
            summary = "离线评估达标，但 shadow 仍需继续观察，暂不切主路径。"
        else:
            decision = "hold"
            summary = "当前指标不足以切换 emos_primary，应继续保持 shadow。"

    return {
        "decision": decision,
        "ready_for_primary": decision == "promote",
        "summary": summary,
        "thresholds": thresholds,
        "evaluation": {
            "sample_count": eval_samples,
            "delta_crps": delta_crps,
            "delta_mae": delta_mae,
            "delta_bucket_hit_rate": delta_hit,
        },
        "shadow": {
            "sample_count": shadow_samples,
            "delta_mae": shadow_delta_mae,
            "delta_bucket_hit_rate": shadow_delta_hit,
            "delta_bucket_brier": shadow_delta_brier,
        },
        "blocking_reasons": promote_reasons,
        "worst_shadow_regressions": _top_shadow_regressions(
            (shadow_report or {}).get("by_city") or {}
        ),
    }


def build_rollout_report(
    evaluation_report_path: str,
    shadow_report_path: str,
) -> Dict[str, Any]:
    evaluation_report = _load_json_file(evaluation_report_path)
    shadow_report = _load_json_file(shadow_report_path)
    decision = judge_probability_rollout(evaluation_report, shadow_report)
    return {
        "evaluation_report_path": evaluation_report_path,
        "shadow_report_path": shadow_report_path,
        "evaluation_report_exists": os.path.exists(evaluation_report_path),
        "shadow_report_exists": os.path.exists(shadow_report_path),
        "decision": decision,
    }
