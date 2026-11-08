// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The listening test's plan for one listener, from the manifest (manifest.json, written by render.js): one session of
// each pair (manifest.sessionPairs), drawn by the listener's id; every trial of those sessions and every check once,
// plus a few main trials repeated with A and B swapped, in an order shuffled by the id. Shared by the test page
// (window.ListeningPlan) and the analysis (require), so both read a result file the same way.
//   plan(manifest, id)   -> [{ trial, a, b, repeat }]   a, b: stimulus ids as played (A first)
//   sessionsOf(manifest, id) -> the session numbers this listener hears
//   rng(id)              -> a seeded random function (Park-Miller over a hash of the id)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ListeningPlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const REPEATS = 4;                       // main trials heard twice (the second time with A and B swapped)
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 2147483646 + 1; }
  function rng(id) { let s = hash(id); const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 10; i++) r(); return r; }
  function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function sessionsOf(manifest, id) {
    if (!manifest.sessionPairs) return null;
    const r = rng("sessions:" + id);
    return manifest.sessionPairs.map(p => p[r() < 0.5 ? 0 : 1]);
  }
  function plan(manifest, id) {
    const r = rng(id), out = [], mine = sessionsOf(manifest, id);
    for (const t of manifest.trials) {
      if (mine && t.type !== "check" && !mine.includes(t.session)) continue;
      const swap = r() < 0.5; out.push({ trial: t.id, a: t.pair[swap ? 1 : 0], b: t.pair[swap ? 0 : 1], repeat: false });
    }
    const main = shuffle(out.filter(p => manifest.trials.find(t => t.id === p.trial).type === "main"), r).slice(0, REPEATS);
    for (const p of main) out.push({ trial: p.trial, a: p.b, b: p.a, repeat: true });
    shuffle(out, r);
    // a repeat never straight after its first hearing
    const near = i => i > 0 && out[i].trial === out[i - 1].trial;
    for (let pass = 0; pass < 20 && out.some((_, i) => near(i)); pass++) {
      for (let i = 1; i < out.length; i++) if (near(i)) { const j = Math.floor(r() * out.length); [out[i], out[j]] = [out[j], out[i]]; }
    }
    return out;
  }
  return { plan, rng, sessionsOf, REPEATS };
});
