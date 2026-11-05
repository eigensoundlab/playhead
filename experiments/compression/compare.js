// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Does analysis-driven levelling sound more natural than a compressor? A listening test decides that; this measures
// what can be measured. Each method evens out the events of a sound to the same degree (the same spread of event
// loudness), and we compare what else it changes:
//   attack   change of each event's attack crest (peak of the first 10 ms over the RMS of the first 200 ms), dB
//   shape    mean change of each event's envelope shape (5 ms RMS in dB, first 400 ms, each normalised to its own peak), dB
//   pumping  how much the gain moves in the gaps between events (standard deviation, dB): the background breathing
// Methods: a feed-forward RMS compressor (ratio 4:1, 6 dB knee, threshold 6 dB under the quietest event so every event
// is compressed, 120 ms release) with a fast (5 ms) and a slow (30 ms) attack, and "Level the events" (one gain per
// event, src/effects.js) with its amount searched so it reaches the same evenness as each compressor. Everything is
// matched in integrated loudness afterwards.
//
//   node experiments/compression/compare.js            -> table and experiments/compression/results.json
"use strict";
const path = require("path"), fs = require("fs");
const WL = require("../../src/analysis.js"); require("../../src/descriptors.js");
const FX = require("../../src/effects.js"), P = require("../../src/probes.js");

const db = v => 20 * Math.log10(Math.max(v, 1e-12));
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function mkBuf(sr, chs) { return { sampleRate: sr, numberOfChannels: chs.length, length: chs[0].length, duration: chs[0].length / sr, getChannelData: c => chs[c] }; }

// synthetic material with known events: struck hits (three damped partials and a noise transient) over a quiet bed
function hitsOverBed(sr, seed, kind) {
  const R = rng(seed), dur = 9, n = sr * dur, x = new Float32Array(n), times = [];
  for (let i = 0; i < n; i++) x[i] = (R() * 2 - 1) * 0.006;                       // bed, about -48 dBFS RMS
  let t = 0.4;
  while (t < dur - 0.8) {
    const lvl = Math.pow(10, (-26 + 24 * R()) / 20), i0 = Math.round(t * sr), f = kind === "steps" ? 180 + 80 * R() : 600 + 900 * R();
    for (let k = 0; k < Math.round((kind === "steps" ? 0.15 : 0.35) * sr) && i0 + k < n; k++) {
      const u = k / sr, env = Math.exp(-u / (kind === "steps" ? 0.03 : 0.08));
      x[i0 + k] += lvl * (env * (0.6 * Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(2 * Math.PI * 2.76 * f * u) + 0.15 * Math.sin(2 * Math.PI * 5.4 * f * u)) + Math.exp(-u / 0.004) * (R() * 2 - 1) * 0.8);
    }
    times.push(t);
    t += kind === "steps" ? 0.45 + 0.15 * R() : 0.5 + 0.4 * R();
  }
  return { buf: mkBuf(sr, [x]), times };
}

function compressorGain(chans, sr, thrDb, ratio, attMs, relMs, kneeDb) {
  const n = chans[0].length, a = Math.exp(-1 / (attMs / 1000 * sr)), r = Math.exp(-1 / (relMs / 1000 * sr)), w = Math.exp(-1 / (0.005 * sr));
  const g = new Float32Array(n); let ms = 0, gr = 0;
  for (let i = 0; i < n; i++) {
    let s = 0; for (const c of chans) s += c[i] * c[i]; s /= chans.length;
    ms = w * ms + (1 - w) * s;
    const lv = 10 * Math.log10(ms + 1e-20), over = lv - thrDb;
    const want = over <= -kneeDb / 2 ? 0 : over >= kneeDb / 2 ? over * (1 - 1 / ratio) : (1 - 1 / ratio) * Math.pow(over + kneeDb / 2, 2) / (2 * kneeDb);
    gr = want > gr ? a * gr + (1 - a) * want : r * gr + (1 - r) * want;      // gain reduction follows with attack and release
    g[i] = -gr;
  }
  return g;
}
const apply = (chans, gdb) => chans.map(c => Float32Array.from(c, (v, i) => v * Math.pow(10, gdb[i] / 20)));
function matchLoud(src, out, sr) { const a = FX.lufsOf(src, sr), b = FX.lufsOf(out, sr), g = Math.pow(10, (a - b) / 20); return out.map(c => c.map(v => v * g)); }

function metrics(src, out, sr, ev, gdb) {
  const zs = FX.kWeighted(src, sr), zo = FX.kWeighted(out, sr), n = src[0].length, w200 = Math.round(0.2 * sr), w10 = Math.round(0.01 * sr), w400 = Math.round(0.4 * sr), w5 = Math.round(0.005 * sr);
  const lv = (z, a, b) => { let s = 0; for (const c of z) for (let i = a; i < b; i++) s += c[i] * c[i]; return 10 * Math.log10(s / Math.max(1, (b - a) * z.length) + 1e-20); };
  const pk = (z, a, b) => { let m = 0; for (const c of z) for (let i = a; i < b; i++) m = Math.max(m, Math.abs(c[i])); return db(m); };
  const sd = v => { const m = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length); };
  const before = [], after = [], attack = [], shape = [];
  ev.forEach((e, i) => {
    const end = Math.min(n, i + 1 < ev.length ? ev[i + 1].a : n);
    const b2 = Math.min(end, e.a + w200); if (b2 - e.a < w10 * 2) return;
    before.push(lv(zs, e.a, b2)); after.push(lv(zo, e.a, b2));
    attack.push((pk(src, e.a, e.a + w10) - lv(src, e.a, b2)) - (pk(out, e.a, e.a + w10) - lv(out, e.a, b2)));
    const b4 = Math.min(end, e.a + w400), envS = [], envO = [];
    for (let j = e.a; j + w5 <= b4; j += w5) { envS.push(lv(src, j, j + w5)); envO.push(lv(out, j, j + w5)); }
    const ms = Math.max(...envS), mo = Math.max(...envO);
    const valid = envS.map((v, k) => v > ms - 40 ? Math.abs((v - ms) - (envO[k] - mo)) : null).filter(v => v != null);
    if (valid.length) shape.push(valid.reduce((x, y) => x + y, 0) / valid.length);
  });
  // gaps: from 300 ms after an event's start to 30 ms before the next one. pumping: how much the gain moves inside the
  // gaps; steps: how much the gaps' average gain differs from gap to gap (a background that jumps with the events)
  const within = [], perGap = [];
  ev.forEach((e, i) => {
    if (i + 1 >= ev.length) return; const a = e.a + Math.round(0.3 * sr), b = ev[i + 1].a - Math.round(0.03 * sr); if (b - a < w5 * 4) return;
    const gs = []; for (let j = a; j < b; j += w5) gs.push(gdb[j]);
    const m = gs.reduce((x, y) => x + y, 0) / gs.length; perGap.push(m); for (const v of gs) within.push(v - m);
  });
  const mean = v => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
  return { events: before.length, spreadBefore: sd(before), spreadAfter: sd(after), attackLossDb: mean(attack), shapeChangeDb: mean(shape),
    pumpingDb: within.length > 5 ? Math.sqrt(mean(within.map(v => v * v))) : 0, stepsDb: perGap.length > 1 ? sd(perGap) : 0 };
}

(async () => {
  const sr = 44100;
  await WL.calibrate(sr);
  const kit = P.makeSfxKit(sr, WL.kFilterCoeffs);
  const items = [
    ["Hits over a bed (synthetic)", hitsOverBed(sr, 3, "hits")], ["Footsteps over a bed (synthetic)", hitsOverBed(sr, 11, "steps")],
    ["Shots, a burst (synthetic)", hitsOverBed(sr, 29, "hits")],
    ...["Rifle_Reload", "Explosion"].map(k => { const b = kit.find(x => x.name.includes(k)); return [b.name, { buf: b }]; })
  ];
  const rows = [];
  for (const [name, it] of items) {
    const buf = it.buf, src = Array.from({ length: buf.numberOfChannels }, (_, c) => Float32Array.from(buf.getChannelData(c)));
    const F = await WL.analyse(buf), X = WL.sfxOf(F, buf, name), an = { X }, ev = FX.eventsOf(an, sr, src[0].length);
    if (ev.length < 3) { rows.push({ name, events: ev.length, skipped: true }); continue; }
    const lv0 = FX.eventLevelGain(src, sr, ev, { amount: 0, target: "median", maxDb: 24 }), quiet = Math.min(...lv0.levels);
    const res = { name, events: ev.length };
    for (const [label, att] of [["fast", 5], ["slow", 30]]) {
      const g = compressorGain(src, sr, quiet - 6, 4, att, 120, 6), comp = metrics(src, matchLoud(src, apply(src, g), sr), sr, ev, g);
      // levelling amount that reaches the same spread (bisection)
      let lo = 0, hi = 100, lev = null;
      for (let k = 0; k < 14; k++) {
        const amount = (lo + hi) / 2, L = FX.eventLevelGain(src, sr, ev, { amount, target: "median", maxDb: 24 }), m = metrics(src, matchLoud(src, apply(src, L.gdb), sr), sr, ev, L.gdb);
        lev = { amount, ...m };
        if (m.spreadAfter > comp.spreadAfter) lo = amount; else hi = amount;
      }
      res[label] = { comp, level: lev };
    }
    // how far each can go: the compressor at 40:1 with a fast attack, and the leveller at its default (70%)
    const gMax = compressorGain(src, sr, quiet - 6, 40, 5, 120, 6), Ld = FX.eventLevelGain(src, sr, ev, { amount: 70, target: "median", maxDb: 12 });
    res.furthest = { comp: metrics(src, matchLoud(src, apply(src, gMax), sr), sr, ev, gMax), level: metrics(src, matchLoud(src, apply(src, Ld.gdb), sr), sr, ev, Ld.gdb) };
    rows.push(res);
  }
  const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "–");
  console.log("sound                              events | attack  spread before → after | attack lost dB  | shape change dB | pumping dB   | steps dB     (compressor / levelling)");
  for (const r of rows) {
    if (r.skipped) { console.log(r.name.padEnd(36), r.events, "events: skipped"); continue; }
    for (const k of ["fast", "slow"]) { const c = r[k].comp, l = r[k].level;
      console.log((k === "fast" ? r.name : "").padEnd(36), k === "fast" ? String(r.events).padStart(3) : "   ", " | " + (k === "fast" ? "5 ms " : "30 ms"), "  ", f(c.spreadBefore), "→", f(c.spreadAfter), "/", f(l.spreadAfter),
        "  |", f(c.attackLossDb), "/", f(l.attackLossDb), "  |", f(c.shapeChangeDb), "/", f(l.shapeChangeDb), "  |", f(c.pumpingDb, 2), "/", f(l.pumpingDb, 2), "  |", f(c.stepsDb, 2), "/", f(l.stepsDb, 2), "  (levelling amount " + Math.round(l.amount) + "%)"); }
  }
  console.log("\nfurthest evenness (spread after, attack lost): compressor 40:1, 5 ms  /  Level the events at 70%");
  for (const r of rows) if (!r.skipped) { const c = r.furthest.comp, l = r.furthest.level;
    console.log(r.name.padEnd(36), f(c.spreadBefore), "→", f(c.spreadAfter), "/", f(l.spreadAfter), "   attack", f(c.attackLossDb), "/", f(l.attackLossDb)); }
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(rows, null, 1) + "\n");
})();
