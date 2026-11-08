// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// What drives the audiovisual scene, two ways, and what each way detected:
//
//   standardDrivers(x, sr)   the usual audio-reactive signals, worked out frame by frame (60 a second) without looking
//                            ahead, as a live visualiser does: WebAudio's AnalyserNode (its Blackman window, 2048-point
//                            FFT, smoothing 0.8, -100 to -30 dB as bytes) averaged over eight octaves; a level follower
//                            (10 ms attack, 250 ms release) with an automatic gain; MilkDrop's bass, mid and treble
//                            (each band's power against its 4 s running average) and their beats (above 1.5 times the
//                            average and rising, 120 ms apart); the spectral centroid for colour; an energy trend (the
//                            level over 2 s against its 16 s average) and level jumps for builds and drops
//   playheadDriver(doc)      the same slots from a Playhead document: attacks by band, the spectrum on the beat grid,
//                            the bar's phase, sections, builds and drops, fills and breaks, distortion, pass-bys
//   compare(truth, std, doc) for a sound whose parts are known (the demo arrangement): what each side found
//
// A drive is { level, bands[8], kick, snare, snareAge, hat, hatSeed, phase (-1 without a bar), beatPhase, hueA, hueB,
// build, rough, flash, passX, passOn, fill, brk, bg, grid }, every value 0..1 unless named otherwise.
// Runs in browsers, workers and Node.
"use strict";
(function (root) {
  const FPS = 60, EDGES = [130, 260, 520, 1040, 2080, 4160, 8320];
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const a = i + k, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
    }
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---------------- the usual way ---------------- */
  function standardDrivers(x, sr) {
    const N = 2048, n = Math.max(1, Math.ceil(x.length / sr * FPS)), half = N / 2, binHz = sr / N;
    const win = Float64Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
    const group = new Int8Array(half); for (let k = 0; k < half; k++) { const f = k * binHz; let g = 0; while (g < EDGES.length && f >= EDGES[g]) g++; group[k] = k === 0 ? -1 : g; }
    const gN = new Float64Array(8); for (let k = 1; k < half; k++) gN[group[k]]++;
    const out = { fps: FPS, frames: n, level: new Float32Array(n), bands: Array.from({ length: 8 }, () => new Float32Array(n)), bass: new Float32Array(n), mid: new Float32Array(n), treb: new Float32Array(n),
      hue: new Float32Array(n), trend: new Float32Array(n), rough: new Float32Array(n), bassAtt: new Float32Array(n), kicks: [], snares: [], hats: [], flashes: [] };
    const smooth = new Float64Array(half), re = new Float64Array(N), im = new Float64Array(N);
    const avg = [0, 0, 0], prevRel = [0, 0, 0], lastBeat = [-1e9, -1e9, -1e9], lists = [out.kicks, out.snares, out.hats];
    let env = 0, pk = 1e-4, cent = 0, slow = 0, long = 0, fast = 0, lastFlash = -1e9, att = 0, rough = 0;
    const ka = Math.exp(-1 / (FPS * 0.01)), kr = Math.exp(-1 / (FPS * 0.25)), kpk = Math.exp(-1 / (FPS * 20));
    const ema = s => 1 - Math.exp(-1 / (FPS * s));
    for (let i = 0; i < n; i++) {
      const end = Math.min(x.length, Math.round((i + 1) / FPS * sr));
      // the analyser: the last 2048 samples, Blackman window, magnitude / N, smoothed over frames, in dB as bytes
      for (let j = 0; j < N; j++) { const s = end - N + j; re[j] = s >= 0 ? x[s] * win[j] : 0; im[j] = 0; }
      fft(re, im);
      const gs = new Float64Array(8), pw = [0, 0, 0];
      let num = 0, den = 0;
      for (let k = 1; k < half; k++) {
        const m = Math.hypot(re[k], im[k]) / N;
        smooth[k] = 0.8 * smooth[k] + 0.2 * m;
        const db = 20 * Math.log10(smooth[k] + 1e-20), byte = Math.max(0, Math.min(255, Math.floor(255 / 70 * (db + 100))));
        gs[group[k]] += byte;
        const f = k * binHz, p = m * m;
        if (f < 250) pw[0] += p; else if (f < 4000) pw[1] += p; else if (f < 16000) pw[2] += p;
        num += p * f; den += p;
      }
      for (let g = 0; g < 8; g++) out.bands[g][i] = gN[g] ? gs[g] / gN[g] / 255 : 0;
      // the level: an RMS follower over the last 1024 samples, against its own slowly falling peak (an automatic gain)
      let e = 0; for (let s = Math.max(0, end - 1024); s < end; s++) e += x[s] * x[s];
      const rms = Math.sqrt(e / 1024), k = rms > env ? ka : kr;
      env = k * env + (1 - k) * rms; pk = Math.max(env, pk * kpk);
      const level = clamp01(env / pk); out.level[i] = level;
      // MilkDrop's bands against their running average, and their beats
      const t = i / FPS, rels = [];
      for (let b = 0; b < 3; b++) {
        const kk = i < FPS ? 1 / (i + 1) : 1 / (4 * FPS);
        avg[b] += kk * (pw[b] - avg[b]);
        const rel = pw[b] / Math.max(avg[b], 1e-12); rels.push(rel);
        if (rel > 1.5 && rel > prevRel[b] && t - lastBeat[b] >= 0.12 && pw[b] > 1e-10) { lists[b].push({ t, s: clamp01((rel - 1) / 2) }); lastBeat[b] = t; }
        prevRel[b] = rel;
      }
      out.bass[i] = clamp01(Math.sqrt(rels[0]) / 2); out.mid[i] = clamp01(Math.sqrt(rels[1]) / 2); out.treb[i] = clamp01(Math.sqrt(rels[2]) / 2);
      att += ema(0.15) * (out.bass[i] - att); out.bassAtt[i] = att;
      rough += ema(0.1) * (clamp01((rels[2] - 1) / 1.5) - rough); out.rough[i] = rough;
      // colour: the spectral centroid from 100 Hz to 10 kHz on a log scale
      const c = den > 1e-12 ? clamp01(Math.log2(num / den / 100) / Math.log2(100)) : cent;
      cent += ema(0.05) * (c - cent); out.hue[i] = cent;
      // builds and drops the usual way: the level over 2 s against its 16 s average, and a fast jump over the 2 s level
      fast += ema(0.05) * (level - fast); slow += ema(2) * (level - slow); long += ema(16) * (level - long);
      out.trend[i] = clamp01((slow / Math.max(long, 1e-3) - 1) * 2.5);
      if (fast - slow > 0.35 && t - lastFlash > 2) { out.flashes.push({ t, s: 1 }); lastFlash = t; }
    }
    return out;
  }
  // the drive at time t from the usual signals (spin is the free hand's angle, kept by the caller)
  function standardDrive(S, t, spin) {
    const i = Math.max(0, Math.min(S.frames - 1, Math.floor(t * FPS)));
    const last = (list, tau) => { let a = null, k = -1; for (let j = list.length - 1; j >= 0; j--) if (list[j].t <= t) { a = list[j]; k = j; break; } return a ? { v: a.s * Math.exp(-(t - a.t) / tau), age: t - a.t, k } : { v: 0, age: 9, k: 0 }; };
    const kk = last(S.kicks, 0.12), sn = last(S.snares, 0.16), ht = last(S.hats, 0.07), fl = last(S.flashes, 0.4);
    return { level: S.level[i], bands: S.bands.map(b => b[i]), kick: kk.v, snare: sn.v, snareAge: sn.age, hat: ht.v, hatSeed: ht.k % 97, phase: -1, beatPhase: -1, spin,
      hueA: 0.62 - 0.55 * S.hue[i], hueB: 0.62 - 0.55 * S.hue[i] + 0.1, build: S.trend[i], rough: S.rough[i], flash: fl.v, passX: 0, passOn: 0, fill: 0, brk: 0, bg: S.bassAtt[i], grid: 0 };
  }

  /* ---------------- Playhead's way ---------------- */
  const SECTION_HUES = { A: 0.58, B: 0.92, C: 0.08, D: 0.33, E: 0.75, F: 0.15, G: 0.48, H: 0.0 };
  function playheadDriver(doc) {
    const c = doc.curves || {}, rate = c.rate || 20, dur = doc.source.duration;
    const at = (name, t) => { const a = c[name]; if (!Array.isArray(a) || !a.length) return 0; const x = Math.max(0, Math.min(a.length - 1, t * rate - 0.5)), i = Math.floor(x), f = x - i, u = a[i], v = a[Math.min(a.length - 1, i + 1)]; return u == null ? (v == null ? 0 : v) : v == null ? u : u + (v - u) * f; };
    // attacks by band: an attack drives every band it rises in by a fifth or more (a kick and a hat struck together are
    // one attack, labelled by the band that rises most), more strongly the larger its share
    const attacks = (doc.attacks || []).slice().sort((a, b) => a.t - b.t), byBand = { low: [], mid: [], high: [] };
    for (const a of attacks) ["low", "mid", "high"].forEach((b, i) => { const sh = Array.isArray(a.bands) ? a.bands[i] : a.band === b ? 1 : 0; if (sh >= 0.2 || a.band === b) byBand[b].push({ t: a.t, strength: Math.max(0.35, a.strength == null ? 1 : a.strength) * Math.min(1, sh / 0.5) }); });
    const r = doc.rhythm || {}, beats = r.reliable ? r.beats || [] : [], downs = r.reliable ? r.downbeats || [] : [], bars = r.bars || [];
    // the spectrum on the grid: per bar, step and octave, the attack strength
    const sp = r.spectral, att = sp && sp.attacks ? b64(sp.attacks) : null, S = sp ? sp.steps : 16, NG = sp ? sp.groups : 8;
    const stepTimes = bars.map(bar => { const sw = bar.swing || r.swing || 1, q = sw / (1 + sw), w = u => (u <= 0.5 ? u / 0.5 * q : q + (u - 0.5) / 0.5 * (1 - q)); return Array.from({ length: S }, (_, s) => bar.start + (Math.floor(s / 4) + w((s % 4) / 4)) * bar.beat); });
    // the mel spectrogram in the same octaves, for what sounds where there is no grid
    const spec = doc.spectrum, mel = spec && spec.data ? b64(spec.data) : null, melGroups = [];
    if (mel) { const ml = 2595 * Math.log10(1 + spec.fmin / 700), mh = 2595 * Math.log10(1 + spec.fmax / 700); for (let b = 0; b < spec.bands; b++) { const f = 700 * (Math.pow(10, (ml + (mh - ml) * (b + 1) / (spec.bands + 1)) / 2595) - 1); let g = 0; while (g < EDGES.length && f >= EDGES[g]) g++; melGroups.push(g); } }
    const melAt = (t, g) => { if (!mel) return 0; const col = Math.max(0, Math.min(spec.columns - 1, Math.floor(t / dur * spec.columns))); let s = 0, k = 0; for (let b = 0; b < spec.bands; b++) if (melGroups[b] === g) { s += mel[col * spec.bands + b]; k++; } return k ? s / k / 255 : 0; };
    const find = (list, t) => { let lo = 0, hi = list.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
    const barStarts = bars.map(b => b.start);
    const lastOf = (list, t, tau) => { let lo = 0, hi = list.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? { v: 0, age: 9, k: 0 } : { v: list[k].strength * Math.exp(-(t - list[k].t) / tau), age: t - list[k].t, k }; };
    const sections = doc.sections || [], passes = (doc.glides || []).filter(g => g.passBy);
    // a build's drop: where the next section starts, from a second before the build ends to four seconds after it (a
    // build that stops rising before its last bars ends early); else the build's end where Playhead marks a drop
    const builds = (doc.builds || []).map(b => { const sc = sections.find(s => s.start >= b.end - 1 && s.start <= b.end + 4 && s.start > b.start); return Object.assign({}, b, { dropAt: sc ? sc.start : b.drop ? b.end : null }); });
    const hueOf = t => { const k = sections.findIndex(s => t >= s.start && t < s.end); if (k < 0) return 0.58; const h = SECTION_HUES[String(sections[k].label)[0]] ?? 0.58, s = sections[k]; if (k > 0 && t - s.start < 1) { const h0 = SECTION_HUES[String(sections[k - 1].label)[0]] ?? 0.58, u = (t - s.start); return h0 + (h - h0) * u; } return h; };
    function drive(t) {
      const kk = lastOf(byBand.low, t, 0.12), sn = lastOf(byBand.mid, t, 0.16), ht = lastOf(byBand.high, t, 0.07);
      // the bar and the beat
      let phase = -1, beatPhase = -1;
      const d = find(downs, t);
      if (d >= 0 && (d + 1 < downs.length || t - downs[d] < (downs[d] - (downs[d - 1] ?? downs[d] - 2)))) { const e = d + 1 < downs.length ? downs[d + 1] : 2 * downs[d] - downs[d - 1]; if (e - downs[d] < 6) phase = (t - downs[d]) / (e - downs[d]); }
      const bt = find(beats, t); if (bt >= 0 && bt + 1 < beats.length) beatPhase = (t - beats[bt]) / (beats[bt + 1] - beats[bt]);
      // octaves: what hits on this step of the bar (and the one before, fading), over a dim floor of what sounds
      const bands = new Array(8).fill(0), kb = find(barStarts, t);
      let fill = 0, brk = 0;
      if (att && kb >= 0 && t < (stepTimes[kb][S - 1] + bars[kb].beat / 2)) {
        const st = stepTimes[kb]; let s = -1; for (let j = 0; j < S; j++) if (st[j] - 0.03 <= t) s = j;
        for (let g = 0; g < 8; g++) {
          let v = 0;
          for (const j of [s, s - 1]) if (j >= 0) v = Math.max(v, att[(kb * S + j) * NG + g] / 255 * Math.exp(-Math.max(0, t - st[j]) / 0.11));
          bands[g] = Math.min(1, 0.25 * melAt(t, g) + v);
        }
        fill = bars[kb].change === "fill" ? 1 : 0; brk = bars[kb].change === "break" ? 1 : 0;
      } else for (let g = 0; g < 8; g++) bands[g] = 0.45 * melAt(t, g);
      // builds and drops; a source passing by
      let flash = 0;
      for (const b of builds) if (b.dropAt != null && t >= b.dropAt && t - b.dropAt < 2) flash = Math.max(flash, Math.exp(-(t - b.dropAt) / 0.5));
      let passX = 0, passOn = 0;
      for (const g of passes) if (t >= g.start && t <= g.end) { const h = Math.max(g.closest - g.start, g.end - g.closest, 0.1); passX = Math.max(-1, Math.min(1, (t - g.closest) / h)); passOn = 1; }
      const hue = hueOf(t), tension = at("tension", t);
      return { level: at("loudness", t), bands, kick: kk.v, snare: sn.v, snareAge: sn.age, hat: ht.v, hatSeed: ht.k % 97, phase, beatPhase, spin: 0,
        hueA: hue, hueB: hue + 0.1 + 0.12 * tension, build: at("buildup", t), rough: clamp01(1.4 * at("distortion", t) + 0.25 * at("timbreHarshness", t)), flash, passX, passOn, fill, brk, bg: tension, grid: phase >= 0 ? 1 : 0 };
    }
    // the strongest attack per octave from t0 to t1 on the grid, or what sounds there off the grid (for timelines)
    function octaves(t0, t1) {
      const out = new Array(8).fill(0), kb = Math.max(0, find(barStarts, t0));
      let onGrid = false;
      if (att) for (let k = kb; k < bars.length && bars[k].start < t1; k++) for (let j = 0; j < S; j++) {
        const ts = stepTimes[k][j]; if (ts < t0 - 0.03 || ts >= t1 - 0.03) continue;
        onGrid = true; for (let g = 0; g < 8; g++) out[g] = Math.max(out[g], att[(k * S + j) * NG + g] / 255);
      }
      if (!onGrid) for (let g = 0; g < 8; g++) out[g] = 0.45 * melAt((t0 + t1) / 2, g);
      return { values: out, onGrid };
    }
    return { drive, octaves, byBand, sections, builds, passes, bars, downs, at };
  }
  function b64(s) {
    if (typeof atob === "function") { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return Uint8Array.from(Buffer.from(s, "base64"));
  }

  /* ---------------- what each side found, against the parts the sound was built with ---------------- */
  // A trigger counts for a hit from 125 ms before it to 45 ms after (ITU-R BT.1359: a picture that early or that late
  // goes unnoticed); the latency is the trigger's time minus the hit's, median over the hits found.
  function hitsFound(hits, trig) {
    const ts = trig.map(x => x.t).sort((a, b) => a - b), lat = [];
    let found = 0;
    for (const h of hits) { let best = null; for (const t of ts) { const d = t - h; if (d >= -0.125 && d <= 0.045 && (best == null || Math.abs(d) < Math.abs(best))) best = d; } if (best != null) { found++; lat.push(best); } }
    lat.sort((a, b) => a - b);
    return { found, of: hits.length, triggers: ts.length, latencyMs: lat.length ? Math.round(1000 * lat[lat.length >> 1]) : null };
  }
  function compare(truth, S, doc) {
    const P = playheadDriver(doc), hits = inst => truth.hits.filter(h => h.inst === inst).map(h => h.t);
    const rows = [];
    for (const [inst, std, ph, name] of [["kick", S.kicks, P.byBand.low, "Kicks"], ["snare", S.snares, P.byBand.mid, "Snares"], ["hat", S.hats, P.byBand.high, "Hats"]]) {
      const a = hitsFound(hits(inst), std), b = hitsFound(hits(inst), ph);
      rows.push({ what: name, std: a, ph: b });
    }
    // sections: the changes the arrangement was built with, found within a bar
    const cuts = truth.sections.slice(1).map(s => s.start), phCuts = P.sections.slice(1).filter((s, k) => s.label !== P.sections[k].label).map(s => s.start);
    const near = (a, list, w) => list.some(b => Math.abs(a - b) <= w);
    rows.push({ what: "Section changes", std: null, ph: { found: cuts.filter(c => near(c, phCuts, truth.bar)).length, of: cuts.length, extra: phCuts.filter(c => !near(c, cuts, truth.bar)).length } });
    // the fill and the break, by bar
    const barAt = t => Math.round(t / truth.bar), phFills = P.bars.filter(b => b.change === "fill").map(b => barAt(b.start)), phBreaks = P.bars.filter(b => b.change === "break").map(b => barAt(b.start));
    rows.push({ what: "Fill and break", std: null, ph: { fill: phFills.includes(truth.fills[0]), brk: truth.breaks.some(b => phBreaks.includes(b)), fills: phFills, breaks: phBreaks } });
    // the build and the drop
    const [b0, b1] = truth.build, ov = b => Math.max(0, Math.min(b.end, b1) - Math.max(b.start, b0)) / (Math.max(b.end, b1) - Math.min(b.start, b0));
    const best = P.builds.reduce((m, b) => (ov(b) > (m ? ov(m) : 0) ? b : m), null);
    const meanIn = (a, t0, t1) => { let s = 0, k = 0; for (let i = Math.floor(t0 * FPS); i < Math.min(a.length, Math.ceil(t1 * FPS)); i++) { s += a[i]; k++; } return k ? s / k : 0; };
    const trendIn = meanIn(S.trend, b0, b1), trendOut = (meanIn(S.trend, 0, b0) * b0 + meanIn(S.trend, b1, S.frames / FPS) * (S.frames / FPS - b1)) / (S.frames / FPS - (b1 - b0));
    rows.push({ what: "Build (not louder)", std: { trendIn, trendOut }, ph: best ? { start: best.start, end: best.end, overlap: ov(best) } : null, truth: [b0, b1] });
    const jump = S.flashes.find(f => Math.abs(f.t - truth.drop) < 1), drop = P.builds.find(b => b.dropAt != null && Math.abs(b.dropAt - truth.drop) < 1);
    rows.push({ what: "Drop", std: { found: !!jump, err: jump ? jump.t - truth.drop : null, others: S.flashes.length - (jump ? 1 : 0) }, ph: { found: !!drop, err: drop ? drop.dropAt - truth.drop : null, others: P.builds.filter(b => b.dropAt != null && b !== drop).length } });
    // the pass-by
    const pb = P.passes[0];
    rows.push({ what: "Pass-by", std: null, ph: pb ? { closest: pb.closest, err: pb.closest - truth.passBy.closest, speed: pb.speed, trueSpeed: truth.passBy.speed } : null });
    // distortion: the clipped stab against the rest of the drop
    const [d0, d1] = truth.distortion, dropStart = truth.drop, dist = doc.curves.distortion || [], rate = doc.curves.rate;
    const curveIn = (a, t0, t1) => { let s = 0, k = 0; for (let i = Math.floor(t0 * rate); i < Math.min(a.length, Math.ceil(t1 * rate)); i++) if (a[i] != null) { s += a[i]; k++; } return k ? s / k : 0; };
    rows.push({ what: "Distortion (the clipped stab)", std: { inStab: meanIn(S.rough, d0, d1), before: meanIn(S.rough, dropStart, d0) }, ph: { inStab: curveIn(dist, d0, d1), before: curveIn(dist, dropStart, d0) } });
    return rows;
  }

  const api = { FPS, EDGES, standardDrivers, standardDrive, playheadDriver, compare, hitsFound };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AVDrivers = api;
})(typeof self !== "undefined" ? self : this);
