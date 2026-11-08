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
// gains { inst: dB }
function groove(name, sr, pattern, opts) {
  const o = Object.assign({ bpm: 120, bars: 12, beatsPerBar: 4, swing: 1, offsets: {}, jitter: 0, seed: 1, gains: {} }, opts);
  const r = rng(o.seed), beat = 60 / o.bpm, lead = 0.5, dur = lead + o.bars * o.beatsPerBar * beat + 0.8;
  const y = new Float32Array(Math.round(dur * sr)), hits = [];
  const gauss = () => { let s = 0; for (let k = 0; k < 6; k++) s += r(); return (s - 3) * Math.SQRT2; };
  for (let bar = 0; bar < o.bars; bar++) for (const [inst, steps] of Object.entries(pattern)) for (const st of steps) {
    const b = Math.floor(st / 4), q = st % 4;
    // where the step falls: straight 16ths, or the off-beat 8th swung
    const frac = q === 2 ? o.swing / (1 + o.swing) : q / 4;
    const dev = (o.offsets[inst] || 0) + (o.jitter ? o.jitter * gauss() : 0);
    const t = lead + (bar * o.beatsPerBar + b + frac) * beat + dev / 1000, i0 = Math.round(t * sr);
    const x = DRUMS[inst][0](sr, r), g = Math.pow(10, (o.gains[inst] || 0) / 20);
    for (let i = 0; i < x.length && i0 + i < y.length; i++) y[i0 + i] += g * x[i];
    hits.push({ t: i0 / sr, inst, band: DRUMS[inst][1], bar, pos: b + frac, dev: Math.round((i0 / sr - (lead + (bar * o.beatsPerBar + b + frac) * beat)) * 1e5) / 100 + 0 });
  }
  hits.sort((a, b) => a.t - b.t);
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < y.length; i++) y[i] *= 0.9 / pk;
  return { name, sr, y, truth: { hits, bpm: o.bpm, beatsPerBar: o.beatsPerBar, bars: o.bars, start: lead, swing: o.swing, offsets: o.offsets, jitter: o.jitter } };
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
    groove("sixteenths", sr, { kick: [0, 8], snare: [4, 12], hat: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15] }, { bpm: 96, gains: { hat: -6 } }),
    pulse("pulse-32", sr, 32, 24), pulse("pulse-480", sr, 480, 16),
    scatter("no-beat", sr, 24)
  ];
}
module.exports = { all, groove, pulse, scatter, ROCK, rng };
