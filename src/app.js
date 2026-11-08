// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead

"use strict";
(function () {
const $ = id => document.getElementById(id);
// Translations (src/i18n.js): T("key", "English", { name: value }); a missing translation falls back to the English.
const I18N = window.PHI18N || null;
// numbers in the reader's style: 0,42 where the language writes a decimal comma (clock times keep their dot)
const dec = x => { const t = String(x); if (!I18N || I18N.language === "en" || !/\d\.\d/.test(t)) return t; let c = ","; try { c = (1.5).toLocaleString(I18N.language).charAt(1); } catch (e) { /* no Intl */ } return c === "." ? t : t.replace(/(\d)\.(\d)/g, "$1" + c + "$2"); };
const decVars = v => { if (!v) return v; const o = {}; for (const k in v) o[k] = typeof v[k] === "number" || /^[-−+]?\d+\.\d+$/.test(v[k]) ? dec(v[k]) : v[k]; return o; };
const T = (k, en, v) => (I18N ? I18N.T(k, en, decVars(v)) : v ? String(en).replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? v[x] : m)) : en);
const TP = (k, n, one, other, v) => (I18N ? I18N.TP(k, n, one, other, decVars(v)) : T(k, n === 1 ? one : other, Object.assign({ n }, v)));
const rowName = s => T("row." + s.id + ".name", s.name), rowDesc = s => (s.desc ? T("row." + s.id + ".desc", s.desc) : "");
const word = w => T("word." + w, w);
const clsLabel = k => T("ui.cls." + k, WL.CLASSES[k].label);
// a label inside a sentence: lower case, except in German, where nouns keep their capital
const midSentence = t => (I18N && I18N.language === "de" ? t : t.toLowerCase());
// the tools' texts are the library's (lib.tool.<id>.*), shared with Playhead.tools()
const toolName = t => T("lib.tool." + t.id + ".name", t.name), toolDesc = t => T("lib.tool." + t.id + ".desc", t.desc);
const toolKind = t => T("lib.kind." + t.kind.toLowerCase().replace(/\s+(\w)/g, (m, c) => c.toUpperCase()), t.kind);
const paramLabel = (t, p) => T("lib.tool." + t.id + ".param." + p.id, p.label);
const optLabel = (t, p, v, en) => T("lib.tool." + t.id + ".opt." + p.id + "." + v, en);
const store = {
  get(k, d) { try { const v = localStorage.getItem("pwl." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("pwl." + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const ALLOW_SAVE = !!window.PLAYHEAD_ALLOW_SAVE;
// In hosts that sandbox downloads (the claude.ai artifact viewer), saving goes through the host's
// download permission instead; the GitHub Pages build saves directly.
let HOST_DL = null;
if (!ALLOW_SAVE && window.claude && typeof window.claude.use === "function") {
  window.claude.use("downloads").then(d => { HOST_DL = d || null; if (HOST_DL && typeof renderFxResult === "function") renderFxResult(); }).catch(() => { HOST_DL = null; });
}
const S = {
  fx: store.get("fx", "cleanup"), fxVals: {}, fxLast: null,
  files: [], sel: null,
  height: store.get("height", 40), shape: store.get("shape", "mirror"), scale: store.get("scale", "fixed"),
  ghost: store.get("ghost", false), panel: store.get("panel", "dark"), thumb: store.get("thumb", "auto"),
  queue: Promise.resolve(), nextId: 1
};

/* ---------------- panel palettes (editor-coloured, independent of page theme) ---------------- */
const PANELS = {
  dark: {
    bg: "#1C1F22", seg: "rgba(255,255,255,0.07)", band: "rgba(255,255,255,0.035)", mid: "rgba(255,255,255,0.10)",
    ink: "#B3BEC6", unity: "#E8892E", outline: "rgba(255,255,255,0.42)", tick: "#F4F6F7", off: "#727D85",
    overlay: "rgba(255,255,255,0.45)", rulerInk: "#A4AFB7",
    dim: "rgba(179,190,198,0.26)", mark: "#F0A35E", shade: "rgba(0,0,0,0.38)", line: "#FF7AB8", halo: "rgba(10,12,14,0.75)", bar: "rgba(255,255,255,0.22)",
    cat: ["#5B8DEF", "#E8A33D", "#4FB39A", "#E0677F", "#A285E0", "#8DBF4F", "#E07A4F", "#4FB1D9", "#C9B458", "#B07C9E"],
    spec6: ["#3F4FA0", "#2C7FA6", "#24A38E", "#63BE5F", "#BFD63C", "#FBE74A"], tail: "rgba(179,190,198,0.45)", bad: "#FF6B6B",
    ramp: [[59, 82, 139], [44, 114, 142], [33, 145, 140], [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37]]
  },
  light: {
    bg: "#EEF1F3", seg: "rgba(0,0,0,0.08)", band: "rgba(0,0,0,0.035)", mid: "rgba(0,0,0,0.12)",
    ink: "#45525C", unity: "#C2600D", outline: "rgba(0,0,0,0.45)", tick: "#15191C", off: "#808B93",
    overlay: "rgba(0,0,0,0.38)", rulerInk: "#4E5960",
    dim: "rgba(69,82,92,0.22)", mark: "#B5541B", shade: "rgba(255,255,255,0.55)", line: "#B4236C", halo: "rgba(255,255,255,0.85)", bar: "rgba(0,0,0,0.20)",
    cat: ["#3E6FD1", "#C98617", "#2F9378", "#C44A63", "#7E60C4", "#6A9A2E", "#C55C30", "#2E92BA", "#A8932E", "#8F5A7E"],
    spec6: ["#24307A", "#1F6390", "#178277", "#3C9A3F", "#8EA11B", "#C29A00"], tail: "rgba(69,82,92,0.45)", bad: "#C62828",
    ramp: [[189, 214, 236], [145, 191, 222], [99, 162, 205], [60, 132, 189], [34, 101, 168], [16, 72, 140], [10, 44, 100]]
  }
};
function rampRGB(P, v) {
  const s = P.ramp, x = Math.max(0, Math.min(1, v)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x)), f = x - i, a = s[i], b = s[i + 1];
  return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * f) + "," + Math.round(a[1] + (b[1] - a[1]) * f) + "," + Math.round(a[2] + (b[2] - a[2]) * f) + ")";
}
function rampCSS(P) { return "linear-gradient(90deg," + P.ramp.map(c => "rgb(" + c.join(",") + ")").join(",") + ")"; }

/* ---------------- strip definitions ---------------- */
const SINGLE = [
  { id: "c1", code: "C1", name: "Loudness", desc: "K-weighted level in LUFS, absolute scale from −60 to 0.", key: "c1", pool: "max" },
  { id: "c2", code: "C2", name: "Activity", desc: "Spectral change where energy rises (positive spectral flux) plus onsets per second. Independent of level.", key: "c2", pool: "mean" },
  { id: "c3", code: "C3", name: "Arousal", desc: "Loudness 50%, loudness variation 15%, activity 20%, noisiness 15%.", key: "c3", pool: "mean" },
  { id: "c4", code: "C4", name: "Harshness-weighted loudness", desc: "Loudness raised by sharpness, roughness and fluctuation (Zwicker annoyance form).", key: "c4", pool: "max" },
  { id: "c5", code: "C5", name: "Tension", desc: "Integrated trends of loudness, sharpness, roughness and harmony (Farbood model).", key: "c5", pool: "mean", needs: "tension" },
  { id: "c6", code: "C6", name: "Harmonic tension", desc: "Chroma dissonance, distance from key and chord change (tonal interval vectors).", key: "c6", pool: "mean", needs: "harmony" },
  { id: "c7", code: "C7", name: "Novelty", desc: "Spectral surprise beyond what loudness explains. Ticks mark the strongest new events.", key: "c7", pool: "max", needs: "surprise", ticks: true }
];
const D3MAP = {
  rhythmic:   { h: "c1", col: "activity", lab: ["calm", "busy"], ticks: true, text: "Rhythmic: height loudness (C1), colour activity (C2), novelty ticks." },
  orchestral: { h: "c5", col: "harmony", lab: ["consonant", "tense"], ticks: true, text: "Orchestral: height tension (C5), colour harmonic tension (C6), novelty ticks." },
  sfx:        { h: "c1", col: "harsh", lab: ["smooth", "harsh"], ticks: false, text: "One-shot: height fast loudness (C1), colour harshness factor (C4)." },
  ambience:   { h: "c1", col: "fluct", lab: ["steady", "fluctuating"], ticks: true, text: "Ambience: height 3 s loudness (C1), colour fluctuation strength, novelty ticks." }
};
const RHY = [
  { id: "r1", code: "R1", name: "Events", desc: "Onsets, where the sound starts, and where it has fallen 30 dB below its peak. Works for any asset.", kind: "events" },
  { id: "r2", code: "R2", name: "Beat tracker", desc: "Dynamic programming over onsets at one global tempo (Ellis 2007). Thick lines are downbeats, assuming 4/4.", kind: "dp", minDur: 5 },
  { id: "r3", code: "R3", name: "Local pulse", desc: "Predominant local pulse (Grosche & Müller 2011). Follows tempo changes; peaks are beats, height scaled by clarity.", kind: "plp", minDur: 5 },
  { id: "r4", code: "R4", name: "Pulse clarity and tempo", desc: "Height: how regular the onsets are over 8 s. Colour: local tempo, grey where there is no clear pulse.", kind: "clarity", minDur: 5 }
];
const SFXROWS = [
  { id: "x1", code: "X1", name: "Spectral silhouette", desc: "Height is loudness. Inside, colour shows where the energy sits: low frequencies at the centre, high at the edges.", kind: "silhouette" },
  { id: "x2", code: "X2", name: "Layers", desc: "Up to three spectral components found by non-negative matrix factorisation, coloured by centre frequency. A sweep splits into consecutive layers.", kind: "layers" },
  { id: "x3", code: "X3", name: "Pitch and brightness", desc: "Solid line: pitch where the sound is tonal. Dotted: spectral centroid. Log scale, 50 Hz at the bottom to 10 kHz at the top.", kind: "motion" },
  { id: "x4", code: "X4", name: "Envelope", desc: "Loudness coloured by phase: attack, body within 12 dB of the peak, tail down to −45 dB. Tick: temporal centre.", kind: "phases" },
  { id: "x5", code: "X5", name: "Sound objects", desc: "Events tagged with Schaeffer's typology: N tonal, X noisy, Y gliding; ′ impulse, ″ iterative.", kind: "objects" },
  { id: "x6", code: "X6", name: "Space", desc: "Line: pan, left up and right down. Band: width, how different the two channels are.", kind: "space" },
  { id: "x7", code: "X7", name: "Asset checks", desc: "Clipping, DC offset, silence at either end, a non-zero first sample, a cut tail, loop seams.", kind: "checks" }
];
const STR = [
  { id: "s1", code: "S1", name: "Structural novelty", desc: "How different the next few seconds are from the last few (Foote 2000, on timbre, chroma, level and activity). Lines are boundaries.", kind: "snov" },
  { id: "s2", code: "S2", name: "Sections", desc: "Segments between boundaries, lettered by similarity. The same letter means returning material.", kind: "sections" }
];
const DESCROWS = [
  { id: "n1", code: "N1", name: "Impulsiveness", desc: "Spectral kurtosis (machine diagnostics). Line at 0 is noise; down to −1 is a steady tone; up is clicks and crackle, coloured by the band that carries them. Dashed: the value that noise would give in this window.", kind: "n1" },
  { id: "n2", code: "N2", name: "Repetition rate", desc: "Envelope spectrum per band (machine diagnostics): height is how clearly the level repeats, colour the rate from 0.5 Hz (dark) to 150 Hz (light). Firing rates, rattles, footsteps.", kind: "n2" },
  { id: "n3", code: "N3", name: "Event statistics", desc: "STA/LTA trigger from seismology: each bar is an event from trigger to release, height its peak. Labels give rate, burstiness (−1 regular, 0 random, above 0 clustered) and the b-value (many small vs few big).", kind: "n3" },
  { id: "n4", code: "N4", name: "Spectral motion", desc: "Optimal-transport velocity on a log-frequency axis: up is rising (risers, sweeps, Doppler), down falling, scale ±6 oct/s. Shaded: reshaping that is not a shift.", kind: "n4" },
  { id: "n5", code: "N5", name: "Periodicity", desc: "Cepstral peak prominence (voice science): high for voiced, buzzing or pitched sound, without a pitch tracker. Line: phase coherence, 1 for stable partials, near 0 for noise and diffuse reverb.", kind: "n5" },
  { id: "n6", code: "N6", name: "Arrow of time", desc: "Third-moment asymmetry of the log envelope: up for impacts and plucks (fast rise, slow fall), down for swells and reversed sounds, centre for anything that would sound the same backwards.", kind: "n6" },
  { id: "n7", code: "N7", name: "Interest", desc: "Information dynamics (Abdallah & Plumbley) on timbre symbols: height is predictive information, high when what you hear changes what comes next. Line: learning, high when material is new, falling as it repeats.", kind: "n7" },
  { id: "n8", code: "N8", name: "Recurrence", desc: "How often this moment's timbre and harmony recur elsewhere in the file. Line: laminarity, 1 while a state is held (drone, held chord, steady noise).", kind: "n8" },
  { id: "n9", code: "N9", name: "Decay and material", desc: "Decay time (T60 from band decays, log scale 20 ms to 5 s) for each impact, coloured by Klatzky damping: blue damped (rubber, wood), green glass-like, orange metal-like, grey not modal. Reverb reads as metal.", kind: "n9" }
];
const DESIGNS = [
  { id: "d1", code: "D1", name: "Energy", desc: "Height arousal (C3), colour activity (C2).", h: "c3", col: "activity", lab: ["calm", "busy"] },
  { id: "d2", code: "D2", name: "Tension arc", desc: "Height tension (C5), colour harshness factor (C4), novelty ticks.", h: "c5", col: "harsh", lab: ["smooth", "harsh"], ticks: true },
  { id: "d3", code: "D3", name: "Asset thumbnail", desc: "", auto: true },
  { id: "d5", code: "D5", name: "SFX thumbnail", desc: "Spectral silhouette (X1) with event ticks (X5) and the pitch line where the sound is tonal (X3).", kind: "d5", lab: ["low", "high"] },
  { id: "d4", code: "D4", name: "Structure overlay", desc: "Height loudness (C1), colour activity (C2), line harmonic tension (C6), top band sections (S2), bar lines (R2), ticks novelty (C7).", kind: "d4", lab: ["calm", "busy"] }
];
const POOLMODE = { c1: "max", c2: "mean", c3: "mean", c4: "max", c5: "mean", c6: "mean", c7: "max", activity: "mean", harsh: "mean", fluct: "mean", harmony: "mean" };

/* ---------------- DOM rows ---------------- */
const scopes = [];
function mkRow(container, spec, group) {
  const lab = document.createElement("div"); lab.className = "lab";
  const tl = document.createElement("div"); tl.className = "titleline";
  if (spec.code) { const c = document.createElement("span"); c.className = "code"; c.textContent = spec.code; tl.appendChild(c); }
  const nm = document.createElement("span"); nm.className = "name"; nm.textContent = rowName(spec); tl.appendChild(nm);
  lab.appendChild(tl);
  const ds = document.createElement("div"); ds.className = "desc"; ds.id = "ds-" + spec.id; ds.textContent = rowDesc(spec); lab.appendChild(ds);
  const ml = document.createElement("div"); ml.className = "metaline"; ml.id = "ml-" + spec.id; lab.appendChild(ml);
  const sc = document.createElement("div"); sc.className = "scope";
  const w = document.createElement("div"); w.className = "cvw";
  const cv = document.createElement("canvas"); cv.className = "strip"; cv.id = "cv-" + spec.id;
  cv.setAttribute("role", "img"); cv.setAttribute("aria-label", stripAria(spec));
  const ph = document.createElement("div"); ph.className = "ph";
  const hv = document.createElement("div"); hv.className = "hv";
  w.appendChild(cv); w.appendChild(ph); w.appendChild(hv); sc.appendChild(w);
  container.appendChild(lab); container.appendChild(sc);
  scopes.push({ w, cv, ph, hv, spec, group });
}
function stripAria(spec) { return T("aria.strip", "{name} strip; click to seek", { name: (spec.code ? spec.code + " " : "") + rowName(spec) }); }
// after a language change: row titles, descriptions and the strips' names for screen readers
function relabelRows() {
  for (const sc of scopes) {
    if (sc.group === "ruler") { sc.cv.setAttribute("aria-label", T("aria.ruler", "Time ruler; click to seek")); continue; }
    const lab = sc.w.parentNode.previousElementSibling, nm = lab && lab.querySelector(".name");
    if (nm) nm.textContent = rowName(sc.spec);
    const ds = $("ds-" + sc.spec.id); if (ds && sc.spec.id !== "compose") ds.textContent = rowDesc(sc.spec);
    sc.cv.setAttribute("aria-label", stripAria(sc.spec));
  }
}
function buildRows() {
  const rr = $("rows-ruler");
  const lab = document.createElement("div"); lab.className = "lab";
  lab.innerHTML = '<div class="rulerlab" id="rulerlab">0:00</div>';
  const sc = document.createElement("div"); sc.className = "scope";
  const w = document.createElement("div"); w.className = "cvw";
  const cv = document.createElement("canvas"); cv.className = "strip"; cv.id = "cv-ruler"; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", T("aria.ruler", "Time ruler; click to seek"));
  const ph = document.createElement("div"); ph.className = "ph";
  const hv = document.createElement("div"); hv.className = "hv";
  w.appendChild(cv); w.appendChild(ph); w.appendChild(hv); sc.appendChild(w);
  rr.appendChild(lab); rr.appendChild(sc);
  scopes.push({ w, cv, ph, hv, spec: { id: "ruler" }, group: "ruler" });
  mkRow($("rows-ref"), { id: "unity", name: "Peak waveform", desc: "Linear min/max per channel." }, "ref");
  SINGLE.forEach(s => mkRow($("rows-single"), s, "single"));
  SFXROWS.forEach(s => mkRow($("rows-sfx"), s, "sfx"));
  RHY.forEach(s => mkRow($("rows-rhythm"), s, "rhythm"));
  STR.forEach(s => mkRow($("rows-structure"), s, "structure"));
  DESCROWS.forEach(s => mkRow($("rows-desc"), s, "desc"));
  DESIGNS.forEach(s => mkRow($("rows-design"), s, "design"));
  if ($("rows-compose")) {
    mkRow($("rows-compose"), { id: "compose", name: "Your combination", desc: "" }, "compose");
    mkRow($("rows-compose"), { id: "compose-wave", name: "Waveform", desc: "For comparison: the same file as an ordinary waveform." }, "compose");
    mkRow($("rows-compose"), { id: "compose-spec", name: "Spectrogram", desc: "For comparison: a standard spectrogram (mel scale, 40 Hz to 16 kHz, low at the bottom)." }, "compose");
  }
}

/* ---------------- files ---------------- */
function effClass(f) { return f.cls || (f.F ? f.F.guess : "rhythmic"); }
function curvesOf(f) {
  const key = effClass(f) + "|" + S.scale;
  f.curves = f.curves || {};
  if (!f.curves[key]) f.curves[key] = WL.computeCurves(f.F, effClass(f), { scale: S.scale });
  return f.curves[key];
}
function peaksOf(f, cols) {
  f.peaks = f.peaks || {};
  if (f.peaks[cols]) return f.peaks[cols];
  const nch = Math.min(2, f.buf.numberOfChannels);
  const out = { min: [], max: [] };
  for (let c = 0; c < nch; c++) {
    const d = f.buf.getChannelData(c), n = d.length;
    const mn = new Float32Array(cols), mx = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      const s = Math.floor(i * n / cols), e = Math.max(s + 1, Math.floor((i + 1) * n / cols));
      let a = 0, b = 0;
      for (let k = s; k < e && k < n; k++) { const v = d[k]; if (v < a) a = v; if (v > b) b = v; }
      mn[i] = a; mx[i] = b;
    }
    out.min.push(mn); out.max.push(mx);
  }
  if (nch === 1) { out.min.push(out.min[0]); out.max.push(out.max[0]); }
  const keys = Object.keys(f.peaks); if (keys.length > 6) delete f.peaks[keys[0]];
  f.peaks[cols] = out;
  return out;
}
function viewOf(f, cols) {
  const cls = effClass(f), key = cls + "|" + S.scale + "|" + cols;
  f.views = f.views || {};
  if (f.views[key]) return f.views[key];
  const cur = curvesOf(f), n = f.F.nF;
  const v = { cols, cls, cur };
  for (const k of ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]) v[k] = WL.pool(cur.curves[k], n, cols, POOLMODE[k]);
  for (const k of ["activity", "harsh", "fluct", "harmony"]) v[k] = WL.pool(cur.colour[k], n, cols, POOLMODE[k]);
  v.ticks = cur.ticks.map(m => Math.min(cols - 1, Math.floor((m + 0.5) / n * cols)));
  const R = WL.rhythmOf(f.F), St = WL.structureOf(f.F), E = WL.eventsOf(f.F);
  v.R = R; v.St = St; v.E = E;
  if (!f.envScale) {
    const t = Array.from(R.env).filter(x => x > 0).sort((a, b) => a - b);
    f.envScale = t.length ? t[Math.floor(0.99 * (t.length - 1))] || 1 : 1;
    f.plpDisp = new Float32Array(n);
    for (let m = 0; m < n; m++) f.plpDisp[m] = R.plp[m] * Math.min(1, R.clarity[m] / 0.6);
    f.tempoN = new Float32Array(n);
    for (let m = 0; m < n; m++) f.tempoN[m] = R.ltempo[m] > 0 ? Math.max(0, Math.min(1, Math.log2(R.ltempo[m] / 60) / Math.log2(3))) : 0;
  }
  v.env = WL.pool(R.env, n, cols, "max").map(x => Math.min(1, x / f.envScale));
  v.plp = WL.pool(f.plpDisp, n, cols, "max");
  v.clar = WL.pool(R.clarity, n, cols, "mean");
  v.tempoN = WL.pool(f.tempoN, n, cols, "mean");
  v.snov = WL.pool(St.nov, n, cols, "max");
  const X = f.buf ? WL.sfxOf(f.F, f.buf, f.name) : null;
  v.X = X;
  const Dd = f.F._desc;
  if (Dd) {
    const C = Dd.curves, pn = PHD.poolNaN;
    v.D = { kurt: pn(C.kurt, cols, "max"), kurtLoc: pn(C.kurtLocal || C.kurt, cols, "max"), kurtHz: pn(C.kurtHz, cols, "mean"), repProm: pn(C.repProm, cols, "max"), repHz: pn(C.repHz, cols, "mean"), vel: pn(C.vel, cols, "mean"), reshape: pn(C.reshape, cols, "mean"),
      cpp: pn(C.cpp, cols, "mean"), pci: pn(C.pci, cols, "mean"), arrow: pn(C.arrow, cols, "mean"), pir: pn(C.pir, cols, "mean"), info: pn(C.info, cols, "max"), dens: pn(C.recDensity, cols, "mean"), lam: pn(C.lam, cols, "mean"), raw: Dd };
  }
  if (X) {
    const samp = arr => { const o = new Float32Array(cols); for (let c = 0; c < cols; c++) o[c] = arr[Math.min(n - 1, Math.max(0, Math.floor((c + 0.5) / cols * n)))]; return o; };
    const lo = Math.log2(50), hi = Math.log2(10000), nf = l2 => Math.max(0, Math.min(1, (l2 - lo) / (hi - lo)));
    v.bands6 = X.bands6.map(a => WL.pool(a, n, cols, "mean"));
    v.layers = X.layers.map(l => WL.pool(l.act, n, cols, "max"));
    v.phase = samp(X.phase);
    const f0c = samp(X.f0), apc = samp(X.aper), cc = samp(X.cent), lv = WL.pool(X.lev, n, cols, "max");
    v.f0n = new Float32Array(cols); v.centn = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      v.f0n[c] = apc[c] <= WL.SFX.tonalAper && f0c[c] >= 50 && lv[c] >= X.pk - 35 ? nf(Math.log2(f0c[c])) : NaN;
      v.centn[c] = lv[c] >= X.pk - 40 && cc[c] > 0 ? nf(cc[c]) : NaN;
    }
    v.pan = WL.pool(X.pan, n, cols, "mean"); v.width = WL.pool(X.width, n, cols, "mean");
    v.lvGate = lv.map(x => x >= X.pk - 45 ? 1 : 0);
  }
  const keys = Object.keys(f.views); if (keys.length > 12) delete f.views[keys[0]];
  f.views[key] = v;
  return v;
}
function diagOf(f) {
  const key = effClass(f) + "|" + S.scale;
  f.diag = f.diag || {};
  if (f.diag[key]) return f.diag[key];
  const cols = 400, v = viewOf(f, cols), n = f.F.nF;
  const gate = WL.pool(Float32Array.from(v.cur.gate), n, cols, "mean");
  const mask = new Uint8Array(cols); for (let i = 0; i < cols; i++) mask[i] = gate[i] >= 0.5 ? 1 : 0;
  const pk = peaksOf(f, cols), peak = new Float32Array(cols);
  for (let i = 0; i < cols; i++) peak[i] = Math.max(-pk.min[0][i], pk.max[0][i], -pk.min[1][i], pk.max[1][i]);
  const series = { peak, c1: v.c1, c2: v.c2, c3: v.c3, c4: v.c4, c5: v.c5, c6: v.c6, c7: v.c7, r4: v.clar, s1: v.snov };
  const nanMask = {};
  if (v.D) {
    const D = v.D, fill = a => { const o = new Float32Array(cols), m = new Uint8Array(cols); for (let i = 0; i < cols; i++) { const x = a[i]; if (Number.isFinite(x)) { o[i] = x; m[i] = 1; } } return [o, m]; };
    for (const [key, arr] of [["n1", D.kurt], ["n2", D.repProm], ["n4", D.vel.map(Math.abs)], ["n5", D.cpp], ["n6", D.arrow], ["n7", D.pir], ["n8", D.dens]]) { const [o, m] = fill(arr); series[key] = o; nanMask[key] = m; }
  }
  const r = {}, dis = {};
  // leave the first and last 3% out of the listening suggestions: smoother start-up, fades
  const mDis = Uint8Array.from(mask);
  const edge = Math.round(cols * 0.03);
  for (let i = 0; i < cols; i++) if (i < edge || i >= cols - edge) mDis[i] = 0;
  const mk = k => { if (!nanMask[k]) return mask; const m = Uint8Array.from(mask); for (let i = 0; i < cols; i++) m[i] &= nanMask[k][i]; return m; };
  for (const k of ["c2", "c3", "c4", "c5", "c6", "c7", "r4", "s1"].concat(Object.keys(nanMask))) {
    r[k] = WL.diffCorr(series[k], v.c1, mk(k));
    if (!nanMask[k]) dis[k] = WL.disagreements(series[k], v.c1, mDis, 3, 0.06).map(o => (o.i + 0.5) / cols * f.dur);
  }
  const names = Object.keys(series);
  const both = (a, b) => { const m = mk(a); if (nanMask[b]) for (let i = 0; i < cols; i++) m[i] &= nanMask[b][i]; return m; };
  const mx = names.map(a => names.map(b => WL.diffCorr(series[a], series[b], both(a, b))));
  f.diag[key] = { r, dis, names, mx };
  return f.diag[key];
}

/* ---------------- drawing ---------------- */
function prep(cv, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(cv.clientWidth));
  cv.style.height = h + "px";
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const x = cv.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, w, h };
}
function segCols(f, cols) {
  if (!f.segments) return [];
  return f.segments.slice(1).map(s => Math.round(s.t0 / f.dur * cols));
}
function drawSegLines(x, P, segs, h) {
  if (!segs.length) return;
  x.fillStyle = P.seg;
  for (const c of segs) x.fillRect(c, 0, 1, h);
}
function drawOff(x, P, w, h, text) {
  x.fillStyle = P.bg; x.fillRect(0, 0, w, h);
  if (h >= 13) {
    x.fillStyle = P.off; x.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, w / 2, h / 2 + 0.5);
  }
}
function drawValues(x, P, w, h, vals, cols, colours, solid) {
  const shape = S.shape;
  const cw = w / cols;
  const fill = (c, y0, y1, style) => { x.fillStyle = style; x.fillRect(c * cw, y0, Math.max(cw, 1), Math.max(0.5, y1 - y0)); };
  if (!colours) x.fillStyle = solid;
  for (let c = 0; c < cols; c++) {
    const v = Math.max(0, Math.min(1, vals[c]));
    if (v <= 0.002) continue;
    const st = colours ? (isNaN(colours[c]) ? solid : rampRGB(P, colours[c])) : solid;
    if (shape === "mirror") {
      const half = h / 2, a = v * (half - 0.5);
      fill(c, half - a, half + a, st);
    } else if (shape === "base") {
      fill(c, h - v * (h - 1), h, st);
    } else {
      const v1 = Math.min(v, 0.5) * 2, v2 = Math.max(0, v - 0.5) * 2;
      fill(c, h - v1 * h, h, st);
      if (v2 > 0) fill(c, h - v2 * h, h, P.overlay);
    }
  }
}
function drawOutline(x, P, w, h, pk, cols) {
  x.strokeStyle = P.outline; x.lineWidth = 1;
  const cw = w / cols;
  const amp = c => [Math.max(-pk.min[0][c], pk.max[0][c]), Math.max(-pk.min[1][c], pk.max[1][c])];
  x.beginPath();
  if (S.shape === "mirror") {
    const half = h / 2;
    for (let c = 0; c < cols; c++) { const [l] = amp(c); const y = half - Math.min(1, l) * (half - 0.5); c ? x.lineTo((c + 0.5) * cw, y) : x.moveTo((c + 0.5) * cw, y); }
    x.stroke(); x.beginPath();
    for (let c = 0; c < cols; c++) { const [, r] = amp(c); const y = half + Math.min(1, r) * (half - 0.5); c ? x.lineTo((c + 0.5) * cw, y) : x.moveTo((c + 0.5) * cw, y); }
  } else {
    for (let c = 0; c < cols; c++) { const [l, r] = amp(c); const y = h - Math.min(1, Math.max(l, r)) * (h - 1); c ? x.lineTo((c + 0.5) * cw, y) : x.moveTo((c + 0.5) * cw, y); }
  }
  x.stroke();
}
function drawTicks(x, P, w, h, ticks, cols) {
  if (!ticks || !ticks.length) return;
  const cw = w / cols;
  for (const c of ticks) {
    const px = Math.round((c + 0.5) * cw);
    x.fillStyle = P.tick; x.globalAlpha = 0.55; x.fillRect(px, 0, 1, h); x.globalAlpha = 1;
    const s = Math.max(3, Math.min(5, h / 6));
    x.beginPath(); x.moveTo(px - s + 0.5, 0); x.lineTo(px + s + 0.5, 0); x.lineTo(px + 0.5, s * 1.2); x.closePath(); x.fill();
  }
}
function drawUnity(x, P, w, h, pk, cols) {
  const cw = w / cols, lane = h / 2;
  x.fillStyle = P.mid; x.fillRect(0, Math.round(lane / 2), w, 1); x.fillRect(0, Math.round(lane + lane / 2), w, 1);
  x.fillStyle = P.unity;
  for (let ch = 0; ch < 2; ch++) {
    const mid = ch * lane + lane / 2, hh = lane / 2 - 0.5;
    for (let c = 0; c < cols; c++) {
      const a = mid - Math.min(1, pk.max[ch][c]) * hh, b = mid - Math.max(-1, pk.min[ch][c]) * hh;
      x.fillRect(c * cw, a, Math.max(cw, 1), Math.max(1, b - a));
    }
  }
}
function tx(t, f, w) { return Math.round(t / f.dur * w); }
function vlines(x, w, h, f, times, style, alpha, width, alphaFn) {
  x.fillStyle = style;
  for (const t of times) { x.globalAlpha = alphaFn ? alphaFn(t) : alpha; x.fillRect(tx(t, f, w) - (width > 1 ? 1 : 0), 0, width, h); }
  x.globalAlpha = 1;
}
function drawLine(x, P, w, h, vals, cols) {
  const cw = w / cols;
  const path = () => { x.beginPath(); for (let c = 0; c < cols; c++) { const y = h - 1.5 - Math.max(0, Math.min(1, vals[c])) * (h - 3); c ? x.lineTo((c + 0.5) * cw, y) : x.moveTo((c + 0.5) * cw, y); } };
  x.lineJoin = "round"; x.lineCap = "round";
  x.strokeStyle = P.halo; x.lineWidth = 3.2; path(); x.stroke();
  x.strokeStyle = P.line; x.lineWidth = 1.5; path(); x.stroke();
}
function textOn(hex) {
  const c = parseInt(hex.slice(1), 16), r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140 ? "#121517" : "#F6F8F9";
}
function drawSections(x, P, w, h, f, St) {
  St.segs.forEach((sg, i) => {
    const a = tx(sg.t0, f, w), b = tx(sg.t1, f, w);
    const col = P.cat[sg.cls % P.cat.length];
    x.fillStyle = col; x.fillRect(a, 0, Math.max(1, b - a - (i < St.segs.length - 1 ? 1 : 0)), h);
    if (b - a >= 12 && h >= 10) {
      x.fillStyle = textOn(col); x.font = "600 " + Math.min(12, Math.max(9, h - 4)) + "px 'IBM Plex Sans', system-ui, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(sg.label, (a + b) / 2, h / 2 + 0.5);
    }
  });
}
function specColor(P, hz) {
  const t = Math.max(0, Math.min(1, (Math.log2(Math.max(20, hz)) - Math.log2(100)) / (Math.log2(8000) - Math.log2(100))));
  return P.spec6[Math.min(5, Math.round(t * 5))];
}
function drawSilhouette(x, P, w, h, v, cols) {
  const cw = w / cols, mir = S.shape === "mirror";
  for (let c = 0; c < cols; c++) {
    const val = Math.max(0, Math.min(1, v.c1[c]));
    if (val <= 0.002) continue;
    let tot = 0; for (let k = 0; k < 6; k++) tot += v.bands6[k][c];
    if (tot <= 1e-6) { x.fillStyle = P.dim; const a = val * (mir ? h / 2 - 0.5 : h - 1); x.fillRect(c * cw, mir ? h / 2 - a : h - a, Math.max(cw, 1), mir ? 2 * a : a); continue; }
    const A = val * (mir ? h / 2 - 0.5 : h - 1);
    let cum = 0;
    for (let k = 0; k < 6; k++) {
      const sh = v.bands6[k][c] / tot; if (sh <= 0) continue;
      const y0 = cum * A, y1 = (cum + sh) * A; cum += sh;
      x.fillStyle = P.spec6[k];
      if (mir) { x.fillRect(c * cw, h / 2 - y1, Math.max(cw, 1), y1 - y0 + 0.4); x.fillRect(c * cw, h / 2 + y0 - 0.4, Math.max(cw, 1), y1 - y0 + 0.4); }
      else x.fillRect(c * cw, h - y1, Math.max(cw, 1), y1 - y0 + 0.4);
    }
  }
}
function drawNanLine(x, w, h, vals, cols, style, width, dash, halo) {
  const cw = w / cols;
  const path = () => {
    x.beginPath(); let on = false;
    for (let c = 0; c < cols; c++) {
      const v = vals[c]; if (isNaN(v)) { on = false; continue; }
      const px = (c + 0.5) * cw, py = h - 1.5 - v * (h - 3);
      if (on) x.lineTo(px, py); else { x.moveTo(px, py); on = true; }
    }
  };
  x.lineJoin = "round"; x.lineCap = "round";
  if (halo) { x.setLineDash([]); x.strokeStyle = halo; x.lineWidth = width + 2; path(); x.stroke(); }
  x.setLineDash(dash || []); x.strokeStyle = style; x.lineWidth = width; path(); x.stroke(); x.setLineDash([]);
}
/* cross-field descriptor rows (src/descriptors.js) */
const MATCOL = P => [P.cat[0], P.cat[2], P.cat[1]];
function drawDesc(x, P, w, h, k, f, v, cols) {
  const D = v.D, cw = w / cols, clamp = a => Math.max(0, Math.min(1, a));
  const bar = (c, y0, y1, col) => { x.fillStyle = col; x.fillRect(c * cw, Math.min(y0, y1), Math.max(cw, 1), Math.max(0.5, Math.abs(y1 - y0))); };
  const yOf = u => h - 1.5 - u * (h - 3);
  const hline = (u, col, dash) => { x.strokeStyle = col; x.lineWidth = 1; x.setLineDash(dash || []); x.beginPath(); x.moveTo(0, Math.round(yOf(u)) + 0.5); x.lineTo(w, Math.round(yOf(u)) + 0.5); x.stroke(); x.setLineDash([]); };
  if (k === "n1") {   // kurtosis: 0 at a quarter height, -1 at the bottom, log above
    const u = K => K >= 0 ? 0.25 + 0.75 * Math.log1p(K) / Math.log1p(30) : 0.25 + 0.25 * Math.max(-1, K);
    for (let c = 0; c < cols; c++) { const K = D.kurtLoc[c]; if (!Number.isFinite(K)) continue; bar(c, yOf(0.25), yOf(u(K)), K > D.raw.kurtSig ? specColor(P, D.kurtHz[c] || 2000) : P.dim); }
    hline(0.25, P.mid); hline(u(D.raw.kurtSig), P.off, [2, 3]);
    return;
  }
  if (k === "n2") {
    const lo = Math.log(0.5), hi = Math.log(150);
    for (let c = 0; c < cols; c++) { const pr = D.repProm[c], hz = D.repHz[c]; if (!Number.isFinite(pr)) continue; const a = clamp((pr - 5) / 40); if (Number.isFinite(hz)) bar(c, h, yOf(a), rampRGB(P, clamp((Math.log(hz) - lo) / (hi - lo)))); else bar(c, h, yOf(a * 0.35), P.dim); }
    return;
  }
  if (k === "n3") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    for (const e of D.raw.events) { const x0 = tx(e.t0, f, w), x1 = Math.max(x0 + 1, tx(e.t1, f, w)), a = clamp((e.peakDb + 60) / 60); x.fillStyle = P.tick; x.globalAlpha = 0.55; x.fillRect(x0, yOf(a), x1 - x0, h - yOf(a)); x.globalAlpha = 1; x.fillRect(x0, yOf(a), 1, h - yOf(a)); }
    return;
  }
  if (k === "n4") {
    hline(0.5, P.mid);
    for (let c = 0; c < cols; c++) { const r = D.reshape[c]; if (Number.isFinite(r)) bar(c, h, yOf(clamp(r / 12) * 0.5), P.dim); }
    drawNanLine(x, w, h, Array.from(D.vel, s => Number.isFinite(s) ? 0.5 + 0.5 * Math.tanh(s / 3) : NaN), cols, P.line, 1.6, null, P.halo);
    return;
  }
  if (k === "n5") {
    for (let c = 0; c < cols; c++) { const s = D.cpp[c]; if (Number.isFinite(s)) bar(c, h, yOf(clamp((s - 12) / 30)), P.ink); }
    drawNanLine(x, w, h, D.pci, cols, P.line, 1.4, null, P.halo);
    return;
  }
  if (k === "n6") {
    hline(0.5, P.mid);
    for (let c = 0; c < cols; c++) { const t = D.arrow[c]; if (!Number.isFinite(t)) continue; const u = 0.5 + 0.5 * Math.tanh(t / 2); bar(c, yOf(0.5), yOf(u), t >= 0 ? P.cat[1] : P.cat[0]); }
    return;
  }
  if (k === "n7") {
    for (let c = 0; c < cols; c++) { const p = D.pir[c]; if (Number.isFinite(p)) bar(c, h, yOf(clamp(p / 0.8)), P.ink); }
    drawNanLine(x, w, h, Array.from(D.info, s => Number.isFinite(s) ? clamp(s / 0.3) : NaN), cols, P.line, 1.4, null, P.halo);
    return;
  }
  if (k === "n8") {
    for (let c = 0; c < cols; c++) { const d = D.dens[c]; if (Number.isFinite(d)) bar(c, h, yOf(clamp(d)), P.ink); }
    drawNanLine(x, w, h, D.lam, cols, P.line, 1.4, [3, 2], P.halo);
    return;
  }
  if (k === "n9") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    const lo = Math.log(0.02), hi = Math.log(5), MC = MATCOL(P);
    for (const d of D.raw.decays) { const x0 = tx(d.t, f, w), a = clamp((Math.log(Math.max(0.02, d.t60)) - lo) / (hi - lo)); x.fillStyle = d.cls >= 0 ? MC[d.cls] : P.off; x.fillRect(x0 - 1, yOf(a), 3, h - yOf(a)); x.fillRect(x0 - 3, yOf(a) - 1, 7, 3); }
    return;
  }
}
function drawKind(x, P, w, h, spec, f, v, C, cols, opts) {
  const R = v.R, St = v.St, E = v.E, X = v.X;
  if (spec.minDur && f.dur < spec.minDur) { drawOff(x, P, w, h, T("off.short", "Off for clips under {s} s", { s: spec.minDur })); return; }
  const k = spec.kind;
  if (k === "events") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    const sx = tx(E.start, f, w), ex = tx(E.end30, f, w);
    x.fillStyle = P.shade; if (sx > 0) x.fillRect(0, 0, sx, h); if (ex < w) x.fillRect(ex, 0, w - ex, h);
    const n = f.F.nF;
    vlines(x, w, h, f, R.onsetTimes, P.tick, 0.7, 1, t => { const m = Math.min(n - 1, Math.round(t / f.F.dt)); return 0.25 + 0.75 * Math.min(1, R.env[m] / f.envScale + 0.15); });
    vlines(x, w, h, f, [E.start, E.end30].filter(t => t > 0.001 && t < f.dur - 0.001), P.mark, 1, 2);
    return;
  }
  if (k === "dp") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    if (!R.beatTimes.length) { drawOff(x, P, w, h, T("off.noBeat", "No steady beat found")); return; }
    const beatPx = (60 / Math.max(1, R.tempo)) / f.dur * w;
    const n = f.F.nF, cl = t => R.clarity[Math.min(n - 1, Math.round(t / f.F.dt))];
    const aFn = t => cl(t) >= WL.RHYTHM.clarityMin ? 0.65 : 0.22;
    if (beatPx >= 3) vlines(x, w, h, f, R.beatTimes, P.tick, 0.6, 1, aFn);
    const dts = beatPx * 4 >= 3 ? R.downTimes : R.downTimes.filter((_, i) => i % 4 === 0);
    vlines(x, w, h, f, dts, P.tick, 1, 2, t => cl(t) >= WL.RHYTHM.clarityMin ? 1 : 0.35);
    return;
  }
  if (k === "plp") {
    drawValues(x, P, w, h, v.plp, cols, null, P.ink);
    const n = f.F.nF;
    const beatPx = (60 / Math.max(1, R.tempo || 120)) / f.dur * w;
    if (beatPx >= 3) vlines(x, w, h, f, R.plpTimes, P.tick, 0.5, 1, t => R.clarity[Math.min(n - 1, Math.round(t / f.F.dt))] >= WL.RHYTHM.clarityMin ? 0.55 : 0.18);
    return;
  }
  if (k === "clarity") {
    const tc = v.tempoN.map((t, i) => v.clar[i] >= WL.RHYTHM.clarityMin ? t : NaN);
    drawValues(x, P, w, h, v.clar, cols, tc, P.off);
    return;
  }
  if (k === "snov") {
    if (St.tooShort) { drawOff(x, P, w, h, T("off.noSections", "Too short for sections")); return; }
    drawValues(x, P, w, h, v.snov, cols, null, P.ink);
    vlines(x, w, h, f, St.bounds, P.mark, 1, 2);
    return;
  }
  if (k === "sections") {
    if (St.tooShort) { drawOff(x, P, w, h, T("off.noSections", "Too short for sections")); return; }
    drawSections(x, P, w, h, f, St);
    return;
  }
  if (/^n[1-9]$/.test(k)) { if (!v.D) { drawOff(x, P, w, h, T("off.notMeasured", "Not measured yet")); return; } drawDesc(x, P, w, h, k, f, v, cols); return; }
  if (["silhouette", "layers", "motion", "phases", "objects", "space", "checks", "d5"].includes(k) && !X) { drawOff(x, P, w, h, T("off.needsAudio", "Needs the decoded audio")); return; }
  if (k === "silhouette") { drawSilhouette(x, P, w, h, v, cols); return; }
  if (k === "layers") {
    if (!X.layers.length) { drawOff(x, P, w, h, T("off.noLayers", "No layers found")); return; }
    const order = X.layers.map((l, i) => i).sort((a, b) => X.layers[b].share - X.layers[a].share);
    const cw = w / cols;
    for (const i of order) {
      const col = specColor(P, X.layers[i].hz), act = v.layers[i];
      x.globalAlpha = 0.5; x.fillStyle = col;
      x.beginPath(); x.moveTo(0, h);
      for (let c = 0; c < cols; c++) x.lineTo((c + 0.5) * cw, h - Math.max(0, Math.min(1, act[c])) * (h - 2));
      x.lineTo(w, h); x.closePath(); x.fill();
      x.globalAlpha = 1; x.strokeStyle = col; x.lineWidth = 1.2;
      x.beginPath(); for (let c = 0; c < cols; c++) { const py = h - Math.max(0, Math.min(1, act[c])) * (h - 2); c ? x.lineTo((c + 0.5) * cw, py) : x.moveTo((c + 0.5) * cw, py); } x.stroke();
    }
    return;
  }
  if (k === "motion") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    const lo = Math.log2(50), hi = Math.log2(10000);
    x.font = "10px 'IBM Plex Mono', ui-monospace, monospace"; x.textBaseline = "middle"; x.textAlign = "left";
    for (const [fq, lab] of [[100, "100"], [1000, "1k"], [10000, "10k"]]) {
      const y = Math.round(h - 1.5 - (Math.log2(fq) - lo) / (hi - lo) * (h - 3)) + 0.5;
      x.fillStyle = P.mid; x.fillRect(0, y, w, 1);
      if (h >= 36 && y > 6 && y < h - 4) { x.fillStyle = P.off; x.fillText(lab, 3, y - 6); }
    }
    drawNanLine(x, w, h, v.centn, cols, P.ink, 1.2, [2, 3], null);
    drawNanLine(x, w, h, v.f0n, cols, P.line, 1.8, null, P.halo);
    return;
  }
  if (k === "phases") {
    const cw = w / cols, mir = S.shape === "mirror";
    const colr = [null, P.mark, P.ink, P.tail];
    for (let c = 0; c < cols; c++) {
      const ph = v.phase[c], val = Math.max(0, Math.min(1, v.c1[c]));
      if (!ph || val <= 0.002) continue;
      x.fillStyle = colr[ph];
      const A = val * (mir ? h / 2 - 0.5 : h - 1);
      if (mir) x.fillRect(c * cw, h / 2 - A, Math.max(cw, 1), 2 * A); else x.fillRect(c * cw, h - A, Math.max(cw, 1), A);
    }
    const tc = tx(X.tcent, f, w), s3 = Math.max(3, Math.min(5, h / 7));
    x.fillStyle = P.tick; x.beginPath(); x.moveTo(tc - s3, h); x.lineTo(tc + s3, h); x.lineTo(tc, h - s3 * 1.3); x.closePath(); x.fill();
    return;
  }
  if (k === "objects") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    const mc = { N: P.cat[0], X: P.cat[1], Y: P.cat[3] };
    X.events.forEach(e => {
      const a = tx(e.t0, f, w), b = Math.max(a + 2, tx(e.tEnd, f, w));
      x.globalAlpha = 0.3; x.fillStyle = mc[e.mass]; x.fillRect(a, 0, b - a, h);
      x.globalAlpha = 1; x.fillRect(a, 0, 2, h);
      if (e.grains.length > 1) { x.globalAlpha = 0.85; for (const g of e.grains) x.fillRect(tx(g, f, w), h - Math.max(3, h * 0.22), 1, Math.max(3, h * 0.22)); x.globalAlpha = 1; }
      if (b - a >= 18 && h >= 14) {
        x.fillStyle = P.tick; x.font = "600 " + Math.min(12, Math.max(10, h * 0.3)) + "px 'IBM Plex Sans', system-ui, sans-serif";
        x.textAlign = "left"; x.textBaseline = "top"; x.fillText(e.tag, a + 4, 2);
      }
    });
    return;
  }
  if (k === "space") {
    drawValues(x, P, w, h, v.c1, cols, null, P.dim);
    if (!X.stereo || X.identical) { if (h >= 13) { x.fillStyle = P.off; x.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(X.stereo ? T("off.identical", "Identical channels") : T("off.mono", "Mono"), w / 2, h / 2 + 0.5); } return; }
    const cw = w / cols, half = h / 2 - 2;
    x.fillStyle = P.mid; x.fillRect(0, Math.round(h / 2), w, 1);
    for (let c = 0; c < cols; c++) {
      if (!v.lvGate[c]) continue;
      const y = h / 2 + v.pan[c] * half, wd = Math.min(1, v.width[c]) * half;
      x.globalAlpha = 0.3; x.fillStyle = P.line; x.fillRect(c * cw, y - wd, Math.max(cw, 1), 2 * wd + 1); x.globalAlpha = 1;
    }
    const pv = Array.from(v.pan, (p, c) => v.lvGate[c] ? 0.5 - p * half / (h - 3) : NaN);
    drawNanLine(x, w, h, pv, cols, P.line, 1.8, null, P.halo);
    if (h >= 24) { x.fillStyle = P.off; x.font = "10px 'IBM Plex Mono', ui-monospace, monospace"; x.textAlign = "left"; x.textBaseline = "top"; x.fillText("L", 3, 2); x.textBaseline = "bottom"; x.fillText("R", 3, h - 1); }
    return;
  }
  if (k === "checks") {
    const pk = peaksOf(f, cols), cw = w / cols, mid = h / 2;
    x.fillStyle = P.dim;
    for (let c = 0; c < cols; c++) { const mx = Math.min(1, Math.max(pk.max[0][c], pk.max[1][c])), mn = Math.max(-1, Math.min(pk.min[0][c], pk.min[1][c])); x.fillRect(c * cw, mid - mx * (mid - 1), Math.max(cw, 1), Math.max(1, (mx - mn) * (mid - 1))); }
    x.fillStyle = P.mid; x.fillRect(0, Math.round(mid), w, 1);
    x.fillStyle = P.shade;
    const la = tx(X.lead, f, w), tb = tx(f.dur - X.trail, f, w);
    if (X.lead > 0.02) x.fillRect(0, 0, la, h);
    if (X.trail > 0.1) x.fillRect(tb, 0, w - tb, h);
    if (X.dc > 0.005) { x.fillStyle = P.bad; x.globalAlpha = 0.8; x.fillRect(0, Math.round(mid - X.dc * (mid - 1)) - 0.5, w, 1); x.globalAlpha = 1; }
    for (const m of X.marks) { x.fillStyle = P.bad; const px = Math.min(w - 2, Math.max(0, tx(m.t, f, w) - (m.kind === "end" ? 2 : 0))); x.fillRect(px, 0, m.kind === "clip" ? 1 : 2, h); }
    if (X.seam && !X.seam.ok) { x.fillStyle = P.bad; x.fillRect(w - 3, 0, 3, h); }
    return;
  }
  if (k === "d5") {
    drawSilhouette(x, P, w, h, v, cols);
    drawNanLine(x, w, h, v.f0n, cols, P.line, 1.4, null, P.halo);
    const s3 = Math.max(2.5, Math.min(4.5, h / 6));
    x.fillStyle = P.tick;
    for (const e of X.events) { const px = tx(e.t0, f, w) + 0.5; x.beginPath(); x.moveTo(px - s3, 0); x.lineTo(px + s3, 0); x.lineTo(px, s3 * 1.3); x.closePath(); x.fill(); }
    return;
  }
  if (k === "d4") {
    const rib = h >= 18 && !St.tooShort && St.segs.length > 1 ? Math.max(4, Math.round(h * 0.17)) : 0;
    if (rib) drawSections(x, P, w, rib, f, St);
    const top = rib ? rib + 1 : 0, ah = h - top;
    x.save(); x.translate(0, top);
    drawValues(x, P, w, ah, v.c1, cols, v.activity, P.ink);
    if (R.reliable && f.dur >= 5) {
      const barPx = (240 / Math.max(1, R.tempo)) / f.dur * w;
      if (barPx >= 5) vlines(x, w, ah, f, R.downTimes, P.bar, 1, 1);
    }
    if (C.harmony) drawLine(x, P, w, ah, v.c6, cols);
    if (C.surprise) drawTicks(x, P, w, ah, v.ticks, cols);
    x.restore();
    return;
  }
}
function drawStripFor(cv, spec, f, cols, h, P, opts) {
  opts = opts || {};
  const g = prep(cv, h), x = g.x, w = g.w;
  x.fillStyle = P.bg; x.fillRect(0, 0, w, h);
  if (!f || !f.F) return;
  if (spec.id === "compose" || spec.id === "compose-wave" || spec.id === "compose-spec") { drawCompose(x, P, w, h, f, spec.id === "compose-wave" ? "wave" : spec.id === "compose-spec" ? "spec" : null, opts.thumb); return; }
  const v = viewOf(f, cols);
  const C = WL.CLASSES[v.cls];
  if (!opts.thumb) drawSegLines(x, P, segCols(f, cols), h);
  if (spec.id === "unity") { drawUnity(x, P, w, h, peaksOf(f, cols), cols); return; }
  if (spec.kind) { drawKind(x, P, w, h, spec, f, v, C, cols, opts); return; }
  let hk, colk = null, ticks = false, solid = P.ink;
  if (spec.key) {
    hk = spec.key; ticks = !!spec.ticks;
    if (spec.needs && !C[spec.needs]) { drawOff(x, P, w, h, T("off.class", "Off for {cls}", { cls: midSentence(clsLabel(v.cls)) })); return; }
  } else {
    const d = spec.auto ? D3MAP[v.cls] : spec;
    hk = d.h; colk = d.col; ticks = !!d.ticks;
    if ((hk === "c5" && !C.tension) || (colk === "harmony" && !C.harmony)) { drawOff(x, P, w, h, T("off.class", "Off for {cls}", { cls: midSentence(clsLabel(v.cls)) })); return; }
  }
  if (!S.ghost || opts.thumb) {
    drawValues(x, P, w, h, v[hk], cols, colk ? v[colk] : null, solid);
  } else {
    drawValues(x, P, w, h, v[hk], cols, colk ? v[colk] : null, solid);
    drawOutline(x, P, w, h, peaksOf(f, cols), cols);
  }
  if (ticks && C.surprise) drawTicks(x, P, w, h, v.ticks, cols);
}
/* ---------------- composer: the user's own combination, drawn by Playhead.drawStrip ----------------
   The same renderer and look codes are used by SFX Workbench and kurator, so a combination found here can be
   pasted there, and sent with feedback. */
const PHAPI = window.Playhead || null;
const CMP_COLOURS = ["", "loudness", "activity", "arousal", "harshness", "timbreHarshness", "tension", "harmonicTension", "surprise"];
const CMP_LINES = ["", "loudness", "activity", "arousal", "harshness", "tension", "harmonicTension", "surprise", "structureNovelty", "localPulse", "onsetStrength", "n1Kurtosis", "n4Velocity", "n6Arrow", "n7Surprisal"];
const CMP_LANES = ["structureNovelty", "localPulse", "onsetStrength", "loudness", "activity", "arousal", "harshness", "timbreHarshness", "tension", "surprise", "n1Kurtosis", "n6Arrow", "n7Surprisal", "n8Recurrence"];
const CMP_MARKS = [["sections", "Sections"], ["downbeats", "Bar lines"], ["beats", "Beats"], ["onsets", "Onsets"], ["events", "Events"], ["novelty", "Novelty (top)"]];
const CMP_SCULPT = ["", "loudness", "arousal", "activity", "harshness", "tension", "onsetStrength", "localPulse"];
const CMP_MAX_LANES = 3, CMP_HEIGHTS = [64, 96, 128, 160, 192];
const CMP = { code: store.get("look", PHAPI ? PHAPI.looks.structure.code : ""), h: store.get("lookHeight", 128), refs: store.get("lookRefs", true) };
const CMP_BG = [["wave", "Waveform"], ["spec", "Spectrogram"], ["specwave", "Spectrogram with the waveform's outline"], ["none", "Nothing (curves only)"], ["raster", "Bar raster: a row per bar"], ["raster4", "Phrase raster: a row per 4 bars"], ["tempo", "Tempogram"], ["tempocyc", "Tempogram, octaves folded"], ["lag", "Repetition (lag view)"], ["mod", "Modulation spectrogram"], ["scale", "Curve rhythms (scalogram)"]];
// the views that show one chosen curve (the raster and the scalogram), and the curves offered for them
const CMP_VIEW_CURVES = ["onsetStrength", "loudness", "activity", "localPulse", "harshness", "timbreHarshness", "arousal", "tension", "surprise", "structureNovelty", "n1Kurtosis", "n7Surprisal"];
const cmpRaster = bg => bg === "raster" || bg === "raster4", cmpCurveView = bg => cmpRaster(bg) || bg === "scale";
// Playhead tempograms: the tempogram of a curve's rises (or of how fast all descriptors change), and a weighting curve
const CMP_TEMPO_OF = ["", "speed", "timbreHarshness", "harshness", "loudness", "tension", "activity", "n1Kurtosis"];
const CMP_TEMPO_W = ["", "loudness", "timbreHarshness", "harshness", "tension", "activity", "arousal"];
const cmpTempo = bg => bg === "tempo" || bg === "tempocyc";
const CMP_FORMS = [["lanes", "Separate, each in its own band"], ["overlay", "Overlaid on the waveform"]];
const CMP_SHAPES = [["base", "From the baseline"], ["mirror", "Mirrored, like a waveform"], ["horizon", "Horizon (folded bands)"], ["line", "Line"]];
const cmpLabel = k => k ? (PHAPI && PHAPI.curveLabels[k]) || k : T("cmp.none", "None");
const cmpOpts = (group, list) => list.map(([v, t]) => [v, T("cmp." + group + "." + v, t)]);
let cmpShow = null;
// look code <-> control state
function cmpState(code) {
  const st = { bg: "none", colour: "", line: "", lanes: [], signed: true, marks: new Set(), form: "lanes", shape: "base", sculpt: "", outline: false, vcurve: "onsetStrength", tof: "", tw: "" };
  let wave = false, spec = false, viewBg = "";
  for (const l of (PHAPI && PHAPI.parseLook(code)) || []) {
    if (l.type === "wave") { wave = true; st.colour = l.colour || ""; }
    else if (l.type === "spec" && l.of) { viewBg = l.of === "tempo" ? (l.cyclic ? "tempocyc" : "tempo") : l.of; if (l.curve) st.vcurve = l.curve; if (l.of === "tempo") { st.tof = l.source || ""; st.tw = l.weight || ""; } }
    else if (l.type === "raster") { viewBg = l.bars === 4 ? "raster4" : "raster"; st.vcurve = l.curve; }
    else if (l.type === "spec") spec = true;
    else if (l.type === "form") st.form = l.value;
    else if (l.type === "sculpt") st.sculpt = l.curve;
    else if (l.type === "outline") st.outline = true;
    else if (l.type === "shape") st.shape = l.value;
    else if (l.type === "line") st.line = l.curve;
    else if (l.type === "lane" && st.lanes.length < CMP_MAX_LANES) { st.lanes.push(l.curve); if (l.curve === "structureNovelty") st.signed = !!l.signed; }
    else if (l.type === "sections") st.marks.add("sections");
    else if (l.type === "ticks") for (const k of l.of) st.marks.add(k);
  }
  st.bg = viewBg || (spec && wave ? "specwave" : spec ? "spec" : wave ? "wave" : "none");
  return st;
}
function cmpCode(st) {
  const parts = [];
  if (cmpRaster(st.bg)) {      // the raster takes the whole strip: sections and the marks that fall inside bars
    parts.push("raster:" + st.vcurve + (st.bg === "raster4" ? "~4bars" : ""));
    if (st.marks.has("sections")) parts.push("sections");
    const dots = ["onsets", "events", "novelty"].filter(k => st.marks.has(k));
    if (dots.length) parts.push("ticks:" + dots.join("+"));
    return parts.join(",");
  }
  if (st.form === "overlay") parts.push("form:overlay");
  if (st.sculpt) parts.push("sculpt:" + st.sculpt);
  if (st.shape !== "base") parts.push("shape:" + st.shape);
  if (st.bg === "spec" || st.bg === "specwave") parts.push("spec");
  else if (st.bg === "tempo" || st.bg === "tempocyc") parts.push("spec:tempo" + (st.bg === "tempocyc" ? "~cyclic" : "") + (st.tof ? "~of:" + st.tof : "") + (st.tw ? "~w:" + st.tw : ""));
  else if (st.bg === "lag" || st.bg === "mod") parts.push("spec:" + st.bg);
  else if (st.bg === "scale") parts.push("scalogram:" + st.vcurve);
  if (st.bg === "wave" || st.bg === "specwave") parts.push("wave" + (st.bg === "wave" && st.colour ? ":" + st.colour : ""));
  if (st.marks.has("sections")) parts.push("sections");
  if (st.line) parts.push("line:" + st.line);
  for (const k of st.lanes) parts.push("lane:" + k + (k === "structureNovelty" && st.signed ? "~signed" : ""));
  const ticks = CMP_MARKS.map(m => m[0]).filter(k => k !== "sections" && st.marks.has(k));
  if (ticks.length) parts.push("ticks:" + ticks.join("+"));
  return parts.join(",");
}
// the look as drawn: the composer's code, with the peak outline when "Waveform outline" is on (the same switch as the
// lab's other strips use)
function cmpEffective(code) {
  const ls = (PHAPI && PHAPI.parseLook(code)) || [], has = ls.some(l => l.type === "outline");
  return S.ghost && !has ? (code ? code + "," : "") + "outline" : code;
}
// Playhead's strips in the panel's colours. The tint of a waveform runs through the panel's six spectral colours (cool
// to warm, each clear of the background), and spectrograms and views keep the library's magma ramp, whose black low
// end gives faint detail (a tempo's harmonics, a weak repeat) room to show, as in REAPER's strip window
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function themeOf(P) {
  const tint = P.spec6.map(hexRGB);
  return { background: null, wave: P.ink, waveLow: tint[0], waveHigh: tint[tint.length - 1], waveRamp: tint, line: P.line, tick: P.tick, text: P.rulerInk, rule: P.off,
    lane: P.cat[0], laneDown: P.cat[1], laneFlat: P.off, series: [P.cat[2], P.cat[4]], halo: P.halo, outline: P.outline };
}
// the Playhead document for a file, built once per asset class from the analysis the lab already has
function composeDoc(f) {
  const key = effClass(f);
  f.phDocs = f.phDocs || {};
  const have = f.phDocs[key];
  if (have) return have;
  const ent = f.phDocs[key] = { doc: null, err: null };
  PHAPI.fromAnalysis(f.F, f.buf, { profile: f.dur > 6 ? "music" : "sfx", assetClass: key, name: f.name })
    .then(d => { ent.doc = d; repaintSoon(); })
    .catch(e => { ent.err = e && e.message || String(e); console.error(e); repaintSoon(); });
  return ent;
}
let repaintQueued = false;
function repaintSoon() { if (repaintQueued) return; repaintQueued = true; requestAnimationFrame(() => { repaintQueued = false; render(); }); }
// look: null for the composer's look, or a fixed look for the comparison rows; thumb: library thumbnails (no legend)
function drawCompose(x, P, w, h, f, look, thumb) {
  if (!look && !thumb) x.canvas._raster = null;
  if (!PHAPI) { drawOff(x, P, w, h, T("off.noApi", "The Playhead API (src/playhead.js) is not loaded")); return; }
  const ent = composeDoc(f);
  if (!ent.doc) { drawOff(x, P, w, h, ent.err ? T("off.prepFailed", "Could not prepare this file: {err}", { err: ent.err }) : T("off.preparing", "Preparing…")); return; }
  const r = PHAPI.drawStrip(x, ent.doc, { width: w, height: h, look: look || cmpEffective(CMP.code), theme: themeOf(P) });
  if (!look && !thumb) { const ds = $("ds-compose"); if (ds) ds.textContent = r.legend; x.canvas._raster = r.raster ? r.raster.rows : null; }
}
function redrawCompose() {
  const ruler = scopes.find(s => s.spec.id === "ruler"), cols = Math.max(50, Math.floor(ruler.cv.clientWidth || 800));
  for (const sc of scopes) if (sc.group === "compose") drawStripFor(sc.cv, sc.spec, S.sel && S.sel.F ? S.sel : null, cols, CMP.h, PANELS[S.panel]);
  if (S.thumb === "compose") renderLibrary();
}
function showCompareRows() {
  for (const id of ["compose-wave", "compose-spec"]) {
    const cv = $("cv-" + id); if (!cv) continue;
    const scope = cv.closest(".scope"); scope.hidden = !CMP.refs; if (scope.previousElementSibling) scope.previousElementSibling.hidden = !CMP.refs;
  }
}
function buildComposer() {
  const box = $("composer");
  if (!box) return;
  box.innerHTML = "";
  if (!PHAPI) { box.textContent = T("cmp.noApi", "The composer needs src/playhead.js."); return; }
  const sel = (id, label, opts, title) => {
    const l = el("label", "ctl"); l.htmlFor = id; l.appendChild(document.createTextNode(label + " "));
    const s = el("select"); s.id = id; if (title) l.title = title;
    for (const [v, t] of opts) { const o = el("option", "", t); o.value = v; s.appendChild(o); }
    l.appendChild(s); return [l, s];
  };
  const lookOpts = [["", T("cmp.yourOwn", "Your own")]].concat(Object.entries(PHAPI.looks).map(([k, L]) => [k, L.name]));
  const [lLook, sLook] = sel("cmp-look", T("cmp.look", "Start from"), lookOpts, T("cmp.look.title", "Ready-made looks; changing anything below makes it your own"));
  const [lBg, sBg] = sel("cmp-bg", T("cmp.bg", "Behind"), cmpOpts("bg", CMP_BG), T("cmp.bg.title", "What the strip shows behind the curves: the waveform, a spectrogram, or nothing so the curves take the whole strip"));
  const [lCol, sCol] = sel("cmp-colour", T("cmp.colour", "Waveform colour"), CMP_COLOURS.map(k => [k, cmpLabel(k)]), T("cmp.colour.title", "A curve that tints the waveform, from the low to the high end of the colour ramp"));
  const [lVc, sVc] = sel("cmp-vcurve", T("cmp.vcurve", "Curve shown"), CMP_VIEW_CURVES.map(k => [k, cmpLabel(k)]), T("cmp.vcurve.title", "The curve the bar raster colours its rows with, or whose rhythms the scalogram shows"));
  const [lTof, sTof] = sel("cmp-tempo-of", T("cmp.tempoOf", "Tempogram of"), CMP_TEMPO_OF.map(k => [k, !k ? T("cmp.tempoOf.onsets", "Onsets (the usual)") : k === "speed" ? T("cmp.tempoOf.speed", "Change in all descriptors") : T("cmp.tempoOf.rises", "Rises in {curve}", { curve: cmpLabel(k) })]),
    T("cmp.tempoOf.title", "What the tempogram finds periods in: the onsets, as usual, or the rises of one curve, or how fast all the descriptors change together. Tempi stay true: only what is analysed changes."));
  const [lTw, sTw] = sel("cmp-tempo-w", T("cmp.tempoW", "Weighted by"), CMP_TEMPO_W.map(k => [k, !k ? T("cmp.tempoW.none", "Nothing") : cmpLabel(k)]),
    T("cmp.tempoW.title", "A curve that sets how strongly each moment of the tempogram is drawn: where it is low, the tempogram fades to grey, not black, so a quiet passage stays apart from one without a beat."));
  const [lForm, sForm] = sel("cmp-form", T("cmp.form", "Lanes"), cmpOpts("forms", CMP_FORMS), T("cmp.form.title", "Separate: each curve in its own band, like a stack of waveforms. Overlaid: the curves drawn on the waveform itself, to compare their shapes with it"));
  const [lShape, sShape] = sel("cmp-shape", T("cmp.shape", "Shape"), cmpOpts("shapes", CMP_SHAPES), T("cmp.shape.title", "How each lane's curve is drawn: filled from the baseline, mirrored around the middle like a waveform, folded into a horizon chart (compact), or as a line"));
  const [lH, sH] = sel("cmp-height", T("cmp.height", "Height"), CMP_HEIGHTS.map(v => [String(v), v + " px"]), T("cmp.height.title", "Height of the strips in this section"));
  const refL = el("label", "chk"), refs = el("input"); refs.type = "checkbox"; refs.id = "cmp-refs"; refL.htmlFor = "cmp-refs"; refL.append(refs, document.createTextNode(" " + T("cmp.refs", "Show the waveform and the spectrogram under it for comparison")));
  const [lLine, sLine] = sel("cmp-line", T("cmp.line", "Line"), CMP_LINES.map(k => [k, cmpLabel(k)]), T("cmp.line.title", "A curve drawn over the waveform"));
  const [lSc, sSc] = sel("cmp-sculpt", T("cmp.sculpt", "Waveform height from"), CMP_SCULPT.map(k => [k, k ? cmpLabel(k) : T("cmp.sculpt.none", "Peaks (ordinary)")]), T("cmp.sculpt.title", "Reshape the waveform: its envelope follows this curve while its detail stays. Loudness gives a waveform as loud as it sounds"));
  const olL = el("label", "chk"), outl = el("input"); outl.type = "checkbox"; outl.id = "cmp-outline"; olL.htmlFor = "cmp-outline"; olL.append(outl, document.createTextNode(" " + T("cmp.outline", "Waveform outline")));
  olL.title = T("cmp.outline.title", "The ordinary peak waveform as a contour over the strip; the same switch as in the top bar");
  const lanes = el("fieldset"); lanes.appendChild(el("legend", "", T("cmp.lanes", "Curves (up to {n})", { n: CMP_MAX_LANES })));
  const laneBoxes = CMP_LANES.map(k => { const l = el("label", "chk"), c = el("input"); c.type = "checkbox"; c.value = k; l.appendChild(c); l.appendChild(document.createTextNode(" " + cmpLabel(k))); lanes.appendChild(l); return c; });
  const sl = el("label", "chk"), signed = el("input"); signed.type = "checkbox"; sl.appendChild(signed);
  sl.appendChild(document.createTextNode(" " + T("cmp.signed", "Structural change: up where the sound enters, down where it falls away or breaks off")));
  sl.title = T("cmp.signed.title", "Change curves are direction-free: a break into silence is as new as an entry. With this on, the lane shows which way the level goes, so a break never reads as more.");
  lanes.appendChild(sl);
  const marks = el("fieldset"); marks.appendChild(el("legend", "", T("cmp.marks", "Marks")));
  const markBoxes = cmpOpts("marks", CMP_MARKS).map(([k, t]) => { const l = el("label", "chk"), c = el("input"); c.type = "checkbox"; c.value = k; l.appendChild(c); l.appendChild(document.createTextNode(" " + t)); marks.appendChild(l); return c; });
  const codeRow = el("div", "cmp-code");
  const cl = el("label", "ctl"); cl.htmlFor = "cmp-code"; cl.appendChild(document.createTextNode(T("cmp.code", "Look code") + " "));
  const code = el("input"); code.id = "cmp-code"; code.spellcheck = false; code.title = T("cmp.code.title", "Paste a look code and press Enter. The same codes work in SFX Workbench and kurator.");
  cl.appendChild(code);
  const copy = el("button", "", T("cmp.copy", "Copy")); copy.type = "button";
  const fb = el("a", "", T("cmp.feedback", "Tell us if this helps")); fb.target = "_blank"; fb.rel = "noopener";
  codeRow.append(cl, copy, fb);
  const row1 = el("div", "cmp-row"), row2 = el("div", "cmp-row");
  row1.append(lLook, lBg, lVc, lTof, lTw, lCol, lSc, lLine, olL);
  row2.append(lForm, lShape, lH, refL);
  box.append(row1, lanes, row2, marks, codeRow);

  const show = () => {
    const st = cmpState(CMP.code), raster = cmpRaster(st.bg);
    sBg.value = st.bg; sCol.value = st.colour; sCol.disabled = st.bg !== "wave"; sLine.value = st.line; signed.checked = st.signed;
    sVc.value = st.vcurve; lVc.hidden = !cmpCurveView(st.bg);
    sTof.value = st.tof; sTw.value = st.tw; lTof.hidden = lTw.hidden = !cmpTempo(st.bg);
    sSc.value = st.sculpt; sSc.disabled = st.bg !== "wave" && st.bg !== "specwave"; outl.checked = !!S.ghost;
    sForm.value = st.form; sShape.value = st.shape; sH.value = String(CMP.h); refs.checked = CMP.refs;
    // on the raster, time runs in rows: curves, lines and the beat marks have no place there
    sLine.disabled = sForm.disabled = sShape.disabled = raster;
    laneBoxes.forEach(c => { c.checked = st.lanes.includes(c.value); c.disabled = raster || (!c.checked && st.lanes.length >= CMP_MAX_LANES); });
    signed.disabled = raster || !st.lanes.includes("structureNovelty");
    markBoxes.forEach(c => { c.checked = st.marks.has(c.value); c.disabled = raster && (c.value === "beats" || c.value === "downbeats"); });
    const norm = c => String(c || "").split(",").sort().join(","), eff = norm(cmpEffective(CMP.code));
    const named = Object.entries(PHAPI.looks).find(([, L]) => L.code && (norm(L.code) === norm(CMP.code) || norm(L.code) === eff));
    sLook.value = named ? named[0] : "";
    code.value = cmpEffective(CMP.code);
    fb.href = "https://github.com/eigensoundlab/playhead/issues/new?template=look-feedback.yml&title=" + encodeURIComponent("Look feedback: " + cmpEffective(CMP.code)) + "&look=" + encodeURIComponent(cmpEffective(CMP.code)) + "&app=" + encodeURIComponent("Playhead app");
  };
  // a code with an outline turns "Waveform outline" on; the stored code keeps the rest
  const set = c => {
    const ls = PHAPI.parseLook(c) || [];
    if (ls.some(l => l.type === "outline")) { S.ghost = true; store.set("ghost", true); $("ghost").checked = true; c = PHAPI.lookCode(ls.filter(l => l.type !== "outline")); }
    CMP.code = c; store.set("look", c); show(); render();
  };
  const fromControls = () => {
    const st = { bg: sBg.value, colour: sCol.value, line: sLine.value, signed: signed.checked, form: sForm.value, shape: sShape.value, sculpt: sSc.value, vcurve: sVc.value, tof: cmpTempo(sBg.value) ? sTof.value : "", tw: cmpTempo(sBg.value) ? sTw.value : "",
      lanes: CMP_LANES.filter(k => laneBoxes.find(c => c.value === k).checked).slice(0, CMP_MAX_LANES), marks: new Set(markBoxes.filter(c => c.checked).map(c => c.value)) };
    set(cmpCode(st));
  };
  sLook.addEventListener("change", () => {
    const L = PHAPI.looks[sLook.value];
    if (!L) return;
    // the automatic look depends on the file: take what it draws for the selected one (or for music when none is open)
    const f = S.sel, ent = f && f.F && f.phDocs && f.phDocs[effClass(f)];
    set(L.code || PHAPI.lookCode(PHAPI.parseLook(ent && ent.doc && (ent.doc.profile === "sfx") ? "wave:harshness,line:activity,ticks:events" : "wave:activity,sections,line:tension,ticks:downbeats+events")));
  });
  [sBg, sVc, sTof, sTw, sCol, sLine, sSc, sForm, sShape, signed, ...laneBoxes, ...markBoxes].forEach(c => c.addEventListener("change", fromControls));
  outl.addEventListener("change", () => { S.ghost = outl.checked; store.set("ghost", S.ghost); $("ghost").checked = S.ghost; show(); render(); });
  cmpShow = show;   // the top bar's outline switch (hooked once, at start) updates this composer
  sH.addEventListener("change", () => { CMP.h = parseInt(sH.value, 10) || 128; store.set("lookHeight", CMP.h); redrawCompose(); });
  refs.addEventListener("change", () => { CMP.refs = refs.checked; store.set("lookRefs", CMP.refs); showCompareRows(); redrawCompose(); });
  code.addEventListener("change", () => { const ls = PHAPI.parseLook(code.value); if (ls && ls.length) set(PHAPI.lookCode(ls)); else show(); });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(CMP.code); copy.textContent = T("ui.copied", "Copied"); }
    catch (e) { code.focus(); code.select(); copy.textContent = T("ui.selectCopy", "Selected, now copy it"); }
    setTimeout(() => { copy.textContent = T("cmp.copy", "Copy"); }, 2000);
  });
  show();
  showCompareRows();
}

/* ---------------- tracks in a folder: layering files as in a DAW ----------------
   Up to three tracks under a folder track, each holding one clip (a library file) that can be dragged in time. The
   folder shows the whole: combined from the tracks' Playhead documents at once (Playhead.combine, no new analysis), or
   from the analysed mix for reference; the other folder views show which track carries what. A folder track in a DAW
   could draw any of these. All tracks and the mix share one profile, asset class and curve rate, so they compare. */
const TR_N = 3, TR_VIEWS = ["combined", "mix", "stack", "owner", "shared"], TR_HEIGHTS = [40, 64, 96, 128];
const TR = {
  tracks: Array.from({ length: TR_N }, () => ({ fid: null, off: 0, gain: 0, mute: false, solo: false })),
  view: store.get("trView", "combined"), look: store.get("trLook", "auto"), cls: "auto", h: store.get("trHeight", 64),
  snap: store.get("trSnap", true), compare: store.get("trCompare", false), collapsed: false,
  span: 0, ver: 0, started: false, memo: null, mix: null, mixTimer: 0, visible: false, pos: 0, play: null, audio: null, drag: null, rows: null, raf: 0, legend: "", files: ""
};
if (!TR_VIEWS.includes(TR.view)) TR.view = "combined";
const trViewName = v => ({
  combined: T("tracks.view.combined", "Combined from the tracks (instant)"), mix: T("tracks.view.mix", "Analysed mix (reference)"),
  stack: T("tracks.view.stack", "Each track's share"), owner: T("tracks.view.owner", "Loudest track in each band"), shared: T("tracks.view.shared", "Bands two tracks share")
})[v];
const trViewDesc = v => ({
  combined: T("tracks.view.combined.desc", "The tracks' look, combined from their Playhead documents without analysing the mix. Instant, so it follows every move."),
  mix: T("tracks.view.mix.desc", "The tracks' look on the mix itself, analysed like any file a moment after the tracks stop moving. The reference for the combined view."),
  stack: T("tracks.view.stack.desc", "Height is the loudness of the whole. Inside, each track's share of the sound energy in the track's colour, the first track in the middle."),
  owner: T("tracks.view.owner.desc", "A spectrogram of the whole, each cell in the colour of the track that is loudest there. Brighter is louder."),
  shared: T("tracks.view.shared.desc", "A spectrogram of the whole, highlighted where two tracks are within 6 dB of each other in the same band: where one may mask the other.")
})[v];
const trColour = (P, k) => [P.cat[0], P.cat[1], P.cat[3]][k % 3];
const trFile = t => (t && t.fid != null ? S.files.find(f => f.id === t.fid && f.F) || null : null);
const trHex = c => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || ""); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128]; };
const trAudible = (t, anySolo) => !!trFile(t) && !t.mute && (!anySolo || t.solo);
function trChanged(files) {        // anything that changes the whole: a new arrangement version
  TR.ver++; TR.memo = null;
  if (files) { TR.span = trSpan(); for (const t of TR.tracks) { const f = trFile(t); if (f) t.off = Math.max(0, Math.min(t.off, TR.span - f.dur)); } }
  trDraw();
}
// the timeline: half as long again as the longest clip, so clips can move; it changes only when the files do
function trSpan() {
  const fs = TR.tracks.map(trFile).filter(Boolean);
  if (!fs.length) return 0;
  const L = Math.max(...fs.map(f => f.dur));
  return Math.max(L * 1.5, L + 0.5);
}
// one profile, class and curve rate for every track and the mix: short sessions as sound effects at 100 columns/s
function trSettings() {
  const fs = TR.tracks.map(trFile).filter(Boolean), short = TR.span <= 10;
  const longest = fs.reduce((a, f) => (!a || f.dur > a.dur ? f : a), null);
  const cls = TR.cls !== "auto" ? TR.cls : short ? "sfx" : longest ? longest.F.guess : "rhythmic";
  return { profile: short ? "sfx" : "music", rate: short ? 100 : 20, cls };
}
function trDoc(f, st) {
  const key = st.cls + "|" + st.profile + "|" + st.rate;
  f.trDocs = f.trDocs || {};
  if (f.trDocs[key]) return f.trDocs[key];
  const ent = f.trDocs[key] = { doc: null, err: null };
  PHAPI.fromAnalysis(f.F, f.buf, { profile: st.profile, assetClass: st.cls, curveRate: st.rate, name: f.name })
    .then(d => { ent.doc = d; TR.memo = null; trDraw(); })
    .catch(e => { ent.err = (e && e.message) || String(e); console.error(e); TR.memo = null; trDraw(); });
  return ent;
}
// the audible tracks as parts, their alignment and the combined document (kept until something changes)
function trArrangement() {
  if (TR.memo && TR.memo.ver === TR.ver) return TR.memo;
  const st = trSettings(), anySolo = TR.tracks.some(t => t.solo && trFile(t)), parts = [];
  let pending = false, err = null;
  TR.tracks.forEach((t, k) => {
    const f = trFile(t); if (!f) return;
    const ent = trDoc(f, st);
    if (ent.err) err = ent.err; else if (!ent.doc) pending = true;
    if (ent.doc && trAudible(t, anySolo)) parts.push({ doc: ent.doc, offset: t.off, gain: t.gain, k, f });
  });
  const m = { ver: TR.ver, st, parts, pending, err, anySolo, A: null, doc: null, end: 0 };
  if (!pending && parts.length) {
    m.end = Math.max(...parts.map(p => p.offset + p.doc.source.duration));
    m.A = PHAPI.align(parts, { rate: st.rate, duration: m.end });
    m.doc = PHAPI.combine(parts, { rate: st.rate, duration: m.end, aligned: m.A, name: T("tracks.mixName", "folder mix") });
  }
  return (TR.memo = m);
}
// the audible tracks summed at their positions and gains (resampled to the first track's rate where rates differ)
function trRender(m) {
  const sr = m.parts[0].f.buf.sampleRate, n = Math.max(1, Math.round(m.end * sr));
  const nch = Math.max(...m.parts.map(p => Math.min(2, p.f.buf.numberOfChannels))), chans = Array.from({ length: nch }, () => new Float32Array(n));
  for (const p of m.parts) {
    const b = p.f.buf, a = Math.pow(10, p.gain / 20), ratio = b.sampleRate / sr, i0 = Math.round(p.offset * sr), len = b.length;
    for (let c = 0; c < nch; c++) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1)), out = chans[c];
      for (let i = Math.max(0, i0); i < n; i++) {
        const x = (i - i0) * ratio, j = Math.floor(x); if (j >= len) break;
        out[i] += a * (ratio === 1 ? src[j] : src[j] + (src[Math.min(len - 1, j + 1)] - src[j]) * (x - j));
      }
    }
  }
  return { sampleRate: sr, numberOfChannels: nch, length: n, duration: n / sr, getChannelData: c => chans[c] };
}
// the analysed mix: a moment after the last change, and only while the section is on screen
function trScheduleMix() { clearTimeout(TR.mixTimer); TR.mixTimer = setTimeout(trRunMix, 900); }
async function trRunMix() {
  if (!TR.visible || TR.drag) return;
  const m = trArrangement();
  if (m.pending || !m.parts.length || (TR.mix && TR.mix.ver === m.ver)) return;
  const me = TR.mix = { ver: m.ver, doc: null, err: null, agree: null };
  trDraw();
  try {
    const rec = { buf: trRender(m), name: T("tracks.mixName", "folder mix") };
    let F = null;
    if (await poolReady()) { try { F = await analyseInWorker(rec, () => {}); } catch (e) { if (!e.fallback) throw e; } }
    if (!F) { F = await analyseOnMainThread(rec); if (!S.active) setStatus(""); }
    const doc = await PHAPI.fromAnalysis(F, rec.buf, { profile: m.st.profile, assetClass: m.st.cls, curveRate: m.st.rate, name: rec.name });
    if (TR.mix !== me) return;
    me.doc = doc; me.agree = trAgreement(m.doc, doc);
  } catch (e) { if (TR.mix === me) { me.err = (e && e.message) || String(e); console.error(e); } }
  if (TR.mix === me) trDraw();
}
function trPearson(a, b) {
  const n = a.length; if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : NaN;
}
function trFmeasure(est, ref, tol) {
  const used = new Uint8Array(ref.length); let hit = 0;
  for (const e of est) { let best = -1, bd = tol; ref.forEach((r, j) => { const d = Math.abs(r - e); if (!used[j] && d <= bd) { bd = d; best = j; } }); if (best >= 0) { used[best] = 1; hit++; } }
  const p = est.length ? hit / est.length : 0, r = ref.length ? hit / ref.length : 0;
  return p + r ? 2 * p * r / (p + r) : est.length || ref.length ? 0 : NaN;
}
// how closely the combined folder follows the analysed mix, over the columns where the mix sounds (as in experiments/compose)
function trAgreement(c, m) {
  const n = Math.min(c.curves.lufs.length, m.curves.lufs.length), idx = [];
  for (let i = 0; i < n; i++) if (m.curves.lufs[i] != null && (m.curves.loudness[i] || 0) > 0.02) idx.push(i);
  const r = k => (c.curves[k] && m.curves[k] && m.curves[k].some(v => v)) ? trPearson(idx.map(i => c.curves[k][i] || 0), idx.map(i => m.curves[k][i] || 0)) : NaN;
  const out = ["loudness", "activity", "harshness"].map(k => ({ k, label: PHAPI.curveLabels[k] || k, r: r(k) }));
  out.push({ k: "onsets", label: T("tracks.onsets", "onsets"), f: trFmeasure(c.onsets || [], m.onsets || [], 0.05) });
  return out.filter(o => isFinite(o.r != null ? o.r : o.f));
}
function trLookCode() {
  if (TR.look === "compose") return cmpEffective(CMP.code);
  const L = PHAPI.looks[TR.look];
  // the automatic look as the composer resolves it: sound effects or music, by the section's profile
  return cmpEffective(L && L.code ? L.code : trSettings().profile === "sfx" ? "wave:harshness,line:activity,ticks:events" : "wave:activity,sections,line:tension,ticks:downbeats+events");
}

/* drawing */
function trDraw() { if (TR.raf || !TR.rows) return; TR.raf = requestAnimationFrame(() => { TR.raf = 0; trPaint(); }); }
function trStep() { const w = TR.rows ? TR.rows.ruler.cv.clientWidth || 600 : 600; for (const s of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s / TR.span * w >= 70) return s; return 300; }
function trGrid(x, P, w, h) {
  if (!TR.span) return;
  const step = trStep(); x.fillStyle = P.seg;
  for (let t = step; t < TR.span; t += step) x.fillRect(Math.round(t / TR.span * w), 0, 1, h);
}
function trOff(x, P, w, h, text) { drawOff(x, P, w, h, text); }
function trPaint() {
  const P = PANELS[S.panel], h = TR.h, m = trArrangement(), rows = TR.rows;
  // the ruler
  { const g = prep(rows.ruler.cv, 22), x = g.x, w = g.w; x.fillStyle = P.bg; x.fillRect(0, 0, w, 22);
    if (TR.span) { const step = trStep(); x.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; x.textBaseline = "middle"; x.textAlign = "left"; x.fillStyle = P.rulerInk;
      for (let t = 0; t <= TR.span + 1e-9; t += step) { const px = Math.round(t / TR.span * w); x.globalAlpha = 0.6; x.fillRect(px, 15, 1, 7); x.globalAlpha = 1; if (px < w - 34) x.fillText(fmtT(t, step < 1), px + 4, 9); } } }
  TR.legend = "";
  const r = trFolder(rows.folder.cv, TR.view, P, h, m);
  if (r && r.legend) TR.legend = r.legend;
  for (const v of TR_VIEWS) { const row = rows.views[v]; if (!row.lab.hidden) trFolder(row.cv, v, P, h, m); }
  TR.tracks.forEach((t, k) => { if (!rows.tracks[k].lab.hidden) trTrack(k, P, h, m); });
  trLabels(m);
  trHead();
  if (!m.pending && m.parts.length && !(TR.mix && TR.mix.ver === m.ver)) trScheduleMix();
}
function trFolder(cv, view, P, h, m) {
  const g = prep(cv, h), x = g.x, w = g.w;
  x.fillStyle = P.bg; x.fillRect(0, 0, w, h);
  if (!TR.span) return trOff(x, P, w, h, T("tracks.noFiles", "Choose files for the tracks below"));
  if (m.err) return trOff(x, P, w, h, T("off.prepFailed", "Could not prepare this file: {err}", { err: m.err }));
  if (m.pending) return trOff(x, P, w, h, T("off.preparing", "Preparing…"));
  if (!m.parts.length) return trOff(x, P, w, h, T("tracks.allMuted", "Every track is muted"));
  trGrid(x, P, w, h);
  const ew = m.end / TR.span * w;
  if (view === "combined") return PHAPI.drawStrip(x, m.doc, { width: ew, height: h, look: trLookCode(), theme: themeOf(P) });
  if (view === "mix") {
    const mx = TR.mix;
    if (!mx || mx.ver !== m.ver || !mx.doc) return trOff(x, P, w, h, mx && mx.ver === m.ver && mx.err ? T("tracks.mixFailed", "Could not analyse the mix: {err}", { err: mx.err }) : T("tracks.mixWait", "Analysing the mix…"));
    return PHAPI.drawStrip(x, mx.doc, { width: mx.doc.source.duration / TR.span * w, height: h, look: trLookCode(), theme: themeOf(P) });
  }
  const cols = m.parts.map(p => trColour(P, p.k));
  if (view === "stack") {         // mirrored like a waveform: height the whole's loudness, bands each track's share of the energy
    const A = m.A, C = A.columns, mid = h / 2, n = A.parts.length, W = Math.max(1, Math.floor(ew)), pw = new Float64Array(n);
    for (let px = 0; px < W; px++) {
      const c0 = Math.floor(px / W * C), c1 = Math.max(c0 + 1, Math.floor((px + 1) / W * C));
      let tot = 0; pw.fill(0);
      for (let c = c0; c < c1 && c < C; c++) for (let i = 0; i < n; i++) pw[i] += A.parts[i].power[c];
      for (let i = 0; i < n; i++) tot += pw[i];
      if (tot <= 0) continue;
      const half = Math.max(0, Math.min(1, (10 * Math.log10(tot / (c1 - c0)) + 60) / 60)) * (mid - 0.5);
      let r = 0;
      for (let i = 0; i < n; i++) { const th = pw[i] / tot * half; if (th <= 0) continue; x.fillStyle = cols[i]; x.fillRect(px, mid - r - th, 1, th); x.fillRect(px, mid + r, 1, th); r += th; }
    }
    return null;
  }
  // owner and shared: spectrogram cells coloured by the tracks' power in them
  const A = m.A, B = A.bands, C = A.columns, n = A.parts.length;
  if (!B) return trOff(x, P, w, h, T("tracks.noSpec", "No spectrogram in this analysis"));
  const tot = new Float64Array(C * B); let top = 0;
  for (const p of A.parts) for (let i = 0; i < tot.length; i++) tot[i] += p.spectrum[i];
  for (let i = 0; i < tot.length; i++) if (tot[i] > top) top = tot[i];
  if (!(top > 0)) return null;
  const topDb = 10 * Math.log10(top), range = 60, bg = trHex(P.bg), ink = trHex(P.ink), hi = trHex(P.mark), tc = cols.map(trHex), share = Math.pow(10, 6 / 10);
  const img = document.createElement("canvas"); img.width = C; img.height = B;
  const ig = img.getContext("2d"), id = ig.createImageData(C, B);
  const put = (o, a, b, u) => { id.data[o] = a[0] + (b[0] - a[0]) * u; id.data[o + 1] = a[1] + (b[1] - a[1]) * u; id.data[o + 2] = a[2] + (b[2] - a[2]) * u; id.data[o + 3] = 255; };
  for (let c = 0; c < C; c++) for (let b = 0; b < B; b++) {
    const i = c * B + b, o = ((B - 1 - b) * C + c) * 4, t = tot[i];
    if (!(t > 0)) { put(o, bg, bg, 0); continue; }
    const u = Math.max(0, Math.min(1, (10 * Math.log10(t) - topDb + range) / range));
    let p1 = 0, p2 = 0, k1 = 0;
    for (let k = 0; k < n; k++) { const v = A.parts[k].spectrum[i]; if (v > p1) { p2 = p1; p1 = v; k1 = k; } else if (v > p2) p2 = v; }
    if (view === "owner") put(o, bg, tc[k1], Math.pow(u, 0.8));
    else if (p2 > 0 && p1 / p2 <= share && 10 * Math.log10(p2) >= topDb - 45) put(o, bg, hi, Math.max(0.35, u));
    else put(o, bg, ink, 0.4 * u);
  }
  ig.putImageData(id, 0, 0);
  const sm = x.imageSmoothingEnabled; x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, C, B, 0, 0, ew, h);
  x.imageSmoothingEnabled = sm;
  return null;
}
function trTrack(k, P, h, m) {
  const row = TR.rows.tracks[k], t = TR.tracks[k], f = trFile(t), g = prep(row.cv, h), x = g.x, w = g.w;
  x.fillStyle = P.bg; x.fillRect(0, 0, w, h);
  if (!f || !TR.span) return trOff(x, P, w, h, T("tracks.empty", "Empty track: choose a file on the left"));
  trGrid(x, P, w, h);
  const ent = trDoc(f, m.st), x0 = t.off / TR.span * w, cw = Math.max(3, f.dur / TR.span * w);
  x.save();
  x.beginPath(); x.rect(x0, 0, cw, h); x.clip();
  x.fillStyle = P.seg; x.fillRect(x0, 0, cw, h);
  if (ent.doc) {
    // the clip's own drawing does not change while it moves: drawn once, then copied to its place
    const dpr = window.devicePixelRatio || 1, look = trLookCode(), key = [look, cw.toFixed(2), h, dpr, S.panel].join("|");
    if (!row.cache || row.cache.doc !== ent.doc || row.cache.key !== key) {
      const img = document.createElement("canvas"); img.width = Math.max(1, Math.round(cw * dpr)); img.height = Math.round(h * dpr);
      const ix = img.getContext("2d"); ix.scale(dpr, dpr);
      const r = PHAPI.drawStrip(ix, ent.doc, { width: cw, height: h, look, theme: themeOf(P) });
      row.cache = { doc: ent.doc, key, img, legend: r && r.legend };
    }
    x.drawImage(row.cache.img, x0, 0, cw, h);
    if (!TR.legend && row.cache.legend) TR.legend = row.cache.legend;
  }
  x.fillStyle = trColour(P, k); x.fillRect(x0, 0, cw, 2);
  if (h >= 24 && cw > 40) {
    x.font = "10.5px 'IBM Plex Sans', system-ui, sans-serif"; x.textAlign = "left"; x.textBaseline = "top";
    x.lineWidth = 3; x.strokeStyle = P.halo; x.strokeText(f.name, x0 + 4, 4); x.fillStyle = P.rulerInk; x.fillText(f.name, x0 + 4, 4);
  }
  if (!trAudible(t, m.anySolo)) { x.fillStyle = P.shade; x.fillRect(x0, 0, cw, h); }
  x.restore();
  x.strokeStyle = trColour(P, k); x.lineWidth = 1; x.globalAlpha = TR.drag && TR.drag.k === k ? 0.9 : 0.45;
  x.strokeRect(x0 + 0.5, 0.5, cw - 1, h - 1); x.globalAlpha = 1;
  if (!ent.doc) { x.fillStyle = P.off; x.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; x.textBaseline = "middle"; x.fillText(ent.err ? T("off.prepFailed", "Could not prepare this file: {err}", { err: ent.err }) : T("off.preparing", "Preparing…"), x0 + 6, h / 2); }
}
// labels that follow the arrangement: the folder's legend and agreement, each track's position
function trLabels(m) {
  const rows = TR.rows;
  rows.cls.options[0].textContent = TR.span ? T("ui.cls.autoOf", "Auto ({cls})", { cls: clsLabel(trSettings().cls) }) : T("ui.cls.auto", "Auto");
  rows.folder.desc.textContent = trViewDesc(TR.view);
  rows.folder.legend.textContent = TR.legend;
  const ml = rows.folder.meta; ml.innerHTML = "";
  const mx = TR.mix;
  if (mx && mx.ver === m.ver && mx.agree && mx.agree.length) {
    const lab = el("span", "mut", T("tracks.agree", "Combined vs analysed mix:")); lab.title = T("tracks.agree.title", "How closely the combined folder follows the analysed mix: the correlation of each curve (1 is the same shape) and the F-measure of the onsets (±50 ms)");
    ml.appendChild(lab);
    for (const a of mx.agree) {
      const v = a.r != null ? a.r : a.f, b = el("span", "badge " + (v >= 0.9 ? "new" : v >= 0.7 ? "mid" : "dep"), a.label + (a.r != null ? " r" : " F"));
      b.appendChild(el("b", "", dec(v.toFixed(2)))); b.title = lab.title; ml.appendChild(b);
    }
  } else if (m.parts.length && !m.pending) ml.appendChild(el("span", "mut", T("tracks.agreeBusy", "Analysing the mix to check the combination…")));
  TR.tracks.forEach((t, k) => {
    const r = rows.tracks[k], f = trFile(t);
    r.at.textContent = f ? T("tracks.at", "starts at {t} s", { t: dec(t.off.toFixed(3)) }) : "";
    r.cv.setAttribute("aria-label", f ? T("tracks.aria.track", "Track {n}: {file}. Drag the clip or use the arrow keys to move it; double-click opens the file above.", { n: k + 1, file: f.name }) : T("tracks.empty", "Empty track: choose a file on the left"));
    if (f) { r.cv.setAttribute("aria-valuemin", "0"); r.cv.setAttribute("aria-valuemax", (TR.span - f.dur).toFixed(3)); r.cv.setAttribute("aria-valuenow", t.off.toFixed(3)); r.cv.setAttribute("aria-valuetext", r.at.textContent); }
    r.mute.setAttribute("aria-pressed", String(t.mute)); r.solo.setAttribute("aria-pressed", String(t.solo));
  });
}

/* transport: the section's own player, sharing the lab's audio (starting either stops the other) */
const trNow = () => (TR.play ? TR.play.from + (ctx().currentTime - TR.play.startAt) : TR.pos);
function trHead() {
  if (!TR.rows) return;
  const t = Math.min(trNow(), TR.span || 0), on = !!TR.play || t > 0;
  for (const s of TR.rows.scopes) { if (!s.ph) continue; s.ph.classList.toggle("on", on && !!TR.span); s.ph.style.transform = "translateX(" + (TR.span ? t / TR.span * s.w.clientWidth : 0) + "px)"; }
  TR.rows.time.textContent = fmtT(t, true);
  TR.rows.play.textContent = TR.play ? T("ui.pause", "Pause") : T("ui.play", "Play");
}
function trStop() {
  if (!TR.play) return;
  const p = TR.play; TR.pos = Math.min(trNow(), TR.span);
  TR.play = null; cancelAnimationFrame(p.raf);
  try { p.src.onended = null; p.src.stop(); } catch (e) { /* stopped */ }
  p.src.disconnect(); trHead();
}
function trPlay(from) {
  const m = trArrangement();
  if (m.pending || !m.parts.length) return;
  stopAudio();          // the lab's player and the bench; this also stops this player
  const c = ctx(); if (c.state === "suspended") c.resume();
  if (!TR.audio || TR.audio.ver !== m.ver) {
    const b = trRender(m), ab = c.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) ab.getChannelData(ch).set(b.getChannelData(ch));
    TR.audio = { ver: m.ver, ab };
  }
  let at = from != null ? from : TR.pos; if (at >= m.end - 0.02) at = 0;
  const src = c.createBufferSource(); src.buffer = TR.audio.ab; src.connect(c.destination); src.start(0, at);
  const p = TR.play = { src, from: at, startAt: c.currentTime, raf: 0 };
  src.onended = () => { if (TR.play !== p) return; TR.play = null; TR.pos = 0; cancelAnimationFrame(p.raf); trHead(); };
  const step = () => { if (TR.play !== p) return; trHead(); p.raf = requestAnimationFrame(step); };
  step();
}
function trSeek(t) { const playingNow = !!TR.play; trStop(); TR.pos = Math.max(0, Math.min(TR.span, t)); if (playingNow) trPlay(); else trHead(); }
// after a change while playing: go on from the same place with the new mix
function trReplay() { if (TR.play) { const t = trNow(); trStop(); trPlay(t); } }

/* the first arrangement: a whoosh leading into an explosion with breaking glass, from the built-in kit */
function trDefaults() {
  const by = n => S.files.find(f => f.F && f.name === n), wh = by("Whoosh_Flyby_LR.wav"), ex = by("Explosion_Large_Debris.wav"), gl = by("Glass_Window_Break.wav");
  if (!wh || !ex || !gl) return false;
  const te = Math.round(Math.min(wh.dur * 0.6, Math.max(ex.dur, wh.dur, gl.dur) * 0.4) * 100) / 100;
  TR.tracks[0] = { fid: wh.id, off: 0, gain: -3, mute: false, solo: false };
  TR.tracks[1] = { fid: ex.id, off: te, gain: 0, mute: false, solo: false };
  TR.tracks[2] = { fid: gl.id, off: te + 0.03, gain: -4, mute: false, solo: false };
  return true;
}
// called from render(): new files in the menus, the first arrangement once the kit is in
function trSync() {
  if (!TR.rows) return;
  const ready = S.files.filter(f => f.F), sig = ready.map(f => f.id).join(",");
  if (sig !== TR.files) {
    TR.files = sig;
    TR.rows.tracks.forEach((r, k) => {
      const s = r.file, keep = TR.tracks[k].fid;
      s.innerHTML = ""; const none = el("option", "", T("tracks.none", "No file")); none.value = ""; s.appendChild(none);
      for (const f of ready) { const o = el("option", "", f.name); o.value = String(f.id); s.appendChild(o); }
      s.value = keep != null ? String(keep) : "";
    });
    if (!TR.started && trDefaults()) { TR.started = true; trChanged(true); TR.rows.tracks.forEach((r, k) => { r.file.value = String(TR.tracks[k].fid); r.gain.value = String(TR.tracks[k].gain); r.gainVal.textContent = trDb(TR.tracks[k].gain); }); }
  }
  trDraw();
}
const trDb = g => (g > 0 ? "+" : g < 0 ? "−" : "±") + dec(Math.abs(g).toFixed(1)) + " dB";

function buildTracks() {
  const box = $("tracks");
  if (!box) return;
  box.innerHTML = ""; TR.rows = null; TR.files = "";
  if (!PHAPI || !PHAPI.combine) { box.textContent = T("cmp.noApi", "The composer needs src/playhead.js."); return; }
  const sel = (id, label, opts, value, title) => {
    const l = el("label", "ctl"); l.htmlFor = id; l.appendChild(document.createTextNode(label + " ")); if (title) l.title = title;
    const s = el("select"); s.id = id;
    for (const [v, t] of opts) { const o = el("option", "", t); o.value = v; s.appendChild(o); }
    s.value = String(value); l.appendChild(s); return [l, s];
  };
  const chk = (id, label, on, title) => { const l = el("label", "chk"), c = el("input"); c.type = "checkbox"; c.id = id; c.checked = on; l.htmlFor = id; l.append(c, document.createTextNode(" " + label)); if (title) l.title = title; return [l, c]; };
  const lookOpts = [["compose", T("tracks.look.compose", "Your combination (from the composer)")]].concat(Object.entries(PHAPI.looks).map(([k, L]) => [k, L.name]));
  if (!lookOpts.some(o => o[0] === TR.look)) TR.look = "auto";
  const [lLook, sLook] = sel("tr-look", T("tracks.look", "Track look"), lookOpts, TR.look, T("tracks.look.title", "How the clips are drawn: your combination from the composer above, or a ready-made look. The folder uses the same look."));
  const [lView, sView] = sel("tr-view", T("tracks.view", "Folder shows"), TR_VIEWS.map(v => [v, trViewName(v)]), TR.view, T("tracks.view.title", "What the folder track draws for the whole"));
  const clsOpts = [["auto", T("ui.cls.auto", "Auto")]].concat(Object.keys(WL.CLASSES).map(k => [k, clsLabel(k)]));
  const [lCls, sCls] = sel("tr-cls", T("ui.cls", "Asset class"), clsOpts, TR.cls, T("tracks.cls.title", "The tracks and the mix are analysed with one class, so their curves compare"));
  const [lH, sH] = sel("tr-height", T("cmp.height", "Height"), TR_HEIGHTS.map(v => [String(v), v + " px"]), TR.h, T("cmp.height.title", "Height of the strips in this section"));
  const [lSnap, cSnap] = chk("tr-snap", T("tracks.snap", "Snap to onsets"), TR.snap, T("tracks.snap.title", "While you drag, the clip's start or one of its onsets snaps to the other tracks' clips and onsets. Hold Alt to move freely."));
  const [lCmp, cCmp] = chk("tr-compare", T("tracks.compare", "Show every folder view"), TR.compare, T("tracks.compare.title", "Draw all folder views under the folder, to compare them on the same tracks"));
  const play = el("button", "primary", T("ui.play", "Play")); play.type = "button";
  const fb = el("a", "", T("tracks.feedback", "Tell us which folder view helps")); fb.target = "_blank"; fb.rel = "noopener";
  const fbHref = () => { fb.href = "https://github.com/eigensoundlab/playhead/issues/new?template=look-feedback.yml&title=" + encodeURIComponent("Folder view feedback: " + TR.view) + "&look=" + encodeURIComponent(trLookCode() || "") + "&app=" + encodeURIComponent("Playhead app, tracks in a folder (" + TR.view + ")"); };
  const row1 = el("div", "cmp-row"), row2 = el("div", "cmp-row");
  row1.append(lLook, lView, lCls, lH);
  row2.append(play, lSnap, lCmp, fb);
  const grid = el("div", "rows trrows");
  const scopes = [];
  const strip = (aria, tab) => {
    const sc = el("div", "scope"), w = el("div", "cvw"), cv = el("canvas", "strip"), ph = el("div", "ph");
    cv.setAttribute("role", "img"); if (aria) cv.setAttribute("aria-label", aria); if (tab) cv.tabIndex = 0;
    w.append(cv, ph); sc.appendChild(w); const s = { sc, w, cv, ph }; scopes.push(s); return s;
  };
  // the ruler
  const rl = el("div", "lab"), time = el("div", "rulerlab", "0:00.0"); rl.appendChild(time);
  const ruler = strip(T("aria.ruler", "Time ruler; click to seek"));
  grid.append(rl, ruler.sc);
  // the folder track
  const fl = el("div", "lab trfolder"), ft = el("div", "titleline trhead");
  const fold = el("button", "trfold", "▾"); fold.type = "button"; fold.title = T("tracks.collapse.title", "Show or hide the tracks, like a folder in a DAW"); fold.setAttribute("aria-label", fold.title); fold.setAttribute("aria-expanded", String(!TR.collapsed));
  ft.append(fold, el("span", "name", T("tracks.folder", "Folder")));
  const fdesc = el("div", "desc"), flegend = el("div", "desc trlegend"), fmeta = el("div", "metaline");
  fl.append(ft, fdesc, flegend, fmeta);
  const folder = strip(T("tracks.aria.folder", "Folder track: the whole of the tracks; click to set the play position"));
  grid.append(fl, folder.sc);
  // every folder view, for comparing them
  const views = {};
  for (const v of TR_VIEWS) {
    const l = el("div", "lab"), tl = el("div", "titleline"); tl.appendChild(el("span", "name", trViewName(v))); l.append(tl, el("div", "desc", trViewDesc(v)));
    const s = strip(trViewName(v)); grid.append(l, s.sc); views[v] = Object.assign(s, { lab: l });
  }
  // the tracks
  const tracks = TR.tracks.map((t, k) => {
    const l = el("div", "lab trlab"), hd = el("div", "titleline trhead");
    const sw = el("span", "trsw"); sw.style.setProperty("--tc", trColour(PANELS[S.panel], k));
    const mute = el("button", "trms trmute", "M"), solo = el("button", "trms trsolo", "S");
    mute.type = solo.type = "button"; mute.title = T("tracks.mute", "Mute"); solo.title = T("tracks.solo", "Solo");
    mute.setAttribute("aria-label", T("tracks.mute", "Mute") + " " + (k + 1)); solo.setAttribute("aria-label", T("tracks.solo", "Solo") + " " + (k + 1));
    hd.append(sw, el("span", "name", T("tracks.track", "Track {n}", { n: k + 1 })), mute, solo);
    const file = el("select", "trfile"); file.setAttribute("aria-label", T("tracks.file", "File on track {n}", { n: k + 1 }));
    const gl = el("label", "trgain"), gain = el("input"), gainVal = el("span", "val", trDb(t.gain));
    gain.type = "range"; gain.min = "-24"; gain.max = "12"; gain.step = "0.5"; gain.value = String(t.gain);
    gl.append(document.createTextNode(T("tracks.gain", "Gain") + " "), gain, gainVal);
    const at = el("div", "metaline trat");
    l.append(hd, file, gl, at);
    const s = strip("", true);
    s.cv.setAttribute("role", "slider");
    grid.append(l, s.sc);
    return Object.assign(s, { lab: l, file, gain, gainVal, mute, solo, at, sw });
  });
  const note = el("p", "fxnote trnote", T("tracks.rules", "How the folder is combined: loudness and the spectrogram add as power, and a track's gain moves its loudness; onsets and events are merged and onset strength adds up; harshness is the whole's loudness plus the tracks' harshness above their own loudness; the other curves take the strongest track. Sections are not combined, and the beat grid is the clearest track's. On 14 test sessions, loudness and the spectrogram matched the analysed mix closely, activity and harshness roughly, novelty and events poorly (experiments/compose in the source)."));
  box.append(row1, row2, grid, note);
  TR.rows = { ruler, folder: Object.assign(folder, { desc: fdesc, legend: flegend, meta: fmeta }), views, tracks, scopes, time, play, cls: sCls };

  const showRows = () => {
    for (const v of TR_VIEWS) { const r = views[v], on = TR.compare && v !== TR.view; r.lab.hidden = !on; r.sc.hidden = !on; }
    tracks.forEach(r => { r.lab.hidden = TR.collapsed; r.sc.hidden = TR.collapsed; });
    fold.textContent = TR.collapsed ? "▸" : "▾"; fold.setAttribute("aria-expanded", String(!TR.collapsed));
    fbHref();
  };
  showRows();
  sLook.addEventListener("change", () => { TR.look = sLook.value; store.set("trLook", TR.look); fbHref(); trDraw(); });
  sView.addEventListener("change", () => { TR.view = sView.value; store.set("trView", TR.view); showRows(); trDraw(); });
  sCls.addEventListener("change", () => { TR.cls = sCls.value; TR.mix = null; trChanged(false); });
  sH.addEventListener("change", () => { TR.h = parseInt(sH.value, 10) || 64; store.set("trHeight", TR.h); trDraw(); });
  cSnap.addEventListener("change", () => { TR.snap = cSnap.checked; store.set("trSnap", TR.snap); });
  cCmp.addEventListener("change", () => { TR.compare = cCmp.checked; store.set("trCompare", TR.compare); showRows(); trDraw(); });
  fold.addEventListener("click", () => { TR.collapsed = !TR.collapsed; showRows(); trDraw(); });
  play.addEventListener("click", () => { if (TR.play) trStop(); else trPlay(); });
  // seeking: the ruler, the folder and the view rows
  for (const s of [ruler, folder].concat(Object.values(views))) s.w.addEventListener("pointerdown", e => { if (TR.span) trSeek(fracFrom(e, s.w) * TR.span); });
  tracks.forEach((r, k) => {
    const t = () => TR.tracks[k];
    r.file.addEventListener("change", () => { TR.started = true; t().fid = r.file.value ? parseInt(r.file.value, 10) : null; trChanged(true); trReplay(); });
    r.gain.addEventListener("input", () => { TR.started = true; t().gain = parseFloat(r.gain.value) || 0; r.gainVal.textContent = trDb(t().gain); trChanged(false); });
    r.gain.addEventListener("change", trReplay);
    r.mute.addEventListener("click", () => { t().mute = !t().mute; trChanged(false); trReplay(); });
    r.solo.addEventListener("click", () => { t().solo = !t().solo; trChanged(false); trReplay(); });
    const onClip = e => { const f = trFile(t()); if (!f || !TR.span) return false; const at = fracFrom(e, r.w) * TR.span; return at >= t().off && at <= t().off + f.dur; };
    r.cv.addEventListener("pointerdown", e => {
      if (!TR.span) return;
      if (!onClip(e)) { trSeek(fracFrom(e, r.w) * TR.span); return; }
      const f = trFile(t()), st = trSettings(), own = trDoc(f, st).doc, targets = [0];
      TR.tracks.forEach((o, j) => { const g = trFile(o); if (j === k || !g) return; targets.push(o.off, o.off + g.dur); const d = trDoc(g, st).doc; if (d) for (const x of (d.onsets || []).slice(0, 400)) targets.push(o.off + x); });
      const anchors = [0].concat(own ? (own.onsets || []).slice(0, 32) : []);
      TR.drag = { k, grab: fracFrom(e, r.w) * TR.span - t().off, targets, anchors, moved: false };
      r.cv.setPointerCapture(e.pointerId); r.cv.classList.add("dragging"); TR.started = true;
    });
    r.cv.addEventListener("pointermove", e => {
      const d = TR.drag;
      if (!d || d.k !== k) { if (e.pointerType !== "touch") r.cv.style.cursor = onClip(e) ? "grab" : ""; return; }
      const f = trFile(t()), raw = fracFrom(e, r.w) * TR.span - d.grab;
      let off = raw;
      if (TR.snap && !e.altKey) {
        const tol = 8 / Math.max(1, r.w.clientWidth) * TR.span; let best = tol;
        for (const a of d.anchors) for (const c of d.targets) { const cand = c - a, dd = Math.abs(cand - raw); if (dd < best) { best = dd; off = cand; } }
      }
      off = Math.max(0, Math.min(TR.span - f.dur, off));
      if (Math.abs(off - t().off) < 1e-6) return;
      t().off = off; d.moved = true; trChanged(false);
    });
    const end = () => { if (!TR.drag || TR.drag.k !== k) return; const moved = TR.drag.moved; TR.drag = null; r.cv.classList.remove("dragging"); trDraw(); if (moved) { trReplay(); trScheduleMix(); } };
    r.cv.addEventListener("pointerup", end); r.cv.addEventListener("pointercancel", end);
    r.cv.addEventListener("dblclick", e => { const f = trFile(t()); if (!f || !onClip(e)) return; S.sel = f; stopAudio(); offset = 0; render(); $("bar").scrollIntoView({ behavior: "smooth", block: "start" }); });
    r.cv.addEventListener("keydown", e => {
      const f = trFile(t()); if (!f || !TR.span) return;
      const step = e.shiftKey ? 0.1 : 0.01;
      let off = e.key === "ArrowLeft" ? t().off - step : e.key === "ArrowRight" ? t().off + step : e.key === "Home" ? 0 : null;
      if (off == null) return;
      e.preventDefault(); TR.started = true;
      t().off = Math.max(0, Math.min(TR.span - f.dur, Math.round(off * 1000) / 1000)); trChanged(false); trReplay();
    });
  });
  if (typeof IntersectionObserver !== "undefined") {
    if (TR.io) TR.io.disconnect();
    TR.io = new IntersectionObserver(es => { TR.visible = es.some(x => x.isIntersecting); if (TR.visible) trDraw(); });
    TR.io.observe(box);
  } else TR.visible = true;
  trSync();
}

function fmtT(t, fine) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ":" + (fine ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0"));
}
function drawRuler(cv, f, cols, P) {
  const h = 30, g = prep(cv, h), x = g.x, w = g.w;
  x.fillStyle = P.bg; x.fillRect(0, 0, w, h);
  if (!f) return;
  const dur = f.dur;
  x.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; x.textBaseline = "middle";
  const legend = [];
  if (f.segments) {
    f.segments.forEach((s, i) => {
      const a = s.t0 / dur * w, b = s.t1 / dur * w;
      if (i % 2) { x.fillStyle = P.band; x.fillRect(a, 0, b - a, h); }
      x.fillStyle = P.seg; if (i) x.fillRect(Math.round(a), 0, 1, h);
      const label = s.label, num = String(i + 1);
      const tw = x.measureText(label).width;
      x.fillStyle = P.rulerInk; x.textAlign = "left";
      if (tw + 10 < b - a) x.fillText(label, a + 5, 10);
      else { x.fillText(num, a + 4, 10); legend.push(i); }
    });
  }
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  let step = steps[steps.length - 1];
  for (const s of steps) if (s / dur * w >= 70) { step = s; break; }
  x.fillStyle = P.rulerInk; x.textAlign = "left";
  for (let t = 0; t <= dur + 1e-9; t += step) {
    const px = Math.round(t / dur * w);
    x.globalAlpha = 0.6; x.fillRect(px, h - 7, 1, 7); x.globalAlpha = 1;
    if (px < w - 30) x.fillText(fmtT(t, step < 1), px + 4, h - 8);
  }
  return legend;
}

/* ---------------- effects bench ---------------- */
const FX = window.WLFX;
function analysisOf(f) { return { F: f.F, cur: curvesOf(f), R: WL.rhythmOf(f.F), St: WL.structureOf(f.F), X: f.buf ? WL.sfxOf(f.F, f.buf, f.name) : null }; }
function toolAvail(t, f) {
  if (!f || !f.F) return T("bench.need.file", "Load or select a file first.");
  if (t.needs === "tension" && !WL.CLASSES[effClass(f)].tension) return T("bench.need.tension", "{tool} follows the tension curve, which needs a music or ambience class. Set the asset class above to try it on this file.", { tool: toolName(t) });
  if (t.id === "layers") { const X = WL.sfxOf(f.F, f.buf, f.name); if (!X.layers.length) return T("bench.need.layers", "No layers were found in this file."); }
  if (t.id === "loop" && f.dur < 1) return T("bench.need.loop", "Needs at least 1 s of audio.");
  if (t.id === "hpss" && f.dur > 180) return T("bench.need.hpss", "{tool} is limited to files under 3 minutes in the browser.", { tool: toolName(t) });
  return "";
}
function paramDefs(t, f) {
  if (t.params !== "layers") return t.params;
  const X = f && f.F ? WL.sfxOf(f.F, f.buf, f.name) : null;
  const defs = (X ? X.layers : []).map((l, i) => ({ id: "g" + i, label: layerName(l) + " " + (l.hz >= 1000 ? (l.hz / 1000).toFixed(1) + " kHz" : Math.round(l.hz) + " Hz") + " (" + Math.round(l.share * 100) + "%)", min: -24, max: 12, step: 1, value: 0, unit: "dB" }));
  defs.push({ id: "match", label: T("bench.match", "Match loudness"), type: "bool", value: true });
  return defs;
}
function renderToolPicker() {
  const box = $("toolpick");
  if (!box.childElementCount) {
    for (const t of FX.TOOLS) {
      const b = el("button", ""); b.type = "button"; b.dataset.id = t.id;
      b.appendChild(el("span", "", toolName(t))); b.appendChild(el("span", "k", toolKind(t)));
      b.addEventListener("click", () => { S.fx = t.id; store.set("fx", t.id); renderBench(); });
      box.appendChild(b);
    }
  }
  for (const b of box.children) b.setAttribute("aria-pressed", b.dataset.id === S.fx ? "true" : "false");
}
function renderBench() {
  renderToolPicker();
  const t = FX.TOOLS.find(x => x.id === S.fx) || FX.TOOLS[0], f = S.sel;
  $("tooldesc").textContent = toolDesc(t);
  const box = $("params"); box.innerHTML = "";
  const vals = S.fxVals[t.id] = S.fxVals[t.id] || {};
  const defs = paramDefs(t, f);
  for (const p of defs) {
    const id = "fx-" + t.id + "-" + p.id;
    if (vals[p.id] === undefined) vals[p.id] = p.value;
    if (p.type === "bool") {
      const lab = el("label", "param bool"); lab.htmlFor = id;
      const cb = el("input"); cb.type = "checkbox"; cb.id = id; cb.checked = !!vals[p.id];
      cb.addEventListener("change", () => { vals[p.id] = cb.checked; });
      lab.appendChild(cb); lab.appendChild(el("span", "", paramLabel(t, p))); box.appendChild(lab);
    } else if (p.type === "select") {
      const lab = el("label", "param"); lab.htmlFor = id;
      lab.appendChild(el("span", "", paramLabel(t, p)));
      const sel = el("select"); sel.id = id;
      for (const [v, en] of p.options) { const o = el("option", "", optLabel(t, p, v, en)); o.value = v; sel.appendChild(o); }
      sel.value = vals[p.id];
      sel.addEventListener("change", () => { vals[p.id] = sel.value; });
      lab.appendChild(sel); box.appendChild(lab);
    } else {
      const lab = el("label", "param"); lab.htmlFor = id;
      lab.appendChild(el("span", "", paramLabel(t, p)));
      const out = el("span", "val");
      const fmt = v => (Math.abs(p.step) < 1 ? Number(v).toFixed(p.step < 0.1 ? 2 : 1) : String(Math.round(v))) + (p.unit ? " " + p.unit : "");
      out.textContent = fmt(vals[p.id]);
      const r = el("input"); r.type = "range"; r.id = id; r.min = p.min; r.max = p.max; r.step = p.step; r.value = vals[p.id];
      r.addEventListener("input", () => { vals[p.id] = parseFloat(r.value); out.textContent = fmt(vals[p.id]); });
      lab.appendChild(out); lab.appendChild(r); box.appendChild(lab);
    }
  }
  const why = toolAvail(t, f);
  $("runfx").disabled = false;
  $("runfx").textContent = f && f.F ? T("bench.renderTool", "Render {tool}", { tool: midSentence(toolName(t)) }) : T("bench.render", "Render");
  if (!S.fxBusy) $("fxstatus").textContent = why || (f && f.F ? T("bench.worksOn", "Works on {file}.", { file: f.name }) : "");
  renderFxResult();
}
function fxMetrics(f) {
  const cur = curvesOf(f), X = WL.sfxOf(f.F, f.buf, f.name), g = cur.gate;
  const ch = []; for (let c = 0; c < f.buf.numberOfChannels; c++) ch.push(f.buf.getChannelData(c));
  const lufs = FX.lufsOf(ch, f.buf.sampleRate);
  const mean = a => { let s = 0, k = 0; for (let m = 0; m < a.length; m++) if (g[m]) { s += a[m]; k++; } return k ? s / k : 0; };
  const p90 = a => { const v = []; for (let m = 0; m < a.length; m++) if (g[m]) v.push(a[m]); v.sort((x, y) => x - y); return v.length ? v[Math.floor(0.9 * (v.length - 1))] : 0; };
  const lt = Array.from(cur.lufs).filter((_, m) => g[m]).sort((a, b) => a - b);
  const lra = lt.length ? lt[Math.floor(0.95 * (lt.length - 1))] - lt[Math.floor(0.10 * (lt.length - 1))] : 0;
  return [
    [T("metric.length", "Length"), f.dur, "s", 2], [T("metric.loudness", "Loudness"), lufs, "LUFS", 1], [T("metric.peak", "Peak"), X.pkDb, "dBFS", 1], [T("metric.lra", "Loudness range"), lra, "LU", 1],
    [T("metric.harshness", "Harshness factor"), mean(cur.raw.hfac), "", 2], [T("metric.harshnessP90", "Harshness, harshest 10%"), p90(cur.raw.hfac), "", 2], [T("metric.sharpness", "Sharpness"), mean(cur.raw.sharp), "acum", 2], [T("metric.roughness", "Roughness"), mean(cur.raw.Rr), "asper", 2],
    [T("metric.activity", "Activity"), mean(cur.curves.c2), "", 2], [T("metric.problems", "Problems found"), X.issues.filter(i => i.sev === "bad" || i.sev === "warn").length, "", 0],
    [T("metric.events", "Events"), X.events.map(e => e.tag).join(" ").slice(0, 40) || "–", "", -1], [T("metric.layers", "Layers"), X.layers.map(l => layerName(l) + " " + Math.round(l.share * 100) + "%").join(", ") || "–", "", -1]
  ];
}
function renderFxResult() {
  const box = $("fxres"); box.innerHTML = "";
  const L = S.fxLast; if (!L) return;
  const src = S.files.find(x => x.id === L.srcId), outs = L.outIds.map(id => S.files.find(x => x.id === id)).filter(Boolean);
  if (!src || !outs.length) return;
  const P = PANELS[S.panel];
  const head = el("p", "tooldesc"); head.appendChild(el("b", "", (FX.TOOLS.some(x => x.id === L.tool) ? toolName(FX.TOOLS.find(x => x.id === L.tool)) : L.tool) + ": ")); head.appendChild(document.createTextNode(L.report.join(". ") + ".")); box.appendChild(head);
  const row = (f, label, isSrc) => {
    const r = el("div", "fxrow"); r.dataset.fid = f.id;
    const a = el("div", ""); const nm = el("div", "nm", f.name); nm.appendChild(el("small", "", label)); a.appendChild(nm);
    const acts = el("div", "acts");
    const pb = el("button", "abplay", AB.f === f ? T("ui.pause", "Pause") : T("ui.play", "Play")); pb.type = "button"; pb.addEventListener("click", () => audition(f)); acts.appendChild(pb);
    const sb = el("button", "", T("bench.select", "Select")); sb.type = "button"; sb.addEventListener("click", () => { if (f.F) { S.sel = f; stopAudio(); offset = 0; render(); } }); acts.appendChild(sb);
    if ((ALLOW_SAVE || HOST_DL) && !isSrc && f.buf) { const wb = el("button", "", ALLOW_SAVE ? T("bench.saveWav", "Save WAV") : T("bench.saveZip", "Save WAV (.zip)")); wb.type = "button"; wb.addEventListener("click", () => saveWav(f, wb)); acts.appendChild(wb); }
    a.appendChild(acts); r.appendChild(a);
    const cv = el("canvas", "strip"); cv.setAttribute("role", "img"); cv.setAttribute("aria-label", T("aria.fxThumb", "Overview of {file}. Click to play from that point.", { file: f.name }));
    const wrap = el("div", "fxthumb"); wrap.appendChild(cv); wrap.appendChild(el("div", "ph fxph")); r.appendChild(wrap);
    cv.addEventListener("click", e => { if (!f.buf) return; const rc = cv.getBoundingClientRect(); audition(f, Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width)) * f.dur); });
    box.appendChild(r);
    requestAnimationFrame(() => { const cols = Math.max(50, Math.floor(cv.clientWidth || 600)); const th = f.F && effClass(f) === "sfx" ? "d5" : "d4"; drawStripFor(cv, DESIGNS.find(d => d.id === th), f.F ? f : null, cols, 32, P, { thumb: true }); drawAbHead(f); });
  };
  row(src, T("bench.original", "original"), true);
  outs.forEach(o => row(o, o.F ? T("bench.result", "result") : T("bench.analysing", "analysing…")));
  if (src.F && outs.every(o => o.F)) {
    const mb = fxMetrics(src), ma = outs.map(fxMetrics);
    const wrap = el("div", "tablewrap"), tb = el("table", "fxmetrics");
    const hr = el("tr"); hr.appendChild(el("th", "", T("bench.measure", "Measure"))); hr.appendChild(el("th", "", T("bench.originalCol", "Original"))); outs.forEach((o, i) => hr.appendChild(el("th", "", outs.length > 1 ? T("bench.resultN", "Result {n}", { n: i + 1 }) : T("bench.resultCol", "Result"))));
    const th = el("thead"); th.appendChild(hr); tb.appendChild(th);
    const body = el("tbody");
    mb.forEach((m, k) => {
      const tr = el("tr"); tr.appendChild(el("td", "", m[0]));
      const fmt = (v, d) => d < 0 ? String(v) : dec(typeof v === "number" ? v.toFixed(d) : v) + (m[2] ? " " + m[2] : "");
      tr.appendChild(el("td", "", fmt(m[1], m[3])));
      ma.forEach(arr => {
        const v = arr[k][1], td = el("td", "", fmt(v, m[3]));
        if (m[3] >= 0 && typeof v === "number" && Math.abs(v - m[1]) >= Math.pow(10, -m[3]) * 0.999) { const dd = v - m[1]; td.appendChild(el("span", dd > 0 ? "up" : "down", " (" + (dd > 0 ? "+" : "") + dd.toFixed(m[3]) + ")")); }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (L.eq && L.eq.some(Boolean)) {
      const tr = el("tr"); tr.appendChild(el("td", "", T("bench.eqRow", "Same change from a fixed EQ"))); tr.appendChild(el("td", "", "–"));
      L.eq.forEach(e => { const td = el("td", "", e && e.eqShare != null ? T("bench.eqShare", "{p}% of {db} dB", { p: Math.round(e.eqShare * 100), db: e.change.toFixed(1) }) : "–"); if (e && e.eqBands) td.title = T("bench.eqTitle", "Best static EQ (third-octave): {bands}", { bands: e.eqBands.filter(b => Math.abs(b[1]) >= 0.5).map(b => (b[0] >= 1000 ? (b[0] / 1000).toFixed(1) + "k" : b[0]) + " " + (b[1] > 0 ? "+" : "") + b[1]).join(", ") }); tr.appendChild(td); });
      body.appendChild(tr);
    }
    tb.appendChild(body); wrap.appendChild(tb); box.appendChild(wrap);
    if (L.eq && L.eq.some(Boolean)) box.appendChild(el("p", "fxnote", T("bench.eqNote", "\"{row}\" is the share of the tool's average spectrogram change (in dB) that the single best static EQ reproduces. Near 100% means an ordinary EQ would do the same here; low values mean the change follows time and content. Hover for that EQ curve.", { row: T("bench.eqRow", "Same change from a fixed EQ") })));
  }
  if (!ALLOW_SAVE && !HOST_DL) box.appendChild(el("p", "fxnote", T("bench.saveGh", "Saving results as WAV works in the GitHub Pages build of Playhead.")));
  else if (!ALLOW_SAVE) box.appendChild(el("p", "fxnote", T("bench.saveZipNote", "Here results are saved as a .zip holding the WAV, because the page around this app does not allow audio downloads.")));
}
/* Bench audition shares one transport with the main player: starting either stops the other,
   and selecting or loading a file stops both. Each bench strip keeps its own play position. */
const AB = { src: null, f: null, from: 0, startAt: 0, raf: 0, pos: new Map() };
function abTime() { return AB.src ? AB.from + (ctx().currentTime - AB.startAt) : 0; }
function stopAudition() {
  trStop();
  const f = AB.f;
  if (AB.src) { AB.pos.set(f.id, Math.min(abTime(), f.dur)); try { AB.src.onended = null; AB.src.stop(); } catch (e) { /* stopped */ } AB.src.disconnect(); AB.src = null; }
  cancelAnimationFrame(AB.raf); AB.f = null;
  if (f) drawAbHead(f);
}
function audition(f, at) {
  const toggleOff = AB.f === f && AB.src && at === undefined;
  stopAudio();
  if (toggleOff || !f.buf) return;
  const c = ctx(); if (c.state === "suspended") c.resume();
  const b = audioOf(f);
  let from = at !== undefined ? at : (AB.pos.get(f.id) || 0);
  if (from >= b.duration - 0.02) from = 0;
  AB.f = f; AB.from = from; AB.startAt = c.currentTime;
  AB.src = c.createBufferSource(); AB.src.buffer = b; AB.src.connect(c.destination); AB.src.start(0, from);
  AB.src.onended = () => { if (AB.f !== f) return; AB.pos.set(f.id, 0); AB.src = null; AB.f = null; cancelAnimationFrame(AB.raf); drawAbHead(f); };
  const step = () => { if (AB.f !== f) return; drawAbHead(f); AB.raf = requestAnimationFrame(step); };
  step();
}
function drawAbHead(f) {
  const row = document.querySelector('#fxres .fxrow[data-fid="' + f.id + '"]'); if (!row) return;
  const ph = row.querySelector(".fxph"), btn = row.querySelector("button.abplay");
  const live = AB.f === f, t = live ? abTime() : (AB.pos.get(f.id) || 0);
  if (ph) { ph.style.transform = "translateX(" + (Math.min(1, t / (f.dur || 1)) * ph.parentNode.clientWidth) + "px)"; ph.classList.toggle("on", live || t > 0); }
  if (btn) btn.textContent = live ? T("ui.pause", "Pause") : T("ui.play", "Play");
}
async function saveWav(f, btn) {
  const ab = FX.encodeWav(f.buf, false), base = f.name.replace(/\.[a-z0-9]+$/i, "");
  if (!ALLOW_SAVE) {
    if (!HOST_DL) return;
    const zip = FX.zipStore([{ name: base + ".wav", data: new Uint8Array(ab) }]);
    const label = btn ? btn.textContent : "";
    try { await HOST_DL.save({ filename: base + ".zip", data: new Blob([zip]) }); if (btn) { btn.textContent = T("bench.saved", "Saved"); setTimeout(() => { btn.textContent = label; }, 1500); } }
    catch (e) {
      const code = e && e.code;
      if (code === "declined") return;
      if (code === "rate_limited") { $("fxstatus").textContent = T("bench.savePrompt", "A save prompt is already open."); return; }
      HOST_DL = null; $("fxstatus").textContent = T("bench.saveNone", "Saving is not available in this view."); renderFxResult();
    }
    return;
  }
  const blob = new Blob([ab], { type: "audio/wav" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = f.name.replace(/\.[a-z0-9]+$/i, "") + ".wav";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function runFx() {
  const t = FX.TOOLS.find(x => x.id === S.fx), f = S.sel;
  const why = toolAvail(t, f);
  if (why) { $("fxstatus").textContent = why; return; }
  if (S.fxBusy) return;
  S.fxBusy = true; $("runfx").disabled = true;
  const vals = Object.assign({}, S.fxVals[t.id] || {});
  if (t.params === "layers") { vals.gains = WL.sfxOf(f.F, f.buf, f.name).layers.map((_, i) => vals["g" + i] || 0); }
  try {
    $("fxstatus").textContent = T("bench.rendering", "Rendering {tool}…", { tool: midSentence(toolName(t)) });
    await paint();
    const res = await t.run(f.buf, analysisOf(f), vals, p => { $("fxstatus").textContent = T("bench.renderingP", "Rendering {tool}: {p}%", { tool: midSentence(toolName(t)), p: Math.round(p * 100) }); });
    if (!res.outputs.length) { $("fxstatus").textContent = res.report.join(". "); return; }
    const base = f.name.replace(/\.[a-z0-9]+$/i, "");
    const recs = res.outputs.map(o => ({ name: base + "_" + o.suffix + ".wav", kind: "fx", buf: o.buf, segments: Math.abs(o.buf.duration - f.dur) < 0.01 ? f.segments : null, truth: null, sfxTruth: null, dur: o.buf.duration, cls: f.cls || null }));
    S.fxLast = { srcId: f.id, outIds: [], report: res.report, tool: t.id };
    let q;
    recs.forEach((r, i) => { q = addFile(r, false); S.fxLast.outIds.push(r.id); });
    renderFxResult();
    await q;
    // how much of the change a fixed EQ could have made (skipped for the "removed" listening copy and long files)
    if (f.dur <= 180) {
      $("fxstatus").textContent = T("bench.comparingEq", "Comparing with a static EQ…"); await paint();
      const dry = []; for (let c = 0; c < f.buf.numberOfChannels; c++) dry.push(f.buf.getChannelData(c));
      S.fxLast.eq = [];
      for (const r of recs) {
        if (/removed$/.test(r.name.replace(/\.wav$/, "")) || Math.abs(r.buf.length - f.buf.length) > 1) { S.fxLast.eq.push(null); continue; }
        const wet = []; for (let c = 0; c < r.buf.numberOfChannels; c++) wet.push(r.buf.getChannelData(c));
        S.fxLast.eq.push(await FX.eqExplained(dry, wet, f.buf.sampleRate));
      }
    }
    $("fxstatus").textContent = TP("bench.done", recs.length, "Done. The result is in the library below.", "Done. {n} results are in the library below.");
  } catch (e) {
    $("fxstatus").textContent = T("bench.failed", "Rendering failed: {err}", { err: e && e.message ? e.message : e });
  } finally {
    S.fxBusy = false; $("runfx").disabled = false;
    renderFxResult();
  }
}

/* ---------------- render ---------------- */
function render() {
  const f = S.sel;
  const P = PANELS[S.panel];
  const ruler = scopes.find(s => s.spec.id === "ruler");
  const cols = Math.max(50, Math.floor(ruler.cv.clientWidth || 800));
  const legend = drawRuler(ruler.cv, f, cols, P) || [];
  const sl = $("seglegend");
  if (f && f.segments && (legend.length || f.segments.some(s => s.note))) {
    sl.hidden = false;
    sl.innerHTML = "";
    f.segments.forEach((s, i) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="n">' + (i + 1) + '</span><span><span class="t"></span> <span class="d"></span></span>';
      li.querySelector(".t").textContent = s.label;
      li.querySelector(".d").textContent = s.note ? s.note : "";
      sl.appendChild(li);
    });
  } else { sl.hidden = true; }
  void legend;
  const ready = f && f.F;
  for (const s of scopes) {
    if (s.group === "ruler") continue;
    drawStripFor(s.cv, s.spec, ready ? f : null, cols, s.group === "compose" ? CMP.h : S.height, P);
  }
  updateLabels();
  renderMatrix();
  renderLibrary();
  renderBench();
  trSync();
  if (ready) placeHead(playing ? offset + (ctx().currentTime - startAt) : offset);
}
function updateLabels() {
  const f = S.sel;
  const P = PANELS[S.panel];
  const ready = f && f.F;
  const cls = ready ? effClass(f) : "rhythmic";
  const C = WL.CLASSES[cls];
  const d = ready ? diagOf(f) : null;
  for (const s of SINGLE) {
    const ml = $("ml-" + s.id);
    ml.innerHTML = "";
    if (!ready) continue;
    if (s.id === "c1") { const b = document.createElement("span"); b.className = "badge ref"; b.textContent = T("lab.reference", "reference"); ml.appendChild(b); continue; }
    if (s.needs && !C[s.needs]) { const b = document.createElement("span"); b.className = "mut"; b.textContent = T("lab.notComputed", "Not computed for {cls}.", { cls: midSentence(clsLabel(cls)) }); ml.appendChild(b); continue; }
    const r = Math.abs(d.r[s.id]);
    const b = document.createElement("span");
    if (!isFinite(r)) { b.className = "badge ref"; b.textContent = T("lab.flat", "flat"); }
    else {
      b.className = "badge " + (r < 0.3 ? "new" : r < 0.6 ? "mid" : "dep");
      b.textContent = indepText(r);
      const n = document.createElement("b"); n.textContent = dec(r.toFixed(2)); b.appendChild(n);
      b.title = indepTitle(r);
    }
    ml.appendChild(b);
    const ts = d.dis[s.id] || [];
    for (const t of ts) {
      const c = document.createElement("button"); c.className = "chip"; c.type = "button";
      c.textContent = fmtT(t);
      c.setAttribute("aria-label", T("aria.chip", "Play from {t}, where {name} is high relative to loudness", { t: fmtT(Math.max(0, t - 1)), name: midSentence(rowName(s)) }));
      c.addEventListener("click", () => { seek(Math.max(0, t - 1), true); });
      ml.appendChild(c);
    }
  }
  sfxLabels(f, ready);
  rhythmLabels(f, ready, d, C);
  descLabels(f, ready, d);
  for (const s of DESIGNS) {
    const ml = $("ml-" + s.id);
    ml.innerHTML = "";
    const spec = s.auto ? D3MAP[cls] : s;
    if (s.auto) $("ds-" + s.id).textContent = ready ? T("d3." + cls, spec.text) : T("row.d3.auto", "Picks height and colour by asset class.");
    if (!ready) continue;
    const lg = document.createElement("span"); lg.className = "legend";
    const a = document.createElement("span"); a.textContent = word(spec.lab[0]);
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = rampCSS(P);
    const b = document.createElement("span"); b.textContent = word(spec.lab[1]);
    lg.appendChild(a); lg.appendChild(sw); lg.appendChild(b);
    ml.appendChild(lg);
    if (s.kind === "d5") {
      lg.innerHTML = "";
      lg.appendChild(el("span", "", word("low")));
      const sw2 = el("span", "swatch"); sw2.style.background = "linear-gradient(90deg," + P.spec6.join(",") + ")"; lg.appendChild(sw2);
      lg.appendChild(el("span", "", word("high")));
      const l2 = el("span", "legend"); const ls = el("span", "lineswatch"); ls.style.setProperty("--lc", P.line);
      l2.appendChild(ls); l2.appendChild(el("span", "", word("pitch"))); ml.appendChild(l2);
    }
    if (s.kind === "d4") {
      const l2 = document.createElement("span"); l2.className = "legend";
      const ls = document.createElement("span"); ls.className = "lineswatch"; ls.style.setProperty("--lc", P.line);
      const lt = document.createElement("span"); lt.textContent = C.harmony ? T("lab.harmonyLine", "harmonic tension") : T("lab.noHarmonyLine", "no harmony line for {cls}", { cls: midSentence(clsLabel(cls)) });
      l2.appendChild(ls); l2.appendChild(lt); ml.appendChild(l2);
    }
  }
  // class select
  const sel = $("cls");
  sel.options[0].textContent = ready ? T("ui.cls.autoOf", "Auto ({cls})", { cls: clsLabel(f.F.guess) }) : T("ui.cls.auto", "Auto");
  sel.value = ready && f.cls ? f.cls : "auto";
  // now line
  const now = $("now");
  now.innerHTML = "";
  if (f) {
    const b = document.createElement("b"); b.textContent = f.name; now.appendChild(b);
    const m = document.createElement("span");
    m.textContent = "  " + fmtT(f.dur) + (f.dur < 60 ? " (" + dec(f.dur.toFixed(2)) + " s)" : "") + "  " + f.buf.sampleRate + " Hz  " + (f.buf.numberOfChannels > 1 ? T("now.stereo", "stereo") : T("now.mono", "mono")) + (f.ms ? "  " + T("now.analysed", "analysed in {s} s", { s: (f.ms / 1000).toFixed(1) }) + (POOL.state === "ready" ? " " + T("now.worker", "(worker)") : "") : "");
    now.appendChild(m);
  }
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function num(label, value, unit) { const s = el("span", "num"); if (label) s.appendChild(document.createTextNode(label + " ")); s.appendChild(el("b", "", dec(value))); if (unit) s.appendChild(document.createTextNode(" " + unit)); return s; }
function fBadge(label, r) {
  const b = el("span", "badge " + (r.f >= 0.9 ? "new" : r.f >= 0.7 ? "mid" : "dep"), label);
  const n = el("b", "", dec(r.f.toFixed(2))); b.appendChild(n);
  b.title = T("lab.fTitle", "F-measure {f}: precision {p}, recall {r} ({n} found, {ref} true, ±70 ms)", { f: r.f.toFixed(2), p: r.p.toFixed(2), r: r.r.toFixed(2), n: r.n, ref: r.ref });
  return b;
}
function indepText(r) { return r < 0.3 ? T("lab.indep.own", "moves on its own") : r < 0.6 ? T("lab.indep.partly", "partly follows loudness") : T("lab.indep.follows", "follows loudness"); }
function indepTitle(r) { return T("lab.indep.title", "How closely this curve's column-to-column changes follow loudness's: {r} (0 unrelated, 1 lockstep)", { r: r.toFixed(2) }); }
const layerName = l => T("layer." + l.name, l.name);
// an event's word ("noise hit up"): the object type from Schaeffer's typology and its direction
const DIRS = { "up": "up", "down": "down", "up and down": "upDown" };
function eventWord(e) {
  const dir = e.dir || "", base = dir && e.word.endsWith(" " + dir) ? e.word.slice(0, -dir.length - 1) : e.word;
  return T("obj." + e.mass + "." + e.facture, base) + (dir ? " " + T("obj.dir." + (DIRS[dir] || dir), dir) : "");
}
function indepBadge(ml, d, key, name) {
  const r = Math.abs(d.r[key]);
  if (!isFinite(r)) return;
  const b = el("span", "badge " + (r < 0.3 ? "new" : r < 0.6 ? "mid" : "dep"), indepText(r));
  b.appendChild(el("b", "", dec(r.toFixed(2))));
  b.title = indepTitle(r);
  ml.appendChild(b);
  for (const t of (d.dis[key] || [])) {
    const c = el("button", "chip", fmtT(t)); c.type = "button";
    c.setAttribute("aria-label", T("aria.chip", "Play from {t}, where {name} is high relative to loudness", { t: fmtT(Math.max(0, t - 1)), name }));
    c.addEventListener("click", () => seek(Math.max(0, t - 1), true));
    ml.appendChild(c);
  }
}
const matKey = m => ({ "damped (rubber, wood)": "damped", "glass-like": "glass", "metal-like": "metal", "not modal": "notModal" })[m] || m;
function fmtS(t, dur) { return dur < 60 ? dec(t.toFixed(2)) + " s" : fmtT(t, true); }
const BAND6 = ["20–400 Hz", "400–920 Hz", "0.9–1.7 kHz", "1.7–3.2 kHz", "3.2–6.4 kHz", "6.4–15.5 kHz"];
function issueBadge(it) { return el("span", "badge " + ({ bad: "dep", warn: "mid", info: "ref", ok: "new" })[it.sev], it.key ? T("check." + it.key, it.text, it.vars) : it.text); }
function sfxLabels(f, ready) {
  const P = PANELS[S.panel];
  for (const s of SFXROWS) $("ml-" + s.id).innerHTML = "";
  if (!ready || !f.buf) return;
  const X = WL.sfxOf(f.F, f.buf, f.name), dur = f.dur;
  // X1: where most loudness sits
  {
    const ml = $("ml-x1"), tot = [0, 0, 0, 0, 0, 0];
    for (let m = 0; m < f.F.nF; m++) { const wgt = Math.pow(10, X.lev[m] / 20); for (let k = 0; k < 6; k++) tot[k] += X.bands6[k][m] * wgt; }
    const best = tot.indexOf(Math.max(...tot));
    const lg = el("span", "legend"); lg.appendChild(el("span", "", word("low")));
    const sw = el("span", "swatch"); sw.style.background = "linear-gradient(90deg," + P.spec6.join(",") + ")"; lg.appendChild(sw);
    lg.appendChild(el("span", "", word("high"))); ml.appendChild(lg);
    ml.appendChild(num(T("lab.mostLoudnessIn", "most loudness in"), BAND6[best]));
  }
  // X2: layers
  {
    const ml = $("ml-x2");
    for (const l of X.layers) {
      const s = el("span", "num"); const sw = el("span", "swatch"); sw.style.width = "10px"; sw.style.background = specColor(P, l.hz); sw.style.marginRight = "5px";
      s.appendChild(sw); s.appendChild(el("b", "", layerName(l) + " " + (l.hz >= 1000 ? (l.hz / 1000).toFixed(1) + " kHz" : Math.round(l.hz) + " Hz")));
      s.appendChild(document.createTextNode(" " + Math.round(l.share * 100) + "%, " + fmtS(l.span[0], dur) + "–" + fmtS(l.span[1], dur)));
      ml.appendChild(s);
    }
  }
  // X3: pitch summary
  {
    const ml = $("ml-x3");
    const tonal = []; for (let m = 0; m < f.F.nF; m++) if (X.aper[m] <= WL.SFX.tonalAper && X.f0[m] >= 50 && X.lev[m] >= X.pk - 35) tonal.push(X.f0[m]);
    if (tonal.length >= 4) {
      tonal.sort((a, b) => a - b);
      const lo = tonal[Math.floor(0.05 * (tonal.length - 1))], hi = tonal[Math.floor(0.95 * (tonal.length - 1))];
      const fmt = hz => hz >= 1000 ? (hz / 1000).toFixed(1) + " kHz" : Math.round(hz) + " Hz";
      ml.appendChild(num(T("lab.pitch", "pitch"), fmt(lo) + (hi / lo > 1.06 ? "–" + fmt(hi) : "")));
    } else ml.appendChild(el("span", "mut", T("lab.noStablePitchBrightness", "No stable pitch; brightness only.")));
  }
  // X4: envelope numbers
  {
    const ml = $("ml-x4");
    ml.appendChild(num(T("lab.attack", "attack"), (X.attack * 1000).toFixed(0), "ms"));
    ml.appendChild(num(T("lab.effective", "effective"), fmtS(X.eff, dur)));
    ml.appendChild(num(T("lab.centre", "centre"), fmtS(X.tcent, dur)));
    if (X.t20 !== null) ml.appendChild(num(T("lab.minus20DBAfter", "−20 dB after"), fmtS(X.t20, dur)));
    if (X.t40 !== null) ml.appendChild(num(T("lab.minus40DBAfter", "−40 dB after"), fmtS(X.t40, dur)));
  }
  // X5: events, tags and score
  {
    const ml = $("ml-x5");
    if (f.sfxTruth) {
      const tr = f.sfxTruth.events, used = new Set(); let hit = 0, tag = 0;
      for (const e of tr) {
        let bi = -1, bd = 1e9; X.events.forEach((x, i) => { const dd = Math.abs(x.t0 - e.t); if (!used.has(i) && dd < bd) { bd = dd; bi = i; } });
        if (bi >= 0 && bd <= 0.04) { used.add(bi); hit++; if (e.tag.split("|").includes(X.events[bi].tag)) tag++; }
      }
      const b1 = el("span", "badge " + (hit === tr.length ? "new" : "mid"), T("lab.eventsFound", "events found")); b1.appendChild(el("b", "", T("lab.nOf", "{k} of {n}", { k: hit, n: tr.length }))); ml.appendChild(b1);
      const b2 = el("span", "badge " + (tag === tr.length ? "new" : "mid"), T("lab.tagsRight", "tags right")); b2.appendChild(el("b", "", T("lab.nOf", "{k} of {n}", { k: tag, n: tr.length }))); ml.appendChild(b2);
      b1.title = T("lab.trueEvents", "True events: {list}", { list: tr.map(e => e.t.toFixed(2) + " s " + e.tag).join(", ") });
    }
    X.events.slice(0, 8).forEach(e => {
      const c = el("button", "chip", fmtS(e.t0, dur) + " " + e.tag + " " + eventWord(e)); c.type = "button";
      c.title = T("lab.evTitle", "{profile} profile, effective {ms} ms", { profile: T("profile." + e.profile.replace("/", "-"), e.profile), ms: (e.eff * 1000).toFixed(0) }) + (e.grains.length > 1 ? ", " + TP("lab.grains", e.grains.length, "{n} grain", "{n} grains") : "") + (e.f0 ? ", " + T("lab.evPitch", "pitch {hz} Hz", { hz: Math.round(e.f0) }) : "");
      c.addEventListener("click", () => seek(Math.max(0, e.t0 - 0.05), true));
      ml.appendChild(c);
    });
    if (X.events.length > 8) ml.appendChild(el("span", "mut", T("lab.more", "+{n} more", { n: X.events.length - 8 })));
  }
  // X6: space
  {
    const ml = $("ml-x6");
    if (!X.stereo) ml.appendChild(el("span", "mut", T("lab.monoFile", "Mono file.")));
    else if (X.identical) ml.appendChild(el("span", "mut", T("lab.bothChannelsIdentical", "Both channels identical.")));
    else {
      const g = []; for (let m = 0; m < f.F.nF; m++) if (X.lev[m] >= X.pk - 20) g.push(m);
      if (g.length) {
        const pf = p => (p < -0.05 ? "L " : p > 0.05 ? "R " : "C ") + Math.round(Math.abs(p) * 100) + "%";
        const k3 = Math.max(1, Math.floor(g.length / 5));
        const p0 = g.slice(0, k3).reduce((a, m) => a + X.pan[m], 0) / k3, p1 = g.slice(-k3).reduce((a, m) => a + X.pan[m], 0) / k3;
        ml.appendChild(num(T("lab.pan", "pan"), pf(p0) + (Math.abs(p1 - p0) > 0.2 ? " → " + pf(p1) : "")));
        let wmax = 0; for (const m of g) wmax = Math.max(wmax, X.width[m]);
        ml.appendChild(num(T("lab.maxWidth", "max width"), wmax.toFixed(2)));
      }
    }
  }
  // X7: checks
  {
    const ml = $("ml-x7");
    if (!X.issues.length) { const b = el("span", "badge new", T("lab.noProblems", "No problems found")); ml.appendChild(b); }
    X.issues.forEach(it => ml.appendChild(issueBadge(it)));
    ml.appendChild(num(T("lab.peak", "peak"), X.pkDb.toFixed(1), "dBFS"));
  }
}
function rhythmLabels(f, ready, d, C) {
  const P = PANELS[S.panel];
  for (const s of RHY.concat(STR)) $("ml-" + s.id).innerHTML = "";
  if (!ready) return;
  const R = WL.rhythmOf(f.F), St = WL.structureOf(f.F), E = WL.eventsOf(f.F);
  const truth = f.truth;
  let ml = $("ml-r1");
  ml.appendChild(num("", String(R.onsetTimes.length), TP("lab.onsets", R.onsetTimes.length, "onset", "onsets")));
  ml.appendChild(num(T("lab.soundFrom", "sound from"), fmtS(E.start, f.dur)));
  ml.appendChild(num(T("lab.minus30DBAt", "−30 dB at"), fmtS(E.end30, f.dur)));
  const short = f.dur < 5;
  ml = $("ml-r2");
  if (!short) {
    if (R.tempo > 0) ml.appendChild(num("", R.tempo.toFixed(1), "BPM"));
    if (!R.reliable) ml.appendChild(el("span", "mut", T("lab.weakPulseBeatsAre", "Weak pulse: beats are a guess.")));
    if (truth) {
      const fb = WL.beatF(R.beatTimes, truth.beats, truth.regions);
      const fd = WL.beatF(R.downTimes, truth.downbeats, truth.regions);
      if (fb) ml.appendChild(fBadge(T("lab.beatsF", "beats F"), fb));
      if (fd) ml.appendChild(fBadge(T("lab.downbeatsF", "downbeats F"), fd));
    } else if (R.beatTimes.length && R.plpTimes.length) {
      const ag = WL.beatF(R.plpTimes, R.beatTimes, null);
      if (ag) { const b = el("span", "badge ref", T("lab.agreesR3", "agrees with R3")); b.appendChild(el("b", "", dec(ag.f.toFixed(2)))); b.title = T("lab.agreesR3.title", "F-measure between R2 and R3 beats, ±70 ms. No true beats are known for this file."); ml.appendChild(b); }
    }
  }
  ml = $("ml-r3");
  if (!short) {
    if (R.tempoRange[1] > 0) ml.appendChild(num("", Math.round(R.tempoRange[0]) + (Math.abs(R.tempoRange[1] - R.tempoRange[0]) >= 2 ? "–" + Math.round(R.tempoRange[1]) : ""), "BPM"));
    if (truth) { const fp = WL.beatF(R.plpTimes, truth.beats, truth.regions); if (fp) ml.appendChild(fBadge(T("lab.beatsF", "beats F"), fp)); }
  }
  ml = $("ml-r4");
  if (!short) {
    ml.appendChild(num(T("lab.median", "median"), R.medClar.toFixed(2)));
    const lg = el("span", "legend");
    lg.appendChild(el("span", "", "60"));
    const sw = el("span", "swatch"); sw.style.background = rampCSS(P); lg.appendChild(sw);
    lg.appendChild(el("span", "", "180 BPM"));
    ml.appendChild(lg);
    indepBadge(ml, d, "r4", T("lab.name.r4", "pulse clarity"));
  }
  ml = $("ml-s1");
  if (!St.tooShort) {
    ml.appendChild(num("", String(St.bounds.length), TP("lab.boundaries", St.bounds.length, "boundary", "boundaries")));
    ml.appendChild(num(T("lab.kernelPm", "kernel ±"), (St.L * St.blk).toFixed(1), "s"));
    indepBadge(ml, d, "s1", T("lab.name.s1", "structural novelty"));
  }
  ml = $("ml-s2");
  if (!St.tooShort) {
    const seq = St.segs.map(s => s.label).join(" ");
    ml.appendChild(el("span", "seq", seq.length > 60 ? seq.slice(0, 60) + " …" : seq));
    if (truth && f.segments) {
      const tb = f.segments.slice(1).map(s => s.t0);
      const hit = tb.filter(t => St.bounds.some(b => Math.abs(b - t) <= 1)).length;
      ml.appendChild(num(T("lab.trueBounds", "true boundaries found"), T("lab.nOf", "{k} of {n}", { k: hit, n: tb.length })));
    }
  }
}
function descLabels(f, ready, d) {
  for (const s of DESCROWS) $("ml-" + s.id).innerHTML = "";
  if (!ready || !f.F._desc) return;
  const S2 = f.F._desc.summary, fx = (v, n) => Number.isFinite(v) ? v.toFixed(n) : "–";
  let ml = $("ml-n1"), K = S2.kurtosis;
  ml.appendChild(num(T("lab.k", "K"), fx(K.K, 2)));
  if (K.band) ml.appendChild(num(T("lab.mostImpulsive", "most impulsive"), (K.band[0] >= 1000 ? K.band[0] / 1000 + "–" + K.band[1] / 1000 + " kHz" : K.band[0] + "–" + K.band[1] + " Hz"), "(K " + fx(K.Kmax, 1) + ")"));
  ml.appendChild(el("span", "mut", K.K < -0.5 ? T("lab.kurt.tonal", "tonal") : K.K < 0.5 ? T("lab.kurt.noise", "noise-like") : K.K < 5 ? T("lab.kurt.intermittent", "intermittent") : T("lab.kurt.impulsive", "impulsive")));
  indepBadge(ml, d, "n1", T("lab.name.n1", "impulsiveness"));
  ml = $("ml-n2"); const Rp = S2.repetition;
  if (Number.isFinite(Rp.hz)) { ml.appendChild(num("", fx(Rp.hz, Rp.hz < 10 ? 2 : 1), "Hz")); if (Rp.hz < 4) ml.appendChild(num("", fx(Rp.hz * 60, 0), T("lab.perMinute", "per minute"))); ml.appendChild(num(T("lab.clarity", "clarity"), fx(Rp.prom, 0), "dB")); if (Number.isFinite(Rp.cycles) && f.dur < 30) ml.appendChild(num(T("lab.loop", "loop"), fx(Rp.cycles, 2), T("lab.cycles", "cycles"))); }
  else ml.appendChild(el("span", "mut", T("lab.noSteadyRepetition", "No steady repetition")));
  if (Number.isFinite(Rp.speech)) { ml.appendChild(num(T("lab.speechRateModulation", "speech-rate modulation"), (Rp.speech >= 0 ? "+" : "") + fx(Rp.speech, 0), "dB")); ml.appendChild(el("span", "mut", T("lab.experimental", "experimental"))); }
  indepBadge(ml, d, "n2", T("lab.name.n2", "repetition"));
  ml = $("ml-n3"); const E = S2.events;
  ml.appendChild(num("", String(E.n), TP("lab.events", E.n, "event", "events"))); ml.appendChild(num("", fx(E.rate, 1), "/s"));
  if (Number.isFinite(E.meanDur)) ml.appendChild(num(T("lab.mean", "mean"), fx(E.meanDur * 1000, 0), "ms"));
  if (Number.isFinite(E.B)) ml.appendChild(num(T("lab.burstiness", "burstiness"), fx(E.B, 2), E.B < -0.5 ? T("lab.b.regular", "regular") : E.B < 0.2 ? T("lab.b.random", "random") : T("lab.b.clustered", "clustered")));
  if (Number.isFinite(E.bValue) && E.bN >= 50) ml.appendChild(num(T("lab.bValue", "b-value"), fx(E.bValue, 2), E.bValue > 1.5 ? T("lab.bv.manySmall", "many small") : E.bValue < 0.8 ? T("lab.bv.fewBig", "few big") : ""));
  ml.appendChild(num(T("lab.temporalEntropy", "temporal entropy"), fx(E.Ht, 2), E.Ht < 0.7 ? T("lab.ht.transient", "transient") : E.Ht > 0.95 ? T("lab.ht.steady", "steady") : ""));
  ml = $("ml-n4"); const Mo = S2.motion;
  ml.appendChild(num(T("lab.rise", "rise"), fx(Mo.up, 1), "oct/s")); ml.appendChild(num(T("lab.fall", "fall"), fx(Mo.down, 1), "oct/s"));
  if (Number.isFinite(Mo.net)) ml.appendChild(num(T("lab.netGlide", "net glide"), (Mo.net >= 0 ? "+" : "") + fx(Mo.net, 1), "oct"));
  indepBadge(ml, d, "n4", T("lab.name.n4", "spectral motion"));
  ml = $("ml-n5"); const Pe = S2.periodicity;
  ml.appendChild(num(T("lab.cpp", "CPP"), fx(Pe.cpp, 0), "dB")); ml.appendChild(num(T("lab.phaseCoherence", "phase coherence"), fx(Pe.pci, 2)));
  indepBadge(ml, d, "n5", T("lab.name.n5", "periodicity"));
  ml = $("ml-n6"); const Ar = S2.arrow;
  if (Number.isFinite(Ar.T20)) { ml.appendChild(num(T("lab.t52080", "T(5, 20, 80 ms)"), [Ar.T5, Ar.T20, Ar.T80].map(v => fx(v, 1)).join(" / "))); ml.appendChild(el("span", "mut", Ar.T20 > 0.5 ? T("lab.arrow.impact", "impact-like") : Ar.T20 < -0.5 ? T("lab.arrow.swell", "swell or reversed") : T("lab.arrow.none", "no clear direction"))); }
  else ml.appendChild(el("span", "mut", T("lab.steadyNoDirection", "Steady: no direction")));
  indepBadge(ml, d, "n6", T("lab.name.n6", "arrow of time"));
  ml = $("ml-n7"); const In = S2.info;
  if (In.K) { ml.appendChild(num(T("lab.predictiveInformation", "predictive information"), fx(In.pir, 2), "nats")); ml.appendChild(num(T("lab.surprisal", "surprisal"), fx(In.surprisal, 2), "nats")); ml.appendChild(num("", String(In.K), TP("lab.timbreSymbols", In.K, "timbre symbol", "timbre symbols"))); }
  indepBadge(ml, d, "n7", T("lab.name.n7", "interest"));
  ml = $("ml-n8"); const Rc = S2.recurrence;
  if (Number.isFinite(Rc.RR)) { ml.appendChild(num(T("lab.recurrenceRate", "recurrence rate"), fx(Rc.RR * 100, 0), "%")); ml.appendChild(num(T("lab.determinism", "determinism"), fx(Rc.DET, 2))); ml.appendChild(num(T("lab.laminarity", "laminarity"), fx(Rc.LAM, 2))); if (Number.isFinite(Rc.TT)) ml.appendChild(num(T("lab.held", "held"), fx(Rc.TT, 1), "s")); }
  else ml.appendChild(el("span", "mut", T("lab.tooShort", "Too short")));
  indepBadge(ml, d, "n8", T("lab.name.n8", "recurrence"));
  ml = $("ml-n9"); const De = S2.decay;
  if (De.n) { ml.appendChild(num(T("lab.decayTime", "decay time"), De.t60 < 1 ? fx(De.t60 * 1000, 0) : fx(De.t60, 2), De.t60 < 1 ? "ms" : "s")); if (Number.isFinite(De.logTau)) ml.appendChild(num(T("lab.logTaud", "log τd"), fx(De.logTau, 2))); if (De.material) ml.appendChild(num("", T("mat." + matKey(De.material), De.material))); if (De.material && effClass(f) !== "sfx") ml.appendChild(el("span", "mut", T("lab.unreliableMixes", "unreliable on mixes"))); ml.appendChild(num("", String(De.n), TP("lab.decays", De.n, "decay", "decays"))); }
  else ml.appendChild(el("span", "mut", T("lab.noFreeDecaysFound", "No free decays found")));
}
function renderMatrix() {
  const t = $("matrix");
  t.innerHTML = "";
  const f = S.sel;
  if (!f || !f.F) return;
  const d = diagOf(f);
  const label0 = { peak: "Peak", c1: "C1 Loudness", c2: "C2 Activity", c3: "C3 Arousal", c4: "C4 Harshness", c5: "C5 Tension", c6: "C6 Harmony", c7: "C7 Novelty", r4: "R4 Clarity", s1: "S1 Structure", n1: "N1 Impulsiveness", n2: "N2 Repetition", n4: "N4 Motion", n5: "N5 Periodicity", n6: "N6 Arrow", n7: "N7 Interest", n8: "N8 Recurrence" };
  const label = Object.fromEntries(Object.entries(label0).map(([k, v]) => [k, T("matrix." + k, v)]));
  const head = document.createElement("tr");
  head.appendChild(document.createElement("th"));
  d.names.forEach(n => { const th = document.createElement("th"); th.textContent = label[n].split(" ")[0]; th.title = label[n]; head.appendChild(th); });
  const thead = document.createElement("thead"); thead.appendChild(head); t.appendChild(thead);
  const tb = document.createElement("tbody");
  d.names.forEach((a, i) => {
    const tr = document.createElement("tr");
    const th = document.createElement("td"); th.textContent = label[a]; tr.appendChild(th);
    d.names.forEach((b, j) => {
      const td = document.createElement("td");
      const v = d.mx[i][j];
      if (i === j) { td.textContent = ""; }
      else if (!isFinite(v)) { td.textContent = "–"; }
      else {
        td.textContent = v.toFixed(2);
        const a2 = Math.min(1, Math.abs(v));
        td.style.background = "color-mix(in srgb, var(--accent) " + Math.round(a2 * 42) + "%, transparent)";
      }
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}
function renderLibrary() {
  const box = $("library");
  const P = PANELS[S.panel];
  // rebuild rows if the file list changed
  if (box.childElementCount !== S.files.length * 2 || box.dataset.ver !== String(S.files.map(f => f.id + (f.F ? "r" : "p")).join(","))) {
    box.innerHTML = "";
    box.dataset.ver = String(S.files.map(f => f.id + (f.F ? "r" : "p")).join(","));
    for (const f of S.files) {
      const row = document.createElement("div"); row.className = "librow"; row.dataset.id = f.id;
      row.tabIndex = 0; row.setAttribute("role", "button");
      const a = document.createElement("div");
      const n = document.createElement("div"); n.className = "fname"; n.textContent = f.name; a.appendChild(n);
      const m = document.createElement("div"); m.className = "fmeta"; m.id = "fm-" + f.id; a.appendChild(m);
      const b = document.createElement("div");
      const cv = document.createElement("canvas"); cv.className = "strip"; cv.id = "th-" + f.id; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", T("aria.thumb", "Thumbnail of {file}", { file: f.name }));
      b.appendChild(cv);
      row.appendChild(a); row.appendChild(b);
      const pick = () => { if (f.F) { S.sel = f; stopAudio(); offset = 0; render(); } };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      box.appendChild(row);
    }
  }
  for (const f of S.files) {
    const row = box.querySelector('.librow[data-id="' + f.id + '"]');
    if (!row) continue;
    row.classList.toggle("sel", f === S.sel);
    const m = $("fm-" + f.id);
    m.textContent = f.F ? fmtS(f.dur, f.dur) + "  " + clsLabel(effClass(f)) : (f.error ? f.error : T("status.analysingShort", "Analysing…"));
    const cv = $("th-" + f.id);
    const cols = Math.max(50, Math.floor(cv.clientWidth || 600));
    const th = S.thumb === "auto" ? (f.F && effClass(f) === "sfx" ? "d5" : "d4") : S.thumb;
    const spec = th === "unity" ? { id: "unity" } : th === "compose" ? { id: "compose" } : th === "c1" ? SINGLE[0] : (DESIGNS.find(d => d.id === th) || DESIGNS[2]);
    drawStripFor(cv, spec, f.F ? f : null, cols, 24, P, { thumb: true });
  }
}

/* ---------------- analysis queue ---------------- */
function setStatus(t, err) { const s = $("status"); s.textContent = t || ""; s.classList.toggle("err", !!err); }
const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
/* ---------------- analysis off the main thread ----------------
   A pool of Web Workers runs the whole pipeline (features, curves, rhythm, structure, sound-effect analysis, descriptors).
   Each worker is built from the page's own script text (inline scripts, or the same-origin files fetched once), so the
   single-file build and hosted pages need no extra files. Where workers are blocked (file:// pages, strict sandboxes),
   analysis falls back to the main thread. The returned analysis carries its caches, so nothing is computed twice. */
function workerMain() {
  self.onmessage = async ev => {
    const { id, sr, chans, name } = ev.data;
    try {
      const buf = { sampleRate: sr, length: chans[0].length, numberOfChannels: chans.length, duration: chans[0].length / sr, getChannelData: c => chans[c] };
      let last = 0;
      const F = await self.WL.analyse(buf, p => { const now = Date.now(); if (now - last > 150) { last = now; self.postMessage({ id, stage: "features", progress: p }); } });
      self.postMessage({ id, stage: "rhythm" });
      self.WL.computeCurves(F, F.guess, { scale: "fixed" }); self.WL.rhythmOf(F); self.WL.structureOf(F); self.WL.eventsOf(F);
      self.postMessage({ id, stage: "sfx" });
      self.WL.sfxOf(F, buf, name);
      self.postMessage({ id, stage: "descriptors" });
      await self.PHD.describe(F, buf);
      self.postMessage({ id, F });
    } catch (e) { self.postMessage({ id, error: String((e && e.message) || e) }); }
  };
}
const POOL = { state: /[?&]noworker\b/.test(location.search) ? "off" : "new", workers: [], idle: [], waiting: [], jobs: new Map(), next: 1, url: null };
async function workerURL() {
  const pick = re => [...document.scripts].find(sc => re.test(sc.id || "") || re.test(sc.getAttribute("src") || ""));
  const text = async sc => { if (!sc) throw new Error("script not found"); if (!sc.src) return sc.textContent; const r = await fetch(sc.src); if (!r.ok) throw new Error("fetch failed"); return r.text(); };
  const a = await text(pick(/analysis(\.js)?$/)), d = await text(pick(/descriptors(\.js)?$/));
  return URL.createObjectURL(new Blob([a, "\n", d, "\n(", workerMain.toString(), ")();\n"], { type: "text/javascript" }));
}
async function poolReady() {
  if (POOL.state === "ready") return true;
  if (POOL.state === "off") return false;
  if (POOL.state === "starting") { await POOL.starting; return POOL.state === "ready"; }
  POOL.state = "starting";
  POOL.starting = (async () => {
    try {
      if (typeof Worker === "undefined") throw new Error("no Worker");
      POOL.url = await workerURL();
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      for (let i = 0; i < n; i++) {
        const w = new Worker(POOL.url);
        w.onmessage = ev => onWorkerMessage(w, ev.data);
        w.onerror = ev => { ev.preventDefault && ev.preventDefault(); failWorker(w, "worker error: " + (ev.message || "")); };
        POOL.workers.push(w); POOL.idle.push(w);
      }
      POOL.state = "ready";
    } catch (e) { POOL.state = "off"; }
  })();
  await POOL.starting;
  return POOL.state === "ready";
}
function failWorker(w, msg) {
  // a worker that fails before finishing a job usually means workers are blocked here: switch to the main thread
  for (const [id, j] of POOL.jobs) if (j.w === w) { POOL.jobs.delete(id); j.reject(Object.assign(new Error(msg), { fallback: true })); }
  POOL.state = "off"; POOL.workers.forEach(x => x.terminate()); POOL.workers = []; POOL.idle = [];
  POOL.waiting.splice(0).forEach(j => j.reject(Object.assign(new Error(msg), { fallback: true })));
}
function onWorkerMessage(w, m) {
  const j = POOL.jobs.get(m.id); if (!j) return;
  if (m.stage) { j.progress(m.stage, m.progress); return; }
  POOL.jobs.delete(m.id); POOL.idle.push(w); pumpPool();
  if (m.error) j.reject(new Error(m.error)); else j.resolve(m.F);
}
function pumpPool() {
  while (POOL.idle.length && POOL.waiting.length) {
    const w = POOL.idle.shift(), j = POOL.waiting.shift(); j.w = w; POOL.jobs.set(j.id, j);
    w.postMessage({ id: j.id, sr: j.buf.sampleRate, chans: Array.from({ length: j.buf.numberOfChannels }, (_, c) => Float32Array.from(j.buf.getChannelData(c))), name: j.name });
  }
}
function analyseInWorker(rec, progress) {
  return new Promise((resolve, reject) => { POOL.waiting.push({ id: POOL.next++, buf: rec.buf, name: rec.name, progress, resolve, reject }); pumpPool(); });
}
async function analyseOnMainThread(rec) {
  const F = await WL.analyse(rec.buf, p => setStatus(T("status.analysingP", "Analysing {file}: {p}%", { file: rec.name, p: Math.round(p * 100) })));
  setStatus(T("status.rhythm", "Finding beats and sections in {file}…", { file: rec.name })); await paint();
  WL.rhythmOf(F); WL.structureOf(F); WL.eventsOf(F);
  setStatus(T("status.sfx", "Describing sound objects in {file}…", { file: rec.name })); await paint();
  WL.sfxOf(F, rec.buf, rec.name);
  setStatus(T("status.descriptors", "Describing {file} with cross-field measures…", { file: rec.name })); await paint();
  await PHD.describe(F, rec.buf);
  return F;
}
const stageText = (stage, file, p) => {
  const v = { file }, base = stage === "rhythm" ? T("status.stage.rhythm", "Finding beats and sections in {file}", v) : stage === "sfx" ? T("status.stage.sfx", "Describing sound objects in {file}", v)
    : stage === "descriptors" ? T("status.stage.descriptors", "Describing {file} with cross-field measures", v) : T("status.stage.features", "Analysing {file}", v);
  return p !== undefined ? base + ": " + Math.round(p * 100) + "%" : base + "…";
};
function addFile(rec, select) {
  rec.id = S.nextId++;
  S.files.push(rec);
  renderLibrary();
  S.active = (S.active || 0) + 1;
  const finish = () => { S.active--; if (!S.active) setStatus(""); };
  const job = async useWorker => {
    try {
      setStatus(T("status.analysing", "Analysing {file}…", { file: rec.name }));
      let F = null;
      if (useWorker) {
        const t0 = performance.now();
        try { F = await analyseInWorker(rec, (stage, p) => setStatus(stageText(stage, rec.name, p) + (S.active > 1 ? " " + TP("status.inProgress", S.active, "(one file in progress)", "({n} files in progress)") : ""))); rec.ms = performance.now() - t0; }
        catch (e) { if (!e.fallback) throw e; }
      }
      if (!F) { await paint(); const t0 = performance.now(); F = await analyseOnMainThread(rec); rec.ms = performance.now() - t0; }
      rec.F = F;
      rec.dur = rec.buf.duration;
      if (select || !S.sel) { S.sel = rec; stopAudio(); offset = 0; }
      $("play").disabled = false;
      render();
      if (S.fxLast && S.fxLast.outIds.includes(rec.id)) renderFxResult();
    } catch (e) {
      rec.error = T("status.failedShort", "Analysis failed");
      setStatus(T("status.failed", "Couldn't analyse {file}.", { file: rec.name }) + " " + (e && e.message ? e.message : ""), true);
      renderLibrary();
    } finally { finish(); if (rec.error) setStatus(T("status.failed", "Couldn't analyse {file}.", { file: rec.name }), true); }
  };
  // workers run files in parallel; the main-thread fallback runs them one after another
  const p = poolReady().then(ok => ok ? job(true) : (S.queue = S.queue.then(() => job(false))));
  return p;
}
async function addKit(selectName) {
  setStatus(T("status.kit", "Building the SFX kit…"));
  await paint();
  const kit = WLProbes.makeSfxKit(44100, WL.kFilterCoeffs);
  let last;
  for (const b of kit) last = addFile({ name: b.name, kind: "sfx", buf: b, segments: null, sfxTruth: b.sfxTruth, truth: null, dur: b.duration }, selectName ? b.name === selectName : false);
  return last;
}
async function addProbe(kind, select) {
  setStatus(kind === "arc" ? T("status.arc", "Building the cue arc…") : kind === "ramp" ? T("status.ramp", "Building the tempo ramp…") : kind === "tour" ? T("status.tour", "Building the descriptor tour…") : T("status.probe", "Building the probe suite…"));
  await paint();
  const buf = kind === "arc" ? WLProbes.makeCueArc(44100, WL.kFilterCoeffs) : kind === "ramp" ? WLProbes.makeTempoRamp(44100, WL.kFilterCoeffs) : kind === "tour" ? WLProbes.makeDescriptorTour(44100) : WLProbes.makeProbeSuite(44100, WL.kFilterCoeffs);
  return addFile({ name: buf.name, kind: "probe", buf, segments: buf.segments, truth: buf.truth || null, dur: buf.duration }, select);
}
function decodeFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { ctx().decodeAudioData(fr.result.slice(0)).then(res, rej); };
    fr.onerror = () => rej(new Error("read failed"));
    fr.readAsArrayBuffer(file);
  });
}
async function loadFiles(list) {
  const files = Array.from(list).filter(f => f && f.size);
  let first = true;
  for (const file of files) {
    setStatus(T("status.decoding", "Decoding {file}…", { file: file.name }));
    try {
      const buf = await decodeFile(file);
      addFile({ name: file.name, kind: "file", buf, audio: buf, dur: buf.duration }, first);
      first = false;
    } catch (e) {
      setStatus(T("status.decodeFailed", "Couldn't decode {file}. Try WAV, OGG, MP3 or FLAC; Safari can't decode OGG.", { file: file.name }), true);
    }
  }
}

/* ---------------- playback ---------------- */
let actx = null, src = null, startAt = 0, offset = 0, playing = false, raf = 0;
function ctx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
function audioOf(f) {
  if (f.audio) return f.audio;
  const c = ctx(), n = f.buf.numberOfChannels;
  const b = c.createBuffer(n, f.buf.length, f.buf.sampleRate);
  for (let ch = 0; ch < n; ch++) b.getChannelData(ch).set(f.buf.getChannelData(ch));
  f.audio = b;
  return b;
}
function stopAudio() {
  stopAudition();
  if (src) { try { src.onended = null; src.stop(); } catch (e) { /* already stopped */ } src.disconnect(); src = null; }
  playing = false; cancelAnimationFrame(raf);
  $("play").textContent = T("ui.play", "Play");
}
function play() {
  const f = S.sel; if (!f || !f.F) return;
  const c = ctx(); if (c.state === "suspended") c.resume();
  stopAudition();
  if (src) { try { src.onended = null; src.stop(); } catch (e) { /* noop */ } src.disconnect(); }
  const b = audioOf(f);
  if (offset >= b.duration - 0.02) offset = 0;
  src = c.createBufferSource(); src.buffer = b; src.connect(c.destination);
  src.start(0, offset);
  startAt = c.currentTime; playing = true;
  $("play").textContent = T("ui.pause", "Pause");
  src.onended = () => { if (playing) { offset = 0; stopAudio(); placeHead(0); } };
  loop();
}
function pause() { if (!playing) return; offset += ctx().currentTime - startAt; stopAudio(); placeHead(offset); }
function seek(t, autoplay) {
  const f = S.sel; if (!f) return;
  offset = Math.max(0, Math.min(f.dur, t));
  placeHead(offset);
  if (playing || autoplay) play();
}
// a cursor at time t: a line through the strip, or on the bar raster (time wrapped into rows of bars) a mark at the
// moment's place in its bar, as tall as the row
function cursorAt(el, s, t, dur) {
  const rows = s.cv._raster;
  if (!rows || !rows.length) { el.style.height = ""; el.style.transform = "translateX(" + ((dur ? t / dur : 0) * s.w.clientWidth) + "px)"; return; }
  let r = 0; while (r < rows.length - 1 && t >= rows[r][1]) r++;
  const [a, e] = rows[r], h = s.w.clientHeight / rows.length;
  el.style.height = Math.max(3, h) + "px";
  el.style.transform = "translate(" + (Math.max(0, Math.min(1, (t - a) / (e - a))) * s.w.clientWidth) + "px," + (r * h + Math.min(0, h - 3) / 2) + "px)";
}
// the time under the pointer in a strip
function timeFrom(e, s, dur) {
  const rows = s.cv._raster, fx = fracFrom(e, s.w);
  if (!rows || !rows.length) return fx * dur;
  const rc = s.w.getBoundingClientRect(), r = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - rc.top) / rc.height * rows.length)));
  return Math.max(0, Math.min(dur, rows[r][0] + fx * (rows[r][1] - rows[r][0])));
}
function placeHead(t) {
  const f = S.sel; if (!f) return;
  for (const s of scopes) { s.ph.classList.add("on"); cursorAt(s.ph, s, t, f.dur); }
  $("rulerlab").textContent = fmtT(t, true);
}
function loop() {
  if (!playing) return;
  const t = offset + (ctx().currentTime - startAt);
  placeHead(Math.min(t, S.sel.dur));
  raf = requestAnimationFrame(loop);
}

/* ---------------- wiring ---------------- */
function bindSelect(id, key, parse) {
  const el = $(id);
  el.value = String(S[key]);
  el.addEventListener("change", () => { S[key] = parse ? parse(el.value) : el.value; store.set(key, S[key]); render(); });
}
bindSelect("height", "height", v => parseInt(v, 10));
bindSelect("shape", "shape");
bindSelect("scale", "scale");
bindSelect("panel", "panel");
bindSelect("thumb", "thumb");
$("ghost").checked = !!S.ghost;
$("ghost").addEventListener("change", e => { S.ghost = e.target.checked; store.set("ghost", S.ghost); render(); });
$("cls").addEventListener("change", e => { const f = S.sel; if (!f) return; f.cls = e.target.value === "auto" ? null : e.target.value; render(); });
$("open").addEventListener("click", () => $("file").click());
// footer: copy a citation, the software's or the paper's (falls back to selecting it where the clipboard is blocked,
// e.g. in sandboxed frames)
document.querySelectorAll("button[data-copy]").forEach(b => b.addEventListener("click", async () => {
  const src = $(b.dataset.copy), label = b.textContent, text = src.textContent.replace(/\s+/g, " ").trim();
  try { await navigator.clipboard.writeText(text); b.textContent = T("ui.copied", "Copied"); }
  catch (e) { const r = document.createRange(); r.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = T("ui.selectCopy", "Selected, now copy it"); }
  setTimeout(() => { b.textContent = label; }, 2500);
}));
$("file").addEventListener("change", e => { if (e.target.files.length) loadFiles(e.target.files); e.target.value = ""; });
$("play").addEventListener("click", () => { playing ? pause() : play(); });
$("loadArc").addEventListener("click", () => addProbe("arc", true));
$("loadProbe").addEventListener("click", () => addProbe("probe", true));
$("loadRamp").addEventListener("click", () => addProbe("ramp", true));
$("loadTour").addEventListener("click", () => addProbe("tour", true));
$("loadKit").addEventListener("click", () => addKit("Gun_Pistol_Shot_02.wav"));
$("runfx").addEventListener("click", runFx);

document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("drag"); });
document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("drag"); });
document.addEventListener("drop", e => { e.preventDefault(); document.body.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });

document.addEventListener("keydown", e => {
  if (e.code !== "Space") return;
  const tg = e.target && e.target.tagName;
  if (tg === "INPUT" || tg === "SELECT" || tg === "BUTTON" || tg === "TEXTAREA" || (e.target && e.target.classList && e.target.classList.contains("librow"))) return;
  if (!S.sel || !S.sel.F) return;
  e.preventDefault(); playing ? pause() : play();
});

function fracFrom(e, el) { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
function hookScopes() {
  for (const s of scopes) {
    s.w.addEventListener("pointerdown", e => { if (!S.sel || !S.sel.F) return; seek(timeFrom(e, s, S.sel.dur)); });
    s.w.addEventListener("pointermove", e => {
      if (!S.sel || !S.sel.F || e.pointerType === "touch") return;
      const t = timeFrom(e, s, S.sel.dur);
      for (const o of scopes) { o.hv.classList.add("on"); cursorAt(o.hv, o, t, S.sel.dur); }
      $("rulerlab").textContent = fmtT(t, true);
    });
    s.w.addEventListener("pointerleave", () => {
      for (const o of scopes) o.hv.classList.remove("on");
      $("rulerlab").textContent = fmtT(playing ? offset + (ctx().currentTime - startAt) : offset, true);
    });
  }
}

let rt = 0, lastW = 0;
window.addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const w = $("cv-ruler").clientWidth;
    if (w !== lastW) { lastW = w; render(); if (S.sel) placeHead(playing ? offset + (ctx().currentTime - startAt) : offset); }
  }, 120);
});

// language: ?lang=, the last choice, or the browser's; the menu lists the languages that have translations
if (I18N) {
  I18N.setLanguage(I18N.preferred(), { remember: false });
  const pick = $("lang");
  if (pick) {
    for (const [code, name] of I18N.available()) { const o = el("option", "", name); o.value = code; o.lang = code; pick.appendChild(o); }
    pick.value = I18N.language;
    pick.closest("label").hidden = pick.options.length < 2;
    pick.addEventListener("change", () => I18N.setLanguage(pick.value));
  }
  // "Comment on the translation": a GitHub form, with the language filled in
  const comment = $("lang-comment");
  const commentLink = l => { if (!comment) return; comment.hidden = l === "en"; comment.href = "https://github.com/eigensoundlab/playhead/issues/new?template=translation.yml&title=" + encodeURIComponent("Translation (" + (I18N.languages[l] || l) + "): ") + "&language=" + encodeURIComponent(l); };
  commentLink(I18N.language); I18N.onChange(commentLink);
  const enBox = $("lang-en");
  if (enBox) {
    enBox.checked = I18N.englishTerms;
    enBox.closest("label").hidden = I18N.language === "en";
    enBox.addEventListener("change", () => I18N.setEnglishTerms(enBox.checked));
  }
}
buildRows();
buildComposer();
buildTracks();
$("ghost").addEventListener("change", () => { if (cmpShow) cmpShow(); });
hookScopes();
render();
if (I18N) I18N.onChange(lang => {
  if ($("lang")) $("lang").value = lang;
  if ($("lang-en")) $("lang-en").closest("label").hidden = lang === "en";
  relabelRows();
  buildComposer();
  buildTracks();
  $("toolpick").innerHTML = "";
  setStatus("");
  render();
  $("play").textContent = playing ? T("ui.pause", "Pause") : T("ui.play", "Play");
});
(async () => {
  await addKit("Gun_Pistol_Shot_02.wav");
  await addProbe("arc", false);
  await addProbe("ramp", false);
  await addProbe("probe", false);
  await addProbe("tour", false);
})();
})();
