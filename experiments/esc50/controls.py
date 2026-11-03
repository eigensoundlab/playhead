# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Negative controls for the ESC-50 test: can it be fooled by extra columns?

    python3 experiments/esc50/controls.py features.csv ESC-50/meta/esc50.csv --extra librosa_features.csv [--seeds 3] [--out controls.json]

A test that reports a gain for any added features would say nothing about the descriptors. Three controls:
    random     as many Gaussian noise columns as there are descriptors
    shuffled   the real descriptor values, with clips shuffled within each fold, so every column keeps its
               distribution but loses its link to the sound (same count, same marginals, no information)
    loudness   the descriptor count filled with copies of loudness statistics plus small noise (redundant information)
Each is added to the librosa set and compared with the real descriptors, random forest, official folds, McNemar.
"""
import csv, json, sys, os
import numpy as np
from scipy.stats import binomtest
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
meta = {r["filename"]: r for r in csv.DictReader(open(sys.argv[2]))}
rows = {os.path.basename(r["file"]): r for r in csv.DictReader(open(sys.argv[1])) if os.path.basename(r["file"]) in meta}
extra = {os.path.basename(r["file"]): r for r in csv.DictReader(open(arg("--extra")))}
keys = sorted(k for k in rows if k in extra)
merged = {k: {**rows[k], **extra[k]} for k in keys}
cols = [c for c in merged[keys[0]] if c not in ("file", "cls")]
X = np.array([[float(merged[k][c]) if merged[k][c] != "" else np.nan for c in cols] for k in keys])
y = np.array([int(meta[k]["target"]) for k in keys]); fold = np.array([int(meta[k]["fold"]) for k in keys])
idx = lambda p: [i for i, c in enumerate(cols) if c.startswith(p)]
L, C, LOUD = idx("lb_"), idx("nd_"), [cols.index(c) for c in ("pa_lufs", "pa_lra", "pa_loud_mean", "pa_loud_p90", "lb_rms_mean", "lb_rms_std")]

def cv(Z):
    pred = np.zeros_like(y)
    for f in sorted(set(fold)):
        tr, te = fold != f, fold == f
        m = make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(n_estimators=500, random_state=0, n_jobs=2)).fit(Z[tr], y[tr])
        pred[te] = m.predict(Z[te])
    return pred
acc = lambda p: float((p == y).mean())
def mcnemar(p0, p1):
    a, b = int(((p0 == y) & (p1 != y)).sum()), int(((p0 != y) & (p1 == y)).sum())
    return {"only_base_right": a, "only_new_right": b, "p": float(binomtest(min(a, b), a + b, 0.5).pvalue) if a + b else 1.0}

base = cv(X[:, L]); real = cv(X[:, L + C])
out = {"librosa": acc(base), "librosa+descriptors": acc(real), "real_vs_base": mcnemar(base, real), "controls": {}}
print(f"librosa {100 * acc(base):.1f} %   + descriptors {100 * acc(real):.1f} %", flush=True)
for s in range(int(arg("--seeds", 3))):
    rng = np.random.default_rng(100 + s)
    D = X[:, C]
    shuf = D.copy()
    for f in sorted(set(fold)):  # shuffle within each fold so train and test keep their own clips' value sets
        ix = np.where(fold == f)[0]; shuf[ix] = D[rng.permutation(ix)]
    loud = X[:, LOUD][:, rng.integers(0, len(LOUD), len(C))]
    loud = loud + 0.01 * np.nanstd(loud, axis=0) * rng.standard_normal(loud.shape)
    for name, Z in (("random", rng.standard_normal((len(y), len(C)))), ("shuffled", shuf), ("loudness", loud)):
        p = cv(np.hstack([X[:, L], Z]))
        r = {"acc": acc(p), "vs_base": mcnemar(base, p), "vs_real": mcnemar(p, real)}
        out["controls"].setdefault(name, []).append(r)
        print(f"seed {s} librosa + {name:8s} {100 * r['acc']:.1f} %   vs librosa p = {r['vs_base']['p']:.2g}   real descriptors better, p = {r['vs_real']['p']:.2g}", flush=True)
json.dump(out, open(arg("--out", "controls.json"), "w"), indent=1)
print("wrote", arg("--out", "controls.json"))
