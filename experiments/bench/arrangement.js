// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// A short dance arrangement synthesized in code, with its form known: an intro, a groove, a break with a pass-by, a
// build that gets denser and brighter but not louder, a drop with four-on-the-floor, 16th hats, an off-beat bass and a
// distorted stab, and an outro. For the spectral views (which part of the spectrum carries which metrical level, and
// where that changes) and for the audiovisual comparison, where the same sound drives a standard audio-reactive scene
// and a Playhead-driven one. Runs in Node and in the browser (no dependencies):
//
// truth: bpm, bar (s), sections, build, drop, fills and breaks (bar numbers), passBy, distortion, and hits (every kick,
// snare, hat, bass note and stab, { t, inst }).
//
//   const A = require("./arrangement.js"); const { sr, y, truth } = A.render(44100);    // Node
//   PlayheadArrangement.render(44100)                                                   // browser
"use strict";
(function (root) {
  const BPM = 124, BEAT = 60 / BPM, BAR = 4 * BEAT, STEP = BEAT / 4, BARS = 32;
  // the form, in bars: [first bar, last bar + 1]
  const SECTIONS = [["intro", 0, 4], ["groove", 4, 12], ["break", 12, 16], ["build", 16, 20], ["drop", 20, 28], ["outro", 28, 32]];
  const CHORDS = [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]];      // Am F C G (bass, then the pad)
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function rng(seed) { let s = seed % 2147483646 + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  // opts.clip: false renders the stab clean (for testing a distortion cue against the same part undistorted)
  function render(sr, opts) {
    sr = sr || 44100; opts = opts || {};
    const n = Math.ceil((BARS * BAR + 1.5) * sr), y = new Float32Array(n), r = rng(7);
    const add = (x, t, g) => { const i0 = Math.round(t * sr); for (let i = 0; i < x.length && i0 + i < n; i++) y[i0 + i] += g * x[i]; };
    const kick = () => { const m = Math.round(0.35 * sr), x = new Float32Array(m); let ph = 0; for (let i = 0; i < m; i++) { const t = i / sr; ph += 2 * Math.PI * (48 + 110 * Math.exp(-t * 30)) / sr; x[i] = Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, t / 0.0008); } return x; };
    const snare = () => { const m = Math.round(0.2 * sr), x = new Float32Array(m); let lp = 0, ph = 0; for (let i = 0; i < m; i++) { const t = i / sr; lp += 0.35 * ((r() * 2 - 1) - lp); ph += 2 * Math.PI * 190 / sr; x[i] = (0.55 * lp * Math.exp(-t * 22) + 0.6 * Math.sin(ph) * Math.exp(-t * 28)) * Math.min(1, t / 0.0006); } return x; };
    const hat = open => { const m = Math.round((open ? 0.3 : 0.06) * sr), x = new Float32Array(m); let prev = 0; for (let i = 0; i < m; i++) { const t = i / sr, w = r() * 2 - 1; x[i] = 0.35 * (w - prev) * Math.exp(-t * (open ? 12 : 70)) * Math.min(1, t / 0.0003); prev = w; } return x; };
    // a sawtooth through a one-pole low-pass, with an attack and a decay
    const saw = (f, len, cut, decay) => { const m = Math.round(len * sr), x = new Float32Array(m), a = 1 - Math.exp(-2 * Math.PI * cut / sr); let lp = 0, ph = 0; for (let i = 0; i < m; i++) { const t = i / sr; ph = (ph + f / sr) % 1; lp += a * ((2 * ph - 1) - lp); x[i] = lp * Math.min(1, t / 0.004, (len - t) / 0.01) * Math.exp(-t * decay); } return x; };
    const truth = { bpm: BPM, beatsPerBar: 4, bar: BAR, sections: SECTIONS.map(([label, a, b]) => ({ label, start: a * BAR, end: b * BAR })), build: [16 * BAR, 20 * BAR], drop: 20 * BAR, fills: [11], breaks: [12], passBy: null, distortion: opts.clip === false ? null : [24 * BAR, 28 * BAR], hits: [] };
    // a part that starts at a known moment: kick, snare, hat (closed or open), bass or stab
    const play = (inst, x, t, g) => { add(x, t, g); truth.hits.push({ t: Math.round(t * sr) / sr, inst }); };
    const sec = bar => SECTIONS.find(([, a, b]) => bar >= a && bar < b)[0];
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * BAR, s = sec(bar), ch = CHORDS[bar % 4], at = st => t0 + st * STEP;
      // the pad: in the intro, the break and quietly in the build
      if (s === "intro" || s === "break" || s === "build") for (const m of ch.slice(1)) add(saw(hz(m), BAR + 0.05, 1400, 0.2), t0, s === "build" ? 0.05 : 0.09);
      const fill = bar === 11;                                                                         // the groove's last bar: a fill
      if (s === "intro" || s === "groove" || s === "outro") for (const st of [2, 6, 10, 14]) if (!fill || st < 8) play("hat", hat(false), at(st), s === "intro" ? 0.5 : 0.8);
      if (s === "groove") {
        for (const st of fill ? [0] : [0, 8]) play("kick", kick(), at(st), 1);
        for (const st of fill ? [4, 10, 11, 12, 13, 14, 15] : [4, 12]) play("snare", snare(), at(st), st > 9 && fill ? 0.55 + 0.05 * (st - 10) : 0.8);
        for (const st of [0, 6, 8]) play("bass", saw(hz(ch[0]), 1.5 * STEP, 380, 4), at(st), 0.5);
      }
      if (s === "build") {
        const k = bar - 16, every = [4, 2, 1, 1][k];                                                   // quarters, 8ths, 16ths
        for (let st = 0; st < 16; st += every) play("snare", snare(), at(st), 0.35 + 0.1 * k);
        for (const st of [0, 4, 8, 12]) play("kick", kick(), at(st), 0.5);
      }
      if (s === "drop" || s === "outro") for (const st of [0, 4, 8, 12]) play("kick", kick(), at(st), 1.1);
      if (s === "drop") {
        for (const st of [4, 12]) play("snare", snare(), at(st), 0.85);
        for (let st = 0; st < 16; st++) play("hat", hat(st % 4 === 2), at(st), st % 2 ? 0.45 : 0.7);
        for (const st of [2, 6, 10, 14]) play("bass", saw(hz(ch[0] + 12), 1.6 * STEP, 700, 3), at(st), 0.55);   // the off-beat bass
        // a distorted stab in the second half of the drop: a chord of sawtooths clipped hard
        if (bar >= 24) for (const st of [0, 3, 6]) { const x = saw(hz(ch[1] + 12), 2 * STEP, 5000, 2); for (const m of ch.slice(2)) { const z = saw(hz(m + 12), 2 * STEP, 5000, 2); for (let i = 0; i < x.length; i++) x[i] += z[i]; } if (opts.clip !== false) for (let i = 0; i < x.length; i++) x[i] = Math.max(-0.25, Math.min(0.25, 3 * x[i])); else for (let i = 0; i < x.length; i++) x[i] *= 0.6; play("stab", x, at(st), 1.6); }
      }
    }
    // the build: a riser (noise swept up from 300 Hz to 8 kHz), held at one level
    { const a = Math.round(16 * BAR * sr), b = Math.round(20 * BAR * sr); let lp = 0, lp2 = 0; for (let i = a; i < b; i++) { const u = (i - a) / (b - a), fc = 300 * Math.pow(8000 / 300, u), al = 1 - Math.exp(-2 * Math.PI * fc / sr); lp += al * ((r() * 2 - 1) - lp); lp2 += al * 0.5 * (lp - lp2); y[i] += 0.12 * (lp - lp2) / Math.sqrt(0.3 + u); } }
    // the break: a source passing by at 25 m/s, 20 m away (Doppler shift and level), closest at the middle of the break
    { const c = 343, d = 20, v = 25, tc = 14 * BAR, a = tc - 3, b = tc + 3; let ph = 0;
      for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) { const t = i / sr, x = v * (t - tc), dist = Math.hypot(x, d), f = 300 * c / (c + v * x / dist); ph += 2 * Math.PI * f / sr; let z = 0; for (let h = 1; h <= 5; h++) z += Math.sin(h * ph) / h; y[i] += 0.45 * z * (d / dist) * Math.min(1, (t - a) / 0.3, (b - t) / 0.3); }
      truth.passBy = { closest: tc, speed: v }; }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.9 / pk;
    return { name: "arrangement", sr, y, truth };
  }
  const api = { render, BPM, BARS, SECTIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlayheadArrangement = api;
})(typeof self !== "undefined" ? self : this);
