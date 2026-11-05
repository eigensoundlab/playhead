#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Exports the analysis behind the paper's figures as JSON: the strip figure from the CC0 synthetic signals, and the
// "what the waveform hides" figure from the author's own sound experiments/paper/robot-hit-steel.wav (no third-party audio):
//   node tools/paper-data.js [--out experiments/paper/figure-data.json]     also writes experiments/paper/robot-data.json
// The figures themselves are drawn by experiments/paper/figures.py.
"use strict";
const fs = require("fs"), path = require("path");
const WL = require("../src/analysis.js"), PHD = require("../src/descriptors.js"), P = require("../src/probes.js"), SC = require("./selfchecks.js");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(__dirname, "../experiments/paper/figure-data.json");
const r = (v, d) => Number.isFinite(v) ? Number(v.toFixed(d)) : null;

(async () => {
  const sr = 44100;
  // (a) cue arc: curves, beats and sections against the parts it was built from
  const arc = P.makeCueArc(sr, WL.kFilterCoeffs);
  const A = await SC.analyseBuf(arc, "Cue arc");
  const strip = SC.stripData(A, 900);
  const cue = {
    dur: r(arc.duration, 3), strip,
    truth: arc.segments.map(s => ({ label: s.label, t0: r(s.t0, 2), t1: r(s.t1, 2) })),
    detected: A.St.segs.map(s => ({ label: s.label, t0: r(s.t0, 2), t1: r(s.t1, 2) })),
    tempo: r(A.R.tempo, 1)
  };
  // (b) descriptor tour: four descriptors that have a closed-form value on each segment
  const tour = P.makeDescriptorTour(sr);
  const F = await WL.analyse(tour), D = await PHD.describe(F, tour), cols = 900;
  const pool = (k, mode) => Array.from(PHD.poolNaN(D.curves[k], cols, mode), v => r(v, 3));
  const desc = {
    dur: r(tour.duration, 3),
    segments: tour.segments.map(s => ({ label: s.label, t0: r(s.t0, 2), t1: r(s.t1, 2), note: s.note })),
    kurt: pool("kurt", "mean"), vel: pool("vel", "mean"), pci: pool("pci", "mean"), arrow: pool("arrow", "mean"),
    wave: SC.stripData({ F, cur: WL.computeCurves(F, "rhythmic", { scale: "fixed" }), R: { reliable: false }, St: { segs: [] }, X: { events: [] }, D, buf: tour }, cols).wave
  };
  // (c) a robot hit on steel: the curves of the "Sound character" and "Hits and surprise" looks, normalised as drawStrip
  // draws them (curves N1-N9 between their 5th and 95th percentiles, the others on their fixed 0..1 scale), and the
  // timbre of the tail measured directly, for the caption
  const IO = require("./audio-io.js"), PH = require("../src/playhead.js"), FX = require("../src/effects.js");
  const rbuf = IO.readAudio(path.join(__dirname, "../experiments/paper/robot-hit-steel.wav")), rsr = rbuf.sampleRate, x = rbuf.getChannelData(0), rn = x.length;
  const doc = await PH.analyze(rbuf, { name: "robot-hit-steel", profile: "sfx" }), C = doc.curves;
  const norm = (name, arr) => {
    const v = arr.filter(q => q != null).sort((p, q) => p - q);
    const [lo, hi] = /^n\d/.test(name) ? [v[Math.floor(0.05 * (v.length - 1))], v[Math.floor(0.95 * (v.length - 1))]] : [0, 1];
    return { lo: r(lo, 4), hi: r(hi, 4), v: arr.map(q => (q == null ? null : r(Math.max(0, Math.min(1, (q - lo) / (hi - lo || 1))), 4))) };
  };
  const wcols = 600, wave = [];
  for (let c = 0; c < wcols; c++) { let mn = 0, mx = 0; for (let i = Math.floor(c * rn / wcols); i < Math.floor((c + 1) * rn / wcols); i++) { mn = Math.min(mn, x[i]); mx = Math.max(mx, x[i]); } wave.push([r(mn, 4), r(mx, 4)]); }
  // tail timbre: spectral centroid and the share of energy below 700 Hz in two windows; level of the tail re the loudest 10 ms
  const N = 2048, { M, nF, bins, H } = await FX.stftMagnitudes([x], rsr, N);
  const timbre = (t0, t1) => { let s = 0, w = 0, lo = 0;
    for (let f = 0; f < nF; f++) { const tc = (f * H) / rsr; if (tc < t0 || tc >= t1) continue;
      for (let k = 1; k < bins; k++) { const p = M[f * bins + k] ** 2, hz = k * rsr / N; s += p * hz; w += p; if (hz < 700) lo += p; } }
    return { t0, t1, centroidHz: r(s / w, 0), below700: r(lo / w, 3) }; };
  const w10 = Math.round(0.01 * rsr), rms = (a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return 10 * Math.log10(e / Math.max(1, b - a) + 1e-20); };
  let top = -Infinity; for (let i = 0; i + w10 <= rn; i += w10) top = Math.max(top, rms(i, i + w10));
  const tailDb = r(rms(Math.round(1.0 * rsr), Math.round(1.1 * rsr)) - top, 1);
  // the partials left in the tail: the strongest peaks of the power spectrum averaged over 1.0-1.1 s (8192 points)
  const N8 = 8192, P8 = await FX.stftMagnitudes([x], rsr, N8), avg = new Float64Array(P8.bins); let nfr = 0;
  for (let f = 0; f < P8.nF; f++) { const tc = (f * P8.H) / rsr; if (tc < 1.0 || tc >= 1.1) continue; nfr++; for (let k = 0; k < P8.bins; k++) avg[k] += P8.M[f * P8.bins + k] ** 2; }
  const peaks = []; for (let k = 2; k < P8.bins - 2; k++) if (avg[k] > avg[k - 1] && avg[k] >= avg[k + 1] && avg[k] > avg[k - 2] && avg[k] >= avg[k + 2]) peaks.push([k * rsr / N8, avg[k]]);
  peaks.sort((p, q) => q[1] - p[1]);
  const top3 = peaks.slice(0, 3).map(p => Math.round(p[0])).sort((p, q) => p - q);
  const robot = {
    file: "experiments/paper/robot-hit-steel.wav", sr: rsr, dur: r(rn / rsr, 3), rate: C.rate, wave,
    onsets: doc.onsets, events: doc.events.map(e => ({ start: e.start, end: e.end, word: e.word })),
    curves: Object.fromEntries(["onsetStrength", "harshness", "n1Kurtosis", "n7Surprisal"].map(k => [k, norm(k, C[k])])),
    timbre: [timbre(0.3, 0.4), timbre(1.0, 1.1)], tailDb, tailPartialsHz: top3
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(out), "robot-data.json"), JSON.stringify({ generated: "tools/paper-data.js", version: require("../package.json").version, robot }));
  console.log("wrote", path.join(path.dirname(out), "robot-data.json"));
  fs.writeFileSync(out, JSON.stringify({ generated: "tools/paper-data.js", version: require("../package.json").version, cue, desc }));
  console.log("wrote", out);
})().catch(e => { console.error(e); process.exit(1); });
