// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead

(function (root) {
"use strict";

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function bq(x, out, c) {
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = c[0] * v + z1; z1 = c[1] * v - c[3] * y + z2; z2 = c[2] * v - c[4] * y; out[i] = y; }
}
function kLufs(L, R, kc) {
  let e = 0;
  for (const x of [L, R]) {
    const a = new Float32Array(x.length), b = new Float32Array(x.length);
    bq(x, a, kc[0]); bq(a, b, kc[1]);
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    e += s / Math.max(1, b.length);
  }
  return -0.691 + 10 * Math.log10(e + 1e-20);
}
function gainTo(L, R, kc, target, s0, s1) {
  const a = s0 || 0, b = s1 || L.length;
  const cur = kLufs(L.subarray(a, b), R.subarray(a, b), kc);
  const g = Math.pow(10, (target - cur) / 20);
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
}
function fade(L, R, sr, fin, fout) {
  const ni = Math.round(fin * sr), no = Math.round(fout * sr), n = L.length;
  for (let i = 0; i < ni && i < n; i++) { const g = i / ni; L[i] *= g; R[i] *= g; }
  for (let i = 0; i < no && i < n; i++) { const g = i / no; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
}

/* Small synthesizer shared by both test signals */
function makeSynth(sr, seed) {
  const rnd = mulberry32(seed);
  const noise = () => rnd() * 2 - 1;
  const TWO_PI = 2 * Math.PI;
  const len = s => Math.round(s * sr);
  const S = { sr, rnd, noise, len };

  S.kick = function (L, R, t0, g) {
    const s0 = len(t0), n = len(0.45); let ph = 0;
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      if (s0 + i < 0) continue;
      const tau = i / sr, f = 48 + 95 * Math.exp(-tau / 0.035);
      ph += TWO_PI * f / sr;
      const v = g * Math.sin(ph) * Math.exp(-tau / 0.17) * Math.min(1, i / 30);
      L[s0 + i] += v; R[s0 + i] += v;
    }
  };
  S.snare = function (L, R, t0, g, pan) {
    const s0 = len(t0), n = len(0.32); let prev = 0; pan = pan || 0;
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, w = noise(), hp = w - prev; prev = w;
      const v = g * (0.75 * hp * Math.exp(-tau / 0.11) + 0.45 * Math.sin(TWO_PI * 190 * tau) * Math.exp(-tau / 0.05));
      L[s0 + i] += v * (1 - pan * 0.5); R[s0 + i] += v * (1 + pan * 0.5);
    }
  };
  S.hat = function (L, R, t0, g, open) {
    const s0 = len(t0), n = len(open ? 0.35 : 0.09); let p1 = 0, p2 = 0;
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, w = noise(), d1 = w - p1; p1 = w; const d2 = d1 - p2; p2 = d1;
      const v = g * 0.5 * d2 * Math.exp(-tau / (open ? 0.12 : 0.025));
      L[s0 + i] += v * 0.8; R[s0 + i] += v * 1.2;
    }
  };
  S.tom = function (L, R, t0, f0, g, pan) {
    const s0 = len(t0), n = len(0.5); let ph = 0;
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, f = f0 * (1 + 0.6 * Math.exp(-tau / 0.04));
      ph += TWO_PI * f / sr;
      const v = g * Math.sin(ph) * Math.exp(-tau / 0.22) * Math.min(1, i / 20);
      L[s0 + i] += v * (1 - pan * 0.6); R[s0 + i] += v * (1 + pan * 0.6);
    }
  };
  S.crash = function (L, R, t0, g) {
    const s0 = len(t0), n = len(1.4); let p = 0;
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, w = noise(), d = w - p; p = w;
      const v = g * 0.5 * d * Math.exp(-tau / 0.45);
      L[s0 + i] += v * (0.8 + 0.4 * rnd()); R[s0 + i] += v * (0.8 + 0.4 * rnd());
    }
  };
  // sustained chord, rotation oscillators; slope(prog) sets brightness, env(prog) the gain
  S.pad = function (L, R, s0, n, freqs, harmonics, slope, env, detune) {
    detune = detune === undefined ? 0.0023 : detune;
    const blk = 128;
    const tmpL = new Float32Array(n), tmpR = new Float32Array(n);
    freqs.forEach((f0, vi) => {
      const pan = vi % 2 ? 0.3 : -0.3;
      for (const det of [-detune, detune]) {
        for (let h = 1; h <= harmonics; h++) {
          const f = f0 * h * (1 + det); if (f > sr * 0.45) break;
          const ph = rnd() * TWO_PI, inc = TWO_PI * f / sr;
          let c = Math.cos(ph), s = Math.sin(ph);
          const ci = Math.cos(inc), si = Math.sin(inc);
          for (let b = 0; b < n; b += blk) {
            const sl = typeof slope === "function" ? slope(b / n) : slope;
            const amp = 1 / Math.pow(h, sl);
            const e = Math.min(n, b + blk);
            for (let i = b; i < e; i++) {
              const v = amp * s;
              const nc = c * ci - s * si; s = s * ci + c * si; c = nc;
              tmpL[i] += v * (1 - pan); tmpR[i] += v * (1 + pan);
            }
          }
        }
      }
    });
    for (let i = 0; i < n; i++) {
      const g = env ? env(i / n) : 1;
      L[s0 + i] += tmpL[i] * g; R[s0 + i] += tmpR[i] * g;
    }
  };
  S.sub = function (L, R, s0, n, f0, g, duckPeriod) {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const duck = duckPeriod ? Math.min(1, 0.5 + ((t % duckPeriod) / duckPeriod) * 4) : 1;
      ph += TWO_PI * f0 / sr;
      const v = g * Math.sin(ph) * duck;
      L[s0 + i] += v; R[s0 + i] += v;
    }
  };
  S.stab = function (L, R, t0, freqs, g) {
    const s0 = len(t0), n = len(0.18);
    freqs.forEach(f0 => {
      for (let h = 1; h <= 10; h++) {
        const f = f0 * h; if (f > sr * 0.45) break;
        for (let i = 0; i < n && s0 + i < L.length; i++) { const tau = i / sr; const v = g / h * Math.sin(TWO_PI * f * tau) * Math.exp(-tau / 0.08); L[s0 + i] += v; R[s0 + i] += v; }
      }
    });
  };
  S.riser = function (L, R, s0, n, f0, f1, dbFrom) {
    let low = 0, band = 0;
    for (let i = 0; i < n; i++) {
      const prog = i / n;
      const fc = f0 * Math.pow(f1 / f0, prog);
      const f = 2 * Math.sin(Math.PI * Math.min(fc, sr * 0.2) / sr), q = 0.5;
      const w = noise();
      low += f * band; const high = w - low - q * band; band += f * high;
      const g = Math.pow(10, (dbFrom - dbFrom * prog) / 20);
      L[s0 + i] += band * g; R[s0 + i] += band * g * 0.97;
    }
  };
  return S;
}

function concat(parts, sr) {
  let total = 0; for (const p of parts) total += p.L.length;
  const L = new Float32Array(total), R = new Float32Array(total);
  const segs = [];
  let off = 0;
  for (const p of parts) {
    L.set(p.L, off); R.set(p.R, off);
    segs.push({ t0: off / sr, t1: (off + p.L.length) / sr, label: p.label, note: p.note });
    off += p.L.length;
  }
  for (let i = 0; i < total; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); R[i] = Math.max(-1, Math.min(1, R[i])); }
  return { sampleRate: sr, length: total, numberOfChannels: 2, duration: total / sr, getChannelData: c => (c ? R : L), segments: segs };
}

/* ===================================================================
   Probe suite: matched loudness, changing character
   =================================================================== */
function makeProbeSuite(sr, kFilterCoeffs) {
  sr = sr || 44100;
  const kc = kFilterCoeffs(sr);
  const S = makeSynth(sr, 20261016);
  const { len, noise, rnd } = S;
  const TWO_PI = 2 * Math.PI;
  const parts = [];
  const push = (label, L, R, note) => parts.push({ label, L, R, note });
  const buf = s => [new Float32Array(len(s)), new Float32Array(len(s))];
  const TGT = -20;
  const flat = () => 1;
  const swell = p => Math.min(1, p / 0.08);

  { const [L, R] = buf(6); S.pad(L, R, 0, L.length, [130.81, 261.63, 329.63, 392.0], 8, 1.3, swell); gainTo(L, R, kc, TGT); fade(L, R, sr, 0.03, 0.05); push("Major pad", L, R, "static tonal baseline"); }
  { const [L, R] = buf(6); S.pad(L, R, 0, L.length, [130.81, 261.63, 277.18, 329.63, 369.99, 392.0], 8, 1.3, swell); gainTo(L, R, kc, TGT); fade(L, R, sr, 0.03, 0.05); push("Pad + cluster", L, R, "dissonance at equal loudness"); }
  {
    const [L, R] = buf(6);
    for (const ch of [L, R]) {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < ch.length; i++) {
        const w = noise();
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        ch[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
    }
    gainTo(L, R, kc, TGT); fade(L, R, sr, 0.03, 0.05); push("Pink noise", L, R, "stationary noise, rain-like");
  }
  {
    const [L, R] = buf(6);
    for (let bar = 0; bar < 3; bar++) {
      const b = bar * 2;
      [0, 1.0, 1.25].forEach(t => S.kick(L, R, b + t, 1.0));
      [0.5, 1.5].forEach(t => S.snare(L, R, b + t, 0.7, 0));
      for (let k = 0; k < 8; k++) S.hat(L, R, b + k * 0.25, 0.35, false);
    }
    gainTo(L, R, kc, TGT); fade(L, R, sr, 0.005, 0.05); push("Drum loop", L, R, "regular activity");
  }
  {
    const [L, R] = buf(6);
    let t = 0;
    while (t < 5.8) {
      const prog = t / 6, r = rnd();
      if (r < 0.35) S.tom(L, R, t, 90 + 140 * rnd(), 0.9, rnd() * 2 - 1);
      else if (r < 0.7) S.snare(L, R, t, 0.6 + 0.3 * rnd(), rnd() * 2 - 1);
      else if (r < 0.85) S.kick(L, R, t, 0.9);
      else S.hat(L, R, t, 0.4, rnd() < 0.3);
      if (rnd() < 0.06) S.crash(L, R, t, 0.5);
      t += [0.125, 0.0625, 0.1875, 0.125, 0.0625][Math.floor(rnd() * 5)] * (1 - 0.4 * prog);
    }
    gainTo(L, R, kc, TGT); fade(L, R, sr, 0.005, 0.05); push("Drum fill", L, R, "irregular, dense activity");
  }
  { const [L, R] = buf(4); for (let i = 0; i < L.length; i++) { const v = Math.sin(TWO_PI * 1000 * i / sr); L[i] = v; R[i] = v; } gainTo(L, R, kc, TGT); fade(L, R, sr, 0.03, 0.03); push("1 kHz tone", L, R, "roughness reference, 0 asper"); }
  { const [L, R] = buf(4); for (let i = 0; i < L.length; i++) { const t = i / sr; const v = (1 + Math.cos(TWO_PI * 70 * t)) * Math.sin(TWO_PI * 1000 * t); L[i] = v; R[i] = v; } gainTo(L, R, kc, TGT); fade(L, R, sr, 0.03, 0.03); push("Tone, 70 Hz AM", L, R, "roughness reference, 1 asper"); }
  {
    const [L, R] = buf(8);
    S.pad(L, R, 0, L.length, [110, 164.81, 220, 261.63, 329.63], 14, p => 2.4 - 1.4 * p, p => Math.pow(10, (-30 + 30 * p) / 20), 0.003);
    gainTo(L, R, kc, -15, L.length - len(1), L.length); fade(L, R, sr, 0.3, 0.05); push("Crescendo", L, R, "energetic but not busy");
  }
  {
    const [L, R] = buf(8);
    S.riser(L, R, 0, L.length, 200, 10000, -24);
    let t = 0, iv = 0.5;
    while (t < 7.95) { const p = t / 8; S.snare(L, R, t, 0.04 + 0.25 * p * p, 0); t += iv; iv = Math.max(0.0625, iv * 0.93); }
    gainTo(L, R, kc, -17, L.length - len(1), L.length); fade(L, R, sr, 0.05, 0); push("Riser", L, R, "build-up");
    const [LD, RD] = buf(6);
    for (let b = 0; b < 12; b++) { S.kick(LD, RD, b * 0.5, 1.0); S.hat(LD, RD, b * 0.5 + 0.25, 0.4, true); S.stab(LD, RD, b * 0.5 + 0.25, [110, 220, 261.63, 329.63], 0.12); }
    S.sub(LD, RD, 0, LD.length, 55, 0.7, 0.5);
    gainTo(LD, RD, kc, -13); fade(LD, RD, sr, 0, 0.05); push("Drop", LD, RD, "release, new section");
  }
  {
    const [L, R] = buf(3);
    const s0 = len(0.2);
    let ph = 0, lp = 0;
    for (let i = 0; s0 + i < L.length && i < len(1.6); i++) {
      const tau = i / sr;
      ph += TWO_PI * (42 + 60 * Math.exp(-tau / 0.05)) / sr;
      const thump = Math.sin(ph) * Math.exp(-tau / 0.3);
      const w = noise(); lp += 0.35 * (w - lp);
      const burst = lp * Math.exp(-tau / 0.07);
      let metal = 0;
      [523, 1187, 2240, 3517, 5120].forEach((f, k) => { metal += Math.sin(TWO_PI * f * tau + k) * Math.exp(-tau / (0.7 - k * 0.1)) / (k + 1.5); });
      const v = 0.9 * thump + 1.2 * burst + 0.6 * metal;
      L[s0 + i] += v; R[s0 + i] += v * 0.95;
    }
    gainTo(L, R, kc, -15, s0, s0 + len(1)); push("Impact", L, R, "single transient, long tail");
  }
  {
    const [L, R] = buf(3);
    const h = len(1.5), q = 1 / 32768;
    for (let i = h; i < L.length; i++) { L[i] = (rnd() - rnd()) * q; R[i] = (rnd() - rnd()) * q; }
    push("Silence, dither", L, R, "gating check");
  }
  const out = concat(parts, sr);
  out.name = "Probe suite";
  out.kind = "probe";
  return out;
}

/* ===================================================================
   Cue arc: a short structured track (intro, build, drop, breakdown)
   =================================================================== */
function makeCueArc(sr, kFilterCoeffs) {
  sr = sr || 44100;
  const kc = kFilterCoeffs(sr);
  const S = makeSynth(sr, 7);
  const { len, rnd } = S;
  const parts = [];
  const buf = s => [new Float32Array(len(s)), new Float32Array(len(s))];
  const Am = [110, 130.81, 164.81, 220, 261.63, 329.63];
  const F = [87.31, 110, 130.81, 174.61, 220, 261.63];
  const Cmaj = [130.81, 164.81, 196, 261.63, 329.63, 392];
  const G = [98, 123.47, 146.83, 196, 246.94, 293.66];
  const Acl = [110, 130.81, 164.81, 174.61, 220, 246.94, 261.63, 329.63, 349.23];
  const prog = [Am, F, Cmaj, G];
  const bass = [55, 43.65, 65.41, 49];
  const grooveBar = (L, R, t0, kickG, hatG) => {
    for (let b = 0; b < 4; b++) { S.kick(L, R, t0 + b * 0.5, kickG); S.hat(L, R, t0 + b * 0.5 + 0.25, hatG, false); }
    S.snare(L, R, t0 + 0.5, 0.45, 0); S.snare(L, R, t0 + 1.5, 0.45, 0);
  };

  { // intro: quiet pad, slow swell
    const [L, R] = buf(8);
    S.pad(L, R, 0, L.length, Am, 7, 1.8, p => Math.min(1, p / 0.3) * (0.6 + 0.4 * p));
    gainTo(L, R, kc, -30); fade(L, R, sr, 0.5, 0.02);
    parts.push({ label: "Intro", L, R });
  }
  { // groove
    const [L, R] = buf(12);
    for (let c = 0; c < 6; c++) S.pad(L, R, len(c * 2), len(2), prog[c % 4], 7, 1.6, () => 0.07);
    for (let bar = 0; bar < 6; bar++) grooveBar(L, R, bar * 2, 1.0, 0.3);
    for (let c = 0; c < 6; c++) S.sub(L, R, len(c * 2), len(2), bass[c % 4], 0.45, 0.5);
    gainTo(L, R, kc, -20); fade(L, R, sr, 0.02, 0.02);
    parts.push({ label: "Groove", L, R });
  }
  { // build: riser, accelerating snare, brightening pad, bass removed near the end
    const [L, R] = buf(8);
    S.pad(L, R, 0, L.length, G, 12, p => 1.8 - 1.0 * p, p => 0.05 + 0.07 * p);
    S.riser(L, R, 0, L.length, 300, 9000, -26);
    let t = 0, iv = 0.5;
    while (t < 7.95) { const p = t / 8; S.snare(L, R, t, 0.12 + 0.7 * p * p, 0); t += iv; iv = Math.max(0.0625, iv * 0.92); }
    for (let b = 0; b < 12; b++) S.kick(L, R, b * 0.5, 0.8);
    gainTo(L, R, kc, -15, L.length - len(1), L.length); fade(L, R, sr, 0.02, 0);
    parts.push({ label: "Build", L, R });
  }
  { // drop: full groove, chord stabs, sub
    const [L, R] = buf(12);
    for (let c = 0; c < 6; c++) {
      const t0 = c * 2;
      for (let b = 0; b < 4; b++) { S.kick(L, R, t0 + b * 0.5, 1.0); S.hat(L, R, t0 + b * 0.5 + 0.25, 0.45, true); S.stab(L, R, t0 + b * 0.5 + 0.25, prog[c % 4].slice(2), 0.14); }
      S.snare(L, R, t0 + 0.5, 0.5, 0); S.snare(L, R, t0 + 1.5, 0.5, 0);
      S.sub(L, R, len(t0), len(2), bass[c % 4], 0.7, 0.5);
    }
    gainTo(L, R, kc, -12); fade(L, R, sr, 0, 0.02);
    parts.push({ label: "Drop", L, R });
  }
  { // breakdown: suspended cluster, then resolution
    const [L, R] = buf(8);
    S.pad(L, R, 0, len(5), Acl, 8, 1.4, p => Math.min(1, p / 0.1));
    S.pad(L, R, len(5), len(3), Am, 8, 1.6, p => 1 - 0.3 * p);
    gainTo(L, R, kc, -24); fade(L, R, sr, 0.05, 0.02);
    parts.push({ label: "Breakdown", L, R });
  }
  { // second groove with an irregular fill in the last bar
    const [L, R] = buf(8);
    for (let c = 0; c < 4; c++) S.pad(L, R, len(c * 2), len(2), prog[c % 4], 7, 1.6, () => 0.07);
    for (let bar = 0; bar < 3; bar++) grooveBar(L, R, bar * 2, 1.0, 0.3);
    for (let c = 0; c < 4; c++) S.sub(L, R, len(c * 2), len(2), bass[c % 4], 0.45, 0.5);
    let t = 6;
    while (t < 7.9) { const r = rnd(); if (r < 0.5) S.tom(L, R, t, 90 + 140 * rnd(), 0.9, rnd() * 2 - 1); else S.snare(L, R, t, 0.6, rnd() * 2 - 1); t += [0.125, 0.0625][Math.floor(rnd() * 2)]; }
    gainTo(L, R, kc, -19); fade(L, R, sr, 0.02, 0.02);
    parts.push({ label: "Groove + fill", L, R });
  }
  { // outro: pad fading to silence
    const [L, R] = buf(8);
    S.pad(L, R, 0, L.length, Am, 7, 1.8, p => Math.pow(1 - p, 2));
    gainTo(L, R, kc, -24, 0, len(1)); fade(L, R, sr, 0.02, 0.2);
    parts.push({ label: "Outro", L, R });
  }
  const out = concat(parts, sr);
  out.name = "Cue arc";
  out.kind = "probe";
  const gb = [], gd = [];
  for (let t = 8; t < 40 - 1e-9; t += 0.5) gb.push(t);
  for (let t = 48; t < 56 - 1e-9; t += 0.5) gb.push(t);
  for (let t = 8; t < 40 - 1e-9; t += 2) gd.push(t);
  for (let t = 48; t < 56 - 1e-9; t += 2) gd.push(t);
  out.truth = { beats: gb, downbeats: gd, regions: [[7.9, 39.9], [47.9, 55.9]], note: "120 BPM grid where drums play; breakdown not scored" };
  return out;
}

/* ===================================================================
   Tempo ramp: drums accelerating from 96 to 144 BPM, chord per bar
   =================================================================== */
function makeTempoRamp(sr, kFilterCoeffs) {
  sr = sr || 44100;
  const kc = kFilterCoeffs(sr);
  const S = makeSynth(sr, 4242);
  const { len } = S;
  const T0 = 96, T1 = 144, D = 32, off = 1.0, total = 34;
  const L = new Float32Array(len(total)), R = new Float32Array(len(total));
  const a = (T1 - T0) / (2 * D * 60), b = T0 / 60;
  const beatAt = k => off + (-b + Math.sqrt(b * b + 4 * a * k)) / (2 * a);
  const beats = [];
  for (let k = 0; ; k++) { const t = beatAt(k); if (t > off + D + 1e-9) break; beats.push(t); }
  const prog = [[110, 130.81, 164.81, 220, 261.63], [87.31, 110, 130.81, 174.61, 220], [130.81, 164.81, 196, 261.63, 329.63], [98, 123.47, 146.83, 196, 246.94]];
  for (let k = 0; k < beats.length; k++) {
    const t = beats[k], nx = k + 1 < beats.length ? beats[k + 1] : t + (beats[k] - beats[k - 1]);
    S.kick(L, R, t, 0.9);
    if (k % 4 === 1 || k % 4 === 3) S.snare(L, R, t, 0.5, 0);
    S.hat(L, R, (t + nx) / 2, 0.3, false);
    if (k % 4 === 0) {
      const e = k + 4 < beats.length ? beats[k + 4] : Math.min(total, t + 4 * (nx - t));
      const s0 = len(t), n = Math.max(1, Math.min(L.length - s0, len(e - t)));
      S.pad(L, R, s0, n, prog[(k / 4) % 4], 6, 1.6, p => 0.08 * Math.min(1, p / 0.03) * (1 - 0.3 * p), 0.002);
    }
  }
  gainTo(L, R, kc, -18); fade(L, R, sr, 0.01, 0.3);
  const segs = [];
  const q = [0, 8, 16, 24, 32];
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const t0 = off + q[i], t1 = off + q[i + 1];
    const bpm = Math.round(T0 + (T1 - T0) * (q[i] + 4) / D);
    parts.push({ label: "≈" + bpm + " BPM", t0: i === 0 ? 0 : t0, t1: i === 3 ? total : t1 });
  }
  for (const p of parts) segs.push({ t0: p.t0, t1: p.t1, label: p.label, note: "" });
  for (let i = 0; i < L.length; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); R[i] = Math.max(-1, Math.min(1, R[i])); }
  return {
    sampleRate: sr, length: L.length, numberOfChannels: 2, duration: L.length / sr,
    getChannelData: c => (c ? R : L), segments: segs, name: "Tempo ramp", kind: "probe",
    truth: { beats, downbeats: beats.filter((_, k) => k % 4 === 0), regions: [[off - 0.1, beats[beats.length - 1] + 0.1]], note: "96 to 144 BPM, linear in time" }
  };
}

/* ===================================================================
   Game SFX kit: 13 synthetic one-shots and loops (0.5-4 s) with known
   events. Truth tags: N tonal, X noisy, Y gliding; ′ impulse, ″ iterative.
   =================================================================== */
function makeSfxKit(sr, kFilterCoeffs) {
  sr = sr || 44100;
  const rnd = mulberry32(777);
  const noise = () => rnd() * 2 - 1;
  const TP = 2 * Math.PI;
  const N = s => Math.round(s * sr);
  const mk = d => [new Float32Array(N(d)), new Float32Array(N(d))];
  const pg = p => { const a = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; };
  const val = (v, tau) => typeof v === "function" ? v(tau) : v;
  function svf() {
    let ic1 = 0, ic2 = 0;
    return (x, fc, q) => {
      const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr), k = 1 / q;
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      return [v1, v2, x - k * v1 - v2];
    };
  }
  // tone: f0 number|fn(tau); partials: array of [ratio, amp]; env fn(tau)
  function tone(L, R, t0, dur, f0, partials, env, pan) {
    const s0 = N(t0), n = N(dur), ph = new Float64Array(partials.length);
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, f = val(f0, tau), a = env(tau);
      let v = 0;
      for (let h = 0; h < partials.length; h++) { const fh = f * partials[h][0]; ph[h] += TP * fh / sr; if (fh < sr * 0.45) v += partials[h][1] * Math.sin(ph[h]); }
      const [gl, gr] = pg(val(pan || 0, tau));
      if (s0 + i >= 0) { L[s0 + i] += a * v * gl; R[s0 + i] += a * v * gr; }
    }
  }
  // filtered noise: mode 0 band-pass, 1 low-pass, 2 high-pass
  function nz(L, R, t0, dur, fc, q, env, pan, mode) {
    const f = svf(), s0 = N(t0), n = N(dur);
    for (let i = 0; i < n && s0 + i < L.length; i++) {
      const tau = i / sr, o = f(noise(), val(fc, tau), q), a = env(tau);
      const [gl, gr] = pg(val(pan || 0, tau));
      if (s0 + i >= 0) { L[s0 + i] += a * o[mode || 0] * gl; R[s0 + i] += a * o[mode || 0] * gr; }
    }
  }
  const harm = (k, slope) => Array.from({ length: k }, (_, i) => [i + 1, 1 / Math.pow(i + 1, slope || 1)]);
  const click = (L, R, t0, amp, fc, pan) => nz(L, R, t0, 0.012, fc || 4000, 0.8, tau => amp * Math.exp(-tau / 0.0018), pan || 0, 2);
  const thump = (L, R, t0, f0, amp, dec) => tone(L, R, t0, dec * 6, tau => f0 * (1 + 1.4 * Math.exp(-tau / 0.025)), [[1, 1]], tau => amp * Math.exp(-tau / dec) * Math.min(1, tau / 0.0015));
  const peakNorm = (L, R, to) => { let p = 0; for (let i = 0; i < L.length; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); const g = p > 0 ? to / p : 1; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } };
  const fadeOut = (L, R, sec) => { const n = N(sec); for (let i = 0; i < n && i < L.length; i++) { const g = i / n; L[L.length - 1 - i] *= g; R[R.length - 1 - i] *= g; } };
  const kit = [];
  const add = (name, L, R, events, note, opts) => {
    if (!(opts && opts.raw)) { peakNorm(L, R, 0.7); if (!(opts && opts.noFade)) fadeOut(L, R, 0.01); }
    kit.push({ sampleRate: sr, length: L.length, numberOfChannels: 2, duration: L.length / sr, getChannelData: c => (c ? R : L), name, kind: "sfx", sfxTruth: { events, note }, segments: null });
  };

  { // UI click: tick then tonal blip
    const [L, R] = mk(0.5);
    click(L, R, 0.02, 0.6, 3500);
    tone(L, R, 0.10, 0.12, 1200, harm(3, 1.5), tau => 0.35 * Math.min(1, tau / 0.002) * Math.exp(-tau / 0.025));
    add("UI_Click_Confirm.wav", L, R, [{ t: 0.02, tag: "X′" }, { t: 0.10, tag: "N′" }], "tick, then a short tonal blip");
  }
  { // coin pickup: two-note chime
    const [L, R] = mk(0.7);
    const sq = [[1, 1], [3, 0.33], [5, 0.2], [7, 0.14]];
    tone(L, R, 0.01, 0.08, 987.8, sq, tau => 0.3 * Math.min(1, tau / 0.002) * (tau < 0.07 ? 1 : Math.max(0, 1 - (tau - 0.07) / 0.01)));
    tone(L, R, 0.09, 0.6, 1318.5, sq, tau => 0.3 * Math.min(1, tau / 0.002) * Math.exp(-tau / 0.22));
    add("Pickup_Coin_01.wav", L, R, [{ t: 0.01, tag: "N′" }, { t: 0.09, tag: "N" }], "two-note chime, second note rings");
  }
  { // footstep on gravel: heel thump then a crunch of grains
    const [L, R] = mk(0.6);
    thump(L, R, 0.03, 75, 0.8, 0.04);
    nz(L, R, 0.03, 0.06, 900, 0.9, tau => 0.5 * Math.exp(-tau / 0.012), 0, 0);
    for (let t = 0.13; t < 0.42; t += 0.018 + rnd() * 0.022) nz(L, R, t, 0.012, 2500 + 3000 * rnd(), 1.2, tau => (0.25 + 0.2 * rnd()) * Math.exp(-tau / 0.003), (rnd() - 0.5) * 0.4, 0);
    add("Footstep_Gravel_03.wav", L, R, [{ t: 0.03, tag: "X′" }, { t: 0.13, tag: "X″" }], "heel thump, then gravel crunch");
  }
  { // gunshot: mechanism click, blast with low tail, shell casing ring
    const [L, R] = mk(1.8);
    click(L, R, 0.03, 0.35, 5000);
    nz(L, R, 0.11, 0.08, 1800, 0.5, tau => 1.0 * Math.min(1, tau / 0.0008) * Math.exp(-tau / 0.012), 0, 0);
    thump(L, R, 0.11, 60, 1.0, 0.09);
    nz(L, R, 0.11, 1.4, 180, 0.7, tau => 0.35 * Math.min(1, tau / 0.01) * Math.exp(-tau / 0.35), 0, 1);
    tone(L, R, 1.15, 0.3, 3150, [[1, 1], [2.02, 0.4], [3.01, 0.15]], tau => 0.12 * Math.min(1, tau / 0.001) * Math.exp(-tau / 0.05), 0.4);
    add("Gun_Pistol_Shot_02.wav", L, R, [{ t: 0.03, tag: "X′" }, { t: 0.11, tag: "X′" }, { t: 1.15, tag: "N′" }], "mechanism click, blast and tail, shell casing");
  }
  { // laser zap: downward tonal sweep
    const [L, R] = mk(0.6);
    tone(L, R, 0.02, 0.5, tau => 2400 * Math.pow(300 / 2400, Math.min(1, tau / 0.35)), harm(4, 1.2), tau => 0.4 * Math.min(1, tau / 0.003) * Math.exp(-tau / 0.2));
    add("Weapon_Laser_Zap.wav", L, R, [{ t: 0.02, tag: "Y" }], "tonal sweep 2.4 kHz down to 300 Hz");
  }
  { // whoosh flyby: band-pass noise sweep, left to right
    const [L, R] = mk(1.6);
    nz(L, R, 0.0, 1.6, tau => 400 * Math.pow(2500 / 400, Math.sin(Math.PI * Math.min(1, tau / 1.5))), 1.6,
      tau => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, tau / 1.55)), 2), tau => -0.9 + 1.8 * Math.min(1, tau / 1.5), 0);
    add("Whoosh_Flyby_LR.wav", L, R, [{ t: 0.09, tag: "Y" }], "noise sweep up and down, panning left to right", { noFade: true });
  }
  { // explosion: blast, rumble, debris
    const [L, R] = mk(4.0);
    nz(L, R, 0.05, 0.15, 1200, 0.4, tau => 1.0 * Math.min(1, tau / 0.001) * Math.exp(-tau / 0.03), 0, 0);
    thump(L, R, 0.05, 45, 1.0, 0.25);
    nz(L, R, 0.05, 3.9, 120, 0.6, tau => 0.5 * Math.min(1, tau / 0.02) * Math.exp(-tau / 0.9), 0, 1);
    for (let t = 0.6; t < 2.6; t += 0.03 + 0.08 * rnd() + 0.05 * (t - 0.6)) nz(L, R, t, 0.02, 1500 + 4000 * rnd(), 2, tau => (0.08 + 0.1 * rnd()) * Math.exp(-tau / 0.004), (rnd() - 0.5) * 1.4, 0);
    add("Explosion_Large_Debris.wav", L, R, [{ t: 0.05, tag: "X" }, { t: 0.6, tag: "X″" }], "blast, rumble tail, falling debris");
  }
  { // reload: release click, slide, insert clack, bolt pull and release
    const [L, R] = mk(2.0);
    click(L, R, 0.10, 0.5, 3000);
    nz(L, R, 0.25, 0.3, tau => 1500 + 300 * (tau / 0.3), 2.5, tau => 0.18 * Math.min(1, tau / 0.01) * Math.min(1, (0.3 - tau) / 0.05), 0.2, 0);
    click(L, R, 1.00, 0.7, 2200); thump(L, R, 1.0, 120, 0.4, 0.02);
    click(L, R, 1.45, 0.5, 2800);
    click(L, R, 1.65, 0.8, 2400); thump(L, R, 1.65, 140, 0.35, 0.015);
    add("Weapon_Rifle_Reload.wav", L, R, [{ t: 0.10, tag: "X′" }, { t: 0.25, tag: "X" }, { t: 1.00, tag: "X′" }, { t: 1.45, tag: "X′" }, { t: 1.65, tag: "X′" }], "release, slide, insert, bolt pull, bolt release");
  }
  { // door creak then slam
    const [L, R] = mk(3.0);
    let t = 0.1;
    while (t < 1.8) {
      const p = (t - 0.1) / 1.7, fc = 500 * Math.pow(2, p), rate = 22 - 8 * p;
      nz(L, R, t, 0.03, fc, 12, tau => 0.35 * Math.min(1, p * 4) * Math.min(1, (1 - p) * 6) * Math.exp(-tau / 0.008), 0, 0);
      t += 1 / rate;
    }
    thump(L, R, 2.1, 70, 1.0, 0.12);
    nz(L, R, 2.1, 0.4, 700, 0.6, tau => 0.6 * Math.exp(-tau / 0.05), 0, 0);
    add("Door_Wood_CreakSlam.wav", L, R, [{ t: 0.19, tag: "Y″" }, { t: 2.1, tag: "X′" }], "creak with rising resonance, then slam");
  }
  { // glass break: impact then shards
    const [L, R] = mk(1.6);
    nz(L, R, 0.05, 0.08, 5000, 0.6, tau => 0.9 * Math.min(1, tau / 0.0005) * Math.exp(-tau / 0.01), 0, 2);
    let t = 0.17;
    while (t < 1.2) { const f = 3000 + 5000 * rnd(); tone(L, R, t, 0.2, f, [[1, 1], [2.7, 0.3]], tau => (0.08 + 0.08 * rnd()) * Math.min(1, tau / 0.0005) * Math.exp(-tau / 0.04), (rnd() - 0.5) * 1.2); t += 0.025 + 0.06 * rnd() + 0.08 * (t - 0.17); }
    add("Glass_Window_Break.wav", L, R, [{ t: 0.05, tag: "X′" }, { t: 0.17, tag: "N″" }], "impact, then a shower of ringing shards");
  }
  { // engine loop: harmonic with firing pulses at 27 Hz, exact cycles so it wraps
    const [L, R] = mk(3.0);
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (let h = 1; h <= 14; h++) v += Math.sin(TP * 54 * h * t + h) / Math.pow(h, 0.9);
      const fire = Math.pow(0.5 + 0.5 * Math.cos(TP * 27 * t), 3);
      L[i] = 0.25 * v * (0.25 + 0.75 * fire); R[i] = L[i];
    }
    let mu = 0; for (let i = 0; i < n; i++) mu += L[i]; mu /= n;
    for (let i = 0; i < n; i++) { L[i] -= mu; R[i] = L[i]; }
    add("Vehicle_Engine_Idle_Loop.wav", L, R, [{ t: 0.0, tag: "N″|X″" }], "idle with firing pulses at 27 Hz; seamless loop", { noFade: true });
  }
  { // creature growl: low voiced tone with pitch contour up and down
    const [L, R] = mk(2.0);
    const parts = harm(30, 0.7).map(([r, a]) => { const f = r * 100; const fm = Math.exp(-Math.pow((f - 600) / 300, 2)) + 0.6 * Math.exp(-Math.pow((f - 1400) / 400, 2)) + 0.15; return [r, a * fm]; });
    tone(L, R, 0.05, 1.9, tau => 80 * Math.pow(2, 0.7 * Math.sin(Math.PI * Math.min(1, tau / 1.8))) * (1 + 0.01 * Math.sin(TP * 31 * tau)), parts, tau => 0.12 * Math.min(1, tau / 0.08) * Math.min(1, (1.9 - tau) / 0.25));
    add("Creature_Growl_Short.wav", L, R, [{ t: 0.05, tag: "Y" }], "voiced growl, pitch rises then falls");
  }
  { // sword hit with export problems: leading silence, DC offset, clipping, cut tail
    const [L, R] = mk(1.2);
    tone(L, R, 0.15, 1.05, 1830, [[1, 1], [1.58, 0.7], [2.35, 0.5], [3.12, 0.3]], tau => 0.5 * Math.min(1, tau / 0.0005) * Math.exp(-tau / 0.5), 0);
    nz(L, R, 0.15, 0.05, 4000, 0.7, tau => 1.2 * Math.exp(-tau / 0.004), 0, 2);
    peakNorm(L, R, 1.3);
    for (let i = 0; i < L.length; i++) { L[i] = Math.max(-1, Math.min(1, L[i] + 0.02)); R[i] = Math.max(-1, Math.min(1, R[i] + 0.02)); }
    for (let i = 0; i < N(0.15); i++) { L[i] = 0.02; R[i] = 0.02; }
    add("Sword_Hit_BadExport.wav", L, R, [{ t: 0.15, tag: "N" }], "metal hit with a long ring; leading silence, DC offset, clipping, tail cut off", { raw: true });
  }
  return kit;
}

const api = { makeProbeSuite, makeCueArc, makeTempoRamp, makeSfxKit };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.WLProbes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
