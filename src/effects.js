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
// integrated loudness, ITU-R BS.1770-5 (400 ms blocks, 75% overlap, -70 LUFS absolute and -10 LU relative gates;
// test/run-tests.js checks the K-weighting, calibration and gating against the Recommendation)
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


/* ---------- 8. Event-masked tools: processing that follows the sound's events ----------
   An EQ, dynamic or not, can only turn existing frequencies up or down. These three do what it cannot: add a reverb
   tail that starts after each hit's peak (new energy, smeared in time), saturate only the hits (new harmonics), and
   change how long each event rings (its decay, relative to its own peak). The events come from the sound-object
   analysis (start, peak, end of decay). */
function eventsOf(an, sr, n) {
  const ev = (an.X && an.X.events) || [];
  return ev.map(e => ({ a: Math.max(0, Math.round(e.t0 * sr)), p: Math.max(0, Math.round(e.peakT * sr)), e: Math.min(n, Math.round(Math.max(e.tEnd || e.t1, e.t1) * sr)) }))
    .filter(e => e.e > e.a).sort((x, y) => x.a - y.a);
}
// a 0..1 mask with linear ramps of r samples; spans: [[start, end], ...]
function spanMask(n, spans, r) {
  const m = new Float32Array(n);
  for (const [a, b] of spans) {
    const s0 = Math.max(0, a), s1 = Math.min(n, b); if (s1 <= s0) continue;
    for (let i = Math.max(0, s0 - r); i < Math.min(n, s1 + r); i++) { const u = i < s0 ? 1 - (s0 - i) / r : i >= s1 ? 1 - (i - s1 + 1) / r : 1; if (u > m[i]) m[i] = u; }
  }
  return m;
}
// stereo-friendly reverb: four damped combs and two all-passes per channel (Schroeder), comb lengths offset per channel
function reverb(x, sr, t60, toneHz, chan) {
  const base = [1557, 1617, 1491, 1422].map(l => Math.round((l + chan * 23) * sr / 44100)), ap = [225, 556].map(l => Math.round((l + chan * 17) * sr / 44100));
  const n = x.length, y = new Float32Array(n), damp = Math.exp(-2 * Math.PI * toneHz / sr);
  for (const L of base) {
    const g = Math.pow(10, -3 * L / (t60 * sr)), buf = new Float32Array(L); let idx = 0, lp = 0;
    for (let i = 0; i < n; i++) { const out = buf[idx]; lp = out * (1 - damp) + lp * damp; buf[idx] = x[i] + lp * g; idx = idx + 1 === L ? 0 : idx + 1; y[i] += out / base.length; }
  }
  for (const L of ap) {
    const buf = new Float32Array(L); let idx = 0;
    for (let i = 0; i < n; i++) { const b = buf[idx], v = y[i] + 0.5 * b; buf[idx] = v; y[i] = b - 0.5 * v; idx = idx + 1 === L ? 0 : idx + 1; }
  }
  return y;
}
async function tailVerb(src, an, opt) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length, ev = eventsOf(an, sr, n);
  if (!ev.length) return { outputs: [{ suffix: "tailverb", buf: mkBuf(sr, ch) }], report: ["No events found: nothing was sent to the reverb"] };
  const hold = Math.round(opt.holdMs / 1000 * sr), r = Math.round(0.02 * sr);
  // send: each event from its peak (plus the hold) to the end of its decay; duck: the wet signal leaves each attack dry
  const send = spanMask(n, ev.map(e => [e.p + hold, e.e]), r), duck = opt.dryAttacks ? spanMask(n, ev.map(e => [e.a, e.p + Math.round(0.01 * sr)]), Math.round(0.005 * sr)) : null;
  const wetG = undb(opt.wetDb), tail = Math.round(Math.min(6, opt.t60) * sr * 0.6), len = n + tail;
  const outs = ch.map((x, c) => {
    const xin = new Float32Array(len); for (let i = 0; i < n; i++) xin[i] = x[i] * send[i];
    const w = reverb(xin, sr, opt.t60, opt.toneHz, c), o = new Float32Array(len);
    for (let i = 0; i < len; i++) o[i] = (i < n ? x[i] : 0) + w[i] * wetG * (duck && i < n ? 1 - duck[i] : 1);
    return o;
  });
  // fade the added tail out over its last 30%, so the file ends cleanly
  const f0 = n + Math.round(tail * 0.7); for (const o of outs) for (let i = f0; i < len; i++) o[i] *= 1 - (i - f0) / (len - f0);
  let on = 0; for (let i = 0; i < n; i++) on += send[i] > 0.5 ? 1 : 0;
  const report = ["Reverb sent from " + ev.length + " event tail" + (ev.length === 1 ? "" : "s") + ", " + Math.round(100 * on / n) + "% of the time" + (opt.dryAttacks ? "; attacks kept dry" : ""), "Decay " + opt.t60 + " s, " + (len - n > 0 ? (tail / sr).toFixed(1) + " s added at the end" : "")];
  finish(src, outs, "peak", report);
  return { outputs: [{ suffix: "tailverb", buf: mkBuf(sr, outs) }], report };
}
async function driveHits(src, an, opt) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length, ev = eventsOf(an, sr, n);
  if (!ev.length) return { outputs: [{ suffix: "drive", buf: mkBuf(sr, ch) }], report: ["No events found: nothing was driven"] };
  const at = Math.round(0.03 * sr), spans = ev.map(e => opt.where === "attack" ? [e.a, e.p + at] : opt.where === "body" ? [e.p + at, e.e] : [e.a, e.e]);
  const m = spanMask(n, spans, Math.round(0.005 * sr)), k = undb(opt.driveDb), mix = opt.mix / 100, pk = Math.max(1e-6, peakOf(ch));
  // the saturated signal is brought back to the dry signal's level every few milliseconds, so what changes is the
  // waveform's shape (new harmonics), not its loudness contour (which a dynamic EQ or a compressor could copy)
  const W = Math.max(16, Math.round(0.004 * sr));
  const outs = ch.map(x => {
    const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = Math.tanh(k * x[i] / pk) * pk;
    const cx = new Float64Array(n + 1), cd = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cx[i + 1] = cx[i] + x[i] * x[i]; cd[i + 1] = cd[i] + d[i] * d[i]; }
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - W), b = Math.min(n, i + W), ex = cx[b] - cx[a], ed = cd[b] - cd[a], g = ed > 1e-20 ? Math.sqrt(ex / ed) : 0, w = mix * m[i];
      o[i] = x[i] * (1 - w) + d[i] * g * w;
    }
    return o;
  });
  let on = 0; for (let i = 0; i < n; i++) on += m[i] > 0.5 ? 1 : 0;
  const report = ["Saturated the " + (opt.where === "attack" ? "attacks" : opt.where === "body" ? "bodies" : "whole events") + " of " + ev.length + " event" + (ev.length === 1 ? "" : "s") + " (" + Math.round(100 * on / n) + "% of the time)", "Drive +" + opt.driveDb + " dB, mix " + opt.mix + "%"];
  finish(src, outs, opt.match ? "loudness" : "peak", report);
  return { outputs: [{ suffix: "drive", buf: mkBuf(sr, outs) }], report };
}
async function ringTime(src, an, opt, onProgress) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length, ev = eventsOf(an, sr, n);
  if (!ev.length) return { outputs: [{ suffix: "ring", buf: mkBuf(sr, ch) }], report: ["No events found: nothing was changed"] };
  const N = frameN(sr, src.duration), { M, nF, bins, H } = await stftMagnitudes(ch, sr, N), binHz = sr / N, fr = t => Math.round(t / H);
  // each event's decay: from its peak to the next event's start (or the end of the file); the reference is the
  // loudest frame of each bin around the peak, and every later frame is raised or lowered so the decay stretches
  const ref = new Float32Array(nF * bins).fill(0), owner = new Int32Array(nF).fill(-1);
  ev.forEach((e, i) => {
    const p0 = Math.max(0, fr(e.p) - 1), p1 = Math.min(nF, fr(e.p) + 3), end = Math.min(nF, i + 1 < ev.length ? fr(ev[i + 1].a) : nF);
    const r = new Float32Array(bins); for (let f = p0; f < p1; f++) for (let k = 0; k < bins; k++) r[k] = Math.max(r[k], M[f * bins + k]);
    for (let f = fr(e.p) + 1; f < end; f++) { owner[f] = i; ref.set(r, f * bins); }
  });
  const maxUp = undb(opt.maxBoostDb), floor = undb(-70);
  let gSum = 0, gN = 0;
  const outs = await stftApply(ch, sr, N, (f, t, mag, g) => {
    if (f >= nF || owner[f] < 0) return;
    for (let k = 0; k < bins; k++) {
      const R = ref[f * bins + k], m = M[f * bins + k]; if (R <= 0 || m <= R * floor) continue;
      const ratio = opt.ratio * Math.pow(Math.max(50, k * binHz) / 1000, opt.tilt), e = 1 / ratio - 1;
      const u = Math.min(1, m / R), v = Math.min(maxUp, Math.max(1 / maxUp, Math.pow(u, e)));
      g[k] = v; gSum += Math.log10(v) * 20; gN++;
    }
  }, onProgress);
  const report = ["Decay of " + ev.length + " event" + (ev.length === 1 ? "" : "s") + " ×" + opt.ratio + (opt.tilt ? ", high partials ×" + rnd(opt.ratio * Math.pow(8, opt.tilt), 2) + " at 8 kHz" : "") + (opt.ratio > 1 ? " (rings longer)" : opt.ratio < 1 ? " (damped)" : ""), "Average change in the tails " + (gN ? (gSum / gN >= 0 ? "+" : "") + (gSum / gN).toFixed(1) : "0") + " dB"];
  finish(src, outs, opt.match ? "peak" : "none", report);
  return { outputs: [{ suffix: "ring", buf: mkBuf(sr, outs) }], report };
}

/* ---------- 9. Level the events: compression that leaves every event's shape alone ----------
   A compressor turns the gain down while a hit is loud and up again after it, so it flattens attacks and the
   background pumps. This evens out the events instead: each event's loudness (K-weighted, its first 200 ms, about the
   ear's integration time for short sounds) is moved part of the way to the median event, by one gain for the whole
   event, from 20 ms before its start to the end of its decay; between events the gain returns to 0 dB, so the
   background neither pumps nor jumps. Nothing inside an event changes shape. */
function eventLoudness(zs, a, b) {
  let s = 0; for (const z of zs) for (let i = a; i < b; i++) s += z[i] * z[i];
  return -0.691 + 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
}
function kWeighted(chans, sr) {
  const kc = WL.kFilterCoeffs(sr);
  return chans.map(c => { const a = new Float32Array(c.length), b = new Float32Array(c.length); WL.biquadInto(c, a, kc[0]); WL.biquadInto(a, b, kc[1]); return b; });
}
// the gain per sample (dB) that levels the events; exported for the comparison in experiments/compression
function eventLevelGain(chans, sr, ev, opt) {
  const n = chans[0].length, zs = kWeighted(chans, sr), win = Math.round(0.2 * sr);
  const L = ev.map((e, i) => eventLoudness(zs, e.a, Math.min(n, e.a + win, i + 1 < ev.length ? Math.max(e.a + 1, ev[i + 1].a) : n)));
  const sorted = L.slice().sort((x, y) => x - y), target = opt.target === "loudest" ? sorted[sorted.length - 1] : opt.target === "quietest" ? sorted[0] : sorted[sorted.length >> 1];
  const k = Math.max(0, Math.min(1, opt.amount / 100)), lim = opt.maxDb;
  const g = L.map(l => Math.max(-lim, Math.min(lim, (target - l) * k)));
  // each event's gain holds from 20 ms before its start until its decay sinks to 6 dB over the background (or 40 dB
  // under its peak); then the gain glides back to 0 dB over 60 ms, so the background between events keeps its level
  // instead of jumping with every event
  const hop = Math.max(1, Math.round(0.005 * sr)), nE = Math.ceil(n / hop), env = new Float32Array(nE);
  for (let h = 0; h < nE; h++) { let e = 0; for (const z of zs) for (let i = h * hop; i < Math.min(n, (h + 1) * hop); i++) e += z[i] * z[i]; env[h] = 10 * Math.log10(e / (hop * zs.length) + 1e-20); }
  const bed = Array.from(env).sort((x, y) => x - y)[Math.floor(0.1 * (nE - 1))];
  const gdb = new Float32Array(n), pre = Math.round(0.02 * sr), back = Math.round(0.06 * sr);
  for (let i = 0; i < ev.length; i++) {
    const a = ev[i].a, next = i + 1 < ev.length ? ev[i + 1].a - pre : n;
    let hp = Math.floor(a / hop), top = -Infinity; for (let h = hp; h < Math.min(nE, hp + Math.round(0.2 * sr / hop)); h++) if (env[h] > top) { top = env[h]; hp = h; }
    let he = hp; while (he < nE - 1 && he * hop < next && env[he] > Math.max(top - 40, bed + 6)) he++;
    const hold = Math.min(next, Math.max(a, he * hop));
    const from = i === 0 ? 0 : gdb[Math.max(0, a - pre - 1)];
    for (let j = Math.max(0, a - pre); j < a && j < n; j++) gdb[j] = from + (g[i] - from) * (j - (a - pre)) / pre;
    for (let j = Math.max(0, a); j < Math.min(n, hold); j++) gdb[j] = g[i];
    for (let j = hold; j < Math.min(n, next); j++) gdb[j] = g[i] * Math.max(0, 1 - (j - hold) / back);
  }
  return { gdb, levels: L, gains: g, target };
}
async function levelEvents(src, an, opt) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length, ev = eventsOf(an, sr, n);
  if (ev.length < 2) return { outputs: [{ suffix: "level", buf: mkBuf(sr, ch) }], report: ["Fewer than two events: nothing to even out"] };
  const { gdb, levels, gains } = eventLevelGain(ch, sr, ev, opt);
  const outs = ch.map(x => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = x[i] * undb(gdb[i]); return o; });
  const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };
  const after = levels.map((l, i) => l + gains[i]);
  const report = ["Evened out " + ev.length + " events: their loudness spread " + sd(levels).toFixed(1) + " → " + sd(after).toFixed(1) + " dB (standard deviation)",
    "Gains from " + Math.min(...gains).toFixed(1) + " to +" + Math.max(...gains).toFixed(1) + " dB, each held for a whole event, so attacks and decays keep their shape"];
  finish(src, outs, opt.match ? "loudness" : "none", report);
  return { outputs: [{ suffix: "level", buf: mkBuf(sr, outs) }], report };
}

/* ---------- stereo and mono: fold with the phase lined up, widen around the attacks ---------- */
// STFT of two channels into one: frameFn(f, centreSample, Lre, Lim, Rre, Rim, Yre, Yim) writes bins 0..N/2 of the
// output spectrum. Hann analysis and synthesis, hop N/4, WOLA normalisation (as stftApply).
async function stftPair(L, R, N, frameFn, onProgress) {
  const H = N >> 2, half = N >> 1, fft = WL.getFFT(N), w = WL.hannP(N), len = L.length, pad = N;
  const out = new Float64Array(len + 2 * pad), norm = new Float64Array(len + 2 * pad);
  const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N), yr = new Float64Array(N), yi = new Float64Array(N);
  const nF = Math.ceil((len + N) / H);
  for (let f = 0; f < nF; f++) {
    const start = f * H - half;
    for (let i = 0; i < N; i++) { const s = start + i, ok = s >= 0 && s < len; lr[i] = ok ? L[s] * w[i] : 0; rr[i] = ok ? R[s] * w[i] : 0; li[i] = 0; ri[i] = 0; }
    fft(lr, li); fft(rr, ri);
    yr.fill(0); yi.fill(0);
    frameFn(f, start + half, lr, li, rr, ri, yr, yi);
    yi[0] = 0; yi[half] = 0;
    for (let k = 1; k < half; k++) { yr[N - k] = yr[k]; yi[N - k] = -yi[k]; }
    for (let i = 0; i < N; i++) yi[i] = -yi[i];
    fft(yr, yi);
    for (let i = 0; i < N; i++) { out[start + i + pad] += (yr[i] / N) * w[i]; norm[start + i + pad] += w[i] * w[i]; }
    if ((f & 127) === 127) { if (onProgress) onProgress(f / nF); await tick(); }
  }
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) { const nv = norm[i + pad]; y[i] = nv > 1e-6 ? out[i + pad] / nv : 0; }
  return y;
}
const FOLD_BANDS = [[0, 200, "below 200 Hz"], [200, 800, "200–800 Hz"], [800, 3000, "0.8–3 kHz"], [3000, 8000, "3–8 kHz"], [8000, 1e9, "above 8 kHz"]];
// Fold to mono. A plain sum (L+R)/2 cancels where the channels are out of phase (spaced microphones, wide synths,
// phase-flipped layers) and drops uncorrelated content by 3 dB. Here, per frequency bin, the right channel is turned
// to the left channel's phase (the cross-spectrum smoothed over 40 ms gives the angle) before summing, and the sum is
// brought back to the channels' mean energy (at most maxBoostDb). Per-bin changes smear across an STFT frame, which
// would put a faint pre-echo before each hit; so each attack the analysis finds is folded in the time domain instead,
// with that attack's own delay and polarity between the channels (cross-correlation within ±3 ms), and cross-faded in.
async function foldMono(src, an, opt, onProgress) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length;
  if (ch.length < 2) return { outputs: [{ suffix: "mono", buf: mkBuf(sr, [ch[0]]) }], report: ["Already mono: nothing to fold"] };
  const L = ch[0], R = ch[1];
  let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(L[i] - R[i]));
  if (diff < 1e-6) return { outputs: [{ suffix: "mono", buf: mkBuf(sr, [Float32Array.from(L)]) }], report: ["The channels are identical: the mono file is one of them, unchanged"] };
  let sl = 0, sr2 = 0, slr = 0; for (let i = 0; i < n; i++) { sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
  const corr = slr / Math.sqrt(sl * sr2 + 1e-30);
  const ev = eventsOf(an, sr, n), N = sr > 60000 ? 2048 : 1024, H = N >> 2, half = N >> 1, maxG = undb(opt.maxBoostDb), a = Math.exp(-H / (0.04 * sr));
  const Cr = new Float64Array(half + 1), Ci = new Float64Array(half + 1), Sll = new Float64Array(half + 1), Srr = new Float64Array(half + 1), Smm = new Float64Array(half + 1);
  const band = Int8Array.from({ length: half + 1 }, (_, k) => FOLD_BANDS.findIndex(b => k * sr / N >= b[0] && k * sr / N < b[1]));
  // energy bookkeeping for the report, per band: the channels' mean energy (target), the plain sum, this fold; also per event
  const nb = FOLD_BANDS.length, tgt = new Float64Array(nb), pln = new Float64Array(nb);
  const evT = ev.map(() => new Float64Array(nb)), evP = ev.map(() => new Float64Array(nb));
  let capped = 0, bins = 0, ei = 0;
  const y = await stftPair(L, R, N, (f, c, lr, li, rr, ri, yr, yi) => {
    while (ei < ev.length && ev[ei].e < c) ei++;
    const inEv = ei < ev.length && ev[ei].a <= c ? ei : -1;
    for (let k = 0; k <= half; k++) {
      const xr = lr[k], xi = li[k], zr = rr[k], zi = ri[k];
      Cr[k] = a * Cr[k] + (1 - a) * (xr * zr + xi * zi); Ci[k] = a * Ci[k] + (1 - a) * (xi * zr - xr * zi);
      Sll[k] = a * Sll[k] + (1 - a) * (xr * xr + xi * xi); Srr[k] = a * Srr[k] + (1 - a) * (zr * zr + zi * zi);
    }
    for (let k = 0; k <= half; k++) {
      let ur = 1, ui = 0;
      if (opt.align) {
        let cr = 0, ci = 0; for (let j = Math.max(0, k - 1); j <= Math.min(half, k + 1); j++) { cr += Cr[j]; ci += Ci[j]; }
        const m = Math.hypot(cr, ci); if (m > 1e-20) { ur = cr / m; ui = ci / m; }
      }
      const zr = rr[k] * ur - ri[k] * ui, zi = rr[k] * ui + ri[k] * ur, mr = 0.5 * (lr[k] + zr), mi = 0.5 * (li[k] + zi);
      Smm[k] = a * Smm[k] + (1 - a) * (mr * mr + mi * mi);
      let g = 1;
      if (opt.keepEnergy) { const t = 0.5 * (Sll[k] + Srr[k]); g = Smm[k] > 1e-24 ? Math.sqrt(t / Smm[k]) : 1; if (g > maxG) { g = maxG; capped++; } if (g < 1) g = 1; }
      bins++;
      yr[k] = mr * g; yi[k] = mi * g;
      const b = band[k], te = 0.5 * (lr[k] * lr[k] + li[k] * li[k] + rr[k] * rr[k] + ri[k] * ri[k]), pr = 0.5 * (lr[k] + rr[k]), pi = 0.5 * (li[k] + ri[k]), pe = pr * pr + pi * pi;
      tgt[b] += te; pln[b] += pe;
      if (inEv >= 0) { evT[inEv][b] += te; evP[inEv][b] += pe; }
    }
  }, onProgress);
  // the attacks, in the time domain: from 15 ms before each onset to 30 ms after its peak
  const spans = [];
  if (opt.align) for (const e of ev) {
    let top = 0; for (let i = e.a; i < e.e; i++) top = Math.max(top, Math.abs(L[i]), Math.abs(R[i]));
    let on = e.a; while (on < e.e && Math.abs(L[on]) < 0.01 * top && Math.abs(R[on]) < 0.01 * top) on++;
    const i0 = Math.max(0, on - Math.round(0.015 * sr)), i1 = Math.min(n, Math.max(e.p, on) + Math.round(0.03 * sr)), w0 = on, w1 = Math.min(n, on + Math.round(0.03 * sr)), ml = Math.round(0.003 * sr);
    let best = 0, lag = 0;
    for (let d = -ml; d <= ml; d++) { let c = 0; for (let i = w0; i < w1; i++) { const j = i + d; if (j >= 0 && j < n) c += L[i] * R[j]; } if (Math.abs(c) > Math.abs(best)) { best = c; lag = d; } }
    const sg = best < 0 ? -1 : 1, seg = new Float32Array(i1 - i0);
    let el = 0, er = 0, es = 0;
    for (let i = i0; i < i1; i++) { const j = i + lag, rv = j >= 0 && j < n ? sg * R[j] : 0, v = 0.5 * (L[i] + rv); seg[i - i0] = v; el += L[i] * L[i]; er += R[i] * R[i]; es += v * v; }
    const g = opt.keepEnergy && es > 0 ? Math.min(maxG, Math.max(1, Math.sqrt(0.5 * (el + er) / es))) : 1;
    for (let k = 0; k < seg.length; k++) seg[k] *= g;
    spans.push({ i0, i1, seg, lag, sg });
  }
  if (spans.length) {
    const r = Math.round(0.005 * sr), m = spanMask(n, spans.map(q => [q.i0 + r, q.i1 - r]), r);
    for (const q of spans) for (let i = q.i0; i < q.i1; i++) if (m[i] > 0) y[i] = (1 - m[i]) * y[i] + m[i] * q.seg[i - q.i0];
  }
  const plain = Float32Array.from(L, (v, i) => 0.5 * (v + R[i]));
  const dB = (a, b) => (b > 0 && a > 0 ? 10 * Math.log10(a / b) : 0), total = a => a.reduce((x, v) => x + v, 0);
  const lossAll = dB(total(pln), total(tgt)), worst = FOLD_BANDS.map((b, i) => [dB(pln[i], tgt[i]), b[2], tgt[i]]).filter(v => v[2] > 1e-3 * total(tgt)).sort((p, q) => p[0] - q[0])[0];
  // how close the result is to the channels' mean energy, measured on the result itself
  const bandE = async ch => { const { M, nF, bins } = await stftMagnitudes(ch, sr, N), E = new Float64Array(nb); for (let f = 0; f < nF; f++) for (let k = 0; k < bins; k++) E[band[k]] += M[f * bins + k] * M[f * bins + k]; return E; };
  const eL = await bandE([L]), eR = await bandE([R]), eY = await bandE([y]), tg2 = eL.map((v, i) => 0.5 * (v + eR[i]));
  const dev = FOLD_BANDS.map((b, i) => tg2[i] > 1e-3 * total(tg2) ? Math.abs(dB(eY[i], tg2[i])) : 0);
  const report = ["Channel correlation " + corr.toFixed(2) + " (1 = the same, 0 = unrelated, below 0 = opposite)",
    "A plain sum (L+R)/2 loses " + (-lossAll).toFixed(1) + " dB of the channels' energy" + (worst && worst[0] < -1 ? ", most at " + worst[1] + " (" + worst[0].toFixed(1) + " dB)" : "")];
  const evWorst = ev.map((e, i) => { let m = 0, bn = ""; FOLD_BANDS.forEach((b, j) => { if (evT[i][j] > 1e-3 * total(evT[i])) { const l = dB(evP[i][j], evT[i][j]); if (l < m) { m = l; bn = b[2]; } } }); return [m, i, bn]; })
    .filter(v => v[0] < -3).sort((p, q) => p[0] - q[0]).slice(0, 3);
  if (!evWorst.length && (!worst || worst[0] > -1)) report.push("Mono-compatible: a plain sum would do as well here");
  if (evWorst.length) report.push("Events that cancel most in a plain sum: " + evWorst.map(([m, i, bn]) => "at " + (ev[i].a / sr).toFixed(2) + " s " + m.toFixed(1) + " dB (" + bn + ")").join(", "));
  report.push((opt.align ? "Phase lined up" : "Phase left as it is") + (opt.keepEnergy ? ", energy kept: every band within " + Math.max(...dev).toFixed(1) + " dB of the channels' mean energy" : "") +
    (opt.keepEnergy && capped > 0.01 * bins ? " (the repair reached its " + opt.maxBoostDb + " dB limit in " + Math.round(100 * capped / bins) + "% of the bins)" : ""));
  if (spans.length) { const lags = spans.map(q => Math.abs(q.lag) / sr * 1000), flips = spans.filter(q => q.sg < 0).length;
    report.push(spans.length + " attack" + (spans.length === 1 ? "" : "s") + " folded in the time domain, each with its own delay between the channels (" + (Math.max(...lags) < 0.05 ? "none found" : "up to " + Math.max(...lags).toFixed(1) + " ms") + ")" + (flips ? ", " + flips + " with the polarity reversed" : "") + ": no pre-echo"); }
  report.push("The level per channel is kept. Loudness meters read the mono file 3 dB lower than the stereo one, because they add the channels (as they do for the plain sum)");
  const outs = [{ suffix: "mono", buf: mkBuf(sr, finish(src, [y], "none", report)) }];
  if (opt.plain) outs.push({ suffix: "plain-sum", buf: mkBuf(sr, finish(src, [plain], "none", [])) });
  return { outputs: outs, report };
}
// A velvet-noise decorrelator (Alary, Politis and Välimäki 2017): 30 ms of sparse ±1 taps with a decaying envelope,
// unit energy. Cheap, flat on average, and it smears little because the taps decay.
function velvet(x, sr, seed) {
  const R = rng(seed), Td = sr / 1500, Lm = Math.round(0.03 * sr), taps = [];
  for (let m = 0; m * Td < Lm; m++) { const d = Math.min(Lm - 1, Math.round(m * Td + R() * (Td - 1))); taps.push([d, (R() < 0.5 ? -1 : 1) * Math.exp(-3 * d / Lm)]); }
  const e = Math.sqrt(taps.reduce((s, t) => s + t[1] * t[1], 0)); for (const t of taps) t[1] /= e;
  const n = x.length, y = new Float32Array(n);
  for (const [d, g] of taps) for (let i = d; i < n; i++) y[i] += g * x[i - d];
  return y;
}
// Widen around the attacks. The mid (the sound itself, or (L+R)/2) stays as it is; a decorrelated copy of it is added
// to the side only where chosen: the tails and background (default), only the tails, or everywhere for comparison.
// Lows stay centred. Because only the side changes, (L+R)/2 gives the mid back exactly: the result folds to mono
// without any change, and a mono sound comes back unchanged.
async function widenTails(src, an, opt) {
  const sr = src.sampleRate, ch = chansOf(src), n = ch[0].length, stereo = ch.length > 1;
  const M = stereo ? Float32Array.from(ch[0], (v, i) => 0.5 * (v + ch[1][i])) : Float32Array.from(ch[0]);
  const S = stereo ? Float32Array.from(ch[0], (v, i) => 0.5 * (v - ch[1][i])) : new Float32Array(n);
  const ev = eventsOf(an, sr, n), hold = Math.round(opt.holdMs / 1000 * sr), r = Math.round(0.01 * sr), pre = Math.round(0.005 * sr);
  let mask;
  if (opt.where === "all" || (!ev.length && opt.where === "rest")) mask = new Float32Array(n).fill(1);
  else if (opt.where === "tails") mask = spanMask(n, ev.map(e => [e.p + hold, e.e]), r);
  else { const a = spanMask(n, ev.map(e => [e.a - pre, e.p + hold]), r); mask = a.map(v => 1 - v); }
  let on = 0; for (let i = 0; i < n; i++) on += mask[i]; on /= n;
  if (on < 1e-3) return { outputs: [{ suffix: "wide", buf: mkBuf(sr, stereo ? ch : [ch[0], Float32Array.from(ch[0])]) }], report: ["No events found: there are no tails to widen"] };
  const D = velvet(M, sr, 7), Dh = new Float32Array(n), Dh2 = new Float32Array(n);
  { const w0 = 2 * Math.PI * Math.min(opt.lowHz, 0.45 * sr) / sr, al = Math.sin(w0) / (2 * Math.SQRT1_2), cw = Math.cos(w0), a0 = 1 + al;
    const c = [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - al) / a0]; WL.biquadInto(D, Dh, c); WL.biquadInto(Dh, Dh2, c);
    // the decorrelator's response is uneven on tonal sounds (a ringing blade can come out louder than it went in), so the
    // added side follows the high-passed sound's own level over 30 ms: width is then the same at every moment
    const Mh = new Float32Array(n), Mh2 = new Float32Array(n); WL.biquadInto(M, Mh, c); WL.biquadInto(Mh, Mh2, c);
    const W = Math.max(8, Math.round(0.015 * sr)), cm = new Float64Array(n + 1), cd = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cm[i + 1] = cm[i] + Mh2[i] * Mh2[i]; cd[i + 1] = cd[i] + Dh2[i] * Dh2[i]; }
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - W), b = Math.min(n, i + W), em = cm[b] - cm[a], ed = cd[b] - cd[a]; Dh2[i] *= ed > 1e-20 ? Math.min(4, Math.sqrt(em / ed)) : 0; } }
  const w = opt.width / 100, Lo = new Float32Array(n), Ro = new Float32Array(n);
  let sll = 0, srr = 0, slr = 0;
  for (let i = 0; i < n; i++) {
    const s = S[i] + w * Dh2[i] * mask[i]; Lo[i] = M[i] + s; Ro[i] = M[i] - s;
    if (mask[i] > 0.5) { sll += Lo[i] * Lo[i]; srr += Ro[i] * Ro[i]; slr += Lo[i] * Ro[i]; }
  }
  const report = ["Width " + opt.width + "% added " + (opt.where === "tails" ? "to the tails" : opt.where === "all" ? "everywhere (attacks too, for comparison)" : "around the attacks") + ", " + Math.round(100 * on) + "% of the time; lows below " + opt.lowHz + " Hz stay centred",
    "Channel correlation where widened: " + (slr / Math.sqrt(sll * srr + 1e-30)).toFixed(2) + " (1 = mono, 0 = unrelated)"];
  if (opt.width > 0 && slr / Math.sqrt(sll * srr + 1e-30) > 0.9) report.push("Little changed: most of this sound outside the attacks is below " + opt.lowHz + " Hz, which stays centred. Lower \"Lows centred below\" to widen more");
  const lowered = peakOf([Lo, Ro]) > 0.999, outs = finish(src, [Lo, Ro], "none", report);
  report.push((stereo ? "(L+R)/2 of the result is the original's (L+R)/2" : "Folded back to mono with (L+R)/2, the result is the original sound") + (lowered ? ", lowered as noted" : ", sample for sample"));
  return { outputs: [{ suffix: "wide", buf: mkBuf(sr, outs) }], report };
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
    run: variations },
  { id: "tailverb", name: "Reverb on the tails", kind: "Sound design",
    desc: "Sends only the tails of the events into a reverb: each hit from its peak to the end of its decay, so the attack stays dry and punchy and the tail blooms. An EQ cannot do this: it adds new energy after the sound and smears it in time.",
    params: [{ id: "wetDb", label: "Reverb level", min: -30, max: 0, step: 1, value: -8, unit: "dB" }, { id: "t60", label: "Decay", min: 0.3, max: 6, step: 0.1, value: 1.6, unit: "s" },
      { id: "holdMs", label: "Start after the peak", min: 0, max: 300, step: 5, value: 30, unit: "ms" }, { id: "toneHz", label: "Tone", min: 1500, max: 16000, step: 500, value: 6000, unit: "Hz" },
      { id: "dryAttacks", label: "Keep the attacks dry", type: "bool", value: true }],
    run: tailVerb },
  { id: "drive", name: "Drive the hits", kind: "Sound design",
    desc: "Saturates only the events (their attacks, their bodies, or all of them) and leaves the rest clean. The saturated part is held at the original level, so what changes is the harmonics, which no EQ can add, not the loudness.",
    params: [{ id: "where", label: "Where", type: "select", value: "attack", options: [["attack", "Attacks"], ["body", "Bodies (after the peak)"], ["whole", "Whole events"]] },
      { id: "driveDb", label: "Drive", min: 0, max: 30, step: 1, value: 18, unit: "dB" }, { id: "mix", label: "Mix", min: 0, max: 100, step: 5, value: 70, unit: "%" },
      { id: "match", label: "Match loudness", type: "bool", value: true }],
    run: driveHits },
  { id: "ring", name: "Ring time", kind: "Sound design",
    desc: "Changes how long each event rings, relative to its own peak: longer for metal and glass, shorter for wood and cardboard. Higher partials can ring longer or shorter than lower ones, which moves the material read by the decay descriptor (N9). An EQ sets the same gain at every level; this sets it by how far each partial has decayed since its event's peak.",
    params: [{ id: "ratio", label: "Ring time", min: 0.25, max: 4, step: 0.05, value: 2 }, { id: "tilt", label: "High partials", min: -0.5, max: 0.5, step: 0.05, value: 0 },
      { id: "maxBoostDb", label: "Largest lift", min: 6, max: 36, step: 1, value: 18, unit: "dB" }, { id: "match", label: "Keep the peak", type: "bool", value: true }],
    run: ringTime },
  { id: "level", name: "Level the events", kind: "Mixing",
    desc: "Evens out how loud the events are (footsteps, impacts, a burst of shots, debris) with one gain per event, changed only in the moment before each event starts. A compressor reaching the same evenness turns attacks down and makes the background pump; this leaves every event's attack and decay as it was.",
    params: [{ id: "amount", label: "Evenness", min: 0, max: 100, step: 5, value: 70, unit: "%" }, { id: "target", label: "Towards", type: "select", value: "median", options: [["median", "The middle event"], ["loudest", "The loudest event"], ["quietest", "The quietest event"]] },
      { id: "maxDb", label: "Largest change", min: 3, max: 24, step: 1, value: 12, unit: "dB" }, { id: "match", label: "Match loudness", type: "bool", value: true }],
    run: levelEvents },
  { id: "mono", name: "Fold to mono", kind: "Game audio",
    desc: "Folds stereo to mono without the losses of a plain (L+R)/2: per frequency, the right channel is turned to the left channel's phase before summing, and the sum is brought back to the channels' energy. Each attack the analysis finds is folded in the time domain with its own delay and polarity between the channels, so there is no pre-echo. The report names the bands and events that cancel in a plain sum, which doubles as a mono-compatibility check. The second result is the plain sum, for comparison.",
    params: [{ id: "align", label: "Line up the phase", type: "bool", value: true }, { id: "keepEnergy", label: "Keep the channels' energy", type: "bool", value: true },
      { id: "maxBoostDb", label: "Largest repair", min: 3, max: 18, step: 1, value: 9, unit: "dB" }, { id: "plain", label: "Also render the plain sum", type: "bool", value: true }],
    run: foldMono },
  { id: "widen", name: "Widen the tails", kind: "Sound design",
    desc: "Makes stereo from mono (or widens stereo) by adding a decorrelated copy of the sound (a velvet-noise decorrelator) to the side, only after the attacks the analysis finds: attacks stay centred and punchy, tails and background open up, and the lows stay centred. Only the side changes, so (L+R)/2 gives back the original exactly: the result is fully mono-compatible.",
    params: [{ id: "width", label: "Width", min: 0, max: 100, step: 5, value: 60, unit: "%" }, { id: "where", label: "Where", type: "select", value: "rest", options: [["rest", "Tails and background (not the attacks)"], ["tails", "Only the tails"], ["all", "Everywhere (attacks too, for comparison)"]] },
      { id: "holdMs", label: "Centred after each peak", min: 0, max: 200, step: 5, value: 25, unit: "ms" }, { id: "lowHz", label: "Lows centred below", min: 40, max: 400, step: 10, value: 150, unit: "Hz" }],
    run: widenTails }
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

const api = { TOOLS, eqExplained, encodeWav, zipStore, crc32, mkBuf, chansOf, resample, lufsOf, stftApply, stftMagnitudes, _stftMag: stftMagnitudes, cleanup, deharsh, layerMix, hpss, tensionShape, loopMaker, variations, tailVerb, driveHits, ringTime, levelEvents, eventLevelGain, kWeighted, eventsOf, foldMono, widenTails, velvet };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.WLFX = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
