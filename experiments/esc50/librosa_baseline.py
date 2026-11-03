# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""A stronger baseline than 13 MFCCs: the hand-crafted librosa set commonly used on ESC-50.

    python3 experiments/esc50/librosa_baseline.py path/to/ESC-50/audio --out librosa_features.csv [--jobs 2]

Columns (prefix lb_), mean and standard deviation over frames of:
MFCC 0-19 and their deltas, spectral centroid, bandwidth, roll-off, flatness, zero-crossing rate, RMS,
spectral contrast (7 bands) and chroma (12): 130 features. Native sample rate, 2048-point frames, hop 512.
Pass the CSV to evaluate.py with --extra to compare it with Playhead's features.
"""
import csv, os, sys
from multiprocessing import Pool
import numpy as np
import librosa

def feats(path):
    y, sr = librosa.load(path, sr=None, mono=True)
    if not np.any(y): y = y + 1e-6 * np.random.default_rng(0).standard_normal(len(y))
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    mf = librosa.feature.mfcc(S=librosa.power_to_db(librosa.feature.melspectrogram(S=S**2, sr=sr)), n_mfcc=20)
    rows = {"mfcc": mf, "dmfcc": librosa.feature.delta(mf),
            "centroid": librosa.feature.spectral_centroid(S=S, sr=sr), "bandwidth": librosa.feature.spectral_bandwidth(S=S, sr=sr),
            "rolloff": librosa.feature.spectral_rolloff(S=S, sr=sr), "flatness": librosa.feature.spectral_flatness(S=S),
            "zcr": librosa.feature.zero_crossing_rate(y, frame_length=2048, hop_length=512), "rms": librosa.feature.rms(S=S, frame_length=2048),
            "contrast": librosa.feature.spectral_contrast(S=S, sr=sr), "chroma": librosa.feature.chroma_stft(S=S**2, sr=sr)}
    o = {}
    for k, M in rows.items():
        for i in range(M.shape[0]):
            tag = f"lb_{k}{i}" if M.shape[0] > 1 else f"lb_{k}"
            o[tag + "_mean"] = float(np.mean(M[i])); o[tag + "_std"] = float(np.std(M[i]))
    return os.path.basename(path), o

if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "librosa_features.csv"
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 2
    files = sorted(os.path.join(src, f) for f in os.listdir(src) if f.lower().endswith((".wav", ".ogg", ".flac", ".mp3")))
    with Pool(jobs) as p: res = p.map(feats, files, chunksize=20)
    cols = list(res[0][1])
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["file"] + cols)
        for name, o in res: w.writerow([name] + [f"{o[c]:.6g}" for c in cols])
    print(f"{len(res)} files, {len(cols)} features -> {out}")
