// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Can Playheads be combined without analysing the mix again? Each session is built from parts (stems): music from drum,
// bass, pad and lead parts on a beat grid, and layered impacts from sub, body, transient and tail layers. Every part and
// the true mix (their sum) are analysed with the same profile and asset class. The mix's document is then predicted
// from the parts' documents alone, by simple rules, and compared with the mix's own analysis:
//   lufs           power sum of the parts' short-term loudness (LUFS)
//   loudness ...   0-1 curves: the maximum of the parts, their loudness-weighted mean, the loudest part's value;
//                  loudness also mapped from the predicted LUFS (the map is learnt from the parts' own documents)
//   onsetStrength  the sum of the parts' onset strength
//   spectrum       power sum of the parts' mel spectrograms, then activity re-derived from its spectral flux
//   onsets, events the union of the parts' onsets (events), merged within 30 ms
// Measures: Pearson r over the frames where the mix sounds, mean absolute error, F-measure (±50 ms) for onsets/events.
// The parts are CC0 Sonic Pi samples (tools/fetch-corpus.sh fetches them; pass their folder if it is elsewhere).
//
//   node experiments/compose/compose.js [samples-dir]     -> table and experiments/compose/results.json
"use strict";
const path = require("path"), fs = require("fs"), { execFileSync } = require("child_process");
const P = require("../../src/playhead.js");

const SR = 44100;
const DIR = process.argv[2] || path.join(__dirname, "../corpus/src/sonic-pi/etc/samples");
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(DIR, name + ".flac"), "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  return (cache[name] = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice());
}
function repitch(x, semis) {                     // resampling: pitch and length change together, as a sampler does
  const r = Math.pow(2, semis / 12), n = Math.floor(x.length / r), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; y[i] = x[k] * (1 - f) + (x[k + 1] || 0) * f; }
  return y;
}
function session(n) {
  const stems = {};
  const put = (stem, x, t, gain, pan) => {
    const s = stems[stem] || (stems[stem] = [new Float32Array(n), new Float32Array(n)]);
    const i0 = Math.round(t * SR), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < x.length && i0 + i < n; i++) { if (i0 + i < 0) continue; s[0][i0 + i] += x[i] * gl; s[1][i0 + i] += x[i] * gr; }
  };
  return { stems, put };
}

// music: 12 bars; drums and pad from the start, bass and snare from bar 5, a break (pad only) in bar 9, a lead in 10-12
function music(seed, bpm, kit) {
  const R = rng(seed), b = 60 / bpm, bars = 12, n = Math.round((bars * 4 * b + 1.5) * SR), S = session(n);
  const prog = [0, -2, 3, -5];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = 0.25 + bar * 4 * b, brk = bar === 8;
    if (!brk) {
      S.put("kick", load(kit.kick), t0, 0.9, 0); S.put("kick", load(kit.kick), t0 + 2 * b, 0.85, 0);
      if (R() < 0.4) S.put("kick", load(kit.kick), t0 + 2.75 * b, 0.6, 0);
      const sub = bar >= 9 ? 4 : 2;
      for (let k = 0; k < 4 * sub; k++) S.put("hats", load(kit.hat), t0 + k * b / sub + (R() - 0.5) * 0.004, (k % sub ? 0.25 : 0.45) * (0.7 + 0.3 * R()), 0.4);
    }
    if (bar >= 4 && !brk) { S.put("snare", load(kit.snare), t0 + b, 0.7, -0.1); S.put("snare", load(kit.snare), t0 + 3 * b, 0.7, -0.1); }
    if (bar >= 4 && !brk) for (const k of [0, 0.75, 1.5, 2.5, 3]) S.put("bass", repitch(load(kit.bass), prog[bar % 4]).subarray(0, Math.round(0.7 * b * SR)), t0 + k * b, 0.55, 0);
    if (bar % 2 === 0) S.put("pad", repitch(load(kit.pad), prog[(bar / 2) % 4] - 12 + 12), t0, 0.35, -0.3);
    if (bar >= 9) for (let k = 0; k < 16; k++) if (R() < 0.45) S.put("lead", repitch(load(kit.lead), [0, 3, 5, 7, 10, 12].at(Math.floor(R() * 6))), t0 + k * b / 4, 0.3, 0.5);
  }
  return S.stems;
}
// layered impacts: three or four hits, each built from up to four layers, with small offsets (some flam)
function impacts(seed, kit) {
  const R = rng(seed), n = Math.round(3.6 * SR), S = session(n);
  [0.3, 1.25, 2.2].forEach((t, h) => {
    const flam = h === 1 ? 0.012 + 0.01 * R() : 0.002 * R();
    S.put("transient", load(kit.transient), t, 0.5 + 0.3 * R(), 0.1);
    S.put("sub", repitch(load(kit.sub), -2 * R()), t + flam, 0.8, 0);
    S.put("body", load(kit.body), t + 0.003, 0.5 + 0.3 * R(), -0.1);
    if (h !== 0) S.put("tail", load(kit.tail), t + 0.005, 0.25 + 0.2 * R(), 0.3);
  });
  return S.stems;
}

const MUSIC = [
  { bpm: 120, kick: "bd_haus", hat: "drum_cymbal_closed", snare: "sn_dolf", bass: "bass_woodsy_c", pad: "ambi_drone", lead: "elec_blip" },
  { bpm: 96, kick: "bd_boom", hat: "hat_cab", snare: "sn_dub", bass: "bass_hit_c", pad: "ambi_glass_hum", lead: "elec_bell" },
  { bpm: 128, kick: "bd_tek", hat: "hat_snap", snare: "elec_hi_snare", bass: "bass_dnb_f", pad: "ambi_choir", lead: "elec_ping" },
  { bpm: 110, kick: "bd_808", hat: "hat_metal", snare: "sn_generic", bass: "bass_thick_c", pad: "ambi_haunted_hum", lead: "guit_harmonics" },
  { bpm: 140, kick: "bd_klub", hat: "hat_zild", snare: "sn_zome", bass: "bass_hard_c", pad: "ambi_soft_buzz", lead: "elec_twang" },
  { bpm: 85, kick: "bd_fat", hat: "drum_cymbal_pedal", snare: "drum_snare_soft", bass: "bass_voxy_c", pad: "ambi_piano", lead: "elec_chime" }
];
const SFX = [
  { sub: "bd_boom", body: "drum_tom_lo_hard", transient: "perc_snap", tail: "drum_splash_hard" },
  { sub: "misc_cineboom", body: "perc_impact1", transient: "elec_wood", tail: "perc_swash" },
  { sub: "bd_808", body: "elec_fuzz_tom", transient: "elec_tick", tail: "elec_cymbal" },
  { sub: "drum_heavy_kick", body: "perc_impact2", transient: "perc_snap2", tail: "drum_cymbal_open" },
  { sub: "bd_zum", body: "glitch_perc3", transient: "elec_pop", tail: "ambi_dark_woosh" },
  { sub: "bass_hit_c", body: "drum_tom_mid_hard", transient: "drum_snare_hard", tail: "drum_splash_soft" },
  { sub: "bd_gas", body: "glitch_perc1", transient: "hat_tap", tail: "perc_swoosh" },
  { sub: "elec_hollow_kick", body: "perc_door", transient: "elec_flip", tail: "ride_via" }
];

// ---------- prediction from the parts' documents ----------
const CURVES = ["loudness", "activity", "arousal", "harshness", "tension", "surprise"];
function pearson(a, b) {
  const n = a.length; if (n < 3) return NaN;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}
const mae = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / Math.max(1, a.length);
const v01 = v => (v == null ? 0 : v);
const pw = l => (l == null ? 0 : Math.pow(10, l / 10));
function decodeSpec(doc) {
  const s = doc.spectrum; if (!s) return null;
  const bytes = Buffer.from(s.data, "base64"), B = s.bands, cols = s.columns, out = [];
  for (let c = 0; c < cols; c++) { const col = new Float64Array(B); for (let k = 0; k < B; k++) { const u = bytes[c * B + k]; col[k] = u ? s.dbTop - s.dbRange + u / 255 * s.dbRange : -Infinity; } out.push(col); }
  return out;
}
function fmeasure(est, ref, tol) {
  const used = new Uint8Array(ref.length); let hit = 0;
  for (const e of est) { let best = -1, bd = tol; ref.forEach((r, j) => { const d = Math.abs(r - e); if (!used[j] && d <= bd) { bd = d; best = j; } }); if (best >= 0) { used[best] = 1; hit++; } }
  const p = est.length ? hit / est.length : 0, r = ref.length ? hit / ref.length : 0;
  return p + r ? 2 * p * r / (p + r) : 0;
}
function union(lists, gap) { const all = [].concat(...lists).sort((a, b) => a - b), out = []; for (const t of all) if (!out.length || t - out.at(-1) > gap) out.push(t); return out; }
function smooth(x, w) { const y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(x.length - 1, i + w); j++) { s += x[j]; c++; } y[i] = s / c; } return y; }
function flux(spec) { return spec.map((col, t) => t ? col.reduce((s, v, k) => s + Math.max(0, (isFinite(v) ? v : -80) - (isFinite(spec[t - 1][k]) ? spec[t - 1][k] : -80)), 0) : 0); }

function compare(parts, mix) {
  const cm = mix.curves, n = cm.lufs.length, frames = [];
  for (let i = 0; i < n; i++) if (cm.lufs[i] != null && v01(cm.loudness[i]) > 0.02) frames.push(i);
  const pick = f => frames.map(f);
  const res = {};
  // LUFS: power sum
  const lufsPred = i => { const p = parts.reduce((s, d) => s + pw(d.curves.lufs[i]), 0); return p ? 10 * Math.log10(p) : -70; };
  res.lufs = { r: pearson(pick(lufsPred), pick(i => cm.lufs[i])), mae: mae(pick(lufsPred), pick(i => cm.lufs[i])) };
  // loudness from predicted LUFS through the parts' own LUFS -> loudness map (binned medians, then interpolated)
  const pairs = []; for (const d of parts) d.curves.lufs.forEach((l, i) => { if (l != null && d.curves.loudness[i] != null) pairs.push([l, d.curves.loudness[i]]); });
  pairs.sort((a, b) => a[0] - b[0]);
  const bins = []; for (let k = 0; k < pairs.length; k += Math.max(1, Math.floor(pairs.length / 40))) { const sl = pairs.slice(k, k + Math.max(1, Math.floor(pairs.length / 40))).map(p => p[1]).sort((a, b) => a - b); bins.push([pairs[k][0], sl[Math.floor(sl.length / 2)]]); }
  const mapL = l => { if (!bins.length) return 0; if (l <= bins[0][0]) return bins[0][1]; for (let k = 1; k < bins.length; k++) if (l <= bins[k][0]) { const [x0, y0] = bins[k - 1], [x1, y1] = bins[k]; return y0 + (y1 - y0) * (x1 > x0 ? (l - x0) / (x1 - x0) : 0); } return bins.at(-1)[1]; };
  for (const c of CURVES) {
    if (!cm[c] || cm[c].every(v => v == null)) continue;
    const truth = pick(i => v01(cm[c][i]));
    const rules = {
      max: i => Math.max(...parts.map(d => v01(d.curves[c] && d.curves[c][i]))),
      wmean: i => { let s = 0, w = 0; for (const d of parts) { const q = pw(d.curves.lufs[i]); s += q * v01(d.curves[c] && d.curves[c][i]); w += q; } return w ? s / w : 0; },
      loudest: i => { let best = null, bw = -1; for (const d of parts) { const q = pw(d.curves.lufs[i]); if (q > bw) { bw = q; best = d; } } return v01(best.curves[c] && best.curves[c][i]); }
    };
    if (c === "loudness") rules.fromLufs = i => mapL(lufsPred(i));
    res[c] = {};
    for (const [k, f] of Object.entries(rules)) { const p = pick(f); res[c][k] = { r: pearson(p, truth), mae: mae(p, truth) }; }
  }
  // onset strength: sum of the parts
  if (cm.onsetStrength) { const p = pick(i => parts.reduce((s, d) => s + v01(d.curves.onsetStrength && d.curves.onsetStrength[i]), 0)); res.onsetStrength = { sum: { r: pearson(p, pick(i => v01(cm.onsetStrength[i]))) } }; }
  // spectrum: power sum, error in dB where the mix is within 50 dB of its top
  const sm = decodeSpec(mix), sp = parts.map(decodeSpec);
  if (sm && sp.every(Boolean)) {
    const pred = sm.map((col, t) => col.map((_, k) => { const p = sp.reduce((s, S) => s + (isFinite(S[t][k]) ? Math.pow(10, S[t][k] / 10) : 0), 0); return p ? 10 * Math.log10(p) : -Infinity; }));
    let e = 0, m = 0;
    sm.forEach((col, t) => col.forEach((v, k) => { if (isFinite(v) && v > mix.spectrum.dbTop - 50 && isFinite(pred[t][k])) { e += Math.abs(pred[t][k] - v); m++; } }));
    const fm = smooth(flux(sm), 2), fp = smooth(flux(pred), 2);
    const act = sm.map((_, t) => { const i = Math.min(n - 1, Math.round(t * n / sm.length)); return v01(cm.activity[i]); });
    const on = sm.map((_, t) => cm.lufs[Math.min(n - 1, Math.round(t * n / sm.length))] != null);
    const sel = a => a.filter((_, t) => on[t]);
    res.spectrum = { maeDb: e / Math.max(1, m), fluxVsMixFlux: pearson(sel(fp), sel(fm)), activityFromPredFlux: pearson(sel(fp), sel(act)), activityFromMixFlux: pearson(sel(fm), sel(act)) };
  }
  // onsets and events: union of the parts
  const loudestPart = parts.slice().sort((a, b) => (b.summary.peakLufs || -99) - (a.summary.peakLufs || -99))[0];
  res.onsets = { union: fmeasure(union(parts.map(d => d.onsets || []), 0.03), mix.onsets || [], 0.05), loudestOnly: fmeasure(loudestPart.onsets || [], mix.onsets || [], 0.05) };
  if (mix.events) res.events = { union: fmeasure(union(parts.map(d => (d.events || []).map(e => e.start)), 0.03), mix.events.map(e => e.start), 0.05) };
  return res;
}

async function analyse(chs, kind) {
  return P.analyze({ sampleRate: SR, channels: chs }, kind === "music" ? { profile: "music", assetClass: "rhythmic" } : { profile: "sfx", assetClass: "sfx" });
}
async function run() {
  if (!fs.existsSync(DIR)) { console.error("Sonic Pi samples not found at " + DIR + " (run tools/fetch-corpus.sh, or pass the folder)"); process.exit(1); }
  const out = [];
  const jobs = MUSIC.map((k, i) => ({ id: "music-" + (i + 1), kind: "music", build: () => music(11 + i, k.bpm, k), kit: k }))
    .concat(SFX.map((k, i) => ({ id: "impact-" + (i + 1), kind: "sfx", build: () => impacts(101 + i, k), kit: k })));
  for (const j of jobs) {
    const stems = j.build(), names = Object.keys(stems), n = stems[names[0]][0].length;
    const mix = [new Float32Array(n), new Float32Array(n)];
    for (const s of names) for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) mix[c][i] += stems[s][c][i];
    const t0 = Date.now();
    const docs = []; for (const s of names) docs.push(await analyse(stems[s], j.kind));
    const tParts = Date.now() - t0, t1 = Date.now();
    const mdoc = await analyse(mix, j.kind);
    const tMix = Date.now() - t1, t2 = Date.now();
    const res = compare(docs, mdoc);
    out.push({ id: j.id, kind: j.kind, parts: names, seconds: +(n / SR).toFixed(2), msPredict: Date.now() - t2, msMix: tMix, msParts: tParts, res });
    process.stderr.write(j.id + " ");
  }
  process.stderr.write("\n");
  // summary: median and range over the sessions of each kind
  const med = a => { const s = a.filter(v => isFinite(v)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
  const rows = [];
  const add = (kind, label, get) => { const v = out.filter(o => o.kind === kind).map(get).filter(x => x != null && isFinite(x)); if (v.length) rows.push({ kind, label, median: +med(v).toFixed(3), min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3), n: v.length }); };
  for (const kind of ["music", "sfx"]) {
    add(kind, "lufs: power sum, r", o => o.res.lufs.r); add(kind, "lufs: power sum, MAE (LU)", o => o.res.lufs.mae);
    for (const c of CURVES) for (const rule of ["fromLufs", "max", "wmean", "loudest"]) add(kind, c + ": " + rule + ", r", o => o.res[c] && o.res[c][rule] && o.res[c][rule].r);
    add(kind, "onsetStrength: sum, r", o => o.res.onsetStrength && o.res.onsetStrength.sum.r);
    add(kind, "spectrum: power sum, MAE (dB)", o => o.res.spectrum && o.res.spectrum.maeDb);
    add(kind, "flux of predicted vs mix spectrum, r", o => o.res.spectrum && o.res.spectrum.fluxVsMixFlux);
    add(kind, "activity from predicted flux, r", o => o.res.spectrum && o.res.spectrum.activityFromPredFlux);
    add(kind, "activity from the mix's own flux, r (reference)", o => o.res.spectrum && o.res.spectrum.activityFromMixFlux);
    add(kind, "onsets: union, F", o => o.res.onsets.union); add(kind, "onsets: loudest part only, F", o => o.res.onsets.loudestOnly);
    add(kind, "events: union, F", o => o.res.events && o.res.events.union);
    add(kind, "time: predict / analyse mix", o => o.msPredict / o.msMix);
  }
  for (const r of rows) console.log(r.kind.padEnd(6), r.label.padEnd(50), String(r.median).padStart(8), ("[" + r.min + ", " + r.max + "]").padStart(18));
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ samples: "Sonic Pi (CC0)", sessions: out, summary: rows }, null, 1) + "\n");
}
run().catch(e => { console.error(e); process.exit(1); });
