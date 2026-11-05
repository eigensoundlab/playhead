// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead
//
// Public API for other applications. One call analyses a sound and returns a plain JSON document
// (schema "playhead-analysis", version 1) that can be stored, sent between processes or read by other tools.
//
//   const doc = await Playhead.analyze({ sampleRate, channels: [Float32Array, ...] }, { profile: "auto" });
//   Playhead.drawStrip(canvas.getContext("2d"), doc, { curve: "activity", colour: "harshness" });
//   const marks = Playhead.toMarkers(doc);
//   const v = Playhead.curveAt(doc, "tension", 12.5);                     // curves as modulators
//
// Profiles (what is computed):
//   fast   features, curves C1-C7, onsets, loudness summary, waveform overview. For browsing large libraries.
//   sfx    fast + events with Schaeffer-style tags, NMF layers, asset checks, cross-field descriptors N1-N9.
//   music  sfx + beats, downbeats and sections.
//   auto   sfx for sounds up to 10 s, music for longer ones.
//   const r = await Playhead.process(sound, "deharsh", { amount: 0.6 });   // the effects bench tools
// Depends on analysis.js (WL) and descriptors.js (PHD), and for process() on effects.js; loaded after them, or bundled in dist/.
(function (root) {
"use strict";
const WL = root.WL || (typeof require !== "undefined" ? require("./analysis.js") : null);
const PHD = root.PHD || (typeof require !== "undefined" ? require("./descriptors.js") : null);

const VERSION = "0.1.0";            // kept equal to package.json by the test suite
const SCHEMA = "playhead-analysis", SCHEMA_VERSION = 1;
const PROFILES = ["fast", "sfx", "music", "auto"];

/* ---------------- input ---------------- */
// Accepts an AudioBuffer (or anything with sampleRate, numberOfChannels, length, getChannelData), or
// { sampleRate, channels: [Float32Array, ...] }. Mono and stereo are analysed; further channels are ignored.
function toBuffer(input) {
  if (!input) throw new Error("Playhead.analyze: no audio");
  if (typeof input.getChannelData === "function") return input;
  const chs = (input.channels || []).map(c => c instanceof Float32Array ? c : Float32Array.from(c));
  if (!chs.length || !input.sampleRate) throw new Error("Playhead.analyze: expected { sampleRate, channels: [Float32Array, ...] }");
  const n = Math.min(...chs.map(c => c.length));
  return { sampleRate: input.sampleRate, numberOfChannels: chs.length, length: n, duration: n / input.sampleRate, getChannelData: i => chs[i] };
}

/* ---------------- JSON helpers ---------------- */
const rnd = (v, d) => (typeof v === "number" && isFinite(v)) ? Number(v.toFixed(d)) : null;
// plain JSON copy: typed arrays to arrays, NaN and Infinity to null, numbers rounded
function plain(v, d) {
  if (v == null) return null;
  if (typeof v === "number") return rnd(v, d);
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v, x => plain(x, d));
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k], d); return o; }
  return null;
}
// frame curve (one value per analysis frame) -> fixed-rate curve; silent columns become null
function resample(arr, F, cols, gate, mode) {
  const out = new Array(cols), n = F.nF;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * n / cols), b = Math.max(a + 1, Math.floor((c + 1) * n / cols));
    let s = 0, k = 0, mx = -Infinity;
    for (let m = a; m < b && m < n; m++) { const v = arr[m]; if (!isFinite(v) || (gate && !gate[m])) continue; s += v; k++; if (v > mx) mx = v; }
    out[c] = k ? rnd(mode === "max" ? mx : s / k, 4) : null;
  }
  return out;
}
function waveOverview(buf, cols) {
  const n = buf.length, chs = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
  const mn = new Array(cols), mx = new Array(cols), rms = new Array(cols);
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * n / cols), b = Math.max(a + 1, Math.floor((c + 1) * n / cols));
    let lo = 0, hi = 0, s = 0, k = 0;
    for (const ch of chs) for (let i = a; i < b && i < n; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; s += v * v; k++; }
    mn[c] = rnd(lo, 4); mx[c] = rnd(hi, 4); rms[c] = rnd(k ? Math.sqrt(s / k) : 0, 4);
  }
  return { columns: cols, min: mn, max: mx, rms };
}

/* ---------------- analysis ---------------- */
async function analyze(input, opts) {
  opts = opts || {};
  const t0 = Date.now(), buf = toBuffer(input);
  const profileIn = opts.profile || "auto";
  if (!PROFILES.includes(profileIn)) throw new Error("Playhead.analyze: unknown profile " + profileIn + " (" + PROFILES.join(", ") + ")");
  const prog = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const F = await WL.analyse(buf, p => prog(0.6 * p));
  return build(F, buf, opts, t0, prog);
}
/**
 * The document for a WL.analyse() result that already exists, without analysing again (the Playhead app uses it for
 * its composer). input: the same audio; opts as for analyze().
 */
async function fromAnalysis(F, input, opts) {
  opts = opts || {};
  if (!PROFILES.includes(opts.profile || "auto")) throw new Error("Playhead.fromAnalysis: unknown profile " + opts.profile);
  return build(F, toBuffer(input), opts, Date.now(), typeof opts.onProgress === "function" ? opts.onProgress : () => {});
}
async function build(F, buf, opts, t0, prog) {
  const profileIn = opts.profile || "auto";
  const profile = profileIn === "auto" ? (F.dur <= 10 ? "sfx" : "music") : profileIn;
  const cls = opts.assetClass || (profile === "sfx" && F.dur <= 10 ? "sfx" : F.guess);
  const cur = WL.computeCurves(F, cls, { scale: "fixed" });
  const rate = opts.curveRate || (F.dur <= 10 ? 100 : 20), cols = Math.max(1, Math.round(F.dur * rate));
  const g = cur.gate;
  const curves = {
    loudness: resample(cur.curves.c1, F, cols, g), activity: resample(cur.curves.c2, F, cols, g), arousal: resample(cur.curves.c3, F, cols, g),
    harshness: resample(cur.curves.c4, F, cols, g), tension: resample(cur.curves.c5, F, cols, g), harmonicTension: resample(cur.curves.c6, F, cols, g),
    surprise: resample(cur.curves.c7, F, cols, g), lufs: resample(cur.lufs, F, cols, g)
  };
  const ev = WL.eventsOf(F);
  const lufsSorted = []; for (let m = 0; m < F.nF; m++) if (g[m] && isFinite(cur.lufs[m])) lufsSorted.push(cur.lufs[m]);
  lufsSorted.sort((a, b) => a - b);
  const q = p => lufsSorted.length ? lufsSorted[Math.floor(p * (lufsSorted.length - 1))] : NaN;
  prog(0.65);
  const doc = {
    schema: SCHEMA, schemaVersion: SCHEMA_VERSION,
    generator: { name: "playhead", version: VERSION },
    source: { name: opts.name || null, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, duration: rnd(F.dur, 4) },
    profile, assetClass: cls, guessedClass: F.guess,
    summary: { peakLufs: rnd(ev.peakLufs, 2), loudnessRange: rnd(q(0.95) - q(0.1), 2), soundStart: rnd(ev.start, 4), soundEnd: rnd(ev.end60, 4) },
    curves: { rate: rnd(cols / F.dur, 6), start: 0, scale: "0..1 on fixed library-wide scales; lufs in LUFS; null where silent", ...curves },
    wave: waveOverview(buf, opts.waveColumns || 1000),
    onsets: ev.onsetTimes.map(t => rnd(t, 4)),
    rhythm: null, sections: null, events: null, layers: null, issues: null, descriptors: null
  };
  if (profile !== "fast") {
    const X = WL.sfxOf(F, buf, opts.name || "");
    prog(0.75);
    doc.summary.peakDb = rnd(X.pkDb, 2); doc.summary.attack = rnd(X.attack, 4);
    doc.events = X.events.map(e => ({ start: rnd(e.t0, 4), end: rnd(e.t1, 4), decayEnd: rnd(e.tEnd, 4), peak: rnd(e.peakT, 4), peakDb: rnd(e.peakDb, 2),
      tag: e.tag, word: e.word, facture: e.facture, mass: e.mass, direction: e.dir || null, f0: e.f0 ? rnd(e.f0, 1) : null, grains: e.grains.map(t => rnd(t, 4)) }));
    doc.layers = X.layers.map(l => ({ name: l.name, hz: rnd(l.hz, 1), share: rnd(l.share, 3), start: rnd(l.span[0], 4), end: rnd(l.span[1], 4) }));
    doc.issues = X.issues.filter(i => i.sev !== "ok").map(i => ({ severity: i.sev, text: i.text }));
    const D = await PHD.describe(F, buf);
    prog(0.9);
    Object.assign(doc.curves, {
      n1Kurtosis: resample(D.curves.kurt, F, cols, null, "max"), n2RepetitionHz: resample(D.curves.repHz, F, cols, null), n4Velocity: resample(D.curves.vel, F, cols, null),
      n5Cpp: resample(D.curves.cpp, F, cols, null), n5Coherence: resample(D.curves.pci, F, cols, null), n6Arrow: resample(D.curves.arrow, F, cols, null),
      n7Surprisal: resample(D.curves.surprisal, F, cols, null), n8Recurrence: resample(D.curves.recDensity, F, cols, null)
    });
    const s = D.summary;
    doc.descriptors = plain({
      kurtosis: { K: s.kurtosis.K, Kmax: s.kurtosis.Kmax, band: s.kurtosis.band },
      repetition: { hz: s.repetition.hz, prominence: s.repetition.prom, speechIndexDb: s.repetition.speech },
      events: { rate: s.events.rate, meanDuration: s.events.meanDur, active: s.events.active, burstiness: s.events.B, bValue: s.events.bN >= 20 ? s.events.bValue : NaN, temporalEntropy: s.events.Ht },
      motion: { up: s.motion.up, down: s.motion.down, net: s.motion.net, medianAbs: s.motion.medianAbs },
      periodicity: { cpp: s.periodicity.cpp, cppP90: s.periodicity.cppP90, coherence: s.periodicity.pci },
      arrow: { T5: s.arrow.T5, T20: s.arrow.T20, T80: s.arrow.T80 },
      interest: { pir: s.info.pir, surprisal: s.info.surprisal, learning: s.info.info, symbols: s.info.K },
      recurrence: { RR: s.recurrence.RR, DET: s.recurrence.DET, LAM: s.recurrence.LAM, TT: s.recurrence.TT },
      decay: { n: s.decay.n, t60: s.decay.t60, logTauD: s.decay.logTau, material: s.decay.material, reliable: profile === "sfx" }
    }, 4);
  }
  if (profile === "music") {
    const R = WL.rhythmOf(F), St = WL.structureOf(F);
    doc.rhythm = { tempo: rnd(R.tempo, 2), reliable: !!R.reliable, clarity: rnd(R.medClar, 3), beats: R.beatTimes.map(t => rnd(t, 4)), downbeats: R.downTimes.map(t => rnd(t, 4)) };
    doc.sections = St.segs.map(sg => ({ start: rnd(sg.t0, 3), end: rnd(sg.t1, 3), label: sg.label }));
    // structural change (Foote novelty) and the local pulse (PLP, scaled by its clarity), for lanes and modulation
    const pulse = new Float32Array(F.nF);
    for (let m = 0; m < F.nF; m++) pulse[m] = R.plp[m] * Math.min(1, R.clarity[m] / 0.6);
    doc.curves.structureNovelty = resample(St.nov, F, cols, null, "max");
    doc.curves.localPulse = resample(pulse, F, cols, null, "max");
  }
  doc.timing = { ms: Date.now() - t0 };
  prog(1);
  return doc;
}

/* ---------------- the analysis-driven tools (effects bench) ---------------- */
// Runs one of the tools in effects.js on a sound: analysis, render, report. params default to the tool's own defaults;
// for "layers", params.gains is one gain in dB per layer (lowest layer first).
// Returns { tool, outputs: [{ suffix, sampleRate, channels: [Float32Array, ...] }], report: [string] }.
const FXroot = () => root.WLFX || (typeof require !== "undefined" ? require("./effects.js") : null);
function tools() {
  const FX = FXroot(); if (!FX) return [];
  return FX.TOOLS.map(t => ({ id: t.id, name: t.name, kind: t.kind, description: t.desc, params: Array.isArray(t.params) ? t.params.map(p => ({ id: p.id, label: p.label, type: p.type || "number", min: p.min, max: p.max, step: p.step, value: p.value, unit: p.unit || null, options: p.options || null })) : t.params }));
}
async function process(input, toolId, params, opts) {
  const FX = FXroot(); if (!FX) throw new Error("Playhead.process: effects.js is not loaded");
  const tool = FX.TOOLS.find(t => t.id === toolId); if (!tool) throw new Error("Playhead.process: unknown tool " + toolId + " (" + FX.TOOLS.map(t => t.id).join(", ") + ")");
  const buf = toBuffer(input), F = await WL.analyse(buf), cls = (opts && opts.assetClass) || (F.dur <= 10 ? "sfx" : F.guess);
  const an = { F, cur: WL.computeCurves(F, cls, { scale: "fixed" }), X: WL.sfxOf(F, buf, (opts && opts.name) || ""), R: WL.rhythmOf(F) };
  const p = {}; if (Array.isArray(tool.params)) for (const d of tool.params) p[d.id] = d.value;
  if (tool.params === "layers") p.gains = an.X.layers.map(() => 0);
  Object.assign(p, params || {});
  const r = await tool.run(buf, an, p, opts && opts.onProgress);
  return { tool: toolId, params: p, outputs: r.outputs.map(o => ({ suffix: o.suffix, sampleRate: o.buf.sampleRate, channels: Array.from({ length: o.buf.numberOfChannels }, (_, c) => o.buf.getChannelData(c)) })), report: r.report };
}

/* ---------------- curves as modulators ---------------- */
// Value of a document curve at time t (seconds), linearly interpolated; fallback (default null) where it is silent.
// For driving generator and effect parameters: Playhead.curveAt(doc, "activity", t) or curveAt(doc, "n4Velocity", t, 0).
function curveAt(doc, name, t, fallback) {
  const c = doc && doc.curves && doc.curves[name], fb = fallback === undefined ? null : fallback;
  if (!c || !c.length) return fb;
  const x = Math.max(0, Math.min(c.length - 1, t * doc.curves.rate - 0.5)), i = Math.floor(x), f = x - i, a = c[i], b = c[Math.min(c.length - 1, i + 1)];
  if (a == null && b == null) return fb;
  if (a == null) return f >= 0.5 ? b : fb;
  if (b == null) return f < 0.5 ? a : fb;
  return a + (b - a) * f;
}

/* ---------------- markers for editors and engines ---------------- */
// { kind: "region" | "marker", start, end?, name } sorted by time: sections as regions, downbeats and events as markers
function toMarkers(doc, opts) {
  const kinds = (opts && opts.kinds) || ["sections", "events"];
  const out = [];
  if (kinds.includes("sections") && doc.sections) for (const s of doc.sections) out.push({ kind: "region", start: s.start, end: s.end, name: s.label });
  if (kinds.includes("events") && doc.events) for (const e of doc.events) out.push({ kind: "marker", start: e.start, name: e.tag + " " + e.word });
  if (kinds.includes("downbeats") && doc.rhythm && doc.rhythm.reliable) doc.rhythm.downbeats.forEach((t, i) => out.push({ kind: "marker", start: t, name: "bar " + (i + 1) }));
  if (kinds.includes("onsets") && doc.onsets) for (const t of doc.onsets) out.push({ kind: "marker", start: t, name: "onset" });
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------- strip renderer: layers and looks ---------------- */
// A strip is a list of layers drawn on one time axis, top to bottom of the list = back to front:
//   { type: "wave", colour }          the waveform; colour names a 0..1 curve that tints each column along the theme's
//                                      ramp (waveLow -> waveHigh), or null for the plain waveform
//   { type: "line", curve, range }    a curve drawn over the waveform; range [lo, hi] maps to the strip height
//                                      (default [0, 1]; the 5th-95th percentile for the descriptor curves n1-n8)
//   { type: "lane", curve, signed }   a curve in its own lane under the waveform. signed: for change curves such as
//                                      structureNovelty; drawn up where the level rises across the change (an entry),
//                                      down where it falls (a drop, a break into silence) and centred where the level
//                                      stays and only the material changes, so a break never reads as "more"
//   { type: "sections" }              boundaries and letters (music profile; a letter repeats when material returns)
//   { type: "ticks", of: [...] }      marks under the waveform: "events", "onsets", "beats", "downbeats"
// A look is a named list of layers (LOOKS). A look code is the same list as short text, for menus, saved settings
// and feedback: "wave:harshness,line:activity,ticks:events" or "wave,sections,lane:structureNovelty~signed".
const DEFAULT_THEME = {
  background: null, wave: "#9aa5ac", waveLow: [214, 226, 240], waveHigh: [24, 79, 149], line: "#eb6834", tick: "#13181b", text: "#13181b", rule: "#4e5960",
  lane: null, laneDown: null, laneFlat: null      // lanes: rises (default: line), drops (default: rule), level-neutral changes (default: wave)
};
const CURVE_LABELS = {
  loudness: "loudness", activity: "activity", arousal: "arousal", harshness: "harshness", tension: "tension", harmonicTension: "harmonic tension",
  surprise: "spectral surprise", lufs: "loudness (LUFS)", structureNovelty: "structural change", localPulse: "local pulse",
  n1Kurtosis: "impulsiveness", n2RepetitionHz: "repetition rate", n4Velocity: "spectral motion", n5Cpp: "periodicity", n5Coherence: "phase coherence",
  n6Arrow: "time arrow", n7Surprisal: "surprisal", n8Recurrence: "recurrence"
};
const TICK_KINDS = ["events", "onsets", "beats", "downbeats"];
const LOOKS = {
  auto: { name: "Automatic", desc: "Sound effects: harshness as colour, activity as the line, events. Music: activity as colour, tension as the line, sections, downbeats.", code: null },
  plain: { name: "Waveform only", desc: "The waveform without analysis, for comparison.", code: "wave" },
  structure: { name: "Structure", desc: "Sections, structural change (up: entry, down: drop or break) and the local pulse under a plain waveform.", code: "wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats" },
  rhythm: { name: "Rhythm", desc: "Activity as colour, the local pulse, beats and downbeats.", code: "wave:activity,lane:localPulse,ticks:beats+downbeats" },
  tension: { name: "Tension", desc: "Harshness as colour, tension as the line, sections.", code: "wave:harshness,sections,line:tension,ticks:downbeats" },
  events: { name: "Events", desc: "Harshness as colour, activity in a lane, events marked.", code: "wave:harshness,lane:activity,ticks:events" },
  lanes: { name: "Separate lanes", desc: "Plain waveform with loudness, activity and harshness each in its own lane (no colour mixing).", code: "wave,lane:loudness,lane:activity,lane:harshness" }
};
const isSfxDoc = doc => doc.profile === "sfx" || doc.assetClass === "sfx";
// the layers the renderer drew before looks existed; still the default, and still driven by the old options
function legacyLayers(doc, opts) {
  const sfx = isSfxDoc(doc);
  const L = [{ type: "wave", colour: opts.colour === undefined ? (sfx ? "harshness" : "activity") : opts.colour }];
  if (opts.sections !== false) L.push({ type: "sections" });
  L.push({ type: "line", curve: opts.curve || (sfx ? "activity" : "tension"), range: opts.lineRange });
  const of = []; if (opts.beats !== false) of.push("downbeats"); if (opts.events !== false) of.push("events");
  L.push({ type: "ticks", of });
  return L;
}
/** Look code -> layers. Accepts a look name ("structure") or a code; unknown parts are skipped. */
function parseLook(code) {
  if (Array.isArray(code)) return code;
  const c = String(code || "").trim();
  if (LOOKS[c]) return LOOKS[c].code ? parseLook(LOOKS[c].code) : null;
  const out = [];
  for (const tok of c.split(",").map(t => t.trim()).filter(Boolean)) {
    const [main, ...flags] = tok.split("~"), i = main.indexOf(":"), type = i < 0 ? main : main.slice(0, i), arg = i < 0 ? "" : main.slice(i + 1);
    if (type === "wave") out.push({ type, colour: arg || null });
    else if (type === "line" && arg) out.push({ type, curve: arg });
    else if (type === "lane" && arg) out.push({ type, curve: arg, signed: flags.includes("signed") });
    else if (type === "sections") out.push({ type });
    else if (type === "ticks") { const of = arg.split("+").filter(k => TICK_KINDS.includes(k)); if (of.length) out.push({ type, of }); }
  }
  return out;
}
/** Layers -> look code. */
function lookCode(layers) {
  return (layers || []).map(l => l.type === "wave" ? "wave" + (l.colour ? ":" + l.colour : "") : l.type === "line" ? "line:" + l.curve
    : l.type === "lane" ? "lane:" + l.curve + (l.signed ? "~signed" : "") : l.type === "ticks" ? (l.of && l.of.length ? "ticks:" + l.of.join("+") : "") : l.type).filter(Boolean).join(",");
}
/** Plain-language description of layers, for a legend beside the strip. */
function describeLook(layers, doc) {
  const lab = k => CURVE_LABELS[k] || k, has = k => !doc || (doc.curves && Array.isArray(doc.curves[k]));
  const parts = [];
  for (const l of layers || []) {
    if (l.type === "wave") parts.push(l.colour && has(l.colour) ? "colour: " + lab(l.colour) : "waveform");
    else if (l.type === "line" && has(l.curve)) parts.push("line: " + lab(l.curve));
    else if (l.type === "lane") parts.push(has(l.curve) ? "lane: " + lab(l.curve) + (l.signed ? " (up: entry, down: drop or break, centred: same level)" : "") : "lane: " + lab(l.curve) + " (not in this analysis)");
    else if (l.type === "sections" && (!doc || doc.sections)) parts.push("letters: sections");
    else if (l.type === "ticks" && l.of) {
      const ok = r => !doc || (r === "events" ? !!doc.events : r === "onsets" ? !!doc.onsets : !!(doc.rhythm && doc.rhythm.reliable));
      const of = l.of.filter(ok); if (of.length) parts.push("marks: " + of.join(", "));
    }
  }
  return parts.join(" · ");
}
function autoRange(name, arr) {
  const v = arr.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  let r;
  if (/^n\d/.test(name)) r = [v[Math.floor(0.05 * (v.length - 1))], v[Math.floor(0.95 * (v.length - 1))]];
  else if (name === "structureNovelty" || name === "localPulse") r = [0, Math.max(0.05, v[Math.floor(0.99 * (v.length - 1))])];
  else return [0, 1];
  if (r[1] - r[0] < 1e-9) r = [r[0] - 1, r[0] + 1];
  return r;
}

// Draws a strip into any Canvas 2D context (page canvas, OffscreenCanvas in a worker).
// opts: width, height (default: the context's canvas), from, to (seconds, for zoom), theme, and one of
//   look    a look name from LOOKS or a look code
//   layers  a list of layers
//   (none)  the automatic look, adjustable with the older options curve, colour, lineRange, events, sections, beats
// Returns { code, layers, legend }: what was drawn, as a look code and as a plain-language legend.
function drawStrip(ctx, doc, opts) {
  opts = opts || {};
  const th = Object.assign({}, DEFAULT_THEME, opts.theme || {});
  th.lane = th.lane || th.line; th.laneDown = th.laneDown || th.rule; th.laneFlat = th.laneFlat || th.wave;
  const layers = opts.layers ? parseLook(opts.layers) : opts.look ? (parseLook(opts.look) || legacyLayers(doc, opts)) : legacyLayers(doc, opts);
  const W = opts.width || (ctx.canvas && ctx.canvas.width) || 600, H = opts.height || (ctx.canvas && ctx.canvas.height) || 64;
  const dur = doc.source.duration, t0 = Math.max(0, opts.from || 0), t1 = Math.min(dur, opts.to || dur), span = Math.max(1e-6, t1 - t0);
  const curves = doc.curves, rate = curves.rate, xOf = t => (t - t0) / span * W;
  // lanes take the bottom of the strip; the waveform, its line and marks use the rest
  const lanes = layers.filter(l => l.type === "lane" && Array.isArray(curves[l.curve]));
  const laneH = lanes.length ? Math.max(6, Math.round(H * (lanes.length === 1 ? 0.28 : lanes.length === 2 ? 0.22 : 0.18))) : 0;
  const mainH = Math.max(4, H - laneH * lanes.length);
  if (th.background) { ctx.fillStyle = th.background; ctx.fillRect(0, 0, W, H); }
  // value of a curve over [ta, tb): the mean of its samples there, or linear interpolation when a sample spans several pixels
  const valAt = (arr, ta, tb) => {
    if (!arr || !arr.length) return null;
    const ia = ta * rate, ib = tb * rate, n = arr.length;
    if (ib - ia >= 1) { let s = 0, k = 0; for (let i = Math.max(0, Math.floor(ia)); i < Math.min(n, Math.ceil(ib)); i++) if (arr[i] != null) { s += arr[i]; k++; } return k ? s / k : null; }
    const x = Math.max(0, Math.min(n - 1, (ia + ib) / 2 - 0.5)), i = Math.floor(x), f = x - i, a = arr[i], b = arr[Math.min(n - 1, i + 1)];
    return a == null ? (f > 0.5 ? b : null) : b == null ? (f < 0.5 ? a : null) : a + (b - a) * f;
  };
  const mix = (a, b, u) => "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",") + ")";
  const draw = {
    wave(l) {
      const H = mainH, mid = H / 2, wv = doc.wave, wc = wv.columns;
      let peak = 1e-9; for (let c = 0; c < wc; c++) peak = Math.max(peak, Math.abs(wv.min[c] || 0), Math.abs(wv.max[c] || 0));
      const colour = l.colour && curves[l.colour] ? curves[l.colour] : null;
      for (let x = 0; x < W; x++) {
        const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span;
        const ca = Math.floor(ta / dur * wc), cb = Math.max(ca + 1, Math.ceil(tb / dur * wc));
        let lo = 0, hi = 0; for (let c = ca; c < cb && c < wc; c++) { lo = Math.min(lo, wv.min[c] || 0); hi = Math.max(hi, wv.max[c] || 0); }
        const yTop = mid - hi / peak * (mid - 1), yBot = mid - lo / peak * (mid - 1);
        const u = colour ? valAt(colour, ta, tb) : null;
        ctx.fillStyle = u == null ? th.wave : mix(th.waveLow, th.waveHigh, Math.max(0, Math.min(1, u)));
        ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
    },
    sections() {
      if (!doc.sections) return;
      ctx.strokeStyle = th.rule; ctx.fillStyle = th.text; ctx.lineWidth = 1; ctx.font = Math.max(9, Math.round(mainH / 6)) + "px sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";     // hosts may have left other settings behind
      if (ctx.setLineDash) ctx.setLineDash([2, 3]);
      for (const s of doc.sections) {
        if (s.start < t0 || s.start > t1) continue;
        const x = Math.round(xOf(s.start)) + 0.5;
        if (s.start > 0.05) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        ctx.fillText(s.label, x + 3, Math.max(9, Math.round(mainH / 6)));
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
    },
    line(l) {
      const line = curves[l.curve];
      if (!line) return;
      const lr = l.range || autoRange(l.curve, line), Hm = mainH;
      ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(1, Hm / 40); ctx.beginPath(); let pen = false;
      for (let x = 0; x < W; x++) {
        const v = valAt(line, t0 + x / W * span, t0 + (x + 1) / W * span);
        if (v == null) { pen = false; continue; }
        const y = Hm - 2 - Math.max(0, Math.min(1, (v - lr[0]) / (lr[1] - lr[0]))) * (Hm - 4);
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
    },
    lane(l) {
      const arr = curves[l.curve], k = lanes.indexOf(l);
      if (!arr || k < 0) return;
      const y0 = mainH + k * laneH, lr = l.range || autoRange(l.curve, arr), norm = v => Math.max(0, Math.min(1, (v - lr[0]) / (lr[1] - lr[0])));
      ctx.fillStyle = th.rule; ctx.globalAlpha = 0.35; ctx.fillRect(0, y0, W, 1); ctx.globalAlpha = 1;
      const top = y0 + 1, h = laneH - 1;
      // direction of a change: level after minus level before, over a window that grows with the sound (0.25 to 3 s)
      const loud = curves.loudness, win = Math.max(0.25, Math.min(3, dur * 0.04));
      const lvl = (a, b) => { let s = 0, n = 0; const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(loud ? loud.length : 0, Math.ceil(b * rate)); for (let i = i0; i < i1; i++) { s += loud[i] == null ? 0 : loud[i]; n++; } return n ? s / n : 0; };
      for (let x = 0; x < W; x++) {
        const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span, v = valAt(arr, ta, tb);
        if (v == null) continue;
        const u = norm(v);
        if (u <= 0 || (l.signed && u < 0.12)) continue;     // signed lanes: the weakest changes are left out, so boundaries stand out
        if (!l.signed) { ctx.fillStyle = th.lane; ctx.fillRect(x, top + h - u * h, 1, Math.max(1, u * h)); continue; }
        const tm = (ta + tb) / 2, d = loud ? lvl(tm, tm + win) - lvl(tm - win, tm) : 0, half = h / 2, mid = top + half;
        if (d > 0.03) { ctx.fillStyle = th.lane; ctx.fillRect(x, mid - u * half, 1, Math.max(1, u * half)); }
        else if (d < -0.03) { ctx.fillStyle = th.laneDown; ctx.fillRect(x, mid, 1, Math.max(1, u * half)); }
        else { ctx.fillStyle = th.laneFlat; ctx.fillRect(x, mid - u * half / 2, 1, Math.max(1, u * half)); }
      }
      if (laneH >= 11 && W >= 160) {
        ctx.fillStyle = th.text; ctx.globalAlpha = 0.7; ctx.font = Math.min(10, laneH - 2) + "px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(CURVE_LABELS[l.curve] || l.curve, 3, top + Math.min(10, laneH - 2)); ctx.globalAlpha = 1;
      }
    },
    ticks(l) {
      const of = l.of || [], Hm = mainH, r = doc.rhythm, ok = r && r.reliable;
      ctx.fillStyle = th.tick; ctx.strokeStyle = th.tick; ctx.lineWidth = 1;
      const vl = (ts, h, alpha) => { if (alpha != null) ctx.globalAlpha = alpha; for (const t of ts) { if (t < t0 || t > t1) continue; const x = Math.round(xOf(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, Hm - h); ctx.lineTo(x, Hm); ctx.stroke(); } if (alpha != null) ctx.globalAlpha = 1; };
      if (of.includes("beats") && ok) vl(r.beats, 3, 0.5);
      if (of.includes("onsets") && doc.onsets) vl(doc.onsets, 3, 0.6);
      if (of.includes("downbeats") && ok) vl(r.downbeats, 4);
      if (of.includes("events") && doc.events) for (const e of doc.events) {
        if (e.start < t0 || e.start > t1) continue; const x = xOf(e.start);
        ctx.beginPath(); ctx.moveTo(x, Hm - 1); ctx.lineTo(x - 3, Hm - 6); ctx.lineTo(x + 3, Hm - 6); ctx.closePath(); ctx.fill();
      }
    }
  };
  for (const l of layers) if (draw[l.type]) draw[l.type](l);
  return { code: lookCode(layers), layers, legend: describeLook(layers, doc) };
}

const api = { version: VERSION, schema: SCHEMA, schemaVersion: SCHEMA_VERSION, profiles: PROFILES, analyze, fromAnalysis, process, tools, toMarkers, curveAt, drawStrip, parseLook, lookCode, describeLook, looks: LOOKS, curveLabels: CURVE_LABELS, theme: DEFAULT_THEME, internals: { WL, PHD, get FX() { return FXroot(); } } };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.Playhead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
