from __future__ import annotations

import os
from datetime import datetime as _dt
from datetime import timedelta as _td


class DebAnalysisService:
    """DEB analytics adapter with lazy imports to trim cold startup."""

    def __init__(self, project_root: str):
        self.project_root = project_root
        self.history_file = os.path.join(project_root, "data", "daily_records.json")

    @staticmethod
    def _load_aliases() -> dict[str, str]:
        from src.data_collection.city_registry import ALIASES

        return ALIASES

    @staticmethod
    def _load_deb_module_api():
        from src.analysis.deb_algorithm import (
            _is_excluded_model_name,
            load_history,
            reconcile_recent_actual_highs,
        )

        return _is_excluded_model_name, load_history, reconcile_recent_actual_highs

    def resolve_city(self, city_input: str) -> str:
        aliases = self._load_aliases()
        city_input_norm = city_input.strip().lower()
        return aliases.get(city_input_norm, city_input_norm)

    # Backward-compatible alias used by older service wrappers.
    def resolve_deb_city(self, city_input: str) -> str:
        return self.resolve_city(city_input)

    def has_history(self, city_name: str) -> bool:
        _is_excluded_model_name, load_history, reconcile_recent_actual_highs = (
            self._load_deb_module_api()
        )
        del _is_excluded_model_name, reconcile_recent_actual_highs
        data = load_history(self.history_file)
        city_data = data.get(city_name)
        return isinstance(city_data, dict) and bool(city_data)

    # Backward-compatible alias used by older service wrappers.
    def has_deb_history(self, city_name: str) -> bool:
        return self.has_history(city_name)

    def build_deb_accuracy_report(self, city_name: str, deb_query_cost: int) -> str:
        _is_excluded_model_name, load_history, reconcile_recent_actual_highs = (
            self._load_deb_module_api()
        )
        data = load_history(self.history_file)
        if city_name not in data or not data[city_name]:
            raise ValueError(f"暂无 {city_name} 的历史数据。")

        reconcile_info = reconcile_recent_actual_highs(city_name, lookback_days=7)
        data = load_history(self.history_file)
        city_data = data[city_name]
        today = _dt.now().date()
        today_str = today.strftime("%Y-%m-%d")
        cutoff_date = today - _td(days=6)

        recent_items = []
        for date_str, record in city_data.items():
            try:
                row_date = _dt.strptime(date_str, "%Y-%m-%d").date()
            except Exception:
                continue
            if row_date >= cutoff_date:
                recent_items.append((date_str, record, row_date))

        recent_items.sort(key=lambda item: item[0])

        lines = [
            f"📊 <b>DEB 准确率报告 - {city_name.title()}</b>",
            "",
            "📅 <b>近日记录：</b>",
        ]
        if (
            isinstance(reconcile_info, dict)
            and reconcile_info.get("ok")
            and int(reconcile_info.get("updated") or 0) > 0
        ):
            lines.extend(
                [
                    f"🔁 已用 METAR 历史回填修正 {int(reconcile_info.get('updated'))} 天实测最高温",
                    "",
                ]
            )
        total_days = 0
        hits = 0
        deb_errors = []
        signed_errors = []
        model_errors: dict[str, list[float]] = {}

        for date_str, record, _row_date in recent_items:
            actual = record.get("actual_high")
            deb_pred = record.get("deb_prediction")
            forecasts = record.get("forecasts", {}) or {}

            if actual is None:
                continue

            try:
                actual = float(actual)
                if deb_pred is not None:
                    deb_pred = float(deb_pred)
            except Exception:
                continue

            if deb_pred is None and forecasts:
                valid_preds = [
                    float(v)
                    for k, v in forecasts.items()
                    if v is not None and not _is_excluded_model_name(k)
                ]
                if valid_preds:
                    deb_pred = round(sum(valid_preds) / len(valid_preds), 1)

            actual_wu = round(actual)

            if date_str == today_str:
                lines.append(f"  {date_str}: 📍 今天进行中 (实测暂 {actual:.1f})")
            elif deb_pred is not None:
                total_days += 1
                deb_wu = round(deb_pred)
                hit = deb_wu == actual_wu
                if hit:
                    hits += 1
                err = deb_pred - actual
                deb_errors.append(abs(err))
                signed_errors.append(err)

                if hit:
                    result_icon = "✅"
                    err_text = f"偏差{abs(err):.1f}°"
                elif err < 0:
                    result_icon = "❌"
                    err_text = f"低估{abs(err):.1f}°"
                else:
                    result_icon = "❌"
                    err_text = f"高估{abs(err):.1f}°"

                retro = "≈" if "deb_prediction" not in record else ""
                lines.append(
                    f"  {date_str}: DEB {retro}{deb_pred:.1f}→{deb_wu} vs 实测 {actual:.1f}→{actual_wu} "
                    f"{result_icon} {err_text}"
                )

            if date_str != today_str and actual is not None:
                for model, pred in forecasts.items():
                    if _is_excluded_model_name(model):
                        continue
                    if pred is None:
                        continue
                    try:
                        model_errors.setdefault(model, []).append(abs(float(pred) - actual))
                    except Exception:
                        continue

        if total_days > 0:
            hit_rate = hits / total_days * 100
            deb_mae = sum(deb_errors) / len(deb_errors)
            lines.append("")
            lines.append(
                f"🏁 <b>DEB 总战绩：</b>WU命中 {hits}/{total_days} (<b>{hit_rate:.0f}%</b>) | MAE: {deb_mae:.1f}°"
            )

            if model_errors:
                lines.append("")
                lines.append("📈 <b>模型 MAE 对比：</b>")
                model_maes = {m: sum(e) / len(e) for m, e in model_errors.items() if e}
                sorted_models = sorted(model_maes.items(), key=lambda item: item[1])
                for model, mae in sorted_models:
                    tag = " ⭐" if mae <= deb_mae else ""
                    lines.append(f"  {model}: {mae:.1f}°{tag}")
                lines.append(f"  <b>DEB融合: {deb_mae:.1f}°</b>")

            mean_bias = sum(signed_errors) / len(signed_errors)
            underest = sum(1 for e in signed_errors if e < -0.3)
            overest = sum(1 for e in signed_errors if e > 0.3)
            accurate = total_days - underest - overest

            lines.append("")
            lines.append("🔍 <b>偏差分析：</b>")
            if abs(mean_bias) > 0.3:
                bias_label = "系统性低估" if mean_bias < 0 else "系统性高估"
                lines.append(f"  ⚠️ {bias_label}：平均偏差 {mean_bias:+.1f}°")
            else:
                lines.append(f"  ✅ 整体无明显系统偏差：平均偏差 {mean_bias:+.1f}°")
            lines.append(f"  (低估 {underest} 次 | 高估 {overest} 次 | 准确 {accurate} 次)")

            lines.append("")
            lines.append("💡 <b>建议：</b>")
            if underest > overest and abs(mean_bias) > 0.5:
                lines.append(
                    f"  该城市模型集体低估趋势明显（{mean_bias:+.1f}°），实际最高温可能比 DEB 融合值高 "
                    f"{abs(mean_bias):.0f}-{abs(mean_bias) + 0.5:.0f}°。交易时建议适当看高。"
                )
            elif overest > underest and abs(mean_bias) > 0.5:
                lines.append(
                    f"  该城市模型集体高估趋势明显（{mean_bias:+.1f}°），实际最高温可能低于 DEB 融合值。交易时注意追高风险。"
                )
            elif deb_mae > 1.5:
                lines.append(
                    f"  近期模型波动较大（MAE {deb_mae:.1f}°），建议降低对单一日预测的信任度。"
                )
            elif hit_rate >= 60:
                lines.append("  DEB 近期表现稳定，可继续作为主要参考。")
            else:
                lines.append("  近期准确率一般，建议结合主站实测与周边站点共同判断。")

            lines.append("")
            lines.append("📝 MAE = 平均绝对误差，越小越准。⭐ = 优于 DEB 融合。")
            lines.append("📅 统计窗口：近7天滚动样本。")
        else:
            lines.append("")
            lines.append("🔔 近 7 天尚无完整的 DEB 预测记录。")

        lines.append("")
        lines.append(f"💸 本次消耗 <code>{deb_query_cost}</code> 积分。")
        return "\n".join(lines)
