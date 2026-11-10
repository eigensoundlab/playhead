// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead's BS.1770 measures against EBU Tech 3341 (v4, 2023), Table 1 "Minimum requirements test signals": the cases
// the document defines by a formula (1 to 5 and 9 to 19), built from the recipes in fixtures/ebu-tech-3341-3342.json.
// That file is written by listener (https://github.com/eigensoundlab/listener): `listener conform --fixtures <folder>`.
// Not covered: the 5.0 case (6), the two programme recordings (7 and 8), which need the EBU's own files, and the
// true-peak cases made at four times the sample rate (20 to 23).
"use strict";
const fs = require("fs"), path = require("path");

module.exports = async function (check) {
  const P = require("../src/playhead.js"), IO = require("../tools/audio-io.js");
  require("../src/levels.js");
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ebu-tech-3341-3342.json"), "utf8")), sr = fx.sampleRate;
  const val = (v, i) => typeof v === "string" ? Function("i", "return " + v)(i) : v;   // "-38 + i" in the recipes
  const render = parts => {                              // [[dBFS or null, seconds], ...] -> stereo, same phase
    const d = new Float32Array(parts.reduce((s, p) => s + Math.round(p[1] * sr), 0));
    let o = 0;
    for (const [db, sec] of parts) {
      const len = Math.round(sec * sr), a = db == null ? 0 : Math.pow(10, db / 20);
      for (let i = 0; i < len; i++) d[o + i] = a * Math.sin(2 * Math.PI * 1000 * i / sr);
      o += len;
    }
    return IO.makeBuffer(sr, [d, Float32Array.from(d)]);
  };
  const levels = async buf => (await P.analyze(buf, { profile: "fast" })).summary.levels;
  const within = (got, expected, tol) => { const lo = Array.isArray(tol) ? tol[0] : -tol, hi = Array.isArray(tol) ? tol[1] : tol, d = got - expected; return d >= lo - 0.0051 && d <= hi + 0.0051; };   // values are rounded to 0.01
  const worst = { integrated: 0, shortTermMax: 0, momentaryMax: 0, truePeak: 0 }, bad = [];
  const one = (name, measure, got, expected, tol) => { worst[measure] = Math.max(worst[measure], Math.abs(got - expected)); if (!within(got, expected, tol)) bad.push(name + " " + got + " (expected " + expected + ")"); };

  for (const c of fx.integrated) one("case " + c.case, "integrated", (await levels(render(c.parts))).file.integrated, c.expected, c.tolerance);
  for (const [key, measure] of [["shortTerm", "shortTermMax"], ["momentary", "momentaryMax"]]) for (const c of fx[key]) {
    if (c.parts) {
      const parts = []; for (let r = 0; r < c.repeat; r++) parts.push(...c.parts);
      one("case " + c.case, measure, (await levels(render(parts))).file[measure], c.expected, c.tolerance);
    } else for (const i of [0, 7, 13, 19]) {
      const parts = [[null, val(c.silenceBefore, i)], [val(c.tone[0], i), c.tone[1]], [null, val(c.silenceAfter, i)]];
      one("case " + c.case + " segment " + i, measure, (await levels(render(parts))).file[measure], val(c.expected, i), c.tolerance);
    }
  }
  for (const c of fx.truePeak) {
    const n = Math.round(0.5 * sr), fade = Math.round(0.01 * sr), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = c.amplitude * Math.sin(2 * Math.PI * i / c.period + c.phaseDeg * Math.PI / 180) * Math.min(1, i / fade, (n - 1 - i) / fade);
    one("case " + c.case, "truePeak", (await levels(IO.makeBuffer(sr, [d, Float32Array.from(d)]))).truePeak, c.expected, c.tolerance);
  }
  const f2 = v => v.toFixed(2);
  check("levels: EBU Tech 3341 minimum requirements, the cases defined by a formula (1-5: integrated; 9-11: short-term; 12-14: momentary; 15-19: true peak), each within the document's tolerance",
    "I " + f2(worst.integrated) + " S " + f2(worst.shortTermMax) + " M " + f2(worst.momentaryMax) + " TP " + f2(worst.truePeak),
    bad.length === 0, bad.length ? bad.join("; ") : "largest deviations in LU and dB; tolerance 0.1 LU, true peak +0.2/-0.4 dB");
};
