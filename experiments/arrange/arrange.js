// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Do the arrangements Playhead.arrange proposes measure the same way when they are actually mixed? Each session is one
// layered impact built from four parts (sub, body, transient, tail; CC0 Sonic Pi samples), placed roughly: every part
// but the loudest a few tens of milliseconds off and at its own level. For each session:
//   arrangements   the rough placement (baseline), the three best candidates of arrange() for each goal (punch, big,
//                  clean) and 12 random placements within the search's limits (moves up to 0.25 s, gains -6..+3 dB),
//                  so that the measures spread
//   predicted      Playhead.measureParts(parts) from the parts' documents, as the search sees them
//   rendered       the parts mixed at those offsets and gains, the mix analysed (same profile, class and curve rate) and
//                  measured as a single part: Playhead.measureParts([{ doc: mix }])
// Compared: the measures of the whole (peak level, rise, contrast, focus, tail, coverage, low end, harshness) by Pearson
// r and mean absolute error over all arrangements; per session and goal, the rank correlation (Spearman) of predicted
// and rendered scores, and whether the best candidate still beats the rough placement once rendered. The measures that
// are about the parts themselves (together, overlap, shared) cannot be read from a mix; the rendered scores keep their
// predicted values, so they test the measures of the whole only. As a proxy for "together", the rendered mix's onsets
// within 80 ms before and 20 ms after its peak are counted: a flam shows as two.
//
//   node experiments/arrange/arrange.js [sonic-pi-samples-dir]     -> table and experiments/arrange/results.json
"use strict";
const path = require("path"), fs = require("fs"), { execFileSync } = require("child_process");
const P = require("../../src/playhead.js");
const WL = require("../../src/analysis.js");

const SR = 44100;
const DIR = process.argv[2] || path.join(__dirname, "../corpus/src/sonic-pi/etc/samples");
// Park-Miller, warmed up: its first draws from nearby seeds are nearly equal
function rng(seed) { let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 10; i++) r(); return r; }
function load(name) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(DIR, name + ".flac"), "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice();
  // a clip as an editor holds it: no more than 2.5 s, faded out over its last 50 ms
  const n = Math.min(x.length, Math.round(2.5 * SR)), y = x.slice(0, n), f = Math.round(0.05 * SR);
  for (let i = 0; i < f && i < n; i++) y[n - 1 - i] *= i / f;
  return y;
}
// the same kits as experiments/compose
const KITS = [
  { sub: "bd_boom", body: "drum_tom_lo_hard", transient: "perc_snap", tail: "drum_splash_hard" },
  { sub: "misc_cineboom", body: "perc_impact1", transient: "elec_wood", tail: "perc_swash" },
  { sub: "bd_808", body: "elec_fuzz_tom", transient: "elec_tick", tail: "elec_cymbal" },
  { sub: "drum_heavy_kick", body: "perc_impact2", transient: "perc_snap2", tail: "drum_cymbal_open" },
  { sub: "bd_zum", body: "glitch_perc3", transient: "elec_pop", tail: "ambi_dark_woosh" },
  { sub: "bass_hit_c", body: "drum_tom_mid_hard", transient: "drum_snare_hard", tail: "drum_splash_soft" },
  { sub: "bd_gas", body: "glitch_perc1", transient: "hat_tap", tail: "perc_swoosh" },
  { sub: "elec_hollow_kick", body: "perc_door", transient: "elec_flip", tail: "ride_via" },
  // more varied material (added for the listening test): robot, glass and metal, tabla, guitar, cinematic, vinyl,
  // electronic, choir
  { sub: "bass_voxy_hit_c", body: "glitch_robot1", transient: "elec_blip2", tail: "mehackit_robot3" },
  { sub: "bd_pure", body: "perc_bell2", transient: "elec_ping", tail: "ambi_glass_rub" },
  { sub: "tabla_ghe3", body: "tabla_na_o", transient: "tabla_te1", tail: "tabla_tun2" },
  { sub: "bass_woodsy_c", body: "guit_e_fifths", transient: "elec_twang", tail: "guit_harmonics" },
  { sub: "bass_hard_c", body: "bass_drop_c", transient: "hat_metal", tail: "ambi_lunar_land" },
  { sub: "bd_tek", body: "vinyl_scratch", transient: "hat_noiz", tail: "vinyl_rewind" },
  { sub: "bd_chip", body: "elec_bong", transient: "elec_twip", tail: "ambi_soft_buzz" },
  { sub: "bass_thick_c", body: "ambi_choir", transient: "perc_bell", tail: "ambi_drone" }
];
const ROLES = ["sub", "body", "transient", "tail"];
const OPTS = { profile: "sfx", assetClass: "sfx", curveRate: 100 };
const WHOLE = ["peakLufs", "rise", "contrast", "focus", "tail", "coverage", "low", "harshness"];
const GOAL_NAMES = ["punch", "big", "clean"];

function mix(clips, arr) {
  const n = Math.max(...clips.map((x, k) => Math.round(arr[k].offset * SR) + x.length)) + Math.round(0.05 * SR), y = new Float32Array(n);
  clips.forEach((x, k) => { const o = Math.round(arr[k].offset * SR), g = Math.pow(10, arr[k].gain / 20); for (let i = 0; i < x.length; i++) if (o + i >= 0) y[o + i] += g * x[i]; });
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  if (pk > 0.98) for (let i = 0; i < n; i++) y[i] *= 0.98 / pk;      // a plain gain, as a mix bus fader: no clipping, no limiter
  return { y, scale: pk > 0.98 ? 0.98 / pk : 1 };
}
function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}
const ranks = a => { const ix = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < ix.length;) { let j = i; while (j + 1 < ix.length && ix[j + 1][0] === ix[i][0]) j++; for (let k = i; k <= j; k++) r[ix[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = (a, b) => pearson(ranks(a), ranks(b));
const median = a => { const s = a.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const range = a => { const s = a.filter(v => v != null && !isNaN(v)); return [Math.min(...s), Math.max(...s)]; };
const r3 = v => (v == null || isNaN(v) ? null : Math.round(v * 1000) / 1000);
// a goal's score from measures, as arrange() computes it (without the gain cost, which a mix cannot show)
function scoreFrom(m, goal) {
  const w = P.goals[goal], sep = m.shared == null ? 0.5 : 1 - m.shared, c = v => Math.max(0, Math.min(1, v)), hard = c(1 - (m.rise - 0.01) / 0.1);
  const s = {
    punch: 0.2 * hard + 0.1 * c(m.contrast / 40) + 0.2 * c(m.focus / 30) + 0.2 * m.together + 0.1 * sep + 0.2 * m.overlap,
    size: 0.3 * (m.coverage == null ? 0.5 : m.coverage) + 0.25 * c(m.tail / 2) + 0.2 * (m.low == null ? 0 : c(m.low / 0.4)) + 0.15 * hard + 0.1 * m.together,
    clean: 0.5 * sep + 0.2 * m.overlap + 0.15 * m.together + 0.15 * hard
  };
  let v = 0, n = 0; for (const k in w) { v += w[k] * s[k]; n += Math.abs(w[k]); }
  if (m.harshness != null && m.harshness > 0.9) v -= 2 * (m.harshness - 0.9);
  return v / n;
}

(async () => {
  await WL.calibrate(SR);
  const t0 = Date.now(), sessions = [];
  for (let s = 0; s < KITS.length; s++) {
    const kit = KITS[s], R = rng(101 + 7 * s), clips = ROLES.map(r => load(kit[r]));
    const docs = [];
    for (const x of clips) docs.push(await P.analyze({ sampleRate: SR, channels: [x] }, OPTS));
    // the rough placement: the sub at 0.1 s, the others up to 40 ms either side (the transient often late, as when
    // dropped by hand), each at its own level
    const base = ROLES.map((r, k) => ({ offset: k === 0 ? 0.1 : Math.max(0, 0.1 + (R() * 2 - 1) * 0.04 + (r === "transient" ? 0.015 : 0)), gain: 0 }));
    const parts = docs.map((doc, k) => ({ doc, offset: base[k].offset, gain: base[k].gain }));
    const arrs = [{ kind: "baseline", parts: base }];
    const searches = {};
    for (const goal of GOAL_NAMES) {
      const a = P.arrange(parts, { goal, seed: 7 + s, count: 3 });
      searches[goal] = { ms: a.ms, evaluated: a.evaluated, locked: a.locked, baseline: a.baseline.score, best: a.candidates.length ? a.candidates[0].score : null };
      a.candidates.forEach((c, i) => arrs.push({ kind: goal + (i + 1), goal, parts: c.parts, searchScore: c.score }));
    }
    const locked = searches.punch.locked;
    for (let i = 0; i < 12; i++) arrs.push({ kind: "random", parts: base.map((p, k) => locked.includes(k) ? { ...p } : { offset: Math.max(0, Math.round((p.offset + (R() * 2 - 1) * 0.25) * 1000) / 1000), gain: Math.round((-6 + 9 * R()) * 2) / 2 }) });
    for (const a of arrs) {
      a.predicted = P.measureParts(docs.map((doc, k) => ({ doc, offset: a.parts[k].offset, gain: a.parts[k].gain })));
      const m = mix(clips, a.parts), tm = Date.now(), md = await P.analyze({ sampleRate: SR, channels: [m.y] }, OPTS);
      a.analyseMs = Date.now() - tm;
      const rm = P.measureParts([{ doc: md, offset: 0, gain: 0 }]);
      // the bus gain that kept the mix from clipping lowers every level equally; peak level is compared before it
      rm.peakLufs = r3(rm.peakLufs - 20 * Math.log10(m.scale));
      for (const k of ["together", "overlap", "shared"]) rm[k] = a.predicted[k];
      a.rendered = rm;
      const pk = rm.peakTime;
      a.onsetsAtPeak = (md.onsets || []).filter(t => t >= pk - 0.08 && t <= pk + 0.02).length;
      a.scores = Object.fromEntries(GOAL_NAMES.map(g => [g, { predicted: r3(scoreFrom(a.predicted, g)), rendered: r3(scoreFrom(rm, g)) }]));
    }
    sessions.push({ kit, base, searches, arrangements: arrs.map(a => ({ kind: a.kind, parts: a.parts, predicted: a.predicted, rendered: a.rendered, scores: a.scores, onsetsAtPeak: a.onsetsAtPeak, analyseMs: a.analyseMs })) });
    process.stderr.write("session " + (s + 1) + "/" + KITS.length + " (" + kit.sub + " + " + kit.body + ")\n");
  }

  // measures of the whole: predicted against rendered, over every arrangement of every session
  const all = sessions.flatMap(s => s.arrangements);
  const measures = {};
  for (const k of WHOLE) {
    const pr = [], re = [];
    for (const a of all) if (a.predicted[k] != null && a.rendered[k] != null) { pr.push(a.predicted[k]); re.push(a.rendered[k]); }
    measures[k] = { n: pr.length, r: r3(pearson(pr, re)), mae: r3(pr.reduce((s, v, i) => s + Math.abs(v - re[i]), 0) / pr.length), predicted: [r3(Math.min(...pr)), r3(Math.max(...pr))], rendered: [r3(Math.min(...re)), r3(Math.max(...re))] };
  }
  // scores: rank agreement per session, and the best candidate against the rough placement
  const goals = {};
  for (const g of GOAL_NAMES) {
    const rho = sessions.map(s => spearman(s.arrangements.map(a => a.scores[g].predicted), s.arrangements.map(a => a.scores[g].rendered)));
    const wins = sessions.map(s => { const b = s.arrangements[0], c = s.arrangements.find(a => a.kind === g + "1"); return c ? { predicted: c.scores[g].predicted - b.scores[g].predicted, rendered: c.scores[g].rendered - b.scores[g].rendered } : null; }).filter(Boolean);
    goals[g] = { spearman: { median: r3(median(rho)), range: range(rho).map(r3) }, bestBeatsBaseline: { predicted: wins.filter(w => w.predicted > 0).length, rendered: wins.filter(w => w.rendered > 0).length, of: wins.length },
      gain: { predicted: r3(median(wins.map(w => w.predicted))), rendered: r3(median(wins.map(w => w.rendered))) } };
  }
  const flam = kind => { const v = all.filter(a => kind(a.kind)).map(a => a.onsetsAtPeak); return { mean: r3(v.reduce((s, x) => s + x, 0) / v.length), single: v.filter(x => x <= 1).length, of: v.length }; };
  const onsetsAtPeak = { baseline: flam(k => k === "baseline"), punch: flam(k => /^punch/.test(k)), big: flam(k => /^big/.test(k)), clean: flam(k => /^clean/.test(k)), random: flam(k => k === "random") };
  const timing = { searchMs: median(sessions.flatMap(s => GOAL_NAMES.map(g => s.searches[g].ms))), evaluated: median(sessions.flatMap(s => GOAL_NAMES.map(g => s.searches[g].evaluated))), analyseMixMs: median(all.map(a => a.analyseMs)) };
  const out = { generator: "experiments/arrange/arrange.js, Playhead " + P.version, sessions: sessions.length, arrangements: all.length, measures, goals, onsetsAtPeak, timing, runSeconds: Math.round((Date.now() - t0) / 1000), detail: sessions };
  // the summary indented, each arrangement of the detail on one line
  const rows = [], text = JSON.stringify(out, (k, v) => (v && v.kind && v.predicted ? (rows.push(JSON.stringify(v)), "@@" + (rows.length - 1)) : v), 1).replace(/"@@(\d+)"/g, (m, i) => rows[+i]);
  fs.writeFileSync(path.join(__dirname, "results.json"), text + "\n");

  console.log("Measures of the whole, predicted from the parts vs measured on the rendered mix (" + all.length + " arrangements, " + sessions.length + " sessions)");
  console.log("measure     r      MAE     predicted range      rendered range");
  for (const k of WHOLE) { const m = measures[k]; console.log(k.padEnd(10), String(m.r).padEnd(6), String(m.mae).padEnd(7), JSON.stringify(m.predicted).padEnd(20), JSON.stringify(m.rendered)); }
  console.log("\nScores: Spearman per session (median [range]); best candidate beats the rough placement (predicted / rendered); median gain");
  for (const g of GOAL_NAMES) { const q = goals[g]; console.log(g.padEnd(6), q.spearman.median, JSON.stringify(q.spearman.range), "  ", q.bestBeatsBaseline.predicted + "/" + q.bestBeatsBaseline.of, "/", q.bestBeatsBaseline.rendered + "/" + q.bestBeatsBaseline.of, "  +" + q.gain.predicted, "/ +" + q.gain.rendered); }
  console.log("\nOnsets in the rendered mix within -80..+20 ms of its peak (mean; arrangements with one or none)");
  for (const [k, v] of Object.entries(onsetsAtPeak)) console.log(k.padEnd(9), v.mean, v.single + "/" + v.of);
  console.log("\nsearch " + timing.searchMs + " ms (" + timing.evaluated + " arrangements); analysing one mix " + timing.analyseMixMs + " ms; run " + out.runSeconds + " s");
})().catch(e => { console.error(e); process.exit(1); });
