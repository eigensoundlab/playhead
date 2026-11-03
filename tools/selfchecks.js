// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Shared by tools/batch.js and tools/tune.js: whole-pipeline analysis of a buffer, per-file summaries, and the self-checks
// (edits whose correct answer is known by construction, so they need no labels).
"use strict";
const WL = require("../src/analysis.js");
const FX = require("../src/effects.js");
const PHD = require("../src/descriptors.js");
const IO = require("./audio-io.js");

/* ---------------- helpers ---------------- */
const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const chans = buf => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
const mk = (sr, ch) => IO.makeBuffer(sr, ch);
const db = v => 20 * Math.log10(Math.max(1e-12, v));
const sortQ = (arr, p) => { if (!arr.length) return NaN; const s = Array.from(arr).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const gatedVals = (a, g) => { const o = []; for (let i = 0; i < a.length; i++) if (g[i]) o.push(a[i]); return o; };
const mean = v => v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
const r2 = (v, d = 2) => (typeof v === "number" && isFinite(v)) ? Number(v.toFixed(d)) : null;
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}
function trim(buf, s) {
  const n = Math.min(buf.length, Math.round(s * buf.sampleRate));
  return n >= buf.length ? buf : mk(buf.sampleRate, chans(buf).map(c => c.slice(0, n)));
}

async function analyseBuf(buf, name) {
  const F = await WL.analyse(buf);
  const cur = WL.computeCurves(F, F.guess, { scale: "fixed" });
  return { F, cur, R: WL.rhythmOf(F), St: WL.structureOf(F), X: WL.sfxOf(F, buf, name), D: await PHD.describe(F, buf), buf };
}
// how independently each curve moves from loudness: |correlation of column-to-column changes| over 400 columns
const INDEP = { c2: "activity", c5: "tension", c7: "novelty", n1: "impulsiveness", n2: "repetition", n4: "spectral motion", n5: "periodicity", n6: "arrow of time", n7: "interest", n8: "recurrence" };
function independence(A) {
  const { F, cur, D } = A, n = F.nF, cols = Math.min(400, n), c1 = WL.pool(cur.curves.c1, n, cols, "max"), g = WL.pool(Float32Array.from(cur.gate), n, cols, "mean");
  const src = { c2: [cur.curves.c2, "mean"], c5: [cur.curves.c5, "mean"], c7: [cur.curves.c7, "max"], n1: [D.curves.kurt, "max"], n2: [D.curves.repProm, "max"], n4: [Float32Array.from(D.curves.vel, Math.abs), "mean"], n5: [D.curves.cpp, "mean"], n6: [D.curves.arrow, "mean"], n7: [D.curves.pir, "mean"], n8: [D.curves.recDensity, "mean"] };
  const out = {};
  for (const [k, [arr, mode]] of Object.entries(src)) {
    const v = PHD.poolNaN(arr, cols, mode), mask = new Uint8Array(cols), a = new Float32Array(cols); let used = 0;
    for (let i = 0; i < cols; i++) { if (g[i] >= 0.5 && Number.isFinite(v[i])) { mask[i] = 1; a[i] = v[i]; used++; } }
    out[k] = used >= 20 ? r2(Math.abs(WL.diffCorr(a, c1, mask)), 2) : null;
  }
  return out;
}
function summarise(A) {
  const { F, cur, R, St, X, buf } = A, g = cur.gate;
  const lt = gatedVals(cur.lufs, g).sort((a, b) => a - b);
  const c5 = gatedVals(cur.curves.c5, g);
  const tonal = [];
  for (let m = 0; m < X.f0.length; m++) if (X.f0[m] > 0 && X.aper[m] < WL.SFX.tonalAper && g[Math.min(g.length - 1, m)]) tonal.push(X.f0[m]);
  return {
    dur: r2(F.dur, 2), sr: F.sr, ch: buf.numberOfChannels, cls: F.guess,
    lufs: r2(FX.lufsOf(chans(buf), F.sr), 1),
    lra: r2(lt.length ? sortQ(lt, 0.95) - sortQ(lt, 0.1) : NaN, 1),
    peakDb: r2(X.pkDb, 1),
    harsh: r2(mean(gatedVals(cur.raw.hfac, g)), 3), harshP90: r2(sortQ(gatedVals(cur.raw.hfac, g), 0.9), 3),
    sharp: r2(mean(gatedVals(cur.raw.sharp, g)), 2), rough: r2(mean(gatedVals(cur.raw.Rr, g)), 3),
    activity: r2(mean(gatedVals(cur.curves.c2, g)), 2), c4: r2(mean(gatedVals(cur.curves.c4, g)), 3),
    tensionRange: r2(c5.length ? sortQ(c5, 0.95) - sortQ(c5, 0.05) : NaN, 2),
    tempo: r2(R.tempo, 1), pulseClarity: r2(R.medClar, 2), tempoReliable: !!R.reliable, beats: R.beatTimes.length,
    sections: St.segs.length, labels: St.segs.map(s => s.label).join(""),
    events: X.events.length, tags: X.events.map(e => e.tag).join(" "),
    pitchHz: r2(tonal.length >= 5 ? sortQ(tonal, 0.5) : NaN, 1), tonalShare: r2(tonal.length / Math.max(1, gatedVals(g, g).length), 2),
    layers: X.layers.map(l => l.name + " " + Math.round(l.share * 100) + "%").join(", "),
    issues: X.issues.filter(i => i.sev === "bad" || i.sev === "warn").map(i => i.text).join("; "),
    // cross-field descriptors (src/descriptors.js)
    ...descSummary(A.D)
  };
}
function descSummary(D) {
  const s = D.summary, k = s.kurtosis;
  return {
    K: r2(k.K, 2), kBand: k.band ? k.band.join("-") : "", rep: r2(s.repetition.hz, 2), repProm: r2(s.repetition.prom, 1), speech: r2(s.repetition.speech, 1),
    evN: s.events.n, evRate: r2(s.events.rate, 2), B: r2(s.events.B, 2), bValue: s.events.bN >= 50 ? r2(s.events.bValue, 2) : null, Ht: r2(s.events.Ht, 2),
    velUp: r2(s.motion.up, 2), velDown: r2(s.motion.down, 2), glide: r2(s.motion.net, 2), cpp: r2(s.periodicity.cpp, 1), pci: r2(s.periodicity.pci, 2),
    T20: r2(s.arrow.T20, 2), pir: r2(s.info.pir, 3), surprisal: r2(s.info.surprisal, 2), symbols: s.info.K,
    RR: r2(s.recurrence.RR, 3), DET: r2(s.recurrence.DET, 2), LAM: r2(s.recurrence.LAM, 2), ring: r2(s.decay.t60, 3), logTau: r2(s.decay.logTau, 2), material: s.decay.material
  };
}

/* ---------------- curves for the report (downsampled) ---------------- */
function stripData(A, cols) {
  const { F, cur, R, St, X, buf } = A, n = F.nF, cs = chans(buf), len = buf.length;
  const wave = [];
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * len / cols), b = Math.max(a + 1, Math.floor((c + 1) * len / cols));
    let mn = 0, mx = 0; for (const ch of cs) for (let i = a; i < b; i++) { const v = ch[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    wave.push([r2(mn, 3), r2(mx, 3)]);
  }
  const pool = arr => { const o = []; for (let c = 0; c < cols; c++) { const a = Math.floor(c * n / cols), b = Math.max(a + 1, Math.floor((c + 1) * n / cols)); let s = 0, k = 0; for (let m = a; m < b && m < n; m++) if (cur.gate[m]) { s += arr[m]; k++; } o.push(k ? r2(s / k, 3) : null); } return o; };
  return {
    wave, loud: pool(cur.curves.c1), act: pool(cur.curves.c2), tension: pool(cur.curves.c5), harsh: pool(cur.colour.harsh),
    downbeats: R.reliable ? R.downTimes.map(t => r2(t, 2)) : [], beats: R.reliable ? R.beatTimes.map(t => r2(t, 2)) : [],
    bounds: St.segs.map(s => [r2(s.t0, 2), s.label]), events: X.events.map(e => [r2(e.t0, 3), e.tag]),
    kurt: Array.from(PHD.poolNaN(A.D.curves.kurt, cols, "max"), v => Number.isFinite(v) ? r2(v, 2) : null),
    arrow: Array.from(PHD.poolNaN(A.D.curves.arrow, cols, "mean"), v => Number.isFinite(v) ? r2(v, 2) : null),
    vel: Array.from(PHD.poolNaN(A.D.curves.vel, cols, "absmax"), v => Number.isFinite(v) ? r2(v, 2) : null)
  };
}

/* ---------------- self-checks: edits whose correct answer is known ---------------- */
function mapCh(buf, fn) { return mk(buf.sampleRate, chans(buf).map((c, ci) => fn(c, ci))); }
function pinkNoise(n, seed) {
  const r = rng(seed), o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980; o[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
  return o;
}
function matchFrac(ref, got, shift, tol) {
  if (!ref.length) return NaN;
  const used = new Set(); let hit = 0;
  for (const t of ref) { let bi = -1, bd = tol; got.forEach((u, i) => { const d = Math.abs(u - (t + shift)); if (!used.has(i) && d <= bd) { bd = d; bi = i; } }); if (bi >= 0) { used.add(bi); hit++; } }
  return hit / ref.length;
}
const hasIssue = (A, re) => A.X.issues.some(i => (i.sev === "bad" || i.sev === "warn") && re.test(i.text));

// descriptors that must not change (level), or must change in a known way
const fin = Number.isFinite;
function descInvariant(a, b, why) {
  const rows = [];
  if (fin(a.K) && fin(b.K)) rows.push(["N1 kurtosis unchanged" + why, r2(b.K - a.K, 2), Math.abs(b.K - a.K) <= 0.2 + 0.1 * Math.abs(a.K)]);
  if (fin(a.rep) || fin(b.rep)) rows.push(["N2 same repetition rate" + why, (a.rep ?? "none") + " → " + (b.rep ?? "none"), fin(a.rep) && fin(b.rep) && Math.abs(b.rep / a.rep - 1) <= 0.01]);
  if (fin(a.cpp) && fin(b.cpp)) rows.push(["N5 CPP unchanged" + why, r2(b.cpp - a.cpp, 1), Math.abs(b.cpp - a.cpp) <= 1]);
  if (fin(a.pir) && fin(b.pir)) rows.push(["N7 interest unchanged" + why, r2(b.pir - a.pir, 3), Math.abs(b.pir - a.pir) <= 0.05]);
  if (fin(a.RR) && fin(b.RR)) rows.push(["N8 recurrence unchanged" + why, r2(b.RR - a.RR, 3), Math.abs(b.RR - a.RR) <= 0.03]);
  return rows;
}
const CHECKS = [
  { id: "level", label: "−12 dB copy", edit: b => mapCh(b, c => c.map(v => v * 0.25)),
    expect: (A, B, s0) => [
      ["loudness −12.0 LU", r2(B.sum.lufs - s0.lufs, 2), Math.abs(B.sum.lufs - s0.lufs + 12) <= 0.2],
      ["activity unchanged", r2(B.sum.activity - s0.activity, 2), Math.abs(B.sum.activity - s0.activity) <= 0.05],
      ["harshness-weighted loudness (C4) lower", r2(B.sum.c4 - s0.c4, 3), B.sum.c4 < s0.c4],
      ["same events", B.sum.events + " vs " + s0.events, Math.abs(B.sum.events - s0.events) <= Math.max(1, 0.1 * s0.events)],
      s0.tempoReliable ? ["same tempo", r2(B.sum.tempo, 1), Math.abs(B.sum.tempo / s0.tempo - 1) <= 0.01] : null,
      A.St.bounds.length && A.F.dur >= 10 ? ["same sections", r2(matchFrac(A.St.bounds, B.St.bounds, 0, 1), 2), matchFrac(A.St.bounds, B.St.bounds, 0, 1) >= 0.8] : null,
      ...descInvariant(s0, B.sum, "")
    ] },
  { id: "shift", label: "+0.5 s silence in front", edit: b => mapCh(b, c => { const z = Math.round(0.5 * b.sampleRate), o = new Float32Array(c.length + z); o.set(c, z); return o; }),
    expect: (A, B) => {
      const tol = Math.max(0.012, 2 * A.F.dt), ev = A.X.events.map(e => e.t0), evB = B.X.events.map(e => e.t0);
      const out = [ev.length ? ["events move +0.5 s", r2(matchFrac(ev, evB, 0.5, tol), 2), matchFrac(ev, evB, 0.5, tol) >= 0.9] : null];
      if (A.R.reliable && A.R.beatTimes.length >= 8) { const f = matchFrac(A.R.beatTimes, B.R.beatTimes, 0.5, 0.07); out.push(["beats move +0.5 s", r2(f, 2), f >= 0.9]); }
      if (A.St.bounds.length && A.F.dur >= 10) { const f = matchFrac(A.St.bounds, B.St.bounds, 0.5, 1); out.push(["sections move +0.5 s", r2(f, 2), f >= 0.8]); }
      return out;
    } },
  { id: "hit", label: "inserted 25 ms hit", applies: A => A.F.dur >= 1,
    edit: (b, A) => {
      // quietest moment in the middle 60 %, away from existing events
      const F = A.F, lu = A.cur.lufs, ev = A.X.events.map(e => e.t0);
      let best = -1, bl = Infinity;
      for (let m = Math.floor(0.2 * F.nF); m < Math.floor(0.8 * F.nF); m++) { const t = m * F.dt; if (ev.some(e => Math.abs(e - t) < 0.15)) continue; const v = isFinite(lu[m]) ? lu[m] : -120; if (v < bl) { bl = v; best = m; } }
      if (best < 0) best = Math.floor(0.5 * F.nF);
      const t0 = best * F.dt, sr = b.sampleRate, i0 = Math.round(t0 * sr), w = Math.round(0.03 * sr), r = rng(7);
      let loc = 0; for (const c of chans(b)) for (let i = Math.max(0, i0 - w * 4); i < Math.min(c.length, i0 + w * 4); i++) loc = Math.max(loc, Math.abs(c[i]));
      const amp = Math.min(0.9, Math.max(0.03, loc * 2.5)), burst = new Float32Array(Math.round(0.025 * sr));
      for (let i = 0; i < burst.length; i++) burst[i] = (r() * 2 - 1) * amp * Math.exp(-i / (0.006 * sr));
      const out = mapCh(b, c => { const o = Float32Array.from(c); for (let i = 0; i < burst.length && i0 + i < o.length; i++) o[i0 + i] = Math.max(-1, Math.min(1, o[i0 + i] + burst[i])); return o; });
      out.hitT = t0; return out;
    },
    // sound-effect events, or for music the rhythm onsets, must show a new start at the hit
    expect: (A, B, s0, E) => { const ts = B.X.events.map(e => e.t0).concat(s0.cls === "sfx" ? [] : B.R.onsetTimes), near = ts.filter(t => Math.abs(t - E.hitT) <= 0.025).sort((a, b) => Math.abs(a - E.hitT) - Math.abs(b - E.hitT)); return [["new event or onset at the hit (±25 ms)", near.length ? r2((near[0] - E.hitT) * 1000, 0) + " ms" : "missed", near.length > 0]]; } },
  { id: "dc", label: "DC offset +0.03", edit: b => mapCh(b, c => c.map(v => v + 0.03)),
    expect: (A, B) => [["DC offset flagged", hasIssue(B, /DC offset/) ? "yes" : "no", hasIssue(B, /DC offset/)]] },
  { id: "clip", label: "driven into clipping", edit: b => { let p = 0; for (const c of chans(b)) for (const v of c) p = Math.max(p, Math.abs(v)); const g = p > 0 ? 2 / p : 1; return mapCh(b, c => c.map(v => Math.max(-1, Math.min(1, v * g)))); },
    expect: (A, B) => [["clipping flagged", hasIssue(B, /Clipped/) ? "yes" : "no", hasIssue(B, /Clipped/)]] },
  { id: "cut", label: "tail cut at 60 %",
    applies: A => { const b = A.buf, i = Math.round(0.6 * b.length), k = Math.round(0.005 * b.sampleRate); let s = 0, p = 0; for (const c of chans(b)) { for (let j = Math.max(0, i - k); j < i; j++) s += c[j] * c[j]; for (const v of c) p = Math.max(p, Math.abs(v)); } return db(Math.sqrt(s / (k * b.numberOfChannels))) - db(p) > -35; },
    edit: b => mapCh(b, c => c.slice(0, Math.round(0.6 * c.length))),
    expect: (A, B) => [["abrupt end flagged", hasIssue(B, /Ends abruptly/) ? "yes" : "no", hasIssue(B, /Ends abruptly/)]] },
  { id: "reverse", label: "played backwards", edit: b => mapCh(b, c => Float32Array.from(c).reverse()),
    expect: (A, B, s0) => {
      const s1 = B.sum, rows = [];
      if (fin(s0.T20) && Math.abs(s0.T20) >= 0.5) rows.push(["N6 arrow of time flips sign", s0.T20 + " → " + s1.T20, fin(s1.T20) && Math.sign(s1.T20) === -Math.sign(s0.T20) && Math.abs(s1.T20 + s0.T20) <= 0.25 * Math.abs(s0.T20)]);
      if (fin(s0.glide) && Math.abs(s0.glide) >= 0.5) rows.push(["N4 net glide flips sign", s0.glide + " → " + s1.glide, fin(s1.glide) && Math.abs(s1.glide + s0.glide) <= 0.3 + 0.1 * Math.abs(s0.glide)]);
      if (fin(s0.K) && fin(s1.K)) rows.push(["N1 kurtosis unchanged", r2(s1.K - s0.K, 2), Math.abs(s1.K - s0.K) <= 0.2 + 0.1 * Math.abs(s0.K)]);
      if (fin(s0.RR) && fin(s1.RR)) rows.push(["N8 recurrence unchanged", r2(s1.RR - s0.RR, 3), Math.abs(s1.RR - s0.RR) <= 0.03]);
      if (fin(s0.rep) || fin(s1.rep)) rows.push(["N2 same repetition rate", (s0.rep ?? "none") + " → " + (s1.rep ?? "none"), fin(s0.rep) && fin(s1.rep) && Math.abs(s1.rep / s0.rep - 1) <= 0.01]);
      return rows;
    } },
  { id: "speed", label: "played 6 % faster", edit: b => mapCh(b, c => FX.resample(c, 1.06)),
    expect: (A, B, s0) => [
      fin(s0.rep) ? ["N2 repetition rate ×1.06", fin(B.sum.rep) ? r2(B.sum.rep / s0.rep, 3) : "lost", fin(B.sum.rep) && Math.abs(B.sum.rep / s0.rep / 1.06 - 1) <= 0.02] : null,
      s0.cls === "sfx" && fin(s0.logTau) && fin(B.sum.logTau) ? ["N9 material unchanged (log τd)", r2(B.sum.logTau - s0.logTau, 2), Math.abs(B.sum.logTau - s0.logTau) <= 0.15] : null,
      fin(s0.ring) && fin(B.sum.ring) && s0.ring >= 0.1 ? ["N9 ring time ÷1.06", r2(s0.ring / B.sum.ring, 3), Math.abs(s0.ring / B.sum.ring / 1.06 - 1) <= 0.1] : null,
      s0.tempoReliable ? ["tempo ×1.06", r2(B.sum.tempo / s0.tempo, 3), Math.abs(B.sum.tempo / s0.tempo / 1.06 - 1) <= 0.02] : null,
      isFinite(s0.pitchHz) && s0.tonalShare >= 0.3 ? ["pitch +1.0 semitone", r2(12 * Math.log2(B.sum.pitchHz / s0.pitchHz), 2), Math.abs(12 * Math.log2(B.sum.pitchHz / s0.pitchHz) - 1.009) <= 0.3] : null,
      ["length ÷1.06", r2(A.buf.length / B.buf.length, 4), Math.abs(A.buf.length / B.buf.length - 1.06) <= 0.001]
    ] },
  { id: "noise", label: "pink noise 30 LU below", edit: (b, A, s0) => {
      const n = pinkNoise(b.length, 3), tmp = mk(b.sampleRate, chans(b).map(() => n)); const ln = FX.lufsOf(chans(tmp), b.sampleRate);
      const g = Math.pow(10, (s0.lufs - 30 - ln) / 20); return mapCh(b, c => c.map((v, i) => v + n[i] * g));
    },
    expect: (A, B, s0) => {
      // compare only where the original is at least 10 LU above the added noise
      const g = A.cur.gate, lu = A.cur.lufs, keep = (x, y) => { const a = [], c = []; for (let m = 0; m < Math.min(x.length, y.length); m++) if (g[m] && lu[m] > s0.lufs - 20) { a.push(x[m]); c.push(y[m]); } return [a, c]; };
      const [a1, b1] = keep(A.cur.curves.c1, B.cur.curves.c1), [a2, b2] = keep(A.cur.curves.c2, B.cur.curves.c2);
      return [
        ["loudness curve holds (r ≥ 0.9)", r2(pearson(a1, b1), 2), pearson(a1, b1) >= 0.9],
        ["activity curve holds (r ≥ 0.8)", r2(pearson(a2, b2), 2), !(pearson(a2, b2) < 0.8)],
        s0.tempoReliable ? ["same tempo", r2(B.sum.tempo, 1), Math.abs(B.sum.tempo / s0.tempo - 1) <= 0.01] : null
      ];
    } },
  { id: "join", label: "joined to another track", applies: (A, s0) => s0.cls !== "sfx" && A.F.dur >= 15, pairs: true,
    edit: (b, A, s0, other) => {
      const sr = b.sampleRate, a = trim(b, 30), o = trim(other, 30), f = Math.round(0.005 * sr);
      const ca = chans(a), co = chans(o), nCh = Math.max(ca.length, co.length);
      const out = Array.from({ length: nCh }, (_, c) => { const x = ca[Math.min(c, ca.length - 1)], y = co[Math.min(c, co.length - 1)], z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length); for (let i = 0; i < f; i++) { z[x.length - 1 - i] *= i / f; z[x.length + i] *= i / f; } return z; });
      const r = mk(sr, out); r.joinT = a.duration; return r;
    },
    expect: (A, B, s0, E) => { const d = B.St.bounds.length ? Math.min(...B.St.bounds.map(t => Math.abs(t - E.joinT))) : Infinity; return [["section boundary at the join (±2 s)", isFinite(d) ? r2(d, 2) + " s" : "none", d <= 2]]; } }
];


/** Re-run everything downstream of the features on an existing analysis (after a parameter change). */
async function reanalyse(A, name) {
  const F = WL.resetDerived(A.F);
  const cur = WL.computeCurves(F, F.guess, { scale: "fixed" });
  const B = { F, cur, R: WL.rhythmOf(F), St: WL.structureOf(F), X: WL.sfxOf(F, A.buf, name), D: await PHD.describe(F, A.buf), buf: A.buf };
  B.sum = summarise(B);
  return B;
}

module.exports = { log, chans, mk, db, sortQ, gatedVals, mean, r2, rng, pearson, trim, analyseBuf, reanalyse, INDEP, independence, summarise, descSummary, stripData, mapCh, pinkNoise, matchFrac, hasIssue, fin, descInvariant, CHECKS };
