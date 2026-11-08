// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// A melodic piece synthesized in code, with every note known: 16 bars at 90 BPM in four phrases (A, A', B, A), a lead
// with vibrato on its long notes, slides between notes in the B phrase and a long fall at the end, over soft chords, a
// light kick on 1 and 3, a rim on 2 and 4 and a shaker. For a melodic visual (a line that follows the tune), where the usual way reacts to the
// loudest frequency bin and Playhead to the melody's pitch, its glides, its vibrato and its phrases. Slides are legato
// (the tone does not stop); those of 0.2 s and more are glides to Playhead, those of 0.1 s too short. Node and browser:
//
//   const M = require("./melodic.js"); const { sr, y, truth } = M.render(44100);
//   PlayheadMelodic.render(44100)
//
// truth: bpm, bar (s), sections (the phrases), notes [{ t, dur, midi }], glides [{ start, end, from, to }], vibrato
// [{ start, end, rate, depth }] (cents peak to peak), hits [{ t, inst }].
"use strict";
(function (root) {
  const BPM = 90, BEAT = 60 / BPM, BAR = 4 * BEAT;
  // the tune in beats: [start beat, length in beats, MIDI note, slide in from the note before (s)]
  const A = [[0, 1, 72], [1, 1, 74], [2, 2, 76], [4, 1, 79], [5, 1, 77], [6, 2, 76], [8, 1.5, 74], [9.5, 0.5, 72], [10, 2, 74], [12, 4, 72]];
  const A2 = [[0, 1, 72], [1, 1, 74], [2, 2, 76], [4, 1, 79], [5, 1, 81], [6, 2, 79], [8, 1.5, 77], [9.5, 0.5, 76], [10, 2, 74], [12, 4, 76]];
  const B = [[0, 2, 81, 0.2], [2, 2, 84, 0.2], [4, 1, 83, 0.1], [5, 1, 81, 0.1], [6, 2, 79, 0.2], [8, 3, 84, 1.0], [11, 1, 83], [12, 4, 81, 0.2]];
  const CHORDS = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];   // C, Am, F, G
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function rng(seed) { let s = seed % 2147483646 + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function render(sr) {
    sr = sr || 44100;
    const n = Math.ceil((16 * BAR + 2.5) * sr), y = new Float32Array(n), r = rng(5);
    const truth = { bpm: BPM, bar: BAR, beatsPerBar: 4, sections: [["A", 0, 4], ["A'", 4, 8], ["B", 8, 12], ["A", 12, 16]].map(([label, a, b]) => ({ label, start: a * BAR, end: b * BAR })), notes: [], glides: [], vibrato: [], hits: [] };
    const add = (x, t, g) => { const i0 = Math.round(t * sr); for (let i = 0; i < x.length && i0 + i < n; i++) y[i0 + i] += g * x[i]; };
    // the lead: one continuous oscillator, so slides and vibrato are pitch motion of the same tone
    const notes = [];
    [[A, 0], [A2, 4], [B, 8], [A, 12]].forEach(([ph, bar0]) => ph.forEach(([b, len, m, slide]) => notes.push({ t: bar0 * BAR + b * BEAT, dur: len * BEAT, midi: m, slide: slide || 0 })));
    // the end: the last note falls an octave over its last second
    const last = notes[notes.length - 1];
    let ph = 0;
    for (let k = 0; k < notes.length; k++) {
      const nt = notes[k], prev = notes[k - 1], i0 = Math.round(nt.t * sr), i1 = Math.round((nt.t + nt.dur) * sr) + (nt === last ? Math.round(1.2 * sr) : 0);
      const long = nt.dur >= 2 * BEAT, vibStart = 0.35, rate = 5.5, cents = 35;
      for (let i = i0; i < i1 && i < n; i++) {
        const u = i / sr - nt.t;
        let m = nt.midi;
        if (nt.slide && prev && u < nt.slide) m = prev.midi + (nt.midi - prev.midi) * (u / nt.slide);
        if (nt === last && u > nt.dur - 0.8) m -= 12 * Math.min(1, (u - (nt.dur - 0.8)) / 1.4);
        if (long && u > vibStart && !(nt === last && u > nt.dur - 0.8)) m += cents / 100 * Math.min(1, (u - vibStart) / 0.4) * Math.sin(2 * Math.PI * rate * (u - vibStart));
        ph += 2 * Math.PI * hz(m) / sr;
        const next = notes[k + 1], legatoIn = nt.slide && prev, legatoOut = next && next.slide;
        const env = (legatoIn ? 1 : Math.min(1, u / 0.03)) * (legatoOut ? 1 : Math.min(1, (i1 / sr - i / sr) / 0.06)) * (0.85 + 0.15 * Math.exp(-u * 3));
        y[i] += 0.32 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
      }
      truth.notes.push({ t: nt.t, dur: nt.dur, midi: nt.midi });
      if (nt.slide && prev) truth.glides.push({ start: nt.t, end: nt.t + nt.slide, from: prev.midi, to: nt.midi });
      if (long) truth.vibrato.push({ start: nt.t + vibStart, end: nt.t + nt.dur - (nt === last ? 0.8 : 0), rate, depth: 2 * cents });
      truth.hits.push({ t: nt.t, inst: "note" });
    }
    truth.glides.push({ start: last.t + last.dur - 0.8, end: last.t + last.dur + 0.6, from: last.midi, to: last.midi - 12 });
    // chords: three soft voices a bar, and a light kick on 1 and 3 and a shaker on the 8ths
    for (let bar = 0; bar < 16; bar++) {
      const t0 = bar * BAR, ch = CHORDS[bar % 4];
      for (const m of ch) { const L = Math.round((BAR + 0.1) * sr), x = new Float32Array(L); let p2 = 0; for (let i = 0; i < L; i++) { const u = i / sr; p2 += 2 * Math.PI * hz(m) / sr; x[i] = (Math.sin(p2) + 0.2 * Math.sin(2 * p2)) * Math.min(1, u / 0.25, (BAR + 0.1 - u) / 0.1); } add(x, t0, 0.045); }
      for (const b of [0, 2]) { const L = Math.round(0.3 * sr), x = new Float32Array(L); let p3 = 0; for (let i = 0; i < L; i++) { const u = i / sr; p3 += 2 * Math.PI * (45 + 70 * Math.exp(-u * 30)) / sr; x[i] = Math.sin(p3) * Math.exp(-u * 10) * Math.min(1, u / 0.001); } add(x, t0 + b * BEAT, 0.5); truth.hits.push({ t: t0 + b * BEAT, inst: "kick" }); }
      for (const b of [1, 3]) { const L = Math.round(0.08 * sr), x = new Float32Array(L); let p4 = 0; for (let i = 0; i < L; i++) { const u = i / sr; p4 += 2 * Math.PI * 820 / sr; x[i] = (0.6 * Math.sin(p4) + 0.5 * (r() * 2 - 1)) * Math.exp(-u * 55); } add(x, t0 + b * BEAT, 0.22); truth.hits.push({ t: t0 + b * BEAT, inst: "rim" }); }
      for (let e = 0; e < 8; e++) { const L = Math.round(0.05 * sr), x = new Float32Array(L); let pr = 0; for (let i = 0; i < L; i++) { const w = r() * 2 - 1; x[i] = (w - pr) * Math.exp(-i / sr * 60); pr = w; } add(x, t0 + e * BEAT / 2, e % 2 ? 0.07 : 0.11); truth.hits.push({ t: t0 + e * BEAT / 2, inst: "shaker" }); }
    }
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.9 / pk;
    return { name: "melodic piece", sr, y, truth };
  }
  const api = { render, BPM };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlayheadMelodic = api;
})(typeof self !== "undefined" ? self : this);
