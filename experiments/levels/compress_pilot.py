# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Pilot: can a sound's own numbers tell that it was compressed or limited?

The 56 effects of the test set are compressed and limited with known settings; candidate detectors are measured on the
originals and the processed copies. Reported per detector: how often it moves the expected way on the same file
(paired), and how well one threshold separates originals from processed copies over the whole set (AUC), the case of a
library where the original is not at hand.
"""
import json, os, sys, numpy as np, soundfile as sf
from scipy.signal import lfilter

DIR = sys.argv[1] if len(sys.argv) > 1 else "../corpus/sfx"


def env_db(x, sr, win=0.005):
    w = max(1, int(win * sr)); p = np.convolve((x ** 2).mean(axis=1), np.ones(w) / w, "same")
    return 10 * np.log10(p + 1e-12)


def compressor(x, sr, thr_rel, ratio, att=0.005, rel=0.1):
    """Feed-forward, RMS detector (5 ms), gain smoothed with attack/release, make-up to the original peak."""
    pk = np.abs(x).max(); thr = 20 * np.log10(pk + 1e-12) + thr_rel
    lv = env_db(x, sr)
    over = np.maximum(0, lv - thr); gr = over * (1 - 1 / ratio)                    # wanted gain reduction, dB
    a, r = np.exp(-1 / (att * sr)), np.exp(-1 / (rel * sr)); g = np.zeros_like(gr); s = 0.0
    for i, v in enumerate(gr):
        s = a * s + (1 - a) * v if v > s else r * s + (1 - r) * v
        g[i] = s
    y = x * (10 ** (-g / 20))[:, None]
    return y * (pk / (np.abs(y).max() + 1e-12))


def limiter(x, sr, drive_db, ceil_db=-1.0, look=0.0015, rel=0.05):
    """Gain into a look-ahead peak limiter: the gain is the lowest needed in the look-ahead window, released slowly."""
    y = x * 10 ** (drive_db / 20); c = 10 ** (ceil_db / 20)
    need = np.minimum(1, c / (np.abs(y).max(axis=1) + 1e-12)); L = max(1, int(look * sr))
    from scipy.ndimage import minimum_filter1d
    need = minimum_filter1d(need, size=2 * L + 1)
    r = np.exp(-1 / (rel * sr)); g = np.empty_like(need); s = 1.0
    for i, v in enumerate(need):
        s = v if v < s else r * s + (1 - r) * v
        g[i] = s
    return np.clip(y * g[:, None], -c, c)


def detectors(x, sr):
    pk = np.abs(x).max(); pkdb = 20 * np.log10(pk + 1e-12)
    lv = env_db(x, sr, 0.05); act = lv > lv.max() - 40
    rms_act = 10 * np.log10((x[act] ** 2).mean() + 1e-12) if act.any() else np.nan
    crest = pkdb - rms_act
    # loudest 0.4 s window (unweighted here: the pilot compares a file with itself)
    w = int(0.4 * sr); p = (x ** 2).mean(axis=1); c = np.concatenate([[0], np.cumsum(p)])
    mm = max(((c[min(len(p), s + w)] - c[s]) / w) for s in range(0, max(1, len(p) - w + 1), max(1, sr // 100)))
    pmr = pkdb - 10 * np.log10(mm + 1e-12)
    # samples near the peak: limiters pile them up just under the ceiling
    near = float((np.abs(x) > pk * 10 ** (-1 / 20)).mean() * 1000)       # per mille within 1 dB of the peak
    # decay shape: from the envelope's peak, the time to fall 0->10 dB and 10->20 dB; a natural (exponential) decay
    # takes about as long for each; compression slows the first 10 dB
    e = env_db(x, sr, 0.01); i0 = int(np.argmax(e)); ref = e[i0]; tail = e[i0:]
    def t_at(d):
        k = np.where(tail < ref - d)[0]; return k[0] / sr if len(k) else np.nan
    t10, t20 = t_at(10), t_at(20)
    slope_ratio = (t20 - t10) / t10 if t10 and not np.isnan(t10) and not np.isnan(t20) and t10 > 0.002 else np.nan
    return dict(crest=crest, pmr=pmr, near=near, decay=slope_ratio)


def auc(neg, pos):
    neg, pos = np.array([v for v in neg if np.isfinite(v)]), np.array([v for v in pos if np.isfinite(v)])
    if not len(neg) or not len(pos): return np.nan
    return float(np.mean([(p > n) + 0.5 * (p == n) for p in pos for n in neg]))


EXPECT = dict(crest=-1, pmr=-1, near=+1, decay=-1)   # the direction a compressor or limiter moves each detector
PROC = {"compressor 4:1, 18 dB under the peak": lambda x, sr: compressor(x, sr, -18, 4),
        "compressor 10:1, 30 dB under the peak": lambda x, sr: compressor(x, sr, -30, 10),
        "limiter, 12 dB of drive": lambda x, sr: limiter(x, sr, 12),
        "limiter, 6 dB of drive": lambda x, sr: limiter(x, sr, 6)}
orig, proc = [], {k: [] for k in PROC}
files = sorted(f for f in os.listdir(DIR) if f.endswith(".flac"))
for f in files:
    x, sr = sf.read(os.path.join(DIR, f), always_2d=True); x = x.astype(np.float64)
    orig.append(detectors(x, sr))
    for k, fn in PROC.items(): proc[k].append(detectors(fn(x, sr), sr))
    sys.stderr.write(".")
print()
out = {}
for k in PROC:
    print(k)
    for d, sgn in EXPECT.items():
        o = np.array([r[d] for r in orig]); p = np.array([r[d] for r in proc[k]]); ok = np.isfinite(o) & np.isfinite(p)
        paired = float(np.mean(np.sign(p[ok] - o[ok]) == sgn)) if ok.any() else np.nan
        a = auc(o * sgn, p * sgn)
        med = float(np.median(p[ok] - o[ok])) if ok.any() else np.nan
        print(f"  {d:7s} moves the expected way on {paired*100:5.1f} % of {ok.sum():2d} files (median change {med:+.2f}); one threshold separates them with AUC {a:.2f}")
        out.setdefault(k, {})[d] = dict(paired=paired, n=int(ok.sum()), median_change=med, auc=a)
json.dump(out, open("compress_pilot.json", "w"), indent=1)
