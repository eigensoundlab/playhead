#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Batch analysis of real audio files, with self-checks and effect measurements.
//
//   node tools/batch.js <files or folders...> [options]
//
//   --out DIR        output folder (default: playhead-batch)
//   --sr HZ          resample everything to this rate with ffmpeg (default 44100; 0 = native)
//   --max-dur S      analyse at most the first S seconds of each file (default 120)
//   --checks         run the self-checks: known edits whose correct answer is known by construction
//   --fx             run the analysis-driven tools and compare each with the best static EQ
//   --limit N        only the first N files
//
// Writes summary.csv, checks.csv, fx.csv, results.json and report.html (curves drawn as SVG).
// Formats other than WAV need ffmpeg on the PATH.
"use strict";
const fs = require("fs");
const path = require("path");
const WL = require("../src/analysis.js");
const FX = require("../src/effects.js");
const PHD = require("../src/descriptors.js");
const IO = require("./audio-io.js");

/* ---------------- arguments ---------------- */
const argv = process.argv.slice(2);
const opt = { out: "playhead-batch", sr: 44100, maxDur: 120, checks: false, fx: false, limit: 0 };
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--sr") opt.sr = Number(argv[++i]);
  else if (a === "--max-dur") opt.maxDur = Number(argv[++i]);
  else if (a === "--limit") opt.limit = Number(argv[++i]);
  else if (a === "--checks") opt.checks = true;
  else if (a === "--fx") opt.fx = true;
  else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(4, 18).map(l => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(0); }
  else inputs.push(a);
}
if (!inputs.length) { console.error("usage: node tools/batch.js <files or folders...> [--out DIR] [--checks] [--fx]   (--help for all options)"); process.exit(2); }

const SC = require("./selfchecks.js");
const { log, chans, mk, db, sortQ, gatedVals, mean, r2, rng, pearson, trim, analyseBuf, INDEP, independence, summarise, descSummary, stripData, mapCh, pinkNoise, matchFrac, hasIssue, fin, descInvariant, CHECKS } = SC;

/* ---------------- effects versus the best static EQ ---------------- */
// How much of what a tool changed could a fixed EQ have done? See FX.eqExplained.
const eqExplained = (dry, wet, sr) => FX.eqExplained(dry, wet, sr);
async function runFx(A, name) {
  const src = A.buf, sr = src.sampleRate, out = [];
  const add = async (tool, params, r, extra) => {
    const wet = r.outputs[0].buf, B = await analyseBuf(wet, name), s0 = A.sum, s1 = summarise(B);
    const e = await eqExplained(chans(src), chans(wet), sr);
    out.push(Object.assign({ tool, params: JSON.stringify(params), report: r.report.join(". "), dLufs: r2(s1.lufs - s0.lufs, 2), harsh: [s0.harsh, s1.harsh], harshP90: [s0.harshP90, s1.harshP90], sharp: [s0.sharp, s1.sharp], layers: [s0.layers, s1.layers], events: [s0.tags, s1.tags] }, e, extra || {}));
  };
  const pDh = { mode: "relative", amount: 0.6, threshold: 0.15, maxCut: 9, match: true, delta: true };
  await add("deharsh", pDh, await FX.deharsh(src, A, pDh));
  if (A.X.layers.length >= 2) {
    const gains = A.X.layers.map((l, i) => i === 0 ? -12 : 0), pL = { gains, match: true };
    await add("layers", { lowestLayer: -12, match: true }, await FX.layerMix(src, A, pL));
  }
  if (A.F.dur <= 180) { const pH = { attackDb: 6, bodyDb: -6, match: true }; await add("hpss", pH, await FX.hpss(src, A, pH)); }
  if (A.F.dur <= 10) {
    const pV = { count: 3, layerDb: 3, pitch: 1, grains: true }, r = await FX.variations(src, A, pV);
    const es = await Promise.all(r.outputs.map(o => eqExplained(chans(src), chans(o.buf), sr)));
    out.push({ tool: "variations", params: JSON.stringify(pV), report: r.report.join(". "), change: r2(mean(es.map(e => e.change)), 2), notEq: r2(mean(es.map(e => e.notEq)), 2), eqShare: r2(mean(es.map(e => e.eqShare).filter(isFinite)), 2), dynShare: r2(mean(es.map(e => e.dynShare).filter(isFinite)), 2), autoShare: r2(mean(es.map(e => e.autoShare).filter(isFinite)), 2) });
  }
  return out;
}

/* ---------------- HTML report ---------------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function svgStrip(d, dur) {
  const W = 900, H = 96, cols = d.wave.length, x = c => (c + 0.5) * W / cols, xt = t => t / dur * W, mid = H / 2;
  const wave = d.wave.map(([a, b], c) => `M${x(c).toFixed(1)} ${(mid - b * mid * 0.95).toFixed(1)}V${(mid - a * mid * 0.95).toFixed(1)}`).join("");
  const line = (arr, cls) => { let p = "", pen = false; arr.forEach((v, c) => { if (v == null) { pen = false; return; } p += (pen ? "L" : "M") + x(c).toFixed(1) + " " + (H - 4 - v * (H - 8)).toFixed(1); pen = true; }); return `<path class="${cls}" d="${p}"/>`; };
  const ticks = d.downbeats.map(t => `<line class="db" x1="${xt(t).toFixed(1)}" x2="${xt(t).toFixed(1)}" y1="${H - 6}" y2="${H}"/>`).join("");
  const bounds = d.bounds.map(([t, l]) => `<line class="bd" x1="${xt(t).toFixed(1)}" x2="${xt(t).toFixed(1)}" y1="0" y2="${H}"/><text class="lab" x="${(xt(t) + 3).toFixed(1)}" y="11">${esc(l)}</text>`).join("");
  const evs = d.events.length <= 60 ? d.events.map(([t, g]) => `<path class="ev" d="M${xt(t).toFixed(1)} ${H - 1}l-3 -5h6z"><title>${esc(g)} at ${t} s</title></path>`).join("") : "";
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Waveform with loudness, activity and tension curves"><path class="wave" d="${wave}"/>${bounds}${line(d.loud, "c1")}${line(d.act, "c2")}${line(d.tension, "c5")}${ticks}${evs}</svg>`;
}
function svgDesc(d, dur) {
  const W = 900, H = 34, cols = d.kurt.length, x = c => (c + 0.5) * W / cols;
  const u = K => K >= 0 ? 0.25 + 0.75 * Math.log1p(K) / Math.log1p(30) : 0.25 + 0.25 * Math.max(-1, K);
  const kb = d.kurt.map((K, c) => K == null ? "" : `M${x(c).toFixed(1)} ${(H - 1 - 0.25 * (H - 2)).toFixed(1)}V${(H - 1 - u(K) * (H - 2)).toFixed(1)}`).join("");
  const ab = d.arrow.map((T, c) => T == null ? "" : `M${x(c).toFixed(1)} ${(H / 2).toFixed(1)}V${(H / 2 - Math.tanh(T / 2) * (H / 2 - 1)).toFixed(1)}`).join("");
  return `<div class="dl"><span>N1 impulsiveness</span><svg class="ds" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Spectral kurtosis over time"><line class="zl" x1="0" x2="${W}" y1="${(H - 1 - 0.25 * (H - 2)).toFixed(1)}" y2="${(H - 1 - 0.25 * (H - 2)).toFixed(1)}"/><path class="kb" d="${kb}"/></svg></div>
<div class="dl"><span>N6 arrow of time</span><svg class="ds" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Arrow of time over time"><line class="zl" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><path class="ab" d="${ab}"/></svg></div>`;
}
function descTables(files) {
  const classes = [...new Set(files.map(f => f.sum.cls))];
  const med = (vals) => { const v = vals.filter(Number.isFinite).sort((a, b) => a - b), h = v.length >> 1; return !v.length ? NaN : v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
  const fmt = (v, d) => Number.isFinite(v) ? v.toFixed(d) : "–";
  const rows = [["Impulsiveness, kurtosis K", "K", 1], ["Repetition found (share of files)", "repShare", 0], ["Speech-rate modulation (dB)", "speech", 1], ["Burstiness B", "B", 2], ["Temporal entropy Ht", "Ht", 2], ["Arrow of time T(20 ms)", "T20", 2], ["Periodicity, CPP (dB)", "cpp", 1], ["Phase coherence", "pci", 2], ["Interest, predictive information (nats)", "pir", 3], ["Recurrence rate", "RR", 2], ["Laminarity", "LAM", 2], ["Ring time (s)", "ring", 2]];
  const val = (cl, key) => { const fs = files.filter(f => cl === "all" || f.sum.cls === cl); if (key === "repShare") return fs.length ? 100 * fs.filter(f => Number.isFinite(f.sum.rep)).length / fs.length : NaN; return med(fs.map(f => f.sum[key])); };
  const t1 = `<table><tr><th>Median over files</th><th>All</th>${classes.map(c => `<th>${esc(c)} (${files.filter(f => f.sum.cls === c).length})</th>`).join("")}</tr>${rows.map(([lab, key, d]) => `<tr><td>${esc(lab)}</td><td>${fmt(val("all", key), d)}${key === "repShare" ? "%" : ""}</td>${classes.map(c => `<td>${fmt(val(c, key), d)}${key === "repShare" ? "%" : ""}</td>`).join("")}</tr>`).join("")}</table>`;
  const mats = {}; for (const f of files) if (f.sum.material) mats[f.sum.material] = (mats[f.sum.material] || 0) + 1;
  const keys = Object.keys(INDEP);
  const t2 = `<table><tr><th>Curve</th><th>Median |r| with loudness</th><th>Files where it moves on its own (|r| &lt; 0.3)</th>${classes.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${keys.map(k => { const all = files.map(f => f.indep && f.indep[k]).filter(Number.isFinite); const own = all.length ? Math.round(100 * all.filter(v => v < 0.3).length / all.length) + "%" : "–"; return `<tr><td>${k.toUpperCase()} ${esc(INDEP[k])}</td><td>${fmt(med(all), 2)}</td><td>${own} (${all.length})</td>${classes.map(c => `<td>${fmt(med(files.filter(f => f.sum.cls === c).map(f => f.indep && f.indep[k])), 2)}</td>`).join("")}</tr>`; }).join("")}</table>`;
  return `<h2>Cross-field descriptors</h2><p>Medians per detected class. Material counts: ${Object.entries(mats).map(([m, n]) => esc(m) + " " + n).join(", ") || "none"}.</p><div class="tw">${t1}</div>
<h3>Do they add information beyond loudness?</h3><p>Correlation between each curve's column-to-column changes and loudness's (400 columns, silence left out). Near 0 means the curve moves on its own; it does not by itself mean the curve is useful.</p><div class="tw">${t2}</div>`;
}
function report(files, checks, fx) {
  const ids = CHECKS.map(c => c.id);
  const rate = (rows, f) => { const v = rows.filter(f); return v.length ? Math.round(100 * v.filter(r => r.pass).length / v.length) + "% (" + v.filter(r => r.pass).length + "/" + v.length + ")" : "–"; };
  const names = [...new Set(checks.map(c => c.check + ": " + c.what))];
  const classes = [...new Set(files.map(f => f.sum.cls))];
  const aggRows = names.map(n => `<tr><td>${esc(n)}</td><td>${rate(checks, c => c.check + ": " + c.what === n)}</td>${classes.map(cl => `<td>${rate(checks, c => c.check + ": " + c.what === n && c.cls === cl)}</td>`).join("")}</tr>`).join("");
  const fileRows = files.map((f, i) => {
    const s = f.sum, cks = checks.filter(c => c.file === f.name);
    const marks = ids.map(id => { const v = cks.filter(c => c.check === id); if (!v.length) return `<td class="na">–</td>`; const ok = v.every(c => c.pass); return `<td class="${ok ? "ok" : "no"}" title="${esc(v.map(c => (c.pass ? "✓ " : "✗ ") + c.what + ": " + c.value).join("\n"))}">${ok ? "✓" : "✗ " + v.filter(c => !c.pass).length}</td>`; }).join("");
    return `<section class="file"><h3>${esc(f.name)}</h3><p class="meta">${esc([s.cls, s.dur + " s", s.lufs + " LUFS", "LRA " + s.lra + " LU", s.tempoReliable ? s.tempo + " BPM" : "no steady beat", s.sections + " sections " + s.labels, s.events + " events", s.layers].join(" · "))}${s.issues ? `<br><span class="warn">${esc(s.issues)}</span>` : ""}</p>${svgStrip(f.strip, s.dur)}${f.strip.kurt ? svgDesc(f.strip, s.dur) : ""}<p class="meta">${esc(["K " + s.K + (s.kBand ? " (" + s.kBand + " Hz)" : ""), Number.isFinite(s.rep) ? "repeats " + s.rep + " Hz" : "no repetition", s.evN + " STA/LTA events", Number.isFinite(s.B) ? "burstiness " + s.B : null, "arrow " + (s.T20 ?? "steady"), "CPP " + s.cpp + " dB", "PIR " + s.pir, "recurs " + (Number.isFinite(s.RR) ? Math.round(s.RR * 100) + "%" : "–"), s.material ? s.material + (Number.isFinite(s.ring) ? ", ring " + s.ring + " s" : "") : null].filter(Boolean).join(" · "))}</p>${checks.length ? `<table class="mini"><tr>${ids.map(id => `<th>${id}</th>`).join("")}</tr><tr>${marks}</tr></table>` : ""}</section>`;
  }).join("");
  const fxRows = fx.map(r => `<tr><td>${esc(r.file)}</td><td>${esc(r.tool)}</td><td>${r.change ?? "–"}</td><td>${r.notEq ?? "–"}</td><td>${r.eqShare != null ? Math.round(r.eqShare * 100) + "%" : "–"}</td><td>${r.dynShare != null ? Math.round(r.dynShare * 100) + "%" : "–"}</td><td>${r.autoShare != null ? Math.round(r.autoShare * 100) + "%" : "–"}</td><td>${r.harsh ? r.harsh.join(" → ") : ""}</td><td>${r.dLufs ?? ""}</td><td class="rep">${esc(r.report)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playhead batch report</title><style>
:root{--bg:#fbfbfa;--ink:#1d1d1b;--ink2:#55554f;--rule:#deded8;--wave:#b9b9b2;--c1:#2a6fdb;--c2:#d9480f;--c5:#7b3fbf;--ok:#1f7a3a;--no:#b42318;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--ink:#ecece8;--ink2:#a5a59e;--rule:#34342f;--wave:#56564f;--c1:#6ea2ff;--c2:#ff8a4c;--c5:#c09bff;--ok:#5cc47a;--no:#ff7b6e;--card:#1e1e1c}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}h3{font-size:14px;margin:0 0 2px;overflow-wrap:anywhere}p{margin:4px 0 10px}.meta{color:var(--ink2);font-size:12.5px}.warn{color:var(--no)}
.file{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px 12px;margin:10px 0}svg{width:100%;height:96px;display:block;margin:6px 0}
.wave{stroke:var(--wave);stroke-width:1.2;fill:none}.c1,.c2,.c5{fill:none;stroke-width:1.6;vector-effect:non-scaling-stroke}.c1{stroke:var(--c1)}.c2{stroke:var(--c2)}.c5{stroke:var(--c5);stroke-dasharray:4 3}
.db{stroke:var(--ink2);stroke-width:1}.bd{stroke:var(--ink);stroke-width:1;stroke-dasharray:2 2}.lab{fill:var(--ink);font-size:10px}.ev{fill:var(--ink2)}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--rule);padding:4px 6px;text-align:left;vertical-align:top}th{font-weight:600}.tw{overflow-x:auto}
.mini td,.mini th{text-align:center;font-size:11.5px;padding:2px 4px}.ok{color:var(--ok)}.no{color:var(--no);font-weight:600}.na{color:var(--ink2)}.rep{color:var(--ink2);font-size:11.5px}
.key span{display:inline-block;margin-right:14px;font-size:12.5px}.dl{position:relative}.dl span{position:absolute;left:3px;top:1px;font-size:10.5px;color:var(--ink2);background:var(--card);padding:0 3px;border-radius:2px;line-height:1.3}svg.ds{height:34px;margin:2px 0}.zl{stroke:var(--rule);stroke-width:1}.kb{stroke:var(--c2);stroke-width:2;vector-effect:non-scaling-stroke}.ab{stroke:var(--c1);stroke-width:2;vector-effect:non-scaling-stroke}.key i{display:inline-block;width:18px;height:3px;vertical-align:middle;margin-right:5px}
</style></head><body><main>
<h1>Playhead batch report</h1><p class="meta">${files.length} files · ${new Date().toISOString().slice(0, 16).replace("T", " ")} · sample rate ${opt.sr || "native"} · first ${opt.maxDur} s analysed</p>
<p class="key"><span><i style="background:var(--wave)"></i>waveform</span><span><i style="background:var(--c1)"></i>loudness (C1)</span><span><i style="background:var(--c2)"></i>activity (C2)</span><span><i style="background:var(--c5)"></i>tension (C5)</span><span>ticks: downbeats · dashed: sections · ▲ events</span></p>
${checks.length ? `<h2>Self-checks</h2><p>Each check edits the file in a way whose correct answer is known (for example, a copy 12 dB quieter must measure 12.0 LU lower and should not change activity) and re-analyses it. Pass rates by check, overall and by detected class:</p><div class="tw"><table><tr><th>Check</th><th>All</th>${classes.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${aggRows}</table></div>` : ""}
${fx.length ? `<h2>Tools compared with a static EQ</h2><p><b>Change</b> is the average spectrogram change in dB (power-weighted). <b>Not EQ</b> is what remains after applying the single fixed EQ that best matches the result's long-term spectrum. <b>EQ share</b> is how much of the change that EQ reproduces: near 100% means an ordinary EQ would do, near 0% means the change depends on time and content. <b>Dynamic EQ</b> adds the best third-octave gains that follow each band's own input level (an ideal dynamic EQ or multiband compressor), <b>Automation</b> the best third-octave gains at 0.1 s resolution (an ideal automated EQ); both are fitted to this output, so they are upper bounds.</p><div class="tw"><table><tr><th>File</th><th>Tool</th><th>Change dB</th><th>Not EQ dB</th><th>EQ share</th><th>Dynamic EQ</th><th>Automation</th><th>Harshness</th><th>ΔLUFS</th><th>Tool report</th></tr>${fxRows}</table></div>` : ""}
${descTables(files)}
<h2>Files</h2>${fileRows}
</main></body></html>`;
}

/* ---------------- CSV ---------------- */
function csv(rows, cols) {
  const q = v => { const s = v == null ? "" : Array.isArray(v) ? v.join(" -> ") : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(",") + "\n" + rows.map(r => cols.map(c => q(r[c])).join(",")).join("\n") + "\n";
}

/* ---------------- main ---------------- */
(async () => {
  let list = IO.listAudio(inputs);
  if (opt.limit) list = list.slice(0, opt.limit);
  if (!list.length) { console.error("no audio files found"); process.exit(1); }
  if (!IO.hasFfmpeg()) log("ffmpeg not found: only WAV files will be read, at their own sample rate");
  fs.mkdirSync(opt.out, { recursive: true });
  // names relative to the deepest folder shared by all inputs
  let base = path.dirname(list[0]); while (!list.every(f => f.startsWith(base + path.sep)) && base !== path.dirname(base)) base = path.dirname(base);
  const files = [], checks = [], fx = [], t0 = Date.now();
  const bufs = [];
  for (const [i, file] of list.entries()) {
    const name = path.relative(base, file);
    try {
      const tA = Date.now();
      const buf = trim(IO.readAudio(file, { sr: opt.sr || undefined }), opt.maxDur);
      const A = await analyseBuf(buf, path.basename(file));
      A.sum = summarise(A);
      const rec = { name, file, sum: A.sum, strip: stripData(A, 450), indep: independence(A), ms: Date.now() - tA };
      files.push(rec); bufs.push({ A, rec });
      log(`[${i + 1}/${list.length}] ${path.basename(file)}  ${A.sum.cls}, ${A.sum.dur} s, ${rec.ms} ms`);
    } catch (e) { log(`[${i + 1}/${list.length}] ${path.basename(file)}  skipped: ${e.message}`); }
  }
  // outputs are rewritten after every stage, so a long run leaves usable partial results
  const writeAll = () => {
    const sumCols = ["name", "cls", "dur", "sr", "ch", "lufs", "lra", "peakDb", "harsh", "harshP90", "sharp", "rough", "activity", "tensionRange", "tempo", "pulseClarity", "tempoReliable", "beats", "sections", "labels", "events", "tags", "pitchHz", "tonalShare", "layers", "issues", "K", "kBand", "rep", "repProm", "speech", "evN", "evRate", "B", "bValue", "Ht", "velUp", "velDown", "glide", "cpp", "pci", "T20", "pir", "surprisal", "symbols", "RR", "DET", "LAM", "ring", "logTau", "material", "ms"];
    fs.writeFileSync(path.join(opt.out, "summary.csv"), csv(files.map(f => Object.assign({ name: f.name, ms: f.ms }, f.sum)), sumCols));
    if (checks.length) fs.writeFileSync(path.join(opt.out, "checks.csv"), csv(checks, ["file", "cls", "check", "what", "value", "pass"]));
    if (fx.length) fs.writeFileSync(path.join(opt.out, "fx.csv"), csv(fx, ["file", "cls", "tool", "params", "change", "notEq", "eqShare", "dynShare", "autoShare", "dLufs", "harsh", "harshP90", "sharp", "layers", "events", "report"]));
    fs.writeFileSync(path.join(opt.out, "results.json"), JSON.stringify({ options: opt, files: files.map(f => ({ name: f.name, summary: f.sum, independence: f.indep, curves: f.strip, ms: f.ms })), checks, fx }, null, 1));
    fs.writeFileSync(path.join(opt.out, "report.html"), report(files, checks, fx));
  };
  writeAll();
  if (opt.checks) {
    for (const [i, { A, rec }] of bufs.entries()) {
      for (const C of CHECKS) {
        if (C.applies && !C.applies(A, A.sum)) continue;
        let other = null;
        if (C.pairs) { const cand = bufs.filter((x, j) => j !== i && x.A.sum.cls !== "sfx" && x.A.F.dur >= 15); if (!cand.length) continue; other = cand[(i + 1) % cand.length].A.buf; }
        try {
          const E = C.edit(A.buf, A, A.sum, other);
          const B = await analyseBuf(E, path.basename(rec.file)); B.sum = summarise(B);
          for (const row of C.expect(A, B, A.sum, E).filter(Boolean)) checks.push({ file: rec.name, cls: A.sum.cls, check: C.id, what: row[0], value: row[1], pass: !!row[2] });
        } catch (e) { checks.push({ file: rec.name, cls: A.sum.cls, check: C.id, what: "ran", value: e.message, pass: false }); }
      }
      if ((i & 7) === 7) writeAll();
      log(`checks ${i + 1}/${bufs.length} ${path.basename(rec.file)}: ${checks.filter(c => c.file === rec.name && !c.pass).length} failed`);
    }
  }
  if (opt.fx) {
    for (const [i, { A, rec }] of bufs.entries()) {
      try { for (const r of await runFx(A, path.basename(rec.file))) fx.push(Object.assign({ file: rec.name, cls: A.sum.cls }, r)); }
      catch (e) { fx.push({ file: rec.name, tool: "error", report: e.message }); }
      log(`tools ${i + 1}/${bufs.length} ${path.basename(rec.file)}`);
    }
  }
  writeAll();
  const pass = checks.filter(c => c.pass).length;
  log(`\n${files.length} files in ${((Date.now() - t0) / 1000).toFixed(0)} s` + (checks.length ? `; self-checks ${pass}/${checks.length} passed` : "") + `; wrote ${path.resolve(opt.out)}/report.html`);
})().catch(e => { console.error(e); process.exit(1); });
