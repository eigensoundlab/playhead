// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// What drives the audiovisual scenes, two ways, and what each way detected:
//
//   standardDrivers(x, sr)   the usual audio-reactive signals, worked out frame by frame (60 a second) without looking
//                            ahead, as a live visualiser does: WebAudio's AnalyserNode (its Blackman window, 2048-point
//                            FFT, smoothing 0.8, -100 to -30 dB as bytes) averaged over eight octaves, and its loudest
//                            bin as the pitch; a level follower (10 ms attack, 250 ms release) with an automatic gain;
//                            MilkDrop's bass, mid and treble (each band's power against its 4 s running average) and
//                            their beats (above 1.5 times the average and rising, 120 ms apart); the spectral centroid;
//                            an energy trend (the level over 2 s against its 16 s average) and level jumps
//   usualSource(S)           those signals as a cue source (Playhead.cues), live: what has a usual counterpart
//                            (USUAL_EVENTS, USUAL_SIGNALS) and nothing else, and no cue before its event
//   usualBase(S), playheadBase(doc)   what every scene shows of the sound itself, whatever the rules: the level, eight
//                            octaves (the analyser's energy, or Playhead's hits per octave on the beat grid), the bar's
//                            phase where it is known, the pitch over the last 3 s
//   drive(base, cues, mappings, src, t, spin)   the scene's inputs at time t: the base and what the rules make
//   compare(kind, truth, S, doc)   for the demos, whose parts are known: what each side found
//
// Runs in browsers, workers and Node.
"use strict";
(function (root) {
  const FPS = 60, EDGES = [130, 260, 520, 1040, 2080, 4160, 8320];
  // the cue engine: Playhead.cues in the library bundle, or src/cues.js in Node
  const Cues = () => root.PlayheadCues || (root.Playhead && root.Playhead.cues) || (typeof require !== "undefined" ? require("../../../src/cues.js") : null);
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const a = i + k, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
    }
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  function b64(s) {
    if (typeof atob === "function") { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return Uint8Array.from(Buffer.from(s, "base64"));
  }
  const find = (list, t, key) => { let lo = 0, hi = list.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if ((key ? list[m][key] : list[m]) <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };

  /* ---------------- the usual way ---------------- */
  function standardDrivers(x, sr) {
    const N = 2048, n = Math.max(1, Math.ceil(x.length / sr * FPS)), half = N / 2, binHz = sr / N;
    const win = Float64Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
    const group = new Int8Array(half); for (let k = 0; k < half; k++) { const f = k * binHz; let g = 0; while (g < EDGES.length && f >= EDGES[g]) g++; group[k] = k === 0 ? -1 : g; }
    const gN = new Float64Array(8); for (let k = 1; k < half; k++) gN[group[k]]++;
    const out = { fps: FPS, frames: n, level: new Float32Array(n), bands: Array.from({ length: 8 }, () => new Float32Array(n)), bass: new Float32Array(n), mid: new Float32Array(n), treb: new Float32Array(n),
      hue: new Float32Array(n), trend: new Float32Array(n), rough: new Float32Array(n), bassAtt: new Float32Array(n), pitch: new Float32Array(n), kicks: [], snares: [], hats: [], flashes: [] };
    const smooth = new Float64Array(half), re = new Float64Array(N), im = new Float64Array(N);
    const avg = [0, 0, 0], prevRel = [0, 0, 0], lastBeat = [-1e9, -1e9, -1e9], lists = [out.kicks, out.snares, out.hats];
    // a fair start: the averages are the mean of what has been heard so far until their window is full (no rise from
    // zero in the first seconds, which would read as a build and a level jump), and the automatic gain starts from a
    // reference of -20 dBFS RMS (so the first sound is not by definition the loudest)
    let env = 0, pk = 0.1, cent = null, slow = null, long = null, fast = null, lastFlash = -1e9, att = null, rough = null;
    const ka = Math.exp(-1 / (FPS * 0.01)), kr = Math.exp(-1 / (FPS * 0.25)), kpk = Math.exp(-1 / (FPS * 20));
    let frame = 0;
    const ema = s => Math.max(1 - Math.exp(-1 / (FPS * s)), 1 / (frame + 1)), step = (v, x, s) => (v == null ? x : v + ema(s) * (x - v));
    for (let i = 0; i < n; i++) {
      const end = Math.min(x.length, Math.round((i + 1) / FPS * sr));
      // the analyser: the last 2048 samples, Blackman window, magnitude / N, smoothed over frames, in dB as bytes
      for (let j = 0; j < N; j++) { const s = end - N + j; re[j] = s >= 0 ? x[s] * win[j] : 0; im[j] = 0; }
      fft(re, im);
      const gs = new Float64Array(8), pw = [0, 0, 0];
      let num = 0, den = 0, best = 0, bk = 0;
      for (let k = 1; k < half; k++) {
        const m = Math.hypot(re[k], im[k]) / N;
        smooth[k] = 0.8 * smooth[k] + 0.2 * m;
        const db = 20 * Math.log10(smooth[k] + 1e-20), byte = Math.max(0, Math.min(255, Math.floor(255 / 70 * (db + 100))));
        gs[group[k]] += byte;
        if (k * binHz >= 60 && k * binHz <= 5000 && smooth[k] > best) { best = smooth[k]; bk = k; }
        const f = k * binHz, p = m * m;
        if (f < 250) pw[0] += p; else if (f < 4000) pw[1] += p; else if (f < 16000) pw[2] += p;
        num += p * f; den += p;
      }
      for (let g = 0; g < 8; g++) out.bands[g][i] = gN[g] ? gs[g] / gN[g] / 255 : 0;
      // pitch the usual way: the loudest bin of the analyser from 60 Hz to 5 kHz (parabolic in dB), as a MIDI note, where
      // it stands 40 dB or more over the analyser's floor
      if (bk > 1 && 20 * Math.log10(best + 1e-20) > -60) {
        const a = 20 * Math.log10(smooth[bk - 1] + 1e-20), b = 20 * Math.log10(best + 1e-20), c2 = 20 * Math.log10(smooth[bk + 1] + 1e-20), den2 = a - 2 * b + c2;
        const kk = bk + (den2 < 0 ? 0.5 * (a - c2) / den2 : 0); out.pitch[i] = 69 + 12 * Math.log2(kk * binHz / 440);
      } else out.pitch[i] = NaN;
      // the level: an RMS follower over the last 1024 samples, against its own slowly falling peak (an automatic gain)
      let e = 0; for (let s = Math.max(0, end - 1024); s < end; s++) e += x[s] * x[s];
      const rms = Math.sqrt(e / 1024), k = rms > env ? ka : kr;
      env = k * env + (1 - k) * rms; pk = Math.max(env, pk * kpk, 0.01); frame = i;
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
      att = step(att, out.bass[i], 0.15); out.bassAtt[i] = att;
      rough = step(rough, clamp01((rels[2] - 1) / 1.5), 0.1); out.rough[i] = rough;
      // colour: the spectral centroid from 100 Hz to 10 kHz on a log scale
      const c = den > 1e-12 ? clamp01(Math.log2(num / den / 100) / Math.log2(100)) : cent == null ? 0.5 : cent;
      cent = step(cent, c, 0.05); out.hue[i] = cent;
      // builds and drops the usual way: the level over 2 s against its 16 s average, and a fast jump over the 2 s level
      fast = step(fast, level, 0.05); slow = step(slow, level, 2); long = step(long, level, 16);
      out.trend[i] = clamp01((slow / Math.max(long, 1e-3) - 1) * 2.5);
      if (fast - slow > 0.35 && t - lastFlash > 2) { out.flashes.push({ t, s: 1 }); lastFlash = t; }
    }
    return out;
  }

  /* ---------------- the usual signals as a cue source ---------------- */
  // what each Playhead event and signal is the usual way, where there is such a thing
  const USUAL_EVENTS = { "hit.low": "bass beats", "hit.mid": "mid beats", "hit.high": "treble beats", attack: "any band's beat", sound: "any band's beat", drop: "level jumps" };
  const USUAL_SIGNALS = { loudness: "the level (RMS)", buildup: "the energy trend", distortion: "treble against its average", harshness: "treble against its average", tension: "damped bass", brightness: "the spectral centroid", pitch: "the loudest bin", pitchMotion: "the loudest bin's motion" };
  function usualSource(S, name) {
    const at = arr => t => { const i = Math.max(0, Math.min(S.frames - 1, Math.floor(t * FPS))); const v = arr[i]; return isFinite(v) ? v : null; };
    const beats = list => list.map(b => ({ t: b.t, value: b.s }));
    const any = [].concat(S.kicks, S.snares, S.hats).sort((a, b) => a.t - b.t).filter((b, i, l) => i === 0 || b.t - l[i - 1].t > 0.05).map(b => ({ t: b.t, value: b.s }));
    const pitchN = Float32Array.from(S.pitch, v => (isFinite(v) ? clamp01((v - 36) / 60) : NaN));
    const motion = Float32Array.from(S.pitch, (v, i) => { const u = S.pitch[Math.max(0, i - 6)]; return isFinite(v) && isFinite(u) ? clamp01(Math.abs(v - u) * 10 / 12) : NaN; });
    return { name: name || "", duration: S.frames / FPS, live: true, beatAt: () => 0.5, barAt: () => 2,
      events: { "hit.low": beats(S.kicks), "hit.mid": beats(S.snares), "hit.high": beats(S.hats), attack: any, sound: any, drop: S.flashes.map(f => ({ t: f.t, value: 1 })) },
      signals: { loudness: at(S.level), buildup: at(S.trend), distortion: at(S.rough), harshness: at(S.rough), tension: at(S.bassAtt), brightness: at(S.hue), pitch: at(pitchN), pitchMotion: at(motion) } };
  }

  /* ---------------- what every scene shows of the sound itself ---------------- */
  const PITCH_SPAN = 3, PITCH_N = 48;
  function usualBase(S) {
    const pitchN = Float32Array.from(S.pitch, v => (isFinite(v) ? clamp01((v - 36) / 60) : NaN));
    return {
      at(t) {
        const i = Math.max(0, Math.min(S.frames - 1, Math.floor(t * FPS))), hist = [];
        for (let k = 0; k < PITCH_N; k++) { const j = Math.floor((t - PITCH_SPAN + PITCH_SPAN * k / (PITCH_N - 1)) * FPS); const v = j >= 0 && j < S.frames ? pitchN[j] : NaN; hist.push(isFinite(v) ? v : null); }
        return { level: S.level[i], bands: S.bands.map(b => b[i]), phase: -1, beatPhase: -1, grid: 0, pitchHist: hist, pitchNow: isFinite(pitchN[i]) ? pitchN[i] : 0, pitchOn: isFinite(pitchN[i]) ? 1 : 0, rippleRate: 6 };
      },
      octaves(t0, t1) { const a = Math.max(0, Math.floor(t0 * FPS)), b = Math.min(S.frames, Math.max(a + 1, Math.ceil(t1 * FPS))), o = new Array(8).fill(0); for (let i = a; i < b; i++) for (let g = 0; g < 8; g++) o[g] = Math.max(o[g], S.bands[g][i]); return o.map(v => Math.max(0, (v - 0.25) / 0.6)); }
    };
  }
  function playheadBase(doc) {
    const c = doc.curves || {}, rate = c.rate || 20, dur = doc.source.duration;
    const curve = name => { const a = c[name]; if (!Array.isArray(a) || !a.length) return () => null; return t => { const x = Math.max(0, Math.min(a.length - 1, t * rate - 0.5)), i = Math.floor(x), f = x - i, u = a[i], v = a[Math.min(a.length - 1, i + 1)]; return u == null ? (v == null ? null : v) : v == null ? u : u + (v - u) * f; }; };
    const loud = curve("loudness"), pitch = curve("pitch");
    const r = doc.rhythm || {}, beats = r.reliable ? r.beats || [] : [], downs = r.reliable ? r.downbeats || [] : [], bars = r.bars || [];
    // the spectrum on the grid: per bar, step and octave, the attack strength
    const sp = r.spectral, att = sp && sp.attacks ? b64(sp.attacks) : null, S = sp ? sp.steps : 16, NG = sp ? sp.groups : 8;
    const stepTimes = bars.map(bar => { const sw = bar.swing || r.swing || 1, q = sw / (1 + sw), w = u => (u <= 0.5 ? u / 0.5 * q : q + (u - 0.5) / 0.5 * (1 - q)); return Array.from({ length: S }, (_, s) => bar.start + (Math.floor(s / 4) + w((s % 4) / 4)) * bar.beat); });
    const barStarts = bars.map(b => b.start);
    // the mel spectrogram in the same octaves, for what sounds where there is no grid
    const spec = doc.spectrum, mel = spec && spec.data ? b64(spec.data) : null, melGroups = [];
    if (mel) { const ml = 2595 * Math.log10(1 + spec.fmin / 700), mh = 2595 * Math.log10(1 + spec.fmax / 700); for (let b = 0; b < spec.bands; b++) { const f = 700 * (Math.pow(10, (ml + (mh - ml) * (b + 1) / (spec.bands + 1)) / 2595) - 1); let g = 0; while (g < EDGES.length && f >= EDGES[g]) g++; melGroups.push(g); } }
    const melAt = (t, g) => { if (!mel) return 0; const col = Math.max(0, Math.min(spec.columns - 1, Math.floor(t / dur * spec.columns))); let s = 0, k = 0; for (let b = 0; b < spec.bands; b++) if (melGroups[b] === g) { s += mel[col * spec.bands + b]; k++; } return k ? s / k / 255 : 0; };
    // without a grid (sound effects, or music before its first trusted downbeat): each band's hits, low to the low
    // octaves, mid to the middle, high to the top, over the dim floor
    const hits = doc.hits || null, HB = [0, 0, 0, 1, 1, 2, 2, 2];
    const hitAt = (b, t) => { const l = hits && hits[b]; if (!l || !l.length) return 0; let lo = 0, hi = l.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (l[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? 0 : l[k][1] * Math.exp(-(t - l[k][0]) / 0.12); };
    const vib = doc.vibrato || [], pitchN = t => { const v = pitch(t); return v == null ? null : clamp01((v - 36) / 60); };
    function bandsAt(t) {
      const bands = new Array(8).fill(0), kb = find(barStarts, t);
      if (att && kb >= 0 && t < (stepTimes[kb][S - 1] + bars[kb].beat / 2)) {
        const st = stepTimes[kb]; let s = -1; for (let j = 0; j < S; j++) if (st[j] - 0.03 <= t) s = j;
        for (let g = 0; g < 8; g++) { let v = 0; for (const j of [s, s - 1]) if (j >= 0) v = Math.max(v, att[(kb * S + j) * NG + g] / 255 * Math.exp(-Math.max(0, t - st[j]) / 0.11)); bands[g] = Math.min(1, 0.25 * melAt(t, g) + v); }
      } else { const hb = ["low", "mid", "high"].map(b => hitAt(b, t)); for (let g = 0; g < 8; g++) bands[g] = Math.min(1, 0.4 * melAt(t, g) + 0.8 * hb[HB[g]]); }
      return bands;
    }
    return {
      at(t) {
        let phase = -1, beatPhase = -1;
        const d = find(downs, t);
        if (d >= 0) { const e = d + 1 < downs.length ? downs[d + 1] : downs[d] + (d > 0 ? downs[d] - downs[d - 1] : 2); if (e - downs[d] < 6 && t < e) phase = (t - downs[d]) / (e - downs[d]); }
        const bt = find(beats, t); if (bt >= 0 && bt + 1 < beats.length) beatPhase = (t - beats[bt]) / (beats[bt + 1] - beats[bt]);
        const hist = []; for (let k = 0; k < PITCH_N; k++) { const tt = t - PITCH_SPAN + PITCH_SPAN * k / (PITCH_N - 1); hist.push(tt < 0 ? null : pitchN(tt)); }
        const pn = pitchN(t), v = vib.find(x => t >= x.start && t <= x.end);
        return { level: loud(t) || 0, bands: bandsAt(t), phase, beatPhase, grid: phase >= 0 ? 1 : 0, pitchHist: hist, pitchNow: pn == null ? 0 : pn, pitchOn: pn == null ? 0 : 1, rippleRate: v ? Math.min(v.rate, 30) : 6 };
      },
      // the strongest attack per octave from t0 to t1 on the grid, or what sounds and hits there off it (timelines)
      octaves(t0, t1) {
        const out = new Array(8).fill(0), kb = Math.max(0, find(barStarts, t0));
        let onGrid = false;
        if (att) for (let k = kb; k < bars.length && bars[k].start < t1; k++) for (let j = 0; j < S; j++) { const ts = stepTimes[k][j]; if (ts < t0 - 0.03 || ts >= t1 - 0.03) continue; onGrid = true; for (let g = 0; g < 8; g++) out[g] = Math.max(out[g], att[(k * S + j) * NG + g] / 255); }
        if (!onGrid) { const m = (t0 + t1) / 2; for (let g = 0; g < 8; g++) { let h = 0; const l = hits && hits[["low", "mid", "high"][HB[g]]]; if (l) for (const [ht, hs] of l) if (ht >= t0 && ht < t1) h = Math.max(h, hs); out[g] = Math.max(0.4 * melAt(m, g), 0.8 * h); } }
        return out;
      },
      downbeats: downs
    };
  }

  /* ---------------- a scene's inputs ---------------- */
  const BASE_HUE = 0.58;
  function drive(base, cues, mappings, src, t, spin) {
    const b = base.at(t), e = Cues().evaluate(cues, mappings, src, t), hue = BASE_HUE + 0.137 * e.palette + 0.3 * e.tint;
    return Object.assign(b, { spin, flash: e.flash, darken: e.darken, punch: e.punch, shockwave: e.shockwave, shockAge: e.age.shockwave == null ? 9 : e.age.shockwave,
      sparks: e.sparks, sparkSeed: (e.seed.sparks || 0) % 97, streaks: e.streaks, shake: e.shake, glow: e.glow, smoke: e.smoke, rough: e.rough, passX: e.passX, passOn: e.passOn,
      ripple: e.ripple, hueA: hue, hueB: hue + 0.12, levels: e });
  }

  /* ---------------- what each side found, against the parts the demos were built with ---------------- */
  // A trigger counts for a hit from 125 ms before it to 45 ms after (ITU-R BT.1359: a picture that early or that late
  // goes unnoticed), one for one, closest pairs first; the latency is the median over the hits found.
  function hitsFound(hits, trig) {
    const ts = trig.map(x => x.t).sort((a, b) => a - b), pairs = [], lat = [], usedH = new Set(), usedT = new Set();
    hits.forEach((h, i) => ts.forEach((t, j) => { const d = t - h; if (d >= -0.125 && d <= 0.045) pairs.push([Math.abs(d), i, j, d]); }));
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, i, j, d] of pairs) if (!usedH.has(i) && !usedT.has(j)) { usedH.add(i); usedT.add(j); lat.push(d); }
    lat.sort((a, b) => a - b);
    return { found: usedH.size, of: hits.length, triggers: ts.length, latencyMs: lat.length ? Math.round(1000 * lat[lat.length >> 1]) : null };
  }
  const f2 = (v, d) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(d == null ? 2 : d));
  const ms = v => (v == null ? "–" : (v > 0 ? "+" : "") + v + " ms");
  const hitText = r => r.found + " of " + r.of + " (" + r.triggers + (r.triggers === 1 ? " trigger), " : " triggers), ") + ms(r.latencyMs);
  const meanIn = (fn, t0, t1, step) => { let s = 0, k = 0; for (let t = t0; t < t1; t += step || 0.05) { const v = fn(t); if (v != null) { s += v; k++; } } return k ? s / k : 0; };
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  function compare(kind, truth, S, doc) {
    const P = Cues().source(doc), U = usualSource(S), E = n => P.events[n] || [], rows = [];
    const hits = inst => truth.hits.filter(h => h.inst === inst).map(h => h.t);
    const row = (what, std, ph, raw) => rows.push({ what, std, ph, raw: raw || {} });
    if (kind === "rhythm") {
      for (const [inst, b, name] of [["kick", "low", "Kicks"], ["snare", "mid", "Snares"], ["hat", "high", "Hats"]]) {
        const a = hitsFound(hits(inst), U.events["hit." + b]), p = hitsFound(hits(inst), E("hit." + b));
        row(name + " (" + hits(inst).length + ")", hitText(a), hitText(p), { std: a, ph: p });
      }
      const cuts = truth.sections.slice(1).map(s => s.start), phCuts = E("section").map(e => e.t), near = (a, l, w) => l.some(b => Math.abs(a - b) <= w);
      const sb = { found: cuts.filter(c => near(c, phCuts, truth.bar)).length, of: cuts.length, extra: phCuts.filter(c => !near(c, cuts, truth.bar)).length };
      row("Section boundaries (" + cuts.length + ")", null, sb.found + " of " + sb.of + (sb.extra ? ", " + sb.extra + " other" + (sb.extra > 1 ? "s" : "") : ", none other"), sb);
      const barAt = t => Math.round(t / truth.bar), fills = E("fill").map(e => barAt(e.t)), breaks = E("break").map(e => barAt(e.t));
      const fb = { fill: fills.includes(truth.fills[0]), brk: truth.breaks.some(b => breaks.includes(b)), fills, breaks };
      row("Fill and break", null, (fb.fill ? "the fill in bar " + (truth.fills[0] + 1) : "the fill missed") + "; " + (fb.brk ? "the break from bar " + (truth.breaks[0] + 1) : "the break missed") + (fills.length > 1 ? "; " + (fills.length - 1) + " other fill(s)" : ""), fb);
      const [b0, b1] = truth.build, ov = e => overlap(e.t, e.t + e.length, b0, b1) / (Math.max(e.t + e.length, b1) - Math.min(e.t, b0));
      const best = E("build").reduce((m, e) => (ov(e) > (m ? ov(m) : 0) ? e : m), null);
      const trIn = meanIn(U.signals.buildup, b0, b1), trOut = (meanIn(U.signals.buildup, 0, b0) * b0 + meanIn(U.signals.buildup, b1, U.duration) * (U.duration - b1)) / (U.duration - (b1 - b0));
      row("Build (" + f2(b0, 1) + " to " + f2(b1, 1) + " s)", "energy trend " + f2(trIn) + " inside, " + f2(trOut) + " elsewhere", best ? f2(best.t, 2) + " to " + f2(best.t + best.length, 2) + " s, overlap " + f2(ov(best)) : "not found", { overlap: best ? ov(best) : 0, trIn, trOut });
      const jump = U.events.drop.find(f => Math.abs(f.t - truth.drop) < 1), drop = E("drop").find(e => Math.abs(e.t - truth.drop) < 1);
      row("Drop (" + f2(truth.drop, 1) + " s)", jump ? "a level jump " + Math.round(1000 * (jump.t - truth.drop)) + " ms off" : "no level jump there (" + U.events.drop.length + " elsewhere)", drop ? Math.round(1000 * (drop.t - truth.drop)) + " ms off" : "not found", { std: !!jump, ph: drop ? drop.t - truth.drop : null });
      const pb = E("passBy")[0];
      row("Pass-by (" + f2(truth.passBy.closest, 1) + " s, " + truth.passBy.speed + " m/s)", null, pb ? "closest " + Math.round(1000 * (pb.peak - truth.passBy.closest)) + " ms off, " + f2(pb.speed, 1) + " m/s (a lower bound)" : "not found", { ph: pb ? pb.peak - truth.passBy.closest : null });
      const [d0, d1] = truth.distortion;
      row("Distortion (the clipped stab)", "treble roughness " + f2(meanIn(U.signals.distortion, d0, d1)) + " in it, " + f2(meanIn(U.signals.distortion, truth.drop, d0)) + " before", "distortion " + f2(meanIn(P.signals.distortion, d0, d1)) + " in it, " + f2(meanIn(P.signals.distortion, truth.drop, d0)) + " before");
    }
    if (kind === "melodic") {
      // the pitch on the notes, away from their first 80 ms and last 50 ms
      const within = fn => { let ok = 0, tot = 0; for (const nt of truth.notes) for (let t = nt.t + 0.08; t < nt.t + nt.dur - 0.05; t += 0.05) { tot++; const v = fn(t); if (v != null && Math.abs(v - nt.midi) < 0.5) ok++; } return tot ? ok / tot : 0; };
      const pu = within(t => { const v = S.pitch[Math.min(S.frames - 1, Math.floor(t * FPS))]; return isFinite(v) ? v : null; });
      const pc = doc.curves.pitch, pp = within(t => (pc ? pc[Math.min(pc.length - 1, Math.floor(t * doc.curves.rate))] : null));
      row("Pitch on the notes (within 50 cents)", Math.round(100 * pu) + " % (the loudest bin)", Math.round(100 * pp) + " %", { std: pu, ph: pp });
      const notes = truth.notes.map(n => n.t), nu = hitsFound(notes, U.events["hit.mid"]), np = hitsFound(notes, E("hit.mid"));
      row("Note starts (" + notes.length + ")", hitText(nu), hitText(np), { std: nu, ph: np });
      const slides = truth.glides.filter(g => g.end - g.start >= 0.15), gl = E("glide");
      const sf = slides.filter(g => gl.some(e => overlap(e.t, e.t + e.length, g.start, g.end) > 0 && Math.sign(e.semitones) === Math.sign(g.to - g.from))).length;
      row("Slides of 0.2 s and more (" + slides.length + ")", null, sf + " of " + slides.length + (gl.length > sf ? ", " + (gl.length - sf) + " other" : ""), { found: sf, of: slides.length });
      const vb = E("vibrato"), vf = truth.vibrato.filter(v => vb.some(e => overlap(e.t, e.t + e.length, v.start, v.end) > 0.2)).length, rates = vb.map(e => e.rate).sort((a, b) => a - b);
      row("Vibrato on long notes (" + truth.vibrato.length + ", 5.5 Hz)", null, vf + " of " + truth.vibrato.length + ", " + f2(rates[rates.length >> 1], 2) + " Hz", { found: vf, of: truth.vibrato.length, rate: rates[rates.length >> 1] });
      const cuts = truth.sections.slice(1).map(s => s.start), sc = E("section").map(e => e.t), w = 60 / truth.bpm;
      const ph = cuts.filter(c => sc.some(x => Math.abs(x - c) <= w)).length;
      row("Phrases (" + cuts.length + " boundaries)", null, ph + " of " + cuts.length + " within a beat" + (sc.length > ph ? ", " + (sc.length - ph) + " other boundaries" : ""), { found: ph, of: cuts.length, extra: sc.length - ph });
    }
    if (kind === "sfx") {
      const shots = truth.shots.map(s => s.t).concat([truth.explosion.t]);
      const su = hitsFound(shots, U.events.sound), sp = hitsFound(shots, E("sound"));
      row("Shots and the explosion (" + shots.length + ")", hitText(su), hitText(sp), { std: su, ph: sp });
      const bu = hitsFound(shots, U.events["hit.low"]), bp = hitsFound(shots, E("hit.low"));
      row("Booms (low hits at them)", hitText(bu), hitText(bp), { std: bu, ph: bp });
      const bolts = [].concat(...truth.shots.map(s => s.bolt)), ou = hitsFound(bolts, U.events["hit.high"]), op = hitsFound(bolts, E("hit.high"));
      row("Bolt clicks (" + bolts.length + ")", hitText(ou), hitText(op), { std: ou, ph: op });
      // after-effects: of the shots that ring out (the single shot, the burst's last, the explosion), how many have a tail
      // starting within 0.8 s of their peak
      const ringing = [truth.shots[0].t, truth.shots[truth.shots.length - 1].t, truth.explosion.t], tails = E("tail");
      const tf = ringing.filter(t => tails.some(e => e.t > t && e.t - t < 0.8)).length;
      row("After-effects (tails of " + ringing.length + " sounds)", null, tf + " of " + ringing.length + ", " + tails.map(e => f2(e.t, 1) + "+" + f2(e.length, 1) + " s").join(", "), { found: tf, of: ringing.length });
      const m = truth.motor, gu = E("glide.up").find(e => overlap(e.t, e.t + e.length, m.up[0], m.up[1]) > 0.5), gd = E("glide.down").find(e => overlap(e.t, e.t + e.length, m.down[0], m.down[1]) > 0.5);
      row("Motor spin-up and spin-down", null, (gu ? "up " + f2(gu.t, 1) + "–" + f2(gu.t + gu.length, 1) + " s" : "up missed") + "; " + (gd ? "down " + f2(gd.t, 1) + "–" + f2(gd.t + gd.length, 1) + " s" : "down missed") + " (built " + f2(m.up[0], 1) + "–" + f2(m.up[1], 1) + ", " + f2(m.down[0], 1) + "–" + f2(m.down[1], 1) + ")", { up: !!gu, down: !!gd });
      const rot = E("vibrato").find(e => overlap(e.t, e.t + e.length, m.run[0], m.run[1]) > 1);
      row("Rotor (" + m.rotorHz + " Hz)", null, rot ? f2(rot.rate, 1) + " Hz, " + f2(rot.value * 100, 0) + " cents" : "not found", { rate: rot ? rot.rate : null });
      const pb = E("passBy")[0];
      row("Pass-by (" + f2(truth.passBy.closest, 1) + " s, " + truth.passBy.speed + " m/s)", null, pb ? "closest " + Math.round(1000 * (pb.peak - truth.passBy.closest)) + " ms off, " + f2(pb.speed, 1) + " m/s (a lower bound)" : "not found", { ph: pb ? pb.peak - truth.passBy.closest : null });
      const [d0, d1] = truth.distortion, outU = (meanIn(U.signals.distortion, 0, d0) * d0 + meanIn(U.signals.distortion, d1, U.duration) * (U.duration - d1)) / (U.duration - (d1 - d0));
      const outP = (meanIn(P.signals.distortion, 0, d0) * d0 + meanIn(P.signals.distortion, d1, P.duration) * (P.duration - d1)) / (P.duration - (d1 - d0));
      row("Distortion (the alarm)", "treble roughness " + f2(meanIn(U.signals.distortion, d0, d1)) + " in it, " + f2(outU) + " elsewhere", "distortion " + f2(meanIn(P.signals.distortion, d0, d1)) + " in it, " + f2(outP) + " elsewhere", { ph: meanIn(P.signals.distortion, d0, d1), phOut: outP });
    }
    return rows;
  }

  const api = { FPS, EDGES, standardDrivers, usualSource, usualBase, playheadBase, drive, compare, hitsFound, USUAL_EVENTS, USUAL_SIGNALS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AVDrivers = api;
})(typeof self !== "undefined" ? self : this);
