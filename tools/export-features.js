#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Exports one feature vector per audio file, for classification or similarity experiments.
//   node tools/export-features.js <files or folders...> [--out features.csv] [--workers 2] [--max-dur 30]
//
// Columns, grouped by prefix:
//   mfcc_*  MFCC baseline: mean and standard deviation of coefficients 0-12 over sounding frames (40 mel bands)
//   pa_*    Playhead psychoacoustic curves: loudness, loudness range, sharpness, roughness, fluctuation, harshness,
//           activity, onset density, flatness (means and 90th percentiles)
//   nd_*    cross-field descriptors N1-N9 (src/descriptors.js): whole-file values plus a few curve statistics
// Missing values are left empty (for example burstiness with fewer than four events).
"use strict";
const { Worker, isMainThread, parentPort } = require("worker_threads");
const path = require("path");
const fs = require("fs");

function featuresOf(A) {
  const WL = require("../src/analysis.js"), FX = require("../src/effects.js");
  const { F, cur, D, buf } = A, g = cur.gate, n = F.nF, B = 40, o = {};
  const sound = []; for (let m = 0; m < n; m++) if (g[m]) sound.push(m);
  const frames = sound.length >= 3 ? sound : Array.from({ length: n }, (_, m) => m);
  const stat = (arr, sel) => { const v = []; for (const m of sel) { const x = arr[m]; if (Number.isFinite(x)) v.push(x); } if (!v.length) return [NaN, NaN, NaN]; const mu = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); v.sort((a, b) => a - b); return [mu, sd, v[Math.floor(0.9 * (v.length - 1))]]; };
  // A: MFCC baseline
  const mf = Array.from({ length: 13 }, () => new Float64Array(n));
  for (let m = 0; m < n; m++) for (let d = 0; d <= 12; d++) { let s = 0; for (let k = 0; k < B; k++) s += F.melDb[m * B + k] * Math.cos(Math.PI * d * (k + 0.5) / B); mf[d][m] = s * Math.sqrt((d ? 2 : 1) / B); }
  for (let d = 0; d <= 12; d++) { const [mu, sd] = stat(mf[d], frames); o["mfcc_" + d + "_mean"] = mu; o["mfcc_" + d + "_std"] = sd; }
  // B: psychoacoustic curves
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  o.pa_lufs = FX.lufsOf(chans, buf.sampleRate);
  { const lt = []; for (const m of frames) if (Number.isFinite(cur.lufs[m])) lt.push(cur.lufs[m]); lt.sort((a, b) => a - b); o.pa_lra = lt.length ? lt[Math.floor(0.95 * (lt.length - 1))] - lt[Math.floor(0.1 * (lt.length - 1))] : NaN; }
  for (const [k, arr] of [["sharp", cur.raw.sharp], ["rough", cur.raw.Rr], ["fluct", cur.raw.Fl], ["harsh", cur.raw.hfac], ["activity", cur.curves.c2], ["onsetdens", cur.raw.ED], ["flat", cur.raw.sfm], ["loud", cur.curves.c1]]) { const [mu, , p90] = stat(arr, frames); o["pa_" + k + "_mean"] = mu; o["pa_" + k + "_p90"] = p90; }
  // C: cross-field descriptors
  const s = D.summary, C = D.curves, fin = Number.isFinite, all = Array.from({ length: n }, (_, m) => m);
  o.nd_kurt_K = s.kurtosis.K; o.nd_kurt_Kmax = s.kurtosis.Kmax; s.kurtosis.bands.forEach((v, i) => { o["nd_kurt_band" + i] = v; });
  o.nd_kurt_p90 = stat(C.kurt, all)[2];
  o.nd_rep_found = fin(s.repetition.hz) ? 1 : 0; o.nd_rep_log2hz = fin(s.repetition.hz) ? Math.log2(s.repetition.hz) : NaN; o.nd_rep_prom = s.repetition.prom; o.nd_rep_speech = s.repetition.speech;
  const e = s.events; o.nd_ev_lograte = Math.log10(e.rate + 0.05); o.nd_ev_meandur = e.meanDur; o.nd_ev_active = e.active; o.nd_ev_B = e.B; o.nd_ev_b = e.bN >= 20 ? e.bValue : NaN; o.nd_ev_Ht = e.Ht;
  o.nd_mot_up = s.motion.up; o.nd_mot_down = s.motion.down; o.nd_mot_net = s.motion.net; o.nd_mot_medabs = s.motion.medianAbs; o.nd_mot_reshape = stat(C.reshape, all)[0];
  o.nd_cpp = s.periodicity.cpp; o.nd_cpp_p90 = s.periodicity.cppP90; o.nd_cpp_std = stat(C.cpp, all)[1]; o.nd_pci = s.periodicity.pci;
  o.nd_arrow_T5 = s.arrow.T5; o.nd_arrow_T20 = s.arrow.T20; o.nd_arrow_T80 = s.arrow.T80; o.nd_arrow_steady = fin(s.arrow.T20) ? 0 : 1; o.nd_arrow_std = stat(C.arrow, all)[1];
  o.nd_info_pir = s.info.pir; o.nd_info_surprisal = s.info.surprisal; o.nd_info_learn = s.info.info; o.nd_info_symbols = s.info.K;
  o.nd_rec_RR = s.recurrence.RR; o.nd_rec_DET = s.recurrence.DET; o.nd_rec_LAM = s.recurrence.LAM; o.nd_rec_TT = s.recurrence.TT;
  const dc = s.decay; o.nd_dec_n = dc.n; o.nd_dec_logt60 = fin(dc.t60) && dc.t60 > 0 ? Math.log10(dc.t60) : NaN; o.nd_dec_logtau = dc.logTau;
  o.nd_dec_damped = dc.material.startsWith("damped") ? 1 : 0; o.nd_dec_glass = dc.material === "glass-like" ? 1 : 0; o.nd_dec_metal = dc.material === "metal-like" ? 1 : 0; o.nd_dec_notmodal = dc.material === "not modal" ? 1 : 0;
  return o;
}

if (!isMainThread) {
  const WL = require("../src/analysis.js"), PHD = require("../src/descriptors.js"), IO = require("./audio-io.js"), SC = require("./selfchecks.js");
  parentPort.on("message", async job => {
    if (!job) process.exit(0);
    try {
      const buf = SC.trim(IO.readAudio(job.file, { sr: 44100 }), job.maxDur);
      // short clips all use the one-shot curve settings, so the smoothing does not depend on a class guess
      const F = await WL.analyse(buf), cur = WL.computeCurves(F, F.dur <= 10 ? "sfx" : F.guess, { scale: "fixed" }), D = await PHD.describe(F, buf);
      parentPort.postMessage({ name: job.name, cls: F.guess, f: featuresOf({ F, cur, D, buf }) });
    } catch (e) { parentPort.postMessage({ name: job.name, error: e.message }); }
  });
  return;
}

const IO = require("./audio-io.js");
const argv = process.argv.slice(2), opt = { out: "features.csv", workers: 2, maxDur: 30 }, inputs = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--out") opt.out = argv[++i]; else if (a === "--workers") opt.workers = Number(argv[++i]); else if (a === "--max-dur") opt.maxDur = Number(argv[++i]); else if (a === "--limit") opt.limit = Number(argv[++i]); else inputs.push(a); }
if (!inputs.length) { console.error("usage: node tools/export-features.js <files or folders...> [--out features.csv] [--workers 2]"); process.exit(2); }
let files = IO.listAudio(inputs); if (opt.limit) files = files.slice(0, opt.limit);
let base = path.dirname(files[0]); while (!files.every(f => f.startsWith(base + path.sep)) && base !== path.dirname(base)) base = path.dirname(base);
const t0 = Date.now(), out = [], queue = files.slice(); let active = 0, done = 0;
const finish = () => {
  const cols = [...new Set(out.filter(r => r.f).flatMap(r => Object.keys(r.f)))];
  const q = v => (v === undefined || v === null || !Number.isFinite(v)) ? "" : String(Math.round(v * 1e5) / 1e5);
  out.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(opt.out, ["file,cls," + cols.join(",")].concat(out.filter(r => r.f).map(r => [JSON.stringify(r.name), r.cls].concat(cols.map(c => q(r.f[c]))).join(","))).join("\n") + "\n");
  process.stderr.write(`${out.filter(r => r.f).length} files, ${cols.length} features, ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${opt.out}\n`);
  for (const r of out) if (r.error) process.stderr.write("  failed: " + r.name + ": " + r.error + "\n");
};
const next = w => { const f = queue.shift(); if (!f) { w.postMessage(null); if (--active === 0) finish(); return; } w.postMessage({ file: f, name: path.relative(base, f), maxDur: opt.maxDur }); };
for (let i = 0; i < Math.min(opt.workers, files.length); i++) {
  const w = new Worker(__filename); active++;
  w.on("message", m => { out.push(m); done++; if (done % 50 === 0 || done === files.length) process.stderr.write(`${done}/${files.length}\n`); next(w); });
  next(w);
}
