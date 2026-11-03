# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
"""Renders the JSON from evaluate.py as a self-contained HTML report.

    python3 experiments/esc50/report.py esc50_results.json --out esc50_report.html
"""
import json, sys, html

res = json.load(open(sys.argv[1]))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "esc50_report.html"
S, e = res["sets"], html.escape
pct = lambda v: f"{100 * v:.1f}"
ORDER = [k for k in ("A", "B", "C", "A+B", "A+C", "A+B+C", "L", "L+B", "L+C", "L+B+C") if "rf " + k in S]
NAME = {"A": "MFCC (13 × mean, sd)", "L": "librosa set", "B": "psychoacoustic curves", "C": "descriptors N1–N9"}
SHORT = {"A": "MFCC", "L": "librosa", "B": "curves", "C": "descriptors"}
label = lambda k: " + ".join(NAME[p] for p in k.split("+"))
short = lambda k: " + ".join(SHORT[p] for p in k.split("+"))

def bars(rows, lo, hi, ref=None):
    """rows: (label, value, series 1|2, tooltip). Horizontal bars from lo to hi (fractions)."""
    span = hi - lo; out = []
    for lab, v, s, tip in rows:
        w = max(0.0, (v - lo) / span) * 100
        out.append(f'<div class="br" title="{e(tip)}"><span class="bl">{e(lab)}</span><span class="bt"><i class="s{s}" style="width:{w:.2f}%"></i>'
                   f'<em style="left:calc({w:.2f}% + 6px)">{pct(v)} %</em></span></div>')
    refl = ""
    if ref: refl = f'<div class="ov"><div class="ref" style="left:{(ref[0] - lo) / span * 100:.2f}%"><span>{e(ref[1])}</span></div></div>'
    return '<div class="chart' + (' withref' if ref else '') + '">' + refl + "".join(out) + "</div>"

def gains(rows, lo, hi):
    """rows: (label, gain in fraction, tooltip); bars grow from zero in either direction."""
    z = -lo / (hi - lo) * 100; out = []
    for lab, g, tip in rows:
        w = abs(g) / (hi - lo) * 100; left = z if g >= 0 else z - w
        tx = f"left:calc({left + w:.2f}% + 6px)" if g >= 0 else f"right:calc({100 - left:.2f}% + 6px)"
        out.append(f'<div class="br" title="{e(tip)}"><span class="bl">{e(lab)}</span><span class="bt"><b class="zero" style="left:{z:.2f}%"></b>'
                   f'<i class="s1{" neg" if g < 0 else ""}" style="left:{left:.2f}%;width:{w:.2f}%"></i><em style="{tx}">{"+" if g >= 0 else "−"}{abs(100 * g):.1f}</em></span></div>')
    return '<div class="chart">' + "".join(out) + "</div>"

rf = [(short(k), S["rf " + k]["mean"], 2 if "C" in k else 1,
       f'{label(k)}: {pct(S["rf " + k]["mean"])} ± {pct(S["rf " + k]["sd"])} % over 5 folds, {S["rf " + k]["n_features"]} features') for k in ORDER]
tab = "".join(f'<tr><td>{e(label(k))}</td><td class=n>{S["rf " + k]["n_features"]}</td><td class=n>{pct(S["rf " + k]["mean"])} ± {pct(S["rf " + k]["sd"])}</td>'
              f'<td class=n>{pct(S["logreg " + k]["mean"])} ± {pct(S["logreg " + k]["sd"])}</td></tr>' for k in ORDER)
pair = "".join(f'<tr><td>{e(k.split(" ", 1)[0])}</td><td>{e(label(k.split(" ", 1)[1].split(" -> ")[0]))} → {e(label(k.split(" -> ")[1]))}</td>'
               f'<td class=n>{v["only_base_right"]}</td><td class=n>{v["only_new_right"]}</td><td class="n nw">{v["p"]:.0e}</td></tr>' for k, v in res["paired"].items())
ref = res.get("classes", {}).get("base", "A"); base = S["rf " + ref]["mean"]; withc = S[f"rf {ref}+C"]["mean"]
add = res.get("add_one", {}); abl = res["ablation"]
fam = sorted(abl, key=lambda f: -(add.get(f, {}).get("gain", 0)))
addrows = [(f, add[f]["gain"], f'{label(ref)} + only {f}: {pct(add[f]["with"])} % ({add[f]["n_features"]} features)') for f in fam if f in add]
lo = min([0] + [r[1] for r in addrows]) - 0.005; hi = max([withc - base] + [r[1] for r in addrows]) + 0.012
famtab = "".join(f'<tr><td>{e(f)}</td><td class=n>{add[f]["n_features"] if f in add else ""}</td><td class=n>{("+" if add[f]["gain"] >= 0 else "−") + f"{abs(100 * add[f]["gain"]):.1f}" if f in add else ""}</td>'
                 f'<td class=n>{("+" if abl[f]["drop"] >= 0 else "−") + f"{abs(100 * abl[f]["drop"]):.1f}"}</td></tr>' for f in fam)
cl = res["classes"]
cls = lambda rows: "".join(f'<tr><td>{e(r["class"].replace("_", " "))}</td><td class=n>{r["f1_base"]:.2f}</td><td class=n>{r["f1_with_desc"]:.2f}</td><td class=n>{r["f1_with_desc"] - r["f1_base"]:+.2f}</td></tr>' for r in rows)
best = res["paired"].get(f"rf {ref} -> {ref}+C", {})

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ESC-50 descriptor test</title><style>
:root{{--bg:#fbfbfa;--ink:#1d1d1b;--ink2:#5c5c55;--mute:#898781;--rule:#deded8;--axis:#c3c2b7;--card:#fff;--s1:#2a78d6;--s2:#eb6834;--lab:200px}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#161615;--ink:#ecece8;--ink2:#a5a59e;--rule:#34342f;--axis:#383835;--card:#1e1e1c;--s1:#3987e5;--s2:#d95926}}}}
:root[data-theme=dark]{{--bg:#161615;--ink:#ecece8;--ink2:#a5a59e;--rule:#34342f;--axis:#383835;--card:#1e1e1c;--s1:#3987e5;--s2:#d95926}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}}main{{max-width:900px;margin:0 auto;padding:24px 16px}}
h1{{font-size:22px;margin:0 0 4px}}h2{{font-size:17px;margin:28px 0 8px}}.m{{color:var(--ink2);font-size:12px}}p{{max-width:72ch}}
table{{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}}th,td{{border-bottom:1px solid var(--rule);padding:5px 7px;text-align:left;vertical-align:top}}td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums}}.tw{{overflow-x:auto}}
.big{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}}.big div{{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px 12px}}.big b{{display:block;font-size:22px}}
.chart{{position:relative;background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:12px 56px 12px 12px}}
.br{{display:flex;align-items:center;gap:8px;height:22px;margin-bottom:2px;border-radius:3px}}.br:hover{{background:color-mix(in srgb,var(--ink) 6%,transparent)}}
.bl{{flex:0 0 var(--lab);font-size:12px;color:var(--ink2);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.bt{{position:relative;flex:1;height:14px;border-left:1px solid var(--axis)}}.bt i{{position:absolute;top:0;bottom:0;left:0;border-radius:0 4px 4px 0}}.bt i.neg{{border-radius:4px 0 0 4px}}
.bt i.s1{{background:var(--s1)}}.bt i.s2{{background:var(--s2)}}.bt em{{position:absolute;top:-2px;font:12px/18px system-ui,sans-serif;font-style:normal;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;background:var(--card);padding:0 2px;z-index:1}}
.bt b.zero{{position:absolute;top:-4px;bottom:-4px;border-left:1px solid var(--axis)}}.chart.gains .bt{{border-left:0}}.chart.withref{{padding-top:30px}}.nw{{white-space:nowrap}}
.ov{{z-index:0;position:absolute;top:30px;bottom:12px;left:calc(12px + var(--lab) + 8px);right:56px;pointer-events:none}}.ref{{position:absolute;top:-22px;bottom:0;border-left:1px dashed var(--mute)}}.ref span{{position:absolute;top:-3px;right:5px;font-size:11px;color:var(--ink2);white-space:nowrap}}
.leg{{display:flex;gap:16px;font-size:12px;color:var(--ink2);margin:4px 0 8px}}.leg span::before{{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px;background:var(--c)}}
@media (max-width:560px){{:root{{--lab:118px}}}}
</style></head><body><main>
<h1>Do the descriptors add information? ESC-50</h1>
<p class=m>{res["n"]} five-second clips, 50 classes, official 5-fold cross-validation (no clip is tested by a model that saw it). Random forest with 500 trees; logistic regression in the table. Accuracy is the mean over the five folds.</p>
<div class=big><div>{e(label(ref))}<b>{pct(base)} %</b><span class=m>{S["rf " + ref]["n_features"]} features</span></div>
<div>plus descriptors N1–N9<b>{pct(withc)} %</b><span class=m>+{100 * (withc - base):.1f} points; McNemar p = {best.get("p", float("nan")):.0e}</span></div>
<div>{e(short(ref))} + curves + descriptors<b>{pct(S["rf " + ref + "+B+C"]["mean"])} %</b><span class=m>logistic regression {pct(S["logreg " + ref + "+B+C"]["mean"])} %</span></div></div>
<h2>Accuracy by feature set</h2>
<div class=leg><span style="--c:var(--s1)">without descriptors</span><span style="--c:var(--s2)">with descriptors</span></div>
{bars(rf, 0.3, 0.85, (0.813, "human listeners 81.3 %"))}
<p class=m>Axis from 30 %. Chance is 2 %; the dataset's published random-forest baseline (MFCC and zero-crossing rate) is 44.3 %; pretrained neural networks reach about 98 %. The descriptors are not meant to compete with those, only to show whether they carry information that standard features lack.</p>
<div class=tw><table><tr><th>Feature set</th><th class=n>Features</th><th class=n>Random forest, %</th><th class=n>Logistic regression, %</th></tr>{tab}</table></div>
<h2>Is the gain real? Paired tests</h2>
<p>Each pair is compared on the same 2,000 out-of-fold predictions: clips only the first set got right against clips only the second got right (McNemar's exact test).</p>
<div class=tw><table><tr><th>Model</th><th>From → to</th><th class=n>Only first right</th><th class=n>Only second right</th><th class=n>p</th></tr>{pair}</table></div>
<h2>Which descriptor families carry it</h2>
<p>Points of accuracy gained when a single family is added to the {e(label(ref))} ({pct(base)} %), against +{100 * (withc - base):.1f} for all nine. The drop-one column removes one family from the full set; small drops mean the families overlap, so most of the information survives the loss of any one of them. Differences below about one point are within the run-to-run noise of a single forest.</p>
<div class="chart gains">{gains(addrows, lo, hi)[len('<div class="chart">'):-len("</div>")]}</div>
<div class=tw style="margin-top:10px"><table><tr><th>Family</th><th class=n>Features</th><th class=n>Added alone (points)</th><th class=n>Dropped from all (points)</th></tr>{famtab}</table></div>
<h2>Classes that change most</h2>
<p class=m>F1 per class, random forest, {e(label(ref))} against {e(label(ref))} plus descriptors.</p>
<div class=tw><table><tr><th>Largest gains</th><th class=n>F1 before</th><th class=n>after</th><th class=n>change</th></tr>{cls(cl["most_gain"])}
<tr><th>Smallest</th><th></th><th></th><th></th></tr>{cls(cl["least_gain"])}</table></div>
<p class=m>ESC-50 by Karol J. Piczak, CC BY-NC 3.0. Features from tools/export-features.js and experiments/esc50/librosa_baseline.py; this page from experiments/esc50/report.py.</p>
</main></body></html>"""
open(out, "w").write(page)
print("wrote", out)
