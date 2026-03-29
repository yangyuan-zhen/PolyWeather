from __future__ import annotations

import os
import threading
from typing import Dict, List

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


DEFAULT_MODEL_ID = "google/timesfm-2.5-200m-pytorch"


class SeriesPoint(BaseModel):
    timestamp: str
    value: float


class DailyPredictRequest(BaseModel):
    city: str
    series_frequency: str = Field(default="D")
    series_kind: str = Field(default="actual_high")
    series: List[SeriesPoint]
    future_dates: List[str]
    daily_model_forecasts: Dict[str, Dict[str, float]] = Field(default_factory=dict)


class TimesFMPredictor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._model_id = (
            str(os.getenv("TIMESFM_MODEL_ID", DEFAULT_MODEL_ID)).strip()
            or DEFAULT_MODEL_ID
        )
        self._max_context = int(os.getenv("TIMESFM_MAX_CONTEXT", "1024"))
        self._max_horizon = int(os.getenv("TIMESFM_MAX_HORIZON", "7"))
        self._normalize_inputs = str(
            os.getenv("TIMESFM_NORMALIZE_INPUTS", "true")
        ).strip().lower() in {"1", "true", "yes", "on"}
        self._use_quantile_head = str(
            os.getenv("TIMESFM_USE_QUANTILE_HEAD", "true")
        ).strip().lower() in {"1", "true", "yes", "on"}
        self._force_flip_invariance = str(
            os.getenv("TIMESFM_FORCE_FLIP_INVARIANCE", "true")
        ).strip().lower() in {"1", "true", "yes", "on"}
        self._infer_is_positive = str(
            os.getenv("TIMESFM_INFER_IS_POSITIVE", "false")
        ).strip().lower() in {"1", "true", "yes", "on"}
        self._fix_quantile_crossing = str(
            os.getenv("TIMESFM_FIX_QUANTILE_CROSSING", "true")
        ).strip().lower() in {"1", "true", "yes", "on"}

    @property
    def model_id(self) -> str:
        return self._model_id

    def is_loaded(self) -> bool:
        return self._model is not None

    def _ensure_loaded(self):
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model

            import torch
            import timesfm

            model_type = getattr(timesfm, "TimesFM_2p5_200M_torch", None)
            forecast_config_type = getattr(timesfm, "ForecastConfig", None)
            if model_type is None or forecast_config_type is None:
                raise RuntimeError("Unsupported official timesfm package layout.")

            torch.set_float32_matmul_precision("high")
            model = model_type.from_pretrained(self._model_id)
            model.compile(
                forecast_config_type(
                    max_context=self._max_context,
                    max_horizon=self._max_horizon,
                    normalize_inputs=self._normalize_inputs,
                    use_continuous_quantile_head=self._use_quantile_head,
                    force_flip_invariance=self._force_flip_invariance,
                    infer_is_positive=self._infer_is_positive,
                    fix_quantile_crossing=self._fix_quantile_crossing,
                )
            )
            self._model = model
            return self._model

    def predict_daily(self, series: List[float], future_dates: List[str]) -> Dict[str, object]:
        model = self._ensure_loaded()
        horizon = len(future_dates)
        if horizon <= 0:
            raise ValueError("future_dates must not be empty")
        if horizon > self._max_horizon:
            raise ValueError(
                "future_dates exceeds configured max horizon: "
                f"{horizon} > {self._max_horizon}"
            )
        if len(series) < 8:
            raise ValueError("series must contain at least 8 points")

        point_forecast, quantile_forecast = model.forecast(
            horizon=horizon,
            inputs=[np.asarray(series, dtype=np.float32)],
        )

        point_row = point_forecast[0]
        predictions: Dict[str, float] = {}
        for index, date_str in enumerate(future_dates):
            if index >= len(point_row):
                break
            predictions[date_str] = round(float(point_row[index]), 1)

        quantiles: Dict[str, Dict[str, float]] = {}
        try:
            if quantile_forecast is not None:
                q_arr = np.asarray(quantile_forecast)
                if (
                    q_arr.ndim == 3
                    and q_arr.shape[0] > 0
                    and q_arr.shape[1] >= horizon
                    and q_arr.shape[2] >= 10
                ):
                    for index, date_str in enumerate(future_dates):
                        quantiles[date_str] = {
                            "mean": round(float(q_arr[0, index, 0]), 1),
                            "p10": round(float(q_arr[0, index, 1]), 1),
                            "p50": round(float(q_arr[0, index, 5]), 1),
                            "p90": round(float(q_arr[0, index, 9]), 1),
                        }
        except Exception:
            quantiles = {}

        return {
            "predictions": predictions,
            "quantiles": quantiles,
        }


predictor = TimesFMPredictor()
app = FastAPI(title="PolyWeather TimesFM Service", version="0.1.0")


@app.get("/health")
def health() -> Dict[str, object]:
    return {
        "ok": True,
        "model_loaded": predictor.is_loaded(),
        "model_id": predictor.model_id,
    }


@app.post("/predict/daily")
def predict_daily(payload: DailyPredictRequest) -> Dict[str, object]:
    values = [float(point.value) for point in payload.series]
    future_dates = [
        str(date_str or "").strip()
        for date_str in payload.future_dates
        if str(date_str or "").strip()
    ]
    if not future_dates:
        raise HTTPException(status_code=400, detail="future_dates must not be empty")
    if not values:
        raise HTTPException(status_code=400, detail="series must not be empty")

    try:
        result = predictor.predict_daily(values, future_dates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TimesFM inference failed: {exc}")

    return {
        "model": "TimesFM",
        "model_id": predictor.model_id,
        "city": payload.city,
        "series_frequency": payload.series_frequency,
        "series_kind": payload.series_kind,
        "input_points": len(values),
        **result,
    }
