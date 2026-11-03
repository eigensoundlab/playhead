#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Threshold calibration with a held-out half. No labels are needed: the objective is the pass rate of the self-checks
// (edits whose correct answer is known by construction, tools/selfchecks.js).
//
//   node tools/tune.js <files or folders...> [--out DIR] [--max-dur 20] [--workers 2] [--seed 1]
//
// 1. Split the files into a tuning half and a held-out half, stratified by top-level folder (for example sfx/ and music/).
// 2. Stage 1, tuning half only: the shipped values plus one-at-a-time variants of each parameter in tools/params.js.
//    Features are extracted once per file and edit; each candidate re-runs only what depends on the parameters.
// 3. Keep, per parameter, the value with the most passed checks if it beats the shipped value by at least --min-gain checks.
// 4. Stage 2, both halves: shipped values against the frozen combination. Held-out results are the honest number.
// 5. Run the synthetic regression and analytic tests (test/run-tests.js) under the frozen values.
// Writes tune.json and tune.html; stage 1 is cached in stage1.json (--resume reuses it when files and candidates match).
//
//   --grid [--splits 20]   confidence interval instead: evaluate a grid of settings on every file once (cached in grid.json),
//                          run the tests under each, then for each of N random stratified splits pick the best test-passing
//                          setting on the tuning half and score it against the original values on the held-out half.
"use strict";
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");

if (!isMainThread) {
  // ---------------- worker: one file at a time, every candidate configuration ----------------
  const WL = require("../src/analysis.js");
  const IO = require("./audio-io.js");
  const SC = require("./selfchecks.js");
  const PR = require("./params.js");
  parentPort.on("message", async job => {
    if (!job) { process.exit(0); }
    const rows = [];
    try {
      WL.FEAT.keepRaw = true;
      WL.SFX.nmfIter = 20;              // layers are not part of any check; fewer NMF iterations save time
      PR.apply(PR.BASE);
      const buf = SC.trim(IO.readAudio(job.file, { sr: 44100 }), job.maxDur), name = path.basename(job.file);
      const A0 = await SC.analyseBuf(buf, name); A0.sum = SC.summarise(A0);
      const cls = A0.sum.cls;
      // the edits are made once, from the analysis under the shipped values (the hit goes where that analysis finds quiet)
      const edits = [];
      for (const C of SC.CHECKS) {
        if (C.pairs || (C.applies && !C.applies(A0, A0.sum))) continue;
        const E = C.edit(buf, A0, A0.sum, null);
        edits.push({ C, E, F: await WL.analyse(E) });
      }
      for (let ci = 0; ci < job.configs.length; ci++) {
        PR.apply(job.configs[ci]);
        const A = await SC.reanalyse({ F: A0.F, buf }, name);
        for (const { C, E, F } of edits) {
          try {
            const B = await SC.reanalyse({ F, buf: E }, name);
            for (const r of C.expect(A, B, A.sum, E).filter(Boolean)) rows.push([ci, C.id, r[0], r[2] ? 1 : 0]);
          } catch (e) { rows.push([ci, C.id, "ran", 0]); }
        }
      }
      parentPort.postMessage({ file: job.file, name: job.name, cls, rows });
    } catch (e) { parentPort.postMessage({ file: job.file, name: job.name, cls: "?", rows, error: e.message }); }
  });
  return;
}

// ---------------- main ----------------
const IO = require("./audio-io.js");
const PR = require("./params.js");
const { spawnSync } = require("child_process");
const argv = process.argv.slice(2), opt = { out: "playhead-tune", maxDur: 20, workers: 2, seed: 1, minGain: 2 }, inputs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i]; else if (a === "--max-dur") opt.maxDur = Number(argv[++i]); else if (a === "--workers") opt.workers = Number(argv[++i]);
  else if (a === "--seed") opt.seed = Number(argv[++i]); else if (a === "--min-gain") opt.minGain = Number(argv[++i]); else if (a === "--resume") opt.resume = true; else if (a === "--grid") opt.grid = true; else if (a === "--splits") opt.splits = Number(argv[++i]); else inputs.push(a);
}
if (!inputs.length) { console.error("usage: node tools/tune.js <files or folders...> [--out DIR] [--max-dur 20] [--workers 2] [--seed 1]"); process.exit(2); }
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

function fnv(s, seed) { let h = 2166136261 ^ seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function split(files, base) {
  const groups = {};
  for (const f of files) { const g = path.relative(base, f).split(path.sep)[0]; (groups[g] = groups[g] || []).push(f); }
  const tune = [], hold = [];
  for (const g of Object.keys(groups).sort()) groups[g].sort((a, b) => fnv(a, opt.seed) - fnv(b, opt.seed)).forEach((f, i) => (i % 2 ? hold : tune).push(f));
  return { tune, hold };
}
function runPool(files, configs, base, tag, onResult) {
  return new Promise(resolve => {
    const out = [], queue = files.slice(); let active = 0, done = 0;
    if (!files.length) return resolve(out);
    const next = w => { const f = queue.shift(); if (!f) { w.postMessage(null); if (--active === 0) resolve(out); return; } w.postMessage({ file: f, name: path.relative(base, f), maxDur: opt.maxDur, configs }); };
    for (let i = 0; i < Math.min(opt.workers, files.length); i++) {
      const w = new Worker(__filename); active++;
      w.on("message", m => { out.push(m); done++; if (onResult) onResult(m); log(`${tag} ${done}/${files.length} ${m.name}${m.error ? "  error: " + m.error : ""}`); next(w); });
      w.on("error", e => { log("worker error", e.message); });
      next(w);
    }
  });
}
function score(results, ci, filter) {
  let pass = 0, n = 0; const byCheck = {};
  for (const r of results) for (const [c, id, what, p] of r.rows) {
    if (c !== ci || (filter && !filter(r))) continue;
    pass += p; n++; const k = id + ": " + what; byCheck[k] = byCheck[k] || [0, 0]; byCheck[k][0] += p; byCheck[k][1]++;
  }
  return { pass, n, rate: n ? pass / n : NaN, byCheck };
}
function testsUnder(cfg) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "../test/run-tests.js")], { env: Object.assign({}, process.env, { PLAYHEAD_PARAMS: JSON.stringify(cfg) }), encoding: "utf8", maxBuffer: 1 << 26 });
  const m = /(\d+) of (\d+) checks passed/.exec(r.stdout || ""), failed = (r.stdout || "").split("\n").filter(l => l.startsWith("FAIL")).map(l => l.replace(/\s+/g, " "));
  return { passed: m ? +m[1] : 0, total: m ? +m[2] : 0, failed };
}

async function gridMode(files, base) {
  const t0 = Date.now(), ORIG = { melFloor: "abs-80", onsetMin: 0.6, sfxRise: 6, recEps: "1-2.5" };
  // floors x recurrence ranges (the 70 dB floor, which breaks a synthetic test, once for reference), plus one-at-a-time variants
  const configs = [];
  for (const mf of ["abs-80", "rel-80", "rel-90"]) for (const re of ["1-2.5", "1.5-3"]) configs.push(Object.assign({}, PR.BASE, { melFloor: mf, recEps: re }));
  configs.push(Object.assign({}, PR.BASE, { melFloor: "rel-70", recEps: "1.5-3" }));
  for (const k of ["onsetMin", "sfxRise"]) for (const v of PR.SPACE[k].values) if (String(v) !== String(PR.BASE[k])) configs.push(Object.assign({}, PR.BASE, { [k]: v }));
  if (!configs.some(c => PR.label(c) === PR.label(Object.assign({}, PR.BASE, ORIG)))) configs.push(Object.assign({}, PR.BASE, ORIG));
  const cache = path.join(opt.out, "grid.json");
  let G = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8")) : null;
  if (!G || JSON.stringify(G.configs) !== JSON.stringify(configs) || G.files.length !== files.length) {
    log(`grid: ${configs.length} settings on ${files.length} files`);
    const part = path.join(opt.out, "grid-partial.jsonl"), key = JSON.stringify(configs);
    const done = new Map();
    if (fs.existsSync(part)) for (const line of fs.readFileSync(part, "utf8").split("\n")) { if (!line) continue; const r = JSON.parse(line); if (r.key === key) done.set(r.res.name, r.res); }
    if (done.size) log(`grid: ${done.size} files resumed from ${part}`);
    const todo = files.filter(f => !done.has(path.relative(base, f)));
    const res = [...done.values()].concat(await runPool(todo, configs, base, "grid", r => fs.appendFileSync(part, JSON.stringify({ key, res: r }) + "\n")));
    G = { configs, files: files.map(f => path.relative(base, f)), results: res };
    fs.writeFileSync(cache, JSON.stringify(G));
  } else log("grid resumed from " + cache);
  if (!G.tests) { G.tests = configs.map((c, i) => { log(`tests ${i + 1}/${configs.length} ${PR.label(c)}`); return testsUnder(c); }); fs.writeFileSync(cache, JSON.stringify(G)); }
  // per file and setting: passed and total checks
  const per = G.results.map(r => { const p = configs.map(() => [0, 0]); for (const [c, , , ok] of r.rows) { p[c][0] += ok; p[c][1]++; } return { name: r.name, group: r.name.split(path.sep)[0], p }; });
  const iOrig = configs.findIndex(c => PR.label(c) === PR.label(Object.assign({}, PR.BASE, ORIG))), iShip = configs.findIndex(c => PR.label(c) === PR.label(PR.BASE));
  const okTests = configs.map((c, i) => G.tests[i].total > 0 && G.tests[i].passed === G.tests[i].total);
  const groups = {}; per.forEach((f, i) => (groups[f.group] = groups[f.group] || []).push(i));
  const splits = [], picks = {};
  for (let s = 0; s < (opt.splits || 20); s++) {
    const tuneSet = new Set();
    for (const g of Object.values(groups)) g.slice().sort((a, b) => fnv(per[a].name, 1000 + s) - fnv(per[b].name, 1000 + s)).forEach((fi, k) => { if (k % 2 === 0) tuneSet.add(fi); });
    const sum = (ci, inTune) => per.reduce((acc, f, fi) => (tuneSet.has(fi) === inTune ? [acc[0] + f.p[ci][0], acc[1] + f.p[ci][1]] : acc), [0, 0]);
    let best = iOrig, bestPass = sum(iOrig, true)[0];
    configs.forEach((c, ci) => { if (!okTests[ci]) return; const v = sum(ci, true)[0]; if (v > bestPass) { best = ci; bestPass = v; } });
    const ho = sum(iOrig, false), hb = sum(best, false), hs = sum(iShip, false);
    picks[PR.label(configs[best])] = (picks[PR.label(configs[best])] || 0) + 1;
    splits.push({ split: s, picked: PR.label(configs[best]), holdOrig: ho[0] / ho[1], holdPicked: hb[0] / hb[1], holdShipped: hs[0] / hs[1], n: ho[1] });
  }
  const d = splits.map(x => x.holdPicked - x.holdOrig).sort((a, b) => a - b), ds = splits.map(x => x.holdShipped - x.holdOrig).sort((a, b) => a - b);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / Math.max(1, a.length - 1));
  const q = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  const all = configs.map((c, ci) => { const t = per.reduce((acc, f) => [acc[0] + f.p[ci][0], acc[1] + f.p[ci][1]], [0, 0]); return { label: PR.label(c), pass: t[0], n: t[1], rate: t[0] / t[1], tests: G.tests[ci].passed + "/" + G.tests[ci].total, failed: G.tests[ci].failed }; });
  const out = { files: per.length, configs: all, splits, picks, gain: { mean: mean(d), sd: sd(d), lo: q(d, 0.025), hi: q(d, 0.975), min: d[0], max: d[d.length - 1] }, shippedGain: { mean: mean(ds), sd: sd(ds), lo: q(ds, 0.025), hi: q(ds, 0.975), min: ds[0], max: ds[ds.length - 1] }, seconds: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(opt.out, "splits.json"), JSON.stringify(out, null, 1));
  const pp = v => (100 * v).toFixed(2);
  log(`\nheld-out gain of the per-split pick over the original values, ${splits.length} splits: mean ${pp(out.gain.mean)} pp, sd ${pp(out.gain.sd)}, 95 % range ${pp(out.gain.lo)} to ${pp(out.gain.hi)}`);
  log(`held-out gain of the shipped values (${PR.label(PR.BASE)}): mean ${pp(out.shippedGain.mean)} pp, range ${pp(out.shippedGain.min)} to ${pp(out.shippedGain.max)}`);
  log("picked: " + Object.entries(picks).map(([k, v]) => v + "× " + k).join("; "));
  fs.writeFileSync(path.join(opt.out, "splits.html"), splitsHtml(out));
}
function splitsHtml(o) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = v => (100 * v).toFixed(2);
  const cfg = o.configs.slice().sort((a, b) => b.rate - a.rate).map(c => `<tr><td>${esc(c.label)}</td><td>${pp(c.rate)} % <span class=m>(${c.pass}/${c.n})</span></td><td>${esc(c.tests)}${c.failed.length ? "<div class=m>" + esc(c.failed.join("; ")) + "</div>" : ""}</td></tr>`).join("");
  const sp = o.splits.map(s => `<tr><td>${s.split + 1}</td><td>${esc(s.picked)}</td><td>${pp(s.holdOrig)} %</td><td>${pp(s.holdPicked)} %</td><td>${(s.holdPicked - s.holdOrig >= 0 ? "+" : "") + pp(s.holdPicked - s.holdOrig)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibration over repeated splits</title><style>
:root{--bg:#fbfbfa;--ink:#1d1d1b;--ink2:#5c5c55;--rule:#deded8;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#161615;--ink:#ecece8;--ink2:#a5a59e;--rule:#34342f;--card:#1e1e1c}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 8px}.m{color:var(--ink2);font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}th,td{border-bottom:1px solid var(--rule);padding:5px 7px;text-align:left;vertical-align:top}.tw{overflow-x:auto}
.big{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:10px 0}.big div{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px 12px}.big b{display:block;font-size:20px}
</style></head><body><main><h1>Calibration over repeated splits</h1><p class=m>${o.files} files; ${o.splits.length} random stratified splits; ${o.configs.length} settings, each evaluated once on every file; ${o.seconds} s for the split analysis.</p>
<div class=big><div>Held-out gain of the per-split pick<b>${(o.gain.mean >= 0 ? "+" : "") + pp(o.gain.mean)} pp</b><span class=m>sd ${pp(o.gain.sd)}; 95 % of splits ${pp(o.gain.lo)} to ${pp(o.gain.hi)}</span></div><div>Held-out gain of the shipped values<b>${(o.shippedGain.mean >= 0 ? "+" : "") + pp(o.shippedGain.mean)} pp</b><span class=m>range ${pp(o.shippedGain.min)} to ${pp(o.shippedGain.max)}</span></div></div>
<p>For each split, the setting with the most passed checks on the tuning half (among settings that pass all synthetic and analytic tests) is compared with the original values (absolute −80 dB floor, recurrence 1–2.5) on the held-out half.</p>
<h2>Settings, all files</h2><div class=tw><table><tr><th>Setting</th><th>Self-checks passed</th><th>Tests</th></tr>${cfg}</table></div>
<h2>Picks</h2><p>${Object.entries(o.picks).map(([k, v]) => v + "× " + esc(k)).join("<br>")}</p>
<h2>Splits</h2><div class=tw><table><tr><th>Split</th><th>Picked on tuning half</th><th>Held out, original</th><th>Held out, picked</th><th>Gain (pp)</th></tr>${sp}</table></div></main></body></html>`;
}
(async () => {
  const t0 = Date.now(), files = IO.listAudio(inputs);
  let base = path.dirname(files[0]); while (!files.every(f => f.startsWith(base + path.sep)) && base !== path.dirname(base)) base = path.dirname(base);
  if (opt.grid) { fs.mkdirSync(opt.out, { recursive: true }); return gridMode(files, base); }
  const { tune, hold } = split(files, base);
  log(`${files.length} files: ${tune.length} for tuning, ${hold.length} held out`);
  fs.mkdirSync(opt.out, { recursive: true });

  // stage 1: shipped values plus one-at-a-time variants, tuning half only
  const configs = [Object.assign({}, PR.BASE)];
  for (const [k, sp] of Object.entries(PR.SPACE)) for (const v of sp.values) if (String(v) !== String(PR.BASE[k])) configs.push(Object.assign({}, PR.BASE, { [k]: v }));
  log(`stage 1: ${configs.length} configurations on the tuning half`);
  const cache = path.join(opt.out, "stage1.json");
  let r1 = null;
  if (opt.resume && fs.existsSync(cache)) { const c = JSON.parse(fs.readFileSync(cache, "utf8")); if (JSON.stringify(c.configs) === JSON.stringify(configs) && JSON.stringify(c.tune) === JSON.stringify(tune)) { r1 = c.results; log("stage 1 resumed from " + cache); } }
  if (!r1) { r1 = await runPool(tune, configs, base, "stage 1"); fs.writeFileSync(cache, JSON.stringify({ configs, tune, results: r1 })); }
  const s1 = configs.map((c, i) => Object.assign({ cfg: c, label: PR.label(c) }, score(r1, i)));
  const chosen = Object.assign({}, PR.BASE), decisions = {};
  for (const k of Object.keys(PR.SPACE)) {
    let best = s1[0];
    s1.forEach(s => { if (Object.keys(PR.SPACE).every(q => q === k || String(s.cfg[q]) === String(PR.BASE[q])) && s.pass > best.pass) best = s; });
    const gain = best.pass - s1[0].pass;
    decisions[k] = { shipped: PR.BASE[k], best: best.cfg[k], gain, kept: gain >= opt.minGain ? best.cfg[k] : PR.BASE[k] };
    chosen[k] = decisions[k].kept;
  }
  log("stage 1 choice: " + PR.label(chosen));

  // guard: the synthetic regression and analytic tests must still pass. For each changed parameter, smallest gain first,
  // fall back to its next-best value on the tuning half, then to the shipped value, until they do.
  const tests = { shipped: testsUnder(PR.BASE) }, tried = [];
  let tf = testsUnder(chosen); tried.push({ cfg: Object.assign({}, chosen), tests: tf });
  const changed = Object.keys(PR.SPACE).filter(k => String(chosen[k]) !== String(PR.BASE[k])).sort((a, b) => decisions[a].gain - decisions[b].gain);
  for (const k of changed) {
    if (tf.passed === tf.total && tf.total > 0) break;
    const alts = s1.filter(s => Object.keys(PR.SPACE).every(q => q === k || String(s.cfg[q]) === String(PR.BASE[q])) && String(s.cfg[k]) !== String(chosen[k]) && String(s.cfg[k]) !== String(PR.BASE[k]) && s.pass - s1[0].pass >= opt.minGain).sort((a, b) => b.pass - a.pass).map(s => s.cfg[k]).concat([PR.BASE[k]]);
    for (const v of alts) {
      const c = Object.assign({}, chosen, { [k]: v }), t = testsUnder(c); tried.push({ cfg: c, tests: t });
      log(`  tests with ${k}=${v}: ${t.passed}/${t.total}`);
      if (t.passed > tf.passed) { chosen[k] = v; decisions[k].kept = v; decisions[k].guard = String(v) === String(PR.BASE[k]) ? "reverted: the tuned value broke a test" : "next-best value: the best broke a test"; tf = t; }
      if (tf.passed === tf.total) break;
    }
  }
  tests.frozen = tf; tests.tried = tried;
  log("frozen: " + PR.label(chosen) + `  (tests ${tf.passed}/${tf.total})`);

  // stage 2: shipped vs frozen on both halves
  const cfg2 = [Object.assign({}, PR.BASE), chosen];
  const r2 = await runPool(files, cfg2, base, "stage 2");
  const inTune = new Set(tune.map(f => path.relative(base, f)));
  const half = (ci, which) => score(r2, ci, r => (which === "tune") === inTune.has(r.name));
  const s2 = { tune: [half(0, "tune"), half(1, "tune")], hold: [half(0, "hold"), half(1, "hold")] };
  const byClass = {}; for (const r of r2) { if (inTune.has(r.name)) continue; byClass[r.cls] = byClass[r.cls] || [0, 0, 0, 0]; for (const [c, , , p] of r.rows) { byClass[r.cls][c * 2] += p; byClass[r.cls][c * 2 + 1]++; } }


  const res = { options: opt, split: { tune: tune.map(f => path.relative(base, f)), hold: hold.map(f => path.relative(base, f)) }, space: PR.SPACE, shipped: PR.BASE, stage1: s1.map(s => ({ label: s.label, cfg: s.cfg, pass: s.pass, n: s.n, rate: s.rate })), decisions, frozen: chosen,
    stage2: { tune: s2.tune.map(s => ({ pass: s.pass, n: s.n, rate: s.rate })), hold: s2.hold.map(s => ({ pass: s.pass, n: s.n, rate: s.rate })), holdByCheck: { shipped: s2.hold[0].byCheck, frozen: s2.hold[1].byCheck }, holdByClass: byClass }, tests, seconds: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(opt.out, "tune.json"), JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(opt.out, "tune.html"), html(res));
  const pc = s => (100 * s.rate).toFixed(1) + "% (" + s.pass + "/" + s.n + ")";
  log(`\ntuning half:   shipped ${pc(s2.tune[0])}  frozen ${pc(s2.tune[1])}`);
  log(`held-out half: shipped ${pc(s2.hold[0])}  frozen ${pc(s2.hold[1])}`);
  log(`tests: shipped ${tests.shipped.passed}/${tests.shipped.total}, frozen ${tests.frozen.passed}/${tests.frozen.total}${tests.frozen.failed.length ? " — " + tests.frozen.failed.join("; ") : ""}`);
  log(`wrote ${path.resolve(opt.out)}/tune.html in ${res.seconds} s`);
})().catch(e => { console.error(e); process.exit(1); });

function html(r) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pc = s => s && s.n ? (100 * s.rate).toFixed(1) + "% <span class=m>(" + s.pass + "/" + s.n + ")</span>" : "–";
  const base = r.stage1[0];
  const s1 = r.stage1.map((s, i) => `<tr${i === 0 ? " class=b" : ""}><td>${i === 0 ? "shipped values" : esc(Object.keys(r.space).filter(k => String(s.cfg[k]) !== String(r.shipped[k])).map(k => r.space[k].label + " = " + s.cfg[k]).join(", "))}</td><td>${pc(s)}</td><td>${i === 0 ? "" : (s.pass - base.pass >= 0 ? "+" : "") + (s.pass - base.pass)}</td></tr>`).join("");
  const dec = Object.entries(r.decisions).map(([k, d]) => `<tr><td>${esc(r.space[k].label)}<div class=m>${esc(r.space[k].note)}</div></td><td>${esc(d.shipped)}</td><td>${esc(d.best)}</td><td>${d.gain >= 0 ? "+" : ""}${d.gain}</td><td><b>${esc(d.kept)}</b>${d.guard ? "<div class=m>" + esc(d.guard) + "</div>" : ""}</td></tr>`).join("");
  const keys = [...new Set(Object.keys(r.stage2.holdByCheck.shipped).concat(Object.keys(r.stage2.holdByCheck.frozen)))].sort();
  const bc = keys.map(k => { const a = r.stage2.holdByCheck.shipped[k] || [0, 0], b = r.stage2.holdByCheck.frozen[k] || [0, 0], d = b[0] - a[0]; return `<tr><td>${esc(k)}</td><td>${a[0]}/${a[1]}</td><td>${b[0]}/${b[1]}</td><td class=${d > 0 ? "up" : d < 0 ? "dn" : ""}>${d > 0 ? "+" : ""}${d || ""}</td></tr>`; }).join("");
  const cls = Object.entries(r.stage2.holdByClass).map(([c, v]) => `<tr><td>${esc(c)}</td><td>${v[0]}/${v[1]}</td><td>${v[2]}/${v[3]}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playhead threshold calibration</title><style>
:root{--bg:#fbfbfa;--ink:#1d1d1b;--ink2:#5c5c55;--rule:#deded8;--card:#fff;--up:#1f7a3a;--dn:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--ink:#ecece8;--ink2:#a5a59e;--rule:#34342f;--card:#1e1e1c;--up:#5cc47a;--dn:#ff7b6e}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 8px}p{margin:4px 0 10px}.m{color:var(--ink2);font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card)}th,td{border-bottom:1px solid var(--rule);padding:5px 7px;text-align:left;vertical-align:top}th{font-weight:600}.tw{overflow-x:auto}tr.b td{font-weight:600}.up{color:var(--up);font-weight:600}.dn{color:var(--dn);font-weight:600}
.big{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:10px 0}.big div{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px 12px}.big b{display:block;font-size:20px}
</style></head><body><main>
<h1>Threshold calibration</h1><p class=m>${r.split.tune.length + r.split.hold.length} files, ${r.split.tune.length} for tuning and ${r.split.hold.length} held out (stratified by folder, seed ${r.options.seed}); first ${r.options.maxDur} s of each; ${r.seconds} s.</p>
<div class=big><div>Held out, shipped values<b>${pc(r.stage2.hold[0])}</b></div><div>Held out, frozen values<b>${pc(r.stage2.hold[1])}</b></div><div>Tests under frozen values<b>${r.tests.frozen.passed}/${r.tests.frozen.total}</b><span class=m>${r.tests.frozen.failed.length ? esc(r.tests.frozen.failed.join("; ")) : "all passed"}</span></div></div>
<h2>Stage 1: one parameter at a time, tuning half</h2><p>Self-check pass rate on the tuning half for the shipped values and each variant. The last column is the change in passed checks.</p><div class=tw><table><tr><th>Configuration</th><th>Passed</th><th>Δ</th></tr>${s1}</table></div>
<h2>Frozen values</h2><p>A variant is kept only if it passes at least ${r.options.minGain} more checks than the shipped value on the tuning half.</p><div class=tw><table><tr><th>Parameter</th><th>Shipped</th><th>Best on tuning half</th><th>Gain</th><th>Frozen</th></tr>${dec}</table></div>
<p class=m>Test runs while freezing: ${r.tests.tried.map(t => esc(Object.keys(r.space).filter(k => String(t.cfg[k]) !== String(r.shipped[k])).map(k => k + "=" + t.cfg[k]).join(", ") || "shipped") + " → " + t.tests.passed + "/" + t.tests.total).join(" · ")}</p>
<h2>Stage 2: both halves</h2><div class=tw><table><tr><th>Half</th><th>Shipped values</th><th>Frozen values</th></tr><tr><td>Tuning</td><td>${pc(r.stage2.tune[0])}</td><td>${pc(r.stage2.tune[1])}</td></tr><tr><td>Held out</td><td>${pc(r.stage2.hold[0])}</td><td>${pc(r.stage2.hold[1])}</td></tr></table></div>
<h2>Held-out half by check</h2><div class=tw><table><tr><th>Check</th><th>Shipped</th><th>Frozen</th><th>Δ</th></tr>${bc}</table></div>
<h2>Held-out half by detected class</h2><div class=tw><table><tr><th>Class</th><th>Shipped</th><th>Frozen</th></tr>${cls}</table></div>
</main></body></html>`;
}
