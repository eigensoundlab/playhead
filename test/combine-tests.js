// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Combining documents (Playhead.align and Playhead.combine): the mix of two parts, one moved and turned down, predicted
// from their documents and compared with the mix's own analysis; gain and order; the result is a document like any other.
"use strict";

module.exports = async function (check) {
  const P = require("../src/playhead.js");
  const SR = 44100, n = 2 * SR;
  const tone = Float32Array.from({ length: n }, (_, i) => i < 1.5 * SR ? 0.5 * Math.sin(2 * Math.PI * 110 * i / SR) * Math.exp(-3 * i / SR) : 0);
  let s = 7;
  const burst = Float32Array.from({ length: n }, (_, i) => { s = (s * 16807) % 2147483647; return i < 0.5 * SR ? 0.3 * (s / 2147483647 * 2 - 1) * Math.exp(-6 * i / SR) : 0; });
  const o = { profile: "sfx", assetClass: "sfx", curveRate: 100 };
  const da = await P.analyze({ sampleRate: SR, channels: [tone] }, o), db = await P.analyze({ sampleRate: SR, channels: [burst] }, o);
  const g = Math.pow(10, -6 / 20), mix = Float32Array.from(tone, (v, i) => v + (i >= 0.5 * SR ? burst[i - 0.5 * SR] * g : 0));
  const dm = await P.analyze({ sampleRate: SR, channels: [mix] }, o);
  const parts = [{ doc: da }, { doc: db, offset: 0.5, gain: -6 }];
  const c = P.combine(parts, { rate: 100, duration: 2 });
  const pearson = (x, y) => {
    const idx = []; for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] != null && y[i] != null) idx.push(i);
    const X = idx.map(i => x[i]), Y = idx.map(i => y[i]), mx = X.reduce((a, v) => a + v, 0) / X.length, my = Y.reduce((a, v) => a + v, 0) / Y.length;
    let xy = 0, xx = 0, yy = 0; X.forEach((v, j) => { xy += (v - mx) * (Y[j] - my); xx += (v - mx) ** 2; yy += (Y[j] - my) ** 2; });
    return { r: xy / Math.sqrt(xx * yy), mae: X.reduce((a, v, j) => a + Math.abs(v - Y[j]), 0) / X.length };
  };
  {
    const L = pearson(c.curves.lufs, dm.curves.lufs), H = pearson(c.curves.harshness, dm.curves.harshness);
    check("combine: two parts, moved and turned down: LUFS", "r " + L.r.toFixed(3) + ", " + L.mae.toFixed(2) + " LU", L.r > 0.99 && L.mae < 0.5);
    check("combine: harshness (loudness + weighted excess)", "r " + H.r.toFixed(3), H.r > 0.95);
    const entry = (c.onsets || []).find(t => Math.abs(t - 0.5) < 0.03), sameCols = c.spectrum && c.spectrum.columns === dm.spectrum.columns && c.curves.lufs.length === dm.curves.lufs.length;
    check("combine: the moved part's start is an onset; columns match", (entry != null ? "onset " + entry : "no onset") + (sameCols ? ", " + c.curves.lufs.length + " columns" : ""), entry != null && sameCols);
  }
  {
    // one part turned down 6 dB: its LUFS 6 lower, its loudness 6/60 lower; swapping the parts changes nothing
    const one = P.combine([{ doc: db, gain: -6 }]);
    let worst = 0; db.curves.lufs.forEach((v, i) => { if (v != null) worst = Math.max(worst, Math.abs(one.curves.lufs[i] - (v - 6))); });
    const swapped = P.combine(parts.slice().reverse(), { rate: 100, duration: 2 }), same = JSON.stringify(swapped.curves.lufs) === JSON.stringify(c.curves.lufs);
    check("combine: gain moves LUFS exactly; order does not matter", "max error " + worst.toFixed(4) + " LU", worst < 1e-3 && same);
  }
  {
    // a document like any other: plain JSON, drawable, aligned parts silent outside their clips
    const back = JSON.parse(JSON.stringify(c)), A = P.align(parts, { rate: 100, duration: 2 });
    const calls = []; const ctx = new Proxy({}, { get: (t, k) => k === "canvas" ? { width: 300, height: 40 } : k in t ? t[k] : (...a) => { calls.push(k); return { data: [] }; }, set: (t, k, v) => { t[k] = v; return true; } });
    const r = P.drawStrip(ctx, back, { width: 300, height: 40, look: "spec,wave:harshness,line:activity,ticks:events+onsets" });
    const silentBefore = A.parts[1].power.slice(0, 45).every(v => v === 0) && A.parts[1].power[60] > 0;
    check("combine: JSON document, drawable; align keeps a part silent before its offset", back.combined.parts.length + " parts, " + calls.length + " draw calls",
      back.schema === "playhead-analysis" && calls.length > 100 && /harshness/.test(r.legend) && silentBefore && A.bands === 40);
  }
};
