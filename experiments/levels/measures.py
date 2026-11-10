# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Pilot: how far do the usual normalisation measures disagree on 56 short effects, by Playhead's class?

Measures per file: sample peak, RMS, BS.1770 integrated (LUFS-I), momentary max (LUFS-M max), short-term max
(LUFS-S max), ISO 532-1 time-varying loudness (Zwicker, via MoSQITo: Nmax and N5 as loudness levels in phon), and two
event-aware candidates from Playhead's events. A model stands in for listeners here (ISO 532-1), so this shows where the
choice of measure matters, not which one listeners agree with.
"""
import json, sys, os
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import resample_poly
from mosqito.sq_metrics import loudness_zwtv

DIR = sys.argv[1]  # the folder of sounds; playhead.json (from analyse.js) in the current folder
PH = json.load(open("playhead.json"))


def kweight(x, sr):
    """K-weighting of every channel along time. pyloudnorm's filter works on the last axis, so it gets one channel
    at a time: given the (frames, channels) array whole, it filters across the channels instead."""
    m = pyln.Meter(sr)
    y = x.copy()
    for f in m._filters.values():
        for c in range(y.shape[1]):
            y[:, c] = f.apply_filter(y[:, c])
    return y


def windows_db(ky, sr, win, hop=0.1):
    """BS.1770 loudness of sliding windows (ungated), the signal padded with silence to at least one window."""
    n, w, h = ky.shape[0], int(round(win * sr)), int(round(hop * sr))
    if n < w:
        ky = np.vstack([ky, np.zeros((w - n, ky.shape[1]))])
        n = w
    p = (ky ** 2)
    c = np.vstack([np.zeros((1, p.shape[1])), np.cumsum(p, axis=0)])
    out = []
    for s in range(0, n - w + 1, h):
        ms = (c[s + w] - c[s]) / w
        out.append(-0.691 + 10 * np.log10(max(ms.sum(), 1e-12)))
    return np.array(out)


def span_db(ky, sr, t0, t1):
    a, b = int(t0 * sr), max(int(t0 * sr) + 1, int(t1 * sr))
    ms = (ky[a:b] ** 2).mean(axis=0)
    return -0.691 + 10 * np.log10(max(ms.sum(), 1e-12))


def phon(N):
    N = max(N, 1e-3)
    return 40 + 33.22 * np.log10(N) if N >= 1 else 40 * (N + 0.0005) ** 0.35


rows = []
for f in sorted(PH):
    x, sr = sf.read(os.path.join(DIR, f), always_2d=True)
    x = x.astype(np.float64)
    dur = x.shape[0] / sr
    ky = kweight(x, sr)
    peak = 20 * np.log10(np.abs(x).max() + 1e-12)
    rms = 10 * np.log10((x ** 2).mean() + 1e-12)
    m = pyln.Meter(sr)
    xpad = x if dur >= 0.4 else np.vstack([x, np.zeros((int(0.4 * sr) - x.shape[0] + 1, x.shape[1]))])
    lufs_i = m.integrated_loudness(xpad)
    lufs_m = windows_db(ky, sr, 0.4).max()
    lufs_s = windows_db(ky, sr, 3.0).max()
    # ISO 532-1 time-varying, mono mix, full-scale sine = 100 dB SPL (2 Pa rms at 0.707 amplitude)
    mono = x.mean(axis=1) * (2.0 / 0.7071)
    if sr != 48000:
        mono = resample_poly(mono, 48000, sr)
    mono = np.concatenate([mono, np.zeros(int(0.3 * 48000))])
    N, _, _, _ = loudness_zwtv(mono, 48000, field_type="free")
    nmax, n5 = float(np.max(N)), float(np.percentile(N, 95))
    d = PH[f]
    ev = sorted(d["events"], key=lambda e: -(e["peakDb"] if e["peakDb"] is not None else -999))
    main = ev[0] if ev else None
    cls = main["facture"] if main else "none"
    # event-aware candidate A: the main event's own span (start..end), not padded and not diluted by what follows
    ev_main = span_db(ky, sr, main["start"], main["end"]) if main else lufs_m
    # candidate B: by class - impulses by their main event, iterative by short-term max, sustained by integrated
    # loudness over the sounding span (soundStart..soundEnd)
    s0, s1 = d["summary"].get("soundStart") or 0, d["summary"].get("soundEnd") or dur
    act = span_db(ky, sr, s0, s1) if s1 - s0 > 0.05 else lufs_i
    by_class = ev_main if cls == "impulse" else (lufs_s if cls == "iterative" else act)
    rows.append(dict(file=f, dur=round(dur, 3), cls=cls, peak=peak, rms=rms, lufs_i=lufs_i, lufs_m=lufs_m, lufs_s=lufs_s,
                     zw_max=phon(nmax), zw_n5=phon(n5), ev_main=ev_main, by_class=by_class,
                     main_len=(main["end"] - main["start"]) if main else None))
    sys.stderr.write(".")

json.dump(rows, open("measures.json", "w"), indent=1)
print()
