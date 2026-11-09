# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
import json, numpy as np
R = json.load(open("measures.json"))
M = ["peak", "rms", "lufs_i", "lufs_m", "lufs_s", "ev_main", "by_class"]
cls = np.array([r["cls"] for r in R])
print("classes:", {c: int((cls == c).sum()) for c in set(cls)}, " durations median %.2f s (min %.2f, max %.2f)" % (np.median([r["dur"] for r in R]), min(r["dur"] for r in R), max(r["dur"] for r in R)))
for ref in ["zw_max", "zw_n5"]:
    print(f"\nAfter normalising with each measure: spread of ISO 532-1 loudness level ({ref}, phon ≈ dB), approx. 1 phon per dB")
    print("%-9s %6s %6s %6s | %s" % ("measure", "SD", "IQR", "P5-95", "median by class (impulse / iterative / sustained), relative to all"))
    for m in M:
        lev = np.array([r[ref] - r[m] for r in R]); lev -= np.median(lev)
        q = np.percentile(lev, [5, 25, 75, 95])
        bycls = " / ".join("%+.1f" % np.median(lev[cls == c]) for c in ["impulse", "iterative", "sustained"])
        print("%-9s %6.1f %6.1f %6.1f | %s" % (m, lev.std(), q[2] - q[1], q[3] - q[0], bycls))
print("\nPairwise: per-file gain difference between two measures (median removed), P5-95 range in dB")
print("%-9s" % "" + "".join("%9s" % m for m in M))
for a in M:
    line = "%-9s" % a
    for b in M:
        d = np.array([r[b] - r[a] for r in R]); d -= np.median(d)
        q = np.percentile(d, [5, 95]); line += "%9.1f" % (q[1] - q[0])
    print(line)
# worst disagreements LUFS-I vs LUFS-M max and vs zw
d = sorted(R, key=lambda r: -abs((r["lufs_m"] - r["lufs_i"]) - np.median([x["lufs_m"] - x["lufs_i"] for x in R])))
print("\nLargest LUFS-M max vs LUFS-I disagreements:")
for r in d[:6]: print("  %-28s %-9s %5.2fs  I %6.1f  Mmax %6.1f  Smax %6.1f  peak %6.1f  zwmax %5.1f  ev %6.1f" % (r["file"], r["cls"], r["dur"], r["lufs_i"], r["lufs_m"], r["lufs_s"], r["peak"], r["zw_max"], r["ev_main"]))
