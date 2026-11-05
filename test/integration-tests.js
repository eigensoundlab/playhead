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
  // looks: the automatic look and its explicit code draw the same; codes round-trip; every look draws with a legend
  const logOf = (doc, opts) => { const log = []; const c = new Proxy({ canvas: { width: 500, height: 80 } }, { get: (t, k) => k in t ? t[k] : (...a) => { log.push(k + JSON.stringify(a)); }, set: (t, k, v) => { log.push(k + "=" + JSON.stringify(v)); return true; } }); const r = Playhead.drawStrip(c, doc, opts); return { log: log.join("\n"), r }; };
  const same = logOf(m, {}).log === logOf(m, { look: "wave:activity,sections,line:tension,ticks:downbeats+events" }).log && logOf(g1, {}).log === logOf(g1, { look: "wave:harshness,sections,line:activity,ticks:downbeats+events" }).log;
  const codes = Object.values(Playhead.looks).filter(L => L.code);
  const trip = codes.every(L => Playhead.lookCode(Playhead.parseLook(L.code)) === L.code) && Playhead.lookCode(Playhead.parseLook("wave:loudness,bogus,lane:activity~signed,ticks:events+nope")) === "wave:loudness,lane:activity~signed,ticks:events";
  const drawn = [m, g1].every(d => Object.keys(Playhead.looks).every(k => { const o = logOf(d, { look: k }); return o.log.length > 0 && typeof o.r.legend === "string" && o.r.legend.length > 0; }));
  const missing = logOf(g1, { look: "structure" }).r.legend.includes("not in this analysis");
  check("looks: automatic look = its code, codes round-trip, every look draws with a legend", codes.length + " looks", same && trip && drawn && missing);
  const nov = m.curves.structureNovelty, pulse = m.curves.localPulse;
  check("api: music documents carry structural change and local pulse", Math.max(...nov).toFixed(2) + " / " + Math.max(...pulse).toFixed(2),
    nov.length === m.curves.loudness.length && pulse.length === nov.length && nov.every(v => v >= 0 && v <= 1) && Math.max(...pulse) > 0.5 && g1.curves.structureNovelty === undefined);
  // a change into silence is drawn below the lane's midline, a change into sound above it: a break never reads as "more"
  const stepDoc = up => { const rate = 20, n = 200, lo = Array.from({ length: n }, (_, i) => (i < 100) === up ? 0.05 : 0.9), nv = Array.from({ length: n }, (_, i) => Math.exp(-Math.pow((i - 100) / 6, 2)));
    return { profile: "music", source: { duration: 10 }, curves: { rate, loudness: lo, structureNovelty: nv }, wave: { columns: 10, min: Array(10).fill(-0.5), max: Array(10).fill(0.5) }, events: null, sections: null, rhythm: null }; };
  const bars = doc => { const out = []; let style = null; const c = new Proxy({ canvas: { width: 200, height: 100 } }, { get: (t, k) => k in t ? t[k] : (...a) => { if (k === "fillRect" && a[0] >= 95 && a[0] <= 105 && a[1] >= 72) out.push({ y: a[1], h: a[3], style }); }, set: (t, k, v) => { if (k === "fillStyle") style = v; return true; } });
    Playhead.drawStrip(c, doc, { layers: "wave,lane:structureNovelty~signed", theme: { lane: "UP", laneDown: "DOWN" } }); return out; };
  const intoSound = bars(stepDoc(true)), intoSilence = bars(stepDoc(false)), mid = 72 + 1 + (100 - 72 - 1) / 2;
  check("looks: signed change lane: up into sound, down into silence", `${intoSound.length} / ${intoSilence.length} columns`,
    intoSound.length > 0 && intoSilence.length > 0 && intoSound.every(b => b.style === "UP" && b.y + b.h <= mid + 0.01) && intoSilence.every(b => b.style === "DOWN" && b.y >= mid - 0.01));
  // spectrogram layer: a compact mel spectrogram in the document, drawn as one cell per band and column without a canvas
  const sp = g1.spectrum, cells = sp ? sp.columns * sp.bands : 0;
  let rects = 0; const rc = new Proxy({ canvas: { width: 300, height: 80 } }, { get: (t, k) => k in t ? t[k] : (...a) => { if (k === "fillRect") rects++; }, set: () => true });
  const rs = Playhead.drawStrip(rc, g1, { look: "spectrum" });
  check("api: documents carry a mel spectrogram; the spectrogram layer draws it", sp ? `${sp.bands} bands x ${sp.columns} columns, ${(sp.data.length / 1024).toFixed(1)} KB` : "none",
    !!sp && sp.bands === 40 && sp.columns === cols && sp.data.length === Math.ceil(cells / 3) * 4 && rects === cells && rs.legend.startsWith("spectrogram") && f.spectrum === undefined && m.spectrum.columns === m.curves.loudness.length);
  // forms and shapes: overlaid curves stay in the waveform's band, stacked ones get their own; without a waveform they fill the strip
  const boxes = (doc, look, all) => { const out = []; let a = 1; const c = new Proxy({ canvas: { width: 200, height: 100 } }, { get: (t, k) => k in t ? t[k] : (...args) => { if (k === "fillRect" && (all || a < 1)) out.push(args); }, set: (t, k, v) => { if (k === "globalAlpha") a = v; return true; } }); Playhead.drawStrip(c, doc, { look }); return out; };
  const ov = boxes(g1, "form:overlay,shape:mirror,wave,lane:activity"), st = boxes(g1, "shape:horizon,wave,lane:activity"), only = boxes(g1, "shape:mirror,lane:activity", true);
  const mirrored = only.length > 50 && only.every(([x, y, w, h]) => Math.abs((y + h / 2) - 50) < 0.6);
  check("looks: forms and shapes (overlay in the waveform band, horizon under it, mirrored around the middle)", `${ov.length} / ${st.length} / ${only.length} columns`,
    ov.length > 0 && ov.every(([x, y, w, h]) => y >= 0 && y + h <= 100) && st.length > 0 && st.every(([x, y]) => y >= 72) && mirrored
    && Playhead.lookCode(Playhead.parseLook("shape:mirror,form:overlay,spec,wave,lane:loudness")) === "shape:mirror,form:overlay,spec,wave,lane:loudness" && Playhead.parseLook("shape:wobbly,form:sideways").length === 0);
  // novelty marks, the peak outline, a waveform sculpted by a curve, and which looks fit a document
  const sculpted = (() => { const d = JSON.parse(JSON.stringify(g1)); d.curves.loudness = d.curves.loudness.map(v => v == null ? null : 0.5); const rows = []; let st = null;
    const c = new Proxy({ canvas: { width: 300, height: 100 } }, { get: (t, k) => k in t ? t[k] : (...a) => { if (k === "fillRect" && st !== "#fff") rows.push(a); }, set: (t, k, v) => { if (k === "fillStyle") st = v; return true; } });
    Playhead.drawStrip(c, d, { look: "sculpt:loudness,wave" }); return rows; })();
  const tallest = Math.max(...sculpted.map(([x, y, w, h]) => h)), half = 50 - 1;
  let strokes = 0; const oc = new Proxy({ canvas: { width: 300, height: 60 } }, { get: (t, k) => k in t ? t[k] : (...a) => { if (k === "stroke") strokes++; }, set: () => true });
  const or = Playhead.drawStrip(oc, g1, { look: "lane:activity,outline" });
  const fits = Playhead.lookFits(m, "structure") && !Playhead.lookFits(g1, "structure") && Playhead.lookFits(g1, "events") && Playhead.lookFits(g1, "spectrum") && !Playhead.lookFits(f, "spectrum");
  check("looks: novelty marks, outline, sculpted waveform, lookFits", `${m.noveltyTicks.length} novelty marks; sculpted peak ${(tallest / 2 / half).toFixed(2)} of full`,
    m.noveltyTicks.length > 0 && Array.isArray(g1.noveltyTicks) && strokes === 2 && or.legend.includes("outline") && Math.abs(tallest / 2 / half - 0.5) < 0.03 && fits
    && Playhead.lookCode(Playhead.parseLook("sculpt:loudness,wave:harshness,outline,ticks:events+novelty")) === "sculpt:loudness,wave:harshness,outline,ticks:events+novelty");
  const fa = await Playhead.fromAnalysis(await WL.analyse(glass), glass, { name: "glass" });
  check("api: fromAnalysis gives the analyze() document", "", JSON.stringify(strip(fa)) === JSON.stringify(strip(g1)));
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
