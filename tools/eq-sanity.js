#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Sanity check of the EQ-share measure (FX.eqExplained, paper Sec. 6.2) on edits whose answer is known: a low-pass
// filter (any EQ can do it), a slow gain ride (only automation can), and a pitch shift (no EQ can). Input: 20 s of the
// CC0 cue arc (10-30 s).
//   node tools/eq-sanity.js [--out experiments/paper/eq-sanity.json]
"use strict";
const fs = require("fs"), path = require("path");
const WL = require("../src/analysis.js"), FX = require("../src/effects.js"), P = require("../src/probes.js");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(__dirname, "../experiments/paper/eq-sanity.json");

(async () => {
  const sr = 44100;
  await WL.calibrate(sr);
  const arc = P.makeCueArc(sr, WL.kFilterCoeffs), off = 10 * sr, n = 20 * sr;
  const full = Array.from({ length: arc.numberOfChannels }, (_, c) => arc.getChannelData(c));
  const src = full.map(x => Float32Array.from(x.subarray(off, off + n)));
  const edits = {
    // second-order Butterworth low-pass at 2 kHz
    "low-pass 2 kHz": src.map(x => { const y = new Float32Array(n), w0 = 2 * Math.PI * 2000 / sr, al = Math.sin(w0) / (2 * Math.SQRT1_2), cw = Math.cos(w0), a0 = 1 + al;
      WL.biquadInto(x, y, [(1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, -2 * cw / a0, (1 - al) / a0]); return y; }),
    // the level rises and falls by 6 dB four times in 16 s
    "gain ride ±6 dB at 0.25 Hz": src.map(x => x.map((v, i) => v * Math.pow(10, 6 * Math.sin(2 * Math.PI * 0.25 * i / sr) / 20))),
    // two semitones up by resampling (linear interpolation), reading on past the window so the length stays the same
    "pitch +2 semitones": full.map(x => { const k = Math.pow(2, 2 / 12), y = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = off + i * k, j = Math.floor(t), f = t - j; y[i] = x[j] * (1 - f) + x[j + 1] * f; } return y; }),
  };
  const res = {};
  for (const [name, wet] of Object.entries(edits)) {
    const e = await FX.eqExplained(src, wet, sr);
    res[name] = { change: e.change, eqShare: e.eqShare, dynShare: e.dynShare, autoShare: e.autoShare };
    console.log(name.padEnd(28), `static ${Math.round(100 * e.eqShare)} %, dynamic ${Math.round(100 * e.dynShare)} %, automation ${Math.round(100 * e.autoShare)} %`);
  }
  fs.writeFileSync(out, JSON.stringify({ generated: "tools/eq-sanity.js", version: require("../package.json").version, input: "cue arc (CC0), 10-30 s", edits: res }, null, 1) + "\n");
  console.log("wrote", out);
})().catch(e => { console.error(e); process.exit(1); });
