// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Tests of the public API (src/playhead.js), the library bundles (dist/) and the command line.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const WL = require("../src/analysis.js"), P = require("../src/probes.js"), IO = require("../tools/audio-io.js");
require("../src/descriptors.js"); require("../src/effects.js");
const Playhead = require("../src/playhead.js");
const root = path.join(__dirname, "..");
const strip = d => { const c = JSON.parse(JSON.stringify(d)); delete c.timing; return c; };

module.exports = async function (check) {
  const sr = 44100, kit = P.makeSfxKit(sr, WL.kFilterCoeffs), glass = kit.find(b => b.name.includes("Glass")), arc = P.makeCueArc(sr, WL.kFilterCoeffs);
  const g1 = await Playhead.analyze(glass, { name: "glass" }), g2 = await Playhead.analyze(glass, { name: "glass" });
  const json = JSON.stringify(g1), back = JSON.parse(json);
  const plain = JSON.stringify(back) === json && !/NaN|Infinity/.test(json);
  check("api: sfx document is plain JSON and deterministic", (json.length / 1024).toFixed(0) + " KB",
    plain && JSON.stringify(strip(g1)) === JSON.stringify(strip(g2)) && g1.schema === "playhead-analysis" && g1.schemaVersion === 1);
  const cols = Math.round(g1.source.duration * 100);
  check("api: sfx profile has curves, events, tags, layers, descriptors", `${g1.profile}, ${g1.events.length} events, ${g1.layers.length} layers`,
    g1.profile === "sfx" && g1.curves.loudness.length === cols && g1.curves.n6Arrow.length === cols && g1.events.length > 0 && g1.events.every(e => typeof e.tag === "string") && g1.descriptors && g1.wave.min.length === 1000 && g1.rhythm === null);
  const m = await Playhead.analyze(arc, { name: "cue arc" });
  check("api: music profile has beats and sections", `${m.rhythm.tempo} BPM, ${m.sections.map(s => s.label).join("")}`,
    m.profile === "music" && Math.abs(m.rhythm.tempo - 120) < 1.5 && m.sections.length >= 6 && m.curves.loudness.length === Math.round(64 * 20));
  const f = await Playhead.analyze(glass, { profile: "fast" });
  check("api: fast profile skips events and descriptors", f.timing.ms + " ms", f.profile === "fast" && f.events === null && f.descriptors === null && f.curves.loudness.length === cols);
  const marks = Playhead.toMarkers(m, { kinds: ["sections", "downbeats"] });
  check("api: markers from sections and downbeats", marks.length + " markers", marks.filter(x => x.kind === "region").length === m.sections.length && marks.some(x => x.name === "bar 1") && marks.every((x, i) => !i || x.start >= marks[i - 1].start));
  const t = 30.0, c = m.curves.tension, i = Math.floor(t * m.curves.rate - 0.5);
  check("api: curveAt interpolates curves for modulation", Playhead.curveAt(m, "tension", t).toFixed(3),
    Math.abs(Playhead.curveAt(m, "tension", t) - (c[i] + (c[i + 1] - c[i]) * (t * m.curves.rate - 0.5 - i))) < 1e-9 && Playhead.curveAt(m, "nope", 1, 7) === 7);
  // renderer on a recording context (no canvas needed)
  const calls = {}; const ctx = new Proxy({ canvas: { width: 400, height: 48 } }, { get: (t, k) => k in t ? t[k] : (calls[k] = (calls[k] || 0), (...a) => { calls[k]++; }), set: (t, k, v) => { t[k] = v; return true; } });
  let drew = true; try { Playhead.drawStrip(ctx, m, {}); Playhead.drawStrip(ctx, g1, { from: 0.1, to: 0.5, curve: "n1Kurtosis", colour: null }); } catch (e) { drew = false; }
  check("api: strip renderer draws on any 2D context", (calls.fillRect || 0) + " columns", drew && calls.fillRect >= 800 && calls.stroke > 0);
  const pr = await Playhead.process(glass, "layers", { gains: [-12] });
  check("api: process() runs a tool and returns channels", pr.outputs.map(o => o.suffix).join(", "), pr.outputs.length === 1 && pr.outputs[0].channels[0].length === glass.length && pr.report.length > 0);
  // bundles give the same document as the sources
  spawnSync(process.execPath, [path.join(root, "tools/build.js"), "--dist"], { encoding: "utf8" });
  const umd = require(path.join(root, "dist/playhead-core.js"));
  const u = await umd.analyze(glass, { name: "glass" });
  const leaked = ["WLFX", "Playhead"].filter(k => globalThis[k] && globalThis[k] !== Playhead && k === "Playhead");
  check("dist: UMD bundle gives the same document", umd.version, JSON.stringify(strip(u)) === JSON.stringify(strip(g1)) && !leaked.length);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playhead-test-")), wav = path.join(tmp, "glass.wav");
  IO.writeWav(wav, glass, true);
  const esm = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import P from ${JSON.stringify(path.join(root, "dist/playhead-core.mjs"))}; import { createRequire } from "module"; const r = createRequire(${JSON.stringify(path.join(root, "test/x.js"))});
     const IO = r("../tools/audio-io.js"); const d = await P.analyze(IO.readAudio(${JSON.stringify(wav)}), { name: "glass" }); console.log(JSON.stringify({ p: d.profile, e: d.events.length, g: ["WL", "PHD", "WLFX", "Playhead"].filter(k => k in globalThis) }));`], { encoding: "utf8" });
  let ej = null; try { ej = JSON.parse(esm.stdout.trim()); } catch (e) { }
  check("dist: ES module bundle works and leaks no globals", ej ? `${ej.p}, ${ej.e} events, globals: ${ej.g.join(",") || "none"}` : (esm.stderr || "").slice(0, 120), !!ej && ej.p === "sfx" && ej.e === g1.events.length && !ej.g.length);
  // command line, from the sources and from the one-file bundle
  const cli = spawnSync(process.execPath, [path.join(root, "tools/playhead-cli.js"), "analyze", wav], { encoding: "utf8", maxBuffer: 1 << 26 });
  let cj = null; try { cj = JSON.parse(cli.stdout); } catch (e) { }
  const mk = spawnSync(process.execPath, [path.join(root, "dist/playhead-cli.cjs"), "markers", wav, "--kinds", "events"], { encoding: "utf8" });
  check("cli: analyze prints the document, bundled markers print TSV", cj ? `${cj.events.length} events; ${mk.stdout.split("\n").length - 2} marker lines` : (cli.stderr || "").slice(0, 120),
    !!cj && cj.schema === "playhead-analysis" && cj.events.length === g1.events.length && mk.stdout.startsWith("kind\tstart\tend\tname") && mk.stdout.split("\n").length - 2 === g1.events.length);
  const raw = Buffer.alloc(glass.length * 8); for (let k = 0; k < glass.length; k++) { raw.writeFloatLE(glass.getChannelData(0)[k], k * 8); raw.writeFloatLE(glass.getChannelData(1)[k], k * 8 + 4); }
  const sin = spawnSync(process.execPath, [path.join(root, "tools/playhead-cli.js"), "analyze", "-", "--sr", "44100", "--channels", "2", "--fill-null", "0"], { input: raw, encoding: "utf8", maxBuffer: 1 << 26 });
  let sj = null; try { sj = JSON.parse(sin.stdout); } catch (e) { }
  check("cli: raw samples on stdin, nulls filled for engines", sj ? `${sj.events.length} events, ${sj.curves.loudness.filter(v => v === null).length} nulls` : (sin.stderr || "").slice(0, 120),
    !!sj && sj.events.length === g1.events.length && sj.curves.loudness.every(v => v !== null));
  fs.rmSync(tmp, { recursive: true, force: true });
};
