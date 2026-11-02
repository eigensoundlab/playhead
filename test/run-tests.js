// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Regression tests on the built-in signals, which have known beats, sections and events.
// Run with: npm test   (Node 18+, no dependencies)
"use strict";
const WL = require("../src/analysis.js");
const P = require("../src/probes.js");
const FX = require("../src/effects.js");

const results = [];
function check(name, value, pass, detail) {
  results.push({ name, value, pass, detail: detail || "" });
  console.log((pass ? "PASS " : "FAIL ") + name.padEnd(48) + String(value).padEnd(14) + (detail || ""));
}
async function analyseAll(buf, name) {
  const F = await WL.analyse(buf);
  const cur = WL.computeCurves(F, F.guess, { scale: "fixed" });
  return { F, cur, R: WL.rhythmOf(F), St: WL.structureOf(F), X: WL.sfxOf(F, buf, name) };
}
const meanGated = (a, g) => { let s = 0, k = 0; for (let i = 0; i < a.length; i++) if (g[i]) { s += a[i]; k++; } return k ? s / k : 0; };
const finite = buf => { for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) if (!isFinite(v)) return false; return true; };

(async () => {
  const t0 = Date.now();
  await WL.calibrate(44100);

  /* music: beats, downbeats, sections */
  const arc = P.makeCueArc(44100, WL.kFilterCoeffs);
  const A = await analyseAll(arc, "Cue arc");
  const tr = arc.truth;
  const fb = WL.beatF(A.R.beatTimes, tr.beats, tr.regions), fd = WL.beatF(A.R.downTimes, tr.downbeats, tr.regions);
  check("cue arc: tempo (BPM)", A.R.tempo.toFixed(1), Math.abs(A.R.tempo - 120) < 1.5);
  check("cue arc: beat F-measure (dynamic programming)", fb.f.toFixed(2), fb.f >= 0.9);
  check("cue arc: downbeat F-measure", fd.f.toFixed(2), fd.f >= 0.9);
  const tb = arc.segments.slice(1).map(s => s.t0);
  const hit = tb.filter(t => A.St.bounds.some(b => Math.abs(b - t) <= 1)).length;
  check("cue arc: section boundaries found", hit + "/" + tb.length, hit === tb.length);
  check("cue arc: section letters", A.St.segs.map(s => s.label).join(""), A.St.segs.map(s => s.label).join("").replace(/(.)\1+/g, "$1") === "ABCDEABA");

  const ramp = P.makeTempoRamp(44100, WL.kFilterCoeffs);
  const Rr = await analyseAll(ramp, "Tempo ramp");
  const fp = WL.beatF(Rr.R.plpTimes, ramp.truth.beats, ramp.truth.regions);
  check("tempo ramp: beat F-measure (local pulse)", fp.f.toFixed(2), fp.f >= 0.9);

  /* probe suite: loudness held constant, character changes */
  const probe = P.makeProbeSuite(44100, WL.kFilterCoeffs);
  const Pp = await analyseAll(probe, "Probe suite");
  const seg = lab => { const s = probe.segments.find(x => x.label === lab); const a = Math.floor(s.t0 / Pp.F.dt), b = Math.floor(s.t1 / Pp.F.dt); const g = Pp.cur.gate.slice(a, b); return k => meanGated(Pp.cur.curves[k].slice(a, b), g); };
  check("probe: activity drum fill > pad", seg("Drum fill")("c2").toFixed(2) + " > " + seg("Major pad")("c2").toFixed(2), seg("Drum fill")("c2") > seg("Major pad")("c2") + 0.3);
  check("probe: harmonic tension cluster > pad", seg("Pad + cluster")("c6").toFixed(2) + " > " + seg("Major pad")("c6").toFixed(2), seg("Pad + cluster")("c6") > seg("Major pad")("c6") + 0.2);
  check("probe: activity ignores pink noise", seg("Pink noise")("c2").toFixed(2), seg("Pink noise")("c2") < 0.1);

  /* SFX kit: events and Schaeffer-style tags */
  const kit = P.makeSfxKit(44100, WL.kFilterCoeffs);
  let found = 0, total = 0, tags = 0;
  const kitAn = {};
  for (const b of kit) {
    const An = await analyseAll(b, b.name); kitAn[b.name] = An;
    const used = new Set();
    for (const e of b.sfxTruth.events) {
      total++;
      let bi = -1, bd = 1e9; An.X.events.forEach((x, i) => { const d = Math.abs(x.t0 - e.t); if (!used.has(i) && d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd <= 0.04) { used.add(bi); found++; if (e.tag.split("|").includes(An.X.events[bi].tag)) tags++; }
    }
  }
  check("SFX kit: events found", found + "/" + total, found >= total - 1);
  check("SFX kit: tags correct", tags + "/" + total, tags >= total - 2);
  const bad = kitAn["Sword_Hit_BadExport.wav"].X.issues.filter(i => i.sev === "bad" || i.sev === "warn").length;
  check("SFX kit: problems flagged on bad export", bad, bad >= 4);

  /* effects: each result is re-analysed */
  const kitBy = n => kit.find(b => b.name.includes(n));
  {
    const src = kitBy("Sword"), r = await FX.cleanup(src, kitAn[src.name], { peakDb: -1, mono: true });
    const B = await analyseAll(r.outputs[0].buf, "clean.wav");
    const left = B.X.issues.filter(i => i.sev === "bad" || i.sev === "warn").length;
    check("effects: clean-up leaves no problems", left, left === 0 && finite(r.outputs[0].buf));
  }
  {
    const src = kitBy("Gun_Pistol"), An = kitAn[src.name];
    const r = await FX.layerMix(src, An, { gains: An.X.layers.map((l, i) => i === 0 ? -12 : 0), match: true });
    const B = await analyseAll(r.outputs[0].buf, "layers.wav");
    const d = An.X.layers[0].share - (B.X.layers[0] ? B.X.layers[0].share : 0);
    check("effects: layer remix lowers the sub layer share", (d * 100).toFixed(0) + " points", d >= 0.15 && finite(r.outputs[0].buf));
  }
  {
    const src = kitBy("Glass"), An = kitAn[src.name];
    const r = await FX.deharsh(src, An, { amount: 0.8, threshold: 0.1, maxCut: 12, match: true });
    const B = await analyseAll(r.outputs[0].buf, "deharsh.wav");
    const h0 = meanGated(An.cur.raw.hfac, An.cur.gate), h1 = meanGated(B.cur.raw.hfac, B.cur.gate);
    const l0 = FX.lufsOf([src.getChannelData(0), src.getChannelData(1)], 44100), l1 = FX.lufsOf([r.outputs[0].buf.getChannelData(0), r.outputs[0].buf.getChannelData(1)], 44100);
    check("effects: de-harsh lowers harshness at equal loudness", ((1 - h1 / h0) * 100).toFixed(0) + "% / " + (l1 - l0).toFixed(1) + " LU", h1 < 0.9 * h0 && Math.abs(l1 - l0) < 1);
  }
  {
    const src = kitBy("Engine"), r = await FX.loopMaker(src, kitAn[src.name], { xfadeMs: 60, minLen: 0.5 });
    const B = await analyseAll(r.outputs[0].buf, "engine_loop.wav");
    check("effects: loop maker wraps cleanly", B.X.seam && B.X.seam.ok ? "clean" : "seam", !!(B.X.seam && B.X.seam.ok));
  }
  {
    const r = await FX.tensionShape(arc, A, { contrast: 0.8, bright: 0.5 });
    const B = await analyseAll(r.outputs[0].buf, "tension.wav");
    const lra = An => { const g = An.cur.gate, t = Array.from(An.cur.lufs).filter((_, m) => g[m]).sort((a, b) => a - b); return t[Math.floor(0.95 * (t.length - 1))] - t[Math.floor(0.1 * (t.length - 1))]; };
    check("effects: tension shaper widens loudness range", lra(A).toFixed(1) + " -> " + lra(B).toFixed(1) + " LU", lra(B) > lra(A) + 2);
  }
  {
    const src = kitBy("Footstep"), r = await FX.variations(src, kitAn[src.name], { count: 3, layerDb: 3, pitch: 1, grains: true });
    check("effects: variations rendered", r.outputs.length, r.outputs.length === 3 && r.outputs.every(o => finite(o.buf)));
  }

  {
    const crc = FX.crc32(new TextEncoder().encode("123456789")).toString(16);
    const z = FX.zipStore([{ name: "a.wav", data: new Uint8Array([1, 2, 3]) }]);
    check("export: CRC-32 and zip container", crc, crc === "cbf43926" && z.length === 30 + 5 + 3 + 46 + 5 + 22);
  }

  const failed = results.filter(r => !r.pass);
  console.log("\n" + (results.length - failed.length) + " of " + results.length + " checks passed in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
