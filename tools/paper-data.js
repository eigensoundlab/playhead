#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Exports the analysis behind the paper's strip figure as JSON, from the CC0 synthetic signals (no third-party audio):
//   node tools/paper-data.js [--out experiments/paper/figure-data.json]
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
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generated: "tools/paper-data.js", version: require("../package.json").version, cue, desc }));
  console.log("wrote", out);
})().catch(e => { console.error(e); process.exit(1); });
