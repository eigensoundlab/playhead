// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Do Playhead's curves drive visuals better than the usual audio-reactive signals? A computational comparison on
// stimuli whose truth is known because they are built here (see README.md):
//   groove   32 s at 120 BPM in four sections (groove, breakdown, full with bass, outro)
//   riser    24 s: a steady part, a 12 s build at constant loudness (a noise sweep and a snare roll that speeds up),
//            then a drop
//   timbre   27 s of 3 s blocks at equal loudness: smooth and dark, smooth and bright, harsh (rough and clipped)
//   sfx      24 s: 14 one-shot hits at irregular times over a quiet ambience
//   dense    20 s of a steady 128 BPM pattern with 16th hats
// Every stimulus is driven, at 60 frames per second, by the usual signals (an RMS envelope follower, three FFT
// bands normalised as MilkDrop does, spectral centroid, an onset trigger), by the same computed offline (zero-phase),
// by Playhead's curves (`Playhead.frames`) and by Playhead's curves shifted by half the stimulus (a control that
// should do no better than chance). The measures: use of the range, jitter and flashes, accents hit, contrast
// between sections, a build followed, harsh told from smooth at equal loudness, and redundancy with the level.
//
//   node experiments/visuals/run.js [sonic-pi-samples-dir]   # results.json, site/data/*.json, site/audio/*.flac
"use strict";
const path = require("path"), fs = require("fs"), os = require("os"), { execFileSync } = require("child_process");
const WL = require("../../src/analysis.js"); require("../../src/descriptors.js");
const Playhead = require("../../src/playhead.js"), IO = require("../../tools/audio-io.js");

const SR = 44100, FPS = 60;
const DIR = process.argv[2] || path.join(__dirname, "../corpus/src/sonic-pi/etc/samples");
const SITE = path.join(__dirname, "site");
const r3 = v => Math.round(v * 1000) / 1000;

/* ---------------- stimuli ---------------- */
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(DIR, name + ".flac"), "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice();
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  let lead = 0; while (lead < x.length && Math.abs(x[lead]) < 0.1 * peak) lead++;     // where the sound starts (10 % of its peak)
  return (cache[name] = { x, lead: lead / SR });
}
// a sample into y at time t (s) with gain (dB); returns the time its sound starts
function place(y, name, t, db, maxLen) {
  const s = load(name), g = Math.pow(10, (db || 0) / 20), o = Math.round(t * SR), n = Math.min(s.x.length, maxLen ? Math.round(maxLen * SR) : Infinity);
  const fade = Math.round(0.01 * SR);
  for (let i = 0; i < n && o + i < y.length; i++) y[o + i] += g * s.x[i] * (maxLen && i > n - fade ? (n - i) / fade : 1);
  return t + s.lead;
}
// K-weighted mean square of x[a, b)
function kPower(x, a, b) {
  const [s1, s2] = WL.kFilterCoeffs(SR), seg = x.slice(a, b), t = new Float32Array(seg.length), k = new Float32Array(seg.length);
  WL.biquadInto(seg, t, s1); WL.biquadInto(t, k, s2);
  let e = 0; for (const v of k) e += v * v; return e / Math.max(1, k.length);
}
// holds the momentary loudness of x[a, b) constant: a gain from the K-weighted power in 400 ms windows, smoothed
function flatten(x, a, b) {
  const [s1, s2] = WL.kFilterCoeffs(SR), seg = x.slice(a, b), t = new Float32Array(seg.length), k = new Float32Array(seg.length);
  WL.biquadInto(seg, t, s1); WL.biquadInto(t, k, s2);
  const hop = Math.round(0.05 * SR), w = Math.round(0.4 * SR), pts = [];
  for (let c = 0; c < seg.length; c += hop) { let e = 0, m = 0; for (let i = Math.max(0, c - w / 2); i < Math.min(seg.length, c + w / 2); i++) { e += k[i] * k[i]; m++; } pts.push(e / Math.max(1, m)); }
  const ref = pts.slice().sort((p, q) => p - q)[Math.floor(pts.length / 2)];
  for (let i = 0; i < seg.length; i++) { const f = i / hop, j = Math.min(pts.length - 2, Math.floor(f)), u = f - j, p = pts[j] + (pts[j + 1] - pts[j]) * u; x[a + i] = seg[i] * Math.sqrt(ref / Math.max(p, ref * 1e-4)); }
}
function noise() { return rand() * 2 - 1; }

function groove() {
  const dur = 32, y = new Float32Array(dur * SR), accents = [];
  const kit = (t0, t1, opts) => {
    for (let t = t0; t < t1 - 1e-9; t += 0.25) {
      const beat = Math.round(t * 2) / 2 === t, k = Math.round(t * 4) % 8;
      if (opts.kick && (k === 0 || k === 4)) accents.push(place(y, "bd_haus", t, 0));
      if (opts.snare && (k === 2 || k === 6)) accents.push(place(y, "sn_dolf", t, -3));
      if (opts.hats && (opts.hats === 8 || beat)) place(y, "hat_cab", t, -14);
    }
  };
  kit(0, 8, { kick: true, snare: true, hats: 8 });
  kit(8, 16, { hats: 4 });
  for (const t of [8, 11.5]) place(y, "ambi_drone", t, -6, 4.5);                       // the breakdown's pad
  accents.push(place(y, "drum_cymbal_hard", 16, -4));
  kit(16, 28, { kick: true, snare: true, hats: 8 });
  for (let t = 16; t < 28; t += 2) accents.push(place(y, "bass_hard_c", t, -4, 1.9));
  for (let t = 28; t < 32; t += 2) accents.push(place(y, "bd_haus", t, -6));
  return { name: "groove", y, dur, accents: dedupe(accents), sections: [0, 8, 16, 28, 32] };
}
function riser() {
  const dur = 24, y = new Float32Array(dur * SR), accents = [];
  // 0-4 s steady: a low pad and a kick on the beat
  for (let i = 0; i < 4 * SR; i++) { const t = i / SR; y[i] += 0.12 * (Math.sin(2 * Math.PI * 55 * t) + 0.5 * Math.sin(2 * Math.PI * 110 * t)); }
  for (let t = 0; t < 4; t += 0.5) accents.push(place(y, "bd_haus", t, -2));
  // 4-16 s the build: a band of noise sweeping up from 300 Hz to 8 kHz, and a snare roll from 2 to 16 per second
  const a = 4 * SR, b = 16 * SR;
  let lp = 0, lp2 = 0;
  for (let i = a; i < b; i++) {
    const u = (i - a) / (b - a), fc = 300 * Math.pow(8000 / 300, u), al = 1 - Math.exp(-2 * Math.PI * fc / SR);
    const n = noise(); lp += al * (n - lp); lp2 += al * 0.5 * (lp - lp2);
    y[i] += 0.25 * (lp - lp2) + 0.06 * Math.sin(2 * Math.PI * 55 * i / SR);
  }
  for (let t = 4, k = 0; t < 16; k++) { place(y, "sn_dolf", t, -12); const rate = 2 * Math.pow(8, (t - 4) / 12); t += 1 / rate; }
  flatten(y, a, b);
  // 16 s the drop, then the groove
  accents.push(place(y, "misc_cineboom", 16, 0)); place(y, "bd_boom", 16, -2);
  for (let t = 16.5; t < 24; t += 0.5) accents.push(place(y, "bd_haus", t, -2));
  for (let t = 16; t < 24; t += 0.25) place(y, "hat_cab", t, -14);
  return { name: "riser", y, dur, accents: dedupe(accents), sections: [0, 4, 16, 24], build: [4, 16] };
}
function timbre() {
  const order = ["dark", "rough", "bright", "clipped", "dark", "clipped", "bright", "rough", "bright", "dark", "rough", "clipped"], blk = 3, dur = order.length * blk, y = new Float32Array(dur * SR);
  const env = (i, n) => Math.min(1, i / (0.05 * SR), (n - i) / (0.05 * SR));
  order.forEach((kind, k) => {
    const a = k * blk * SR, n = blk * SR;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let v;
      if (kind === "dark") v = Math.sin(2 * Math.PI * 110 * t) + 0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 330 * t);
      else if (kind === "bright") v = [2500, 3300, 4100, 5200].reduce((s, f, j) => s + Math.sin(2 * Math.PI * f * t + j), 0) / 2;
      else if (kind === "rough") { v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 220 * h * t) / h; v *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 70 * t); }
      else { const saw = 2 * ((220 * t) % 1) - 1; v = Math.max(-0.3, Math.min(0.3, 4 * saw)) * 3; }
      y[a + i] = v * env(i, n);
    }
  });
  // every block to the same K-weighted power
  const target = kPower(y, 0, blk * SR);
  order.forEach((_, k) => { const a = k * blk * SR, g = Math.sqrt(target / kPower(y, a, a + blk * SR)); for (let i = a; i < a + blk * SR; i++) y[i] *= g * 0.5; });
  return { name: "timbre", y, dur, accents: order.map((_, k) => k * blk), blocks: order.map((kind, k) => ({ start: k * blk, end: (k + 1) * blk, harsh: kind === "rough" || kind === "clipped", kind })) };
}
function swell() {
  const dur = 24, y = new Float32Array(dur * SR), accents = [];
  for (let t = 0; t < 4; t += 0.5) { accents.push(place(y, "bd_haus", t, -2)); place(y, "hat_cab", t + 0.25, -12); }
  // 4-16 s: more and more hits at an even brightness and constant loudness: hats from 4 to 16 per second, a snare
  // roll from 1 to 12 per second, toms joining
  for (let t = 4; t < 16;) { const u = (t - 4) / 12; place(y, "hat_cab", t, -12); t += 1 / (4 * Math.pow(4, u)); }
  for (let t = 4; t < 16;) { const u = (t - 4) / 12; place(y, "drum_snare_soft", t, -8); t += 1 / Math.pow(12, u); }
  for (let t = 10; t < 16; t += 0.5) place(y, "drum_tom_mid_soft", t, -10);
  flatten(y, 4 * SR, 16 * SR);
  accents.push(place(y, "misc_cineboom", 16, 0));
  for (let t = 16.5; t < 24; t += 0.5) accents.push(place(y, "bd_haus", t, -2));
  return { name: "swell", y, dur, accents: dedupe(accents), sections: [0, 4, 16, 24], build: [4, 16] };
}
function sfx() {
  const dur = 24, y = new Float32Array(dur * SR), accents = [];
  for (let t = 0; t < dur; t += 6) place(y, "ambi_lunar_land", t, -20, 6);
  const names = ["perc_impact1", "perc_bell", "elec_blip2", "drum_cymbal_hard", "glitch_robot1", "perc_door", "misc_cineboom", "elec_twang",
    "drum_tom_lo_hard", "perc_snap", "bass_voxy_hit_c", "elec_ping", "perc_swash", "drum_snare_hard"];
  let t = 0.6;
  for (const n of names) { if (t > dur - 1.5) break; accents.push(place(y, n, t, -12 * rand(), 1.5)); t += 0.7 + 1.6 * rand(); }
  return { name: "sfx", y, dur, accents: dedupe(accents) };
}
function dense() {
  const dur = 20, y = new Float32Array(dur * SR), accents = [], beat = 60 / 128;
  for (let k = 0; k * beat / 4 < dur - 0.3; k++) {
    const t = k * beat / 4;
    if (k % 4 === 0) accents.push(place(y, "bd_tek", t, 0));
    if (k % 8 === 4) accents.push(place(y, "sn_generic", t, -2));
    place(y, "hat_zild", t, k % 2 ? -18 : -12);
  }
  return { name: "dense", y, dur, accents: dedupe(accents), sections: [0, dur] };
}
function dedupe(ts) { ts.sort((a, b) => a - b); return ts.filter((t, i) => !i || t - ts[i - 1] > 0.03); }

/* ---------------- the usual drivers (as live tools compute them) ---------------- */
const pct = (a, p) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const norm01 = (a, lo, hi) => a.map(v => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))));
function onePole(a, attack, release) {           // an envelope follower over frames: attack and release in seconds
  const ka = Math.exp(-1 / (FPS * attack)), kr = Math.exp(-1 / (FPS * release)), out = new Float64Array(a.length);
  let e = 0; for (let i = 0; i < a.length; i++) { const k = a[i] > e ? ka : kr; e = k * e + (1 - k) * a[i]; out[i] = e; }
  return out;
}
function gaussSmooth(a, sigma) {                 // zero-phase, sigma in seconds
  const r = Math.ceil(3 * sigma * FPS), w = []; for (let k = -r; k <= r; k++) w.push(Math.exp(-0.5 * (k / (sigma * FPS)) ** 2));
  return a.map((_, i) => { let s = 0, z = 0; for (let k = -r; k <= r; k++) { const j = i + k; if (j >= 0 && j < a.length) { s += w[k + r] * a[j]; z += w[k + r]; } } return s / z; });
}
const decayTrigger = (n, frames, tau) => { const out = new Float64Array(n); for (const f of frames) for (let i = f; i < n; i++) { const v = Math.exp(-(i - f) / (FPS * tau)); if (v < 0.01) break; out[i] = Math.max(out[i], v); } return out; };
function usualDrivers(y, n) {
  const N = 2048, fft = WL.getFFT(N), win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), bin = SR / N;
  const rms = new Float64Array(n), rmsC = new Float64Array(n), bands = [new Float64Array(n), new Float64Array(n), new Float64Array(n)], cent = new Float64Array(n);
  const fluxC = new Float64Array(n), fluxO = new Float64Array(n);
  let prevC = null, prevO = null;
  const spectrum = end => {                       // the magnitudes of the 2048 samples before `end`
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = end - N + i; re[i] = j >= 0 && j < y.length ? y[j] * win[i] : 0; }
    fft(re, im); const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]); return m;
  };
  for (let i = 0; i < n; i++) {
    const end = Math.round((i + 1) / FPS * SR), mid = Math.round((i + 0.5) / FPS * SR);
    let e = 0, ec = 0; for (let j = end - 1024; j < end; j++) if (j >= 0 && j < y.length) e += y[j] * y[j];
    for (let j = mid - 512; j < mid + 512; j++) if (j >= 0 && j < y.length) ec += y[j] * y[j];
    rms[i] = Math.sqrt(e / 1024); rmsC[i] = Math.sqrt(ec / 1024);
    const m = spectrum(end), mo = spectrum(mid + N / 2);
    let lo = 0, md = 0, hi = 0, num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * bin, p = m[k] * m[k]; if (f < 250) lo += p; else if (f < 4000) md += p; else if (f < 16000) hi += p; num += p * f; den += p; }
    bands[0][i] = lo; bands[1][i] = md; bands[2][i] = hi;
    cent[i] = den > 1e-9 ? Math.max(0, Math.min(1, Math.log2(num / den / 100) / Math.log2(100))) : 0;   // 100 Hz .. 10 kHz
    const lm = m.map(v => Math.log1p(1000 * v)), lmo = mo.map(v => Math.log1p(1000 * v));
    if (prevC) { let s = 0, so = 0; for (let k = 1; k < N / 2; k++) { s += Math.max(0, lm[k] - prevC[k]); so += Math.max(0, lmo[k] - prevO[k]); } fluxC[i] = s; fluxO[i] = so; }
    prevC = lm; prevO = lmo;
  }
  // MilkDrop-style bands: the level against its own running average (1 = normal), with a damped "_att" version
  const milk = a => { const out = new Float64Array(n); let avg = 0; for (let i = 0; i < n; i++) { const k = i < FPS ? 1 / (i + 1) : 1 / (4 * FPS); avg += k * (a[i] - avg); out[i] = Math.max(0, Math.min(1, Math.sqrt(a[i] / Math.max(avg, 1e-12)) / 2)); } return out; };
  const pick = (flux, causal) => {                 // onsets: flux above its running median x 1.5, 80 ms apart
    const fr = [], mx = pct(flux, 0.99); let last = -1e9;
    for (let i = 1; i < n - 1; i++) {
      const a = causal ? Math.max(0, i - FPS) : Math.max(0, i - FPS / 2), b = causal ? i : Math.min(n, i + FPS / 2);
      const med = pct(flux.slice(a, Math.max(b, a + 1)), 0.5);
      const peak = causal ? flux[i] > flux[i - 1] && flux[i] >= med * 1.5 + 0.05 * mx : flux[i] >= flux[i - 1] && flux[i] > flux[i + 1] && flux[i] >= med * 1.5 + 0.05 * mx;
      if (peak && i - last >= 0.08 * FPS) { fr.push(i); last = i; }
    }
    return fr;
  };
  const rmsDb = rmsC.map(v => 20 * Math.log10(v + 1e-6)), sm = gaussSmooth(rmsDb, 0.04);
  return {
    rms: (a => norm01(a, Math.min(...a), Math.max(...a)))(onePole(rms, 0.01, 0.25)),
    bass: milk(bands[0]), bass_att: onePole(milk(bands[0]), 0.15, 0.15), mid: milk(bands[1]), treb: milk(bands[2]),
    centroid: onePole(cent.map((v, i) => (rms[i] > 1e-3 ? v : 0)), 0.05, 0.05),
    hits: decayTrigger(n, pick(fluxC, true), 0.15),
    rms_offline: norm01(sm, pct(sm, 0.05), pct(sm, 0.95)),
    hits_offline: decayTrigger(n, pick(fluxO, false), 0.15)
  };
}

/* ---------------- measures ---------------- */
// ranks (ties share their mean rank), scaled to 0..1
function rankNorm(a) {
  const idx = Array.from(a, (_, i) => i).sort((p, q) => a[p] - a[q]), out = new Float64Array(a.length);
  for (let s = 0; s < idx.length;) { let e = s; while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[s]]) e++; const r = (s + e) / 2 / Math.max(1, a.length - 1); for (let k = s; k <= e; k++) out[idx[k]] = r; s = e + 1; }
  return out;
}
function hfShare(a) {                             // share of the signal's power (mean removed) above 8 Hz
  const r = a, m = r.reduce((s, v) => s + v, 0) / r.length; let N = 1; while (N < r.length) N *= 2;
  const re = new Float64Array(N), im = new Float64Array(N); r.forEach((v, i) => (re[i] = v - m)); WL.getFFT(N)(re, im);
  let hi = 0, all = 0; for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; all += p; if (k * FPS / N > 8) hi += p; }
  return all > 0 ? hi / all : 0;
}
function flashes(a) {                             // WCAG 2.3.1 general flashes with the value as relative luminance
  // transitions: swings of 0.1 or more from the last extreme, alternating, the darker state below 0.8; a flash is two
  const tr = []; let lo = a[0], hi = a[0], dir = 0;
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    if (dir >= 0) { hi = Math.max(hi, v); if (hi - v >= 0.1 && v < 0.8) { tr.push(i); dir = -1; lo = v; continue; } }
    if (dir <= 0) { lo = Math.min(lo, v); if (v - lo >= 0.1 && lo < 0.8) { tr.push(i); dir = 1; hi = v; } }
  }
  let worst = 0, over = 0, wins = 0;
  for (let s = 0; s + FPS <= a.length; s += FPS / 4) { const k = tr.filter(i => i >= s && i < s + FPS).length / 2; worst = Math.max(worst, k); over += k > 3 ? 1 : 0; wins++; }
  return { max: worst, over: wins ? over / wins : 0 };
}
function peaks(a, prom) {
  const out = [];
  for (let i = 1; i < a.length - 1; i++) {
    if (!(a[i] > a[i - 1] && a[i] >= a[i + 1])) continue;
    let l = a[i], r = a[i]; for (let j = i - 1; j >= Math.max(0, i - 2 * FPS); j--) { l = Math.min(l, a[j]); if (a[j] > a[i]) break; }
    for (let j = i + 1; j < Math.min(a.length, i + 2 * FPS); j++) { r = Math.min(r, a[j]); if (a[j] > a[i]) break; }
    if (a[i] - Math.max(l, r) >= prom) out.push(i);
  }
  return out.filter((p, k, s) => !k || p - s[k - 1] >= 0.05 * FPS);
}
// accents hit: a peak counts when it is from 125 ms before to 45 ms after an accent (ITU-R BT.1359: a picture early
// by up to 125 ms or late by up to 45 ms is not noticed)
function accentScore(a, accents) {
  const ps = peaks(a, 0.15).map(i => i / FPS), used = new Set(); let hit = 0; const lat = [];
  for (const t of accents) {
    let best = -1, bd = Infinity;
    ps.forEach((p, k) => { const d = p - t; if (!used.has(k) && d >= -0.125 && d <= 0.045 && Math.abs(d) < bd) { bd = Math.abs(d); best = k; } });
    if (best >= 0) { used.add(best); hit++; lat.push(ps[best] - t); }
  }
  const P = ps.length ? hit / ps.length : 0, R = accents.length ? hit / accents.length : 0;
  lat.sort((p, q) => p - q);
  return { precision: P, recall: R, f1: P + R ? 2 * P * R / (P + R) : 0, latency: lat.length ? lat[Math.floor(lat.length / 2)] : null, peaks: ps.length };
}
function eta2(a, cuts, guard) {                   // share of the variance between sections (frames near a boundary left out)
  const groups = [];
  for (let s = 0; s < cuts.length - 1; s++) { const g = []; for (let i = Math.ceil((cuts[s] + guard) * FPS); i < Math.floor((cuts[s + 1] - guard) * FPS) && i < a.length; i++) g.push(a[i]); if (g.length) groups.push(g); }
  const all = groups.flat(), m = all.reduce((x, v) => x + v, 0) / all.length;
  let tot = 0, bet = 0; for (const v of all) tot += (v - m) ** 2;
  for (const g of groups) { const gm = g.reduce((x, v) => x + v, 0) / g.length; bet += g.length * (gm - m) ** 2; }
  return tot > 0 ? bet / tot : 0;
}
function spearman(x, y) {
  const rx = rankNorm(x), ry = rankNorm(y), n = rx.length, mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
function auc(pos, neg) { let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0; return pos.length && neg.length ? s / (pos.length * neg.length) : 0.5; }
function rangeUse(a) {
  const h = new Array(32).fill(0); for (const v of a) h[Math.min(31, Math.floor(v * 32))]++;
  const H = -h.reduce((s, c) => (c ? s + (c / a.length) * Math.log2(c / a.length) : s), 0);
  return { spread: pct(a, 0.95) - pct(a, 0.05), entropy: H / 5, dead: a.filter(v => v < 0.05).length / a.length, saturated: a.filter(v => v > 0.98).length / a.length };
}

/* ---------------- run ---------------- */
(async () => {
  await WL.calibrate(SR);
  fs.mkdirSync(path.join(SITE, "data"), { recursive: true }); fs.mkdirSync(path.join(SITE, "audio"), { recursive: true });
  const stimuli = [groove(), riser(), swell(), timbre(), sfx(), dense()];
  const results = { generator: "experiments/visuals/run.js, Playhead " + Playhead.version, fps: FPS, stimuli: {} };
  const driverAll = {};
  for (const S of stimuli) {
    // the same peak level for every stimulus (-1 dBFS)
    let pk = 0; for (const v of S.y) pk = Math.max(pk, Math.abs(v)); const g = Math.pow(10, -1 / 20) / pk; for (let i = 0; i < S.y.length; i++) S.y[i] *= g;
    const n = Math.ceil(S.dur * FPS);
    const doc = await Playhead.analyze(IO.makeBuffer(SR, [S.y]), { name: S.name + ".wav", curveRate: 100 });
    const fr = Playhead.frames(doc, { fps: FPS, scale: "file", curves: ["loudness", "onsetStrength", "harshness", "timbreHarshness", "tension", "activity", "arousal"] });
    const usual = usualDrivers(S.y, n);
    // the continuous curves scaled to their range in the file (as a VJ sets a gain); onset strength as the strip
    // draws it, whose peaks the file's range would clip
    const fixed = Playhead.frames(doc, { fps: FPS, curves: ["onsetStrength"] });
    const ph = { ph_loudness: fr.curves.loudness, ph_onset: fixed.curves.onsetStrength, ph_harsh: fr.curves.harshness, ph_timbre: fr.curves.timbreHarshness, ph_tension: fr.curves.tension,
      ph_activity: fr.curves.activity, ph_arousal: fr.curves.arousal, ph_hits: decayTrigger(n, fr.onsets, 0.15) };
    // the control: shifted by half the stimulus and 0.19 s more, off any beat grid here
    const shift = a => { const k = Math.floor(a.length / 2) + Math.round(0.19 * FPS); return Array.from(a, (_, i) => a[(i + k) % a.length]); };
    const drivers = Object.assign({}, usual, ph, { shift_loudness: shift(ph.ph_loudness), shift_tension: shift(ph.ph_tension), shift_harsh: shift(ph.ph_harsh), shift_hits: shift(ph.ph_hits) });
    for (const k of Object.keys(drivers)) drivers[k] = Array.from(drivers[k]).slice(0, n);
    const m = {};
    for (const [k, a] of Object.entries(drivers)) {
      const x = { range: rangeUse(a), hf: hfShare(a), flashes: flashes(a), accents: accentScore(a, S.accents) };
      if (S.sections) x.eta2 = eta2(a, S.sections, 0.5);
      if (S.build) { const i0 = Math.round(S.build[0] * FPS), i1 = Math.round(S.build[1] * FPS), seg = a.slice(i0, i1); x.build = spearman(seg, seg.map((_, i) => i));
        const mean = q => q.reduce((u, v) => u + v, 0) / q.length; x.buildRise = mean(seg.slice(-2 * FPS)) - mean(seg.slice(0, 2 * FPS)); }
      if (S.blocks) {
        const pos = [], neg = [];
        for (const b of S.blocks) for (let i = Math.ceil((b.start + 0.3) * FPS); i < Math.floor((b.end - 0.3) * FPS); i++) (b.harsh ? pos : neg).push(a[i]);
        x.timbre = auc(pos, neg);
        const bright = [], dark = []; for (const b of S.blocks) if (!b.harsh) for (let i = Math.ceil((b.start + 0.3) * FPS); i < Math.floor((b.end - 0.3) * FPS); i++) (b.kind === "bright" ? bright : dark).push(a[i]);
        x.brightness = auc(bright, dark);
        x.kinds = {}; for (const b of S.blocks) { const v = x.kinds[b.kind] || (x.kinds[b.kind] = [0, 0]); for (let i = Math.ceil((b.start + 0.3) * FPS); i < Math.floor((b.end - 0.3) * FPS); i++) { v[0] += a[i]; v[1]++; } }
        for (const kd of Object.keys(x.kinds)) x.kinds[kd] = x.kinds[kd][0] / x.kinds[kd][1];
      }
      x.level = spearman(a, drivers.rms_offline);
      m[k] = x;
      (driverAll[k] = driverAll[k] || []).push(x.level);
    }
    results.stimuli[S.name] = { duration: S.dur, accents: S.accents.length, sections: S.sections || null, build: S.build || null, measures: m,
      playhead: { profile: doc.profile, onsets: doc.onsets.length, tempo: doc.rhythm ? doc.rhythm.tempo : null } };
    // the viewer's data and audio
    fs.writeFileSync(path.join(SITE, "data", S.name + ".json"), JSON.stringify({ name: S.name, fps: FPS, frames: n, duration: S.dur, accents: S.accents.map(r3), sections: S.sections || null,
      build: S.build || null, blocks: S.blocks || null, drivers: Object.fromEntries(Object.entries(drivers).map(([k, a]) => [k, a.map(v => Math.round(v * 1000) / 1000)])) }));
    const tmp = path.join(os.tmpdir(), "playhead-visuals-" + S.name + ".wav");
    IO.writeWav(tmp, { numberOfChannels: 1, length: S.y.length, sampleRate: SR, getChannelData: () => S.y }, true);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "8", path.join(SITE, "audio", S.name + ".flac")]);
    fs.rmSync(tmp);
    console.error(S.name + ": " + S.accents.length + " accents, Playhead " + doc.profile + " with " + doc.onsets.length + " onsets");
  }
  // redundancy with the level: the rank correlation with the offline RMS, the mean over the stimuli
  results.redundancy = Object.fromEntries(Object.entries(driverAll).map(([k, a]) => [k, r3(a.reduce((x, v) => x + v, 0) / a.length)]));
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 1) + "\n");

  // the summary tables
  const S = results.stimuli, f = v => (v == null ? "–" : v.toFixed(2));
  const row = (k, cells) => "| " + k + " | " + cells.join(" | ") + " |";
  const accentDrivers = ["rms", "bass", "hits", "hits_offline", "rms_offline", "ph_onset", "ph_hits", "shift_hits"];
  console.log("\nAccents hit (F1; a peak from 125 ms early to 45 ms late): groove, riser, swell, sfx, dense; median latency in groove");
  for (const k of accentDrivers) console.log(row(k, ["groove", "riser", "swell", "sfx", "dense"].map(s => f(S[s].measures[k].accents.f1)).concat([f(S.groove.measures[k].accents.latency * 1000) + " ms"])));
  const slow = ["rms", "bass_att", "rms_offline", "centroid", "ph_loudness", "ph_arousal", "ph_activity", "ph_tension", "ph_timbre", "shift_loudness", "shift_tension"];
  console.log("\nStructure and builds: groove eta2, riser rho, swell rho; jitter (share above 8 Hz, mean); flashes/s (worst); seconds over 3 flashes (share, worst); level correlation");
  for (const k of slow) {
    const hf = stimuli.map(s => S[s.name].measures[k].hf), fl = Math.max(...stimuli.map(s => S[s.name].measures[k].flashes.max)), ov = Math.max(...stimuli.map(s => S[s.name].measures[k].flashes.over));
    console.log(row(k, [f(S.groove.measures[k].eta2), f(S.riser.measures[k].build) + " (" + f(S.riser.measures[k].buildRise) + ")", f(S.swell.measures[k].build) + " (" + f(S.swell.measures[k].buildRise) + ")", f(hf.reduce((a, b) => a + b, 0) / hf.length), fl.toFixed(1), f(ov), f(results.redundancy[k])]));
  }
  console.log("\nTimbre at equal loudness: AUC harsh (rough, clipped) vs smooth (dark, bright); AUC bright vs dark; mean per kind");
  for (const k of ["rms", "treb", "centroid", "rms_offline", "ph_harsh", "ph_timbre", "ph_loudness", "ph_arousal", "shift_harsh"]) { const T = S.timbre.measures[k]; console.log(row(k, [f(T.timbre), f(T.brightness), ...["dark", "bright", "rough", "clipped"].map(kd => kd + " " + f(T.kinds[kd]))])); }
})().catch(e => { console.error(e); process.exit(1); });
