// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead

/* ===================================================================
   Playhead effects bench: processing driven by the analysis.
   Every tool takes a decoded buffer plus its analysis and returns new
   buffers; the app re-analyses them so the views show before and after.
   =================================================================== */
(function (root) {
"use strict";
const WL = root.WL || (typeof require !== "undefined" ? require("./analysis.js") : null);
const tick = () => new Promise(r => setTimeout(r, 0));

function mkBuf(sr, chans) {
  const L = chans[0];
  return { sampleRate: sr, length: L.length, numberOfChannels: chans.length, duration: L.length / sr, getChannelData: c => chans[Math.min(c, chans.length - 1)] };
}
function chansOf(buf) { const out = []; for (let c = 0; c < buf.numberOfChannels; c++) out.push(Float32Array.from(buf.getChannelData(c))); return out; }
function peakOf(chans) { let p = 0; for (const ch of chans) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; } return p; }
function scaleTo(chans, peak) { const p = peakOf(chans); if (p <= 0) return 1; const g = peak / p; for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] *= g; return g; }
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const db = v => 20 * Math.log10(Math.max(v, 1e-12));
// integrated loudness, ITU-R BS.1770 (400 ms blocks, 75% overlap, -70 LUFS absolute and -10 LU relative gates)
function lufsOf(chans, sr) {
  const kc = WL.kFilterCoeffs(sr), len = chans[0].length, blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const zs = chans.map(c => { const a = new Float32Array(len), b = new Float32Array(len); WL.biquadInto(c, a, kc[0]); WL.biquadInto(a, b, kc[1]); return b; });
  const P = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) { let s = 0; for (const z of zs) s += z[i] * z[i]; P[i + 1] = P[i] + s; }
  const blocks = [];
  if (len < blk) blocks.push(P[len] / Math.max(1, len));
  for (let s0 = 0; s0 + blk <= len; s0 += hop) blocks.push((P[s0 + blk] - P[s0]) / blk);
  const L = z => -0.691 + 10 * Math.log10(z + 1e-20);
  let g = blocks.filter(z => L(z) > -70);
  if (!g.length) return -70;
  const rel = L(g.reduce((a, b) => a + b, 0) / g.length) - 10;
  g = g.filter(z => L(z) > rel);
  return L(g.reduce((a, b) => a + b, 0) / Math.max(1, g.length));
}
function finish(src, chans, mode, report) {
  const sr = src.sampleRate;
  if (mode === "loudness") {
    const a = lufsOf(chansOf(src), sr), b = lufsOf(chans, sr);
    if (isFinite(a) && isFinite(b) && b > -70) { const g = undb(a - b); for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g; report.push("Loudness matched to the original (" + (a - b >= 0 ? "+" : "") + (a - b).toFixed(1) + " dB)"); }
  } else if (mode === "peak") { scaleTo(chans, peakOf(chansOf(src))); report.push("Peak matched to the original"); }
  const p = peakOf(chans);
  if (p > 0.999) { scaleTo(chans, 0.999); report.push("Lowered " + db(p / 0.999).toFixed(1) + " dB to avoid clipping"); }
  return chans;
}
const undb = v => Math.pow(10, v / 20);

/* ---------- STFT engine: Hann analysis and synthesis, hop N/4, WOLA normalisation.
   gainFn(frame, time, magMono, gains) fills per-bin real gains shared by all channels. ---------- */
async function stftApply(chans, sr, N, gainFn, onProgress) {
  const H = N >> 2, half = N >> 1, fft = WL.getFFT(N), w = WL.hannP(N);
  const len = chans[0].length, nCh = chans.length, pad = N;
  const outs = chans.map(() => new Float64Array(len + 2 * pad)), norm = new Float64Array(len + 2 * pad);
  // channels go two per complex FFT (one in the real part, one in the imaginary part): the gains are real and
  // symmetric, so they act on both at once, and each channel's spectrum is split out only for the magnitudes
  const nP = (nCh + 1) >> 1, re = Array.from({ length: nP }, () => new Float64Array(N)), im = Array.from({ length: nP }, () => new Float64Array(N));
  const mag = new Float64Array(half + 1), g = new Float32Array(half + 1);
  const nF = Math.ceil((len + N) / H);
  for (let f = 0; f < nF; f++) {
    const start = f * H - half;
    for (let p = 0; p < nP; p++) {
      const x = chans[2 * p], y = chans[2 * p + 1], r = re[p], q = im[p];
      for (let i = 0; i < N; i++) { const s = start + i, ok = s >= 0 && s < len; r[i] = ok ? x[s] * w[i] : 0; q[i] = ok && y ? y[s] * w[i] : 0; }
      fft(r, q);
    }
    for (let k = 0; k <= half; k++) {
      let e = 0; const kk = (N - k) % N;
      for (let p = 0; p < nP; p++) {
        const r = re[p], q = im[p];
        if (2 * p + 1 < nCh) { const ar = r[k] + r[kk], ai = q[k] - q[kk], br = q[k] + q[kk], bi = r[kk] - r[k]; e += 0.25 * (ar * ar + ai * ai + br * br + bi * bi); }
        else e += r[k] * r[k] + q[k] * q[k];
      }
      mag[k] = Math.sqrt(e / nCh);
    }
    g.fill(1);
    gainFn(f, (start + half) / sr, mag, g);
    for (let p = 0; p < nP; p++) {
      const r = re[p], q = im[p], two = 2 * p + 1 < nCh;
      for (let k = 0; k <= half; k++) { r[k] *= g[k]; q[k] *= g[k]; if (k > 0 && k < half) { r[N - k] *= g[k]; q[N - k] *= g[k]; } }
      for (let i = 0; i < N; i++) q[i] = -q[i];
      fft(r, q);
      const o = outs[2 * p], o2 = two ? outs[2 * p + 1] : null;
      for (let i = 0; i < N; i++) { const s = start + i + pad; o[s] += (r[i] / N) * w[i]; if (two) o2[s] -= (q[i] / N) * w[i]; }
    }
    for (let i = 0; i < N; i++) norm[start + i + pad] += w[i] * w[i];
    if ((f & 127) === 127) { if (onProgress) onProgress(f / nF); await tick(); }
  }
  return outs.map(o => { const y = new Float32Array(len); for (let i = 0; i < len; i++) { const nv = norm[i + pad]; y[i] = nv > 1e-6 ? o[i + pad] / nv : 0; } return y; });
}
// two passes: collect mono magnitudes first (for filters that look ahead), then apply a gain matrix
async function stftMagnitudes(chans, sr, N) {
  const H = N >> 2, half = N >> 1, fft = WL.getFFT(N), w = WL.hannP(N), len = chans[0].length, nCh = chans.length;
  const nF = Math.ceil((len + N) / H), M = new Float32Array(nF * (half + 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < nF; f++) {
    const start = f * H - half;
    for (let c = 0; c < nCh; c++) {
      const x = chans[c];
      for (let i = 0; i < N; i++) { const s = start + i; re[i] = s >= 0 && s < len ? x[s] * w[i] : 0; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k <= half; k++) M[f * (half + 1) + k] += (re[k] * re[k] + im[k] * im[k]) / nCh;
    }
    if ((f & 255) === 255) await tick();
  }
  for (let i = 0; i < M.length; i++) M[i] = Math.sqrt(M[i]);
  return { M, nF, bins: half + 1, H };
}
function frameN(sr, dur) { const base = dur <= 6 ? 1024 : 2048; return Math.round(base * sr / 44100) >= 1536 ? 2048 : 1024; }

/* ---------- 1. Clean-up for export (driven by the asset checks) ---------- */
async function cleanup(src, an, opt) {
  const sr = src.sampleRate, X = an.X;
  let ch = chansOf(src);
  const report = [];
  // find clipped runs on the original samples (|x| at full scale for 3+ samples)
  const runs = ch.map(c => { const r = []; for (let i = 0; i < c.length; i++) { if (Math.abs(c[i]) < 0.9999) continue; let j = i; while (j + 1 < c.length && Math.abs(c[j + 1]) >= 0.9999 && Math.sign(c[j + 1]) === Math.sign(c[i])) j++; if (j - i + 1 >= 3) r.push([i, j]); i = j; } return r; });
  // DC offset
  let dcMax = 0;
  for (const c of ch) { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; const m = s / c.length; dcMax = Math.max(dcMax, Math.abs(m)); for (let i = 0; i < c.length; i++) c[i] -= m; }
  if (dcMax > 0.002) report.push("Removed DC offset of " + db(dcMax).toFixed(0) + " dBFS");
  // rebuild clipped runs with a cubic Hermite through the neighbours (restores the overshoot)
  let fixed = 0;
  ch.forEach((c, ci) => {
    for (const [i, j] of runs[ci]) {
      if (i < 2 || j + 2 >= c.length) continue;
      const p0 = c[i - 1], p1 = c[j + 1], m0 = c[i - 1] - c[i - 2], m1 = c[j + 2] - c[j + 1], L = j - i + 2;
      for (let k = i; k <= j; k++) { const t = (k - i + 1) / L, t2 = t * t, t3 = t2 * t; c[k] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 * L + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1 * L; }
      fixed += j - i + 1;
    }
  });
  if (fixed) report.push("Rebuilt " + fixed + " clipped samples");
  // trim silence (-60 dBFS), keep 5 ms before and 30 ms after
  const thr = 0.001, len = ch[0].length;
  let li = len, ti = -1;
  for (let i = 0; i < len; i++) if (ch.some(c => Math.abs(c[i]) > thr)) { li = i; break; }
  for (let i = len - 1; i >= 0; i--) if (ch.some(c => Math.abs(c[i]) > thr)) { ti = i; break; }
  if (ti > li) {
    const a = Math.max(0, li - Math.round(0.005 * sr)), b = Math.min(len, ti + 1 + Math.round(0.03 * sr));
    if (a > 0 || b < len) { report.push("Trimmed " + (a / sr * 1000).toFixed(0) + " ms at the start and " + ((len - b) / sr * 1000).toFixed(0) + " ms at the end"); ch = ch.map(c => c.slice(a, b)); }
  }
  // fades: short fade-in always; a longer fade-out when the tail was cut
  const n = ch[0].length, fin = Math.min(n >> 2, Math.round(0.002 * sr));
  for (const c of ch) for (let i = 0; i < fin; i++) c[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fin);
  let pk = peakOf(ch), endRms = 0; { const k = Math.min(n, Math.round(0.005 * sr)); let s = 0; for (const c of ch) for (let i = n - k; i < n; i++) s += c[i] * c[i]; endRms = Math.sqrt(s / (k * ch.length)); }
  const cut = endRms > pk * undb(-35);
  const fout = Math.min(n >> 1, Math.round((cut ? Math.min(0.08, 0.15 * n / sr) : 0.002) * sr));
  for (const c of ch) for (let i = 0; i < fout; i++) c[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fout);
  if (cut) report.push("Faded the cut tail over " + (fout / sr * 1000).toFixed(0) + " ms");
  // identical channels -> mono
  if (opt.mono && ch.length === 2) { let same = true; for (let i = 0; i < n && same; i++) if (Math.abs(ch[0][i] - ch[1][i]) > 1e-5) same = false; if (same) { ch = [ch[0]]; report.push("Folded identical channels to mono"); } }
  // peak normalise
  const target = undb(opt.peakDb);
  pk = peakOf(ch);
  if (pk > 0 && Math.abs(db(pk) - opt.peakDb) > 0.1) { scaleTo(ch, target); report.push("Normalised peak from " + db(pk).toFixed(1) + " to " + opt.peakDb.toFixed(1) + " dBFS"); }
  if (!report.length) report.push("Nothing to fix");
  return { outputs: [{ suffix: "clean", buf: mkBuf(sr, ch) }], report };
}

/* ---------- 2. De-harsh: resonance suppression gated by the harshness model ---------- */
async function deharsh(src, an, opt, onProgress) {
  const sr = src.sampleRate, F = an.F, cur = an.cur, ch = chansOf(src);
  const N = frameN(sr, src.duration), half = N >> 1, binHz = sr / N;
  const hf = cur.raw.hfac, sh = cur.raw.sharp, dtF = F.dt, nFr = F.nF;
  const at = (arr, t) => arr[Math.min(nFr - 1, Math.max(0, Math.round(t / dtF - 0.5)))];
  // log-frequency smoothing ranges (±1/6 octave) and weights
  const lo = new Int32Array(half + 1), hi = new Int32Array(half + 1), wRes = new Float32Array(half + 1), wTilt = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const f = Math.max(binHz, k * binHz);
    lo[k] = Math.max(0, Math.floor(f * Math.pow(2, -1 / 6) / binHz)); hi[k] = Math.min(half, Math.ceil(f * Math.pow(2, 1 / 6) / binHz));
    const z = Math.log2(f / 800) / Math.log2(10000 / 800);
    wRes[k] = z <= 0 || z >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * z);
    wTilt[k] = f < 3000 ? 0 : Math.min(1, Math.log2(f / 3000) / Math.log2(10000 / 3000));
  }
  const Ld = new Float64Array(half + 1), P = new Float64Array(half + 2), state = new Float32Array(half + 1).fill(0), gdb = new Float32Array(half + 1);
  const relA = 1 - Math.exp(-(N / 4) / sr / 0.06);
  // gate: absolute (annoyance scale), relative (this file's own P50..P95 range), or always open
  const mode = opt.mode || "absolute";
  const gated = a => { const o = []; for (let m = 0; m < nFr; m++) if (cur.gate[m]) o.push(a[m]); return o.sort((x, y) => x - y); };
  const qs = (s, p) => s.length ? s[Math.floor(p * (s.length - 1))] : 0;
  const hs = gated(hf), ss = gated(sh);
  const gLo = mode === "relative" ? qs(hs, 0.5) : opt.threshold, gW = mode === "relative" ? Math.max(0.03, qs(hs, 0.9) - gLo) : 0.6;
  const S0 = mode === "absolute" ? 1.75 : Math.min(1.75, qs(ss, 0.5));
  // detector: the harshness model (default), or the level in the same frequency region, as a conventional
  // dynamic EQ would use; the level gate always opens between this file's own P50 and P90 (in dB)
  const byLevel = opt.sidechain === "level" && mode !== "always";
  let lev = null, lLo = 0, lW = 1;
  if (byLevel) {
    const A = await stftMagnitudes(ch, sr, N); lev = new Float32Array(A.nF);
    for (let f = 0; f < A.nF; f++) { let e = 0; for (let k = 0; k <= half; k++) { const m = A.M[f * A.bins + k]; e += (wRes[k] + wTilt[k]) * m * m; } lev[f] = 10 * Math.log10(e + 1e-20); }
    const top = lev.reduce((a, b) => Math.max(a, b), -Infinity), snd = Array.from(lev).filter(v => v > top - 50).sort((a, b) => a - b);
    lLo = qs(snd, 0.5); lW = Math.max(1, qs(snd, 0.9) - lLo);
  }
  let gateSum = 0, gateN = 0, maxCut = 0, cutSum = 0, cutN = 0;
  const trace = opt.trace ? { t: [], gate: [] } : null;
  const outs = await stftApply(ch, sr, N, (f, t, mag, g) => {
    const h = at(hf, t), S = at(sh, t);
    const gate = mode === "always" ? 1 : byLevel ? Math.max(0, Math.min(1, (lev[Math.min(lev.length - 1, f)] - lLo) / lW)) : Math.max(0, Math.min(1, (h - gLo) / gW));
    gateSum += gate; gateN++; if (trace) { trace.t.push(t); trace.gate.push(gate); }
    for (let k = 0; k <= half; k++) Ld[k] = 20 * Math.log10(mag[k] + 1e-9);
    P[0] = 0; for (let k = 0; k <= half; k++) P[k + 1] = P[k] + Ld[k];
    for (let k = 0; k <= half; k++) {
      const sm = (P[hi[k] + 1] - P[lo[k]]) / (hi[k] - lo[k] + 1);
      const excess = Math.min(12, Math.max(0, Ld[k] - sm - 2));
      let target = -opt.amount * gate * (wRes[k] * excess + wTilt[k] * Math.max(0, S - S0) * 4);
      target = Math.max(target, -opt.maxCut);
      // instant attack, 60 ms release
      state[k] = target < state[k] ? target : state[k] + (target - state[k]) * relA;
    }
    let fs = 0, fw = 0;
    for (let k = 0; k <= half; k++) {
      const a = state[Math.max(0, k - 1)], b = state[k], c = state[Math.min(half, k + 1)]; gdb[k] = (a + b + c) / 3; if (-gdb[k] > maxCut) maxCut = -gdb[k]; g[k] = undb(gdb[k]);
      if (wRes[k] > 0 || wTilt[k] > 0) { const e = mag[k] * mag[k]; fs -= gdb[k] * e; fw += e; }
    }
    if (fw > 0) { cutSum += fs / fw; cutN++; }
  }, onProgress);
  const report = [(mode === "always" ? "Always on" : byLevel ? "Level detector (" + lW.toFixed(1) + " dB range above this file's median level)" : (mode === "relative" ? "Relative gate (harshness " + gLo.toFixed(2) + " to " + (gLo + gW).toFixed(2) + ")" : "Absolute gate")) + (mode === "always" ? "" : ": open " + Math.round(100 * gateSum / Math.max(1, gateN)) + "% of the time"),
    "Average cut above 0.8 kHz " + (cutSum / Math.max(1, cutN)).toFixed(1) + " dB, deepest " + maxCut.toFixed(1) + " dB"];
  // what was removed: dry minus wet before loudness matching, raised for listening
  let removed = null;
  if (opt.delta) {
    const dry = chansOf(src), d = dry.map((c, i) => { const o = new Float32Array(c.length); for (let n = 0; n < c.length; n++) o[n] = c[n] - outs[i][n]; return o; });
    const lr = lufsOf(d, sr), ld = lufsOf(dry, sr);
    if (lr > -69 && ld - lr <= 40 && peakOf(d) > 0) { scaleTo(d, undb(-6)); removed = mkBuf(sr, d); report.push("Removed part is " + (ld - lr).toFixed(0) + " LU below the original (raised to −6 dBFS peak for listening)"); }
    else report.push(lr > -69 ? "Removed part is " + (ld - lr).toFixed(0) + " LU below the original, too quiet to hear, so it is not rendered" : "Nothing measurable was removed");
  }
  finish(src, outs, opt.match ? "loudness" : "none", report);
  const outputs = [{ suffix: byLevel ? "deharsh-level" : "deharsh", buf: mkBuf(sr, outs) }];
  if (removed) outputs.push({ suffix: (byLevel ? "deharsh-level" : "deharsh") + "-removed", buf: removed });
  return { outputs, report, stats: { open: gateSum / Math.max(1, gateN), avgCut: cutSum / Math.max(1, cutN), maxCut }, trace };
}

/* ---------- 3. Layer remix: Wiener masks from the NMF layers ---------- */
function layerMasker(an, sr, N, gainsDb) {
  const X = an.X, raw = X.nmfRaw, B = X.melCenters.length, half = N >> 1, binHz = sr / N;
  const K = raw.W.length, gLin = new Float32Array(K).fill(1);
  X.layers.forEach((l, i) => { for (const k of l.comps) gLin[k] = undb(gainsDb[i] || 0); });
  const mel = f => 2595 * Math.log10(1 + f / 700);
  const mc = X.melCenters.map(mel);
  const pos = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const m = mel(k * binHz);
    let b = 0; while (b < B - 1 && mc[b + 1] < m) b++;
    pos[k] = m <= mc[0] ? 0 : m >= mc[B - 1] ? B - 1 : b + (m - mc[b]) / (mc[b + 1] - mc[b]);
  }
  const times = raw.times, T = times.length, C = new Float64Array(K * B);
  return (f, t, mag, g) => {
    let j = 0; while (j < T - 1 && times[j + 1] < t) j++;
    const u = T > 1 && t > times[j] ? Math.min(1, (t - times[j]) / Math.max(1e-9, times[Math.min(T - 1, j + 1)] - times[j])) : 0;
    for (let k = 0; k < K; k++) {
      const h = raw.H[k][j] * (1 - u) + raw.H[k][Math.min(T - 1, j + 1)] * u;
      for (let b = 0; b < B; b++) C[k * B + b] = raw.W[k][b] * h;
    }
    for (let i = 0; i <= half; i++) {
      const p = pos[i], b0 = Math.floor(p), b1 = Math.min(B - 1, b0 + 1), fr = p - b0;
      let num = 0, den = 1e-20;
      for (let k = 0; k < K; k++) { const c = C[k * B + b0] * (1 - fr) + C[k * B + b1] * fr, e = c * c; num += e * gLin[k]; den += e; }
      g[i] = num / den;
    }
  };
}
async function layerMix(src, an, opt, onProgress) {
  const sr = src.sampleRate, N = frameN(sr, src.duration);
  if (!an.X || !an.X.nmfRaw || !an.X.nmfRaw.W.length) return { outputs: [], report: ["No layers found"] };
  const outs = await stftApply(chansOf(src), sr, N, layerMasker(an, sr, N, opt.gains), onProgress);
  const report = an.X.layers.map((l, i) => l.name + " " + (l.hz >= 1000 ? (l.hz / 1000).toFixed(1) + " kHz" : Math.round(l.hz) + " Hz") + ": " + ((opt.gains[i] || 0) >= 0 ? "+" : "") + (opt.gains[i] || 0).toFixed(0) + " dB");
  finish(src, outs, opt.match ? "loudness" : "none", report);
  return { outputs: [{ suffix: "layers", buf: mkBuf(sr, outs) }], report };
}

/* ---------- 4. Attack and body: median-filter HPSS (Fitzgerald 2010), soft masks ---------- */
// running median over a sorted window: each step swaps the outgoing value for the incoming one and moves it into
// place, so there is no allocation or full sort per sample (same values as sorting every window; edges repeat)
function medianFilter1D(src, off, stride, n, half, out, win) {
  const w = 2 * half + 1, at = k => src[off + Math.min(n - 1, Math.max(0, k)) * stride];
  for (let k = -half; k <= half; k++) win[k + half] = at(k);
  win.subarray(0, w).sort(); out[0] = win[half];
  for (let i = 1; i < n; i++) {
    const old = at(i - half - 1), nv = at(i + half);
    if (old === nv) { out[i] = win[half]; continue; }
    let lo = 0, hi = w - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < old) lo = m + 1; else hi = m; }
    let j = lo;
    if (nv > old) { while (j + 1 < w && win[j + 1] < nv) { win[j] = win[j + 1]; j++; } }
    else { while (j > 0 && win[j - 1] > nv) { win[j] = win[j - 1]; j--; } }
    win[j] = nv; out[i] = win[half];
  }
}
async function hpss(src, an, opt, onProgress) {
  const sr = src.sampleRate, ch = chansOf(src), N = frameN(sr, src.duration);
  const { M, nF, bins } = await stftMagnitudes(ch, sr, N);
  const Hm = new Float32Array(M.length), Pm = new Float32Array(M.length), tmp = new Float32Array(Math.max(nF, bins)), win = new Float32Array(17);
  for (let k = 0; k < bins; k++) { medianFilter1D(M, k, bins, nF, 8, tmp, win); for (let i = 0; i < nF; i++) Hm[i * bins + k] = tmp[i]; if ((k & 255) === 255) await tick(); }
  for (let i = 0; i < nF; i++) { medianFilter1D(M, i * bins, 1, bins, 8, Pm.subarray(i * bins, (i + 1) * bins), win); if ((i & 511) === 511) await tick(); }
  const gA = undb(opt.attackDb), gB = undb(opt.bodyDb);
  let pShare = 0, tot = 0;
  for (let i = 0; i < M.length; i++) { const h = Hm[i] * Hm[i], p = Pm[i] * Pm[i]; pShare += p / (h + p + 1e-20) * M[i] * M[i]; tot += M[i] * M[i]; }
  const outs = await stftApply(ch, sr, N, (f, t, mag, g) => {
    const o = Math.min(nF - 1, f) * bins;
    for (let k = 0; k < bins; k++) { const h = Hm[o + k] * Hm[o + k], p = Pm[o + k] * Pm[o + k], d = h + p + 1e-20; g[k] = gB * h / d + gA * p / d; }
  }, onProgress);
  const report = ["Percussive share of energy " + Math.round(100 * pShare / Math.max(1e-20, tot)) + "%", "Attack " + (opt.attackDb >= 0 ? "+" : "") + opt.attackDb + " dB, body " + (opt.bodyDb >= 0 ? "+" : "") + opt.bodyDb + " dB"];
  finish(src, outs, opt.match ? "loudness" : "none", report);
  return { outputs: [{ suffix: "attack-body", buf: mkBuf(sr, outs) }], report };
}

/* ---------- 5. Tension shaper: gain and brightness automation from the tension curve ---------- */
async function tensionShape(src, an, opt, onProgress) {
  const sr = src.sampleRate, F = an.F, cur = an.cur, ch = chansOf(src);
  const c5 = cur.curves.c5, c1 = cur.curves.c1, n = F.nF, dtF = F.dt;
  const T = new Float32Array(n);
  for (let m = 0; m < n; m++) T[m] = cur.gate[m] ? Math.max(0, Math.min(1, (c5[m] - 0.4 * c1[m]) / 0.6)) : 0.5;
  const Ts = WL.movMean(T, Math.max(1, Math.round(0.5 / dtF)));
  const sorted = Array.from(Ts).filter((_, m) => cur.gate[m]).sort((a, b) => a - b), med = sorted.length ? sorted[sorted.length >> 1] : 0.5;
  const N = frameN(sr, src.duration), half = N >> 1, binHz = sr / N;
  const shelf = new Float32Array(half + 1); for (let k = 0; k <= half; k++) { const f = Math.max(1, k * binHz); shelf[k] = 1 / (1 + Math.pow(2500 / f, 2)); }
  const pk0 = peakOf(ch);
  let gMin = 0, gMax = 0;
  const outs = await stftApply(ch, sr, N, (f, t, mag, g) => {
    const v = Ts[Math.min(n - 1, Math.max(0, Math.round(t / dtF - 0.5)))] - med;
    const gainDb = opt.contrast * v * 12, tiltDb = opt.bright * v * 8;
    gMin = Math.min(gMin, gainDb); gMax = Math.max(gMax, gainDb);
    for (let k = 0; k <= half; k++) g[k] = undb(gainDb + tiltDb * shelf[k]);
  }, onProgress);
  void pk0;
  const report = ["Gain automation from " + gMin.toFixed(1) + " to +" + gMax.toFixed(1) + " dB around the median tension", "Brightness follows tension by up to " + Math.abs(opt.bright * 4).toFixed(1) + " dB"];
  finish(src, outs, "peak", report);
  return { outputs: [{ suffix: "tension", buf: mkBuf(sr, outs) }], report };
}

/* ---------- 6. Loop maker: most similar start and end, zero crossings, equal-power seam ---------- */
async function loopMaker(src, an, opt) {
  const sr = src.sampleRate, F = an.F, n = F.nF, dt = F.dt, B = WL.NMEL, ch = chansOf(src), len = ch[0].length;
  const R = an.R, D = 20;
  const feat = new Float32Array(n * (D + 1));
  for (let m = 0; m < n; m++) {
    for (let d = 0; d < D; d++) feat[m * (D + 1) + d] = 0.5 * (F.melDb[m * B + 2 * d] + F.melDb[m * B + 2 * d + 1]);
    feat[m * (D + 1) + D] = 3 * 10 * Math.log10(F.kz[m] + 1e-12);
  }
  const ctx = Math.max(2, Math.round(0.06 / dt)), minLen = opt.minLen * F.dur;
  const s0 = an.X ? an.X.sound[0] : 0, s1 = an.X ? an.X.sound[1] : F.dur;
  let candA = [], candB = [], aligned = false;
  if (R && R.reliable && R.downTimes.length >= 4) { candA = R.downTimes.filter(t => t < F.dur * 0.4); candB = R.downTimes.filter(t => t > F.dur * 0.4); aligned = candA.length > 0 && candB.length > 0; }
  if (!aligned) {
    const step = Math.max(1, Math.round(0.01 / dt));
    for (let m = Math.round(Math.max(s0 + 0.05, opt.xfadeMs / 1000 + ctx * dt) / dt); m < n * 0.35; m += step) candA.push(m * dt);
    for (let m = Math.round(n * 0.5); m < Math.min(n - ctx, Math.round(s1 / dt)); m += step) candB.push(m * dt);
  }
  let best = null;
  for (const ta of candA) for (const tb of candB) {
    if (tb - ta < minLen) continue;
    const ma = Math.round(ta / dt), mb = Math.round(tb / dt);
    let s = 0, c = 0;
    for (let k = -ctx; k <= ctx; k++) {
      const a = ma + k, b = mb + k; if (a < 0 || b < 0 || a >= n || b >= n) continue;
      for (let d = 0; d <= D; d++) { const v = feat[a * (D + 1) + d] - feat[b * (D + 1) + d]; s += v * v; } c++;
    }
    const score = c ? s / c : Infinity;
    if (!best || score < best.score) best = { score, ta, tb };
  }
  if (!best) return { outputs: [], report: ["File too short for the requested loop length"] };
  // refine to rising zero crossings within ±4 ms
  const mono = i => { let v = 0; for (const c of ch) v += c[i]; return v / ch.length; };
  const zc = t => { const c = Math.round(t * sr), r = Math.round(0.004 * sr); let bi = c, bd = Infinity; for (let i = Math.max(1, c - r); i < Math.min(len - 1, c + r); i++) if (mono(i - 1) <= 0 && mono(i) > 0) { const dd = Math.abs(i - c); if (dd < bd) { bd = dd; bi = i; } } return bi; };
  let a = zc(best.ta), b = zc(best.tb);
  let xf = Math.min(Math.round(opt.xfadeMs / 1000 * sr), a, Math.floor((b - a) / 3));
  const L = b - a, out = ch.map(() => new Float32Array(L));
  ch.forEach((c, ci) => {
    const o = out[ci];
    for (let i = 0; i < L; i++) o[i] = c[a + i];
    for (let i = 0; i < xf; i++) { const u = (i + 0.5) / xf, j = L - xf + i; o[j] = c[a + j] * Math.cos(u * Math.PI / 2) + c[a - xf + i] * Math.sin(u * Math.PI / 2); }
  });
  const rep = ["Loop " + (a / sr).toFixed(3) + "–" + (b / sr).toFixed(3) + " s (" + (L / sr).toFixed(2) + " s)" + (aligned ? ", on downbeats" : ""), "Equal-power seam over " + (xf / sr * 1000).toFixed(0) + " ms", "Similarity distance " + best.score.toFixed(1)];
  return { outputs: [{ suffix: "loop", buf: mkBuf(sr, out) }], report: rep };
}

/* ---------- 7. Variations: layer balance, grain order and pitch, for repeated game sounds ---------- */
function resample(ch, ratio) {
  const n = Math.max(2, Math.floor(ch.length / ratio)), o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), t = x - j;
    const p0 = ch[Math.max(0, j - 1)], p1 = ch[j] || 0, p2 = ch[Math.min(ch.length - 1, j + 1)] || 0, p3 = ch[Math.min(ch.length - 1, j + 2)] || 0;
    o[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return o;
}
function shuffleGrains(chans, sr, ev, r) {
  const marks = ev.grains.map(t => Math.round(t * sr)).concat([Math.round(ev.tEnd * sr)]);
  const segs = [];
  for (let i = 0; i + 1 < marks.length; i++) if (marks[i + 1] - marks[i] > 64) segs.push([marks[i], marks[i + 1]]);
  if (segs.length < 3) return false;
  const order = segs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const xf = Math.round(0.005 * sr);
  for (const c of chans) {
    const src = c.slice(), start = segs[0][0];
    let pos = start;
    for (const oi of order) {
      const [a, b] = segs[oi];
      for (let i = 0; i < b - a; i++) {
        const v = src[a + i], k = pos + i; if (k >= c.length) break;
        if (i < xf && pos > start) { const u = i / xf; c[k] = c[k] * (1 - u) + v * u; } else c[k] = v;
      }
      pos += b - a;
    }
  }
  return true;
}
async function variations(src, an, opt, onProgress) {
  const sr = src.sampleRate, N = frameN(sr, src.duration), outputs = [], report = [];
  const X = an.X;
  for (let v = 1; v <= opt.count; v++) {
    const r = rng(1000 + v * 7919);
    const gains = X && X.layers ? X.layers.map(() => (r() * 2 - 1) * opt.layerDb) : [];
    let ch = gains.length ? await stftApply(chansOf(src), sr, N, layerMasker(an, sr, N, gains)) : chansOf(src);
    let shuffled = 0;
    if (opt.grains && X) for (const ev of X.events) if (ev.facture === "iterative" && ev.grains.length >= 3 && shuffleGrains(ch, sr, ev, r)) shuffled++;
    const semis = (r() * 2 - 1) * opt.pitch;
    if (Math.abs(semis) > 0.01) ch = ch.map(c => resample(c, Math.pow(2, semis / 12)));
    finish(src, ch, "none", []);
    outputs.push({ suffix: "var" + v, buf: mkBuf(sr, ch) });
    report.push("Variation " + v + ": pitch " + (semis >= 0 ? "+" : "") + semis.toFixed(2) + " st" + (gains.length ? ", layers " + gains.map(g => (g >= 0 ? "+" : "") + g.toFixed(1)).join("/") + " dB" : "") + (shuffled ? ", grains reordered in " + shuffled + " event" + (shuffled > 1 ? "s" : "") : ""));
    if (onProgress) onProgress(v / opt.count);
    await tick();
  }
  return { outputs, report };
}

/* ---------- WAV encoder (16-bit PCM or 32-bit float) ---------- */
function encodeWav(buf, float32) {
  const nCh = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bps = float32 ? 4 : 2;
  const dataLen = n * nCh * bps, ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, float32 ? 3 : 1, true); v.setUint16(22, nCh, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * bps, true);
  v.setUint16(32, nCh * bps, true); v.setUint16(34, bps * 8, true); str(36, "data"); v.setUint32(40, dataLen, true);
  const chs = []; for (let c = 0; c < nCh; c++) chs.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) {
    const s = chs[c][i];
    if (float32) v.setFloat32(o, s, true); else v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
    o += bps;
  }
  return ab;
}

const TOOLS = [
  { id: "cleanup", name: "Clean up for export", kind: "Game audio",
    desc: "Fixes what the asset checks find: removes DC offset, rebuilds clipped peaks, trims silence, adds fades where the file clicks or the tail was cut, folds identical channels to mono, and normalises the peak.",
    params: [{ id: "peakDb", label: "Peak", min: -12, max: 0, step: 0.5, value: -1, unit: "dBFS" }, { id: "mono", label: "Fold identical channels to mono", type: "bool", value: true }],
    run: cleanup },
  { id: "deharsh", name: "De-harsh", kind: "Mixing",
    desc: "Suppresses narrow resonances between 0.8 and 10 kHz and tilts down the top end while the harshness model (sharpness, roughness and fluctuation in Zwicker's annoyance form) is high. \"Harshest moments\" acts on the top of this file's own harshness range, so it works on mixes; \"Only harsh sounds\" uses the absolute scale, where most music never qualifies; \"Always\" ignores the model. The detector can be switched to the level in the same frequency range, which makes it a conventional dynamic EQ, for comparison. The second result is what was removed, raised for listening.",
    params: [{ id: "mode", label: "Act on", type: "select", value: "relative", options: [["relative", "Harshest moments of this file"], ["absolute", "Only harsh sounds (absolute)"], ["always", "Always"]] },
      { id: "sidechain", label: "Detector", type: "select", value: "harshness", options: [["harshness", "Harshness model"], ["level", "Band level (conventional dynamic EQ)"]] },
      { id: "amount", label: "Amount", min: 0, max: 1, step: 0.05, value: 0.6 }, { id: "threshold", label: "Absolute threshold", min: 0, max: 1.5, step: 0.05, value: 0.15, unit: "harshness" }, { id: "maxCut", label: "Deepest cut", min: 3, max: 18, step: 1, value: 9, unit: "dB" }, { id: "match", label: "Match loudness", type: "bool", value: true }, { id: "delta", label: "Also render what was removed", type: "bool", value: true }],
    run: deharsh },
  { id: "layers", name: "Layer remix", kind: "Sound design",
    desc: "Rebalances the layers found by NMF (row X2) with soft Wiener masks: lift the casing ring, drop the sub, and so on.",
    params: "layers", run: layerMix },
  { id: "hpss", name: "Attack and body", kind: "Sound design",
    desc: "Splits each moment into percussive and sustained energy with median filtering (Fitzgerald 2010) and sets their levels separately: a transient shaper that follows content, not the envelope.",
    params: [{ id: "attackDb", label: "Attack", min: -18, max: 12, step: 1, value: 4, unit: "dB" }, { id: "bodyDb", label: "Body", min: -18, max: 12, step: 1, value: -3, unit: "dB" }, { id: "match", label: "Match loudness", type: "bool", value: true }],
    run: hpss },
  { id: "tension", name: "Tension shaper", kind: "Mastering",
    desc: "Turns the tension curve (C5) into gain and brightness automation. Positive contrast makes build-ups rise and releases fall further; negative contrast flattens them.",
    params: [{ id: "contrast", label: "Contrast", min: -1, max: 1, step: 0.05, value: 0.5 }, { id: "bright", label: "Brightness follow", min: -1, max: 1, step: 0.05, value: 0.4 }],
    needs: "tension", run: tensionShape },
  { id: "loop", name: "Loop maker", kind: "Game audio",
    desc: "Finds the start and end points whose surroundings match best (on downbeats when the beat is clear), moves them to zero crossings and renders an equal-power seam, so the result wraps without a click.",
    params: [{ id: "xfadeMs", label: "Seam", min: 10, max: 400, step: 10, value: 120, unit: "ms" }, { id: "minLen", label: "Minimum length", min: 0.2, max: 0.9, step: 0.05, value: 0.5, unit: "of file" }],
    run: loopMaker },
  { id: "vars", name: "Variations", kind: "Game audio",
    desc: "Makes copies that differ the way repeated game sounds should: random layer balance, reordered grains inside iterative events, and a small pitch change.",
    params: [{ id: "count", label: "Copies", min: 2, max: 6, step: 1, value: 4 }, { id: "layerDb", label: "Layer spread", min: 0, max: 6, step: 0.5, value: 3, unit: "dB" }, { id: "pitch", label: "Pitch spread", min: 0, max: 3, step: 0.1, value: 1, unit: "st" }, { id: "grains", label: "Reorder grains", type: "bool", value: true }],
    run: variations }
];

/* ---------- comparison with a static EQ ----------
   How much of a tool's spectrogram change could the single best fixed EQ reproduce? The EQ is the per-bin gain that
   matches the output's long-term spectrum; "notEq" is the power-weighted mean |dB| difference left after applying it. */
const rnd = (v, d) => (typeof v === "number" && isFinite(v)) ? Number(v.toFixed(d)) : null;
const dbv = v => 20 * Math.log10(Math.max(1e-12, v));
async function eqExplained(dry, wet, sr) {
  const N = 2048, A = await stftMagnitudes(dry, sr, N), B = await stftMagnitudes(wet, sr, N);
  const K = A.bins, T = Math.min(A.nF, B.nF), pa = new Float64Array(K), pb = new Float64Array(K);
  let mx = 0;
  for (let f = 0; f < T; f++) for (let k = 0; k < K; k++) { const x = A.M[f * K + k], y = B.M[f * K + k]; pa[k] += x * x; pb[k] += y * y; if (x > mx) mx = x; if (y > mx) mx = y; }
  const G = new Float64Array(K); for (let k = 0; k < K; k++) G[k] = pa[k] > 0 ? Math.sqrt(pb[k] / pa[k]) : 1;
  let st = 0, sr2 = 0, w = 0; const floor = mx * 1e-3;
  for (let f = 0; f < T; f++) for (let k = 1; k < K; k++) {
    const x = A.M[f * K + k], y = B.M[f * K + k]; if (x < floor && y < floor) continue;
    const ww = Math.max(x, y) ** 2, dt = Math.abs(dbv(y + 1e-9) - dbv(x + 1e-9)), de = Math.abs(dbv(y + 1e-9) - dbv(x * G[k] + 1e-9));
    st += dt * ww; sr2 += de * ww; w += ww;
  }
  // the static EQ in third-octave bands (what a fixed EQ would have to do)
  const bands = []; for (let fc = 31.5; fc < sr / 2 * 0.9; fc *= Math.pow(2, 1 / 3)) {
    const lo = Math.ceil(fc * Math.pow(2, -1 / 6) * N / sr), hi = Math.floor(fc * Math.pow(2, 1 / 6) * N / sr); let a = 0, b = 0;
    for (let k = Math.max(1, lo); k <= Math.min(K - 1, hi); k++) { a += pa[k]; b += pb[k]; }
    if (a > 0) bands.push([Math.round(fc), rnd(10 * Math.log10(b / a), 1)]);
  }
  const change = st / w, resid = sr2 / w;
  // Two time-varying EQs on top of the static one, both fitted to this very output (upper bounds, so they flatter the EQ):
  //   dynamic    each third-octave band's gain is any function of that band's own input level (2 dB steps), with
  //              instant attack and release: the best a conventional dynamic EQ or multiband compressor could do
  //   automation each band's gain may follow any curve at 0.1 s resolution: the best an engineer automating
  //              a 30-band EQ could do
  const nb = Math.max(1, Math.round(3 * Math.log2(sr / 2 * 0.9 / 31.5))), band = new Int16Array(K);
  for (let k = 0; k < K; k++) band[k] = Math.max(0, Math.min(nb - 1, Math.round(3 * Math.log2(Math.max(1, k * sr / N) / 31.5))));
  const Eg = new Float64Array(T * nb), Ew = new Float64Array(T * nb), Ed = new Float64Array(T * nb);
  for (let f = 0; f < T; f++) for (let k = 1; k < K; k++) { const x = A.M[f * K + k], y = B.M[f * K + k], i = f * nb + band[k]; Eg[i] += (x * G[k]) ** 2; Ew[i] += y * y; Ed[i] += x * x; }
  const eFloor = (floor * floor) * 4, tgt = new Float64Array(T * nb), wt = new Float64Array(T * nb);
  for (let i = 0; i < T * nb; i++) { const m = Math.max(Eg[i], Ew[i]); if (m > eFloor) { tgt[i] = 10 * Math.log10((Ew[i] + 1e-20) / (Eg[i] + 1e-20)); wt[i] = m; } }
  const dyn = new Float64Array(T * nb), aut = new Float64Array(T * nb);
  for (let b = 0; b < nb; b++) {
    let top = -Infinity; for (let f = 0; f < T; f++) if (wt[f * nb + b] > 0) top = Math.max(top, 10 * Math.log10(Ed[f * nb + b] + 1e-20));
    if (!isFinite(top)) continue;
    const sum = new Float64Array(52), sw = new Float64Array(52), bin = new Int16Array(T);
    for (let f = 0; f < T; f++) { const i = f * nb + b; bin[f] = Math.min(51, Math.floor(Math.max(0, top - 10 * Math.log10(Ed[i] + 1e-20)) / 2)); if (wt[i] > 0) { sum[bin[f]] += tgt[i] * wt[i]; sw[bin[f]] += wt[i]; } }
    for (let f = 0; f < T; f++) dyn[f * nb + b] = sw[bin[f]] > 0 ? sum[bin[f]] / sw[bin[f]] : 0;
    const hw = Math.max(1, Math.round(0.05 * sr / A.H));
    for (let f = 0; f < T; f++) { let s = 0, q = 0; for (let j = Math.max(0, f - hw); j <= Math.min(T - 1, f + hw); j++) { const i = j * nb + b; s += tgt[i] * wt[i]; q += wt[i]; } aut[f * nb + b] = q > 0 ? s / q : 0; }
  }
  let rd = 0, ra = 0;
  for (let f = 0; f < T; f++) for (let k = 1; k < K; k++) {
    const x = A.M[f * K + k], y = B.M[f * K + k]; if (x < floor && y < floor) continue;
    const ww = Math.max(x, y) ** 2, i = f * nb + band[k], yd = dbv(y + 1e-9);
    rd += Math.abs(yd - dbv(x * G[k] * Math.pow(10, dyn[i] / 20) + 1e-9)) * ww; ra += Math.abs(yd - dbv(x * G[k] * Math.pow(10, aut[i] / 20) + 1e-9)) * ww;
  }
  const share = r => rnd(change > 0.05 ? Math.max(0, 1 - r / change) : NaN, 2);
  return { change: rnd(change, 2), notEq: rnd(resid, 2), eqShare: share(resid), dynShare: share(rd / w), autoShare: share(ra / w), eqBands: bands };
}

/* ---------- store-only ZIP (for hosts that accept .zip but not .wav downloads) ---------- */
let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), name, data); cd.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = cd.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = parts.concat(cd, [new Uint8Array(end.buffer)]), out = new Uint8Array(off + cdSize + 22);
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const api = { TOOLS, eqExplained, encodeWav, zipStore, crc32, mkBuf, chansOf, resample, lufsOf, stftApply, stftMagnitudes, _stftMag: stftMagnitudes, cleanup, deharsh, layerMix, hpss, tensionShape, loopMaker, variations };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.WLFX = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
