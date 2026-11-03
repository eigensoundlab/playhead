#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Per-stage timing of the analysis on files of different lengths (Node; the browser runs the same JavaScript on V8).
//   node tools/profile.js <file>...   (or no arguments: synthetic 2 s, 30 s, 120 s and 300 s test signals)
//   --fx   also time the rendering of each analysis-driven tool, and the bare STFT engine they share
"use strict";
const WL = require("../src/analysis.js");
const PHD = require("../src/descriptors.js");
const IO = require("./audio-io.js");
const P = require("../src/probes.js");
const FX = require("../src/effects.js");
const FXON = process.argv.includes("--fx");
const now = () => Number(process.hrtime.bigint()) / 1e6;

async function profile(buf, name) {
  const T = {}; let t = now(); const lap = k => { const u = now(); T[k] = u - t; t = u; };
  await WL.calibrate(buf.sampleRate); lap("calibrate");
  const F = await WL.extractFeatures(buf, () => {}); lap("features");
  let cur = WL.computeCurves(F, "rhythmic", { scale: "fixed" }); lap("baseCurves");
  F.guess = WL.guessClass(F); lap("classGuess");
  const R = WL.rhythmOf(F); lap("rhythm");
  const St = WL.structureOf(F); lap("structure");
  WL.eventsOf(F); lap("events");
  const X = WL.sfxOf(F, buf, name); lap("sfx");
  const D = await PHD.describe(F, buf); lap("descriptors");
  const total = Object.values(T).reduce((a, b) => a + b, 0);
  const E = {};
  if (FXON) {
    cur = WL.computeCurves(F, F.guess, { scale: "fixed" });
    const an = { F, cur, R, St, X, D, buf }, ch = FX.chansOf(buf), sr = buf.sampleRate, N = buf.duration <= 6 ? 1024 : 2048;
    const time = async (k, fn) => { const t0 = now(); await fn(); E[k] = now() - t0; };
    await time("STFT engine", () => FX.stftApply(ch, sr, N, () => {}));
    await time("de-harsh", () => FX.deharsh(buf, an, { mode: "relative", amount: 0.6, threshold: 0.15, maxCut: 9, match: true, delta: true }));
    await time("layer remix", () => X.layers.length >= 2 ? FX.layerMix(buf, an, { gains: X.layers.map((l, i) => i ? 0 : -12), match: true }) : null);
    await time("attack/body", () => FX.hpss(buf, an, { attackDb: 6, bodyDb: -6, match: true }));
    await time("tension", () => FX.tensionShape(buf, an, { contrast: 0.5, bright: 0.4 }));
    await time("loop", () => FX.loopMaker(buf, an, { xfadeMs: 120, minLen: 0.5 }));
    await time("4 variations", () => FX.variations(buf, an, { count: 4, layerDb: 3, pitch: 1, grains: true }));
    await time("EQ comparison", () => FX.eqExplained(ch, ch, sr));
  }
  return { name, dur: buf.duration, T, D: D.timing, E, total, rtf: buf.duration / (total / 1000), heapMB: process.memoryUsage().heapUsed / 1048576 };
}
function cat(bufs, maxS) {
  const sr = 44100, parts = []; let n = 0;
  for (const b of bufs) { const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L; parts.push([L, R]); n += L.length; if (n >= maxS * sr) break; }
  n = Math.min(n, Math.round(maxS * sr)); const L = new Float32Array(n), R = new Float32Array(n); let o = 0;
  for (const [a, b] of parts) { const k = Math.min(a.length, n - o); L.set(a.subarray(0, k), o); R.set(b.subarray(0, k), o); o += k; if (o >= n) break; }
  return IO.makeBuffer(sr, [L, R]);
}
(async () => {
  const args = process.argv.slice(2);
  let tests;
  const files = args.filter(a => !a.startsWith("--"));
  if (files.length) tests = files.map(f => [require("path").basename(f), IO.readAudio(f, { sr: 44100 })]);
  else {
    const arc = P.makeCueArc(44100, WL.kFilterCoeffs), kit = P.makeSfxKit(44100, WL.kFilterCoeffs);
    tests = [["2 s sound effect", kit.find(b => b.name.includes("Glass"))], ["30 s music", cat([arc], 30)], ["120 s music", cat([arc, arc], 120)], ["300 s music", cat([arc, arc, arc, arc, arc], 300)]];
  }
  const rows = [];
  for (const [name, buf] of tests) { const r = await profile(buf, name); rows.push(r); }
  const keys = Object.keys(rows[0].T), dkeys = Object.keys(rows[0].D);
  const pad = (s, n) => String(s).padStart(n);
  console.log("stage (ms)".padEnd(16) + rows.map(r => pad(r.name.slice(0, 16), 17)).join(""));
  for (const k of keys) console.log(k.padEnd(16) + rows.map(r => pad(r.T[k].toFixed(0), 17)).join(""));
  for (const k of dkeys) console.log(("  " + k).padEnd(16) + rows.map(r => pad((r.D[k] || 0).toFixed(0), 17)).join(""));
  console.log("total".padEnd(16) + rows.map(r => pad(r.total.toFixed(0), 17)).join(""));
  console.log("× real time".padEnd(16) + rows.map(r => pad(r.rtf.toFixed(1), 17)).join(""));
  console.log("heap MB".padEnd(16) + rows.map(r => pad(r.heapMB.toFixed(0), 17)).join(""));
  if (FXON) { console.log("\ntool render (ms)"); for (const k of Object.keys(rows[0].E)) console.log(k.padEnd(16) + rows.map(r => pad(r.E[k].toFixed(0), 17)).join("")); }
})().catch(e => { console.error(e); process.exit(1); });
