// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Views (Playhead.view and the looks that draw them): the bar raster, the tempogram, the lag view and the curve
// scalogram, on signals whose beat, tempo, repeats and modulation rates are known.
"use strict";

module.exports = async function (check) {
  const P = require("../src/playhead.js"), WL = require("../src/analysis.js"), Pr = require("../src/probes.js");
  const SR = 44100;
  {
    const codes = ["spec:tempo~cyclic,ticks:downbeats", "spec:lag,sections", "spec:mod,lane:loudness", "scalogram:loudness,lane:activity", "raster:activity~4bars,sections,ticks:onsets", "spec"];
    const back = codes.map(c => P.lookCode(P.parseLook(c)));
    check("views: look codes read and written back", back.filter((c, i) => c === codes[i]).length + "/" + codes.length, back.every((c, i) => c === codes[i]));
  }
  // Playhead tempograms: the tempogram of a curve's rises, and the tempogram weighted by a curve. A document whose
  // harshness pulses every 0.75 s (80 BPM) in its second half only, and whose loudness is low in its first half
  {
    const rate = 20, n = 32 * rate, harsh = [], loud = [];
    for (let i = 0; i < n; i++) { const t = i / rate; harsh.push(t >= 16 && (t % 0.75) < 0.15 ? 0.9 : 0.3); loud.push(t < 16 ? 0.1 : 0.8); }
    const doc = { schema: "playhead-analysis", source: { duration: 32 }, curves: { rate, harshness: harsh, loudness: loud }, rhythm: null };
    const v = P.view(doc, "tempo", { source: "harshness" }), w = P.view(doc, "tempo", { source: "harshness", weight: "loudness" });
    const bpm = r => 40 * Math.pow(2, (v.rows - 1 - r) / 24), colOf = t => v.colAt(t);
    const strongest = (c0, c1) => { let best = -1, bv = -1; for (let r = 0; r < v.rows; r++) { let s = 0; for (let c = c0; c < c1; c++) s += v.values[r * v.cols + c]; if (s > bv) { bv = s; best = r; } } return { bpm: bpm(best), sum: bv / (c1 - c0) }; };
    const late = strongest(colOf(22), colOf(30)), early = strongest(colOf(2), colOf(10));
    const octave = x => Math.abs(Math.log2(x / 80) - Math.round(Math.log2(x / 80)));
    const supEarly = w.suppress[colOf(4)], supLate = w.suppress[colOf(26)];
    const codes = ["spec:tempo~of:harshness", "spec:tempo~cyclic~of:speed~w:loudness"], back = codes.map(c => P.lookCode(P.parseLook(c)));
    check("views: a curve's tempogram finds the period of its rises where they are; a weight greys the columns where it is low",
      `${late.bpm.toFixed(1)} BPM late (strength ${late.sum.toFixed(2)}, early ${early.sum.toFixed(2)}); suppressed ${supEarly.toFixed(2)} early, ${supLate.toFixed(2)} late`,
      octave(late.bpm) < 0.04 && late.sum > 3 * early.sum && supEarly > 0.9 && supLate < 0.1 && w.values.every((x, i) => x === v.values[i])
        && back.every((c, i) => c === codes[i]) && P.lookFits(doc, "spec:tempo~of:harshness") && !P.lookFits(doc, "spec:tempo") && !P.lookFits(doc, "spec:tempo~of:tension"));
  }
  // the cue arc: 120 BPM, 4/4, drums from 8 s; the groove (8-20 s) returns at 48-56 s
  const arc = Pr.makeCueArc(SR, WL.kFilterCoeffs), d = await P.analyze(arc, { name: "cue arc", profile: "music" });
  {
    const v = P.view(d, "raster"), rows = v ? v.timeRows : [];
    const lens = rows.map(r => r[1] - r[0]).sort((a, b) => a - b), bar = lens[lens.length >> 1] || 0;
    // the strongest columns, summed over the bars, sit on the beats
    const sum = new Float32Array(v ? v.cols : 0); if (v) for (let r = 0; r < v.rows; r++) for (let c = 0; c < v.cols; c++) sum[c] += Math.max(0, v.values[r * v.cols + c]);
    const top = [...sum].map((s, c) => [s, (c + 0.5) / sum.length]).sort((a, b) => b[0] - a[0]).slice(0, 4).map(x => x[1]);
    const onBeat = top.every(ph => Math.abs(ph * 4 - Math.round(ph * 4)) <= 0.12);
    check("views: bar raster rows are the bars", v ? v.rows + " rows of " + bar.toFixed(2) + " s, " + v.beatsPerBar + " beats; peaks at " + top.map(p => p.toFixed(2)).join(" ") : "none",
      !!v && Math.abs(bar - 2) < 0.06 && rows[0][0] <= 0.05 && rows[rows.length - 1][1] >= arc.duration - 0.05 && v.beatsPerBar === 4 && onBeat);
  }
  {
    const tg = d.rhythm.tempogram, v = P.view(d, "tempo"), bpm = r => tg.bpmMin * Math.pow(2, (v.rows - 1 - r) / tg.perOctave);
    const mean = new Float32Array(v.rows); for (let r = 0; r < v.rows; r++) for (let c = 0; c < v.cols; c++) mean[r] += v.values[r * v.cols + c];
    let best = -1; for (let r = 1; r < v.rows - 1; r++) if (bpm(r) > 100 && bpm(r) < 145 && (best < 0 || mean[r] > mean[best])) best = r;
    const isPeak = best > 0 && mean[best] >= mean[best - 1] && mean[best] >= mean[best + 1];
    check("views: tempogram peaks at the tempo", bpm(best).toFixed(1) + " BPM, " + tg.columns + " x " + tg.bins + " in the document", isPeak && Math.abs(bpm(best) / 120 - 1) < 0.03 && Buffer.from(tg.data, "base64").length === tg.columns * tg.bins);
    // the tempo ramp, 96 to 144 BPM over 34 s: the tempogram's strongest beat-range tempo rises with it
    const ramp = Pr.makeTempoRamp(SR, WL.kFilterCoeffs), dr = await P.analyze(ramp, { profile: "music" }), vr = P.view(dr, "tempo"), C = vr.cols;
    const peak = (a, b) => { const m = new Float32Array(vr.rows); for (let r = 0; r < vr.rows; r++) for (let c = a; c < b; c++) m[r] += vr.values[r * C + c]; let k = -1; for (let r = 0; r < vr.rows; r++) { const p = bpm(r); if (p >= 80 && p <= 180 && (k < 0 || m[r] > m[k])) k = r; } return bpm(k); };
    const early = peak(Math.floor(C * 0.1), Math.floor(C * 0.3)), late = peak(Math.floor(C * 0.7), Math.floor(C * 0.9));
    check("views: tempogram follows a tempo ramp", early.toFixed(0) + " → " + late.toFixed(0) + " BPM (true 106 → 134)", Math.abs(early - 105.6) < 6 && Math.abs(late - 134.4) < 6);
  }
  {
    const v = P.view(d, "lag");
    const rowFor = s => { let b = 0; for (let l = 0; l < v.rows; l++) if (Math.abs(v.lagSeconds(l) - s) < Math.abs(v.lagSeconds(b) - s)) b = l; return v.rows - 1 - b; };
    const r40 = rowFor(40);
    let at = 0, med = 0, k = 0;
    for (let t = 49; t < 55; t += 0.5) {
      const c = v.colAt(t), col = []; for (let r = 0; r < v.rows; r++) if (v.values[r * v.cols + c] >= 0) col.push(v.values[r * v.cols + c]);
      col.sort((a, b) => a - b); at += v.values[r40 * v.cols + c]; med += col[col.length >> 1]; k++;
    }
    check("views: lag view shows the groove returning 40 s later", "lag 40 s " + (at / k).toFixed(2) + " vs column median " + (med / k).toFixed(2) + " (" + d.repetition.unit + "s)", at / k > med / k + 0.3 && d.repetition.unit === "beat");
  }
  {
    // noise with a tremolo at 8 Hz for 4 s, then at 3 Hz: the loudness curve's scalogram finds both periods
    let s = 3;
    const x = Float32Array.from({ length: 8 * SR }, (_, i) => { s = (s * 16807) % 2147483647; const t = i / SR; return 0.3 * (s / 2147483647 * 2 - 1) * (0.55 + 0.45 * Math.sin(2 * Math.PI * (t < 4 ? 8 : 3) * t)); });
    const ds = await P.analyze({ sampleRate: SR, channels: [x] }, { profile: "sfx", assetClass: "sfx" }), v = P.view(ds, "scale", { curve: "loudness" });
    const best = (a, b) => { const m = new Float32Array(v.rows); for (let r = 0; r < v.rows; r++) for (let c = v.colAt(a); c < v.colAt(b); c++) m[r] += v.values[r * v.cols + c]; let k = 0; m.forEach((q, r) => { if (q > m[k]) k = r; }); return v.periods[k]; };
    const p1 = best(1.5, 2.5), p2 = best(5.5, 6.5);
    const fits = ["raster", "spec:tempo", "spec:lag", "scalogram:loudness"].map(c => (P.lookFits(d, c) ? "1" : "0") + (P.lookFits(ds, c) ? "1" : "0")).join(" ");
    check("views: scalogram finds tremolo periods", p1.toFixed(3) + " s and " + p2.toFixed(3) + " s (true 0.125, 0.333); fits " + fits,
      Math.abs(p1 / 0.125 - 1) < 0.06 && Math.abs(p2 / 0.3333 - 1) < 0.06 && fits === "10 10 10 11");
  }
  {
    // modulation spectrogram: noise whose level swings fully at 4, 16 and 60 Hz, then steady noise. Each part's
    // brightest row is its rate (within one row, 12 %); steady noise stays dark; fast documents carry no modulation
    let s = 9;
    const x = Float32Array.from({ length: 12 * SR }, (_, i) => { s = (s * 16807) % 2147483647; const t = i / SR, f = t < 3 ? 4 : t < 6 ? 16 : t < 9 ? 60 : 0; return 0.3 * (s / 2147483647 * 2 - 1) * (f ? 0.5 + 0.5 * Math.sin(2 * Math.PI * f * t) : 0.7); });
    const dm = await P.analyze({ sampleRate: SR, channels: [x] }, { profile: "sfx" }), v = P.view(dm, "mod");
    const rowMean = (a, b) => { const m = new Float32Array(v.rows); for (let r = 0; r < v.rows; r++) for (let c = v.colAt(a); c < v.colAt(b); c++) m[r] += Math.max(0, v.values[r * v.cols + c]) / (v.colAt(b) - v.colAt(a)); return m; };
    const best = (a, b) => { const m = rowMean(a, b); let k = 0; m.forEach((q, r) => { if (q > m[k] + 1e-6) k = r; }); return { rate: v.rateOf(k), level: m[k] }; };
    const parts = [[0.5, 2.5, 4], [3.5, 5.5, 16], [6.5, 8.5, 60]].map(([a, b, f]) => ({ f, ...best(a, b) }));
    const steady = Math.max(...rowMean(9.5, 11.5)), fast = await P.analyze({ sampleRate: SR, channels: [x.subarray(0, SR)] }, { profile: "fast" });
    check("views: modulation spectrogram finds the rate the level swings at", parts.map(p => p.rate.toFixed(1) + " Hz").join(", ") + " (true 4, 16, 60); steady noise " + steady.toFixed(2),
      parts.every(p => Math.abs(Math.log2(p.rate / p.f)) <= Math.log2(1.13) && p.level > 0.7) && steady < 0.35 && !fast.modulation && P.lookFits(dm, "spec:mod") && !P.lookFits(fast, "spec:mod"));
  }
  {
    // drawn: each view fills the strip and says what it is; the raster returns its rows, so a host can seek by row
    const calls = {}; const ctx = new Proxy({}, { get: (t, k) => k === "canvas" ? { width: 300, height: 64 } : k in t ? t[k] : (...a) => { calls[k] = (calls[k] || 0) + 1; return { data: [] }; }, set: (t, k, v) => { t[k] = v; return true; } });
    const r1 = P.drawStrip(ctx, d, { width: 300, height: 64, look: "raster:onsetStrength,sections,ticks:onsets" });
    const n1 = calls.fillRect || 0, r2 = P.drawStrip(ctx, d, { width: 300, height: 64, look: "spec:tempo~cyclic,lane:localPulse" }), r3 = P.drawStrip(ctx, d, { width: 300, height: 64, look: "tempogram" });
    check("views: drawn, with legends; the raster gives its rows", n1 + " cells; " + (r1.raster ? r1.raster.rows.length + " rows" : "no rows"),
      n1 > 1000 && r1.raster && r1.raster.rows.length === P.view(d, "raster").rows && /raster/.test(r1.legend) && /folded/.test(r2.legend) && /local pulse/.test(r2.legend) && r3.code === "spec:tempo,ticks:downbeats");
  }
};
