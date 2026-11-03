# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Do Playhead's cross-field descriptors add class information beyond standard features?  ESC-50, official 5-fold split.

    python3 experiments/esc50/evaluate.py features.csv path/to/ESC-50/meta/esc50.csv [--extra librosa_features.csv] [--out results.json]

Feature sets (column prefixes from tools/export-features.js and librosa_baseline.py):
    A  mfcc_  MFCC 0-12 mean and standard deviation (the usual minimal baseline)
    L  lb_    librosa hand-crafted set, 130 features (only with --extra)
    B  pa_    Playhead psychoacoustic curves
    C  nd_    cross-field descriptors N1-N9
Classifiers: random forest (500 trees) and standardised logistic regression; medians fill missing values.
Paired McNemar tests on the 2,000 out-of-fold predictions say whether adding C changes accuracy beyond chance.
Drop-one and add-one family tests show which descriptors carry the gain, and per-class F1 which classes gain most.
"""
import csv, json, sys, os
import numpy as np
from scipy.stats import binomtest
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import f1_score

arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
feat_path, meta_path = sys.argv[1], sys.argv[2]
out_path = arg("--out") or "esc50_results.json"
meta = {r["filename"]: r for r in csv.DictReader(open(meta_path))}
rows = {os.path.basename(r["file"]): r for r in csv.DictReader(open(feat_path)) if os.path.basename(r["file"]) in meta}
if arg("--extra"):
    extra = {os.path.basename(r["file"]): r for r in csv.DictReader(open(arg("--extra")))}
    rows = {k: {**v, **extra[k]} for k, v in rows.items() if k in extra}
keys = sorted(rows)
cols = [c for c in rows[keys[0]] if c not in ("file", "cls")]
X = np.array([[float(rows[k][c]) if rows[k][c] != "" else np.nan for c in cols] for k in keys])
y = np.array([int(meta[k]["target"]) for k in keys]); fold = np.array([int(meta[k]["fold"]) for k in keys])
names = {int(x["target"]): x["category"] for x in meta.values()}
FAM = {"N1 impulsiveness": "nd_kurt", "N2 repetition": "nd_rep", "N3 events": "nd_ev", "N4 motion": "nd_mot", "N5 periodicity": ("nd_cpp", "nd_pci"),
       "N6 arrow of time": "nd_arrow", "N7 interest": "nd_info", "N8 recurrence": "nd_rec", "N9 decay": "nd_dec"}
def idx(prefixes): prefixes = (prefixes,) if isinstance(prefixes, str) else prefixes; return [i for i, c in enumerate(cols) if c.startswith(prefixes)]
A, L, B, C = idx("mfcc_"), idx("lb_"), idx("pa_"), idx("nd_")

def model(kind):
    if kind == "rf": return make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(n_estimators=500, random_state=0, n_jobs=2))
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=3000, C=0.5))
def cv(sel, kind):
    accs, pred = [], np.zeros_like(y)
    for f in sorted(set(fold)):
        tr, te = fold != f, fold == f
        clf = model(kind).fit(X[tr][:, sel], y[tr]); p = clf.predict(X[te][:, sel]); pred[te] = p; accs.append(float((p == y[te]).mean()))
    return {"mean": float(np.mean(accs)), "sd": float(np.std(accs)), "folds": accs, "n_features": len(sel)}, pred
def mcnemar(p0, p1):
    a, b = int(((p0 == y) & (p1 != y)).sum()), int(((p0 != y) & (p1 == y)).sum())
    return {"only_base_right": a, "only_new_right": b, "p": float(binomtest(min(a, b), a + b, 0.5).pvalue) if a + b else 1.0}

res = {"n": len(keys), "features": {"A_mfcc": len(A), "L_librosa": len(L), "B_psychoacoustic": len(B), "C_descriptors": len(C)}, "sets": {}, "paired": {}, "ablation": {}, "classes": {}}
sets = {"A": A, "B": B, "C": C, "A+B": A + B, "A+C": A + C, "A+B+C": A + B + C}
if L: sets.update({"L": L, "L+B": L + B, "L+C": L + C, "L+B+C": L + B + C})
preds = {}
for kind in ("rf", "logreg"):
    for name, sel in sets.items():
        r, p = cv(sel, kind); res["sets"][kind + " " + name] = r; preds[(kind, name)] = p
        print(f"{kind:7s} {name:6s} {len(sel):3d} features  accuracy {100*r['mean']:.1f} ± {100*r['sd']:.1f} %", flush=True)
pairs = [("A", "A+C"), ("A+B", "A+B+C")] + ([("L", "L+C"), ("L+B", "L+B+C"), ("L", "A+C")] if L else [])
for kind in ("rf", "logreg"):
    for b0, b1 in pairs:
        t = mcnemar(preds[(kind, b0)], preds[(kind, b1)]); res["paired"][f"{kind} {b0} -> {b1}"] = t
        print(f"{kind:7s} {b0:5s} -> {b1:6s} only base right {t['only_base_right']:3d}, only new right {t['only_new_right']:3d}, McNemar p = {t['p']:.2g}", flush=True)
# which descriptor families carry the gain: drop each from the strongest baseline plus C (random forest)
ref = "L" if L else "A"; R = L if L else A
base = res["sets"][f"rf {ref}+C"]["mean"]; res["ablation_base"] = f"rf {ref}+C"
for fam, pre in FAM.items():
    sel = [i for i in R + C if i not in idx(pre)]
    r, _ = cv(sel, "rf"); res["ablation"][fam] = {"without": r["mean"], "drop": base - r["mean"]}
    print(f"  {ref}+C without {fam:18s} {100*r['mean']:.1f} %  (drop {100*(base-r['mean']):+.1f})", flush=True)
# the families overlap, so also add each one alone to the baseline
b0 = res["sets"][f"rf {ref}"]["mean"]; res["add_one"] = {}
for fam, pre in FAM.items():
    r, _ = cv(R + idx(pre), "rf"); res["add_one"][fam] = {"with": r["mean"], "gain": r["mean"] - b0, "n_features": len(idx(pre))}
    print(f"  {ref} plus only {fam:18s} {100*r['mean']:.1f} %  (gain {100*(r['mean']-b0):+.1f}, {len(idx(pre))} features)", flush=True)
# classes that gain most when the descriptors are added (random forest)
fa = f1_score(y, preds[("rf", ref)], average=None, labels=sorted(names)); fc = f1_score(y, preds[("rf", ref + "+C")], average=None, labels=sorted(names))
gain = sorted(((fc[i] - fa[i], names[k], fa[i], fc[i]) for i, k in enumerate(sorted(names))), reverse=True)
res["classes"] = {"base": ref, "most_gain": [{"class": g[1], "f1_base": float(g[2]), "f1_with_desc": float(g[3])} for g in gain[:10]],
                  "least_gain": [{"class": g[1], "f1_base": float(g[2]), "f1_with_desc": float(g[3])} for g in gain[-5:]]}
print("largest F1 gains from adding the descriptors:", ", ".join(f"{g[1]} {g[2]:.2f}→{g[3]:.2f}" for g in gain[:10]))
print("smallest:", ", ".join(f"{g[1]} {g[2]:.2f}→{g[3]:.2f}" for g in gain[-5:]))
json.dump(res, open(out_path, "w"), indent=1)
print("wrote", out_path)
