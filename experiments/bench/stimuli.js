// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The bench's sounds: grooves built from synthesized drums, so that every hit's time, band, place in the bar and
// deviation from the grid is known to the sample. Each stimulus is { name, sr, y (Float32Array, mono), truth }, where
// truth has hits [{ t (s, where the hit starts), inst ("kick" | "snare" | "hat" | ...), band ("low" | "mid" | "high"),
// bar, pos (beats into the bar), dev (ms from the straight grid) }], bpm, beatsPerBar, bars, and what the stimulus
// tests (swing ratio, offsets per instrument, jitter, tempo pulses).
//
//   const B = require("./stimuli.js"); B.all(44100) -> [stimulus, ...]
"use strict";

// a seeded random function (Park-Miller)
function rng(seed) { let s = seed % 2147483646 + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// the drums: each starts rising at its first sample, so the hit's time is exact
function kick(sr, r) {
  const n = Math.round(0.35 * sr), y = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (48 + 110 * Math.exp(-t * 30)) / sr; y[i] = Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, t / 0.0008); }
  return y;
}
function snare(sr, r) {
  const n = Math.round(0.2 * sr), y = new Float32Array(n); let lp = 0, hp = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = r() * 2 - 1; lp += 0.35 * (w - lp); hp = lp - hp * 0.0 - (i ? 0 : 0);    // noise, lowpassed near 3 kHz
    ph += 2 * Math.PI * 190 / sr;
    y[i] = (0.55 * lp * Math.exp(-t * 22) + 0.6 * Math.sin(ph) * Math.exp(-t * 28)) * Math.min(1, t / 0.0006);
  }
  return y;
}
function hat(sr, r) {
  const n = Math.round(0.06 * sr), y = new Float32Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, w = r() * 2 - 1, d = w - prev; prev = w; y[i] = 0.35 * d * Math.exp(-t * 70) * Math.min(1, t / 0.0003); }
  return y;
}
const DRUMS = { kick: [kick, "low"], snare: [snare, "mid"], hat: [hat, "high"] };

// a groove: pattern[inst] = steps (16ths) in a bar where the instrument plays; opts: bpm, bars, beatsPerBar, swing (the
// 8th-note swing ratio: an off-beat 8th at ratio/(1+ratio) of the beat), offsets { inst: ms }, jitter (ms, SD), seed,
// gains { inst: dB }; patternFor(bar) and swingFor(bar) to change them from bar to bar
function groove(name, sr, pattern, opts) {
  const o = Object.assign({ bpm: 120, bars: 12, beatsPerBar: 4, swing: 1, offsets: {}, jitter: 0, seed: 1, gains: {} }, opts);
  const r = rng(o.seed), beat = 60 / o.bpm, lead = 0.5, dur = lead + o.bars * o.beatsPerBar * beat + 0.8;
  const y = new Float32Array(Math.round(dur * sr)), hits = [];
  const gauss = () => { let s = 0; for (let k = 0; k < 6; k++) s += r(); return (s - 3) * Math.SQRT2; };
  for (let bar = 0; bar < o.bars; bar++) for (const [inst, steps] of Object.entries(o.patternFor ? o.patternFor(bar) : pattern)) for (const st of steps) {
    const b = Math.floor(st / 4), q = st % 4, sw = o.swingFor ? o.swingFor(bar) : o.swing;
    // where the step falls: straight 16ths, or the off-beat 8th swung
    const frac = q === 2 ? sw / (1 + sw) : q / 4;
    const dev = (o.offsets[inst] || 0) + (o.jitter ? o.jitter * gauss() : 0);
    const t = lead + (bar * o.beatsPerBar + b + frac) * beat + dev / 1000, i0 = Math.round(t * sr);
    const x = DRUMS[inst][0](sr, r), g = Math.pow(10, (o.gains[inst] || 0) / 20);
    for (let i = 0; i < x.length && i0 + i < y.length; i++) y[i0 + i] += g * x[i];
    hits.push({ t: i0 / sr, inst, band: DRUMS[inst][1], bar, pos: b + frac, dev: Math.round((i0 / sr - (lead + (bar * o.beatsPerBar + b + frac) * beat)) * 1e5) / 100 + 0 });
  }
  hits.sort((a, b) => a.t - b.t);
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < y.length; i++) y[i] *= 0.9 / pk;
  return { name, sr, y, truth: { hits, bpm: o.bpm, beatsPerBar: o.beatsPerBar, bars: o.bars, start: lead, swing: o.swing, offsets: o.offsets, jitter: o.jitter,
    swingByBar: o.swingFor ? Array.from({ length: o.bars }, (_, k) => o.swingFor(k)) : null } };
}
// a pulse of clicks at one rate (BPM), for the tempo range
function pulse(name, sr, bpm, seconds) {
  const y = new Float32Array(Math.round(seconds * sr)), r = rng(5), hits = [], x = hat(sr, r);
  for (let t = 0.3; t < seconds - 0.2; t += 60 / bpm) { const i0 = Math.round(t * sr); for (let i = 0; i < x.length && i0 + i < y.length; i++) y[i0 + i] += 3 * x[i]; hits.push({ t: i0 / sr, inst: "click", band: "high" }); }
  return { name, sr, y, truth: { hits, bpm, pulse: true } };
}
// onsets at random times (no beat), for pulse clarity and downbeat confidence when there is nothing to find
function scatter(name, sr, seconds) {
  const y = new Float32Array(Math.round(seconds * sr)), r = rng(11), hits = [];
  for (let t = 0.3; t < seconds - 0.4;) {
    const inst = ["kick", "snare", "hat"][Math.floor(r() * 3)], x = DRUMS[inst][0](sr, r), i0 = Math.round(t * sr);
    for (let i = 0; i < x.length && i0 + i < y.length; i++) y[i0 + i] += x[i];
    hits.push({ t: i0 / sr, inst, band: DRUMS[inst][1] }); t += 0.12 + 0.5 * r();
  }
  return { name, sr, y, truth: { hits, bpm: null } };
}

// the momentary loudness of y[a, b) held constant (K-weighted power in 400 ms windows, as the visuals experiment does)
function flatten(y, sr, a, b) {
  const WL = require("../../src/analysis.js"), [s1, s2] = WL.kFilterCoeffs(sr), seg = y.slice(a, b), t = new Float32Array(seg.length), k = new Float32Array(seg.length);
  WL.biquadInto(seg, t, s1); WL.biquadInto(t, k, s2);
  const hop = Math.round(0.05 * sr), w = Math.round(0.4 * sr), pts = [];
  for (let c = 0; c < seg.length; c += hop) { let e = 0, m = 0; for (let i = Math.max(0, c - w / 2); i < Math.min(seg.length, c + w / 2); i++) { e += k[i] * k[i]; m++; } pts.push(e / Math.max(1, m)); }
  const ref = pts.slice().sort((p, q) => p - q)[Math.floor(pts.length / 2)];
  for (let i = 0; i < seg.length; i++) { const f = i / hop, j = Math.min(pts.length - 2, Math.floor(f)), u = f - j, p = pts[j] + (pts[j + 1] - pts[j]) * u; y[a + i] = seg[i] * Math.sqrt(ref / Math.max(p, ref * 1e-4)); }
}
const place = (y, x, t, sr, g) => { const i0 = Math.round(t * sr); for (let i = 0; i < x.length && i0 + i < y.length; i++) y[i0 + i] += (g == null ? 1 : g) * x[i]; return i0 / sr; };
const norm = y => { let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < y.length; i++) y[i] *= 0.9 / pk; return y; };
// builds that are not louder: 4 s of groove, a 12 s build at constant loudness, a drop, 6 s of groove. kind "riser":
// a band of noise sweeping from 300 Hz to 8 kHz and a snare roll from 2 to 16 a second; "swell": more and more hits
// at an even brightness (hats from 4 to 16 a second, a snare roll from 1 to 12, toms from the middle on)
function build(name, sr, kind) {
  const dur = 22, y = new Float32Array(dur * sr), r = rng(21), beat = 0.5;
  for (let t = 0; t < 4; t += beat) { place(y, kick(sr, r), t, sr); place(y, hat(sr, r), t + 0.25, sr, 0.5); }
  const a = 4 * sr, b = 16 * sr;
  if (kind === "riser") {
    let lp = 0, lp2 = 0;
    for (let i = a; i < b; i++) { const u = (i - a) / (b - a), fc = 300 * Math.pow(8000 / 300, u), al = 1 - Math.exp(-2 * Math.PI * fc / sr); lp += al * ((r() * 2 - 1) - lp); lp2 += al * 0.5 * (lp - lp2); y[i] += 0.3 * (lp - lp2); }
    for (let t = 4; t < 16;) { place(y, snare(sr, r), t, sr, 0.3); t += 1 / (2 * Math.pow(8, (t - 4) / 12)); }
  } else {
    for (let t = 4; t < 16;) { place(y, hat(sr, r), t, sr, 0.6); t += 1 / (4 * Math.pow(4, (t - 4) / 12)); }
    for (let t = 4; t < 16;) { place(y, snare(sr, r), t, sr, 0.4); t += 1 / Math.pow(12, (t - 4) / 12); }
    for (let t = 10; t < 16; t += 0.5) place(y, kick(sr, r), t, sr, 0.3);
  }
  flatten(y, sr, a, b);
  for (let t = 16; t < dur - 0.4; t += beat) { place(y, kick(sr, r), t, sr, 1.4); place(y, snare(sr, r), t + 0.25, sr, 0.6); }
  return { name, sr, y: norm(y), truth: { hits: [], build: [4, 16], drop: 16 } };
}
// timbres at equal loudness, 3 s blocks: smooth dark (110-330 Hz sines), smooth bright (2.5-5.2 kHz sines), rough (a
// 220 Hz harmonic tone, 70 Hz amplitude modulation), clipped (a 220 Hz sawtooth clipped hard)
function timbres(name, sr) {
  const order = ["dark", "clipped", "bright", "rough", "clipped", "dark", "bright", "clipped", "rough", "dark"], blk = 3, y = new Float32Array(order.length * blk * sr);
  const WL = require("../../src/analysis.js"), [s1, s2] = WL.kFilterCoeffs(sr);
  const kp = (a, b) => { const seg = y.slice(a, b), t = new Float32Array(seg.length), k = new Float32Array(seg.length); WL.biquadInto(seg, t, s1); WL.biquadInto(t, k, s2); let e = 0; for (const v of k) e += v * v; return e / k.length; };
  order.forEach((kind, k) => {
    const a = k * blk * sr, n = blk * sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.min(1, i / (0.05 * sr), (n - i) / (0.05 * sr));
      let v;
      if (kind === "dark") v = Math.sin(2 * Math.PI * 110 * t) + 0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 330 * t);
      else if (kind === "bright") v = [2500, 3300, 4100, 5200].reduce((s, f, j) => s + Math.sin(2 * Math.PI * f * t + j), 0) / 2;
      else if (kind === "rough") { v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 220 * h * t) / h; v *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 70 * t); }
      else { const saw = 2 * ((220 * t) % 1) - 1; v = Math.max(-0.3, Math.min(0.3, 4 * saw)) * 3; }
      y[a + i] = v * env;
    }
  });
  const target = kp(0, blk * sr);
  order.forEach((_, k) => { const a = k * blk * sr, g = Math.sqrt(target / kp(a, a + blk * sr)); for (let i = a; i < a + blk * sr; i++) y[i] *= g * 0.4; });
  return { name, sr, y, truth: { hits: [], blocks: order.map((kind, k) => ({ start: k * blk, end: (k + 1) * blk, kind })) } };
}
// a source passing by at speed v (m/s), 20 m from the listener: a harmonic tone at 180 Hz with the Doppler shift
// f c / (c - v cos theta) and level falling with distance; and, after it, a tone with 6 Hz vibrato of +-40 cents and
// one with a 28 Hz "rotor" (+-15 cents)
function motion(name, sr, v) {
  const c = 343, d = 20, dur = 14, y = new Float32Array(dur * sr); let ph = 0, ph2 = 0;
  const pass = [1, 7];                                          // the pass: from 1 s to 7 s, closest at 4 s
  for (let i = 0; i < y.length; i++) {
    const t = i / sr;
    if (t >= pass[0] && t < pass[1]) {
      const x = v * (t - 4), r = Math.hypot(x, d), cos = -x / r, f = 180 * c / (c - v * cos);
      ph += 2 * Math.PI * f / sr;
      let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(h * ph) / h;
      y[i] = s * (d / r) * Math.min(1, (t - pass[0]) / 0.05, (pass[1] - t) / 0.05) * 0.5;
    } else if (t >= 8 && t < 10.5) {
      const f = 330 * Math.pow(2, 40 / 1200 * Math.sin(2 * Math.PI * 6 * (t - 8)));
      ph2 += 2 * Math.PI * f / sr; y[i] = 0.4 * (Math.sin(ph2) + 0.4 * Math.sin(2 * ph2)) * Math.min(1, (t - 8) / 0.05, (10.5 - t) / 0.05);
    } else if (t >= 11 && t < 13.5) {
      const f = 260 * Math.pow(2, 15 / 1200 * Math.sin(2 * Math.PI * 28 * (t - 11)));
      ph2 += 2 * Math.PI * f / sr; y[i] = 0.4 * (Math.sin(ph2) + 0.4 * Math.sin(2 * ph2)) * Math.min(1, (t - 11) / 0.05, (13.5 - t) / 0.05);
    }
  }
  const fFar0 = 180 * c / (c + v * Math.cos(Math.atan2(d, v * 3))), fNear0 = 180 * c / (c - v * Math.cos(Math.atan2(d, v * 3)));
  return { name, sr, y: norm(y), truth: { hits: [], passBy: { start: 1, end: 7, closest: 4, speed: v, from: fNear0, to: fFar0 }, vibrato: [{ start: 8, end: 10.5, rate: 6, depth: 80 }, { start: 11, end: 13.5, rate: 28, depth: 30 }] } };
}

// a rock beat: kick on 1 and 3 (and the "and" of 3), snare on 2 and 4, hats on the off-beat 8ths (so no hit masks
// another and each can be measured)
const ROCK = { kick: [0, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14] };
function all(sr) {
  return [
    groove("straight", sr, ROCK, { bpm: 110 }),
    groove("snare-laid-back", sr, ROCK, { bpm: 110, offsets: { snare: 25 } }),
    groove("hats-pushed", sr, ROCK, { bpm: 110, offsets: { hat: -15 } }),
    groove("loose", sr, ROCK, { bpm: 110, jitter: 12, seed: 3 }),
    groove("swing-1.5", sr, ROCK, { bpm: 100, swing: 1.5 }),
    groove("swing-2", sr, ROCK, { bpm: 100, swing: 2 }),
    groove("swing-3", sr, ROCK, { bpm: 100, swing: 3 }),
    groove("waltz", sr, { kick: [0], snare: [4, 8], hat: [2, 6, 10] }, { bpm: 132, beatsPerBar: 3, bars: 16 }),
    // a fill on the last beat of every fourth bar (snare 16ths), and a break in bar 13 (the kick alone)
    Object.assign(groove("fills", sr, ROCK, { bpm: 112, bars: 16, patternFor: bar => bar === 12 ? { kick: [0] } : bar % 4 === 3 ? { kick: [0, 8], snare: [4, 12, 13, 14, 15], hat: [2, 6, 10] } : ROCK }),
      { changes: { fills: [3, 7, 11, 15], breaks: [12] } }),
    // straight for 8 bars, then swung (2) for 8
    groove("swing-change", sr, ROCK, { bpm: 100, bars: 16, swingFor: bar => (bar < 8 ? 1 : 2) }),
    groove("sixteenths", sr, { kick: [0, 8], snare: [4, 12], hat: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15] }, { bpm: 96, gains: { hat: -6 } }),
    pulse("pulse-32", sr, 32, 24), pulse("pulse-480", sr, 480, 16),
    scatter("no-beat", sr, 24),
    // the same rock beat faster: the rhythm signature should find it alike
    groove("straight-140", sr, ROCK, { bpm: 140, bars: 16 }),
    build("riser", sr, "riser"), build("swell", sr, "swell"),
    timbres("timbres", sr),
    motion("pass-by", sr, 25)
  ];
}
module.exports = { all, groove, pulse, scatter, build, timbres, motion, ROCK, rng };
