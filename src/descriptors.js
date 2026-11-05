// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead
//
// Cross-field descriptors: measures borrowed from machine diagnostics, seismology, ecoacoustics,
// voice science, optimal transport, information dynamics, recurrence analysis and impact acoustics.
// Most have an analytic reference value (white noise, a steady tone, a periodic train, time reversal),
// which the test suite checks instead of thresholds tuned on test signals.
//
//   PHD.describe(F, buf)  ->  { curves (one value per analysis frame, NaN where undefined), events, decays, summary }
//
// Depends on analysis.js (WL) for the FFT and the shared features F.
(function (root) {
"use strict";
const WL = root.WL || (typeof require !== "undefined" ? require("./analysis.js") : null);

const DESC = {
  kurtWin: 0.5, kurtWinShort: 0.25, kurtStep: 0.05,
  kurtBands: [[100, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]],
  envBands: [[50, 300], [300, 1500], [1500, 5000], [5000, 16000]],
  repWin: 6, repStep: 0.5, repMin: 0.5, repMax: 150, repProm: 10,
  staS: 0.010, staL: 0.5, trigger: 3, detrigger: 1.5, eventFloorDb: 50,
  velSmooth: 0.3, velGamma: 0.5, velRange: 50,
  cppFmin: 60, cppFmax: 1000,
  arrowLags: [0.005, 0.02, 0.08], arrowWin: 1.0,
  symRate: 20, symK: 12, symMergeDist: 10, forget: 0.995, alpha0: 0.5,
  recRate: 10, recMax: 1500, recTheiler: 1.0, recEpsLo: 1.5, recEpsHi: 3, recBlock: 32, recLmin: 3, symMerge: 3.0, repDepthDb: 2,
  decayMin: 0.12, materialEdges: [1.3, 2.38]
};

/* ---------------- helpers ---------------- */
const LOG10E = Math.log10(Math.E);
function nextPow2(v) { let p = 1; while (p < v) p <<= 1; return p; }
function monoOf(buf) {
  const n = buf.length, ch = buf.numberOfChannels, o = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) o[i] += d[i] / ch; }
  return o;
}
function quant(arr, p) {
  const s = []; for (const v of arr) if (isFinite(v)) s.push(v);
  if (!s.length) return NaN;
  s.sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}
function meanF(arr) { let s = 0, k = 0; for (const v of arr) if (isFinite(v)) { s += v; k++; } return k ? s / k : NaN; }
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// values at arbitrary times -> one value per analysis frame (linear; NaN stays NaN)
// many short values (one per short frame) -> analysis frames, keeping the largest in each frame
function toFramesMax(vals, times, F) {
  const o = new Float32Array(F.nF).fill(NaN);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]; if (!isFinite(v)) continue;
    const m = Math.min(F.nF - 1, Math.max(0, Math.floor(times[i] / F.dt)));
    if (!(o[m] >= v)) o[m] = v;
  }
  return o;
}
function toFrames(vals, times, F) {
  const o = new Float32Array(F.nF).fill(NaN), n = vals.length;
  if (!n) return o;
  let j = 0;
  for (let m = 0; m < F.nF; m++) {
    const t = (m + 0.5) * F.dt;
    while (j < n - 2 && times[j + 1] < t) j++;
    if (n === 1 || t <= times[0]) { o[m] = t >= times[0] - 1.5 * (times[1] - times[0] || 1) ? vals[0] : NaN; continue; }
    if (t >= times[n - 1]) { o[m] = t - times[n - 1] <= 1.5 * (times[n - 1] - times[n - 2]) ? vals[n - 1] : NaN; continue; }
    const a = vals[j], b = vals[j + 1], u = (t - times[j]) / (times[j + 1] - times[j]);
    o[m] = isFinite(a) && isFinite(b) ? a + (b - a) * u : (u < 0.5 ? a : b);
  }
  return o;
}
function smoothNaN(a, half) {
  const n = a.length, o = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (!isFinite(a[i])) { o[i] = NaN; continue; } let s = 0, k = 0; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (isFinite(a[j])) { s += a[j]; k++; } o[i] = s / k; }
  return o;
}
// per-frame sound gate on the shared features: K-weighted level above −70 LUFS and within 45 dB of the loud part
function frameGate(F) {
  const L = new Float32Array(F.nF);
  for (let m = 0; m < F.nF; m++) L[m] = -0.691 + 10 * Math.log10(F.kz[m] + 1e-20);
  const ref = quant(L, 0.95), thr = Math.max(-70, ref - 45), g = new Uint8Array(F.nF);
  for (let m = 0; m < F.nF; m++) g[m] = L[m] > thr ? 1 : 0;
  return g;
}
function gateShare(gate, F, t0, t1) { const a = Math.max(0, Math.floor(t0 / F.dt)), b = Math.min(F.nF, Math.max(a + 1, Math.ceil(t1 / F.dt))); let s = 0; for (let m = a; m < b; m++) s += gate[m]; return s / (b - a); }
function melCentre(F, b) { const B = 40, ml = 2595 * Math.log10(1 + 40 / 700), mh = 2595 * Math.log10(1 + Math.min(16000, F.sr * 0.475) / 700); const mm = ml + (mh - ml) * (b + 1) / (B + 1); return 700 * (Math.pow(10, mm / 2595) - 1); }
/** NaN-aware pooling of a frame curve into display columns. mode: "mean" | "max" | "absmax" */
function poolNaN(arr, cols, mode) {
  const n = arr.length, o = new Float32Array(cols).fill(NaN);
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * n / cols), b = Math.max(a + 1, Math.floor((c + 1) * n / cols));
    let s = 0, k = 0, best = NaN;
    for (let m = a; m < b && m < n; m++) { const v = arr[m]; if (!isFinite(v)) continue; s += v; k++; if (!isFinite(best) || (mode === "absmax" ? Math.abs(v) > Math.abs(best) : v > best)) best = v; }
    if (k) o[c] = mode === "mean" ? s / k : best;
  }
  return o;
}

/* ---------------- 1. short STFT: spectral kurtosis (machine diagnostics) and band envelopes ---------------- */
// Spectral kurtosis K(f) = <|X|^4>/<|X|^2>^2 - 2 over M frames: 0 for Gaussian noise (sd 2/sqrt(M)), -1 for a steady tone,
// positive for impulsive or intermittent sound. Computed per bin from block sums, then power-weighted per band.
function shortStft(x, sr, dur) {
  const N = Math.max(128, nextPow2(Math.round(256 * sr / 44100))), H = N >> 1, half = N >> 1, fft = WL.getFFT(N), w = WL.hannP(N);
  const T = Math.max(1, Math.floor((x.length - N) / H) + 1), rate = sr / H, binHz = sr / N;
  const blkF = Math.max(1, Math.round(DESC.kurtStep * rate)), nBlk = Math.ceil(T / blkF);
  const S1 = new Float64Array(nBlk * (half + 1)), S2 = new Float64Array(nBlk * (half + 1)), cnt = new Uint16Array(nBlk);
  const env = DESC.envBands.map(() => new Float32Array(T)), bandOf = new Int8Array(half + 1).fill(-1), pw = new Float32Array(T);
  for (let k = 1; k <= half; k++) { const f = k * binHz; DESC.envBands.forEach(([lo, hi], b) => { if (f >= lo && f < hi) bandOf[k] = b; }); }
  const re = new Float64Array(N), im = new Float64Array(N);
  const acc = (t, k, p) => { const bi = Math.floor(t / blkF), o = bi * (half + 1); S1[o + k] += p; S2[o + k] += p * p; pw[t] += p; if (bandOf[k] >= 0) env[bandOf[k]][t] += p; };
  // two real frames per complex FFT: z = a + i b, A[k] = (Z[k] + conj Z[N-k]) / 2, B[k] = (Z[k] - conj Z[N-k]) / 2i
  for (let t = 0; t < T; t += 2) {
    const tb = t + 1 < T ? t + 1 : -1, sa = t * H, sb = tb >= 0 ? tb * H : 0;
    for (let i = 0; i < N; i++) { re[i] = x[sa + i] * w[i]; im[i] = tb >= 0 ? x[sb + i] * w[i] : 0; }
    fft(re, im);
    cnt[Math.floor(t / blkF)]++; if (tb >= 0) cnt[Math.floor(tb / blkF)]++;
    for (let k = 1; k <= half; k++) {
      const m = (N - k) & (N - 1), zr = re[k], zi = im[k], yr = re[m], yi = im[m];
      const ar = (zr + yr) / 2, ai = (zi - yi) / 2; acc(t, k, ar * ar + ai * ai);
      if (tb >= 0) { const br = (zi + yi) / 2, bim = (yr - zr) / 2; acc(tb, k, br * br + bim * bim); }
    }
  }
  return { N, H, half, T, rate, binHz, blkF, nBlk, S1, S2, cnt, env, pw };
}
function kurtosisOf(st, F, gate, dur) {
  const { half, binHz, blkF, nBlk, S1, S2, cnt, rate, pw, T, N, H } = st;
  const win = Math.max(1, Math.round((dur <= 6 ? DESC.kurtWinShort : DESC.kurtWin) * rate / blkF));
  const bands = DESC.kurtBands.map(([lo, hi]) => [Math.max(1, Math.ceil(lo / binHz)), Math.min(half, Math.floor(hi / binHz))]);
  const times = [], kmax = [], khz = [], kall = [];
  // where the impulses are: each window's kurtosis given to its frames in proportion to their power, so a curve drawn
  // from it rises at an impulse, not half a window before it (the window values stay the statistic for summaries)
  const loc = new Float32Array(T).fill(NaN);
  const a1 = new Float64Array(half + 1), a2 = new Float64Array(half + 1);
  let maxPow = 0; for (let i = 0; i < S1.length; i++) if (S1[i] > maxPow) maxPow = S1[i];
  const bandK = (A1, A2, M) => {
    const out = [];
    let tot = 0; for (let k = 1; k <= half; k++) tot += A1[k];
    for (const [k0, k1] of bands) {
      let s = 0, wsum = 0, pw = 0;
      for (let k = k0; k <= k1; k++) { const m1 = A1[k] / M; if (m1 <= 0) continue; const K = (A2[k] / M) / (m1 * m1) - 2; s += K * A1[k]; wsum += A1[k]; pw += A1[k]; }
      out.push({ K: wsum > 0 ? s / wsum : NaN, share: tot > 0 ? pw / tot : 0 });
    }
    let sAll = 0, wAll = 0; for (let k = 1; k <= half; k++) { const m1 = A1[k] / M; if (m1 <= 0) continue; sAll += ((A2[k] / M) / (m1 * m1) - 2) * A1[k]; wAll += A1[k]; }
    return { bands: out, all: wAll > 0 ? sAll / wAll : NaN };
  };
  for (let b0 = 0; b0 + 1 <= nBlk; b0++) {
    const b1 = Math.min(nBlk, b0 + win); if (b1 - b0 < Math.min(win, nBlk)) break;
    a1.fill(0); a2.fill(0); let M = 0;
    for (let b = b0; b < b1; b++) { const o = b * (half + 1); M += cnt[b]; for (let k = 1; k <= half; k++) { a1[k] += S1[o + k]; a2[k] += S2[o + k]; } }
    const tc = ((b0 + b1) / 2) * blkF / rate, open = gateShare(gate, F, b0 * blkF / rate, b1 * blkF / rate) >= 0.1;
    let tot = 0; for (let k = 1; k <= half; k++) tot += a1[k];
    times.push(tc);
    if (!open || tot / M < maxPow / blkF * 1e-7) { kmax.push(NaN); khz.push(NaN); kall.push(NaN); continue; }
    const r = bandK(a1, a2, M);
    let best = NaN, bh = NaN;
    r.bands.forEach((b, i) => { if (b.share >= 0.02 && isFinite(b.K) && (!isFinite(best) || b.K > best)) { best = b.K; bh = Math.sqrt(DESC.kurtBands[i][0] * DESC.kurtBands[i][1]); } });
    kmax.push(best); khz.push(bh); kall.push(r.all);
    if (isFinite(best)) {
      const f0 = b0 * blkF, f1 = Math.min(T, b1 * blkF); let pmax = 0;
      for (let f = f0; f < f1; f++) if (pw[f] > pmax) pmax = pw[f];
      for (let f = f0; f < f1; f++) { const v = best > 0 && pmax > 0 ? best * pw[f] / pmax : best; if (!(loc[f] >= v)) loc[f] = v; }
    }
  }
  const locT = Array.from({ length: T }, (_, f) => (f * H + N / 2) / (rate * H));
  // whole file
  a1.fill(0); a2.fill(0); let M = 0;
  for (let b = 0; b < nBlk; b++) { const o = b * (half + 1); M += cnt[b]; for (let k = 1; k <= half; k++) { a1[k] += S1[o + k]; a2[k] += S2[o + k]; } }
  const whole = bandK(a1, a2, Math.max(1, M));
  let wb = -1; whole.bands.forEach((b, i) => { if (b.share >= 0.02 && isFinite(b.K) && (wb < 0 || b.K > whole.bands[wb].K)) wb = i; });
  const Mw = win * blkF;
  return {
    curve: toFrames(kmax, times, F), hz: toFrames(khz, times, F), all: toFrames(kall, times, F), local: toFramesMax(loc, locT, F),
    sig: 1.645 * 2 / Math.sqrt(Mw),
    summary: { K: whole.all, Kmax: wb >= 0 ? whole.bands[wb].K : NaN, band: wb >= 0 ? DESC.kurtBands[wb] : null, bands: whole.bands.map(b => b.K) }
  };
}

/* ---------------- 2. squared-envelope spectrum: repetition rate (machine diagnostics), speech-likeness ---------------- */
// Welch average of Hann-windowed periodograms (segments of segS seconds, 50 % overlap) of the envelope in dB, each segment
// linearly detrended so decays and fades do not read as slow repetition. Also returns the modulation depth scale.
function envSpectrum(e, rate, lo, hi, segS, rawAmp) {
  const n = e.length, Ls = Math.min(n, Math.max(8, Math.round((segS || n / rate) * rate))), hop = Math.max(1, Ls >> 1);
  const NF = nextPow2(Ls) * 2, re = new Float64Array(NF), im = new Float64Array(NF), fft = WL.getFFT(NF), P = new Float64Array(NF / 2);
  let mean = 0; for (let i = 0; i < n; i++) mean += e[i]; mean /= n;
  const fl = Math.max(1e-30, mean * 1e-6), y = new Float64Array(Ls);
  let k = 0, wsum = 0; for (let i = 0; i < Ls; i++) wsum += 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / Ls);
  for (let a = 0; a + Ls <= n; a += hop) {
    for (let i = 0; i < Ls; i++) y[i] = rawAmp ? e[a + i] : 10 * Math.log10(e[a + i] + fl);
    // remove the best straight line
    let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < Ls; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]; }
    const bb = (Ls * sxy - sx * sy) / Math.max(1e-12, Ls * sxx - sx * sx), aa = (sy - bb * sx) / Ls;
    re.fill(0); im.fill(0);
    for (let i = 0; i < Ls; i++) re[i] = (y[i] - aa - bb * i) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / Ls));
    fft(re, im);
    for (let q = 0; q < NF / 2; q++) P[q] += re[q] * re[q] + im[q] * im[q];
    k++;
  }
  const df = rate / NF;
  // amplitude of a sinusoidal component from its peak: A = 2 sqrt(P/k) / sum(window)
  return { P, df, k0: Math.max(1, Math.ceil(Math.max(lo, 3 / (Ls / rate)) / df)), k1: Math.min(NF / 2 - 1, Math.floor(hi / df)), segs: k, ampOf: v => 2 * Math.sqrt(v / Math.max(1, k)) / wsum };
}
function peakRate(sp) {
  const { P, df, k0, k1 } = sp; if (k1 - k0 < 4) return null;
  const v = []; for (let k = k0; k <= k1; k++) v.push(P[k]); v.sort((a, b) => a - b);
  const med = v[v.length >> 1] + 1e-30;
  let best = k0; for (let k = k0; k <= k1; k++) if (P[k] > P[best]) best = k;
  const prom = k => 10 * Math.log10((P[k] + 1e-30) / med), thr = repThr(sp);
  // prefer the fundamental repetition: a subharmonic nearly as prominent wins
  for (let it = 0; it < 2; it++) { const h = Math.round(best / 2); if (h >= k0) { let hb = h; for (let k = Math.max(k0, h - 2); k <= Math.min(k1, h + 2); k++) if (P[k] > P[hb]) hb = k; if (prom(hb) >= prom(best) - 6 && prom(hb) >= thr) best = hb; } }
  const y0 = P[best - 1] || P[best], y1 = P[best], y2 = P[best + 1] || P[best], den = y0 - 2 * y1 + y2;
  const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  const depth = sp.ampOf ? sp.ampOf(P[best]) : Infinity;
  return { hz: (best + off) * df, prom: prom(best), depth, clear: prom(best) >= thr && depth >= DESC.repDepthDb };
}
// band envelopes in dB, computed once (floor 60 dB below each band's mean power)
function dbEnvelopes(env) {
  return env.map(e => { let m = 0; for (let i = 0; i < e.length; i++) m += e[i]; m /= Math.max(1, e.length); const fl = Math.max(1e-30, m * 1e-6), y = new Float32Array(e.length); for (let i = 0; i < e.length; i++) y[i] = 10 * Math.log10(e[i] + fl); return y; });
}
function detrend(y, a, n, out) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { const v = y[a + i]; sx += i; sy += v; sxx += i * i; sxy += i * v; }
  const b = (n * sxy - sx * sy) / Math.max(1e-12, n * sxx - sx * sx), c = (sy - b * sx) / n;
  for (let i = 0; i < n; i++) out[i] = y[a + i] - c - b * i;
  return out;
}
const hannCache = {};
function hannS(L) { if (!hannCache[L]) { const w = new Float64Array(L); for (let i = 0; i < L; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / L); hannCache[L] = w; } return hannCache[L]; }
// Welch spectrum of a dB envelope over [a, b): detrended Hann segments of Ls samples at hop Ls/2. Segment periodograms are
// cached by start sample, so overlapping analysis windows on the same segment grid share them.
function welchDb(y, a, b, Ls, rate, lo, hi, cache) {
  const hop = Math.max(1, Ls >> 1), NF = nextPow2(Ls) * 2, w = hannS(Ls), P = new Float64Array(NF / 2);
  let k = 0, wsum = 0; for (let i = 0; i < Ls; i++) wsum += w[i];
  for (let s = a; s + Ls <= b; s += hop) {
    let seg = cache ? cache.get(s) : null;
    if (!seg) {
      const re = new Float64Array(NF), im = new Float64Array(NF); detrend(y, s, Ls, re); for (let i = 0; i < Ls; i++) re[i] *= w[i];
      WL.getFFT(NF)(re, im); seg = new Float64Array(NF / 2); for (let q = 0; q < NF / 2; q++) seg[q] = re[q] * re[q] + im[q] * im[q];
      if (cache) cache.set(s, seg);
    }
    for (let q = 0; q < NF / 2; q++) P[q] += seg[q];
    k++;
  }
  const df = rate / NF;
  return { P, df, k0: Math.max(1, Math.ceil(Math.max(lo, 3 / (Ls / rate)) / df)), k1: Math.min(NF / 2 - 1, Math.floor(hi / df)), segs: k, ampOf: v => 2 * Math.sqrt(v / Math.max(1, k)) / wsum };
}
// a spectral peak counts as repetition only if the detrended dB envelope correlates with itself one and two periods later
function periodicAtDb(y, a, b, rate, hz) {
  const n = b - a, L1 = Math.round(rate / hz), L2 = 2 * L1, d = detrend(y, a, n, new Float64Array(n));
  const acf = L => { let s = 0, s1 = 0, s2 = 0; for (let i = 0; i + L < n; i++) { s += d[i] * d[i + L]; s1 += d[i] * d[i]; s2 += d[i + L] * d[i + L]; } return s1 > 0 && s2 > 0 ? s / Math.sqrt(s1 * s2) : 0; };
  if (L2 >= n * 0.75 || L1 < 1) return L1 < n * 0.5 ? acf(L1) >= 0.5 : false;
  return acf(L1) >= 0.3 && acf(L2) >= 0.2;
}
// a single periodogram has chance peaks about 10 dB above its median; averaging segments lowers that
function repThr(sp) { return sp.segs >= 3 ? DESC.repProm : DESC.repProm + 5; }
function repetitionOf(st, F, gate, dur) {
  const { env, rate } = st, T = env[0].length, yDb = dbEnvelopes(env);
  const pre = env.map(e => { const p = new Float64Array(e.length + 1); for (let i = 0; i < e.length; i++) p[i + 1] = p[i] + e[i]; return p; });
  const W = Math.min(T, Math.max(Math.round(1 * rate), Math.round(Math.min(DESC.repWin, dur) * rate)));
  const Ls = Math.min(W, Math.round(Math.max(2, W / rate / 3) * rate)), hopS = Math.max(1, Ls >> 1);
  const step = hopS * Math.max(1, Math.round(DESC.repStep * rate / hopS));            // on the segment grid, so segments are shared
  const hi = Math.min(DESC.repMax, rate * 0.45), caches = env.map(() => new Map());
  const one = (a, b, L, cached) => {
    let best = null;
    env.forEach((e, bi) => {
      if (pre[bi][b] - pre[bi][a] <= 0) return;
      const r = peakRate(welchDb(yDb[bi], a, b, L, rate, DESC.repMin, hi, cached ? caches[bi] : null));
      if (r && r.clear) { const h = (b - a) >> 1, two = h > 2.5 * rate / r.hz; if (!periodicAtDb(yDb[bi], a, b, rate, r.hz) || (two && (!periodicAtDb(yDb[bi], a, a + h, rate, r.hz) || !periodicAtDb(yDb[bi], a + h, b, rate, r.hz)))) r.clear = false; }
      if (r && (!best || (r.clear && !best.clear) || (r.clear === best.clear && r.prom > best.prom))) best = r;
    });
    return best;
  };
  const times = [], hz = [], prom = [];
  for (let a = 0; a + W <= T; a += step) {
    times.push((a + W / 2) / rate);
    const r = gateShare(gate, F, a / rate, (a + W) / rate) >= 0.1 ? one(a, a + W, Ls, true) : null;
    hz.push(r && r.clear ? r.hz : NaN); prom.push(r ? r.prom : NaN);
  }
  // whole file (up to 30 s from the middle)
  const L = Math.min(T, Math.round(30 * rate)), a0 = Math.max(0, Math.floor((T - L) / 2));
  const whole = L >= Math.round(0.8 * rate) ? one(a0, a0 + L, Math.min(L, Math.round(Math.max(2, L / rate / 3) * rate)), false) : null;
  // speech-likeness (Ding et al. 2017): modulation energy 3–7 Hz over 0.5–2.5 Hz of the 300–5000 Hz amplitude envelope
  let speech = NaN;
  if (dur >= 3) {
    const e = new Float32Array(T); for (let i = 0; i < T; i++) e[i] = Math.sqrt(env[1][i] + env[2][i]);
    const sp = envSpectrum(e, rate, 0.5, 7, Math.min(dur, 6), true), band = (lo, hi) => { let s = 0, c = 0; for (let k = Math.ceil(lo / sp.df); k <= Math.floor(hi / sp.df); k++) { s += sp.P[k] * k * sp.df; c++; } return s / Math.max(1, c); };
    // energy per octave (f·P), so a 1/f modulation background reads 0 dB. Experimental: Ding et al.'s 4–5 Hz speech peak is a
    // population average and did not separate single speech clips from music in our tests.
    speech = 10 * Math.log10((band(3, 7) + 1e-30) / (band(0.5, 2.5) + 1e-30));
  }
  const cycles = whole && whole.clear ? dur * whole.hz : NaN;
  return {
    hz: toFrames(hz, times, F), prom: toFrames(prom, times, F),
    summary: { hz: whole && whole.clear ? whole.hz : NaN, prom: whole ? whole.prom : NaN, cycles, cycleError: isFinite(cycles) ? Math.abs(cycles - Math.round(cycles)) : NaN, speech }
  };
}

/* ---------------- 3. STA/LTA events (seismology), burstiness, b-value, temporal entropy (ecoacoustics) ---------------- */
function blocks(x, sr, ms) {
  const B = Math.max(1, Math.round(sr * ms / 1000)), n = Math.floor(x.length / B), amp = new Float32Array(n), en = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0, e = 0; for (let j = i * B; j < (i + 1) * B; j++) { const v = x[j]; a += Math.abs(v); e += v * v; } amp[i] = a / B; en[i] = e / B; }
  return { amp, en, rate: sr / B };
}
function staLta(amp, rate) {
  let pk = 0; for (const a of amp) if (a > pk) pk = a;
  const floor = pk * Math.pow(10, -DESC.eventFloorDb / 20), ks = 1 / Math.max(1, DESC.staS * rate), kl = 1 / Math.max(1, DESC.staL * rate);
  let sta = floor, lta = floor, on = false, s0 = 0, peak = 0;
  const ev = [], ratio = new Float32Array(amp.length);
  for (let i = 0; i < amp.length; i++) {
    sta += (amp[i] - sta) * ks; lta += (amp[i] - lta) * kl;
    const r = sta / Math.max(lta, floor * 0.5); ratio[i] = r;
    if (!on) { if (r >= DESC.trigger && sta >= floor * 3) { on = true; s0 = i; peak = amp[i]; } }
    else { if (amp[i] > peak) peak = amp[i]; if (r < DESC.detrigger) { ev.push({ t0: s0 / rate, t1: i / rate, peak }); on = false; } }
    if (ev.length > 20000) break;
  }
  if (on) ev.push({ t0: s0 / rate, t1: amp.length / rate, peak });
  return ev.map(e => ({ t0: e.t0, t1: e.t1, peakDb: 20 * Math.log10(e.peak * Math.PI / 2 + 1e-12) }));
}
/** Burstiness B = (sigma - mu)/(sigma + mu) of inter-event times (Goh & Barabási): -1 periodic, ~0 Poisson, > 0 clustered */
function burstiness(times) {
  if (times.length < 4) return NaN;
  const d = []; for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
  const mu = d.reduce((a, b) => a + b, 0) / d.length, sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) * (b - mu), 0) / d.length);
  return (sd - mu) / (sd + mu);
}
/** Gutenberg–Richter b-value by Aki's maximum likelihood, magnitudes m = log10(amplitude); completeness at the 20th percentile */
function bValue(mags) {
  if (mags.length < 20) return { b: NaN, n: mags.length };
  const mc = quant(mags, 0.2), m = mags.filter(v => v >= mc);
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  return { b: mean > mc ? LOG10E / (mean - mc) : NaN, n: m.length };
}
/** Temporal entropy Ht (scikit-maad): normalised Shannon entropy of the energy envelope; < 0.7 transient, ~1 steady */
function temporalEntropy(en, a, b) {
  let s = 0; for (let i = a; i < b; i++) s += en[i]; if (s <= 0 || b - a < 2) return NaN;
  let h = 0; for (let i = a; i < b; i++) { const p = en[i] / s; if (p > 0) h -= p * Math.log(p); }
  return h / Math.log(b - a);
}

/* ---------------- 4. spectral motion: 1-D optimal transport between frames (Wasserstein-1 on a log-frequency axis) ---------------- */
function motionOf(F, gate) {
  const B = 40, n = F.nF, u = new Float64Array(B); for (let b = 0; b < B; b++) u[b] = Math.log2(melCentre(F, b));
  const du = new Float64Array(B); for (let b = 0; b < B - 1; b++) du[b] = u[b + 1] - u[b];
  const P = new Float64Array(n * B);
  let fileMax = -Infinity; for (let i = 0; i < n * B; i++) if (F.melDb[i] > fileMax) fileMax = F.melDb[i];
  for (let m = 0; m < n; m++) {
    let mx = -Infinity; for (let b = 0; b < B; b++) mx = Math.max(mx, F.melDb[m * B + b]);
    let s = 0; for (let b = 0; b < B; b++) { const d = F.melDb[m * B + b]; const v = d < mx - DESC.velRange || d < fileMax - 60 ? 0 : Math.pow(10, DESC.velGamma * (d - mx) / 10); P[m * B + b] = v; s += v; }
    if (s <= 0) { for (let b = 0; b < B; b++) P[m * B + b] = NaN; continue; }
    let c = 0; for (let b = 0; b < B; b++) { c += P[m * B + b] / s; P[m * B + b] = c; }
  }
  const vel = new Float32Array(n).fill(NaN), w1 = new Float32Array(n).fill(NaN);
  for (let m = 1; m < n; m++) {
    if (!gate[m] || !gate[m - 1] || isNaN(P[m * B]) || isNaN(P[(m - 1) * B])) continue;
    let sv = 0, sw = 0; for (let b = 0; b < B - 1; b++) { const d = P[m * B + b] - P[(m - 1) * B + b]; sv -= d * du[b]; sw += Math.abs(d) * du[b]; }
    vel[m] = sv / F.dt; w1[m] = sw / F.dt;
  }
  const half = Math.max(1, Math.round(DESC.velSmooth / F.dt / 2));
  const v = smoothNaN(vel, half), W = smoothNaN(w1, half), reshape = new Float32Array(n);
  for (let m = 0; m < n; m++) reshape[m] = isFinite(W[m]) ? Math.max(0, W[m] - Math.abs(v[m])) : NaN;
  // net glide: centroid on the log axis, first vs last fifth of the sounding frames
  const cent = [], g = []; for (let m = 0; m < n; m++) if (gate[m] && !isNaN(P[m * B])) { let s = 0; for (let b = 0; b < B - 1; b++) s += (1 - P[m * B + b]) * du[b]; cent.push(u[0] + s); g.push(m); }
  const k = Math.max(1, Math.floor(cent.length / 5)), net = cent.length >= 5 ? meanF(cent.slice(-k)) - meanF(cent.slice(0, k)) : NaN;
  return { vel: v, reshape, summary: { medianAbs: quant(Array.from(v).map(Math.abs), 0.5), up: quant(v, 0.95), down: quant(v, 0.05), net } };
}

/* ---------------- 5. periodicity without a pitch tracker: cepstral peak prominence (voice science) and phase coherence ---------------- */
function cppOf(x, sr, F, gate, dur) {
  const N = nextPow2(Math.round(2048 * sr / 44100)), H = N >> 1, half = N >> 1, fft = WL.getFFT(N), w = WL.hannP(N);
  const T = Math.max(0, Math.floor((x.length - N) / H) + 1);
  const qLo = Math.max(2, Math.floor(sr / DESC.cppFmax)), qHi = Math.min(half - 1, Math.ceil(sr / DESC.cppFmin)), q0 = Math.max(1, Math.round(0.001 * sr));
  const zr = new Float64Array(N), zi = new Float64Array(N), cr = new Float64Array(N), ci = new Float64Array(N);
  // phase coherence compares frames one window apart (independent for noise): with H = N/2 that is 2 frames back
  const sp = Math.max(1, Math.round(N / H)), RING = 2 * sp + 1;
  const rRe = Array.from({ length: RING }, () => new Float64Array(half + 1)), rIm = Array.from({ length: RING }, () => new Float64Array(half + 1)), rMg = Array.from({ length: RING }, () => new Float64Array(half + 1));
  const times = new Array(T), cpp = new Array(T).fill(NaN), pci = new Array(T).fill(NaN);
  let sx = 0, sxx = 0, nq = 0; for (let q = q0; q < half; q++) { sx += q; sxx += q * q; nq++; }
  const cepOf = (C) => {   // CPP from a cepstrum (C[q] * N = the transform of the dB spectrum)
    let sy = 0, sxy = 0, pq = qLo, pv = -Infinity;
    for (let q = q0; q < half; q++) { const c = C[q] / N, v = 10 * Math.log10(c * c + 1e-12); sy += v; sxy += q * v; if (q >= qLo && q <= qHi && v > pv) { pv = v; pq = q; } }
    const beta = (nq * sxy - sx * sy) / (nq * sxx - sx * sx), alpha = (sy - beta * sx) / nq;
    return pv - (alpha + beta * pq);
  };
  for (let t = 0; t < T; t += 2) {
    const tb = t + 1 < T ? t + 1 : -1, sa = t * H, sb = tb >= 0 ? tb * H : 0;
    for (let i = 0; i < N; i++) { zr[i] = x[sa + i] * w[i]; zi[i] = tb >= 0 ? x[sb + i] * w[i] : 0; }
    fft(zr, zi);
    const live = [false, false];
    cr.fill(0); ci.fill(0);
    for (let slot = 0; slot < 2; slot++) {
      const tt = slot ? tb : t; if (tt < 0) continue;
      const ix = tt % RING, Re = rRe[ix], Im = rIm[ix], Mg = rMg[ix]; let mx = 0;
      for (let k = 0; k <= half; k++) {
        const m = (N - k) & (N - 1), ar = zr[k], ai = zi[k], br = zr[m], bi = zi[m];
        const xr = slot ? (ai + bi) / 2 : (ar + br) / 2, xi = slot ? (br - ar) / 2 : (ai - bi) / 2;
        Re[k] = xr; Im[k] = xi; const mg = Math.sqrt(xr * xr + xi * xi); Mg[k] = mg; if (mg > mx) mx = mg;
      }
      times[tt] = (tt * H + N / 2) / sr;
      const mF = Math.min(F.nF - 1, Math.floor(times[tt] / F.dt));
      if (!gate[mF] || mx <= 0) continue;
      if (tt >= 2 * sp) {
        // magnitude-weighted unit phasor of the second phase difference: |X0| e^{i(p0 - 2 p1 + p2)} = X0 conj(X1)^2 X2 / (|X1|^2 |X2|)
        const i1 = (tt - sp) % RING, i2 = (tt - 2 * sp) % RING, R1 = rRe[i1], I1 = rIm[i1], M1 = rMg[i1], R2 = rRe[i2], I2 = rIm[i2], M2 = rMg[i2];
        let cR = 0, cI = 0, cW = 0;
        for (let k = 1; k < half; k++) {
          const m0 = Mg[k], m1 = M1[k], m2 = M2[k]; if (m0 < mx * 1e-3 || m1 <= 0 || m2 <= 0) continue;
          const c1r = R1[k] * R1[k] - I1[k] * I1[k], c1i = -2 * R1[k] * I1[k];
          const pr = Re[k] * c1r - Im[k] * c1i, pim = Re[k] * c1i + Im[k] * c1r, s = 1 / (m1 * m1 * m2);
          cR += (pr * R2[k] - pim * I2[k]) * s; cI += (pr * I2[k] + pim * R2[k]) * s; cW += m0;
        }
        pci[tt] = cW > 0 ? Math.hypot(cR, cI) / cW : NaN;
      }
      // the dB spectrum is real and even, so two of them share one FFT: real part = first cepstrum, imaginary = second
      const D = slot ? ci : cr, fl = mx * mx * 1e-10;
      for (let k = 0; k <= half; k++) { const L = 10 * Math.log10(Mg[k] * Mg[k] + fl); D[k] = L; if (k > 0 && k < half) D[N - k] = L; }
      live[slot] = true;
    }
    if (!live[0] && !live[1]) continue;
    fft(cr, ci);
    if (live[0]) cpp[t] = cepOf(cr);
    if (live[1]) cpp[tb] = cepOf(ci);
  }
  const cppF = smoothNaN(toFrames(cpp, times, F), Math.max(1, Math.round(0.02 / F.dt))), pciF = smoothNaN(toFrames(pci, times, F), Math.max(1, Math.round(0.02 / F.dt)));
  return { cpp: cppF, pci: pciF, summary: { cpp: quant(cpp, 0.5), cppP90: quant(cpp, 0.9), pci: quant(pci, 0.5) } };
}

/* ---------------- 6. arrow of time: third-moment asymmetry of the log envelope (time-irreversibility) ---------------- */
// T(tau) = <D^3>/<D^2>^(3/2), D = e(t+tau) - e(t): 0 for any linear Gaussian process, > 0 for impacts, < 0 for reversed sounds.
// Central moments: a steady decay or swell inside a window (constant slope) reads 0; only rare large rises (onsets) or falls (cuts)
// tilt the measure, and it stays exactly antisymmetric under time reversal.
function irreversibility(e, lag, a, b, floorDb) {
  let m1 = 0, k = 0;
  for (let i = a; i + lag < b; i++) { if (e[i] < floorDb + 3 && e[i + lag] < floorDb + 3) continue; m1 += e[i + lag] - e[i]; k++; }
  if (k < 20) return { T: NaN, k };
  m1 /= k;
  let m2 = 0, m3 = 0;
  for (let i = a; i + lag < b; i++) { if (e[i] < floorDb + 3 && e[i + lag] < floorDb + 3) continue; const d = e[i + lag] - e[i] - m1; m2 += d * d; m3 += d * d * d; }
  if (m2 <= 0) return { T: NaN, k };
  m2 /= k; m3 /= k;
  if (m2 < 1) return { T: NaN, k };                                  // level changes under 1 dB rms: too steady to have a direction
  return { T: m3 / Math.pow(m2, 1.5), k };
}
function arrowOf(bl, F, gate) {
  const en = bl.en, n = en.length, rate = bl.rate; let pk = 0; for (const v of en) if (v > pk) pk = v;
  // playback starts and ends at the file's own quiet level: 50 ms lead-in and lead-out at its 10th percentile let an onset at
  // sample 0 or a cut at the last sample count, and keep the measure exactly antisymmetric under time reversal
  const floorDb = 10 * Math.log10(pk * 1e-8 + 1e-30), pre = Math.round(0.05 * rate), e = new Float32Array(n + 2 * pre);
  for (let i = 0; i < n; i++) e[pre + i] = 10 * Math.log10(en[i] + pk * 1e-8 + 1e-30);
  const quiet = quant(e.subarray(pre, pre + n), 0.1); e.fill(quiet, 0, pre); e.fill(quiet, pre + n);
  const lags = DESC.arrowLags.map(s => Math.max(1, Math.round(s * rate)));
  const whole = lags.map(l => irreversibility(e, l, 0, n + 2 * pre, floorDb).T);
  const W = Math.round(DESC.arrowWin * rate), step = Math.max(1, Math.round(0.05 * rate)), times = [], vals = [];
  for (let a = 0; a + W <= n || (a === 0 && n > lags[1] * 4); a += step) {
    const b = Math.min(n, a + W), tc = (a + b) / 2 / rate, mF = Math.min(F.nF - 1, Math.floor(tc / F.dt));
    const r = irreversibility(e, lags[1], a + pre, b + pre, floorDb);
    times.push(tc); vals.push(gate[mF] && r.k >= 0.3 * (b - a - lags[1]) ? r.T : NaN);
    if (b >= n) break;
  }
  return { curve: toFrames(vals, times, F), summary: { T5: whole[0], T20: whole[1], T80: whole[2] } };
}

/* ---------------- 7. information dynamics (Abdallah & Plumbley): surprisal, predictive information, model information ---------------- */
function kmeans(X, dim, K, seed) {
  const n = X.length / dim, r = rng(seed), C = new Float64Array(K * dim), lab = new Int32Array(n), d2 = new Float64Array(n);
  const dist = (i, c) => { let s = 0; for (let j = 0; j < dim; j++) { const d = X[i * dim + j] - C[c * dim + j]; s += d * d; } return s; };
  // k-means++ initialisation
  let first = Math.floor(r() * n); for (let j = 0; j < dim; j++) C[j] = X[first * dim + j];
  for (let c = 1; c < K; c++) {
    let tot = 0; for (let i = 0; i < n; i++) { let m = Infinity; for (let q = 0; q < c; q++) m = Math.min(m, dist(i, q)); d2[i] = m; tot += m; }
    let pick = r() * tot, i = 0; while (i < n - 1 && pick > d2[i]) { pick -= d2[i]; i++; }
    for (let j = 0; j < dim; j++) C[c * dim + j] = X[i * dim + j];
  }
  for (let it = 0; it < 20; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) { let bc = 0, bd = Infinity; for (let c = 0; c < K; c++) { const d = dist(i, c); if (d < bd) { bd = d; bc = c; } } if (lab[i] !== bc) { lab[i] = bc; moved++; } }
    const S = new Float64Array(K * dim), N = new Float64Array(K);
    for (let i = 0; i < n; i++) { N[lab[i]]++; for (let j = 0; j < dim; j++) S[lab[i] * dim + j] += X[i * dim + j]; }
    for (let c = 0; c < K; c++) if (N[c]) for (let j = 0; j < dim; j++) C[c * dim + j] = S[c * dim + j] / N[c];
    if (!moved && it) break;
  }
  return lab;
}
// agglomerative merge of k-means clusters whose centroids are closer than dmin; returns labels 0..K'-1
function mergeClusters(X, dim, lab, K, dmin) {
  const n = lab.length, C = Array.from({ length: K }, () => new Float64Array(dim)), N = new Float64Array(K), map = Array.from({ length: K }, (_, i) => i);
  for (let i = 0; i < n; i++) { N[lab[i]]++; for (let j = 0; j < dim; j++) C[lab[i]][j] += X[i * dim + j]; }
  for (let c = 0; c < K; c++) if (N[c]) for (let j = 0; j < dim; j++) C[c][j] /= N[c];
  const alive = new Set(); for (let c = 0; c < K; c++) if (N[c]) alive.add(c);
  for (;;) {
    let ba = -1, bb = -1, bd = Infinity; const L = [...alive];
    for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) { let d = 0; for (let j = 0; j < dim; j++) d += (C[L[x]][j] - C[L[y]][j]) ** 2; d = Math.sqrt(d); if (d < bd) { bd = d; ba = L[x]; bb = L[y]; } }
    if (bd >= dmin || ba < 0) break;
    for (let j = 0; j < dim; j++) C[ba][j] = (C[ba][j] * N[ba] + C[bb][j] * N[bb]) / (N[ba] + N[bb]);
    N[ba] += N[bb]; alive.delete(bb); for (let c = 0; c < K; c++) if (map[c] === bb) map[c] = ba;
  }
  const order = [...alive].sort((a, b) => a - b), re = new Map(order.map((c, i) => [c, i])), out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = re.get(map[lab[i]]);
  return out;
}
/** Online first-order Markov model with Dirichlet counts and forgetting. Per step: surprisal -ln a(x_t|x_t-1),
    predictive information KL(a(.|x_t) || a2(.|x_t-1)) (its mean is the PIR h(a^2) - h(a)), and model information
    KL(posterior row || prior row) for the row that was updated. opts: { beta (1 = no forgetting), alpha0 } */
function markovInfo(sym, K, opts) {
  const beta = opts && opts.beta !== undefined ? opts.beta : DESC.forget, a0 = opts && opts.alpha0 !== undefined ? opts.alpha0 : DESC.alpha0;
  const C = new Float64Array(K * K).fill(a0), rowS = new Float64Array(K).fill(a0 * K);
  const n = sym.length, sur = new Float32Array(n).fill(NaN), pi = new Float32Array(n).fill(NaN), info = new Float32Array(n).fill(NaN);
  const a2 = new Float64Array(K), row = new Float64Array(K);
  for (let t = 1; t < n; t++) {
    const i = sym[t - 1], j = sym[t];
    if (i < 0 || j < 0) continue;
    sur[t] = -Math.log(C[i * K + j] / rowS[i]);
    // two-step prediction from x_{t-1}
    a2.fill(0);
    for (let m = 0; m < K; m++) { const p = C[i * K + m] / rowS[i]; if (p < 1e-9) continue; for (let q = 0; q < K; q++) a2[q] += p * C[m * K + q] / rowS[m]; }
    let kl = 0; for (let q = 0; q < K; q++) { const p = C[j * K + q] / rowS[j]; if (p > 0) kl += p * Math.log(p / Math.max(1e-12, a2[q])); }
    pi[t] = Math.max(0, kl);
    // update row i with forgetting towards the prior
    for (let q = 0; q < K; q++) row[q] = C[i * K + q] / rowS[i];
    if (beta < 1) for (let m = 0; m < K; m++) { let s = 0; for (let q = 0; q < K; q++) { C[m * K + q] = a0 + beta * (C[m * K + q] - a0); s += C[m * K + q]; } rowS[m] = s; }
    C[i * K + j] += 1; rowS[i] += 1;
    let ki = 0; for (let q = 0; q < K; q++) { const p = C[i * K + q] / rowS[i]; if (p > 0) ki += p * Math.log(p / Math.max(1e-12, row[q])); }
    info[t] = ki;
  }
  return { surprisal: sur, pi, info };
}
function mfccFrames(F, rate, gate) {
  const B = 40, n = F.nF, step = Math.max(1, Math.round(1 / rate / F.dt)), T = Math.ceil(n / step), D = 12;
  const out = new Float32Array(T * D), sil = new Uint8Array(T), times = new Float32Array(T), mel = new Float64Array(B);
  for (let t = 0; t < T; t++) {
    const a = t * step, b = Math.min(n, a + step); mel.fill(0); let g = 0;
    for (let m = a; m < b; m++) { g += gate[m]; for (let k = 0; k < B; k++) mel[k] += F.melDb[m * B + k] / (b - a); }
    sil[t] = g < (b - a) / 2 ? 1 : 0; times[t] = ((a + b) / 2) * F.dt;
    for (let d = 1; d <= D; d++) { let s = 0; for (let k = 0; k < B; k++) s += mel[k] * Math.cos(Math.PI * d * (k + 0.5) / B); out[t * D + d - 1] = s * Math.sqrt(2 / B); }
  }
  return { X: out, D, T, sil, times, step };
}
function infoOf(F, gate) {
  const M = mfccFrames(F, DESC.symRate, gate), idx = []; for (let t = 0; t < M.T; t++) if (!M.sil[t]) idx.push(t);
  if (idx.length < 20) return { surprisal: new Float32Array(F.nF).fill(NaN), pir: new Float32Array(F.nF).fill(NaN), info: new Float32Array(F.nF).fill(NaN), summary: { pir: NaN, surprisal: NaN, info: NaN, K: 0 } };
  const K = Math.max(2, Math.min(DESC.symK, Math.floor(idx.length / 4)));
  const Xs = new Float32Array(idx.length * M.D); idx.forEach((t, i) => Xs.set(M.X.subarray(t * M.D, (t + 1) * M.D), i * M.D));
  const lab0 = kmeans(Xs, M.D, K, 11), lab = mergeClusters(Xs, M.D, lab0, K, DESC.symMergeDist), K2 = Math.max(...lab) + 1, sym = new Int32Array(M.T).fill(K2);
  idx.forEach((t, i) => { sym[t] = lab[i]; });
  const r = markovInfo(sym, K2 + 1, {});
  const half = Math.max(1, Math.round(0.25 * DESC.symRate));
  const sm = a => smoothNaN(a.map((v, t) => M.sil[t] ? NaN : v), half);
  const times = Array.from(M.times);
  const s = sm(r.surprisal), p = sm(r.pi), inf = sm(r.info);
  return { surprisal: toFrames(s, times, F), pir: toFrames(p, times, F), info: toFrames(inf, times, F), summary: { pir: meanF(r.pi.filter((_, t) => !M.sil[t])), surprisal: meanF(r.surprisal.filter((_, t) => !M.sil[t])), info: meanF(r.info.filter((_, t) => !M.sil[t])), K: K2 } };
}

// k-th smallest value (Hoare selection on a copy), O(n) instead of a full sort
function kth(src, k) {
  const a = Float64Array.from(src); let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const p = a[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (a[i] < p) i++; while (a[j] > p) j--; if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}
/* ---------------- 8. recurrence quantification on the self-similarity of timbre and harmony ---------------- */
function recurrenceOf(F, gate, dur) {
  const rate = Math.min(DESC.recRate, DESC.recMax / Math.max(1, dur)), M = mfccFrames(F, rate, gate), n = M.T, D = M.D;
  const step = M.step, chroma = new Float32Array(n * 12);
  for (let t = 0; t < n; t++) { let s = 0; for (let m = t * step; m < Math.min(F.nF, (t + 1) * step); m++) for (let p = 0; p < 12; p++) { chroma[t * 12 + p] += F.chroma[m * 12 + p]; s += F.chroma[m * 12 + p]; } if (s > 0) for (let p = 0; p < 12; p++) chroma[t * 12 + p] /= s; }
  const dist = (i, j) => { let s = 0; for (let d = 0; d < D; d++) { const v = (M.X[i * D + d] - M.X[j * D + d]) / 10; s += v * v; } for (let p = 0; p < 12; p++) { const v = chroma[i * 12 + p] - chroma[j * 12 + p]; s += v * v; } return Math.sqrt(s); };
  const w = Math.max(1, Math.round(DESC.recTheiler * rate)), Dm = new Float32Array(n * n);
  let off = new Float64Array(Math.max(1, n * (n - 1) / 2)), no = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist(i, j); Dm[i * n + j] = d; Dm[j * n + i] = d; if (j - i >= w && !M.sil[i] && !M.sil[j]) off[no++] = d; }
  off = off.subarray(0, no);
  const nan = () => new Float32Array(F.nF).fill(NaN);
  if (n < 2 * w + 4 || off.length < 50) return { density: nan(), lam: nan(), summary: { RR: NaN, DET: NaN, LAM: NaN, TT: NaN, eps: NaN } };
  const eps = Math.min(DESC.recEpsHi, Math.max(kth(off, Math.floor(0.1 * (off.length - 1))), DESC.recEpsLo));
  const R = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) R[i] = Dm[i] <= eps ? 1 : 0;
  for (let t = 0; t < n; t++) if (M.sil[t]) for (let j = 0; j < n; j++) { R[t * n + j] = 0; R[j * n + t] = 0; }
  const dens = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { if (M.sil[i]) continue; let s = 0, k = 0; for (let j = 0; j < n; j++) { if (Math.abs(i - j) < w || M.sil[j]) continue; s += R[i * n + j]; k++; } if (k) dens[i] = s / k; }
  // line statistics on a sub-square [a,b): DET on diagonals at lag >= minLag, LAM and TT on vertical lines (main diagonal excluded)
  const lines = (a, b, minLag) => {
    const L = DESC.recLmin; let rec = 0, det = 0, recV = 0, lamP = 0, vSum = 0, vN = 0;
    for (let k = minLag; k < b - a; k++) { let run = 0; for (let i = a; i + k < b; i++) { const r = R[i * n + i + k]; if (r) { run++; rec++; } if (!r || i + k === b - 1) { if (run >= L) det += run; run = 0; } } }
    for (let j = a; j < b; j++) { let run = 0; for (let i = a; i < b; i++) { const r = i !== j && R[i * n + j]; if (r) { run++; recV++; } if (!r || i === b - 1) { if (run >= L) { lamP += run; vSum += run; vN++; } run = 0; } } }
    return { DET: rec ? det / rec : NaN, LAM: recV ? lamP / recV : NaN, TT: vN ? vSum / vN / rate : NaN, rec };
  };
  const whole = lines(0, n, w);
  let RR = 0, RN = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (Math.abs(i - j) >= w && !M.sil[i] && !M.sil[j]) { RR += R[i * n + j]; RN++; }
  const Wb = Math.min(n, DESC.recBlock), sb = Math.max(1, Wb >> 2), lt = [], lv = [];
  for (let a = 0; a + Wb <= n; a += sb) { const r = lines(a, a + Wb, 1); lt.push((a + Wb / 2) / rate); let silent = 0; for (let t = a; t < a + Wb; t++) silent += M.sil[t]; lv.push(silent > Wb / 2 ? NaN : r.LAM); }
  return { density: toFrames(Array.from(dens), Array.from(M.times), F), lam: toFrames(lv, lt, F), summary: { RR: RN ? RR / RN : NaN, DET: whole.DET, LAM: whole.LAM, TT: whole.TT, eps } };
}

/* ---------------- 9. decay and material: Schroeder band decays after events (room and impact acoustics) ---------------- */
// Per band T60 from the backward-integrated energy (-5 to -25 dB), amplitude damping b = 60/(8.686*T60) and
// Klatzky's frequency-independent tau_d = f/b; log10(tau_d) sorts damped (rubber, wood) < glass < metal. Reverb reads as metal.
const MAT_NAMES = ["damped (rubber, wood)", "glass-like", "metal-like"];
function decaysOf(F, events, gate) {
  const B = 40, groups = [[40, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
  const gb = groups.map(([lo, hi]) => { const ks = []; for (let b = 0; b < B; b++) { const c = melCentre(F, b); if (c >= lo && c < hi) ks.push(b); } return ks; });
  const out = [];
  const ev = events.filter(e => e.peakDb > -60);
  for (let q = 0; q < ev.length && out.length < 200; q++) {
    const a = Math.floor(ev[q].t0 / F.dt), end = Math.min(F.nF, q + 1 < ev.length ? Math.floor(ev[q + 1].t0 / F.dt) : F.nF);
    if ((end - a) * F.dt < DESC.decayMin) continue;
    const res = []; let fastBands = 0;
    // impact-like: the broadband peak comes within 60 ms of the start, and the level falls at least 20 dB before the next event
    { let pm = a, pv = -1; for (let m = a; m < end; m++) if (F.kz[m] > pv) { pv = F.kz[m]; pm = m; } let lo = Infinity; for (let m = pm; m < end; m++) lo = Math.min(lo, F.kz[m]); if ((pm - a) * F.dt > 0.06 || !(lo < pv * 0.01)) continue; }
    gb.forEach((ks, gi) => {
      if (!ks.length) return; const fb0 = fastBands;
      const E = new Float64Array(end - a); for (let m = a; m < end; m++) { let s = 0; for (const b of ks) s += Math.pow(10, F.melDb[m * B + b] / 10); E[m - a] = s; }
      let p = 0; for (let i = 0; i < Math.min(E.length, Math.round(0.06 / F.dt) + 1); i++) if (E[i] > E[p]) p = i;
      const tail0 = E.slice(p), nT0 = tail0.length; if (nT0 < 4) return;
      const floor = quant(Array.from(tail0.slice(Math.floor(nT0 * 0.85))), 0.5);
      if (!(tail0[0] > floor * 300)) return;                       // needs 25 dB above the band's floor
      // truncate where the band first reaches 6 dB above its floor (Lundeby-style), so noise does not stretch the decay
      let cut = nT0; for (let i = 1; i < nT0 - 1; i++) if (tail0[i] < floor * 4 && tail0[i + 1] < floor * 4) { cut = i; break; }
      const tail = tail0.slice(0, cut), nT = tail.length;
      const edc = new Float64Array(nT); let s = 0; for (let i = nT - 1; i >= 0; i--) { s += Math.max(0, tail[i] - floor); edc[i] = s; }
      if (edc[0] <= 0) return;
      const pts = []; for (let i = 0; i < nT; i++) { const d = 10 * Math.log10(edc[i] / edc[0] + 1e-30); if (d <= -5 && d >= -25) pts.push([i * F.dt, d]); if (d < -25) break; }
      let slope;
      if (pts.length >= 4) {
        const mx = meanF(pts.map(v => v[0])), my = meanF(pts.map(v => v[1]));
        let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); syy += (y - my) * (y - my); }
        slope = sxy / sxx;
        if (sxy * sxy / (sxx * syy) < 0.9) return;                 // not a single exponential decay
      } else if (cut < nT0 && cut <= 4) {
        slope = 10 * Math.log10(floor * 4 / tail0[0]) / Math.max(F.dt, cut * F.dt);   // faster than the frame rate: bound from the floor crossing
        fastBands++;
      } else return;
      // the band's energy centroid at the peak stands for its mode frequency (fixed band centres would jump when a mode crosses an edge)
      let ce = 0, cw = 0; for (const bb of ks) { const e = Math.pow(10, F.melDb[(a + p) * B + bb] / 10); ce += e * melCentre(F, bb); cw += e; }
      const t60 = -60 / slope, bAmp = -slope / (20 * LOG10E), fc = cw > 0 ? ce / cw : Math.sqrt(groups[gi][0] * groups[gi][1]);
      res.push({ fc, t60, logTau: Math.log10(fc / bAmp), w: tail[0], b: bAmp, fast: fastBands > fb0 });
    });
    if (!res.length) continue;
    const wmed = key => { const v = res.slice().sort((x, y) => x[key] - y[key]), tot = v.reduce((s, r) => s + r.w, 0); let c = 0; for (const r of v) { c += r.w; if (c >= tot / 2) return r[key]; } return v[v.length - 1][key]; };
    const t60 = wmed("t60");
    // modal damping grows with frequency (b = pi tan(phi) f); a flat b(f) is a room, a noise burst or an envelope, not a material
    const slow = res.filter(r => !r.fast);
    let expo = NaN; if (slow.length >= 3) { const xs = slow.map(r => Math.log10(r.fc)), ys = slow.map(r => Math.log10(r.b)), mx = meanF(xs), my = meanF(ys); let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); }); expo = sxy / sxx; }
    let logTau = NaN, cls = -1;
    if (slow.length === 0) cls = 0;                                    // everything decays faster than we can resolve: very damped
    else if (slow.length < 3 || expo >= 0.5) { const v = slow.slice().sort((x, y) => x.logTau - y.logTau), tot = v.reduce((a, r) => a + r.w, 0); let c = 0; for (const r of v) { c += r.w; if (c >= tot / 2) { logTau = r.logTau; break; } } cls = logTau < DESC.materialEdges[0] ? 0 : logTau < DESC.materialEdges[1] ? 1 : 2; }
    out.push({ t: ev[q].t0, peakDb: ev[q].peakDb, t60, logTau, cls, expo, bands: res.length });
  }
  const tot = out.reduce((s, d) => s + Math.pow(10, d.peakDb / 10), 0);
  const wq = key => { const v = out.slice().sort((x, y) => x[key] - y[key]); let c = 0; for (const d of v) { c += Math.pow(10, d.peakDb / 10); if (c >= tot / 2) return d[key]; } return NaN; };
  const mod = out.filter(d => d.cls >= 0), counts = [0, 0, 0]; for (const d of mod) counts[d.cls] += Math.pow(10, d.peakDb / 10);
  const top = mod.length ? counts.indexOf(Math.max(...counts)) : -1, lt = out.filter(d => isFinite(d.logTau));
  const logTau = lt.length ? (() => { const v = lt.slice().sort((x, y) => x.logTau - y.logTau), tt = v.reduce((a, d) => a + Math.pow(10, d.peakDb / 10), 0); let c = 0; for (const d of v) { c += Math.pow(10, d.peakDb / 10); if (c >= tt / 2) return d.logTau; } return NaN; })() : NaN;
  return { decays: out, summary: { n: out.length, t60: out.length ? wq("t60") : NaN, logTau, material: top >= 0 ? MAT_NAMES[top] : (out.length ? "not modal" : ""), modal: mod.length } };
}

/* ---------------- all together ---------------- */
async function describe(F, buf) {
  if (F._desc) return F._desc;
  const tick = () => new Promise(r => setTimeout(r, 0));
  // per-stage timing (ms), reported in D.timing for tools/profile.js
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()), T = {}; let t0 = now();
  const lap = k => { const t = now(); T[k] = (T[k] || 0) + t - t0; t0 = t; };
  const x0 = monoOf(buf), sr = buf.sampleRate, dur = buf.duration, gate = frameGate(F);
  const x = x0.length >= 8192 ? x0 : (() => { const p = new Float32Array(8192); p.set(x0); return p; })();
  const st = shortStft(x, sr, dur); lap("shortStft"); await tick(); t0 = now();
  const kurt = kurtosisOf(st, F, gate, dur); lap("kurtosis");
  const rep = repetitionOf(st, F, gate, dur); lap("repetition"); await tick(); t0 = now();
  const bl = blocks(x0, sr, 1);
  const events = staLta(bl.amp, bl.rate);
  const starts = events.map(e => e.t0), bv = bValue(events.map(e => e.peakDb / 20));
  const bl10 = blocks(x0, sr, 10), htW = Math.round(2 * bl10.rate), htT = [], htV = [];
  for (let a = 0; a < bl10.en.length; a += Math.max(1, Math.round(0.1 * bl10.rate))) { const b = Math.min(bl10.en.length, a + htW); htT.push((a + b) / 2 / bl10.rate); htV.push(gate[Math.min(F.nF - 1, Math.floor((a + b) / 2 / bl10.rate / F.dt))] ? temporalEntropy(bl10.en, a, b) : NaN); if (b >= bl10.en.length) break; }
  let act = 0; for (const e of events) act += e.t1 - e.t0;
  lap("events");
  const evSum = { n: events.length, rate: events.length / Math.max(1e-6, dur), meanDur: events.length ? act / events.length : NaN, active: act / Math.max(1e-6, dur), B: burstiness(starts), bValue: bv.b, bN: bv.n, Ht: temporalEntropy(bl10.en, 0, bl10.en.length) };
  await tick(); t0 = now();
  const mot = motionOf(F, gate); lap("motion");
  const cp = cppOf(x, sr, F, gate, dur); lap("cpp"); await tick(); t0 = now();
  const arr = arrowOf(bl, F, gate); lap("arrow");
  const inf = infoOf(F, gate); lap("info"); await tick(); t0 = now();
  const rec = recurrenceOf(F, gate, dur); lap("recurrence"); await tick(); t0 = now();
  const dec = decaysOf(F, events, gate); lap("decay");
  const D = {
    curves: { kurt: kurt.curve, kurtLocal: kurt.local, kurtHz: kurt.hz, repHz: rep.hz, repProm: rep.prom, ht: toFrames(htV, htT, F), vel: mot.vel, reshape: mot.reshape, cpp: cp.cpp, pci: cp.pci, arrow: arr.curve, surprisal: inf.surprisal, pir: inf.pir, info: inf.info, recDensity: rec.density, lam: rec.lam },
    events, decays: dec.decays, kurtSig: kurt.sig, timing: T,
    summary: { kurtosis: kurt.summary, repetition: rep.summary, events: evSum, motion: mot.summary, periodicity: cp.summary, arrow: arr.summary, info: inf.summary, recurrence: rec.summary, decay: dec.summary }
  };
  F._desc = D;
  return D;
}

const api = { describe, DESC, poolNaN, burstiness, bValue, temporalEntropy, irreversibility, markovInfo, kmeans, staLta, blocks, MAT_NAMES };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.PHD = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
