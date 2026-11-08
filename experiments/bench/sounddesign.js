// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// A sound-design reel synthesized in code, with every part known: weapon shots (a crack, a boom, a mechanical bolt, a
// reverberant tail), a burst of three, a motor that spins up, runs with a rotor and spins down, a vehicle passing by, a
// distorted alarm, a metal hit, a wooden knock and an explosion with a long tail. For driving visuals and effects from
// sound effects: where each boom, after-effect and tail is, what the motor does, what is distorted. Node and browser:
//
//   const R = require("./sounddesign.js"); const { sr, y, truth } = R.render(44100);
//   PlayheadSoundDesign.render(44100)
//
// truth: shots [{ t (the crack), boom, bolt: [t...], tailEnd }], motor { up: [t0, t1], run: [t0, t1], down: [t0, t1],
// rotorHz, f0 }, passBy { closest, speed }, distortion [t0, t1], impacts [{ t, kind }], explosion { t, tailEnd },
// hits [{ t, inst }].
"use strict";
(function (root) {
  const DUR = 32;
  function rng(seed) { let s = seed % 2147483646 + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function render(sr) {
    sr = sr || 44100;
    const n = Math.ceil(DUR * sr), y = new Float32Array(n), r = rng(11);
    const truth = { shots: [], motor: null, passBy: null, distortion: null, impacts: [], explosion: null, hits: [] };
    const add = (x, t, g) => { const i0 = Math.round(t * sr); for (let i = 0; i < x.length && i0 + i < n; i++) y[i0 + i] += g * x[i]; };
    const mark = (t, inst) => truth.hits.push({ t: Math.round(t * sr) / sr, inst });
    // a one-pole low-pass and high-pass over a buffer
    const lp = (x, fc) => { const a = 1 - Math.exp(-2 * Math.PI * fc / sr); let s = 0; for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); x[i] = s; } return x; };
    const hp = (x, fc) => { const c = Math.exp(-2 * Math.PI * fc / sr); let s = 0, p = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; s = c * (s + v - p); p = v; x[i] = s; } return x; };
    const noise = len => Float32Array.from({ length: Math.round(len * sr) }, () => r() * 2 - 1);
    // a shot: a crack (3 ms broadband), a boom (a sine falling from 110 to 42 Hz over 0.45 s), a blast of low noise, a
    // reverberant tail (noise, low-passed, decaying by 60 dB in t60 seconds) and the bolt: two metallic clicks
    function shot(t, gain, t60, bolt) {
      const crack = hp(noise(0.004), 1500); for (let i = 0; i < crack.length; i++) crack[i] *= 1 - i / crack.length; add(crack, t, 1.0 * gain);
      const bl = Math.round(0.6 * sr), boom = new Float32Array(bl); let ph = 0;
      for (let i = 0; i < bl; i++) { const u = i / sr; ph += 2 * Math.PI * (42 + 68 * Math.exp(-u * 9)) / sr; boom[i] = Math.sin(ph) * Math.exp(-u * 6) * Math.min(1, u / 0.002); }
      add(boom, t + 0.002, 0.9 * gain);
      const blast = lp(noise(0.12), 900); for (let i = 0; i < blast.length; i++) blast[i] *= Math.exp(-i / sr * 30); add(blast, t, 0.9 * gain);
      const tl = Math.round(t60 * sr), tail = lp(noise(t60), 2500); for (let i = 0; i < tl; i++) tail[i] *= 0.18 * Math.pow(10, -3 * (i / tl)) * Math.min(1, i / (0.03 * sr)); add(tail, t + 0.03, gain);
      const s = { t, boom: t + 0.002, bolt: [], tailEnd: t + 0.03 + t60 };
      mark(t, "crack");
      if (bolt) for (const d of [0.38, 0.52]) {
        const m = Math.round(0.03 * sr), c = new Float32Array(m); for (let i = 0; i < m; i++) { const u = i / sr; c[i] = (Math.sin(2 * Math.PI * 3100 * u) + 0.7 * Math.sin(2 * Math.PI * 4870 * u) + 0.4 * (r() * 2 - 1)) * Math.exp(-u * 160); }
        add(c, t + d, 0.35 * gain); s.bolt.push(t + d); mark(t + d, "bolt");
      }
      truth.shots.push(s);
    }
    shot(0.8, 1, 1.6, true);
    for (const k of [0, 1, 2]) shot(3.6 + 0.13 * k, 0.8, 1.2, k === 2);
    // the motor: a harmonic tone that spins up from 45 to 150 Hz, runs with a 24 Hz rotor (+-18 cents) and spins down
    {
      const t0 = 7.5, up = 1.6, run = 3.2, down = 1.4, end = t0 + up + run + down; let ph = 0, rph = 0;
      for (let i = Math.round(t0 * sr); i < Math.round(end * sr); i++) {
        const u = i / sr - t0, f = u < up ? 45 + 105 * (u / up) * (u / up) * (3 - 2 * u / up) / 1 : u < up + run ? 150 : 150 - 105 * ((u - up - run) / down);
        rph += 2 * Math.PI * 24 / sr; const fm = f * Math.pow(2, 18 / 1200 * Math.sin(rph)); ph += 2 * Math.PI * fm / sr;
        let z = 0; for (let h = 1; h <= 7; h++) z += Math.sin(h * ph) / (h * 0.9);
        y[i] += 0.22 * z * Math.min(1, u / 0.15, (end - t0 - u) / 0.2);
      }
      truth.motor = { up: [t0, t0 + up], run: [t0 + up, t0 + up + run], down: [t0 + up + run, end], rotorHz: 24, f0: 150 };
    }
    // a vehicle passing by: engine harmonics on 95 Hz with a 30 Hz firing rhythm, 25 m/s, 15 m away, closest at 16.5 s
    {
      const c = 343, d = 15, v = 25, tc = 16.5, a = tc - 3.2, b = tc + 3.2; let ph = 0, fph = 0;
      for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) {
        const t = i / sr, x = v * (t - tc), dist = Math.hypot(x, d), f = 95 * c / (c + v * x / dist);
        ph += 2 * Math.PI * f / sr; fph += 2 * Math.PI * 30 / sr;
        let z = 0; for (let h = 1; h <= 6; h++) z += Math.sin(h * ph) / h;
        y[i] += 0.5 * z * (0.75 + 0.25 * Math.sin(fph)) * (d / dist) * Math.min(1, (t - a) / 0.3, (b - t) / 0.3);
      }
      truth.passBy = { closest: tc, speed: v };
    }
    // a distorted alarm: a 640 Hz tone pulsing 4 times a second, driven hard into clipping
    {
      const t0 = 20.5, t1 = 23.5; let ph = 0;
      for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) { const t = i / sr - t0; ph += 2 * Math.PI * 640 / sr; const on = (t * 4) % 1 < 0.6 ? 1 : 0; y[i] += 0.32 * Math.max(-1, Math.min(1, 6 * Math.sin(ph))) * on * Math.min(1, t / 0.02, (t1 - t0 - t) / 0.02); }
      truth.distortion = [t0, t1];
      for (let t = 0; t < 3; t += 0.25) mark(t0 + t, "alarm");
    }
    // a metal hit (inharmonic partials ringing) and a wooden knock
    {
      const t = 24.6, m = Math.round(1.6 * sr), x = new Float32Array(m);
      for (const [f, a, dcy] of [[523, 1, 2.2], [1361, 0.6, 3], [2210, 0.45, 4], [3187, 0.3, 5.5]]) for (let i = 0; i < m; i++) x[i] += a * Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / sr * dcy) * Math.min(1, i / (0.0005 * sr));
      add(x, t, 0.25); truth.impacts.push({ t, kind: "metal" }); mark(t, "metal");
      const k = Math.round(0.12 * sr), w = new Float32Array(k);
      for (let i = 0; i < k; i++) { const u = i / sr; w[i] = (Math.sin(2 * Math.PI * 340 * u) + 0.5 * Math.sin(2 * Math.PI * 910 * u) + 0.3 * (r() * 2 - 1)) * Math.exp(-u * 45); }
      add(w, 26.2, 0.5); truth.impacts.push({ t: 26.2, kind: "wood" }); mark(26.2, "wood");
    }
    // an explosion: a crack, a deep boom (70 to 28 Hz), a roar of low noise over 1.2 s and a 3 s tail
    {
      const t = 27.6;
      const crack = hp(noise(0.006), 1200); for (let i = 0; i < crack.length; i++) crack[i] *= 1 - i / crack.length; add(crack, t, 0.9);
      const bl = Math.round(1.4 * sr), boom = new Float32Array(bl); let ph = 0;
      for (let i = 0; i < bl; i++) { const u = i / sr; ph += 2 * Math.PI * (28 + 42 * Math.exp(-u * 4)) / sr; boom[i] = Math.sin(ph) * Math.exp(-u * 2.5) * Math.min(1, u / 0.004); }
      add(boom, t, 1.0);
      const roar = lp(noise(1.2), 600); for (let i = 0; i < roar.length; i++) { const u = i / sr; roar[i] *= Math.min(1, u / 0.05) * Math.exp(-u * 2.2); } add(roar, t, 1.1);
      const tl = Math.round(3 * sr), tail = lp(noise(3), 1800); for (let i = 0; i < tl; i++) tail[i] *= 0.16 * Math.pow(10, -3 * i / tl) * Math.min(1, i / (0.2 * sr)); add(tail, t + 0.2, 1);
      truth.explosion = { t, tailEnd: t + 3.2 }; mark(t, "explosion");
    }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.9 / pk;
    return { name: "sound design reel", sr, y, truth };
  }
  const api = { render, DUR };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlayheadSoundDesign = api;
})(typeof self !== "undefined" ? self : this);
