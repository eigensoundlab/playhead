# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Draws the paper's figures from the results stored in this repository.

    node tools/paper-data.js                                   # analysis of the CC0 synthetic signals
    python3 experiments/paper/figures.py --out path/to/paper/figures

Reads experiments/paper/figure-data.json and robot-data.json (with robot-hit-steel.wav), experiments/esc50/results.json
and controls.json, and experiments/corpus/tools-vs-eq.csv. Writes vector PDFs sized for a two-column page (DAFx: column 83.5 mm,
text width 175 mm). Lines differ in style as well as colour, so the figures survive greyscale printing.
"""
import csv, json, os, sys, statistics
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(HERE, "figures")
os.makedirs(out, exist_ok=True)
for f in ("/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyretermes-regular.otf", "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyretermes-italic.otf", "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyretermes-bold.otf"):
    if os.path.exists(f): font_manager.fontManager.addfont(f)
plt.rcParams.update({"font.family": "serif", "font.serif": ["Liberation Serif", "Times New Roman", "TeX Gyre Termes", "DejaVu Serif"], "mathtext.fontset": "stix",
                     "font.size": 7.5, "axes.titlesize": 7.5, "axes.labelsize": 7.5, "xtick.labelsize": 7, "ytick.labelsize": 7, "legend.fontsize": 7,
                     "axes.linewidth": 0.5, "xtick.major.width": 0.5, "ytick.major.width": 0.5, "xtick.major.size": 2.5, "ytick.major.size": 2.5,
                     "pdf.fonttype": 42, "axes.spines.top": False, "axes.spines.right": False, "savefig.pad_inches": 0.02})
MM = 1 / 25.4; COL, FULL = 83.5 * MM, 175 * MM
BLUE, ORANGE, AQUA, INK, MUTED, WAVE = "#2a78d6", "#eb6834", "#1baf7a", "#1d1d1b", "#6f6e69", "#c9c8c2"
RAMP = ["#184f95", "#3987e5", "#9ec5f4"]   # static, + dynamic, + automation (one hue, dark to light)

def save(fig, name):
    p = os.path.join(out, name); fig.savefig(p); plt.close(fig); print("wrote", p)

# ---------- Figure 1: what the strips show, on signals with ground truth ----------
D = json.load(open(os.path.join(HERE, "figure-data.json")))
fig = plt.figure(figsize=(FULL, 3.75))
gs = fig.add_gridspec(5, 1, height_ratios=[2.4, 0.42, 0.6, 0.6, 0.6], hspace=0.14, left=0.045, right=0.985, top=0.9, bottom=0.085)
cue = D["cue"]; s = dict(D["cue"]["strip"]); n = len(s["wave"]); T = cue["dur"]; t = [(i + 0.5) * T / n for i in range(n)]
# curves are pooled per column like an on-screen strip; for print, average over 0.35 s
def smooth(arr, half=2):
    o = []
    for i in range(len(arr)):
        v = [x for x in arr[max(0, i - half):i + half + 1] if x is not None]
        o.append(sum(v) / len(v) if v and arr[i] is not None else None)
    return o
for k in ("loud", "act", "tension"): s[k] = smooth(s[k])
ax = fig.add_subplot(gs[0])
lo = [0.5 + 0.48 * w[0] / max(1e-9, max(abs(v) for p in s["wave"] for v in p)) for w in s["wave"]]
hi = [0.5 + 0.48 * w[1] / max(1e-9, max(abs(v) for p in s["wave"] for v in p)) for w in s["wave"]]
ax.fill_between(t, lo, hi, color=WAVE, lw=0, label="waveform")
line = lambda arr, **k: ax.plot([x for x, v in zip(t, arr) if v is not None], [v for v in arr if v is not None], lw=1.0, **k)
line(s["loud"], color=BLUE, ls="-", label="C1 loudness")
line(s["act"], color=ORANGE, ls="--", label="C2 activity")
line(s["tension"], color=AQUA, ls="-.", label="C5 tension")
for d in s["downbeats"]: ax.plot([d, d], [-0.06, -0.01], color=INK, lw=0.6, clip_on=False)
for seg in cue["detected"]:
    if seg["t0"] > 0.1: ax.axvline(seg["t0"], color=INK, lw=0.6, ls=":")
    ax.text(seg["t0"] + 0.4, 1.02, seg["label"], fontsize=7.5, fontweight="bold", va="bottom", color=INK)
for seg in cue["truth"]:
    ax.annotate("", xy=(seg["t1"], 1.13), xytext=(seg["t0"], 1.13), arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6), annotation_clip=False)
    ax.plot([seg["t0"], seg["t0"]], [1.10, 1.16], color=MUTED, lw=0.6, clip_on=False)
    ax.text((seg["t0"] + seg["t1"]) / 2, 1.15, seg["label"], ha="center", va="bottom", fontsize=6.5, color=MUTED, style="italic")
ax.set_xlim(0, T); ax.set_ylim(-0.06, 1.0); ax.set_yticks([0, 0.5, 1]); ax.set_xticks([])
ax.spines["bottom"].set_visible(False)
ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.07), ncol=4, frameon=False, handlelength=2.2, columnspacing=1.6)
ax.text(-0.04, 1.2, "(a)", transform=ax.transAxes, fontsize=8, fontweight="bold", va="top")
# (b) descriptor tour
d = D["desc"]; n2 = len(d["kurt"]); T2 = d["dur"]; t2 = [(i + 0.5) * T2 / n2 for i in range(n2)]
short = {"White noise": "noise", "Steady tone": "tone", "Click train 8/s": "clicks", "Poisson clicks": "Poisson", "Clustered crackle": "clusters",
         "Sweep up 2 oct/s": "up", "Sweep down 2 oct/s": "down", "Speech-rate AM 5 Hz": "AM 5 Hz", "Engine-rate AM 23 Hz": "AM 23 Hz",
         "Impacts": "impacts", "Reversed impacts": "reversed", "Glass-like hit": "glass", "Wood-like hit": "wood", "Phrase played 3 times": "phrase ×3", "Voice-like pulses 150 Hz": "pulses"}
rows = [("kurt", "N1 spectral kurtosis", "symlog", (-1.5, 120), [-1, 0, 10, 100]), ("vel", "N4 spectral velocity, oct/s", "linear", (-2.6, 2.6), [-2, 0, 2]),
        ("arrow", "N6 arrow of time", "linear", (-5.5, 5.5), [-4, 0, 4])]
axes = []
for k, (key, lab, scale, ylim, ticks) in enumerate(rows):
    a = fig.add_subplot(gs[2 + k]); axes.append(a)
    for j, seg in enumerate(d["segments"]):
        if j % 2 == 0: a.axvspan(seg["t0"], seg["t1"], color="#f0efec", lw=0)
    a.axhline(0, color=MUTED, lw=0.4)
    if scale == "symlog": a.set_yscale("symlog", linthresh=1)
    xs = [x for x, v in zip(t2, d[key]) if v is not None]; ys = [v for v in d[key] if v is not None]
    a.plot(xs, ys, ".", ms=1.2, color=INK, rasterized=False)
    a.set_xlim(0, T2); a.set_ylim(*ylim); a.set_yticks(ticks); a.set_yticklabels([str(v) for v in ticks])
    a.text(0.003, 0.97, lab, transform=a.transAxes, ha="left", va="top", fontsize=6.5, color=INK, bbox=dict(facecolor="white", edgecolor="none", pad=0.6))
    if k < len(rows) - 1: a.set_xticks([]); a.spines["bottom"].set_visible(False)
    else: a.set_xlabel("time (s), descriptor tour")
    if k == 0:
        for seg in d["segments"]:
            a.text((seg["t0"] + seg["t1"]) / 2, 1.06, short.get(seg["label"], seg["label"]), transform=a.get_xaxis_transform(), ha="center", va="bottom", fontsize=6, color=INK)
        a.text(-0.04, 1.42, "(b)", transform=a.transAxes, fontsize=8, fontweight="bold", va="top")
save(fig, "fig-strips.pdf")

# ---------- Figure 2: ESC-50, with and without descriptors, and negative controls ----------
R = json.load(open(os.path.join(ROOT, "experiments/esc50/results.json"))); C = json.load(open(os.path.join(ROOT, "experiments/esc50/controls.json")))
S = R["sets"]
def ctrl(name):
    v = [100 * x["acc"] for x in C["controls"][name]]; return statistics.mean(v), min(v), max(v)
bars = [("MFCC (26)", 100 * S["rf A"]["mean"], 100 * S["rf A"]["sd"], "base"),
        ("MFCC + N1–N9 (74)", 100 * S["rf A+C"]["mean"], 100 * S["rf A+C"]["sd"], "desc"),
        ("librosa (130)", 100 * S["rf L"]["mean"], 100 * S["rf L"]["sd"], "base"),
        ("librosa + N1–N9 (178)", 100 * S["rf L+C"]["mean"], 100 * S["rf L+C"]["sd"], "desc"),
        ("librosa + noise (178)",) + ctrl("random") + ("ctrl",),
        ("librosa + shuffled N1–N9 (178)",) + ctrl("shuffled") + ("ctrl",),
        ("librosa + loudness copies (178)",) + ctrl("loudness") + ("ctrl",)]
fig, ax = plt.subplots(figsize=(COL, 1.95)); fig.subplots_adjust(left=0.46, right=0.97, top=0.97, bottom=0.2)
y = list(range(len(bars)))[::-1]
for yi, b in zip(y, bars):
    lab, v = b[0], b[1]; kind = b[-1]
    if kind == "ctrl":
        ax.barh(yi, v, height=0.62, color="white", edgecolor=MUTED, hatch="////", lw=0.6)
        ax.plot([b[2], b[3]], [yi, yi], color=INK, lw=0.8)
    else:
        ax.barh(yi, v, height=0.62, color=ORANGE if kind == "desc" else BLUE, lw=0)
        ax.plot([v - b[2], v + b[2]], [yi, yi], color=INK, lw=0.8)
    ax.text(v + (b[3] - v if kind == "ctrl" else b[2]) + 0.6, yi, f"{v:.1f}", va="center", fontsize=7)
ax.axvline(100 * S["rf L"]["mean"], color=MUTED, lw=0.6, ls="--")
ax.set_yticks(y); ax.set_yticklabels([b[0] for b in bars]); ax.set_xlim(40, 72); ax.set_xlabel("accuracy, % (random forest, 5 official folds)")
ax.tick_params(axis="y", length=0)
save(fig, "fig-esc50.pdf")

# ---------- Figure 3: how much of each tool an EQ could reproduce ----------
rows = list(csv.DictReader(open(os.path.join(ROOT, "experiments/corpus/tools-vs-eq.csv"))))
med = lambda tool, col: statistics.median(float(r[col]) for r in rows if r["tool"] == tool and r[col] not in ("", "null"))
tools = [("layers", "Layer remix"), ("deharsh", "De-harsh"), ("hpss", "Attack and body"), ("vars", "Variations")]
fig, ax = plt.subplots(figsize=(COL, 1.6)); fig.subplots_adjust(left=0.26, right=0.97, top=0.74, bottom=0.23)
for k, (tid, lab) in enumerate(tools):
    tid = "variations" if tid == "vars" else tid
    st, dy, au = 100 * med(tid, "eqShare"), 100 * med(tid, "dynShare"), 100 * med(tid, "autoShare")
    yk = len(tools) - 1 - k; left = 0
    for w, c in ((st, RAMP[0]), (max(0, dy - st), RAMP[1]), (max(0, au - dy), RAMP[2]), (100 - max(au, dy, st), ORANGE)):
        ax.barh(yk, w, left=left, height=0.62, color=c, edgecolor="white", lw=0.8); left += w
    ax.text(st / 2, yk, f"{st:.0f}", ha="center", va="center", fontsize=7, color="white")
    ax.text(100 - (100 - au) / 2, yk, f"{100 - au:.0f}", ha="center", va="center", fontsize=7, color="white")
ax.set_yticks(range(len(tools))[::-1]); ax.set_yticklabels([l for _, l in tools]); ax.set_xlim(0, 100); ax.tick_params(axis="y", length=0)
ax.set_xlabel("share of the spectrogram change, % (median over files)")
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=RAMP[0], label="static EQ"), Patch(color=RAMP[1], label="+ dynamic EQ"), Patch(color=RAMP[2], label="+ EQ automation"), Patch(color=ORANGE, label="no EQ")],
          loc="lower left", bbox_to_anchor=(-0.35, 1.02), ncol=2, frameon=False, handlelength=1.0, columnspacing=1.2, handletextpad=0.4)
save(fig, "fig-eq.pdf")

# ---------- What the waveform hides: a robot hit on steel, ordinary views and two Playhead looks ----------
import numpy as np
from scipy.io import wavfile
Rb = json.load(open(os.path.join(HERE, "robot-data.json")))["robot"]
fs_, xs_ = wavfile.read(os.path.join(HERE, "robot-hit-steel.wav"))
xs_ = xs_.astype(np.float64)
if xs_.ndim > 1: xs_ = xs_.mean(axis=1)
xs_ = xs_ / (np.abs(xs_).max() or 1.0); Tr = len(xs_) / fs_
PURPLE = "#7a4fb5"
fig = plt.figure(figsize=(COL, 2.75))
gs = fig.add_gridspec(4, 1, height_ratios=[0.75, 1.0, 0.85, 0.85], hspace=0.1, left=0.115, right=0.985, top=0.99, bottom=0.155)
TAIL = (1.0, 1.1)
def label(a, txt):
    a.text(0.006, 0.97, txt, transform=a.transAxes, ha="left", va="top", fontsize=6.5, color=INK, bbox=dict(facecolor="white", edgecolor="none", pad=0.5, alpha=0.9))
# (a) waveform, min/max per column
a = fig.add_subplot(gs[0]); n = len(Rb["wave"]); tw = [(i + 0.5) * Tr / n for i in range(n)]
a.fill_between(tw, [w[0] for w in Rb["wave"]], [w[1] for w in Rb["wave"]], color="#8d8c86", lw=0)
a.set_ylim(-1.05, 1.05); a.set_yticks([]); label(a, "(a) waveform")
# (b) spectrogram: 2048-point STFT, hop 256, Hann, dB re the loudest bin over 80 dB, log frequency
a = fig.add_subplot(gs[1]); N, H = 2048, 256; w = np.hanning(N)
frames = np.array([xs_[i:i + N] * w for i in range(0, len(xs_) - N, H)])
S = 20 * np.log10(np.abs(np.fft.rfft(frames, axis=1)) + 1e-12); S -= S.max(); S = np.clip(S, -80, 0)
fq = np.fft.rfftfreq(N, 1 / fs_); tt = (np.arange(len(frames)) * H + N / 2) / fs_; keep = (fq >= 40) & (fq <= 16000)
a.pcolormesh(tt, fq[keep], S[:, keep].T, cmap="magma", vmin=-80, vmax=0, shading="nearest", rasterized=True)
a.set_yscale("log"); a.set_ylim(40, 16000); a.set_yticks([100, 1000, 10000]); a.set_yticklabels(["100 Hz", "1 kHz", "10 kHz"], fontsize=5.8)
a.minorticks_off(); label(a, "(b) spectrogram, 80 dB range")
# (c), (d) the looks: curves mirrored like a waveform and overlaid, scaled as Playhead draws them, onsets marked below
SER = {"onsetStrength": ("onset strength", BLUE, "-"), "harshness": ("harshness", AQUA, "--"), "n1Kurtosis": ("impulsiveness (N1)", ORANGE, "-"), "n7Surprisal": ("surprisal (N7)", PURPLE, "-.")}
LOOKS = [("(c)", "(c) look: Sound character", ["onsetStrength", "harshness", "n1Kurtosis"]), ("(d)", "(d) look: Hits and surprise", ["onsetStrength", "harshness", "n7Surprisal"])]
handles = {}
for k, (tg, name, keys) in enumerate(LOOKS):
    a = fig.add_subplot(gs[2 + k])
    for key in keys:
        lab, col, ls = SER[key]; v = Rb["curves"][key]["v"]; tc = [(i + 0.5) / Rb["rate"] for i in range(len(v))]
        pts = [(t, y) for t, y in zip(tc, v) if y is not None]
        t_, y_ = zip(*pts)
        a.fill_between(t_, [-q for q in y_], y_, color=col, alpha=0.15, lw=0)
        handles[key], = a.plot(t_, y_, color=col, lw=0.8, ls=ls, label=lab); a.plot(t_, [-q for q in y_], color=col, lw=0.8, ls=ls)
    for o in Rb["onsets"]: a.plot([o, o], [-1.1, -0.96], color=INK, lw=0.6, clip_on=False)
    a.set_ylim(-1.1, 1.1); a.set_yticks([]); label(a, name)
for i, a in enumerate(fig.axes):
    a.set_xlim(0, Tr); a.axvspan(*TAIL, color="#1d1d1b", alpha=0.08, lw=0)
    if i < len(fig.axes) - 1: a.set_xticks([]); a.spines["bottom"].set_visible(False)
    else: a.set_xlabel("time (s); ticks: onsets", labelpad=1.5)
fig.axes[-1].annotate("low ring left, %d dB\nunder the peak" % round(-Rb["tailDb"]), xy=(1.04, 0.62), xytext=(0.8, 0.5), fontsize=6, color=INK, ha="center", va="center",
                      arrowprops=dict(arrowstyle="-", color=INK, lw=0.5), bbox=dict(facecolor="white", edgecolor="none", pad=0.4, alpha=0.9))
fig.legend([handles[k] for k in ("onsetStrength", "harshness", "n1Kurtosis", "n7Surprisal")], [SER[k][0] for k in ("onsetStrength", "harshness", "n1Kurtosis", "n7Surprisal")],
           loc="lower center", ncol=4, frameon=False, fontsize=6, handlelength=1.8, columnspacing=1.0, handletextpad=0.4, bbox_to_anchor=(0.55, -0.01))
save(fig, "fig-robot.pdf")
