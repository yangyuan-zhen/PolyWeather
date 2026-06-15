"""PyTorch learnable attention ensemble for DEB.

Tiny MLP (~5K params) that learns per-city model weighting from
cross-city training data.  Trains in seconds on CPU, <1ms inference.

Usage:
  python -m src.analysis.deb_attention --train
  python -m src.analysis.deb_attention --eval
"""

from __future__ import annotations

import math
import os
import random

import torch
import torch.nn as nn
import torch.nn.functional as F


def _load_training_data(history, min_models=3):
    samples = []
    for city, days in (history or {}).items():
        for date_str, record in days.items():
            forecasts = record.get("forecasts", {})
            actual = record.get("actual_high")
            if actual is None:
                continue
            valid = {m: float(v) for m, v in forecasts.items() if v is not None}
            if len(valid) < min_models:
                continue
            samples.append({"city": city, "forecasts": valid, "actual": float(actual), "date": date_str})
    return samples


def _build_vocabs(samples, min_model_freq=2):
    from collections import Counter
    mf = Counter[str]()
    cities = set()
    for s in samples:
        cities.add(s["city"])
        for m in s["forecasts"]:
            mf[m] += 1
    mv = {m: i for i, m in enumerate(sorted([m for m, c in mf.items() if c >= min_model_freq], key=lambda m: (-mf[m], m)))}
    cv = {c: i for i, c in enumerate(sorted(cities))}
    return mv, cv


class DebAttention(nn.Module):
    """Learnable attention: per-model scorer + city bias correction.

    Input:  per-model forecast values + city id
    Output: weighted prediction (learned attention weights) + city bias
    """

    def __init__(self, n_models, n_cities, d_hidden=32, dropout=0.1):
        super().__init__()
        self.n_models = n_models
        self.n_cities = n_cities
        # City embedding for context
        self.city_emb = nn.Embedding(n_cities + 1, 16, padding_idx=0)
        # Per-model scorer: [fc_norm, city_emb] → attention score
        self.scorer = nn.Sequential(
            nn.Linear(3 + 16, d_hidden), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(d_hidden, d_hidden // 2), nn.GELU(),
            nn.Linear(d_hidden // 2, 1),
        )
        # City-level bias
        self.city_bias = nn.Embedding(n_cities + 1, 1, padding_idx=0)
        self.register_buffer("fc_mean", torch.tensor(0.0))
        self.register_buffer("fc_std", torch.tensor(10.0))

    def forward(self, forecasts, city_idx, mask):
        """(B, M), (B,), (B, M) → (B,), (B, M)"""
        batch, max_m = forecasts.shape
        fc_norm = (forecasts - self.fc_mean) / self.fc_std.clamp_min(0.1)

        # Consensus: trimmed mean of valid forecasts
        fc_masked = forecasts * mask.float()
        n_valid = mask.sum(dim=1, keepdim=True).clamp_min(1)
        consensus = fc_masked.sum(dim=1) / n_valid.squeeze()  # (B,)

        # Deviation from consensus
        dev = fc_norm - consensus.unsqueeze(1) * mask.float() / self.fc_std.clamp_min(0.1)

        # Feature: [fc_norm, dev_from_consensus, is_extreme]
        is_extreme = (dev.abs() > 1.5).float()  # flag if >1.5 std away
        feats = torch.stack([fc_norm, dev, is_extreme], dim=-1)  # (B, M, 3)

        city = self.city_emb(city_idx.clamp(0, self.n_cities))  # (B, 16)
        city_tiled = city.unsqueeze(1).expand(-1, max_m, -1)  # (B, M, 16)
        feats = torch.cat([feats, city_tiled], dim=-1)  # (B, M, 19)

        scores = self.scorer(feats).squeeze(-1)  # (B, M)
        scores = scores.masked_fill(~mask, float("-inf"))
        attn = F.softmax(scores, dim=-1)
        pred = (forecasts * attn).sum(dim=-1)
        bias = self.city_bias(city_idx.clamp(0, self.n_cities)).squeeze(-1)
        pred = pred + bias * 0.3
        return pred, attn


def train_model(history, *, epochs=200, batch_size=128, lr=0.002, patience=30, checkpoint_dir="data", seed=42):
    torch.manual_seed(seed)
    random.seed(seed)

    samples = _load_training_data(history)
    if len(samples) < 50:
        raise ValueError(f"Need >=50 samples, got {len(samples)}")
    mv, cv = _build_vocabs(samples)
    max_models = len(mv) + 4

    samples.sort(key=lambda s: s["date"])
    split = int(len(samples) * 0.8)
    train_s = samples[:split]
    val_s = samples[split:]

    all_fc = [v for s in train_s for v in s["forecasts"].values()]
    fc_mean = sum(all_fc) / len(all_fc)
    fc_std = max(1.0, math.sqrt(sum((v - fc_mean) ** 2 for v in all_fc) / len(all_fc)))

    def precompute(s_list):
        X_fc, X_cid, X_mask, Y = [], [], [], []
        for s in s_list:
            fc_list = [s["forecasts"][m] for m in sorted(s["forecasts"]) if m in mv]
            n = len(fc_list)
            X_fc.append(fc_list + [0.0] * (max_models - n))
            X_cid.append(cv.get(s["city"], 0))
            X_mask.append([1.0] * n + [0.0] * (max_models - n))
            Y.append(s["actual"])
        return (
            torch.tensor(X_fc, dtype=torch.float32),
            torch.tensor(X_cid, dtype=torch.long),
            torch.tensor(X_mask, dtype=torch.bool),
            torch.tensor(Y, dtype=torch.float32),
        )

    train_X = precompute(train_s)
    val_X = precompute(val_s)
    train_loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(*train_X), batch_size=batch_size, shuffle=True)
    val_loader = torch.utils.data.DataLoader(torch.utils.data.TensorDataset(*val_X), batch_size=batch_size * 2, shuffle=False)

    model = DebAttention(max_models, len(cv) + 1)
    model.fc_mean.fill_(fc_mean)
    model.fc_std.fill_(fc_std)

    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", factor=0.5, patience=10)

    best_val = float("inf")
    best_state = None
    no_imp = 0

    print(f"Training: {len(train_s)} train, {len(val_s)} val, models={len(mv)}, cities={len(cv)}")

    for epoch in range(epochs):
        model.train()
        tr_loss = 0.0
        for fc, cid, mask, y in train_loader:
            pred, _ = model(fc, cid, mask)
            loss = F.mse_loss(pred, y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            tr_loss += loss.item() * fc.size(0)
        tr_loss /= len(train_X[0])

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for fc, cid, mask, y in val_loader:
                pred, _ = model(fc, cid, mask)
                loss = F.mse_loss(pred, y)
                val_loss += loss.item() * fc.size(0)
        val_loss /= len(val_X[0])

        sched.step(val_loss)
        if val_loss < best_val:
            best_val = val_loss
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            no_imp = 0
        else:
            no_imp += 1

        if epoch % 20 == 0 or epoch == epochs - 1:
            print(f"  epoch {epoch:3d}  tr={math.sqrt(tr_loss):.3f}  val={math.sqrt(val_loss):.3f}  lr={opt.param_groups[0]['lr']:.1e}")

        if no_imp >= patience:
            print(f"  early stop {epoch}")
            break

    if best_state:
        model.load_state_dict(best_state)

    os.makedirs(checkpoint_dir, exist_ok=True)
    ckpt = os.path.join(checkpoint_dir, "deb_attention.pt")
    torch.save({"state": model.state_dict(), "mv": mv, "cv": cv, "fc_mean": fc_mean, "fc_std": fc_std, "max_m": max_models}, ckpt)
    print(f"  saved {ckpt}")
    return model, mv, cv


def load_model(path):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model = DebAttention(ckpt["max_m"], len(ckpt["cv"]) + 1)
    model.load_state_dict(ckpt["state"])
    model.fc_mean.fill_(ckpt["fc_mean"])
    model.fc_std.fill_(ckpt["fc_std"])
    model.eval()
    return model, ckpt["mv"], ckpt["cv"]


def predict(model, forecasts, city, mv, cv):
    model.eval()
    fc_list = [forecasts[m] for m in sorted(forecasts) if m in mv]
    if not fc_list:
        return None, {}
    n = len(fc_list)
    max_m = model.n_models
    fc_t = torch.zeros(max_m)
    mask_t = torch.zeros(max_m, dtype=torch.bool)
    fc_t[:n] = torch.tensor(fc_list)
    mask_t[:n] = True
    cid = cv.get(city, 0)
    with torch.no_grad():
        pred, attn = model(fc_t.unsqueeze(0), torch.tensor([cid]), mask_t.unsqueeze(0))
    pred = round(pred.item(), 1)
    models = [m for m in sorted(forecasts) if m in mv]
    weights = {models[i]: attn[0, i].item() for i in range(n)}
    total = sum(weights.values())
    if total > 0:
        weights = {m: w / total for m, w in weights.items()}
    return pred, weights


if __name__ == "__main__":
    import sys
    import statistics
    from src.analysis.deb_algorithm import load_history as lh, calculate_dynamic_weights
    from src.data_collection.city_registry import CITY_REGISTRY

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    hp = os.path.join(root, "data", "daily_records.json")
    history = lh(hp)

    if "--train" in sys.argv:
        m, mv, cv = train_model(history)
        print("Done.")

    elif "--eval" in sys.argv:
        ckpt = os.path.join(root, "data", "deb_attention.pt")
        if not os.path.exists(ckpt):
            print("No checkpoint. Run --train first.")
            sys.exit(1)
        m, mv, cv = load_model(ckpt)
        base: list = []
        attn_errs: list = []
        for city in [c for c in CITY_REGISTRY if c in history]:
            cd = history.get(city, {})
            for d in sorted(cd.keys(), reverse=True)[:5]:
                rec = cd[d]
                fc = rec.get("forecasts", {})
                actual = rec.get("actual_high")
                if not fc or actual is None:
                    continue
                try:
                    bp, _ = calculate_dynamic_weights(city, fc)
                    if bp:
                        base.append(abs(bp - float(actual)))
                except Exception:
                    pass
                try:
                    ap, _ = predict(m, fc, city, mv, cv)
                    if ap:
                        attn_errs.append(abs(ap - float(actual)))
                except Exception:
                    pass
        if base and attn_errs:
            print(f"Baseline MAE: {statistics.mean(base):.3f}")
            print(f"Attention MAE: {statistics.mean(attn_errs):.3f}")
    else:
        print("python -m src.analysis.deb_attention --train | --eval")
