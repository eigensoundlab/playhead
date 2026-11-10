#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Writes the test fixtures for the REAPER scripts (run by run_tests.py --update-fixtures, or directly):
//   fixtures/robot-hit-steel.playhead.json   `playhead analyze` of experiments/paper/robot-hit-steel.wav (sfx profile)
//   fixtures/cue-arc.playhead.json           `playhead analyze` of the built-in cue arc (music profile, 400 wave columns)
//   fixtures/tools.json                      `playhead tools`
//   fixtures/reference.json                  what src/playhead.js computes from them (curveAt, toMarkers, looks, the
//                                            rectangles, triangles and texts drawStrip draws, and the views as
//                                            numbers), for the Lua port
// The documents come from the command line itself; only source.path is made relative and timing set to 0, so the
// files do not depend on the machine that wrote them.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const root = path.join(__dirname, "..", "..", "..");
const WL = require(path.join(root, "src/analysis.js")), P = require(path.join(root, "src/probes.js")), IO = require(path.join(root, "tools/audio-io.js"));
require(path.join(root, "src/descriptors.js"));
const Playhead = require(path.join(root, "src/playhead.js"));
const outDir = path.join(__dirname, "fixtures");
fs.mkdirSync(outDir, { recursive: true });

function cli(args) {
  const r = spawnSync(process.execPath, [path.join(root, "tools/playhead-cli.js"), ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error("playhead " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}
function tidy(text, rel) {
  const doc = JSON.parse(text);
  doc.source.path = rel;
  doc.timing = { ms: 0 };
  return doc;
}

const robot = tidy(cli(["analyze", path.join(root, "experiments/paper/robot-hit-steel.wav"), "--profile", "sfx"]), "experiments/paper/robot-hit-steel.wav");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playhead-reaper-fixtures-"));
const arcWav = path.join(tmp, "cue-arc.wav");
IO.writeWav(arcWav, P.makeCueArc(44100, WL.kFilterCoeffs), false);
const arc = tidy(cli(["analyze", arcWav, "--profile", "music", "--wave-columns", "400"]), "cue-arc.wav");
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(outDir, "robot-hit-steel.playhead.json"), JSON.stringify(robot) + "\n");
fs.writeFileSync(path.join(outDir, "cue-arc.playhead.json"), JSON.stringify(arc) + "\n");
fs.writeFileSync(path.join(outDir, "tools.json"), cli(["tools"]));

// what drawStrip draws, from a recording 2D context: rectangles (with fill and alpha), filled triangles, texts
const colour = s => {
  s = String(s);
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).join(",");
  m = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(s.replace(/\s/g, ""));
  return m ? [m[1], m[2], m[3]].join(",") : s;
};
const fillAlpha = s => { const m = /^rgba\(\d+,\d+,\d+,([\d.]+)\)$/.exec(String(s).replace(/\s/g, "")); return m ? +m[1] : 1; };
const r4 = v => Math.round(v * 1e4) / 1e4;
function drawOps(doc, look, W, H, from, to) {
  const ops = { rects: [], triangles: [], texts: [] };
  let fill = null, alpha = 1, path = [];
  const ctx = new Proxy({ canvas: { width: W, height: H } }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === "fillRect") return (x, y, w, h) => ops.rects.push([r4(x), r4(y), r4(w), r4(h), colour(fill), r4(alpha * fillAlpha(fill))]);
      if (k === "beginPath") return () => { path = []; };
      if (k === "moveTo" || k === "lineTo") return (x, y) => path.push([r4(x), r4(y)]);
      if (k === "fill") return () => { if (path.length === 3) ops.triangles.push(path.flat()); };
      if (k === "fillText") return (s, x, y) => ops.texts.push([String(s), r4(x), r4(y)]);
      return () => { };
    },
    set: (t, k, v) => { if (k === "fillStyle") fill = v; else if (k === "globalAlpha") alpha = v; return true; }
  });
  const r = Playhead.drawStrip(ctx, doc, { look, width: W, height: H, from, to });
  return { code: r.code, legend: r.legend, ops, raster: r.raster ? r.raster.rows : null };
}
// the views are images (or a rectangle per cell and pixel column without a canvas), which the Lua port draws as runs
// of rectangles: they are compared at points, every 4th pixel across and every 3rd down: the colour and alpha of the
// last rectangle drawn over the point ("" where none is)
const PROBE = { dx: 4, dy: 3 };
// (as indices into a palette, to keep the file small)
function probes(rects, W, H) {
  const palette = [""], idx = [];
  for (let y = 0.5; y < H; y += PROBE.dy) for (let x = 0.5; x < W; x += PROBE.dx) {
    let hit = "";
    for (const q of rects) if (x >= q[0] && x < q[0] + q[2] && y >= q[1] && y < q[1] + q[3]) hit = q[4] + "," + q[5];
    let k = palette.indexOf(hit); if (k < 0) { k = palette.length; palette.push(hit); }
    idx.push(k);
  }
  return { palette, idx };
}
function viewOps(doc, look, W, H, from, to) {
  const d = drawOps(doc, look, W, H, from, to);
  return { code: d.code, legend: d.legend, probes: probes(d.ops.rects, W, H), texts: d.ops.texts, triangles: d.ops.triangles, raster: d.raster };
}
// a view as numbers: its size, axis, columns at given times, raster rows, and its values at 64 places and summed
function viewNumbers(doc, kind, opts) {
  const v = Playhead.view(doc, kind, opts);
  if (!v) return null;
  const n = v.rows * v.cols, at = [], d = doc.source.duration;
  for (let i = 0; i < 64; i++) { const k = Math.floor(i * (n - 1) / 63); at.push([k, r4(v.values[k])]); }
  let sum = 0, none = 0; for (const x of v.values) { if (x < 0) none++; else sum += x; }
  const out = { kind, opts, rows: v.rows, cols: v.cols, sum: Math.round(sum * 1e3) / 1e3, none, at, yTicks: v.yTicks.map(t => [r4(t.row), t.text]) };
  if (v.colAt) out.colAt = [0, 0.37, d / 3, d / 2, d - 0.01, d + 1].map(t => [t, v.colAt(t)]);
  if (v.timeRows) { out.timeRows = v.timeRows.map(r => r.map(r4)); out.beatsPerBar = v.beatsPerBar; }
  if (v.faint) { let f = 0; for (const x of v.faint) f += x; out.faint = f; }
  if (v.rgb) { let t = 0; for (const x of v.rgb) t += x; out.rgb = t; }
  return out;
}

function reference(doc) {
  const ref = { curveAt: [], markers: Playhead.toMarkers(doc, { kinds: ["sections", "events", "downbeats", "onsets"] }), looks: {} };
  const d = doc.source.duration;
  for (const name of ["loudness", "harshness", "tension", "lufs", "n1Kurtosis", "onsetStrength", "localPulse", "structureNovelty"]) {
    if (!doc.curves[name]) continue;
    for (const t of [0, 0.004, 0.013, 0.5, d / 3, d / 2 + 0.0071, d - 0.01, d + 1]) ref.curveAt.push({ name, t, v: Playhead.curveAt(doc, name, t, -1) });
  }
  for (const key of Object.keys(Playhead.looks)) {
    const L = Playhead.looks[key];
    // the views of rhythm and form (bar raster, tempogram, lag view, modulation, scalogram): compared at points
    if (L.code && /(^|,)(raster|scalogram)|spec:/.test(L.code)) {
      const small = viewOps(doc, key, 160, 60), tall = viewOps(doc, key, 240, 100);
      ref.looks[key] = { fits: Playhead.lookFits(doc, key), code: small.code, legend: small.legend, roundTrip: Playhead.lookCode(Playhead.parseLook(L.code)),
        views: { "160x60": small, "240x100": tall } };
      continue;
    }
    const small = drawOps(doc, key, 160, 60), tall = drawOps(doc, key, 120, 100);
    // the spectrogram is drawn as an image (or one rectangle per cell without a canvas), which the Lua port draws
    // differently, so its rectangles are not kept
    const spec = /(^|,)spec(,|$)/.test(small.code);
    ref.looks[key] = { fits: Playhead.lookFits(doc, key), code: small.code, legend: small.legend, roundTrip: L.code ? Playhead.lookCode(Playhead.parseLook(L.code)) : null,
      ops: spec ? null : { "160x60": small.ops, "120x100": tall.ops } };
  }
  // zoomed: the middle third of the sound
  ref.zoom = { from: d / 3, to: 2 * d / 3, ops: (() => { const ops = { rects: [], triangles: [], texts: [] }; let fill = null, alpha = 1, p = [];
    const ctx = new Proxy({ canvas: { width: 200, height: 70 } }, { get: (t, k) => k in t ? t[k] : k === "fillRect" ? (x, y, w, h) => ops.rects.push([r4(x), r4(y), r4(w), r4(h), colour(fill), r4(alpha)]) : k === "beginPath" ? () => { p = []; } : (k === "moveTo" || k === "lineTo") ? (x, y) => p.push([r4(x), r4(y)]) : k === "fill" ? () => { if (p.length === 3) ops.triangles.push(p.flat()); } : k === "fillText" ? (s, x, y) => ops.texts.push([String(s), r4(x), r4(y)]) : () => { },
      set: (t, k, v) => { if (k === "fillStyle") fill = v; else if (k === "globalAlpha") alpha = v; return true; } });
    Playhead.drawStrip(ctx, doc, { look: "wave:harshness,lane:activity~signed,lane:loudness,ticks:events+onsets+novelty", width: 200, height: 70, from: d / 3, to: 2 * d / 3 }); return ops; })() };
  // the views as numbers, and zoomed and folded
  ref.views = [["raster", {}], ["raster", { curve: "loudness", bars: 4 }], ["tempo", {}], ["tempo", { cyclic: true }], ["lag", {}], ["mod", {}],
    ["scale", { curve: "loudness" }], ["scale", { curve: "onsetStrength" }], ["raster", { curve: "spectrum" }], ["raster", { curve: "spectrum", attacks: true, bars: 4 }],
    ["metric", {}]].map(([k, o]) => viewNumbers(doc, k, o) || { kind: k, opts: o, none: "view" });
  ref.viewZoom = ["raster:onsetStrength~4bars,sections,ticks:onsets+events+novelty", "spec:tempo~cyclic,lane:localPulse,ticks:downbeats", "scalogram:loudness,sections"]
    .map(look => ({ look, ...viewOps(doc, look, 220, 90, d / 3, 2 * d / 3) }));
  return ref;
}
const ref = { generator: "src/playhead.js " + Playhead.version, probe: PROBE, robot: reference(robot), arc: reference(arc),
  parse: ["wave:loudness,bogus,lane:activity~signed,ticks:events+nope", "shape:mirror,form:overlay,spec,wave,lane:loudness", "shape:wobbly,form:sideways", " wave , line:tension ,ticks:", "structure"]
    .map(code => ({ code, out: Playhead.lookCode(Playhead.parseLook(code) || []) }))
    .concat(["spec:tempo~cyclic,ticks:downbeats", "raster~4bars,sections", "raster:loudness,spec:mel", "wave:harshness,spec:mod,spec:bogus",
      "spec:lag,scalogram,scalogram:loudness~x,lane:activity", "tempogram", "rhythms"].map(code => ({ code, out: Playhead.lookCode(Playhead.parseLook(code) || []) }))) };
// levels (src/levels.js): the measures of the two documents as entries, synthetic entries for the limits and the
// fallbacks, and the gains under two specs, for the Lua port (core.levels_gain)
const LV = require(path.join(root, "src/levels.js"));
const lvEntries = [
  { from: "robot", path: "sfx/GUNShotgn_Robot hit.wav", tags: ["Weapons/Shotguns/Pump", "subtle"] },
  { from: "arc", path: "Explosions/arc.wav", tags: ["Explosions", "Weapons", "hero"] }
].map(o => Object.assign({ from: o.from }, LV.entryOf(o.from === "robot" ? robot : arc, { path: o.path, tags: o.tags })))
  .concat([{ path: "Nature/brook.wav", tags: ["Nature", "folder:Nature"], measures: { integrated: -40, peak: -30 }, trim: 1.5 },
    { path: "quiet.wav", tags: [], measures: { momentaryMax: -50, truePeak: -45 } },
    { path: "Explosions/silent.wav", tags: ["Explosions"], measures: {} }]);
const lvSpecs = [
  { levels: { measure: "momentaryMax@event", target: -18 }, rules: [] },
  { levels: { measure: "integrated", target: -20, amount: 0.5, depth: 1.5, limits: { boost: 6, cut: 10, truePeak: -2 } }, rules: [
    { tag: "Weapons/Shotguns", role: "group", offset: 3 }, { tag: "Weapons", role: "group", offset: 2 },
    { tag: "Explosions", role: "group", offset: 4, measure: "shortTermMax@active" }, { tag: "subtle", role: "modifier", offset: -4 },
    { tag: "hero", role: "modifier", offset: 2, on: false }, { tag: "Nature", role: "note" }, { tag: "class:impulse", role: "modifier", offset: 1 }] }
];
ref.levels = { entries: lvEntries, cases: lvSpecs.map(spec => ({ spec, gains: lvEntries.map(e => {
  const g = LV.gainOf(spec, e);
  return { gain: g.gain, wanted: g.wanted, used: g.used, group: g.group, limitedBy: g.limitedBy, offset: g.offset, modifiers: g.modifiers, notes: g.notes };
}) })) };
fs.writeFileSync(path.join(outDir, "reference.json"), JSON.stringify(ref) + "\n");
console.log("fixtures written to " + outDir);
