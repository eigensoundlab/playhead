#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Writes the test fixtures for the REAPER scripts (run by run_tests.py --update-fixtures, or directly):
//   fixtures/robot-hit-steel.playhead.json   `playhead analyze` of experiments/paper/robot-hit-steel.wav (sfx profile)
//   fixtures/cue-arc.playhead.json           `playhead analyze` of the built-in cue arc (music profile, 400 wave columns)
//   fixtures/tools.json                      `playhead tools`
//   fixtures/reference.json                  what src/playhead.js computes from them (curveAt, toMarkers, looks, and
//                                            the rectangles, triangles and texts drawStrip draws), for the Lua port
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
  m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(s.replace(/\s/g, ""));
  return m ? [m[1], m[2], m[3]].join(",") : s;
};
const r4 = v => Math.round(v * 1e4) / 1e4;
function drawOps(doc, look, W, H) {
  const ops = { rects: [], triangles: [], texts: [] };
  let fill = null, alpha = 1, path = [];
  const ctx = new Proxy({ canvas: { width: W, height: H } }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === "fillRect") return (x, y, w, h) => ops.rects.push([r4(x), r4(y), r4(w), r4(h), colour(fill), r4(alpha)]);
      if (k === "beginPath") return () => { path = []; };
      if (k === "moveTo" || k === "lineTo") return (x, y) => path.push([r4(x), r4(y)]);
      if (k === "fill") return () => { if (path.length === 3) ops.triangles.push(path.flat()); };
      if (k === "fillText") return (s, x, y) => ops.texts.push([String(s), r4(x), r4(y)]);
      return () => { };
    },
    set: (t, k, v) => { if (k === "fillStyle") fill = v; else if (k === "globalAlpha") alpha = v; return true; }
  });
  const r = Playhead.drawStrip(ctx, doc, { look, width: W, height: H });
  return { code: r.code, legend: r.legend, ops };
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
    // the views of rhythm and form (bar raster, tempogram, lag view, scalogram) are not in the Lua port yet
    if (L.code && /(^|,)(raster|scalogram)|spec:/.test(L.code)) continue;
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
  return ref;
}
const ref = { generator: "src/playhead.js " + Playhead.version, robot: reference(robot), arc: reference(arc),
  parse: ["wave:loudness,bogus,lane:activity~signed,ticks:events+nope", "shape:mirror,form:overlay,spec,wave,lane:loudness", "shape:wobbly,form:sideways", " wave , line:tension ,ticks:", "structure"]
    .map(code => ({ code, out: Playhead.lookCode(Playhead.parseLook(code) || []) })) };
fs.writeFileSync(path.join(outDir, "reference.json"), JSON.stringify(ref) + "\n");
console.log("fixtures written to " + outDir);
