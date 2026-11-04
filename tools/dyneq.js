#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Analysis-driven versus conventional dynamic EQ: de-harsh with its harshness-model detector against the same
// processing triggered by the level in the same frequency range (FX.deharsh, sidechain "level").
//   node tools/dyneq.js <files or folders...> [--out dyneq.json] [--workers 2] [--max-dur 60]
// Per file: where each detector acts (on the harshest 10 % of moments and on the calmer half, by the harshness
// model), how far the harshness of the harshest moments falls, and how much of each result a static EQ, an ideal
// dynamic EQ and ideal EQ automation could reproduce (FX.eqExplained).
// Caveat: the harshest moments are chosen by the same model that drives the default detector, so its own
// scores on them are near 1 by construction; the informative numbers are the level detector's.
"use strict";
const { Worker, isMainThread, parentPort } = require("worker_threads");
const path = require("path"), fs = require("fs");

if (!isMainThread) {
  const WL = require("../src/analysis.js"), FX = require("../src/effects.js"), IO = require("./audio-io.js"), SC = require("./selfchecks.js");
  const curvesOf = async buf => { const F = await WL.analyse(buf); return { F, cur: WL.computeCurves(F, F.guess, { scale: "fixed" }) }; };
  parentPort.on("message", async job => {
    if (!job) process.exit(0);
    try {
      const buf = SC.trim(IO.readAudio(job.file, { sr: 44100 }), job.maxDur), an = await curvesOf(buf), { F, cur } = an;
      if (F.dur < 1) throw new Error("shorter than 1 s");
      const hf = cur.raw.hfac, snd = []; for (let m = 0; m < F.nF; m++) if (cur.gate[m]) snd.push(m);
      if (snd.length < 20) throw new Error("too little sound");
      const sv = snd.map(m => hf[m]).sort((a, b) => a - b), p50 = sv[Math.floor(0.5 * (sv.length - 1))], p90 = sv[Math.floor(0.9 * (sv.length - 1))];
      const top = snd.filter(m => hf[m] >= p90), calm = snd.filter(m => hf[m] <= p50), topS = new Set(top), calmS = new Set(calm);
      const base = { mode: "relative", amount: 0.6, threshold: 0.15, maxCut: 9, match: true, delta: false, trace: true };
      const out = { name: job.name, cls: F.guess, dur: F.dur };
      const runs = {};
      for (const sc of ["harshness", "level"]) {
        const r = await FX.deharsh(buf, an, Object.assign({}, base, { sidechain: sc })), wet = r.outputs[0].buf;
        const frameOf = t => Math.min(F.nF - 1, Math.max(0, Math.round(t / F.dt - 0.5)));
        let gt = 0, nt = 0, gc = 0, nc = 0;
        r.trace.t.forEach((t, i) => { const m = frameOf(t), g = r.trace.gate[i]; if (topS.has(m)) { gt += g; nt++; } else if (calmS.has(m)) { gc += g; nc++; } });
        const B = await curvesOf(wet), h1 = B.cur.raw.hfac, s0 = cur.raw.sharp, s1 = B.cur.raw.sharp, mean = (a, sel) => sel.reduce((s, m) => s + a[m], 0) / Math.max(1, sel.length);
        const e = await FX.eqExplained(FX.chansOf(buf), FX.chansOf(wet), buf.sampleRate);
        runs[sc] = r.trace;
        out[sc] = { open: r.stats.open, avgCut: r.stats.avgCut, onTop: nt ? gt / nt : null, onCalm: nc ? gc / nc : null, harshTop: [mean(hf, top), mean(h1, top)], harshCalm: [mean(hf, calm), mean(h1, calm)], sharpTop: [mean(s0, top), mean(s1, top)], sharpCalm: [mean(s0, calm), mean(s1, calm)], eqShare: e.eqShare, dynShare: e.dynShare, autoShare: e.autoShare };
      }
      // how often the two detectors agree
      const a = runs.harshness.gate, b = runs.level.gate; let both = 0, either = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const x = a[i] > 0.5, y = b[i] > 0.5; if (x && y) both++; if (x || y) either++; sa += a[i]; sb += b[i]; }
      const n = Math.min(a.length, b.length), ma = sa / n, mb = sb / n;
      for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
      out.agree = { jaccard: either ? both / either : null, r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null };
      parentPort.postMessage(out);
    } catch (e) { parentPort.postMessage({ name: job.name, error: e.message }); }
  });
  return;
}

const IO = require("./audio-io.js");
const argv = process.argv.slice(2), opt = { out: "dyneq.json", workers: 2, maxDur: 60 }, inputs = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--out") opt.out = argv[++i]; else if (a === "--workers") opt.workers = Number(argv[++i]); else if (a === "--max-dur") opt.maxDur = Number(argv[++i]); else inputs.push(a); }
if (!inputs.length) { console.error("usage: node tools/dyneq.js <files or folders...> [--out dyneq.json]"); process.exit(2); }
const files = IO.listAudio(inputs);
let base = path.dirname(files[0]); while (!files.every(f => f.startsWith(base + path.sep)) && base !== path.dirname(base)) base = path.dirname(base);
const t0 = Date.now(), res = [], queue = files.slice(); let active = 0;
const med = v => { v = v.filter(Number.isFinite).sort((a, b) => a - b); const h = v.length >> 1; return !v.length ? NaN : v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
const pc = v => Number.isFinite(v) ? Math.round(100 * v) + " %" : "–";
const finish = () => {
  const ok = res.filter(r => !r.error);
  fs.writeFileSync(opt.out, JSON.stringify({ files: ok.length, seconds: Math.round((Date.now() - t0) / 1000), results: ok, failed: res.filter(r => r.error) }, null, 1));
  for (const group of ["all", ...new Set(ok.map(r => r.name.split(path.sep)[0]))]) {
    const g = ok.filter(r => group === "all" || r.name.split(path.sep)[0] === group); if (!g.length) continue;
    console.log(`\n${group} (${g.length} files): detectors agree on open moments, median Jaccard ${pc(med(g.map(r => r.agree.jaccard)))}, gate correlation ${med(g.map(r => r.agree.r)).toFixed(2)}`);
    for (const sc of ["harshness", "level"]) {
      const drop = g.map(r => 1 - r[sc].harshTop[1] / r[sc].harshTop[0]), dropC = g.map(r => 1 - r[sc].harshCalm[1] / r[sc].harshCalm[0]);
      const sd = g.map(r => r[sc].sharpTop[0] - r[sc].sharpTop[1]), sdC = g.map(r => r[sc].sharpCalm[0] - r[sc].sharpCalm[1]);
      console.log(`  ${sc.padEnd(9)} open ${pc(med(g.map(r => r[sc].open)))}, avg cut ${med(g.map(r => r[sc].avgCut)).toFixed(1)} dB; acts on harshest 10 % ${pc(med(g.map(r => r[sc].onTop)))}, on calm half ${pc(med(g.map(r => r[sc].onCalm)))}; harshness of harshest 10 % −${pc(med(drop))}, of calm half −${pc(med(dropC))}; sharpness of harshest 10 % −${med(sd).toFixed(3)} acum, of calm half −${med(sdC).toFixed(3)}; static EQ ${pc(med(g.map(r => r[sc].eqShare)))}, dynamic EQ ${pc(med(g.map(r => r[sc].dynShare)))}, automation ${pc(med(g.map(r => r[sc].autoShare)))}`);
    }
  }
  for (const r of res) if (r.error) console.log("  skipped " + r.name + ": " + r.error);
  console.log(`\n${ok.length} files in ${Math.round((Date.now() - t0) / 1000)} s -> ${opt.out}`);
};
const next = w => { const f = queue.shift(); if (!f) { w.postMessage(null); if (--active === 0) finish(); return; } w.postMessage({ file: f, name: path.relative(base, f), maxDur: opt.maxDur }); };
for (let i = 0; i < Math.min(opt.workers, files.length); i++) {
  const w = new Worker(__filename); active++;
  w.on("message", m => { res.push(m); process.stderr.write(`${res.length}/${files.length} ${m.name}${m.error ? " (" + m.error + ")" : ""}\n`); next(w); });
  next(w);
}
