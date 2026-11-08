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

const VERSION = "0.3.0";            // kept equal to package.json by the test suite
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
// base64 for byte arrays, without Buffer or btoa (works the same in Node, pages, workers and modules)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toB64(u8) {
  let out = "";
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0, n = (a << 16) | (b << 8) | c;
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u8.length ? B64[n >> 6 & 63] : "=") + (i + 2 < u8.length ? B64[n & 63] : "=");
  }
  return out;
}
function fromB64(str) {
  const clean = String(str).replace(/[^A-Za-z0-9+/]/g, ""), n = Math.floor(clean.length * 3 / 4), out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) | (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (o < n) out[o++] = v >> 16 & 255; if (o < n) out[o++] = v >> 8 & 255; if (o < n) out[o++] = v & 255;
  }
  return out;
}
// mel spectrogram for the strip's spectrogram layer: per column the loudest frame in each band, 80 dB below the
// file's top mapped to 0..255, column after column, lowest band first; base64 to keep the JSON small
function spectrumOf(F, cols) {
  const B = Math.round(F.melDb.length / F.nF), n = F.nF, top = (() => { const v = Array.from(F.melDb).sort((a, b) => a - b); return v[Math.floor(0.999 * (v.length - 1))]; })();
  const lo = top - 80, u8 = new Uint8Array(cols * B);
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * n / cols), e = Math.max(a + 1, Math.floor((c + 1) * n / cols));
    for (let b = 0; b < B; b++) {
      let mx = -Infinity; for (let m = a; m < e && m < n; m++) { const v = F.melDb[m * B + b]; if (v > mx) mx = v; }
      u8[c * B + b] = Math.max(0, Math.min(255, Math.round((mx - lo) / 80 * 255)));
    }
  }
  const nyq = F.sr / 2;
  return { scale: "mel", bands: B, fmin: 40, fmax: rnd(Math.min(16000, nyq * 0.95), 1), columns: cols, dbTop: rnd(top, 2), dbRange: 80, encoding: "base64-u8", data: toB64(u8) };
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
// the modulation spectrogram for the "spec:mod" look: one byte per rate and column, 0 for no data, else 1 + 254 x the
// square root of the modulation depth (so that shallow modulation keeps its detail)
function modulationDoc(m) {
  const u8 = new Uint8Array(m.rows * m.cols);
  for (let c = 0; c < m.cols; c++) for (let r = 0; r < m.rows; r++) { const v = m.data[r * m.cols + c]; u8[c * m.rows + r] = v < 0 ? 0 : 1 + Math.round(254 * Math.sqrt(Math.min(1, v))); }
  return { rateMin: m.rateMin, perOctave: m.perOctave, rows: m.rows, columns: m.cols, hop: rnd(m.hop, 4), scale: "sqrt", encoding: "base64-u8", data: toB64(u8) };
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
/* ---------------- attacks and the beat grid ---------------- */
// An onset moved to where its level starts to rise, to the sample: the analysis finds onsets on 11.6 ms frames and
// labels them up to about 25 ms before the sound. Within 15 ms before to 35 ms after the onset: the 1 ms envelope's
// highest point and the quietest point before it; then back from the peak to where the envelope was last below a tenth
// of the way up (searching back, not forward, so the ripple of an earlier sound's low tail is not taken for the rise).
function refineAttack(x, sr, t) {
  const o = Math.round(t * sr), a = Math.max(0, o - Math.round(0.015 * sr)), b = Math.min(x.length, o + Math.round(0.035 * sr)), r = Math.max(1, Math.round(0.001 * sr));
  if (b - a < 4 * r) return t;
  const env = new Float32Array(b - a); let acc = 0;
  for (let i = a; i < b; i++) { acc += Math.abs(x[i]); if (i - r >= a) acc -= Math.abs(x[i - r]); env[i - a] = acc / r; }
  let pk = 0; for (let i = 1; i < env.length; i++) if (env[i] > env[pk]) pk = i;
  let lo = 0; for (let i = 1; i <= pk; i++) if (env[i] < env[lo]) lo = i;
  const th = env[lo] + 0.1 * (env[pk] - env[lo]);
  let i = pk; while (i > lo && env[i - 1] >= th) i--;
  return (a + Math.max(0, i - r + 1)) / sr;
}
const BANDS = ["low", "mid", "high"];
// Each onset as an attack: its time to the sample and the band it rises in most (low < 200 Hz, mid to 2 kHz, high
// above), with the three shares
function attacksOf(F, buf, times, R) {
  const n = buf.length, x = new Float32Array(n), C = buf.numberOfChannels;
  for (let c = 0; c < C; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / C; }
  // each band on its own scale, but no band's scale below a tenth of the strongest's (a band that hardly ever rises is
  // not blown up to look like the others)
  const own = R.bandEnv.map(e => { const v = Array.from(e).filter(u => u > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(0.99 * (v.length - 1))] || 0 : 0; });
  const big = Math.max(...own) || 1, tops = own.map(v => Math.max(v, 0.1 * big));
  return times.map(t => {
    const ft = refineAttack(x, buf.sampleRate, t), m = Math.floor(ft / F.dt);
    const s = R.bandEnv.map((e, k) => { let mx = 0; for (let j = Math.max(0, m - 3); j <= Math.min(F.nF - 1, m + 2); j++) mx = Math.max(mx, e[j]); return mx / tops[k]; });
    const tot = s[0] + s[1] + s[2] || 1, k = s.indexOf(Math.max(...s));
    return { t: rnd(ft, 5), band: BANDS[k], bands: s.map(v => rnd(v / tot, 3)) };
  });
}
// The attacks on the beat grid. The beat's length comes from a straight line through the attacks that fall on beats
// over five bars (Theil-Sen, so a late snare or a flam does not tilt it); each bar's downbeat from its low-band attacks
// on beats (kick, bass) where it has some, else from all its attacks on beats: the grid is where the low end puts the
// beats, and the other bands' offsets are read against it ("the snare 25 ms behind the kick"). Each attack then takes
// the nearest place in the beat (the 16ths, and the swung 8th when the music swings) and its deviation from it in ms.
// Swing: from beats with a single attack inside them, the median place of that attack, as a ratio (1 straight, 2 the
// triplet feel, 3 dotted; null when too few beats have one). Per bar: each band's median deviation (offsets), and the tightness: the spread of the
// deviations once each band's offset is taken out (1.4826 x their median absolute deviation, ms), so a laid-back
// snare is not "loose" and one stray onset does not make a bar so.
// Returns { grid: [{ t, bar, pos (beats into the bar), dev (ms), band }], bars: [{ start, beat, tightness, offsets }],
// swing } or null without a beat.
function gridOf(attacks, beats, downbeats, bpb) {
  if (beats.length < 8 || downbeats.length < 2) return null;
  const nb = beats.length, beatAt = t => { let lo = 0, hi = nb - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; } return lo; };
  const median = v => { if (!v.length) return null; const w = v.slice().sort((a, b) => a - b); return w.length % 2 ? w[w.length >> 1] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2; };
  // swing from single off-beat attacks
  const inner = new Map();
  for (const a of attacks) {
    const i = beatAt(a.t); if (i >= nb - 1 || a.t < beats[0]) continue;
    const p = (a.t - beats[i]) / (beats[i + 1] - beats[i]);
    if (p > 0.1 && p < 0.9) { if (!inner.has(i)) inner.set(i, []); inner.get(i).push(p); }
  }
  const single = []; for (const ps of inner.values()) if (ps.length === 1) single.push(ps[0]);
  const med = single.length >= 8 ? median(single) : null;
  const swing = med != null && med > 0.4 && med < 0.8 && single.filter(p => Math.abs(p - med) < 0.08).length >= 0.6 * single.length ? med / (1 - med) : null;
  const swung = swing != null && swing > 1.15 ? swing / (1 + swing) : null;
  const slots = [0, 0.25, 0.5, 0.75, 1].filter(s => !swung || Math.abs(s - swung) > 0.1).concat(swung ? [swung] : []);
  // the attacks on beats: [global beat index, time, band]
  const on = [];
  for (const a of attacks) {
    const i = beatAt(a.t);
    for (const j of [i, i + 1]) if (j >= 0 && j < nb && Math.abs(a.t - beats[j]) < 0.06) { on.push([j, a.t, a.band]); break; }
  }
  const theilSen = pts => {
    const sl = []; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    return sl.length ? median(sl) : null;
  };
  const first = beats.indexOf(downbeats[0]), grid = [], bars = [];
  for (let k = 0, i0 = first; i0 + bpb < nb; k++, i0 += bpb) {
    const t0 = beats[i0], t1 = beats[i0 + bpb], per = (t1 - t0) / bpb;
    let b = theilSen(on.filter(p => p[0] >= i0 - 2 * bpb && p[0] < i0 + 3 * bpb));
    if (!(b > 0.7 * per && b < 1.3 * per)) b = per;
    const mine = on.filter(p => p[0] >= i0 && p[0] < i0 + bpb), low = mine.filter(p => p[2] === "low");
    const a0 = median((low.length ? low : mine).map(p => p[1] - (p[0] - i0) * b));
    const a = a0 != null && Math.abs(a0 - t0) < 0.06 ? a0 : t0;
    const rows = [];
    for (const at of attacks) {
      const x = (at.t - a) / b;
      if (x < -0.125 || x >= bpb - 0.125) continue;            // from a 32nd before the downbeat to a 32nd before the next
      const j = Math.floor(x), q = x - j;
      let best = slots[0]; for (const sl of slots) if (Math.abs(q - sl) < Math.abs(q - best)) best = sl;
      const pos = j + best;
      if (pos < -1e-9 || pos >= bpb - 1e-9) continue;
      rows.push({ t: at.t, bar: k, pos: rnd(pos, 3), dev: (q - best) * b * 1000, band: at.band });
    }
    const offsets = {};
    for (const band of BANDS) { const m = median(rows.filter(r => r.band === band).map(r => r.dev)); offsets[band] = m == null ? null : rnd(m, 1); }
    const resid = rows.map(r => r.dev - (offsets[r.band] || 0)), mr = median(resid);
    const mad = resid.length >= 4 ? median(resid.map(v => Math.abs(v - mr))) : null;
    for (const r of rows) { r.dev = rnd(r.dev, 1); grid.push(r); }
    bars.push({ start: rnd(a, 4), beat: rnd(b, 4), tightness: mad == null ? null : rnd(1.4826 * mad, 1), offsets });
  }
  // within 15 % of 1 the off-beats are straight (the beat tracker's own frames move them that much)
  return { grid, bars, swing: swing == null ? null : swing > 0.87 && swing < 1.15 ? 1 : rnd(swing, 3) };
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
    harshness: resample(cur.curves.c4, F, cols, g), timbreHarshness: resample(cur.colour.harsh, F, cols, g), tension: resample(cur.curves.c5, F, cols, g), harmonicTension: resample(cur.curves.c6, F, cols, g),
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
    noveltyTicks: cur.ticks.map(m => rnd(m * F.dt, 4)),
    rhythm: null, sections: null, events: null, layers: null, issues: null, descriptors: null
  };
  // a small mel spectrogram for the spectrogram layer (sfx and music profiles; opts.spectrum false leaves it out)
  if (opts.spectrum !== false && (profile !== "fast" || opts.spectrum === true)) { doc.spectrum = spectrumOf(F, cols); if (F.mod) doc.modulation = modulationDoc(F.mod); }
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
      n1Kurtosis: resample(D.curves.kurtLocal || D.curves.kurt, F, cols, null, "max"), n2RepetitionHz: resample(D.curves.repHz, F, cols, null), n4Velocity: resample(D.curves.vel, F, cols, null),
      n5Cpp: resample(D.curves.cpp, F, cols, null), n5Coherence: resample(D.curves.pci, F, cols, null), n6Arrow: resample(D.curves.arrow, F, cols, null),
      n7Surprisal: resample(D.curves.surprisal, F, cols, null), n8Recurrence: resample(D.curves.recDensity, F, cols, null)
    });
    // onset strength (spectral flux, the beat tracker's input): where the hits and attacks are, scaled to its 99th percentile
    const Rr = WL.rhythmOf(F), envS = Array.from(Rr.env).filter(v => v > 0).sort((a, b) => a - b), envTop = envS.length ? envS[Math.floor(0.99 * (envS.length - 1))] || 1 : 1;
    doc.curves.onsetStrength = resample(Rr.env.map(v => Math.min(1, v / envTop)), F, cols, null, "max");
    // the same per band (low < 200 Hz, mid to 2 kHz, high above: roughly kick, snare, hats), each to its own 99th percentile
    Rr.bandEnv.forEach((e, k) => {
      const v = Array.from(e).filter(u => u > 0).sort((a, b) => a - b), top = v.length ? v[Math.floor(0.99 * (v.length - 1))] || 1 : 1;
      doc.curves["onset" + ["Low", "Mid", "High"][k]] = resample(e.map(u => Math.min(1, u / top)), F, cols, null, "max");
    });
    // each onset to the sample where its level starts to rise, with the band it rises in
    doc.attacks = attacksOf(F, buf, ev.onsetTimes, Rr);
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
    doc.rhythm = { tempo: rnd(R.tempo, 2), reliable: !!R.reliable, clarity: rnd(R.medClar, 3), beats: R.beatTimes.map(t => rnd(t, 4)), downbeats: R.downTimes.map(t => rnd(t, 4)),
      beatsPerBar: R.beatsPerBar, downbeatConfidence: rnd(1 - Math.exp(-Math.max(0, R.downConf || 0)), 3),
      meter: R.meterEvidence ? { 3: rnd(R.meterEvidence[3], 3), 4: rnd(R.meterEvidence[4], 3) } : null };
    doc.curves.pulseClarity = resample(R.clarity, F, cols, null);
    // the attacks on the beat grid: place in the bar, deviation in ms, and per bar the tightness and each band's offset
    const G = R.reliable && doc.attacks ? gridOf(doc.attacks, R.beatTimes, R.downTimes, R.beatsPerBar) : null;
    if (G) {
      const med = v => { const w = v.filter(x => x != null).sort((a, b) => a - b); return w.length ? rnd(w[w.length >> 1], 1) : null; };
      Object.assign(doc.rhythm, { grid: G.grid, bars: G.bars, swing: G.swing,
        timing: { tightness: med(G.bars.map(b => b.tightness)), offsets: { low: med(G.bars.map(b => b.offsets.low)), mid: med(G.bars.map(b => b.offsets.mid)), high: med(G.bars.map(b => b.offsets.high)) } } });
    }
    doc.sections = St.segs.map(sg => ({ start: rnd(sg.t0, 3), end: rnd(sg.t1, 3), label: sg.label }));
    // structural change (Foote novelty) and the local pulse (PLP, scaled by its clarity), for lanes and modulation
    const pulse = new Float32Array(F.nF);
    for (let m = 0; m < F.nF; m++) pulse[m] = R.plp[m] * Math.min(1, R.clarity[m] / 0.6);
    doc.curves.structureNovelty = resample(St.nov, F, cols, null, "max");
    doc.curves.localPulse = resample(pulse, F, cols, null, "max");
    // the tempogram and the repetition (time-lag) view, as small images for the "spec:tempo" and "spec:lag" looks
    const TG = R.tempogram;
    if (TG && TG.cols) {
      let pk = 1e-9; for (const v of TG.data) if (v > pk) pk = v;
      const u8 = Uint8Array.from(TG.data, v => Math.round(255 * Math.min(1, v / pk)));
      doc.rhythm.tempogram = { bpmMin: TG.bpmMin, perOctave: TG.perOctave, bins: TG.bins, start: rnd(TG.start, 3), hop: rnd(TG.hop, 4), columns: TG.cols, peak: rnd(pk, 4), encoding: "base64-u8", data: toB64(u8) };
    }
    const LG = St.lag;
    if (LG) doc.repetition = { unit: St.useBeats ? "beat" : "time", unitSeconds: rnd(St.blk, 4), lagStep: LG.lstep, lags: LG.nLag, columns: LG.cols, times: LG.times.map(t => rnd(t, 3)), encoding: "base64-u8", data: toB64(LG.data) };
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
  const tk = (t, rest, en) => L("lib.tool." + t.id + rest, en);
  return FX.TOOLS.map(t => ({ id: t.id, name: tk(t, ".name", t.name), kind: t.kind, description: tk(t, ".desc", t.desc), params: Array.isArray(t.params) ? t.params.map(p => ({ id: p.id, label: tk(t, ".param." + p.id, p.label), type: p.type || "number", min: p.min, max: p.max, step: p.step, value: p.value, unit: p.unit || null, options: p.options ? p.options.map(o => [o[0], tk(t, ".opt." + p.id + "." + o[0], o[1])]) : null })) : t.params }));
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

/* ---------------- combining documents: tracks in a folder ---------------- */
// The common rate is the longest part's: a document's rate is its column count over its length, so a very short part's
// is rounded (a 0.03 s click at 100 per second has 3 columns, 100 +- 17 per second) and is allowed to differ by that much.
function curveRateOf(ps) {
  const len = p => (p.doc.curves.lufs || []).length, ref = ps.reduce((a, p) => (len(p) > len(a) ? p : a), ps[0]), rate = ref.doc.curves.rate;
  if (ps.some(p => Math.abs(p.doc.curves.rate / rate - 1) > 0.05 + 0.5 / Math.max(1, len(p)))) throw new Error("Playhead: analyse every part with the same curveRate");
  return rate;
}
// What the sum of several sounds looks like, from their documents alone: no audio, no new analysis. For folder tracks,
// layered sound effects and stems. parts: [{ doc, offset, gain }], offset in seconds (where the part starts in the
// whole, default 0), gain in dB (default 0). Analyse the parts with the same profile, asset class and curveRate.
//
//   Playhead.align(parts, opts)    the parts on one time axis: for each part its power per column (from its LUFS) and,
//                                  when every part has a spectrogram, its power per column and band. For views that show
//                                  which part carries what. opts: rate (columns per second, default the first part's),
//                                  duration (default where the last part ends).
//   Playhead.combine(parts, opts)  a document for the whole, drawn and read like any other (doc.combined says how it
//                                  was made). opts as for align, and wave: a waveform overview of the real sum (same
//                                  format as doc.wave) to use instead of the estimate; aligned: align()'s result for
//                                  the same parts and options, when the caller has it already.
//
// The rules (COMBINE_RULES), tested on 14 sessions built from separate parts (experiments/compose; r against the
// analysed mix, music / impacts): LUFS and the spectrogram add as power (0.94 / 1.00, within 0.4 dB), and loudness
// follows from the summed LUFS. Harshness is loudness plus a factor, so it is the whole's loudness plus the parts'
// power-weighted harshness above their own loudness (0.81 / 0.97); activity, arousal and tension take the strongest
// part (0.84 / 0.92, 0.87 / 0.99, 0.72); onsets are merged (F 0.85 / 0.93). Context-dependent ones come out rough:
// surprise 0.51, events F 0.49 / 0.57 (three layers struck together are one event in the mix). The descriptor curves
// follow the loudest part (not tested). Sections are left out: they need the whole.
const COMBINE_RULES = {
  lufs: "power sum", loudness: "from the summed LUFS", harshness: "loudness + weighted excess", arousal: "max",
  activity: "max", tension: "max", harmonicTension: "weighted mean", surprise: "max", onsetStrength: "sum", structureNovelty: "max", localPulse: "max",
  n1Kurtosis: "loudest", n2RepetitionHz: "loudest", n4Velocity: "loudest", n5Cpp: "loudest", n5Coherence: "loudest", n6Arrow: "loudest",
  n7Surprisal: "max", n8Recurrence: "weighted mean", timbreHarshness: "weighted mean", onsetLow: "sum", onsetMid: "sum", onsetHigh: "sum", pulseClarity: "max"
};
// how far a part's gain moves its 0..1 curves (fixed scales: loudness is (LUFS + 60) / 60, harshness is loudness plus a
// factor, arousal half loudness)
const GAIN_SHIFT = { loudness: 1, harshness: 1, arousal: 0.5 };
const specPowCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
function specPower(sp) {
  if (specPowCache && specPowCache.has(sp)) return specPowCache.get(sp);
  const u8 = specBytes(sp), lo = sp.dbTop - sp.dbRange, out = new Float32Array(u8 ? u8.length : 0);
  for (let i = 0; i < out.length; i++) out[i] = u8[i] ? Math.pow(10, (lo + u8[i] / 255 * sp.dbRange) / 10) : 0;
  if (specPowCache) specPowCache.set(sp, out);
  return out;
}
function align(parts, opts) {
  opts = opts || {};
  const ps = (parts || []).filter(p => p && p.doc && p.doc.curves && p.doc.source);
  if (!ps.length) throw new Error("Playhead.align: no parts (expected [{ doc, offset, gain }])");
  const rate = opts.rate || curveRateOf(ps);
  const duration = opts.duration || Math.max(...ps.map(p => (p.offset || 0) + p.doc.source.duration));
  const cols = Math.max(1, Math.round(duration * rate));
  const B = ps.every(p => p.doc.spectrum && p.doc.spectrum.bands === ps[0].doc.spectrum.bands) ? ps[0].doc.spectrum.bands : 0;
  const out = { rate, duration, columns: cols, bands: B, parts: [] };
  for (const p of ps) {
    const d = p.doc, off = p.offset || 0, gain = p.gain || 0, g = Math.pow(10, gain / 10), cr = d.curves.rate, lufs = d.curves.lufs || [], n = lufs.length;
    const idx = new Int32Array(cols), power = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / rate - off, i = Math.floor(t * cr);
      idx[c] = t >= 0 && i < n ? i : -1;
      if (idx[c] >= 0 && lufs[i] != null) power[c] = Math.pow(10, lufs[i] / 10) * g;
    }
    let spectrum = null;
    if (B) {
      const sp = d.spectrum, P = specPower(sp), sr = sp.columns / d.source.duration;
      spectrum = new Float32Array(cols * B);
      for (let c = 0; c < cols; c++) {
        const t = (c + 0.5) / rate - off, j = Math.floor(t * sr);
        if (t < 0 || j >= sp.columns) continue;
        for (let b = 0; b < B; b++) spectrum[c * B + b] = P[j * B + b] * g;
      }
    }
    out.parts.push({ doc: d, offset: off, gain, idx, power, spectrum });
  }
  return out;
}
// times from several parts in one list; times closer than gap merge into the first
function mergeTimes(lists, gap) {
  const all = [].concat(...lists).filter(t => t != null).sort((a, b) => a - b), out = [];
  for (const t of all) if (!out.length || t - out[out.length - 1] > gap) out.push(t);
  return out;
}
const r4 = v => Math.round(v * 1e4) / 1e4;          // rnd(v, 4) without toFixed, for the per-column loops below
function combine(parts, opts) {
  opts = opts || {};
  const A = opts.aligned || align(parts, opts), cols = A.columns, rate = A.rate, dur = A.duration, ps = A.parts, first = ps[0].doc;
  const total = new Float64Array(cols);
  for (const p of ps) for (let c = 0; c < cols; c++) total[c] += p.power[c];
  const val = (p, k, c) => {        // a part's value of curve k in column c, moved by its gain where the curve follows level
    const arr = p.doc.curves[k], i = p.idx[c];
    if (!arr || i < 0 || arr[i] == null) return null;
    const sh = GAIN_SHIFT[k];
    return sh && p.gain ? Math.max(0, Math.min(1, arr[i] + sh * p.gain / 60)) : arr[i];
  };
  const curves = { rate: rnd(rate, 6), start: 0, scale: first.curves.scale };
  const lufs = new Array(cols), loud = new Array(cols);
  for (let c = 0; c < cols; c++) {
    lufs[c] = total[c] > 0 ? r4(10 * Math.log10(total[c])) : null;
    loud[c] = lufs[c] == null ? null : r4(Math.max(0, Math.min(1, (lufs[c] + 60) / 60)));
  }
  curves.lufs = lufs;
  const names = Object.keys(COMBINE_RULES).filter(k => k !== "lufs" && ps.some(p => Array.isArray(p.doc.curves[k])));
  for (const k of names) {
    if (k === "loudness") { curves.loudness = loud; continue; }
    const rule = COMBINE_RULES[k], out = new Array(cols), base = /excess/.test(rule) ? GAIN_SHIFT[k] : 0;
    for (let c = 0; c < cols; c++) {
      if (lufs[c] == null) { out[c] = null; continue; }
      let v = null;
      if (rule === "max") { for (const p of ps) { const x = val(p, k, c); if (x != null && (v == null || x > v)) v = x; } }
      else if (rule === "sum") { for (const p of ps) { const x = val(p, k, c); if (x != null) v = (v || 0) + x; } if (v != null && /^onset/.test(k)) v = Math.min(1, v); }
      else if (rule === "loudest") { let bw = 0; for (const p of ps) { const x = val(p, k, c); if (x != null && p.power[c] > bw) { bw = p.power[c]; v = x; } } }
      else {    // weighted by each part's power; the excess rules add it to the whole's loudness
        let s = 0, w = 0;
        for (const p of ps) {
          const x = val(p, k, c); if (x == null || !p.power[c]) continue;
          const l = base ? val(p, "loudness", c) : 0;
          s += p.power[c] * (x - base * (l == null ? 0 : l)); w += p.power[c];
        }
        v = w ? (base ? Math.max(0, Math.min(1, base * loud[c] + s / w)) : s / w) : null;
      }
      out[c] = v == null ? null : r4(v);
    }
    curves[k] = out;
  }
  // the waveform: the sum of the parts' peaks (an upper bound) and of their RMS power, unless the real one is given
  let wave = opts.wave || null;
  if (!wave) {
    const wc = opts.waveColumns || 1000, mn = new Array(wc).fill(0), mx = new Array(wc).fill(0), pw = new Float64Array(wc);
    for (const p of ps) {
      const w = p.doc.wave, a = Math.pow(10, p.gain / 20), pd = p.doc.source.duration;
      if (!w) continue;
      for (let c = 0; c < wc; c++) {
        const t = (c + 0.5) / wc * dur - p.offset; if (t < 0 || t >= pd) continue;
        const i = Math.min(w.columns - 1, Math.floor(t / pd * w.columns));
        mn[c] += (w.min[i] || 0) * a; mx[c] += (w.max[i] || 0) * a; pw[c] += Math.pow((w.rms[i] || 0) * a, 2);
      }
    }
    wave = { columns: wc, min: mn.map(r4), max: mx.map(r4), rms: Array.from(pw, v => r4(Math.sqrt(v))), estimate: "sum of the parts' peaks" };
  }
  // the spectrogram: power sum, encoded like a part's (80 dB below the whole's top)
  let spectrum = null;
  if (A.bands) {
    const B = A.bands, sum = new Float64Array(cols * B);
    for (const p of ps) for (let i = 0; i < sum.length; i++) sum[i] += p.spectrum[i];
    // the top as for a part's spectrogram: the 99.9th percentile of the cells, from a 0.1 dB histogram below the maximum
    const db = new Float32Array(sum.length); let mxDb = -Infinity, nFin = 0;
    for (let i = 0; i < sum.length; i++) { const v = sum[i] > 0 ? 10 * Math.log10(sum[i]) : -Infinity; db[i] = v; if (v > -Infinity) { nFin++; if (v > mxDb) mxDb = v; } }
    let top = nFin ? mxDb : 0;
    if (nFin) {
      const hist = new Uint32Array(1201); for (let i = 0; i < db.length; i++) if (db[i] > -Infinity) hist[Math.min(1200, Math.round((mxDb - db[i]) * 10))]++;
      let above = 0; const need = nFin - Math.floor(0.999 * (nFin - 1));
      for (let k = 0; k <= 1200; k++) { above += hist[k]; if (above >= need) { top = mxDb - k / 10; break; } }
    }
    const lo = top - 80, u8 = new Uint8Array(cols * B);
    for (let i = 0; i < u8.length; i++) u8[i] = db[i] > -Infinity ? Math.max(0, Math.min(255, Math.round((db[i] - lo) / 80 * 255))) : 0;
    const s0 = first.spectrum;
    spectrum = { scale: s0.scale, bands: B, fmin: s0.fmin, fmax: s0.fmax, columns: cols, dbTop: rnd(top, 2), dbRange: 80, encoding: "base64-u8", data: toB64(u8) };
  }
  // marks: onsets, events and novelty ticks merged; the beat grid of the part with the clearest pulse
  const shift = (ts, p) => (ts || []).map(t => t + p.offset).filter(t => t >= 0 && t <= dur);
  // a part that starts with sound has no onset at its own time 0 (nothing came before it); placed later in the whole, it has one
  const entry = p => { const s = p.doc.summary && p.doc.summary.soundStart, on = p.doc.onsets || []; return s != null && p.offset + s > 0.05 && !(on.length && on[0] - s < 0.05) ? [s] : []; };
  const onsets = mergeTimes(ps.map(p => shift(entry(p).concat(p.doc.onsets || []), p)), 0.03).map(t => rnd(t, 4));
  const noveltyTicks = mergeTimes(ps.map(p => shift(p.doc.noveltyTicks, p)), 0.05).map(t => rnd(t, 4));
  let events = null;
  if (ps.some(p => p.doc.events)) {
    const all = [];
    for (const p of ps) for (const e of p.doc.events || []) {
      const mv = t => (t == null ? null : rnd(t + p.offset, 4));
      all.push(Object.assign({}, e, { start: mv(e.start), end: mv(e.end), decayEnd: mv(e.decayEnd), peak: mv(e.peak), peakDb: e.peakDb == null ? null : rnd(e.peakDb + p.gain, 2), grains: (e.grains || []).map(mv) }));
    }
    all.sort((a, b) => a.start - b.start);
    events = [];
    for (const e of all) {
      const last = events[events.length - 1];
      if (last && e.start - last.start <= 0.03) { if ((e.peakDb || -99) > (last.peakDb || -99)) events[events.length - 1] = e; }
      else events.push(e);
    }
  }
  let rhythm = null;
  const rh = ps.filter(p => p.doc.rhythm).sort((a, b) => (b.doc.rhythm.reliable - a.doc.rhythm.reliable) || ((b.doc.rhythm.clarity || 0) - (a.doc.rhythm.clarity || 0)))[0];
  if (rh) {
    const r = rh.doc.rhythm, inPart = t => t >= rh.offset && t <= rh.offset + rh.doc.source.duration && t <= dur;
    rhythm = { tempo: r.tempo, reliable: r.reliable, clarity: r.clarity, beats: r.beats.map(t => rnd(t + rh.offset, 4)).filter(inPart), downbeats: r.downbeats.map(t => rnd(t + rh.offset, 4)).filter(inPart), from: ps.indexOf(rh) };
  }
  const lf = lufs.filter(v => v != null).sort((a, b) => a - b), q = p => lf.length ? lf[Math.floor(p * (lf.length - 1))] : null;
  const starts = ps.map(p => p.doc.summary && p.doc.summary.soundStart != null ? p.doc.summary.soundStart + p.offset : null).filter(v => v != null);
  const ends = ps.map(p => p.doc.summary && p.doc.summary.soundEnd != null ? p.doc.summary.soundEnd + p.offset : null).filter(v => v != null);
  return {
    schema: SCHEMA, schemaVersion: SCHEMA_VERSION,
    generator: { name: "playhead", version: VERSION },
    source: { name: opts.name || null, sampleRate: first.source.sampleRate, channels: Math.max(...ps.map(p => p.doc.source.channels || 1)), duration: rnd(dur, 4) },
    profile: first.profile, assetClass: first.assetClass, guessedClass: first.guessedClass,
    summary: { peakLufs: lf.length ? rnd(lf[lf.length - 1], 2) : null, loudnessRange: lf.length ? rnd(q(0.95) - q(0.1), 2) : null, soundStart: starts.length ? rnd(Math.min(...starts), 4) : null, soundEnd: ends.length ? rnd(Math.min(dur, Math.max(...ends)), 4) : null },
    curves, wave, spectrum, onsets, noveltyTicks, rhythm, sections: null, events, layers: null, issues: null, descriptors: null,
    combined: { parts: ps.map(p => ({ name: p.doc.source.name, offset: rnd(p.offset, 4), gain: rnd(p.gain, 2) })), rules: Object.fromEntries(["lufs"].concat(names).map(k => [k, COMBINE_RULES[k]])) }
  };
}

/* ---------------- arranging parts: measures of the whole and a search over offsets and gains ---------------- */
// Because a whole can be combined from its parts' documents in about a millisecond, a computer can try hundreds of
// arrangements a second and keep the ones that serve a goal. Everything here works from documents (no audio), on the
// curve columns (10 ms for sound effects, 50 ms for music); a host lines the chosen arrangement up to the sample.
//
//   Playhead.measureParts(parts, opts)  measures of the whole for parts [{ doc, offset, gain }], around its main peak:
//     rise      seconds the loudness takes to climb the last 20 dB into the main peak (short: a hard attack)
//     contrast  dB the main peak stands above the 60-250 ms before it (silence before an impact makes it bigger)
//     focus     dB the main peak stands above the 150-400 ms after it (high: short and punchy; low: long and full)
//     together  0..1, how many of the parts in the main hit (as for overlap) start within ±8 ms of each other, each by
//               its onset nearest the peak (80 ms before it to 100 ms after: a part that comes in late counts against it)
//     overlap   0..1, how many parts sound in the main hit (from 50 ms before to 100 ms after its peak, with at least
//               3 % of the whole's energy there): spreading layers apart in time is not layering
//     coverage  0..1, the share of frequency bands within 30 dB of the strongest one, in the 300 ms from the peak
//     low       0..1, the share of energy below 120 Hz in those 300 ms
//     tail      seconds until the whole falls 30 dB below the main peak
//     shared    0..1, the share of energy in time-frequency cells where the two strongest parts are within 6 dB
//               (where one may mask the other)
//     harshness the whole's mean harshness (0..1, combined as in combine())
//     and score: the goal's 0..1 score, from GOALS
//   Playhead.arrange(parts, opts)  searches offsets and gains for opts.goal ("punch", "big" or "clean", or weights over
//     the scores below) and returns { goal, baseline, candidates: [{ parts: [{ offset, gain }], score, measures,
//     changes }], evaluated, ms }. Parts with lock: true stay as they are; without any, the loudest part stays.
//     A part may be trimmed (measureParts and arrange): start and end, in seconds of its document, are the part of
//     the file that is heard (as an editor's item that starts later in its file or ends early); offset still says
//     where the document's 0 sits.
//     opts: range (seconds each part may move, default 0.25), gainRange ([lowest, highest] change in dB, default
//     [-6, 3]; each dB of change costs 0.004 of score, so turning layers down is not a free win), minOffset (default
//     0), maxOffset, count (candidates, default 6), restarts, steps, seed, maxHarshness (above it the score drops,
//     default 0.9).
// The goals are first heuristics to be tested by listening (see experiments/compose); the candidates are suggestions
// to audition, not answers.
const GOALS = {
  punch: { punch: 1 },
  big: { size: 1, punch: 0.25 },
  clean: { clean: 1, punch: 0.25 }
};
const clip01 = v => Math.max(0, Math.min(1, v));
// the 0..1 scores a goal combines
function partScores(m) {
  const sep = m.shared == null ? 0.5 : 1 - m.shared, hard = clip01(1 - (m.rise - 0.01) / 0.1);
  return {
    punch: 0.2 * hard + 0.1 * clip01(m.contrast / 40) + 0.2 * clip01(m.focus / 30) + 0.2 * m.together + 0.1 * sep + 0.2 * m.overlap,
    size: 0.3 * (m.coverage == null ? 0.5 : m.coverage) + 0.25 * clip01(m.tail / 2) + 0.2 * (m.low == null ? 0 : clip01(m.low / 0.4)) + 0.15 * hard + 0.1 * m.together,
    clean: 0.5 * sep + 0.2 * m.overlap + 0.15 * m.together + 0.15 * hard
  };
}
// the parts as arrays on one column grid, ready for many evaluations
function prepareParts(parts) {
  const ps = (parts || []).filter(p => p && p.doc && p.doc.curves && Array.isArray(p.doc.curves.lufs));
  if (!ps.length) throw new Error("Playhead: no parts (expected [{ doc, offset, gain }])");
  const rate = curveRateOf(ps);
  const B = ps.every(p => p.doc.spectrum && p.doc.spectrum.bands === ps[0].doc.spectrum.bands) ? ps[0].doc.spectrum.bands : 0;
  const sp0 = B ? ps[0].doc.spectrum : null, mel = f => 2595 * Math.log10(1 + f / 700);
  const bandOf = f => (sp0 ? Math.max(0, Math.min(B - 1, Math.floor((mel(f) - mel(sp0.fmin)) / (mel(sp0.fmax) - mel(sp0.fmin)) * (B + 1) - 0.5))) : 0);
  const prepared = ps.map(p => {
    // each part on the common grid, by time (a document's rate is rounded to its own length)
    const d = p.doc, c = d.curves, own = c.lufs.length, n = Math.max(1, Math.round(d.source.duration * rate));
    const ix = i => Math.min(own - 1, Math.floor((i + 0.5) / rate * c.rate));
    const pow = Float64Array.from({ length: n }, (_, i) => { const v = c.lufs[ix(i)]; return v == null ? 0 : Math.pow(10, v / 10); });
    const loud = Float64Array.from({ length: n }, (_, i) => { const v = c.loudness ? c.loudness[ix(i)] : c.lufs[ix(i)] == null ? 0 : (c.lufs[ix(i)] + 60) / 60; return v || 0; });
    const harsh = c.harshness ? Float64Array.from({ length: n }, (_, i) => c.harshness[ix(i)] || 0) : null;
    let spec = null;
    if (B) {
      const P = specPower(d.spectrum), cols = d.spectrum.columns, dur = d.source.duration;
      spec = new Float64Array(n * B);
      for (let i = 0; i < n; i++) { const j = Math.min(cols - 1, Math.floor((i + 0.5) / rate / dur * cols)); for (let b = 0; b < B; b++) spec[i * B + b] = P[j * B + b]; }
    }
    // a trimmed part: silent outside start..end; where its first heard moment has sound, that is an onset
    const t0 = p.start > 0 ? p.start : 0, t1 = p.end > t0 ? p.end : Infinity, trimmed = t0 > 0 || t1 < Infinity;
    if (trimmed) for (let i = 0; i < n; i++) { const t = (i + 0.5) / rate; if (t < t0 || t >= t1) { pow[i] = 0; loud[i] = 0; if (harsh) harsh[i] = 0; if (spec) spec.fill(0, i * B, i * B + B); } }
    const s = trimmed ? Math.max(t0, (d.summary && d.summary.soundStart) || 0) : d.summary && d.summary.soundStart;
    const on = (d.onsets || []).filter(t => t >= t0 && t < t1);
    if (s != null && !(on.length && on[0] - s < 0.05) && (!trimmed || pow[Math.min(n - 1, Math.floor(s * rate))] > 0)) on.unshift(s);       // a part that starts with sound starts with an onset
    return { doc: d, n, pow, loud, harsh, spec, onsets: on, offset: p.offset || 0, gain: p.gain || 0, lock: !!p.lock };
  });
  return { ps: prepared, rate, B, low: bandOf(120) };
}
// measures for offsets (seconds) and gains (dB), one per part
function measureAt(P, offs, gains) {
  const { ps, rate, B } = P, K = ps.length;
  const o = offs.map(v => Math.round(v * rate)), g = gains.map(v => Math.pow(10, v / 10));
  const C = Math.max(...ps.map((p, k) => o[k] + p.n));
  const tot = new Float64Array(C);
  for (let k = 0; k < K; k++) { const p = ps[k]; for (let i = 0; i < p.n; i++) { const c = o[k] + i; if (c >= 0) tot[c] += p.pow[i] * g[k]; } }
  const L = Float64Array.from(tot, v => (v > 0 ? 10 * Math.log10(v) : -100));
  let cp = 0; for (let c = 1; c < C; c++) if (L[c] > L[cp]) cp = c;
  const at = w => Math.max(1, Math.round(w * rate));
  let cr = cp; while (cr > 0 && L[cr - 1] > L[cp] - 20) cr--;
  const rise = (cp - cr + 1) / rate;
  let bs = 0, bk = 0; for (let c = cp - at(0.25); c <= cp - at(0.06); c++) { bs += c >= 0 ? Math.max(-60, L[c]) : -60; bk++; }
  const contrast = Math.min(60, L[cp] - bs / Math.max(1, bk));
  let fs = 0, fk = 0; for (let c = cp + at(0.15); c <= cp + at(0.4); c++) { fs += c < C ? Math.max(-70, L[c]) : -70; fk++; }
  const focus = Math.min(60, L[cp] - fs / fk);
  let ce = C; for (let c = cp + 1; c < C; c++) if (L[c] < L[cp] - 30) { ce = c; break; }
  const tail = (ce - cp) / rate;
  // overlap: the parts with at least 3 % of the whole's energy in the main hit (50 ms before the peak to 100 ms after)
  const t0 = cp / rate, starts = [];
  const wa = Math.max(0, cp - at(0.05)), wb = Math.min(C, cp + at(0.1) + 1);
  let wt = 0; for (let c = wa; c < wb; c++) wt += tot[c];
  let inside = 0;
  for (let k = 0; k < K; k++) {
    let e = 0; for (let c = wa; c < wb; c++) { const i = c - o[k]; if (i >= 0 && i < ps[k].n) e += ps[k].pow[i] * g[k]; }
    if (!(wt > 0 && e >= 0.03 * wt)) continue;
    inside++;
    // together: the same parts, by their onset nearest the peak (from 80 ms before it to 100 ms after, so a part that
    // comes in late counts against it rather than being left out)
    let best = null; for (const t of ps[k].onsets) { const a = t + o[k] / rate; if (a <= t0 + 0.1 && a >= t0 - 0.08) best = best == null || Math.abs(a - t0) < Math.abs(best - t0) ? a : best; }
    if (best != null) starts.push(best);
  }
  const overlap = inside / K;
  let together = 1;
  if (starts.length > 1) { const s = starts.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)]; together = s.filter(v => Math.abs(v - med) <= 0.008).length / s.length; }
  // the spectrum around the peak and the shared cells over the whole
  let coverage = null, low = null, shared = null;
  if (B) {
    const E = new Float64Array(B), w1 = Math.min(C, cp + at(0.3));
    let top = 0;
    const cell = new Float64Array(K);
    let all = 0, sh = 0;
    for (let c = 0; c < C; c++) for (let b = 0; b < B; b++) {
      let s = 0, p1 = 0, p2 = 0;
      for (let k = 0; k < K; k++) { const i = c - o[k]; const v = i >= 0 && i < ps[k].n ? ps[k].spec[i * B + b] * g[k] : 0; cell[k] = v; s += v; if (v > p1) { p2 = p1; p1 = v; } else if (v > p2) p2 = v; }
      if (c >= cp && c < w1) E[b] += s;
      if (s > top) top = s;
      if (s > 0) { all += s; if (p2 > 0 && p1 / p2 <= 3.981) sh += s; }
    }
    void top;
    let mx = 0, sum = 0; for (let b = 0; b < B; b++) { mx = Math.max(mx, E[b]); sum += E[b]; }
    coverage = mx > 0 ? E.filter(v => v >= mx * 1e-3).length / B : 0;
    let lw = 0; for (let b = 0; b <= P.low; b++) lw += E[b];
    low = sum > 0 ? lw / sum : 0;
    shared = all > 0 ? sh / all : 0;
  }
  // harshness of the whole: its loudness plus the parts' weighted excess (as in combine), over the sounding columns
  let hs = 0, hn = 0;
  if (ps.every(p => p.harsh)) for (let c = 0; c < C; c++) {
    if (L[c] < L[cp] - 40) continue;
    let ex = 0, w = 0;
    for (let k = 0; k < K; k++) { const i = c - o[k]; if (i < 0 || i >= ps[k].n || !ps[k].pow[i]) continue; const q = ps[k].pow[i] * g[k]; ex += q * (ps[k].harsh[i] - ps[k].loud[i]); w += q; }
    hs += clip01(clip01((L[c] + 60) / 60) + (w ? ex / w : 0)); hn++;
  }
  return { peakLufs: rnd(L[cp], 2), peakTime: rnd(t0, 3), rise: rnd(rise, 3), contrast: rnd(contrast, 2), focus: rnd(focus, 2), together: rnd(together, 3), overlap: rnd(overlap, 3), coverage: coverage == null ? null : rnd(coverage, 3),
    low: low == null ? null : rnd(low, 3), tail: rnd(tail, 3), shared: shared == null ? null : rnd(shared, 3), harshness: hn ? rnd(hs / hn, 3) : null };
}
function goalOf(goal) {
  const w = typeof goal === "object" && goal ? goal : GOALS[goal || "punch"];
  if (!w) throw new Error("Playhead: unknown goal " + goal + " (" + Object.keys(GOALS).join(", ") + ", or weights)");
  return w;
}
function scoreOf(m, w, maxHarsh, gainChange) {
  const s = partScores(m); let v = 0, n = 0;
  for (const k in w) { v += w[k] * (s[k] || 0); n += Math.abs(w[k]); }
  v = n ? v / n : 0;
  if (m.harshness != null && m.harshness > maxHarsh) v -= 2 * (m.harshness - maxHarsh);
  return v - 0.004 * (gainChange || 0);
}
function measureParts(parts, opts) {
  opts = opts || {};
  const P = prepareParts(parts), m = measureAt(P, P.ps.map(p => p.offset), P.ps.map(p => p.gain));
  m.scores = Object.fromEntries(Object.entries(partScores(m)).map(([k, v]) => [k, rnd(v, 3)]));
  m.score = rnd(scoreOf(m, goalOf(opts.goal), opts.maxHarshness == null ? 0.9 : opts.maxHarshness), 3);
  return m;
}
function arrange(parts, opts) {
  opts = opts || {};
  const t0 = Date.now(), P = prepareParts(parts), K = P.ps.length, w = goalOf(opts.goal), maxH = opts.maxHarshness == null ? 0.9 : opts.maxHarshness;
  const range = opts.range == null ? 0.25 : opts.range, gr = opts.gainRange || [-6, 3], step = 1 / P.rate;
  const minO = opts.minOffset == null ? 0 : opts.minOffset, maxO = opts.maxOffset == null ? Infinity : opts.maxOffset;
  let locked = P.ps.map(p => p.lock);
  if (!locked.some(Boolean)) { let best = 0; P.ps.forEach((p, k) => { if (Math.max(...p.pow) * Math.pow(10, p.gain / 10) > Math.max(...P.ps[best].pow) * Math.pow(10, P.ps[best].gain / 10)) best = k; }); locked = locked.map((_, k) => k === best); }
  const free = P.ps.map((_, k) => k).filter(k => !locked[k]);
  const base = { offs: P.ps.map(p => p.offset), gains: P.ps.map(p => p.gain) };
  const lim = k => [Math.max(minO, base.offs[k] - range), Math.min(maxO, base.offs[k] + range)];
  const glim = k => [base.gains[k] + gr[0], base.gains[k] + gr[1]];
  const snapO = v => Math.round(v / step) * step;
  let seed = (opts.seed == null ? 12345 : opts.seed) >>> 0;
  const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let evaluated = 0;
  const evalState = st => { evaluated++; const m = measureAt(P, st.offs, st.gains); return { st, m, score: scoreOf(m, w, maxH, st.gains.reduce((a, v, k) => a + Math.abs(v - base.gains[k]), 0)) }; };
  const baseline = evalState(base), pool = [];
  const consider = r => { if (r.score > baseline.score + 1e-4) pool.push(r); };
  const restarts = opts.restarts || 8, steps = opts.steps || 60;
  for (let r = 0; r < restarts && free.length; r++) {
    let curS = { offs: base.offs.slice(), gains: base.gains.slice() };
    if (r > 0) for (const k of free) { const [a, b] = lim(k), [ga, gb] = glim(k); curS.offs[k] = snapO(a + rand() * (b - a)); curS.gains[k] = Math.round((ga + rand() * (gb - ga)) * 2) / 2; }
    let cur = evalState(curS); consider(cur);
    for (let s = 0; s < steps; s++) {
      const k = free[Math.floor(rand() * free.length)], nx = { offs: cur.st.offs.slice(), gains: cur.st.gains.slice() }, big = s < steps / 2;
      if (rand() < 0.6) { const [a, b] = lim(k); nx.offs[k] = Math.max(a, Math.min(b, snapO(nx.offs[k] + (rand() * 2 - 1) * (big ? 0.08 : 0.025)))); }
      else { const [ga, gb] = glim(k); nx.gains[k] = Math.max(ga, Math.min(gb, Math.round((nx.gains[k] + (rand() * 2 - 1) * (big ? 3 : 1)) * 2) / 2)); }
      const r2 = evalState(nx);
      if (r2.score > cur.score) { cur = r2; consider(cur); }
    }
  }
  // the best, kept apart: each candidate differs from the ones before by 15 ms or 1.5 dB in some part
  pool.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const r of pool) {
    if (picked.length >= (opts.count || 6)) break;
    if (picked.some(q => r.st.offs.every((v, k) => Math.abs(v - q.st.offs[k]) < 0.015) && r.st.gains.every((v, k) => Math.abs(v - q.st.gains[k]) < 1.5))) continue;
    picked.push(r);
  }
  const out = r => ({
    parts: r.st.offs.map((v, k) => ({ offset: rnd(v, 4), gain: rnd(r.st.gains[k], 2) })), score: rnd(r.score, 3), measures: r.m,
    changes: r.st.offs.map((v, k) => ({ part: k, offset: rnd(v - base.offs[k], 4), gain: rnd(r.st.gains[k] - base.gains[k], 2) })).filter(c => Math.abs(c.offset) > 1e-4 || Math.abs(c.gain) > 0.01)
  });
  return { goal: opts.goal || "punch", weights: w, locked: locked.map((v, k) => (v ? k : -1)).filter(k => k >= 0), baseline: { score: rnd(baseline.score, 3), measures: baseline.m }, candidates: picked.map(out), evaluated, ms: Date.now() - t0 };
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

/* ---------------- frames: curves per video frame, for engines and visuals ---------------- */
// The curves sampled once per frame, for a game engine, a VJ or 3D tool or a video editor:
//   { fps, frames, duration, scale, curves: { name: [value per frame] }, onsets, beats, downbeats: [frame], events:
//     [{ frame, end, word }] }
// A frame's value is the curve's mean over that frame, so nothing is lost or aliased at any frame rate. scale "fixed"
// (default) maps every curve to 0..1 as the strip draws it: LUFS from -60 to 0, the descriptor curves n1-n8 on their
// 5th to 95th percentile in the file, structureNovelty and localPulse from 0 to their 99th percentile, the others as
// they are; "file" maps every curve from its 5th to its 95th percentile in the file (the whole range used, as a VJ tool's
// gain would; levels are no longer comparable between files); "raw" keeps the values. Silence is 0 (LUFS -60 when raw).
// opts: fps (default 60), curves (names; default all), scale.
function frames(doc, opts) {
  opts = opts || {};
  const fps = opts.fps > 0 ? opts.fps : 60, c = (doc && doc.curves) || {}, dur = doc.source.duration, n = Math.max(1, Math.ceil(dur * fps - 1e-9));
  const scale = opts.scale === "raw" || opts.scale === "file" ? opts.scale : "fixed";
  const names = (opts.curves && opts.curves.length ? opts.curves : Object.keys(c)).filter(k => Array.isArray(c[k]) && k !== "scale");
  const out = { fps, frames: n, duration: dur, scale, curves: {} };
  for (const k of names) {
    const arr = c[k], empty = scale === "raw" && k === "lufs" ? -60 : 0;
    let [lo, hi] = k === "lufs" ? [-60, 0] : autoRange(k, arr);
    if (scale === "file") {
      const v = arr.filter(x => x != null).sort((a, b) => a - b);
      if (v.length) { lo = v[Math.floor(0.05 * (v.length - 1))]; hi = v[Math.floor(0.95 * (v.length - 1))]; if (hi - lo < 1e-9) hi = lo + 1e-9; }
    }
    out.curves[k] = Array.from({ length: n }, (_, i) => {
      const v = curveValue(arr, c.rate, i / fps, (i + 1) / fps);
      if (v == null) return empty;
      return scale === "raw" ? rnd(v, 4) : rnd(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 4);
    });
  }
  const at = list => Array.from(new Set((list || []).map(t => Math.floor(t * fps + 1e-9)).filter(f => f >= 0 && f < n)));
  out.onsets = at(doc.onsets);
  out.beats = at(doc.rhythm && doc.rhythm.beats);
  out.downbeats = at(doc.rhythm && doc.rhythm.downbeats);
  out.events = (doc.events || []).map(e => ({ frame: Math.floor(e.start * fps + 1e-9), end: Math.floor((e.decayEnd || e.end || e.start) * fps + 1e-9), word: e.word || "" }));
  return out;
}

/* ---------------- strip renderer: layers and looks ---------------- */
// A strip is a list of layers drawn on one time axis, earlier layers behind later ones:
//   { type: "wave", colour }          the waveform; colour names a 0..1 curve that tints each column along the theme's
//                                      ramp (waveRamp, or waveLow -> waveHigh), or null for the plain waveform. Over a spectrogram
//                                      it is drawn as an outline
//   { type: "spec" }                  a mel spectrogram (40 bands, 40 Hz to 16 kHz), low frequencies at the bottom
//   { type: "spec", of, cyclic, curve } a view in the spectrogram's place (see views below): of "tempo" ("spec:tempo",
//                                      "spec:tempo~cyclic"), "lag" ("spec:lag"), "mod" ("spec:mod") or "scale"
//                                      ("scalogram:onsetStrength")
//   { type: "raster", curve, bars }   the bar raster: a row per bar ("raster:onsetStrength") or per 4 bars ("~4bars"),
//                                      taking the whole strip; sections and ticks are drawn on it, other layers are not
//   { type: "line", curve, range }    a curve drawn over the waveform; range [lo, hi] maps to the strip height
//                                      (default [0, 1]; the 5th-95th percentile for the descriptor curves n1-n8)
//   { type: "lane", curve, signed }   a curve in its own lane under the waveform. signed: for change curves such as
//                                      structureNovelty; drawn up where the level rises across the change (an entry),
//                                      down where it falls (a fall in level, a break into silence) and centred where the level
//                                      stays and only the material changes, so a break never reads as "more"
//   { type: "sections" }              boundaries and letters (music profile; a letter repeats when material returns)
//   { type: "ticks", of: [...] }      marks under the waveform: "events", "onsets", "beats", "downbeats", and from the
//                                      top edge "novelty" (the strongest spectral surprises: new sounds, drops, entries)
//   { type: "outline" }               the waveform's outline (min and max), over everything drawn before it
//   { type: "sculpt", curve }         reshapes the waveform layer: its envelope follows the curve while its fine
//                                      structure stays, e.g. "sculpt:loudness" for a waveform as loud as it sounds (the
//                                      outline layer keeps the ordinary peaks, for comparison)
//   { type: "form", value }           how lanes are arranged: "lanes" (each in its own band under the waveform, the
//                                      default) or "overlay" (all of them over the waveform, in one band)
//   { type: "shape", value }          how a lane's curve is drawn: "base" (filled from the bottom, the default),
//                                      "mirror" (symmetric around the middle, like a waveform), "horizon" (folded into
//                                      three bands of rising strength, compact at small heights) or "line"
// Without a waveform or spectrogram the lanes use the whole strip, so curves can stand in for the waveform.
// A look is a named list of layers (LOOKS). A look code is the same list as short text, for menus, saved settings
// and feedback: "wave:harshness,line:activity,ticks:events" or "shape:mirror,form:overlay,wave,lane:activity".
const DEFAULT_THEME = {
  background: null, wave: "#9aa5ac", waveLow: [214, 226, 240], waveHigh: [24, 79, 149], line: "#eb6834", tick: "#13181b", text: "#13181b", rule: "#4e5960",
  lane: null, laneDown: null, laneFlat: null,     // lanes: rises (default: line), drops (default: rule), level-neutral changes (default: wave)
  series: null,                                   // colours of the 2nd and 3rd lane (default below)
  outline: null,                                  // the outline layer (default: wave)
  waveRamp: null,                                 // the tint as several stops, low -> high (default: waveLow -> waveHigh)
  halo: null,                                     // outline behind letters, for reading them over a spectrogram (none by default)
  grid: null,                                     // beat grid, section rules and letters on the bar raster (default: white)
  specRamp: [[0, 0, 4], [66, 10, 104], [147, 38, 103], [221, 81, 58], [252, 165, 10], [252, 255, 164]]   // spectrogram, quiet -> loud
};
const SERIES = ["#2f9378", "#7e60c4"];
const CURVE_LABELS = {
  loudness: "loudness", activity: "activity", arousal: "arousal", harshness: "harshness", tension: "tension", harmonicTension: "harmonic tension",
  surprise: "novelty (spectral surprise)", lufs: "loudness (LUFS)", structureNovelty: "structural change", localPulse: "local pulse", onsetStrength: "onset strength (hits)",
  n1Kurtosis: "impulsiveness", n2RepetitionHz: "repetition rate", n4Velocity: "spectral motion", n5Cpp: "periodicity", n5Coherence: "phase coherence",
  n6Arrow: "time arrow", n7Surprisal: "surprisal", n8Recurrence: "recurrence", timbreHarshness: "timbre harshness",
  onsetLow: "low onsets (kick)", onsetMid: "mid onsets (snare)", onsetHigh: "high onsets (hats)", pulseClarity: "pulse clarity"
};
const TICK_KINDS = ["events", "onsets", "beats", "downbeats", "novelty"], FORMS = ["lanes", "overlay"], SHAPES = ["base", "mirror", "horizon", "line"];
const LOOKS = {
  auto: { name: "Automatic", desc: "Sound effects: harshness as colour, activity as the line, events. Music: activity as colour, tension as the line, sections, downbeats.", code: null },
  plain: { name: "Waveform only", desc: "The waveform without analysis, for comparison.", code: "wave" },
  spectrum: { name: "Spectrogram", desc: "A standard spectrogram (mel scale, 40 Hz to 16 kHz), for comparison.", code: "spec" },
  structure: { name: "Structure", desc: "Sections, structural change (up: entry, down: fall or break) and the local pulse under a plain waveform.", code: "wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats" },
  rhythm: { name: "Rhythm", desc: "Activity as colour, the local pulse, beats and downbeats.", code: "wave:activity,lane:localPulse,ticks:beats+downbeats" },
  tension: { name: "Tension", desc: "Harshness as colour, tension as the line, sections.", code: "wave:harshness,sections,line:tension,ticks:downbeats" },
  events: { name: "Events", desc: "Harshness as colour, activity in a lane, events marked.", code: "wave:harshness,lane:activity,ticks:events" },
  lanes: { name: "Separate lanes", desc: "Plain waveform with loudness, activity and harshness each in its own lane (no colour mixing).", code: "wave,lane:loudness,lane:activity,lane:harshness" },
  shapes: { name: "Curves as waveforms", desc: "No waveform: loudness, activity and harshness each drawn like a waveform, mirrored around its middle.", code: "shape:mirror,lane:loudness,lane:activity,lane:harshness" },
  overlay: { name: "Curves over the waveform", desc: "Activity and harshness drawn like waveforms on top of the waveform itself, to compare their shapes directly.", code: "form:overlay,shape:mirror,wave,lane:activity,lane:harshness" },
  horizon: { name: "Horizon lanes", desc: "Loudness, activity and harshness as horizon charts: compact lanes that keep detail at small heights.", code: "shape:horizon,wave,lane:loudness,lane:activity,lane:harshness" },
  specstructure: { name: "Spectrogram and structure", desc: "The spectrogram with sections, structural change and downbeats.", code: "spec,sections,lane:structureNovelty~signed,ticks:downbeats" },
  overview: { name: "Music overview", desc: "Curves only, overlaid and mirrored like a waveform: local pulse, activity and recurrence, with sections, bar lines and novelty marks.", code: "form:overlay,shape:mirror,sections,lane:localPulse,lane:activity,lane:n8Recurrence,ticks:downbeats+novelty" },
  character: { name: "Sound character", desc: "For sound effects. Curves only, overlaid and mirrored like a waveform: where the hits are (onset strength), harshness and impulsiveness (clicks, cracks, crackle), with onsets marked.", code: "form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n1Kurtosis,ticks:onsets" },
  surprise: { name: "Hits and surprise", desc: "For sound effects. As Sound character, with spectral surprise (where the sound turns into something new) in place of impulsiveness.", code: "form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n7Surprisal,ticks:onsets" },
  hits: { name: "Hits and pulse", desc: "The waveform with onset strength (where the hits are) and the local pulse as lanes, beats and bar lines.", code: "wave,lane:onsetStrength,lane:localPulse,ticks:beats+downbeats" },
  raster: { name: "Bar raster", desc: "For music. A row per bar, top to bottom, like a drum pattern: onset strength through each bar, with sections. Bars that hit the same way line up in columns; fills, breaks and drops show as rows that differ.", code: "raster:onsetStrength,sections" },
  tempogram: { name: "Tempogram", desc: "For music. How strongly each tempo (30 to 590 BPM, fast at the top) is present over time. A steady beat is a bright line, a tempo change bends it, double and half tempo show as fainter lines. With bar lines.", code: "spec:tempo,ticks:downbeats" },
  repetition: { name: "Repetition (lag view)", desc: "For music. How alike each moment is to the moment a given time before (that time, the lag, going up). A bright horizontal line means the music repeats what played that long ago. With sections.", code: "spec:lag,sections" },
  modulation: { name: "Modulation spectrogram", desc: "For any sound. How fast its level pulses, and how strongly, over time: rhythm below about 4 Hz, fluctuation, tremolo and flutter from 4 to 20 Hz, roughness above (fast at the top). Engines, rotors, tremolo, growls and buzzes show as bright rows at their rate; steady tones and plain noise stay dark.", code: "spec:mod" },
  rhythms: { name: "Curve rhythms (scalogram)", desc: "Research view, for any sound. The periodic patterns in onset strength, from fast (top) to slow (bottom): beat, bar and phrase in music, flutter and tremolo in effects. Fainter near the ends, where the sound is too short to be sure of a period.", code: "scalogram:onsetStrength" },
  sculpted: { name: "Waveform as loud as it sounds", desc: "The waveform's envelope follows perceived loudness (a dB-like scale) while its detail stays; colour shows harshness, with the ordinary peak outline for comparison.", code: "sculpt:loudness,wave:harshness,outline,ticks:events+novelty" }
};

/* ---------------- labels in other languages ---------------- */
// An app passes its translation table to localize(); keys: lib.curve.<name>, lib.look.<id>.name and .desc,
// lib.tool.<id>.name, .desc, .param.<param>, .opt.<param>.<value>, lib.legend.<phrase>, lib.mark.<kind>.
// localize(null) restores English. Analysis documents never change: only labels do. Counts take the language's plural
// forms (key.one, .few, .many, .other, as Intl.PluralRules names them); the language comes from localize(table, lang) or
// from the table's "lib.lang" (the tables in dist/i18n carry it).
let LT = null, LT_LANG = "en";
const EN_LABELS = { curves: Object.assign({}, CURVE_LABELS), looks: Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, { name: v.name, desc: v.desc }])) };
function L(key, en, vars) {
  let s = LT && Object.prototype.hasOwnProperty.call(LT, key) ? LT[key] : en;
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}
function LP(key, n, one, other, vars) {
  let c = n === 1 ? "one" : "other";
  if (LT) { try { c = new Intl.PluralRules(LT_LANG).select(n); } catch (e) { /* no Intl: English rule */ } }
  const k = LT && Object.prototype.hasOwnProperty.call(LT, key + "." + c) ? key + "." + c : key + ".other";
  return L(k, n === 1 ? one : other, Object.assign({ n }, vars || {}));
}
function localize(table, lang) {
  LT = table || null;
  LT_LANG = lang || (LT && LT["lib.lang"]) || "en";
  for (const k in EN_LABELS.curves) CURVE_LABELS[k] = L("lib.curve." + k, EN_LABELS.curves[k]);
  for (const k in EN_LABELS.looks) { LOOKS[k].name = L("lib.look." + k + ".name", EN_LABELS.looks[k].name); LOOKS[k].desc = L("lib.look." + k + ".desc", EN_LABELS.looks[k].desc); }
  return !!LT;
}
const isSfxDoc = doc => doc.profile === "sfx" || doc.assetClass === "sfx";
// the layers the renderer drew before looks existed; still the default, and still driven by the old options
function legacyLayers(doc, opts) {
  const sfx = isSfxDoc(doc);
  const L = [{ type: "wave", colour: opts.colour === undefined ? (sfx ? "harshness" : "activity") : opts.colour }];
  if (opts.sections !== false) L.push({ type: "sections" });
  L.push({ type: "line", curve: opts.curve || (sfx ? "activity" : "tension"), range: opts.lineRange });
  const of = []; if (opts.beats !== false) of.push("downbeats"); if (opts.events !== false) of.push("events");
  L.push({ type: "ticks", of, small: true });
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
    else if (type === "outline") out.push({ type });
    else if (type === "spec") { if (!arg || arg === "mel") out.push({ type }); else if (arg === "tempo") {
        const src = (flags.find(f => f.startsWith("of:")) || "").slice(3), w = (flags.find(f => f.startsWith("w:")) || "").slice(2), l = { type, of: "tempo", cyclic: flags.includes("cyclic") };
        if (src && src !== "onsets") l.source = src;
        if (w) l.weight = w;
        out.push(l);
      } else if (arg === "lag" || arg === "mod") out.push({ type, of: arg }); }
    else if (type === "scalogram") out.push({ type: "spec", of: "scale", curve: arg || "onsetStrength" });
    else if (type === "raster") out.push({ type, curve: arg || "onsetStrength", bars: flags.includes("4bars") ? 4 : 1 });
    else if (type === "sculpt" && arg) out.push({ type, curve: arg });
    else if (type === "line" && arg) out.push({ type, curve: arg });
    else if (type === "lane" && arg) out.push({ type, curve: arg, signed: flags.includes("signed") });
    else if (type === "sections") out.push({ type });
    else if (type === "ticks") { const of = arg.split("+").filter(k => TICK_KINDS.includes(k)); if (of.length) out.push({ type, of }); }
    else if (type === "form" && FORMS.includes(arg)) out.push({ type, value: arg });
    else if (type === "shape" && SHAPES.includes(arg)) out.push({ type, value: arg });
  }
  return out;
}
/** Layers -> look code. */
function lookCode(layers) {
  return (layers || []).map(l => l.type === "wave" ? "wave" + (l.colour ? ":" + l.colour : "") : l.type === "line" ? "line:" + l.curve
    : l.type === "spec" ? (l.of === "tempo" ? "spec:tempo" + (l.cyclic ? "~cyclic" : "") + (l.source ? "~of:" + l.source : "") + (l.weight ? "~w:" + l.weight : "") : l.of === "lag" || l.of === "mod" ? "spec:" + l.of : l.of === "scale" ? "scalogram:" + l.curve : "spec")
    : l.type === "raster" ? "raster:" + l.curve + (l.bars === 4 ? "~4bars" : "")
    : l.type === "lane" ? "lane:" + l.curve + (l.signed ? "~signed" : "") : l.type === "ticks" ? (l.of && l.of.length ? "ticks:" + l.of.join("+") : "")
    : l.type === "form" || l.type === "shape" ? l.type + ":" + l.value : l.type === "sculpt" ? "sculpt:" + l.curve : l.type).filter(Boolean).join(",");
}
const optionOf = (layers, type, dflt) => { const l = (layers || []).find(x => x.type === type); return l ? l.value : dflt; };
/** Plain-language description of layers, for a legend beside the strip. */
function describeLook(layers, doc) {
  const lab = k => CURVE_LABELS[k] || k, has = k => !doc || (doc.curves && Array.isArray(doc.curves[k]));
  const mark = r => r === "downbeats" ? L("lib.mark.downbeats", "bar lines") : L("lib.mark." + r, r);
  const parts = [], form = optionOf(layers, "form", "lanes"), shape = optionOf(layers, "shape", "base");
  const lanes = (layers || []).filter(l => l.type === "lane"), absent = L("lib.legend.absent", " (not in this analysis)");
  for (const l of layers || []) {
    if (l.type === "wave") parts.push(l.colour && has(l.colour) ? L("lib.legend.colour", "colour: {curve}", { curve: lab(l.colour) }) : L("lib.legend.waveform", "waveform"));
    else if (l.type === "spec" && !l.of) parts.push(!doc || doc.spectrum ? L("lib.legend.spectrogram", "spectrogram (mel, low at the bottom)") : L("lib.legend.spectrogramAbsent", "spectrogram (not in this analysis)"));
    else if (l.type === "spec" && l.of === "tempo") parts.push((l.cyclic ? L("lib.legend.tempogramCyclic", "tempogram, octaves folded (80 to 160 BPM; a tempo, its half and its double share a row)") : L("lib.legend.tempogram", "tempogram ({lo} to {hi} BPM, fast at the top)", { lo: tempoRange(doc, l)[0], hi: tempoRange(doc, l)[1] }))
      + (l.source === "speed" ? L("lib.legend.tempoSpeed", " of how fast the descriptors change together") : l.source ? L("lib.legend.tempoOf", " of the rises in {curve}", { curve: CURVE_LABELS[l.source] || l.source }) : "")
      + (l.weight ? L("lib.legend.tempoWeight", ", grey where {curve} is low", { curve: CURVE_LABELS[l.weight] || l.weight }) : "")
      + (!doc || l.source || (doc.rhythm && doc.rhythm.tempogram) ? "" : L("lib.legend.musicAbsent", " (music only; not in this analysis)")));
    else if (l.type === "spec" && l.of === "lag") parts.push(L("lib.legend.lag", "repetition: bright where the music repeats what played a lag earlier (lag going up)") + (!doc || doc.repetition ? "" : L("lib.legend.musicAbsent", " (music only; not in this analysis)")));
    else if (l.type === "spec" && l.of === "mod") parts.push(L("lib.legend.modulation", "modulation: how fast the level pulses (0.5 to 128 Hz, fast at the top): rhythm, then flutter and tremolo, then roughness") + (!doc || doc.modulation ? "" : absent));
    else if (l.type === "spec" && l.of === "scale") parts.push(L("lib.legend.scalogram", "rhythms in {curve}: fast at the top, slow at the bottom", { curve: lab(l.curve) }) + (has(l.curve) ? "" : absent));
    else if (l.type === "raster") parts.push((l.bars === 4 ? L("lib.legend.raster4", "phrase raster: {curve}, a row per 4 bars, top to bottom", { curve: lab(l.curve) }) : L("lib.legend.raster", "bar raster: {curve}, a row per bar, top to bottom", { curve: lab(l.curve) })) + (!doc || barRows(doc, 1) ? (has(l.curve) ? "" : absent) : L("lib.legend.needsBeat", " (needs a beat: music only)")));
    else if (l.type === "outline") parts.push(L("lib.legend.outline", "outline: peak waveform"));
    else if (l.type === "sculpt") parts.push(L("lib.legend.height", "height: {curve}", { curve: lab(l.curve) }) + (!(layers || []).some(x => x.type === "wave") ? L("lib.legend.heightNoWave", " (shapes the waveform; add it to see)") : has(l.curve) ? "" : absent));
    else if (l.type === "line" && has(l.curve)) parts.push(L("lib.legend.line", "line: {curve}", { curve: lab(l.curve) }));
    else if (l.type === "lane") parts.push((form === "overlay" ? ((layers || []).some(x => x.type === "wave" || x.type === "spec") ? L("lib.legend.overWave", "over the waveform: {curve}", { curve: lab(l.curve) }) : L("lib.legend.overlaid", "overlaid: {curve}", { curve: lab(l.curve) })) : L("lib.legend.lane", "lane: {curve}", { curve: lab(l.curve) })) + (has(l.curve) ? (l.signed ? L("lib.legend.signed", " (up: entry, down: fall or break, centred: same level)") : "") : absent));
    else if (l.type === "sections" && (!doc || doc.sections)) parts.push(L("lib.legend.sections", "letters: sections"));
    else if (l.type === "ticks" && l.of) {
      const rh = r => r === "beats" || r === "downbeats";
      const ok = r => !doc || (r === "events" ? !!doc.events : r === "onsets" ? !!doc.onsets : r === "novelty" ? !!(doc.noveltyTicks && doc.noveltyTicks.length) : !!doc.rhythm);
      const of = l.of.filter(ok).map(mark);
      if (of.length) parts.push(L("lib.legend.marks", "marks: {list}", { list: of.join(", ") }) + (doc && doc.rhythm && !doc.rhythm.reliable && l.of.some(rh) ? L("lib.legend.beatsFaint", " (no steady beat: beats faint)") : ""));
      const missing = l.of.filter(r => !ok(r));
      if (missing.length) parts.push(L("lib.legend.missing", "{list}: not in this analysis", { list: missing.map(mark).join(", ") }) + (missing.some(rh) ? L("lib.legend.musicOnly", " (music only)") : ""));
    }
  }
  if (lanes.length && shape !== "base") parts.push(shape === "mirror" ? L("lib.legend.mirror", "curves mirrored like a waveform") : shape === "horizon" ? L("lib.legend.horizon", "horizon charts (darker = higher)") : L("lib.legend.lines", "curves as lines"));
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
/** Whether a look shows something for this document: every curve it uses is there and not empty, and a spectrogram
 *  layer has data. For menus that hide looks a file cannot use (structure needs music, for example). */
function lookFits(doc, look) {
  const layers = parseLook(look) || legacyLayers(doc, {}), curves = doc && doc.curves || {};
  const live = k => Array.isArray(curves[k]) && curves[k].some(v => v != null && v !== 0);
  for (const l of layers) {
    if ((l.type === "lane" || l.type === "line" || l.type === "sculpt") && !live(l.curve)) return false;
    if (l.type === "wave" && l.colour && !live(l.colour)) return false;
    if (l.type === "spec" && !l.of && !doc.spectrum) return false;
    if (l.type === "spec" && l.of === "tempo" && !l.source && !(doc.rhythm && doc.rhythm.tempogram)) return false;
    if (l.type === "spec" && l.of === "tempo" && l.source && !(doc.source && doc.source.duration >= 8 && (l.source === "speed" ? SPEED_CURVES.some(live) : live(l.source)))) return false;
    if (l.type === "spec" && l.of === "lag" && !doc.repetition) return false;
    if (l.type === "spec" && l.of === "mod" && !doc.modulation) return false;
    if (l.type === "spec" && l.of === "scale" && (!live(l.curve) || curves[l.curve].length < 40)) return false;
    if (l.type === "raster" && (!live(l.curve) || !barRows(doc, 1))) return false;
  }
  return true;
}
const specCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
function specBytes(sp) {
  if (!sp || !sp.data) return null;
  if (specCache && specCache.has(sp)) return specCache.get(sp);
  const u8 = fromB64(sp.data);
  if (specCache) specCache.set(sp, u8);
  return u8;
}
const rampAt = (ramp, u) => { const x = Math.max(0, Math.min(1, u)) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i; return ramp[i].map((v, k) => Math.round(v + (ramp[i + 1][k] - v) * f)); };
// value of a curve over [ta, tb): the mean of its samples there, or linear interpolation when a sample spans more
function curveValue(arr, rate, ta, tb) {
  if (!arr || !arr.length) return null;
  const ia = ta * rate, ib = tb * rate, n = arr.length;
  if (ib - ia >= 1) { let s = 0, k = 0; for (let i = Math.max(0, Math.floor(ia)); i < Math.min(n, Math.ceil(ib)); i++) if (arr[i] != null) { s += arr[i]; k++; } return k ? s / k : null; }
  const x = Math.max(0, Math.min(n - 1, (ia + ib) / 2 - 0.5)), i = Math.floor(x), f = x - i, a = arr[i], b = arr[Math.min(n - 1, i + 1)];
  return a == null ? (f > 0.5 ? b : null) : b == null ? (f < 0.5 ? a : null) : a + (b - a) * f;
}

/* ---------------- views: images of rhythm and form ---------------- */
// Four views stand in for the waveform where rhythm and form matter more than amplitude:
//   bar raster  one row per bar (or per 4 bars), top to bottom; left to right is the position in the bar; colour is a
//               curve (onset strength by default). Bars that hit the same way line up; fills, breaks and drops stand out.
//               Needs a beat (music profile)
//   tempogram   how strongly each tempo is present over time, 30 to 590 BPM on a log scale, fast at the top. A steady
//               beat is a bright line, a tempo change bends it, double and half tempo are fainter lines. "cyclic" folds
//               the octaves onto one (80 to 160 BPM, so the common dance tempi sit mid-strip rather than on its edge), so a
//               tempo and its half and double share a row (music profile)
//   lag view    how alike each moment is to the moment a lag earlier, the lag going up. A bright horizontal line is a
//               repeat: what plays now was heard that long before (music profile)
//   modulation  how fast the level pulses, and how strongly, over time (0.5 to 128 Hz, fast at the top): rhythm,
//               then fluctuation, tremolo and flutter, then roughness. From the band envelopes at analysis (any profile
//               but fast); a level pulsing at one rate is a bright row, steady tones and plain noise stay dark
//   scalogram   the periodic patterns in any curve (Morlet wavelet, Torrence & Compo 1998, power divided by scale as
//               Liu et al. 2007 so equal swings read equally at every period), fast at the top and slow at the bottom:
//               beat, bar and phrase pulsing in music, flutter and tremolo in effects. Fainter near the ends, where a
//               period is longer than the sound around it (outside the cone of influence)
// Playhead.view(doc, kind, opts) gives the image as numbers, for hosts that draw it themselves or measure it:
//   { kind, rows, cols, values (Float32Array, row-major, row 0 at the top, 0..1, -1 where there is no data),
//     yTicks: [{ row, text }], and colAt(t) (time-based views) or rows of [start, end] seconds (the raster) }
const VIEW_KINDS = ["raster", "tempo", "lag", "scale", "mod"];
const viewCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
function cachedView(doc, key, make) {
  if (!viewCache) return make();
  let m = viewCache.get(doc); if (!m) viewCache.set(doc, m = new Map());
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}
// bar boundaries from the downbeats (or every 4th beat), gaps where the beat dropped out filled and both ends extended
// with the median bar, so every moment of the sound is in a row; per 4 bars, a row starts on the first real downbeat
function barRows(doc, per) {
  const r = doc.rhythm, dur = doc.source && doc.source.duration;
  if (!r || !dur) return null;
  const d = r.downbeats && r.downbeats.length >= 2 ? r.downbeats : r.beats && r.beats.length >= 8 ? r.beats.filter((_, i) => i % 4 === 0) : null;
  if (!d || d.length < 2) return null;
  const gaps = d.slice(1).map((t, i) => t - d[i]).sort((a, b) => a - b), bar = gaps[gaps.length >> 1];
  if (!(bar > 0.2)) return null;
  const b = [];
  for (let t = d[0] - bar; t + bar > 0.05; t -= bar) b.unshift(t);
  const first = b.length;
  for (let i = 0; i < d.length; i++) {
    b.push(d[i]);
    const next = d[i + 1];
    if (next != null && next - d[i] > 1.5 * bar) { const n = Math.round((next - d[i]) / bar); for (let k = 1; k < n; k++) b.push(d[i] + k * (next - d[i]) / n); }
  }
  for (let t = b[b.length - 1] + bar; t < dur - 0.05; t += bar) b.push(t);
  b.push(b[b.length - 1] + bar);
  const rows = [];
  // per 4 bars: rows of 4 boundaries each, the partial phrases at both ends extended with the median bar
  const at = i => i < 0 ? b[0] + i * bar : i > b.length - 1 ? b[b.length - 1] + (i - b.length + 1) * bar : b[i];
  if (per === 4) { for (let i = first % 4 ? first % 4 - 4 : 0; i < b.length - 1; i += 4) rows.push([at(i), at(i + 4)]); }
  else for (let i = 0; i < b.length - 1; i++) rows.push([b[i], b[i + 1]]);
  // beats per bar: the most common count of beats between downbeats (4 when it cannot be told)
  const counts = {};
  for (let i = 0; i + 1 < d.length; i++) { const n = (r.beats || []).filter(t => t >= d[i] - 0.02 && t < d[i + 1] - 0.02).length; if (n >= 2 && n <= 7) counts[n] = (counts[n] || 0) + 1; }
  const bpb = +(Object.entries(counts).sort((x, y) => y[1] - x[1])[0] || [4])[0];
  return { rows, bar, beatsPerBar: bpb, bars: per === 4 ? 4 : 1 };
}
function rasterView(doc, curve, per, cols) {
  const br = barRows(doc, per), arr = doc.curves && doc.curves[curve];
  if (!br || !Array.isArray(arr)) return null;
  const R = br.rows.length, rate = doc.curves.rate, dur = doc.source.duration, values = new Float32Array(R * cols), lr = autoRange(curve, arr);
  for (let r = 0; r < R; r++) {
    const [a, e] = br.rows[r], w = (e - a) / cols;
    for (let c = 0; c < cols; c++) {
      const ta = a + c * w, tb = ta + w;
      const v = tb <= 0 || ta >= dur ? null : curveValue(arr, rate, Math.max(0, ta), Math.min(dur, tb));
      values[r * cols + c] = v == null ? -1 : Math.max(0, Math.min(1, (v - lr[0]) / (lr[1] - lr[0])));
    }
  }
  const yTicks = [];
  for (let r = 0; r < R; r++) if (r % (per === 4 ? 2 : 8) === 0) yTicks.push({ row: r + 0.5, text: String(r * br.bars + 1) });
  return { kind: "raster", curve, rows: R, cols, values, yTicks, timeRows: br.rows, beatsPerBar: br.beatsPerBar, bars: br.bars };
}
// Playhead tempograms: the tempogram of another curve, and the tempogram weighted by a curve (look codes
// "spec:tempo~of:<curve>" and "spec:tempo~w:<curve>"; both together work too). A tempogram is the autocorrelation of
// whatever curve it is fed, so feeding it a descriptor's rises is a new signal with tempo values as true as the
// original's: "how periodic are the rises in harshness?". of:speed feeds it how fast all the descriptors change
// together (the length of the step of the vector of robustly normalised descriptors: a multi-descriptor novelty). The
// weight changes only how strongly a column is drawn: it is the curve's mean over the column's window, from the curve's
// 5th to 95th percentile in the file, and a weak column is drawn toward grey, not black (a value-suppressing palette),
// so "little of the curve here" stays apart from "no tempo here". Nothing moves a ridge along the tempo axis: a
// descriptor that bends or shifts tempi, or warps time before the analysis, would show tempi that are not there.
const SPEED_CURVES = ["loudness", "timbreHarshness", "tension", "activity", "n1Kurtosis", "n4Velocity", "n5Cpp", "n6Arrow"];
function curveSamples(doc, name, up) {             // a curve upsampled by linear interpolation (silence as its lowest value)
  const c = doc.curves, arr = c[name], n0 = arr.length, out = new Float64Array(n0 * up);
  let lo = Infinity; for (const v of arr) if (v != null && v < lo) lo = v;
  const at = j => { const v = arr[Math.max(0, Math.min(n0 - 1, j))]; return v == null ? (isFinite(lo) ? lo : 0) : v; };
  for (let i = 0; i < out.length; i++) { const x = (i + 0.5) / up - 0.5, j = Math.floor(x), f = x - j; out[i] = at(j) * (1 - f) + at(j + 1) * f; }
  return out;
}
function curveTempogram(doc, name) {
  const c = doc.curves || {}, live = k => Array.isArray(c[k]) && c[k].some(v => v != null);
  const names = name === "speed" ? SPEED_CURVES.filter(live) : live(name) ? [name] : [];
  if (!names.length || !(c.rate > 0) || doc.source.duration < 8) return null;
  const up = Math.max(1, Math.ceil(50 / c.rate)), rate = c.rate * up, n = c[names[0]].length * up, dt = 1 / rate;
  const sig = new Float64Array(n);
  for (const k of names) {
    const x = curveSamples(doc, k, up);
    let sc = 1;
    if (name === "speed") { const v = Array.from(x).sort((a, b) => a - b), iqr = v[Math.floor(0.75 * (v.length - 1))] - v[Math.floor(0.25 * (v.length - 1))]; sc = iqr > 1e-9 ? iqr : 1; }
    for (let i = 1; i < n; i++) { const d = (x[i] - x[i - 1]) / sc; sig[i] += name === "speed" ? d * d : Math.max(0, d); }
  }
  if (name === "speed") for (let i = 0; i < n; i++) sig[i] = Math.sqrt(sig[i]);
  // only what stands above its local mean (0.5 s), as the analysis's onset envelope: a smooth curve's slow drift would
  // otherwise correlate with itself at every short lag and light up the fastest tempi
  { const h = Math.max(1, Math.round(0.25 * rate)), cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + sig[i];
    const loc = Float64Array.from(sig, (_, i) => { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); return (cs[b] - cs[a]) / (b - a); });
    for (let i = 0; i < n; i++) sig[i] = Math.max(0, sig[i] - loc[i]); }
  // light smoothing (30 ms), as the analysis smooths its onset envelope for the tempogram
  const sg = Math.max(0.6, 0.03 / dt), K = Math.ceil(3 * sg), gk = []; let gs = 0;
  for (let k = -K; k <= K; k++) { const v = Math.exp(-0.5 * (k / sg) ** 2); gk.push(v); gs += v; }
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let k = -K; k <= K; k++) { const j = i + k; if (j >= 0 && j < n) v += gk[k + K] * sig[j]; } env[i] = v / gs; }
  // 8 s windows every 0.5 s; the autocorrelation with the mean removed, 30 to 590 BPM at 24 rows per octave
  const W = Math.min(n, Math.round(8 * rate)), hop = Math.max(1, Math.round(0.5 * rate)), NF = (() => { let p = 1; while (p < 2 * W) p <<= 1; return p; })();
  const fft = WL.getFFT(NF), win = Float64Array.from({ length: W }, (_, k) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (k + 0.5) / W));
  const bpmMin = 30, perOctave = 24, bins = Math.floor(perOctave * Math.log2(600 / bpmMin) + 1e-9) + 1;
  const cols = []; for (let ctr = 0; ctr < n; ctr += hop) cols.push(ctr);
  const C = cols.length, data = new Float32Array(C * bins), strength = new Float64Array(C), re = new Float64Array(NF), im = new Float64Array(NF);
  for (let w = 0; w < C; w++) {
    const s0 = cols[w] - (W >> 1);
    let mean = 0, cnt = 0, e = 0; for (let k = 0; k < W; k++) { const m = s0 + k; if (m >= 0 && m < n) { mean += env[m]; cnt++; e += env[m] * env[m]; } }
    mean = cnt ? mean / cnt : 0; strength[w] = cnt ? Math.sqrt(e / cnt) : 0;
    re.fill(0); im.fill(0);
    for (let k = 0; k < W; k++) { const m = s0 + k; re[k] = ((m >= 0 && m < n ? env[m] : mean) - mean) * win[k]; }
    fft(re, im); for (let k = 0; k < NF; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; } fft(re, im);
    const a0 = re[0]; if (!(a0 > 0)) continue;
    for (let b = 0; b < bins; b++) {
      const x = 60 / (bpmMin * Math.pow(2, b / perOctave) * dt), i = Math.floor(x), f = x - i;
      if (i < 1 || i + 1 >= W) continue;
      data[w * bins + b] = Math.max(0, (re[i] * (1 - f) + re[i + 1] * f) / a0);
    }
  }
  // faded where the curve hardly changes (relative to its strongest windows), as the analysis fades weak onsets
  const ref = Array.from(strength).sort((a, b) => a - b)[Math.floor(0.9 * (C - 1))] || 1;
  let pk = 1e-9;
  for (let w = 0; w < C; w++) { const fade = 1 - Math.exp(-strength[w] / (0.3 * ref)); for (let b = 0; b < bins; b++) { data[w * bins + b] *= fade; pk = Math.max(pk, data[w * bins + b]); } }
  const u8 = new Uint8Array(C * bins); for (let i = 0; i < u8.length; i++) u8[i] = Math.round(255 * Math.min(1, data[i] / pk));
  return { tg: { bpmMin, perOctave, bins, start: cols[0] * dt, hop: hop * dt, columns: C }, u8 };
}
// the fastest tempo a tempogram reaches (BPM), to the nearest 10 above 100 (240 for documents of Playhead 0.3, 590 now)
const tempoTop = tg => { const v = tg.bpmMin * Math.pow(2, (tg.bins - 1) / tg.perOctave); return v >= 100 ? Math.round(v / 10) * 10 : Math.round(v); };
// the range of the tempogram a document draws: its own, or (without one) the range the analysis gives now
function tempoRange(doc, l) {
  const tg = !l.source && doc && doc.rhythm && doc.rhythm.tempogram;
  return tg ? [tg.bpmMin, tempoTop(tg)] : [30, 590];
}
function tempoView(doc, cyclic, of, weight) {
  let tg = doc.rhythm && doc.rhythm.tempogram, u8 = tg && specBytes(tg);
  if (of && of !== "onsets") { const t = curveTempogram(doc, of); tg = t && t.tg; u8 = t && t.u8; }
  if (!u8) return null;
  const B = tg.bins, C = tg.columns, P = tg.perOctave, FOLD = 80, kf = Math.round(P * Math.log2(FOLD / tg.bpmMin));
  const rows = cyclic ? P : B, values = new Float32Array(rows * C);
  if (!cyclic) { for (let c = 0; c < C; c++) for (let k = 0; k < B; k++) values[(B - 1 - k) * C + c] = u8[c * B + k] / 255; }
  else {
    // every tempo folded onto 80 to 160 BPM: the mean over the octaves that land on a row, scaled to the image's peak
    const n = new Float32Array(P); for (let k = 0; k < B; k++) n[((k - kf) % P + P) % P]++;
    let pk = 1e-9;
    for (let c = 0; c < C; c++) for (let k = 0; k < B; k++) { const j = ((k - kf) % P + P) % P, o = (P - 1 - j) * C + c; values[o] += u8[c * B + k] / 255 / n[j]; }
    for (const v of values) if (v > pk) pk = v;
    for (let i = 0; i < values.length; i++) values[i] /= pk;
  }
  const rowOf = bpm => cyclic ? P - 1 - P * Math.log2(bpm / FOLD) : B - 1 - P * Math.log2(bpm / tg.bpmMin);
  // the tempi marked on the axis: the beat range, and the slow and fast ends where the tempogram reaches them
  const yTicks = (cyclic ? [90, 120, 140] : [60, 90, 120, 180].concat(tempoTop(tg) > 400 ? [360] : [])).map(bpm => ({ row: rowOf(bpm) + 0.5, text: String(bpm) })).filter(t => t.row > 0.5 && t.row < rows - 0.5);
  const out = { kind: "tempo", cyclic: !!cyclic, of: of && of !== "onsets" ? of : null, weight: null, rows, cols: C, values, yTicks, colAt: t => Math.max(0, Math.min(C - 1, Math.round((t - tg.start) / tg.hop))) };
  const wc = weight && doc.curves && doc.curves[weight];
  if (Array.isArray(wc) && wc.some(v => v != null)) {
    // per column, the weight curve's mean over the column's 8 s window, on its 5th to 95th percentile in the file;
    // suppress = 1 - weight, used by the strip to draw the column toward grey
    const v = wc.filter(x => x != null).sort((a, b) => a - b), lo = v[Math.floor(0.05 * (v.length - 1))], hi = Math.max(lo + 1e-9, v[Math.floor(0.95 * (v.length - 1))]);
    out.weight = weight; out.suppress = new Float32Array(C);
    for (let c = 0; c < C; c++) { const t = tg.start + c * tg.hop, m = curveValue(wc, doc.curves.rate, Math.max(0, t - 4), Math.min(doc.source.duration, t + 4)); out.suppress[c] = m == null ? 1 : 1 - Math.max(0, Math.min(1, (m - lo) / (hi - lo))); }
  }
  return out;
}
function lagView(doc) {
  const rp = doc.repetition, u8 = rp && specBytes(rp);
  if (!u8) return null;
  const R = rp.lags, C = rp.columns, values = new Float32Array(R * C);
  // similarity is a Gaussian of the distance between moments, about 0.37 at the median distance: the median of the
  // image is set to black, so that ordinary likeness recedes and repeats (near 1) stand out
  const valid = []; for (const v of u8) if (v) valid.push(v);
  valid.sort((a, b) => a - b);
  const lo = valid.length ? (valid[valid.length >> 1] - 1) / 254 : 0;
  for (let c = 0; c < C; c++) for (let l = 0; l < R; l++) { const v = u8[c * R + l]; values[(R - 1 - l) * C + c] = v ? Math.max(0, ((v - 1) / 254 - lo) / Math.max(1e-6, 1 - lo)) : -1; }
  const lagS = l => (l + 1) * rp.lagStep * rp.unitSeconds, beats = rp.unit === "beat", yTicks = [];
  if (beats) { for (const bars of [4, 8, 16, 32, 64]) { const l = bars * 4 / rp.lagStep - 1; if (l >= 0 && l < R - 1) yTicks.push({ row: R - 1 - l + 0.5, text: LP("lib.unit.bars", bars, "{n} bar", "{n} bars") }); } }
  else for (const s of [5, 10, 30, 60, 120]) { const l = s / (rp.lagStep * rp.unitSeconds) - 1; if (l >= 0 && l < R - 1) yTicks.push({ row: R - 1 - l + 0.5, text: s >= 60 ? s / 60 + " min" : s + " s" }); }
  const times = rp.times;
  const colAt = t => { let lo2 = 0, hi = C - 1; while (lo2 < hi) { const m = (lo2 + hi + 1) >> 1; if (times[m] <= t) lo2 = m; else hi = m - 1; } return lo2; };
  return { kind: "lag", rows: R, cols: C, values, yTicks, colAt, lagSeconds: lagS };
}
function modView(doc) {
  const md = doc.modulation, u8 = md && specBytes(md);
  if (!u8) return null;
  const R = md.rows, C = md.columns, values = new Float32Array(R * C);
  // depth on a square-root scale, from the image's median (black: the texture every moment has, the envelope
  // fluctuation of noise) to its 99th percentile (white): a level that pulses at one rate is a bright row
  const vals = []; for (const v of u8) if (v) vals.push(v);
  vals.sort((a, b) => a - b);
  const q = p => (vals.length ? (vals[Math.floor(p * (vals.length - 1))] - 1) / 254 : 0), lo = q(0.5), top = Math.max(lo + 0.05, q(0.99));
  for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) { const v = u8[c * R + r]; values[(R - 1 - r) * C + c] = v ? Math.max(0, Math.min(1, ((v - 1) / 254 - lo) / (top - lo))) : -1; }
  const yTicks = [1, 4, 16, 64].map(f => ({ row: R - 1 - md.perOctave * Math.log2(f / md.rateMin) + 0.5, text: f + " Hz" })).filter(t => t.row > 0.5 && t.row < R - 0.5);
  return { kind: "mod", rows: R, cols: C, values, yTicks, colAt: t => Math.max(0, Math.min(C - 1, Math.floor(t / md.hop))), rateOf: r => md.rateMin * Math.pow(2, (R - 1 - r) / md.perOctave) };
}
// radix-2 FFT in place (inverse scaled by 1/n)
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const MORLET_W0 = 6, MORLET_FOURIER = 4 * Math.PI / (MORLET_W0 + Math.sqrt(2 + MORLET_W0 * MORLET_W0));   // period / scale
function scaleView(doc, curve) {
  const arr = doc.curves && doc.curves[curve];
  if (!Array.isArray(arr)) return null;
  // periods from 4 curve samples to a fifth of the sound (longer ones would be outside the cone of influence nearly everywhere)
  const rate = doc.curves.rate, n = arr.length, dt = 1 / rate, pMin = 4 / rate, pMax = Math.min(n / rate / 5, 600);
  if (!(pMax >= 2 * pMin)) return null;
  const perOct = 8, rows = Math.min(80, Math.floor(perOct * Math.log2(pMax / pMin)) + 1), periods = [];
  for (let j = 0; j < rows; j++) periods.push(pMin * Math.pow(2, j / perOct));
  let mean = 0, k = 0; for (const v of arr) if (v != null) { mean += v; k++; } mean = k ? mean / k : 0;
  let N = 1; while (N < 2 * n) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N);
  for (let i = 0; i < n; i++) xr[i] = (arr[i] == null ? mean : arr[i]) - mean;
  fft(xr, xi, false);
  const power = new Float32Array(rows * n), wr = new Float64Array(N), wi = new Float64Array(N), norm0 = Math.pow(Math.PI, -0.25);
  for (let j = 0; j < rows; j++) {
    const s = periods[j] / MORLET_FOURIER, g = norm0 * Math.sqrt(2 * Math.PI * s / dt);
    wr.fill(0); wi.fill(0);
    for (let q = 1; q <= N >> 1; q++) { const w = 2 * Math.PI * q / (N * dt), h = g * Math.exp(-0.5 * (s * w - MORLET_W0) ** 2); wr[q] = xr[q] * h; wi[q] = xi[q] * h; }
    fft(wr, wi, true);
    // power divided by scale; rows go from the shortest period (top) down
    for (let i = 0; i < n; i++) power[j * n + i] = (wr[i] * wr[i] + wi[i] * wi[i]) / s;
  }
  // inside the cone of influence: the period's e-folding time (sqrt 2 times the scale) fits between the moment and the end
  const inside = (j, i) => Math.SQRT2 * periods[j] / MORLET_FOURIER <= Math.min(i, n - 1 - i) / rate;
  let pk = 1e-20; for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) if (inside(j, i) && power[j * n + i] > pk) pk = power[j * n + i];
  if (pk <= 1e-20) for (const v of power) if (v > pk) pk = v;
  const values = new Float32Array(rows * n), faint = new Uint8Array(rows * n);
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const p = power[j * n + i];
    values[j * n + i] = p > 0 ? Math.max(0, Math.min(1, 1 + 10 * Math.log10(p / pk) / 30)) : 0;     // 30 dB below the peak is black
    faint[j * n + i] = inside(j, i) ? 0 : 1;
  }
  const r = doc.rhythm, beat = r && r.reliable && r.tempo ? 60 / r.tempo : 0, yTicks = [];
  const marks = beat ? [[beat, L("lib.unit.beat", "beat")], [4 * beat, L("lib.unit.bar", "bar")], [16 * beat, LP("lib.unit.bars", 4, "{n} bar", "{n} bars")], [64 * beat, LP("lib.unit.bars", 16, "{n} bar", "{n} bars")]]
    : [[0.05, "50 ms"], [0.2, "0.2 s"], [1, "1 s"], [5, "5 s"], [20, "20 s"], [60, "1 min"]];
  for (const [p, text] of marks) { const row = perOct * Math.log2(p / pMin); if (row >= 0 && row <= rows - 1) yTicks.push({ row: row + 0.5, text }); }
  return { kind: "scale", curve, rows, cols: n, values, faint, yTicks, periods, colAt: t => Math.max(0, Math.min(n - 1, Math.floor(t * rate))) };
}
/** The image of a view as numbers (see above); null when the document cannot give it. kind: "raster" (opts.curve,
 *  opts.bars 1 or 4, opts.cols), "tempo" (opts.cyclic; opts.source: a curve, or "speed", whose rises the tempogram is
 *  of; opts.weight: a curve that weights its columns, given back as suppress), "lag", "scale" (opts.curve). Built once
 *  per document and options. */
function view(doc, kind, opts) {
  opts = opts || {};
  if (!doc || !VIEW_KINDS.includes(kind)) return null;
  const curve = opts.curve || "onsetStrength", bars = opts.bars === 4 ? 4 : 1, cols = Math.max(8, Math.min(512, opts.cols || (bars === 4 ? 192 : 96)));
  const key = kind + "|" + (kind === "raster" ? curve + "|" + bars + "|" + cols : kind === "scale" ? curve : kind === "tempo" ? !!opts.cyclic + "|" + (opts.source || "") + "|" + (opts.weight || "") : "");
  return cachedView(doc, key, () => kind === "raster" ? rasterView(doc, curve, bars, cols) : kind === "tempo" ? tempoView(doc, opts.cyclic, opts.source, opts.weight) : kind === "lag" ? lagView(doc) : kind === "mod" ? modView(doc) : scaleView(doc, curve));
}
const makeCanvas = (w, h) => typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : typeof document !== "undefined" && document.createElement ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : null;
// an image of rows x cols cells, cell(r, c) -> [r, g, b, a] or null (left clear), drawn into the box dx, dy, dw, dh
function paintCells(ctx, rows, cols, cell, dx, dy, dw, dh, smooth) {
  const img = ctx.drawImage && makeCanvas(cols, rows), ig = img && img.getContext("2d");
  if (ig && ig.createImageData) {
    const id = ig.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const px = cell(r, c); if (!px) continue; const o = (r * cols + c) * 4; id.data[o] = px[0]; id.data[o + 1] = px[1]; id.data[o + 2] = px[2]; id.data[o + 3] = px[3]; }
    ig.putImageData(id, 0, 0);
    const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = !!smooth;
    ctx.drawImage(img, 0, 0, cols, rows, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = sm;
    return;
  }
  const cw = dw / cols, ch = dh / rows;     // no canvas to build an image on (tests, some workers): one rectangle per cell
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const px = cell(r, c); if (!px) continue; ctx.fillStyle = "rgba(" + px[0] + "," + px[1] + "," + px[2] + "," + (px[3] / 255).toFixed(2) + ")"; ctx.fillRect(dx + c * cw, dy + r * ch, cw + 0.5, ch + 0.5); }
}
// a view's axis (tempo, lag, period, bar number) along the right edge, as the spectrogram's frequencies
// (in light or dark by the ramp's low end, which is what the labels mostly sit on, not by the page)
function axisLabels(ctx, v, h, W, th) {
  if (h < 48 || W < 200 || !v.yTicks) return;
  const low = (th.specRamp || DEFAULT_THEME.specRamp)[0], dark = (0.2126 * low[0] + 0.7152 * low[1] + 0.0722 * low[2]) / 255 < 0.5;
  ctx.fillStyle = dark ? "#e4e8ea" : "#13181b"; ctx.globalAlpha = 0.65; ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  let last = -1e9;
  for (const t of v.yTicks) { const y = t.row / v.rows * h; if (y > 6 && y < h - 6 && Math.abs(y - last) >= 11) { ctx.fillText(t.text, W - 3, y); last = y; } }
  ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}
// The bar raster takes the whole strip: rows of bars, a faint beat grid, sections as rules between rows with their
// letters, and onsets, events and novelty as dots where they fall in the bar. Other layers have no place on it.
function drawRaster(ctx, doc, layers, rl, W, H, t0, t1, th, items) {
  const out = { code: lookCode(layers), layers, legend: describeLook(layers, doc), items, raster: null };
  const v = view(doc, "raster", { curve: rl.curve, bars: rl.bars });
  if (!v) return out;
  let r0 = 0, r1 = v.rows - 1;                  // the rows that overlap the shown time (all of them unless zoomed)
  while (r0 < r1 && v.timeRows[r0][1] <= t0) r0++;
  while (r1 > r0 && v.timeRows[r1][0] >= t1) r1--;
  const nr = r1 - r0 + 1, rowH = H / nr, ramp = th.specRamp, grid = th.grid || "#ffffff";
  paintCells(ctx, nr, v.cols, (r, c) => { const u = v.values[(r0 + r) * v.cols + c]; return u < 0 ? null : rampAt(ramp, u).concat(255); }, 0, 0, W, H, nr > H);
  items.push({ label: CURVE_LABELS[rl.curve] || rl.curve, ramp });
  const per = v.bars * v.beatsPerBar;
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  for (let k = 1; k < per; k++) { const x = Math.round(k / per * W) + 0.5; ctx.globalAlpha = k % v.beatsPerBar === 0 ? 0.5 : 0.18; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const tA = v.timeRows[r0][0], tB = v.timeRows[r1][1];
  const place = t => { let r = r0; while (r < r1 && t >= v.timeRows[r][1]) r++; const [a, e] = v.timeRows[r]; return { x: (t - a) / (e - a) * W, y: (r - r0) * rowH, r }; };
  const want = k => layers.some(l => l.type === "ticks" && l.of.includes(k));
  const dots = (ts, rad, colour) => {
    ctx.fillStyle = colour;
    for (const t of ts) { if (t < tA || t >= tB) continue; const p = place(t); ctx.beginPath(); if (ctx.arc) ctx.arc(p.x, p.y + rowH / 2, rad, 0, 2 * Math.PI); else ctx.rect(p.x - rad, p.y + rowH / 2 - rad, 2 * rad, 2 * rad); ctx.fill(); }
  };
  const rad = Math.max(1, Math.min(3, rowH / 3));
  if (want("onsets") && doc.onsets) dots(doc.onsets, rad, th.line);
  if (want("events") && doc.events) dots(doc.events.map(e => e.start), rad * 1.3, th.line);
  if (want("novelty") && doc.noveltyTicks) dots(doc.noveltyTicks, rad * 1.3, grid);
  if (layers.some(l => l.type === "sections") && doc.sections) {
    const fs = Math.max(9, Math.min(12, Math.round(H / 10)));
    ctx.font = fs + "px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    let lastY = -1e9;
    for (const s of doc.sections) {
      if (s.start >= tB || s.end <= tA) continue;
      const p = place(Math.max(s.start, tA)), y = Math.round((p.x > W / 2 ? p.r - r0 + 1 : p.r - r0) * rowH) + 0.5;     // the nearest row edge
      if (s.start > Math.max(0.05, tA) && y > 1) { ctx.strokeStyle = grid; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.globalAlpha = 1; }
      if (y - lastY < fs + 1 || y > H - fs) continue;
      if (th.halo && ctx.strokeText) { ctx.strokeStyle = th.halo; ctx.lineWidth = 3; ctx.strokeText(s.label, 3, y + 2); ctx.lineWidth = 1; }
      ctx.fillStyle = grid; ctx.fillText(s.label, 3, y + 2); lastY = y;
    }
    ctx.textBaseline = "alphabetic";
  }
  axisLabels(ctx, { rows: nr, yTicks: v.yTicks.filter(t => t.row >= r0 && t.row < r1 + 1).map(t => ({ row: t.row - r0, text: t.text })) }, H, W, th);
  out.raster = { rows: v.timeRows.slice(r0, r1 + 1) };
  return out;
}

// Draws a strip into any Canvas 2D context (page canvas, OffscreenCanvas in a worker).
// opts: width, height (default: the context's canvas), from, to (seconds, for zoom), theme, and one of
//   look    a look name from LOOKS or a look code
//   layers  a list of layers
//   (none)  the automatic look, adjustable with the older options curve, colour, lineRange, events, sections, beats
// Returns { code, layers, legend, items }: what was drawn as a look code, a plain-language legend, and one
// { label, colour } per coloured element for hosts that draw their own key.
function drawStrip(ctx, doc, opts) {
  opts = opts || {};
  const th = Object.assign({}, DEFAULT_THEME, opts.theme || {});
  th.lane = th.lane || th.line; th.laneDown = th.laneDown || th.rule; th.laneFlat = th.laneFlat || th.wave;
  const series = [th.lane].concat(th.series || SERIES);
  th.outline = th.outline || th.wave;
  const asked = opts.layers ? parseLook(opts.layers) : opts.look ? (parseLook(opts.look) || legacyLayers(doc, opts)) : legacyLayers(doc, opts);
  // a view this document cannot give (a beat view of a sound effect) leaves the plain waveform in its place; the legend
  // says the view is not in this analysis
  const missing = l => (l.type === "raster" || (l.type === "spec" && l.of)) && !view(doc, l.type === "raster" ? "raster" : l.of, l);
  const layers = asked.some(missing) ? asked.flatMap((l, i) => !missing(l) ? [l] : asked.some(x => x.type === "wave") || asked.findIndex(missing) < i ? [] : [{ type: "wave", colour: null }]) : asked;
  const W = opts.width || (ctx.canvas && ctx.canvas.width) || 600, H = opts.height || (ctx.canvas && ctx.canvas.height) || 64;
  const dur = doc.source.duration, t0 = Math.max(0, opts.from || 0), t1 = Math.min(dur, opts.to || dur), span = Math.max(1e-6, t1 - t0);
  const curves = doc.curves, rate = curves.rate, xOf = t => (t - t0) / span * W;
  const form = optionOf(layers, "form", "lanes"), shape = optionOf(layers, "shape", "base");
  // what a spectrogram-like layer shows: the mel spectrogram, or a view (tempogram, lag view, scalogram) of this document
  const specOf = l => !l.of ? doc.spectrum || null : view(doc, l.of, l);
  const items = [];
  const rasterL = layers.find(l => l.type === "raster");
  if (rasterL) return drawRaster(ctx, doc, asked, rasterL, W, H, t0, t1, th, items);
  const hasMain = layers.some(l => l.type === "wave" || (l.type === "spec" && specOf(l)));
  // lanes take the bottom of the strip (or all of it without a waveform); overlaid curves share the main band
  const lanes = layers.filter(l => l.type === "lane" && Array.isArray(curves[l.curve]));
  const stacked = form === "lanes" && lanes.length > 0;
  const laneH = !stacked ? 0 : hasMain ? Math.max(6, Math.round(H * (lanes.length === 1 ? 0.28 : lanes.length === 2 ? 0.22 : 0.18))) : H / lanes.length;
  const mainH = hasMain ? Math.max(4, H - laneH * (stacked ? lanes.length : 0)) : (stacked ? 0 : H);
  if (th.background) { ctx.fillStyle = th.background; ctx.fillRect(0, 0, W, H); }
  const valAt = (arr, ta, tb) => curveValue(arr, rate, ta, tb);
  const specBefore = l => { const i = layers.indexOf(l); return layers.some((x, j) => x.type === "spec" && j < i && specOf(x)); };
  const sculptL = layers.find(l => l.type === "sculpt" && Array.isArray(curves[l.curve])), sculpt = sculptL ? curves[sculptL.curve] : null;
  // the waveform per pixel column as [top, bottom] (fractions of the half-height, + up); with a sculpt curve the
  // envelope (a running maximum over about 1% of the width) is replaced by the curve and the detail inside it is kept
  let colsCache = null;
  const waveCols = () => {
    if (colsCache) return colsCache;
    const wv = doc.wave, wc = wv.columns, hi = new Float32Array(Math.ceil(W)), lo = new Float32Array(Math.ceil(W));      // hosts may pass a fractional width
    let peak = 1e-9; for (let c = 0; c < wc; c++) peak = Math.max(peak, Math.abs(wv.min[c] || 0), Math.abs(wv.max[c] || 0));
    for (let x = 0; x < W; x++) {
      const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span, ca = Math.floor(ta / dur * wc), cb = Math.max(ca + 1, Math.ceil(tb / dur * wc));
      let a = 0, b = 0; for (let c = ca; c < cb && c < wc; c++) { a = Math.min(a, wv.min[c] || 0); b = Math.max(b, wv.max[c] || 0); }
      hi[x] = b / peak; lo[x] = a / peak;
    }
    if (sculpt) {
      const r = Math.max(2, Math.round(W / 100)), amp = x => Math.max(hi[x], -lo[x]), env = new Float32Array(Math.ceil(W));
      for (let x = 0; x < W; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.max(m, amp(k)); env[x] = m; }
      for (let x = 0; x < W; x++) {
        const v = valAt(sculpt, t0 + x / W * span, t0 + (x + 1) / W * span), g = v == null || env[x] < 1e-4 ? 0 : Math.max(0, Math.min(1, v)) / env[x];
        hi[x] *= g; lo[x] *= g;
      }
    }
    return (colsCache = { hi, lo });
  };
  const draw = {
    wave(l) {
      if (!mainH) return;
      const H = mainH, mid = H / 2, wv = doc.wave, wc = wv.columns;
      let peak = 1e-9; for (let c = 0; c < wc; c++) peak = Math.max(peak, Math.abs(wv.min[c] || 0), Math.abs(wv.max[c] || 0));
      const colour = l.colour && curves[l.colour] ? curves[l.colour] : null, sc = sculpt ? waveCols() : null;
      const outline = specBefore(l);
      const tint = th.waveRamp && th.waveRamp.length >= 2 ? th.waveRamp : [th.waveLow, th.waveHigh];
      if (colour) items.push({ label: CURVE_LABELS[l.colour] || l.colour, ramp: tint });
      if (outline) { ctx.strokeStyle = th.wave; ctx.lineWidth = 1; ctx.globalAlpha = 0.8; }
      const top = [], bot = [];
      for (let x = 0; x < W; x++) {
        const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span;
        const ca = Math.floor(ta / dur * wc), cb = Math.max(ca + 1, Math.ceil(tb / dur * wc));
        let lo = 0, hi = 0; for (let c = ca; c < cb && c < wc; c++) { lo = Math.min(lo, wv.min[c] || 0); hi = Math.max(hi, wv.max[c] || 0); }
        if (sc) { hi = sc.hi[x] * peak; lo = sc.lo[x] * peak; }
        const yTop = mid - hi / peak * (mid - 1), yBot = mid - lo / peak * (mid - 1);
        if (outline) { top.push(yTop); bot.push(yBot); continue; }
        const u = colour ? valAt(colour, ta, tb) : null;
        ctx.fillStyle = u == null ? th.wave : "rgb(" + rampAt(tint, u).join(",") + ")";
        ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
      if (outline) {
        for (const ys of [top, bot]) { ctx.beginPath(); ys.forEach((y, x) => x ? ctx.lineTo(x + 0.5, y) : ctx.moveTo(0.5, y)); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    },
    outline() {
      // the ordinary peak waveform as a contour, so a sculpted or curve-only strip can be read against it
      const Hm = mainH || H, mid = Hm / 2, wv = doc.wave, wc = wv.columns;
      let peak = 1e-9; for (let c = 0; c < wc; c++) peak = Math.max(peak, Math.abs(wv.min[c] || 0), Math.abs(wv.max[c] || 0));
      const top = [], bot = [];
      for (let x = 0; x < W; x++) {
        const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span, ca = Math.floor(ta / dur * wc), cb = Math.max(ca + 1, Math.ceil(tb / dur * wc));
        let lo = 0, hi = 0; for (let c = ca; c < cb && c < wc; c++) { lo = Math.min(lo, wv.min[c] || 0); hi = Math.max(hi, wv.max[c] || 0); }
        top.push(mid - hi / peak * (mid - 1)); bot.push(mid - lo / peak * (mid - 1));
      }
      ctx.strokeStyle = th.outline; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
      for (const ys of [top, bot]) { ctx.beginPath(); ys.forEach((y, x) => x ? ctx.lineTo(x + 0.5, y) : ctx.moveTo(0.5, y)); ctx.stroke(); }
      ctx.globalAlpha = 1;
      items.push({ label: "peak waveform", colour: th.outline });
    },
    spec(l) {
      if (l.of) {     // a view: one image column per pixel, each taking the view's column at that moment
        const v = specOf(l);
        if (!v || !mainH) return;
        const PW = Math.max(1, Math.ceil(W)), at = new Int32Array(PW);      // hosts may pass a fractional width
        for (let x = 0; x < PW; x++) { const t = t0 + (x + 0.5) / PW * span; at[x] = t > dur ? -1 : v.colAt(t); }
        const ramp = th.specRamp, mid = rampAt(ramp, 0.45), grey = Math.round(0.2126 * mid[0] + 0.7152 * mid[1] + 0.0722 * mid[2]);
        paintCells(ctx, v.rows, PW, (r, x) => {
          if (at[x] < 0) return null;
          const k = r * v.cols + at[x], u = v.values[k];
          if (!(u >= 0)) return null;
          let c = rampAt(ramp, u);
          // a weighted tempogram: a weak column toward one grey (value-suppressing), not toward the ramp's black
          const sup = v.suppress ? v.suppress[at[x]] : 0;
          if (sup > 0) c = c.map(ch => Math.round(ch * (1 - sup) + grey * sup));
          return c.concat(v.faint && v.faint[k] ? 110 : 255);
        }, 0, 0, W, mainH, true);
        axisLabels(ctx, v, mainH, W, th, "right");
        items.push({ label: l.of === "tempo" ? L("lib.item.tempo", "tempo strength") : l.of === "lag" ? L("lib.item.repeat", "likeness to earlier") : l.of === "mod" ? L("lib.item.mod", "modulation depth") : L("lib.item.rhythms", "rhythms in {curve}", { curve: CURVE_LABELS[l.curve] || l.curve }), ramp });
        return;
      }
      const sp = doc.spectrum, u8 = specBytes(sp);
      if (!u8 || !mainH) return;
      const B = sp.bands, C = sp.columns, ramp = th.specRamp, c0 = Math.max(0, Math.floor(t0 / dur * C)), c1 = Math.min(C, Math.ceil(t1 / dur * C)), nc = Math.max(1, c1 - c0);
      const img = ctx.drawImage && makeCanvas(nc, B), ig = img && img.getContext("2d");
      const sx = (c0 - t0 / dur * C) / (t1 - t0) * dur / C * W, cw = W / ((t1 - t0) / dur * C);     // where column c0 starts, and a column's width
      if (ig && ig.createImageData) {
        const id = ig.createImageData(nc, B);
        for (let c = 0; c < nc; c++) for (let b = 0; b < B; b++) { const rgb = rampAt(ramp, u8[(c0 + c) * B + b] / 255), o = ((B - 1 - b) * nc + c) * 4; id.data[o] = rgb[0]; id.data[o + 1] = rgb[1]; id.data[o + 2] = rgb[2]; id.data[o + 3] = 255; }
        ig.putImageData(id, 0, 0);
        const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, nc, B, sx, 0, nc * cw, mainH);
        ctx.imageSmoothingEnabled = sm;
      } else {      // no canvas to build an image on (tests, some workers): one rectangle per cell
        for (let c = 0; c < nc; c++) for (let b = 0; b < B; b++) { ctx.fillStyle = "rgb(" + rampAt(ramp, u8[(c0 + c) * B + b] / 255).join(",") + ")"; ctx.fillRect(sx + c * cw, (B - 1 - b) / B * mainH, cw + 0.5, mainH / B + 0.5); }
      }
      if (mainH >= 48 && W >= 200) {       // a few frequencies along the left edge
        const mel = f => 2595 * Math.log10(1 + f / 700), lo = sp.fmin, hi = sp.fmax, mlo = mel(lo), mhi = mel(hi);
        const yOf = f => { const k = (mel(f) - mlo) / (mhi - mlo) * (B + 1) - 1; return (1 - (k + 0.5) / B) * mainH; };
        ctx.fillStyle = th.text; ctx.globalAlpha = 0.65; ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (const [f, t] of [[100, "100"], [1000, "1k"], [10000, "10k"]]) { if (f <= lo || f >= hi) continue; const y = yOf(f); if (y > 6 && y < mainH - 6) ctx.fillText(t, W - 3, y); }
        ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
    },
    sections() {
      if (!doc.sections) return;
      ctx.strokeStyle = th.rule; ctx.fillStyle = th.text; ctx.lineWidth = 1; ctx.font = Math.max(9, Math.round((mainH || H) / 6)) + "px sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";     // hosts may have left other settings behind
      if (ctx.setLineDash) ctx.setLineDash([2, 3]);
      for (const s of doc.sections) {
        if (s.start < t0 || s.start > t1) continue;
        const x = Math.round(xOf(s.start)) + 0.5;
        if (s.start > 0.05) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        const ty = Math.max(9, Math.round((mainH || H) / 6));
        if (th.halo && ctx.strokeText) { ctx.save && ctx.save(); ctx.setLineDash && ctx.setLineDash([]); ctx.strokeStyle = th.halo; ctx.lineWidth = 3; ctx.strokeText(s.label, x + 3, ty); ctx.restore && ctx.restore(); }
        ctx.fillText(s.label, x + 3, ty);
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
    },
    line(l) {
      const line = curves[l.curve];
      if (!line) return;
      const lr = l.range || autoRange(l.curve, line), Hm = mainH || H;
      items.push({ label: CURVE_LABELS[l.curve] || l.curve, colour: th.line });
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
      const colour = series[k % series.length], over = !stacked;
      const y0 = over ? 0 : mainH + k * laneH, bandH = over ? (mainH || H) : laneH, lr = l.range || autoRange(l.curve, arr), norm = v => Math.max(0, Math.min(1, (v - lr[0]) / (lr[1] - lr[0])));
      items.push({ label: CURVE_LABELS[l.curve] || l.curve, colour, down: l.signed ? th.laneDown : undefined });
      const sep = !over && (hasMain || k > 0);
      if (sep) { ctx.fillStyle = th.rule; ctx.globalAlpha = 0.35; ctx.fillRect(0, y0, W, 1); ctx.globalAlpha = 1; }
      const top = y0 + (sep ? 1 : 0), h = bandH - (sep ? 1 : 0), mid = top + h / 2;
      // direction of a change: level after minus level before, over a window that grows with the sound (0.25 to 3 s)
      const loud = curves.loudness, win = Math.max(0.25, Math.min(3, dur * 0.04));
      const lvl = (a, b) => { let s = 0, n = 0; const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(loud ? loud.length : 0, Math.ceil(b * rate)); for (let i = i0; i < i1; i++) { s += loud[i] == null ? 0 : loud[i]; n++; } return n ? s / n : 0; };
      const alpha = over ? (l.signed ? 0.55 : 0.2) : 1, edgeTop = [], edgeBot = [];     // overlaid curves: a light fill and a contour, so the waveform stays visible
      if (!l.signed && shape === "line") {
        ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1.25, h / 30); ctx.beginPath(); let pen = false;
        for (let x = 0; x < W; x++) { const v = valAt(arr, t0 + x / W * span, t0 + (x + 1) / W * span); if (v == null) { pen = false; continue; } const y = top + h - 1 - norm(v) * (h - 2); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } }
        ctx.stroke();
      } else {
        ctx.globalAlpha = alpha;
        for (let x = 0; x < W; x++) {
          const ta = t0 + x / W * span, tb = t0 + (x + 1) / W * span, v = valAt(arr, ta, tb);
          if (v == null) continue;
          const u = norm(v);
          if (u <= 0 || (l.signed && u < 0.12)) continue;     // signed lanes: the weakest changes are left out, so boundaries stand out
          if (l.signed) {
            const tm = (ta + tb) / 2, d = loud ? lvl(tm, tm + win) - lvl(tm - win, tm) : 0, half = h / 2;
            if (d > 0.03) { ctx.fillStyle = colour; ctx.fillRect(x, mid - u * half, 1, Math.max(1, u * half)); }
            else if (d < -0.03) { ctx.fillStyle = th.laneDown; ctx.fillRect(x, mid, 1, Math.max(1, u * half)); }
            else { ctx.fillStyle = th.laneFlat; ctx.fillRect(x, mid - u * half / 2, 1, Math.max(1, u * half)); }
            continue;
          }
          ctx.fillStyle = colour;
          if (over) { edgeTop[x] = shape === "mirror" ? mid - u * h / 2 : top + h - u * h; if (shape === "mirror") edgeBot[x] = mid + u * h / 2; }
          if (shape === "mirror") ctx.fillRect(x, mid - u * h / 2, 1, Math.max(1, u * h));
          else if (shape === "horizon") {
            for (let j = 0; j < 3; j++) { const a = Math.max(0, Math.min(1, u * 3 - j)); if (a <= 0) break; ctx.globalAlpha = alpha * (0.35 + 0.3 * j); ctx.fillRect(x, top + h - a * h, 1, Math.max(1, a * h)); }
            ctx.globalAlpha = alpha;
          } else ctx.fillRect(x, top + h - u * h, 1, Math.max(1, u * h));
        }
        ctx.globalAlpha = 1;
        if (over && !l.signed && shape !== "horizon") {
          ctx.strokeStyle = colour; ctx.lineWidth = 1.25;
          for (const e of [edgeTop, edgeBot]) { if (!e.length) continue; ctx.beginPath(); let pen = false; for (let x = 0; x < W; x++) { if (e[x] == null) { pen = false; continue; } if (pen) ctx.lineTo(x + 0.5, e[x]); else { ctx.moveTo(x + 0.5, e[x]); pen = true; } } ctx.stroke(); }
        }
      }
      if (!over && h >= 11 && W >= 160) {
        ctx.fillStyle = th.text; ctx.globalAlpha = 0.7; ctx.font = Math.min(10, h - 2) + "px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(CURVE_LABELS[l.curve] || l.curve, 3, top + Math.min(10, h - 2)); ctx.globalAlpha = 1;
      }
    },
    ticks(l) {
      const of = l.of || [], Hm = mainH || H, r = doc.rhythm, ok = r && r.reliable, fade = ok ? 1 : 0.35;
      ctx.fillStyle = th.tick; ctx.strokeStyle = th.tick; ctx.lineWidth = 1;
      const vl = (ts, h, alpha, y0) => { if (alpha != null) ctx.globalAlpha = alpha; for (const t of ts) { if (t < t0 || t > t1) continue; const x = Math.round(xOf(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, y0 == null ? Hm - h : y0); ctx.lineTo(x, Hm); ctx.stroke(); } if (alpha != null) ctx.globalAlpha = 1; };
      // the default look keeps its small downbeat ticks; other looks draw beats and faint bar lines through the strip
      const legacyTicks = l.small === true;
      if (of.includes("beats") && r) vl(r.beats, Math.max(3, Math.round(Hm * 0.06)), 0.55 * fade);
      if (of.includes("onsets") && doc.onsets) vl(doc.onsets, 3, 0.6);
      if (of.includes("downbeats") && r) {
        if (legacyTicks) { if (ok) vl(r.downbeats, 4); }
        else { vl(r.downbeats, 0, 0.2 * fade, 0); vl(r.downbeats, Math.max(4, Math.round(Hm * 0.1)), fade); }
      }
      if (of.includes("novelty") && doc.noveltyTicks) for (const t of doc.noveltyTicks) {     // from the top edge, like the lab's novelty ticks
        if (t < t0 || t > t1) continue; const x = xOf(t);
        ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x - 3, 7); ctx.lineTo(x + 3, 7); ctx.closePath(); ctx.fill();
      }
      if (of.includes("events") && doc.events) for (const e of doc.events) {
        if (e.start < t0 || e.start > t1) continue; const x = xOf(e.start);
        ctx.beginPath(); ctx.moveTo(x, Hm - 1); ctx.lineTo(x - 3, Hm - 6); ctx.lineTo(x + 3, Hm - 6); ctx.closePath(); ctx.fill();
      }
    }
  };
  for (const l of layers) if (draw[l.type]) draw[l.type](l);
  return { code: lookCode(asked), layers: asked, legend: describeLook(asked, doc), items };
}

const api = { version: VERSION, schema: SCHEMA, schemaVersion: SCHEMA_VERSION, profiles: PROFILES, analyze, fromAnalysis, process, tools, toMarkers, frames, curveAt, align, combine, combineRules: COMBINE_RULES, measureParts, arrange, goals: GOALS, drawStrip, view, viewKinds: VIEW_KINDS, parseLook, lookCode, describeLook, lookFits, looks: LOOKS, curveLabels: CURVE_LABELS, localize, forms: FORMS, shapes: SHAPES, theme: DEFAULT_THEME, internals: { WL, PHD, get FX() { return FXroot(); } } };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.Playhead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
