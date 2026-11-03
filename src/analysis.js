// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead

(function (root) {
"use strict";

/* ===================================================================
   FFT (radix-2, precomputed tables)
   =================================================================== */
const fftCache = {};
function getFFT(n) {
  if (fftCache[n]) return fftCache[n];
  const levels = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = -Math.sin(2 * Math.PI * i / n); }
  const f = function (re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const c = cs[k], s = sn[k];
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
  fftCache[n] = f;
  return f;
}
function hannP(n) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; }

/* ===================================================================
   Constants
   =================================================================== */
const BARK_EDGES = [20, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500];
const NBARK = 24;
const NCOARSE = 12;                  // pairs of Bark bands
const NMEL = 40;
/* Tunable feature and detection parameters (tools/tune.js calibrates them on real recordings).
   melFloorDb: absolute floor of the mel spectrum; melRelDb > 0 replaces it by (file maximum - melRelDb), which makes every
   mel-based measure invariant to playback level. keepRaw stores the unfloored spectrum so the floor can be changed later. */
// melRelDb 80 and the recurrence range in descriptors.js were frozen by tools/tune.js on half of a 73-file corpus (held-out half: 94.1 % -> 95.8 %)
const FEAT = { melFloorDb: -80, melRelDb: 80, keepRaw: false };
const ONSET = { min: 0.6, madK: 1.5 };
function applyMelFloor(src, dst) {
  let mx = -Infinity; for (let i = 0; i < src.length; i++) if (src[i] > mx) mx = src[i];
  const fl = FEAT.melRelDb > 0 ? Math.max(-140, mx - FEAT.melRelDb) : FEAT.melFloorDb;
  for (let i = 0; i < src.length; i++) dst[i] = src[i] > fl ? src[i] : fl;
  return dst;
}
const CHROMA_EXP = 1.0;   // power-weighted peaks: suppresses weak harmonics
// Aures roughness carrier weighting g(z), z = 0..24 Bark (MoSQITo _gzi_weighting)
const G_AURES = [0.15, 0.26, 0.38, 0.47, 0.54, 0.65, 0.76, 0.83, 0.90, 0.98, 0.98, 0.90, 0.80, 0.70, 0.62, 0.54, 0.49, 0.43, 0.39, 0.35, 0.30, 0.30, 0.30, 0.30, 0.30];
// Tonal Interval Vector weights (Bernardes et al.)
const TIV_W = [3, 8, 11.5, 15, 14.5, 7.5];
const TIV_NORM = Math.sqrt(TIV_W.reduce((a, w) => a + w * w, 0));

function terhardtLTQ(f) {
  const k = Math.max(f, 20) / 1000;
  return 3.64 * Math.pow(k, -0.8) - 6.5 * Math.exp(-0.6 * (k - 3.3) * (k - 3.3)) + 1e-3 * Math.pow(k, 4);
}
const BARK_LTQ = [], BARK_LTQF = [];
for (let i = 0; i < NBARK; i++) {
  const fc = Math.sqrt(BARK_EDGES[i] * BARK_EDGES[i + 1]);
  const ltq = Math.min(60, terhardtLTQ(fc));
  BARK_LTQ.push(ltq);
  BARK_LTQF.push(0.0635 * Math.pow(10, 0.025 * ltq));
}
// DIN 45692 sharpness weighting at band centres
const SHARP_G = [];
for (let i = 0; i < NBARK; i++) { const z = i + 0.5; SHARP_G.push(z <= 15.8 ? 1 : 0.15 * Math.exp(0.42 * (z - 15.8)) + 0.85); }

function kFilterCoeffs(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return [s1, s2];
}
function biquadInto(x, out, c) {
  const b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    out[i] = y;
  }
}

const tick = () => new Promise(r => setTimeout(r, 0));
const DT_REF = 512 / 44100;

/* ===================================================================
   Stage 1: frame features (the expensive pass, cached per file)
   =================================================================== */
async function extractFeatures(buf, onProgress, opts) {
  onProgress = onProgress || function () {};
  const sr = buf.sampleRate;
  const nch = Math.min(2, buf.numberOfChannels);
  const L = buf.getChannelData(0);
  const R = nch > 1 ? buf.getChannelData(1) : null;
  const len = L.length, dur = len / sr;
  const fine = !(opts && opts.coarse) && dur <= 6;
  const N = fine ? 1024 : 2048, H = fine ? 128 : (dur > 600 ? 1024 : 512);
  const nF = Math.max(1, Math.ceil(len / H));
  const dt = H / sr;
  const fft = getFFT(N);
  const win = hannP(N);
  let w2 = 0; for (let i = 0; i < N; i++) w2 += win[i] * win[i];
  const pnorm = 2 / (N * w2);
  const binHz = sr / N, half = N / 2;
  const nyq = sr / 2;

  /* --- K-weighted energy per block --- */
  const kz = new Float32Array(nF);
  const pk = new Float32Array(nF * 2);
  {
    const coeffs = kFilterCoeffs(sr);
    const chans = R ? [L, R] : [L];
    const tmp = new Float32Array(len), tmp2 = new Float32Array(len);
    for (let c = 0; c < chans.length; c++) {
      biquadInto(chans[c], tmp, coeffs[0]);
      biquadInto(tmp, tmp2, coeffs[1]);
      for (let m = 0; m < nF; m++) {
        const s0 = m * H, s1 = Math.min(len, s0 + H);
        let e = 0, p = 0;
        const src = chans[c];
        for (let s = s0; s < s1; s++) { e += tmp2[s] * tmp2[s]; const a = Math.abs(src[s]); if (a > p) p = a; }
        kz[m] += s1 > s0 ? e / (s1 - s0) : 0;
        pk[m * 2 + c] = p;
      }
    }
    if (!R) for (let m = 0; m < nF; m++) pk[m * 2 + 1] = pk[m * 2];
  }
  onProgress(0.05);
  await tick();

  /* --- band maps --- */
  const kLo = Math.max(1, Math.floor(20 / binHz));
  const barkBin = new Int16Array(half).fill(-1);
  for (let k = 1; k < half; k++) {
    const f = k * binHz;
    for (let b = 0; b < NBARK; b++) if (f >= BARK_EDGES[b] && f < BARK_EDGES[b + 1]) { barkBin[k] = b; break; }
  }
  const melLo = 40, melHi = Math.min(16000, nyq * 0.95);
  const mel = f => 2595 * Math.log10(1 + f / 700);
  const imel = m => 700 * (Math.pow(10, m / 2595) - 1);
  const melPts = [];
  for (let i = 0; i < NMEL + 2; i++) melPts.push(imel(mel(melLo) + (mel(melHi) - mel(melLo)) * i / (NMEL + 1)));
  const melW = [];   // per band: [kStart, weights...]
  for (let b = 0; b < NMEL; b++) {
    const f0 = melPts[b], f1 = melPts[b + 1], f2 = melPts[b + 2];
    const ks = Math.max(1, Math.floor(f0 / binHz)), ke = Math.min(half - 1, Math.ceil(f2 / binHz));
    const ws = [];
    for (let k = ks; k <= ke; k++) {
      const f = k * binHz;
      let w = f < f1 ? (f - f0) / (f1 - f0) : (f2 - f) / (f2 - f1);
      ws.push(Math.max(0, w));
    }
    let sum = 0; for (const w of ws) sum += w;
    if (sum < 1e-9) { ws.length = 0; ws.push(1); }
    melW.push({ ks, ws });
  }
  const sfmLo = Math.max(1, Math.floor(50 / binHz)), sfmHi = Math.min(half - 1, Math.floor(Math.min(16000, nyq * 0.95) / binHz));
  const chLo = Math.max(2, Math.floor(200 / binHz)), chHi = Math.min(half - 2, Math.floor(5000 / binHz));

  const melDb = new Float32Array(nF * NMEL);
  const bark = new Float32Array(nF * NBARK);
  const chroma = new Float32Array(nF * 12);
  const sfm = new Float32Array(nF);
  const re = new Float64Array(N), im = new Float64Array(N);
  const P = new Float64Array(half);

  for (let m = 0; m < nF; m++) {
    const start = m * H + (H >> 1) - (N >> 1);
    for (let i = 0; i < N; i++) {
      const s = start + i;
      if (s >= 0 && s < len) { re[i] = L[s] * win[i]; im[i] = R ? R[s] * win[i] : 0; }
      else { re[i] = 0; im[i] = 0; }
    }
    fft(re, im);
    if (R) {
      for (let k = 1; k < half; k++) {
        const j = N - k;
        P[k] = 0.5 * (re[k] * re[k] + im[k] * im[k] + re[j] * re[j] + im[j] * im[j]) * pnorm;
      }
    } else {
      for (let k = 1; k < half; k++) P[k] = (re[k] * re[k] + im[k] * im[k]) * pnorm;
    }
    // bark energies
    const bo = m * NBARK;
    for (let k = kLo; k < half; k++) { const b = barkBin[k]; if (b >= 0) bark[bo + b] += P[k]; }
    // mel dB
    const mo = m * NMEL;
    for (let b = 0; b < NMEL; b++) {
      const mw = melW[b];
      let e = 0;
      for (let i = 0; i < mw.ws.length; i++) e += mw.ws[i] * P[mw.ks + i];
      melDb[mo + b] = 10 * Math.log10(Math.max(e, 1e-14));
    }
    // spectral flatness (bin level)
    let ls = 0, as = 0, cnt = 0;
    for (let k = sfmLo; k <= sfmHi; k++) { const v = P[k] + 1e-14; ls += Math.log(v); as += v; cnt++; }
    sfm[m] = as > 1e-11 ? Math.exp(ls / cnt) / (as / cnt) : 0;
    // chroma from interpolated spectral peaks
    let pmax = 0;
    for (let k = chLo; k <= chHi; k++) if (P[k] > pmax) pmax = P[k];
    if (pmax > 1e-11) {
      const thr = pmax * 1e-5; // -50 dB
      const co = m * 12;
      for (let k = chLo; k <= chHi; k++) {
        const v = P[k];
        if (v > thr && v > P[k - 1] && v >= P[k + 1]) {
          const a = Math.log(P[k - 1] + 1e-20), b = Math.log(v + 1e-20), c = Math.log(P[k + 1] + 1e-20);
          const den = a - 2 * b + c;
          const d = den !== 0 ? 0.5 * (a - c) / den : 0;
          const f = (k + Math.max(-0.5, Math.min(0.5, d))) * binHz;
          const midi = 69 + 12 * Math.log2(f / 440);
          const pc = ((Math.round(midi) % 12) + 12) % 12;
          chroma[co + pc] += Math.pow(v, CHROMA_EXP);
        }
      }
    }
    if ((m & 255) === 255) { onProgress(0.05 + 0.6 * m / nF); await tick(); }
  }
  onProgress(0.65);
  await tick();

  /* --- fine envelope pass for roughness (30-150 Hz modulation) --- */
  const N2 = 256, H2 = 128;
  const fft2 = getFFT(N2), win2 = hannP(N2);
  let w22 = 0; for (let i = 0; i < N2; i++) w22 += win2[i] * win2[i];
  const pn2 = 2 / (N2 * w22), bin2 = sr / N2;
  const coarseEdges = [];
  for (let c = 0; c <= NCOARSE; c++) coarseEdges.push(BARK_EDGES[Math.min(c * 2, NBARK)]);
  const cBin = new Int8Array(N2 / 2).fill(-1);
  for (let k = 1; k < N2 / 2; k++) {
    const f = k * bin2;
    for (let c = 0; c < NCOARSE; c++) if (f >= coarseEdges[c] && f < coarseEdges[c + 1]) { cBin[k] = c; break; }
  }
  const nE = Math.max(1, Math.ceil(len / H2));
  const env = new Float32Array(nE * NCOARSE);
  const re2 = new Float64Array(N2), im2 = new Float64Array(N2);
  for (let n = 0; n < nE; n++) {
    const start = n * H2 + (H2 >> 1) - (N2 >> 1);
    for (let i = 0; i < N2; i++) {
      const s = start + i;
      if (s >= 0 && s < len) { re2[i] = L[s] * win2[i]; im2[i] = R ? R[s] * win2[i] : 0; }
      else { re2[i] = 0; im2[i] = 0; }
    }
    fft2(re2, im2);
    const eo = n * NCOARSE;
    for (let k = 1; k < N2 / 2; k++) {
      const c = cBin[k]; if (c < 0) continue;
      const j = N2 - k;
      const p = R ? 0.5 * (re2[k] * re2[k] + im2[k] * im2[k] + re2[j] * re2[j] + im2[j] * im2[j]) : (re2[k] * re2[k] + im2[k] * im2[k]);
      env[eo + c] += p * pn2;
    }
    if ((n & 2047) === 2047) { onProgress(0.65 + 0.2 * n / nE); await tick(); }
  }
  for (let i = 0; i < env.length; i++) env[i] = Math.sqrt(env[i]);
  const envRate = sr / H2;
  // modulation analysis blocks
  const LB = 64, HB = 16, MB = 128;
  const fftB = getFFT(MB), winB = hannP(LB);
  let wB2 = 0; for (let i = 0; i < LB; i++) wB2 += winB[i] * winB[i];
  const kR0 = Math.ceil(30 * MB / envRate), kR1 = Math.floor(150 * MB / envRate);
  const nB = Math.max(1, Math.floor((nE - LB) / HB) + 1);
  const rough = new Float32Array(nB * NCOARSE);
  const roughT = new Float32Array(nB);
  const reB = new Float64Array(MB), imB = new Float64Array(MB);
  for (let j = 0; j < nB; j++) {
    const e0 = j * HB;
    roughT[j] = ((e0 + LB / 2) * H2 + H2 / 2) / sr;
    for (let c = 0; c < NCOARSE; c++) {
      let mean = 0, n = 0;
      for (let i = 0; i < LB; i++) { const idx = e0 + i; if (idx < nE) { mean += env[idx * NCOARSE + c]; n++; } }
      mean = n ? mean / n : 0;
      if (mean < 3e-5) { rough[j * NCOARSE + c] = 0; continue; }
      reB.fill(0); imB.fill(0);
      for (let i = 0; i < LB; i++) { const idx = e0 + i; const v = idx < nE ? env[idx * NCOARSE + c] : mean; reB[i] = (v - mean) * winB[i]; }
      fftB(reB, imB);
      let pw = 0;
      for (let k = kR0; k <= kR1; k++) pw += reB[k] * reB[k] + imB[k] * imB[k];
      pw = pw * 2 / (MB * wB2);
      rough[j * NCOARSE + c] = pw / (mean * mean);
    }
  }
  onProgress(0.95);
  await tick();

  const melRaw = FEAT.keepRaw ? Float32Array.from(melDb) : null;
  applyMelFloor(melDb, melDb);
  return {
    sr, len, dur, H, N, nF, dt, nch, fine,
    kz, pk, melDb, melRaw, bark, chroma, sfm,
    rough, roughT, nB
  };
}

/* ===================================================================
   Helpers for stage 2
   =================================================================== */
function prefix(a) { const p = new Float64Array(a.length + 1); for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i]; return p; }
function movMean(a, half) {
  const p = prefix(a), n = a.length, o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const s = Math.max(0, i - half), e = Math.min(n, i + half + 1); o[i] = (p[e] - p[s]) / (e - s); }
  return o;
}
function movMax(a, half) {
  const n = a.length, o = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = -Infinity; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (a[j] > m) m = a[j]; o[i] = m; }
  return o;
}
function decimatedStat(a, half, step, fn) {
  const n = a.length, o = new Float32Array(n);
  const pts = [];
  for (let c = 0; c < n; c += step) {
    const s = Math.max(0, c - half), e = Math.min(n, c + half + 1);
    pts.push([c, fn(a, s, e)]);
  }
  if (pts.length === 0) return o;
  if (pts[pts.length - 1][0] !== n - 1) { const c = n - 1; pts.push([c, fn(a, Math.max(0, c - half), n)]); }
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < pts.length - 2 && pts[j + 1][0] < i) j++;
    const [x0, y0] = pts[j], [x1, y1] = pts[Math.min(j + 1, pts.length - 1)];
    o[i] = x1 === x0 ? y0 : y0 + (y1 - y0) * (i - x0) / (x1 - x0);
  }
  return o;
}
function sliceSortedQ(a, s, e, q) {
  const t = a.subarray(s, e).slice().sort();
  if (!t.length) return 0;
  return t[Math.min(t.length - 1, Math.floor(q * (t.length - 1) + 0.5))];
}
function runQuantile(a, half, step, q) { return decimatedStat(a, half, step, (arr, s, e) => sliceSortedQ(arr, s, e, q)); }
function runMAD(a, half, step) {
  return decimatedStat(a, half, step, (arr, s, e) => {
    const t = arr.subarray(s, e).slice().sort();
    if (!t.length) return 0;
    const med = t[t.length >> 1];
    const d = t.map(v => Math.abs(v - med)).sort();
    return d[d.length >> 1];
  });
}
function asym(a, dt, ta, tr) {
  const n = a.length, o = new Float32Array(n);
  const aa = 1 - Math.exp(-dt / ta), ar = 1 - Math.exp(-dt / tr);
  let y = a[0] || 0;
  for (let i = 0; i < n; i++) { const x = a[i]; y += (x > y ? aa : ar) * (x - y); o[i] = y; }
  return o;
}
function onePole(a, dt, tau) {
  const n = a.length, o = new Float32Array(n), k = 1 - Math.exp(-dt / tau);
  let y = 0; for (let i = 0; i < n; i++) { y += k * (a[i] - y); o[i] = y; }
  return o;
}
function quantileMasked(a, mask, q) {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) k++;
  if (!k) return 0;
  const t = new Float32Array(k);
  k = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) t[k++] = a[i];
  t.sort();
  return t[Math.min(t.length - 1, Math.floor(q * (t.length - 1) + 0.5))];
}
function slopeCentered(y, half) {
  // least-squares slope per frame over [i-half, i+half]
  const n = y.length, o = new Float32Array(n);
  const Sy = new Float64Array(n + 1), Sxy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { Sy[i + 1] = Sy[i] + y[i]; Sxy[i + 1] = Sxy[i] + i * y[i]; }
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - half), e = Math.min(n - 1, i + half), m = e - s + 1;
    if (m < 3) { o[i] = 0; continue; }
    const sx = (s + e) * m / 2;
    const sxx = (e * (e + 1) * (2 * e + 1) - (s - 1) * s * (2 * s - 1)) / 6;
    const sy = Sy[e + 1] - Sy[s], sxy = Sxy[e + 1] - Sxy[s];
    const den = m * sxx - sx * sx;
    o[i] = den > 0 ? (m * sxy - sx * sy) / den : 0;
  }
  return o;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function interpTimes(t, v, frames, dt) {
  // v sampled at times t (ascending), returns per-frame values
  const o = new Float32Array(frames);
  if (!t.length) return o;
  let j = 0;
  for (let m = 0; m < frames; m++) {
    const tm = (m + 0.5) * dt;
    while (j < t.length - 2 && t[j + 1] < tm) j++;
    if (t.length === 1 || tm <= t[0]) { o[m] = v[0]; continue; }
    if (tm >= t[t.length - 1]) { o[m] = v[t.length - 1]; continue; }
    const t0 = t[j], t1 = t[j + 1];
    o[m] = v[j] + (v[j + 1] - v[j]) * (tm - t0) / (t1 - t0);
  }
  return o;
}

/* ===================================================================
   Asset classes (settings per class, from the report's matrix)
   =================================================================== */
const CLASSES = {
  rhythmic:   { label: "Rhythmic music",  lw: 0.4,  ta: 0.2,   tr: 1.5,  tension: true,  harmony: true,  surprise: true },
  orchestral: { label: "Orchestral / tonal", lw: 0.4, ta: 0.2, tr: 1.5,  tension: true,  harmony: true,  surprise: true },
  sfx:        { label: "One-shot SFX",    lw: 0.05, ta: 0.022, tr: 0.05, tension: false, harmony: false, surprise: false },
  ambience:   { label: "Ambience / drone", lw: 3.0, ta: 0.2,   tr: 1.5,  tension: true,  harmony: false, surprise: true }
};

/* Fixed reference ranges used when secondary curves are scaled against a
   library-wide reference instead of per asset. Tuned on the probe suite. */
const REF = { A: 1.2, ED: 8, D: 12, SFM: 0.35, HARM: [0.15, 0.45], F: 1.2, HF: 1.6 };

/* ===================================================================
   Stage 2: curves from features (fast; re-run when settings change)
   =================================================================== */
function scaler(mode, arr, gate, ref, lo, hi) {
  if (mode === "asset") {
    const a = quantileMasked(arr, gate, lo === undefined ? 0.10 : lo);
    const b = quantileMasked(arr, gate, hi === undefined ? 0.95 : hi);
    const span = Array.isArray(ref) ? ref[1] - ref[0] : ref;
    const d = Math.max(b - a, span * 0.15);
    return v => clamp01((v - a) / d);
  }
  if (Array.isArray(ref)) { const lo0 = ref[0], d0 = ref[1] - ref[0]; return v => clamp01((v - lo0) / d0); }
  return v => clamp01(v / ref);
}

/* class-independent intermediate results, cached on F */
function baseOf(F) {
  if (F._base) return F._base;
  const n = F.nF, dt = F.dt;
  const fr = s => Math.max(1, Math.round(s / dt));

  /* gate (momentary LUFS > -70) */
  const kzM = movMean(F.kz, fr(0.2));
  const gate = new Uint8Array(n);
  for (let m = 0; m < n; m++) gate[m] = (-0.691 + 10 * Math.log10(kzM[m] + 1e-15)) > -70 ? 1 : 0;

  /* specific loudness (simplified ISO 532-1 core on 24 Bark bands), sharpness (DIN 45692), band shares */
  const Nsone = new Float32Array(n), sharp = new Float32Array(n);
  const share = new Float32Array(n * NCOARSE);
  const kN = F.cal ? F.cal.kN : 1;
  const np = new Float64Array(NBARK);
  for (let m = 0; m < n; m++) {
    let Nt = 0, num = 0;
    const bo = m * NBARK;
    for (let b = 0; b < NBARK; b++) {
      const E = F.bark[bo + b];
      const d = 10 * Math.log10(E / 0.5 + 1e-20) + 100 - BARK_LTQ[b];
      let v = 0;
      if (d > 0) v = kN * BARK_LTQF[b] * (Math.pow(0.75 + 0.25 * Math.pow(10, 0.1 * d), 0.25) - 1);
      np[b] = v; Nt += v; num += v * SHARP_G[b] * (b + 0.5);
    }
    Nsone[m] = Nt;
    sharp[m] = Nt > 0.1 ? 0.11 * num / Nt : 0;
    for (let c = 0; c < NCOARSE; c++) share[m * NCOARSE + c] = Nt > 1e-6 ? (np[2 * c] + np[2 * c + 1]) / Nt : 0;
  }

  /* roughness R [asper]: 30-150 Hz envelope modulation share, Aures carrier weighting, calibrated */
  const kR = F.cal ? F.cal.kR : 1;
  const Rr = new Float32Array(n);
  {
    const rt = Array.from(F.roughT);
    const Rraw = [];
    for (let c = 0; c < NCOARSE; c++) {
      const arr = new Float32Array(F.nB);
      for (let j = 0; j < F.nB; j++) arr[j] = F.rough[j * NCOARSE + c];
      Rraw.push(interpTimes(rt, arr, n, dt));
    }
    for (let m = 0; m < n; m++) {
      let s = 0;
      for (let c = 0; c < NCOARSE; c++) s += G_AURES[Math.min(24, 2 * c + 1)] * share[m * NCOARSE + c] * Rraw[c][m];
      Rr[m] = gate[m] ? s * kR : 0;
    }
    // roughness is a sustained percept: a 0.5 s running median removes isolated clicks
    const rm = runQuantile(Rr, fr(0.25), Math.max(1, fr(0.05)), 0.5);
    for (let m = 0; m < n; m++) Rr[m] = Math.min(4, rm[m]);
  }

  /* fluctuation strength F [vacil]: 2-20 Hz band-envelope modulation, w_F weighting, calibrated */
  const kF = F.cal ? F.cal.kF : 1;
  const Fl = (function () {
    const dec = Math.max(1, Math.round(DT_REF / dt)), ddt = dt * dec, nd = Math.ceil(n / dec);
    const winLen = Math.min(nd, Math.max(1, Math.round(2.0 / ddt)));
    const M = 256;
    const fftM = getFFT(M), w = hannP(winLen);
    let ws2 = 0; for (let i = 0; i < winLen; i++) ws2 += w[i] * w[i];
    const rate = 1 / ddt;
    const k0 = Math.max(1, Math.ceil(2 * M / rate)), k1 = Math.min(M / 2 - 1, Math.floor(20 * M / rate));
    const wts = new Float64Array(M / 2);
    for (let k = k0; k <= k1; k++) { const f = k * rate / M; wts[k] = 1 / (f / 4 + 4 / f); }
    const env = [];
    for (let c = 0; c < NCOARSE; c++) {
      const e = new Float32Array(nd);
      for (let j = 0; j < nd; j++) {
        let acc = 0, k = 0;
        for (let m = j * dec; m < Math.min(n, (j + 1) * dec); m++) { acc += F.bark[m * NBARK + 2 * c] + F.bark[m * NBARK + 2 * c + 1]; k++; }
        e[j] = Math.sqrt(k ? acc / k : 0);
      }
      env.push(e);
    }
    const step = Math.max(1, Math.round(0.1 / ddt));
    const ts = [], vs = [];
    const reM = new Float64Array(M), imM = new Float64Array(M);
    for (let c0d = 0; c0d < nd; c0d += step) {
      const c0 = Math.min(n - 1, c0d * dec + (dec >> 1));
      const s = Math.max(0, Math.min(nd - winLen, c0d - (winLen >> 1)));
      let tot = 0;
      if (gate[c0]) for (let c = 0; c < NCOARSE; c++) {
        const e = env[c];
        let mean = 0;
        for (let i = 0; i < winLen; i++) mean += e[s + i];
        mean /= winLen;
        if (mean < 3e-5 || share[c0 * NCOARSE + c] < 0.01) continue;
        reM.fill(0); imM.fill(0);
        for (let i = 0; i < winLen && i < M; i++) reM[i] = (e[s + i] - mean) * w[i];
        fftM(reM, imM);
        let pw = 0;
        for (let k = k0; k <= k1; k++) pw += wts[k] * (reM[k] * reM[k] + imM[k] * imM[k]);
        pw = pw * 2 / (M * ws2);
        tot += share[c0 * NCOARSE + c] * pw / (mean * mean);
      }
      ts.push((c0 + 0.5) * dt); vs.push(tot * kF);
    }
    return interpTimes(ts, vs, n, dt);
  })();

  /* harshness factor (Zwicker-Fastl psychoacoustic annoyance form) */
  const N95 = runQuantile(Nsone, fr(1.0), Math.max(1, fr(0.1)), 0.95);
  const hfac = new Float32Array(n);
  for (let m = 0; m < n; m++) {
    if (!gate[m]) continue;
    const S = sharp[m], Nn = Math.max(N95[m], 0.05);
    const wS = S > 1.75 ? (S - 1.75) * 0.25 * Math.log10(Nn + 10) : 0;
    const wFR = (2.18 / Math.pow(Nn, 0.4)) * (0.4 * Fl[m] + 0.6 * Rr[m]);
    hfac[m] = Math.sqrt(wS * wS + wFR * wFR);
  }

  /* flatness */
  const sfmS = movMean(F.sfm, fr(0.25));
  for (let m = 0; m < n; m++) if (!gate[m]) sfmS[m] = 0;

  /* activity: noise-robust log-mel flux + event density */
  const B = NMEL;
  // smoothing span and difference lag are fixed in time (≈ one reference hop), so the
  // flux has the same scale at the fine resolution used for short clips
  const lagF = Math.max(1, Math.round(DT_REF / dt));
  const sm = new Float32Array(n * B);
  for (let m = 0; m < n; m++) {
    const c = m * B, a0 = Math.max(0, m - lagF), a1 = Math.min(n - 1, m + lagF), cnt = a1 - a0 + 1;
    for (let b = 0; b < B; b++) { let v = 0; for (let k = a0; k <= a1; k++) v += F.melDb[k * B + b]; sm[c + b] = v / cnt; }
  }
  const o = new Float32Array(n);
  for (let m = lagF; m < n; m++) {
    if (!gate[m]) continue;
    let s = 0;
    const p = (m - lagF) * B, q = m * B;
    for (let b = 0; b < B; b++) {
      let ref = sm[p + b];
      if (b > 0 && sm[p + b - 1] > ref) ref = sm[p + b - 1];
      if (b < B - 1 && sm[p + b + 1] > ref) ref = sm[p + b + 1];
      const d = sm[q + b] - ref;
      if (d > 0) s += d;
    }
    o[m] = s / B;
  }
  const oFloor = runQuantile(o, fr(0.5), Math.max(1, fr(0.05)), 0.25);
  const op = new Float32Array(n);
  for (let m = 0; m < n; m++) op[m] = Math.max(0, o[m] - oFloor[m]);
  const A = movMean(op, fr(0.05));
  const mad = runMAD(o, fr(1.5), Math.max(1, fr(0.1)));
  const minGap = fr(0.05);
  const onsets = [];
  for (let m = 2; m < n - 2; m++) {
    const v = op[m];
    if (v <= 0) continue;
    if (v < op[m - 1] || v < op[m - 2] || v <= op[m + 1] || v < op[m + 2]) continue;
    if (v < Math.max(ONSET.madK * mad[m] * 1.4826, ONSET.min)) continue;
    if (onsets.length && m - onsets[onsets.length - 1] < minGap) {
      if (v > op[onsets[onsets.length - 1]]) onsets[onsets.length - 1] = m;
      continue;
    }
    onsets.push(m);
  }
  const oc = new Float32Array(n + 1);
  { let j = 0; for (let m = 0; m < n; m++) { oc[m + 1] = oc[m]; while (j < onsets.length && onsets[j] === m) { oc[m + 1]++; j++; } } }
  const ED = new Float32Array(n);
  const edH = fr(1.0);
  for (let m = 0; m < n; m++) { const s = Math.max(0, m - edH), e = Math.min(n, m + edH + 1); ED[m] = (oc[e] - oc[s]) / ((e - s) * dt); }
  const actFixed = new Float32Array(n);
  for (let m = 0; m < n; m++) actFixed[m] = gate[m] ? 0.5 * clamp01(A[m] / REF.A) + 0.5 * clamp01(ED[m] / REF.ED) : 0;

  /* loudness fluctuation (SD of 50 ms level over 1.5 s) */
  const kz50 = movMean(F.kz, Math.max(1, fr(0.025)));
  const ldb = new Float32Array(n);
  for (let m = 0; m < n; m++) ldb[m] = Math.max(-70, -0.691 + 10 * Math.log10(kz50[m] + 1e-15));
  const D = new Float32Array(n);
  {
    const h = fr(0.75);
    const p1 = prefix(ldb), sq = new Float32Array(n);
    for (let m = 0; m < n; m++) sq[m] = ldb[m] * ldb[m];
    const p2 = prefix(sq);
    for (let m = 0; m < n; m++) {
      const s = Math.max(0, m - h), e = Math.min(n, m + h + 1), k = e - s;
      const mu = (p1[e] - p1[s]) / k;
      D[m] = gate[m] ? Math.sqrt(Math.max(0, (p2[e] - p2[s]) / k - mu * mu)) : 0;
    }
  }

  /* harmonic tension: Tonal Interval Vector on chroma */
  const tonal = new Float32Array(n);
  const actS = movMean(actFixed, fr(0.5));
  for (let m = 0; m < n; m++) tonal[m] = gate[m] ? clamp01(1 - sfmS[m] / 0.3) * (1 - 0.8 * actS[m]) : 0;
  const harm = new Float32Array(n), harmD = new Float32Array(n), harmK = new Float32Array(n), harmL = new Float32Array(n);
  {
    const h = fr(0.5);
    const chS = [];
    for (let p = 0; p < 12; p++) { const a = new Float32Array(n); for (let m = 0; m < n; m++) a[m] = F.chroma[m * 12 + p]; chS.push(movMean(a, h)); }
    const cosT = new Float64Array(72), sinT = new Float64Array(72);
    for (let k = 1; k <= 6; k++) for (let p = 0; p < 12; p++) { const a = -2 * Math.PI * k * p / 12; cosT[(k - 1) * 12 + p] = Math.cos(a); sinT[(k - 1) * 12 + p] = Math.sin(a); }
    const Tr = new Float32Array(n * 6), Ti = new Float32Array(n * 6), has = new Uint8Array(n);
    for (let m = 0; m < n; m++) {
      let sum = 0; for (let p = 0; p < 12; p++) sum += chS[p][m];
      if (!(sum > 1e-14) || !gate[m]) continue;
      has[m] = 1;
      for (let k = 0; k < 6; k++) {
        let r = 0, i = 0;
        for (let p = 0; p < 12; p++) { const v = chS[p][m] / sum; r += v * cosT[k * 12 + p]; i += v * sinT[k * 12 + p]; }
        Tr[m * 6 + k] = TIV_W[k] * r; Ti[m * 6 + k] = TIV_W[k] * i;
      }
    }
    const ak = 1 - Math.exp(-dt / 15);
    const kr = new Float64Array(6), ki = new Float64Array(6);
    let init = false;
    const lag = fr(1.0);
    for (let m = 0; m < n; m++) {
      if (!has[m]) continue;
      let norm2 = 0;
      for (let k = 0; k < 6; k++) norm2 += Tr[m * 6 + k] ** 2 + Ti[m * 6 + k] ** 2;
      const Dv = 1 - Math.sqrt(norm2) / TIV_NORM;
      if (!init) { for (let k = 0; k < 6; k++) { kr[k] = Tr[m * 6 + k]; ki[k] = Ti[m * 6 + k]; } init = true; }
      let dk = 0;
      for (let k = 0; k < 6; k++) dk += (Tr[m * 6 + k] - kr[k]) ** 2 + (Ti[m * 6 + k] - ki[k]) ** 2;
      const Kv = Math.sqrt(dk) / TIV_NORM;
      for (let k = 0; k < 6; k++) { kr[k] += ak * (Tr[m * 6 + k] - kr[k]); ki[k] += ak * (Ti[m * 6 + k] - ki[k]); }
      const a = Math.max(0, m - lag), b = Math.min(n - 1, m + lag);
      let dl = 0;
      if (has[a] && has[b]) for (let k = 0; k < 6; k++) dl += (Tr[b * 6 + k] - Tr[a * 6 + k]) ** 2 + (Ti[b * 6 + k] - Ti[a * 6 + k]) ** 2;
      const Lv = Math.sqrt(dl) / TIV_NORM;
      harmD[m] = Dv; harmK[m] = Kv; harmL[m] = Lv;
      harm[m] = tonal[m] * (0.40 * Dv + 0.35 * Kv + 0.25 * Lv);
    }
    const sm6 = movMean(harm, fr(0.5));
    for (let m = 0; m < n; m++) harm[m] = gate[m] ? sm6[m] : 0;
  }

  /* surprise: online diagonal Gaussian on 40 log-mel bands at ~10 Hz */
  const sStep = Math.max(1, fr(0.1));
  const G = Math.ceil(n / sStep);
  const sur = new Float32Array(G), sgate = new Uint8Array(G);
  {
    const mu = new Float64Array(B), va = new Float64Array(B).fill(25);
    let init = false;
    const al = 1 - Math.exp(-(sStep * dt) / 5);
    const x = new Float64Array(B);
    for (let i = 0; i < G; i++) {
      const s = i * sStep, e = Math.min(n, s + sStep);
      let gsum = 0;
      x.fill(0);
      for (let m = s; m < e; m++) { gsum += gate[m]; const q = m * B; for (let b = 0; b < B; b++) x[b] += F.melDb[q + b]; }
      for (let b = 0; b < B; b++) x[b] /= (e - s);
      sgate[i] = gsum * 2 >= (e - s) ? 1 : 0;
      if (!sgate[i]) continue;
      if (!init) { for (let b = 0; b < B; b++) mu[b] = x[b]; init = true; continue; }
      let su = 0;
      for (let b = 0; b < B; b++) { const d = x[b] - mu[b]; su += d * d / va[b]; }
      sur[i] = Math.log1p(0.5 * su / B);
      for (let b = 0; b < B; b++) { const d = x[b] - mu[b]; mu[b] += al * d; va[b] = Math.max((1 - al) * va[b] + al * d * d, 4); }
    }
  }

  F._base = { gate, Nsone, sharp, share, Rr, Fl, N95, hfac, sfmS, o, op, A, ED, onsets, actFixed, D, ldb, tonal, harm, harmD, harmK, harmL, sur, sgate, sStep, G };
  return F._base;
}

function computeCurves(F, cls, opt) {
  opt = opt || {};
  const scaleMode = opt.scale || "fixed";
  const C = CLASSES[cls] || CLASSES.rhythmic;
  const n = F.nF, dt = F.dt;
  const fr = s => Math.max(1, Math.round(s / dt));
  const X = baseOf(F);
  const gate = X.gate;

  /* C1 perceptual loudness: K-weighted, class window, one-pole in the dB domain */
  const lwHalf = Math.max(0, Math.round(C.lw / dt / 2));
  const kzW = lwHalf > 0 ? movMean(F.kz, lwHalf) : Float32Array.from(F.kz);
  const lraw = new Float32Array(n);
  for (let m = 0; m < n; m++) lraw[m] = Math.max(-70, -0.691 + 10 * Math.log10(kzW[m] + 1e-15));
  const lufs = asym(lraw, dt, C.ta * 0.5, C.tr * 0.5);
  const c1 = new Float32Array(n);
  for (let m = 0; m < n; m++) c1[m] = clamp01((lufs[m] + 60) / 60);

  /* C4 harshness-weighted loudness: C1 plus the annoyance uplift, in loudness-level units */
  const c4 = new Float32Array(n);
  for (let m = 0; m < n; m++) c4[m] = gate[m] ? clamp01(c1[m] + 10 * Math.log2(1 + X.hfac[m]) / 60) : 0;

  /* C2 activity */
  const scA = scaler(scaleMode, X.A, gate, REF.A);
  const scED = scaler(scaleMode, X.ED, gate, REF.ED);
  const c2 = new Float32Array(n);
  for (let m = 0; m < n; m++) c2[m] = gate[m] ? 0.5 * scA(X.A[m]) + 0.5 * scED(X.ED[m]) : 0;

  /* C3 arousal composite */
  const scD = scaler(scaleMode, X.D, gate, REF.D);
  const scS = scaler(scaleMode, X.sfmS, gate, REF.SFM);
  const c3raw = new Float32Array(n);
  for (let m = 0; m < n; m++) c3raw[m] = gate[m] ? 0.50 * c1[m] + 0.15 * scD(X.D[m]) + 0.20 * c2[m] + 0.15 * scS(X.sfmS[m]) : 0;
  const c3s = asym(c3raw, dt, C.ta * 0.5, C.tr * 0.5);
  const c3 = new Float32Array(n);
  for (let m = 0; m < n; m++) c3[m] = gate[m] ? clamp01((c3s[m] - 0.1) / 0.6) : 0;

  /* C6 harmonic tension */
  const c6 = new Float32Array(n);
  if (C.harmony) {
    const sc6 = scaler(scaleMode, X.harm, gate, REF.HARM);
    for (let m = 0; m < n; m++) c6[m] = gate[m] ? sc6(X.harm[m]) : 0;
  }

  /* C5 trend-salience tension (Farbood-style integrated slopes) */
  const c5 = new Float32Array(n);
  if (C.tension) {
    const h05 = fr(0.25);
    // features in fixed perceptual units (not per-asset z-scores), so a static
    // texture integrates to almost nothing instead of being stretched to full range
    const unit = (a, u) => { const o2 = movMean(a, h05); for (let m = 0; m < n; m++) o2[m] /= u; return o2; };
    const feats = [[unit(lufs, 6), 0.45, 3], [unit(X.sharp, 0.4), 0.20, 3], [unit(X.Rr, 0.25), 0.20, 3]];
    if (C.harmony) feats.push([unit(X.harm, 0.08), 0.15, 7]);
    let wsum = 0; for (const f of feats) wsum += f[1];
    const sp = new Float32Array(n);
    for (const [f, w, win] of feats) {
      const s = slopeCentered(f, fr(win / 2));
      const lagF = fr(win);
      for (let m = 0; m < n; m++) {
        const prev = m - lagF >= 0 ? s[m - lagF] : 0;
        const beta = (s[m] > 0 && prev > 0) || (s[m] < 0 && prev < 0) ? 5 : 1;
        sp[m] += (w / wsum) * beta * s[m] / dt;
      }
    }
    for (let m = 0; m < n; m++) if (!gate[m]) sp[m] = 0;
    const S = onePole(sp, dt, 1.5);
    const T = new Float32Array(n);
    const lam = Math.exp(-dt / 25);
    let t = 0;
    for (let m = 0; m < n; m++) { t = lam * t + dt * S[m]; T[m] = t; }
    const lo = quantileMasked(T, gate, 0.05), hi = quantileMasked(T, gate, 0.95);
    const d = Math.max(hi - lo, 1.5);
    for (let m = 0; m < n; m++) c5[m] = gate[m] ? clamp01(0.6 * clamp01((T[m] - lo) / d) + 0.4 * c1[m]) : 0;
  }

  /* C7 surprise, residualised against loudness */
  const c7 = new Float32Array(n);
  const ticks = [];
  if (C.surprise) {
    const { sur, sgate, sStep, G } = X;
    const gl = new Float32Array(G);
    for (let i = 0; i < G; i++) { const s = i * sStep, e = Math.min(n, s + sStep); let t = 0; for (let m = s; m < e; m++) t += c1[m]; gl[i] = t / (e - s); }
    let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
    for (let i = 0; i < G; i++) if (sgate[i]) { sx += gl[i]; sy += sur[i]; sxx += gl[i] * gl[i]; sxy += gl[i] * sur[i]; k++; }
    const den = k * sxx - sx * sx;
    const bb = den > 1e-9 ? (k * sxy - sx * sy) / den : 0, aa = k ? (sy - bb * sx) / k : 0;
    const warm = Math.min(Math.round(4 / (sStep * dt)), Math.round(0.10 * G));
    const u = new Float32Array(G), mask = new Uint8Array(G);
    for (let i = 0; i < G; i++) { mask[i] = sgate[i] && i >= warm ? 1 : 0; u[i] = mask[i] ? sur[i] - (aa + bb * gl[i]) : 0; }
    const p95 = quantileMasked(u, mask, 0.95), p50 = quantileMasked(u, mask, 0.5), p99 = quantileMasked(u, mask, 0.99);
    const dd = Math.max(p99 - p50, 0.6);
    const cand = [];
    for (let i = 1; i < G - 1; i++) if (mask[i] && u[i] > p95 && u[i] >= u[i - 1] && u[i] >= u[i + 1] && u[i] - p50 > 0.35) cand.push(i);
    cand.sort((a, b) => u[b] - u[a]);
    const gap = Math.round(3 / (sStep * dt));
    const maxT = Math.max(1, Math.round(F.dur / 10));
    const chosen = [];
    for (const i of cand) { if (chosen.length >= maxT) break; if (chosen.every(j => Math.abs(j - i) >= gap)) chosen.push(i); }
    chosen.sort((a, b) => a - b);
    for (const i of chosen) ticks.push(Math.min(n - 1, i * sStep + (sStep >> 1)));
    const p75 = quantileMasked(u, mask, 0.75), d75 = Math.max(p99 - p75, 0.5);
    for (let m = 0; m < n; m++) { const i = Math.min(G - 1, Math.floor(m / sStep)); c7[m] = mask[i] ? clamp01((u[i] - p75) / d75) : 0; }
    const c7s = movMean(c7, fr(0.15));
    for (let m = 0; m < n; m++) c7[m] = c7s[m];
  }

  /* colour channels */
  const scHF = scaler(scaleMode, X.hfac, gate, REF.HF);
  const scFl = scaler(scaleMode, X.Fl, gate, REF.F);
  const harshC = new Float32Array(n), flC = new Float32Array(n);
  for (let m = 0; m < n; m++) { harshC[m] = gate[m] ? scHF(X.hfac[m]) : 0; flC[m] = gate[m] ? scFl(X.Fl[m]) : 0; }

  return {
    cls, gate, lufs, onsets: X.onsets, ticks,
    curves: { c1, c2, c3, c4, c5, c6, c7 },
    colour: { activity: c2, harsh: harshC, fluct: flC, harmony: c6 },
    raw: { A: X.A, ED: X.ED, D: X.D, sfm: X.sfmS, sharp: X.sharp, Rr: X.Rr, Fl: X.Fl, Nsone: X.Nsone, hfac: X.hfac, c6: X.harm, tonal: X.tonal, harmD: X.harmD, harmK: X.harmK, harmL: X.harmL }
  };
}

/* ===================================================================
   Rhythm: onset envelope, tempo, beats (Ellis DP), local pulse (PLP),
   pulse clarity, downbeats. Class-independent, cached on F.
   =================================================================== */
const RHYTHM = { bpmMin: 40, bpmMax: 240, priorBpm: 120, priorOct: 1.0, tightness: 100, acWin: 8, acHop: 0.5, plpWin: 4.5, plpBand: 0.18, clarityMin: 0.4, strengthRef: 0.03, gamma: 300, lowWeight: 1, smooth: 0.014, smoothT: 0.03, timeOffset: 0 };

function nextPow2(v) { let p = 1; while (p < v) p <<= 1; return p; }
function logPrior(bpm) { const z = Math.log2(bpm / RHYTHM.priorBpm) / RHYTHM.priorOct; return -0.5 * z * z; }
function parabolic(a, i) {
  if (i <= 0 || i >= a.length - 1) return 0;
  const y0 = a[i - 1], y1 = a[i], y2 = a[i + 1], den = y0 - 2 * y1 + y2;
  return den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
}

function rhythmOf(F) {
  if (F._rhythm) return F._rhythm;
  const X = baseOf(F);
  const n = F.nF, dt = F.dt;
  const fr = s => Math.max(1, Math.round(s / dt));
  const frameTime = m => (m + 0.5) * dt + RHYTHM.timeOffset;

  /* onset envelope for rhythm: log(1 + γE) compressed mel energies (quiet bands count
     little), SuperFlux max filter across bands, local mean removed, rectified, unit RMS */
  const B = NMEL;
  const fmax = new Float32Array(n);
  for (let m = 0; m < n; m++) { let mx = 0; for (let b = 0; b < B; b++) { const e = Math.pow(10, F.melDb[m * B + b] / 10); if (e > mx) mx = e; } fmax[m] = mx; }
  const Eglob = Math.max(1e-12, quantileMasked(fmax, X.gate, 0.95));
  // local reference (running max over ±2 s): quiet passages are compressed like loud ones
  const Eloc = runQuantile(fmax, fr(2.0), Math.max(1, fr(0.1)), 1.0);
  const Cc = new Float32Array(n * B);
  for (let m = 0; m < n; m++) {
    const er = Math.max(Eloc[m], Eglob * 1e-4);
    for (let b = 0; b < B; b++) Cc[m * B + b] = Math.log1p(RHYTHM.gamma * Math.pow(10, F.melDb[m * B + b] / 10) / er);
  }
  // three regions with equal say: low (< 200 Hz), mid (200 Hz - 2 kHz), high (> 2 kHz)
  const melC = b => { const ml = 2595 * Math.log10(1 + 40 / 700), mh = 2595 * Math.log10(1 + Math.min(16000, F.sr * 0.475) / 700); const mm = ml + (mh - ml) * (b + 1) / (B + 1); return 700 * (Math.pow(10, mm / 2595) - 1); };
  const reg = new Int8Array(B), regN = [0, 0, 0];
  for (let b = 0; b < B; b++) { const f = melC(b); reg[b] = f < 200 ? 0 : f < 2000 ? 1 : 2; regN[reg[b]]++; }
  const bw = new Float32Array(B); for (let b = 0; b < B; b++) bw[b] = (reg[b] === 0 ? RHYTHM.lowWeight : 1) / Math.max(1, regN[reg[b]]);
  const oR = new Float32Array(n);
  const lagR = Math.max(1, Math.round(DT_REF / dt));
  for (let m = lagR; m < n; m++) {
    if (!X.gate[m]) continue;
    let sum = 0;
    const p = (m - lagR) * B, q = m * B;
    for (let b = 0; b < B; b++) {
      let ref = Cc[p + b];
      if (b > 0 && Cc[p + b - 1] > ref) ref = Cc[p + b - 1];
      if (b < B - 1 && Cc[p + b + 1] > ref) ref = Cc[p + b + 1];
      const d = Cc[q + b] - ref;
      if (d > 0) sum += bw[b] * d;
    }
    oR[m] = sum;
  }
  const lm = movMean(oR, fr(0.5));
  const env = new Float32Array(n);
  let s2 = 0;
  const envAbs = new Float32Array(n);
  {
    const raw = new Float32Array(n);
    for (let m = 0; m < n; m++) raw[m] = Math.max(0, oR[m] - lm[m]);
    const sg = Math.max(0.6, RHYTHM.smooth / dt), K = Math.ceil(3 * sg);
    const gk = []; let gs = 0; for (let k = -K; k <= K; k++) { const v = Math.exp(-0.5 * (k / sg) * (k / sg)); gk.push(v); gs += v; }
    for (let m = 0; m < n; m++) { let v = 0; for (let k = -K; k <= K; k++) { const j = m + k; if (j >= 0 && j < n) v += gk[k + K] * raw[j]; } v /= gs; env[m] = v; envAbs[m] = v; s2 += v * v; }
  }
  const rms = Math.sqrt(s2 / Math.max(1, n)) || 1;
  for (let m = 0; m < n; m++) env[m] /= rms;

  /* extra-smoothed copy for the tempogram and clarity (tolerates tempo drift) */
  const envT = new Float32Array(n);
  {
    const sg = Math.max(0.6, RHYTHM.smoothT / dt), K = Math.ceil(3 * sg);
    const gk = []; let gs = 0; for (let k = -K; k <= K; k++) { const v = Math.exp(-0.5 * (k / sg) * (k / sg)); gk.push(v); gs += v; }
    for (let m = 0; m < n; m++) { let v = 0; for (let k = -K; k <= K; k++) { const j = m + k; if (j >= 0 && j < n) v += gk[k + K] * env[j]; } envT[m] = v / gs; }
  }
  /* autocorrelation tempogram: 8 s windows every 0.5 s */
  const W = Math.min(n, fr(RHYTHM.acWin)), hopT = fr(RHYTHM.acHop);
  const NF = nextPow2(2 * W), fftA = getFFT(NF), winA = hannP(W);
  const lagMin = Math.max(2, Math.floor(60 / (RHYTHM.bpmMax * dt)));
  const lagMax = Math.min(W - 2, Math.ceil(60 / (RHYTHM.bpmMin * dt)));
  const nL = Math.max(0, lagMax - lagMin + 1);
  const centers = [];
  for (let c = 0; c < n; c += hopT) centers.push(c);
  if (!centers.length) centers.push(0);
  const NW = centers.length;
  const acn = new Float32Array(NW * nL);   // raw, normalised by lag 0 (tempo)
  const acm = new Float32Array(NW * nL);   // mean removed (clarity)
  const wE = new Float32Array(NW), wS = new Float32Array(NW);
  const reA = new Float64Array(NF), imA = new Float64Array(NF);
  const acInto = (dst, w) => {
    fftA(reA, imA);
    for (let k = 0; k < NF; k++) { reA[k] = reA[k] * reA[k] + imA[k] * imA[k]; imA[k] = 0; }
    fftA(reA, imA);
    const a0 = reA[0];
    if (!(a0 > 0)) return;
    for (let l = 0; l < nL; l++) dst[w * nL + l] = reA[lagMin + l] / a0;
  };
  for (let w = 0; w < NW; w++) {
    const s0 = centers[w] - (W >> 1);
    let mean = 0, cnt = 0, sa = 0, ws = 0;
    for (let k = 0; k < W; k++) { const m = s0 + k; if (m >= 0 && m < n) { mean += envT[m]; cnt++; sa += winA[k] * envAbs[m] * envAbs[m]; ws += winA[k]; } }
    mean = cnt ? mean / cnt : 0;
    wS[w] = ws > 0 ? Math.sqrt(sa / ws) : 0;
    if (nL === 0) continue;
    reA.fill(0); imA.fill(0);
    let e = 0;
    for (let k = 0; k < W; k++) { const m = s0 + k; const v = m >= 0 && m < n ? envT[m] : 0; reA[k] = v * winA[k]; e += reA[k] * reA[k]; }
    wE[w] = e;
    if (e < 1e-6) continue;
    acInto(acn, w);
    reA.fill(0); imA.fill(0);
    for (let k = 0; k < W; k++) { const m = s0 + k; const v = (m >= 0 && m < n ? envT[m] : mean) - mean; reA[k] = v * winA[k]; }
    acInto(acm, w);
  }
  const lagBpm = l => 60 / ((lagMin + l) * dt);

  /* pulse clarity per window: max normalised autocorrelation in the tempo range */
  const clarW = new Float32Array(NW);
  for (let w = 0; w < NW; w++) {
    let mx = 0; for (let l = 0; l < nL; l++) if (acm[w * nL + l] > mx) mx = acm[w * nL + l];
    clarW[w] = Math.min(1, mx) * (1 - Math.exp(-wS[w] / RHYTHM.strengthRef));
  }

  /* global tempo: mean tempogram over active windows + log-normal prior (librosa style) */
  const mean = new Float64Array(nL);
  let act = 0;
  for (let w = 0; w < NW; w++) if (wE[w] > 1e-6) { act++; for (let l = 0; l < nL; l++) mean[l] += acn[w * nL + l]; }
  let tempo = 0, bestL = -1;
  if (act && nL) {
    for (let l = 0; l < nL; l++) mean[l] /= act;
    let best = -Infinity;
    for (let l = 0; l < nL; l++) { const sc = Math.log(Math.max(mean[l], 1e-6)) + logPrior(lagBpm(l)); if (sc > best) { best = sc; bestL = l; } }
    const d = parabolic(mean, bestL);
    tempo = 60 / ((lagMin + bestL + d) * dt);
  }

  /* local tempo: Viterbi over tempogram lags, penalising log-tempo jumps */
  const ltW = new Float32Array(NW);
  if (nL && NW) {
    const lam = 12;
    const lp = new Float64Array(nL); for (let l = 0; l < nL; l++) lp[l] = logPrior(lagBpm(l));
    const lg = new Float64Array(nL); for (let l = 0; l < nL; l++) lg[l] = Math.log2(lagMin + l);
    let prev = new Float64Array(nL), cur = new Float64Array(nL);
    const bp = new Int16Array(NW * nL);
    for (let l = 0; l < nL; l++) prev[l] = Math.log(Math.max(acn[l], 1e-3)) + lp[l];
    for (let w = 1; w < NW; w++) {
      for (let l = 0; l < nL; l++) {
        let b = -Infinity, bi = 0;
        for (let k = 0; k < nL; k++) { const d = lg[l] - lg[k]; const v = prev[k] - lam * d * d; if (v > b) { b = v; bi = k; } }
        cur[l] = b + Math.log(Math.max(acn[w * nL + l], 1e-3)) + lp[l];
        bp[w * nL + l] = bi;
      }
      const t = prev; prev = cur; cur = t;
    }
    let bl = 0; for (let l = 1; l < nL; l++) if (prev[l] > prev[bl]) bl = l;
    for (let w = NW - 1; w >= 0; w--) {
      const row = acn.subarray(w * nL, (w + 1) * nL);
      const d = parabolic(row, bl);
      ltW[w] = 60 / ((lagMin + bl + d) * dt);
      if (w > 0) bl = bp[w * nL + bl];
    }
  }
  const tW = centers.map(c => (c + 0.5) * dt);
  const clarity = interpTimes(tW, Array.from(clarW), n, dt);
  const ltempo = interpTimes(tW, Array.from(ltW), n, dt);
  for (let m = 0; m < n; m++) if (!X.gate[m]) clarity[m] = 0;

  /* Ellis (2007) dynamic-programming beat tracker, librosa defaults */
  let beats = [];
  if (tempo > 0) {
    const p = 60 / (tempo * dt), P = Math.max(1, Math.round(p));
    const gw = new Float64Array(2 * P + 1);
    for (let k = -P; k <= P; k++) gw[k + P] = Math.exp(-0.5 * Math.pow(k * 32 / p, 2));
    const ls = new Float64Array(n);
    for (let m = 0; m < n; m++) { let s = 0; for (let k = -P; k <= P; k++) { const j = m + k; if (j >= 0 && j < n) s += env[j] * gw[k + P]; } ls[m] = s; }
    let lsMax = 0; for (let m = 0; m < n; m++) if (ls[m] > lsMax) lsMax = ls[m];
    const wS = -Math.round(2 * p), wEnd = -Math.round(p / 2);
    const txwt = []; for (let o = wS; o <= wEnd; o++) txwt.push(-RHYTHM.tightness * Math.pow(Math.log(-o / p), 2));
    const cum = new Float64Array(n), back = new Int32Array(n);
    let first = true;
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bo = 0;
      for (let q = 0; q < txwt.length; q++) { const j = i + wS + q; const v = txwt[q] + (j >= 0 ? cum[j] : 0); if (v > best) { best = v; bo = wS + q; } }
      cum[i] = ls[i] + best;
      if (first && ls[i] < 0.01 * lsMax) back[i] = -1;
      else { back[i] = i + bo >= 0 ? i + bo : -1; first = false; }
    }
    const maxes = [];
    for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxes.push(i);
    if (maxes.length) {
      const sorted = maxes.map(i => cum[i]).sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      let last = -1;
      for (const i of maxes) if (cum[i] * 2 > med) last = i;
      if (last >= 0) {
        const bt = [last];
        while (back[bt[bt.length - 1]] >= 0) bt.push(back[bt[bt.length - 1]]);
        bt.reverse();
        // trim weak leading and trailing beats (librosa __trim_beats)
        const hw = [0.5, 1, 0.5];
        const sm = bt.map((b, i) => { let s = 0; for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < bt.length) s += hw[k + 1] * ls[bt[j]]; } return s; });
        const thr = 0.5 * Math.sqrt(sm.reduce((a, v) => a + v * v, 0) / Math.max(1, sm.length));
        let a = 0, b = bt.length - 1;
        while (a <= b && sm[a] <= thr) a++;
        while (b >= a && sm[b] <= thr) b--;
        beats = bt.slice(a, b + 1);
      }
    }
  }

  /* PLP (Grosche & Müller 2011): Fourier tempogram peak per window, unit-magnitude
     sinusoids overlap-added, half-wave rectified */
  const plp = new Float32Array(n);
  const plpTempoF = new Float32Array(n);
  {
    const Wp = Math.min(n, Math.max(8, fr(RHYTHM.plpWin)));
    const hp = Math.max(1, fr(0.023));
    const NP = nextPow2(Wp) * 2, fftP = getFFT(NP), wp = hannP(Wp);
    const kMin = Math.max(1, Math.floor(RHYTHM.bpmMin / 60 * NP * dt)), kMax = Math.min(NP / 2 - 2, Math.ceil(RHYTHM.bpmMax / 60 * NP * dt));
    const pri = new Float64Array(NP / 2);
    for (let k = kMin; k <= kMax; k++) pri[k] = logPrior(Math.max(1e-3, k / (NP * dt) * 60));
    const acc = new Float64Array(n), nrm = new Float64Array(n), tacc = new Float64Array(n);
    const re = new Float64Array(NP), im = new Float64Array(NP), mag = new Float64Array(NP / 2);
    for (let c = 0; c < n; c += hp) {
      const s0 = c - (Wp >> 1);
      let mu = 0, cnt = 0;
      for (let k = 0; k < Wp; k++) { const m = s0 + k; if (m >= 0 && m < n) { mu += env[m]; cnt++; } }
      mu = cnt ? mu / cnt : 0;
      re.fill(0); im.fill(0);
      let e = 0;
      for (let k = 0; k < Wp; k++) { const m = s0 + k; const v = ((m >= 0 && m < n) ? env[m] : mu) - mu; re[k] = v * wp[k]; e += re[k] * re[k]; }
      if (e < 1e-8) continue;
      const seg = Float64Array.from(re.subarray(0, Wp));
      fftP(re, im);
      const lt = ltempo[Math.min(n - 1, Math.max(0, c))];
      let k0 = kMin, k1 = kMax;
      if (lt > 0) {
        k0 = Math.max(kMin, Math.floor(lt * (1 - RHYTHM.plpBand) / 60 * NP * dt));
        k1 = Math.min(kMax, Math.ceil(lt * (1 + RHYTHM.plpBand) / 60 * NP * dt));
        if (k1 <= k0 + 1) { k0 = Math.max(kMin, k0 - 1); k1 = Math.min(kMax, k1 + 1); }
      }
      for (let k = Math.max(kMin, k0 - 1); k <= Math.min(kMax, k1 + 1); k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      let bk = k0, bs = -Infinity;
      for (let k = k0; k <= k1; k++) { const sc = Math.log1p(1e6 * mag[k]) + pri[k]; if (sc > bs) { bs = sc; bk = k; } }
      const lm2 = k => Math.log(mag[k] + 1e-12);
      let d = 0;
      if (bk > Math.max(kMin, k0 - 1) && bk < Math.min(kMax, k1 + 1)) { const y0 = lm2(bk - 1), y1 = lm2(bk), y2 = lm2(bk + 1), den = y0 - 2 * y1 + y2; d = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0; }
      const om = 2 * Math.PI * (bk + d) / NP;
      let xr = 0, xi = 0;
      for (let k = 0; k < Wp; k++) { xr += seg[k] * Math.cos(om * k); xi -= seg[k] * Math.sin(om * k); }
      const ph = Math.atan2(xi, xr);
      const bpmHere = (bk + d) / (NP * dt) * 60;
      for (let k = 0; k < Wp; k++) {
        const m = s0 + k; if (m < 0 || m >= n) continue;
        acc[m] += wp[k] * Math.cos(om * k + ph);
        nrm[m] += wp[k] * wp[k];
        tacc[m] += wp[k] * wp[k] * bpmHere;
      }
    }
    let mx = 0;
    for (let m = 0; m < n; m++) { const v = nrm[m] > 1e-9 ? Math.max(0, acc[m] / nrm[m]) : 0; plp[m] = v; if (v > mx) mx = v; plpTempoF[m] = nrm[m] > 1e-9 ? tacc[m] / nrm[m] : 0; }
    if (mx > 0) for (let m = 0; m < n; m++) plp[m] /= mx;
  }
  const plpBeats = [];
  for (let m = 1; m < n - 1; m++) {
    if (plp[m] < 0.45 || plp[m] < plp[m - 1] || plp[m] < plp[m + 1] || clarity[m] < 0.5 * RHYTHM.clarityMin) continue;
    const per = plpTempoF[m] > 0 ? 60 / (plpTempoF[m] * dt) : fr(0.5);
    if (plpBeats.length && m - plpBeats[plpBeats.length - 1] < 0.6 * per) { if (plp[m] > plp[plpBeats[plpBeats.length - 1]]) plpBeats[plpBeats.length - 1] = m; continue; }
    plpBeats.push(m);
  }

  /* downbeats (heuristic, 4/4 assumed): low-band onsets plus chord change at the beat */
  let downbeats = [], downConf = 0, downPhase = 0;
  if (beats.length >= 8) {
    const B = NMEL;
    const low = new Float32Array(n);
    for (let m = 1; m < n; m++) { let s = 0; for (let b = 0; b < 2; b++) s += Math.max(0, F.melDb[m * B + b] - F.melDb[(m - 1) * B + b]); low[m] = s; }
    const chromaMean = (a, b) => {
      const v = new Float64Array(12); a = Math.max(0, a); b = Math.min(n, b);
      for (let m = a; m < b; m++) for (let p = 0; p < 12; p++) v[p] += F.chroma[m * 12 + p];
      let s = 0; for (let p = 0; p < 12; p++) s += v[p] * v[p];
      s = Math.sqrt(s) || 1; for (let p = 0; p < 12; p++) v[p] /= s;
      return v;
    };
    const lowS = [], chg = [];
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      let lv = 0; for (let m = Math.max(0, b - 2); m <= Math.min(n - 1, b + 3); m++) if (low[m] > lv) lv = low[m];
      lowS.push(lv);
      const a0 = i >= 2 ? beats[i - 2] : Math.max(0, b - 2 * Math.round(60 / (tempo * dt)));
      const a1 = i + 2 < beats.length ? beats[i + 2] : Math.min(n, b + 2 * Math.round(60 / (tempo * dt)));
      const u = chromaMean(a0, b), v = chromaMean(b, a1);
      let dot = 0; for (let p = 0; p < 12; p++) dot += u[p] * v[p];
      chg.push(1 - dot);
    }
    const z = a => { const mu = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - mu) * (y - mu), 0) / a.length) || 1; return a.map(v => (v - mu) / sd); };
    const zl = z(lowS), zc = z(chg);
    const ph = [0, 0, 0, 0], cn = [0, 0, 0, 0];
    for (let i = 0; i < beats.length; i++) { ph[i % 4] += 0.6 * zl[i] + zc[i]; cn[i % 4]++; }
    const sc = ph.map((v, i) => cn[i] ? v / cn[i] : -Infinity);
    const order = [0, 1, 2, 3].sort((a, b) => sc[b] - sc[a]);
    downPhase = order[0];
    downConf = sc[order[0]] - sc[order[1]];
    for (let i = downPhase; i < beats.length; i += 4) downbeats.push(beats[i]);
  }

  /* summary */
  const gated = []; for (let m = 0; m < n; m++) if (X.gate[m]) gated.push(clarity[m]);
  gated.sort((a, b) => a - b);
  const medClar = gated.length ? gated[gated.length >> 1] : 0;
  const ltG = []; for (let m = 0; m < n; m++) if (X.gate[m] && clarity[m] >= RHYTHM.clarityMin) ltG.push(ltempo[m]);
  ltG.sort((a, b) => a - b);
  const q = p => ltG.length ? ltG[Math.min(ltG.length - 1, Math.floor(p * (ltG.length - 1)))] : 0;

  F._rhythm = {
    env, clarity, ltempo, plp, tempo, medClar,
    reliable: medClar >= RHYTHM.clarityMin && F.dur >= 10,
    tempoRange: [q(0.05), q(0.95)],
    beats, plpBeats, downbeats, downConf, downPhase,
    beatTimes: beats.map(frameTime), plpTimes: plpBeats.map(frameTime), downTimes: downbeats.map(frameTime),
    onsetTimes: X.onsets.map(m => m * dt)
  };
  return F._rhythm;
}

/* ===================================================================
   Events: where the sound starts and where it has decayed
   =================================================================== */
function eventsOf(F) {
  if (F._events) return F._events;
  const X = baseOf(F), n = F.nF, dt = F.dt;
  let pk = -Infinity, pm = 0;
  for (let m = 0; m < n; m++) if (X.ldb[m] > pk) { pk = X.ldb[m]; pm = m; }
  let start = -1, end30 = -1, end60 = -1;
  for (let m = 0; m < n; m++) if (X.ldb[m] >= pk - 30) { start = m; break; }
  for (let m = n - 1; m >= 0; m--) if (X.ldb[m] >= pk - 30) { end30 = m; break; }
  const fl = Math.max(pk - 60, -70);
  for (let m = n - 1; m >= 0; m--) if (X.ldb[m] > fl) { end60 = m; break; }
  F._events = {
    peakLufs: pk, peakTime: (pm + 0.5) * dt,
    start: start >= 0 ? start * dt : 0, end30: end30 >= 0 ? (end30 + 1) * dt : F.dur, end60: end60 >= 0 ? (end60 + 1) * dt : F.dur,
    onsetTimes: X.onsets.map(m => m * dt)
  };
  return F._events;
}

/* ===================================================================
   Structure: Foote novelty on a self-similarity matrix, repeated-section labels
   =================================================================== */
const STRUCT = { kMin: 4, kMax: 16, labelSim: 0.62, thrAdd: 0.05, minNov: 0.2, medFrac: 0.5, sigFloor: 0.5 };
let DCT_T = null;
function dctTable() {
  if (DCT_T) return DCT_T;
  DCT_T = new Float64Array(12 * NMEL);
  for (let c = 1; c <= 12; c++) for (let b = 0; b < NMEL; b++) DCT_T[(c - 1) * NMEL + b] = Math.cos(Math.PI * c * (b + 0.5) / NMEL) * Math.sqrt(2 / NMEL);
  return DCT_T;
}
function structureOf(F) {
  if (F._struct) return F._struct;
  const X = baseOf(F), R = rhythmOf(F);
  const n = F.nF, dt = F.dt, dur = F.dur;
  const useBeats = R.reliable && R.beats.length >= 16;
  const blk = useBeats ? 60 / R.tempo : Math.min(0.5, Math.max(0.05, dur / 160));
  const blkF = Math.max(1, Math.round(blk / dt));
  const starts = [];
  if (useBeats) {
    const b = R.beats;
    for (let m = 0; m + blkF / 2 < b[0]; m += blkF) starts.push(m);
    for (const m of b) if (!starts.length || m > starts[starts.length - 1]) starts.push(m);
    for (let m = b[b.length - 1] + blkF; m + blkF / 2 < n; m += blkF) starts.push(m);
  } else for (let m = 0; m < n; m += blkF) starts.push(m);
  starts.push(n);
  const U = starts.length - 1;
  if (U < 12) {
    const nov = new Float32Array(n);
    F._struct = { units: U, useBeats, blk, L: 0, nov, bounds: [], segs: [{ t0: 0, t1: dur, label: "A" }], tooShort: true };
    return F._struct;
  }

  /* features per unit: MFCC 1-12, chroma, level, activity */
  const D = 26, feat = new Float64Array(U * D);
  const T = dctTable();
  const mel = new Float64Array(NMEL);
  for (let u = 0; u < U; u++) {
    const a = starts[u], b = Math.max(a + 1, starts[u + 1]);
    mel.fill(0);
    const ch = new Float64Array(12);
    let lv = 0, ac = 0;
    for (let m = a; m < b; m++) {
      for (let k = 0; k < NMEL; k++) mel[k] += F.melDb[m * NMEL + k];
      for (let p = 0; p < 12; p++) ch[p] += F.chroma[m * 12 + p];
      lv += X.ldb[m]; ac += X.actFixed[m];
    }
    const cnt = b - a;
    for (let k = 0; k < NMEL; k++) mel[k] /= cnt;
    const o = u * D;
    for (let c = 0; c < 12; c++) { let s = 0; for (let k = 0; k < NMEL; k++) s += T[c * NMEL + k] * mel[k]; feat[o + c] = s; }
    let cs = 0; for (let p = 0; p < 12; p++) cs += ch[p];
    for (let p = 0; p < 12; p++) feat[o + 12 + p] = cs > 1e-12 ? Math.sqrt(ch[p] / cs) : 0;
    feat[o + 24] = lv / cnt; feat[o + 25] = ac / cnt;
  }
  const gw = [];
  for (let d = 0; d < D; d++) gw.push(d < 12 ? 1 / Math.sqrt(12) : d < 24 ? 1 / Math.sqrt(12) : 0.6 / Math.sqrt(2));
  for (let d = 0; d < D; d++) {
    let mu = 0; for (let u = 0; u < U; u++) mu += feat[u * D + d]; mu /= U;
    let sd = 0; for (let u = 0; u < U; u++) sd += (feat[u * D + d] - mu) ** 2; sd = Math.sqrt(sd / U);
    // noise floors in real units so a static sound is not stretched into fake contrast
    const floor = d < 12 ? 0.6 : d < 24 ? 0.04 : d === 24 ? 1.5 : 0.05;
    const s = gw[d] / Math.max(sd, floor);
    for (let u = 0; u < U; u++) feat[u * D + d] = (feat[u * D + d] - mu) * s;
  }
  /* median filter each feature along time (removes chord-level and bar-level changes) */
  const L = Math.max(STRUCT.kMin, Math.min(STRUCT.kMax, Math.round(U / 16)));
  {
    const mh = Math.max(1, Math.round(L * STRUCT.medFrac));
    const col = new Float64Array(U), tmp = [];
    for (let d = 0; d < D; d++) {
      for (let u = 0; u < U; u++) col[u] = feat[u * D + d];
      for (let u = 0; u < U; u++) {
        tmp.length = 0;
        for (let k = Math.max(0, u - mh); k <= Math.min(U - 1, u + mh); k++) tmp.push(col[k]);
        tmp.sort((a, b) => a - b);
        feat[u * D + d] = tmp[tmp.length >> 1];
      }
    }
  }
  /* self-similarity, Gaussian kernel on Euclidean distance */
  const S = new Float32Array(U * U);
  const d2s = [];
  for (let i = 0; i < U; i++) for (let j = i; j < U; j++) {
    let s = 0; for (let d = 0; d < D; d++) { const v = feat[i * D + d] - feat[j * D + d]; s += v * v; }
    S[i * U + j] = s; S[j * U + i] = s;
    if (j > i && (d2s.length < 40000 || ((i * 31 + j) % 7 === 0))) d2s.push(s);
  }
  d2s.sort((a, b) => a - b);
  const sig2 = Math.max(STRUCT.sigFloor, d2s.length ? d2s[d2s.length >> 1] : 1);
  for (let k = 0; k < U * U; k++) S[k] = Math.exp(-S[k] / sig2);

  /* Foote novelty: Gaussian-tapered checkerboard, edges replicated */
  const g = new Float64Array(2 * L);
  for (let a = -L; a < L; a++) g[a + L] = Math.exp(-0.5 * Math.pow((a + 0.5) / (0.5 * L), 2));
  const cl = v => v < 0 ? 0 : v >= U ? U - 1 : v;
  const nv = new Float64Array(U);
  for (let u = 1; u < U; u++) {
    let s = 0;
    for (let a = -L; a < L; a++) {
      const ia = cl(u + a), sa = a < 0 ? -1 : 1, ga = g[a + L];
      for (let b = -L; b < L; b++) s += sa * (b < 0 ? -1 : 1) * ga * g[b + L] * S[ia * U + cl(u + b)];
    }
    nv[u] = Math.max(0, s);
  }
  let ksum = 0; for (let a = 0; a < 2 * L; a++) for (let b = 0; b < 2 * L; b++) ksum += g[a] * g[b];
  for (let u = 0; u < U; u++) nv[u] = Math.min(1, nv[u] / (0.5 * ksum));

  /* peak picking: local max within ±L/2, above a running median + margin */
  const half = Math.max(2, Math.floor(L / 2));
  const bnd = [];
  for (let u = 1; u < U; u++) {
    let isMax = true;
    for (let k = Math.max(1, u - half); k <= Math.min(U - 1, u + half); k++) if (nv[k] > nv[u]) { isMax = false; break; }
    if (!isMax || nv[u] < STRUCT.minNov || u < half || U - u < half) continue;
    const w = []; for (let k = Math.max(0, u - 2 * L); k <= Math.min(U - 1, u + 2 * L); k++) w.push(nv[k]);
    w.sort((a, b) => a - b);
    if (nv[u] < w[w.length >> 1] + STRUCT.thrAdd) continue;
    if (bnd.length && u - bnd[bnd.length - 1] < half) continue;
    bnd.push(u);
  }

  /* labels: block similarity between segments, average-linkage merging */
  const segU = [0, ...bnd, U];
  const K = segU.length - 1;
  const Bm = new Float64Array(K * K);
  for (let i = 0; i < K; i++) for (let j = i; j < K; j++) {
    let s = 0, c = 0;
    for (let a = segU[i]; a < segU[i + 1]; a++) for (let b = segU[j]; b < segU[j + 1]; b++) { s += S[a * U + b]; c++; }
    Bm[i * K + j] = Bm[j * K + i] = c ? s / c : 0;
  }
  const rr = (i, j) => Bm[i * K + j] / Math.sqrt(Math.max(1e-9, Bm[i * K + i] * Bm[j * K + j]));
  let clusters = []; for (let i = 0; i < K; i++) clusters.push([i]);
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      let s = 0, c = 0;
      for (const i of clusters[a]) for (const j of clusters[b]) { s += rr(i, j); c++; }
      const v = s / c;
      if (v > best) { best = v; bi = a; bj = b; }
    }
    if (bi < 0 || best < STRUCT.labelSim) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters.splice(bj, 1);
  }
  const lab = new Array(K);
  clusters.forEach((cl2, ci) => cl2.forEach(i => { lab[i] = ci; }));
  const order = []; for (let i = 0; i < K; i++) if (!order.includes(lab[i])) order.push(lab[i]);
  const letter = i => String.fromCharCode(65 + (order.indexOf(i) % 26));
  const tOf = u => u >= U ? dur : starts[u] * dt;
  const segs = [];
  for (let i = 0; i < K; i++) segs.push({ t0: tOf(segU[i]), t1: tOf(segU[i + 1]), label: letter(lab[i]), cls: order.indexOf(lab[i]) });

  /* novelty per frame */
  const tc = [], vc = [];
  for (let u = 0; u < U; u++) { tc.push(starts[u] * dt); vc.push(nv[u]); }
  const nov = interpTimes(tc, vc, n, dt);
  F._struct = { units: U, useBeats, blk, L, nov, bounds: bnd.map(u => starts[u] * dt), segs, tooShort: false };
  return F._struct;
}

/* ===================================================================
   Beat evaluation: F-measure with ±70 ms tolerance (MIREX / mir_eval)
   =================================================================== */
function beatF(est, ref, regions, tol) {
  tol = tol || 0.07;
  const inR = t => !regions || regions.some(r => t >= r[0] && t <= r[1]);
  const E = est.filter(inR), Rf = ref.filter(inR);
  if (!Rf.length) return null;
  const used = new Uint8Array(Rf.length);
  let tp = 0, j = 0;
  const errs = [];
  for (const t of E) {
    while (j < Rf.length && Rf[j] < t - tol) j++;
    let best = -1, bd = Infinity;
    for (let k = j; k < Rf.length && Rf[k] <= t + tol; k++) if (!used[k] && Math.abs(Rf[k] - t) < bd) { bd = Math.abs(Rf[k] - t); best = k; }
    if (best >= 0) { used[best] = 1; tp++; errs.push(t - Rf[best]); }
  }
  const P = E.length ? tp / E.length : 0, Rc = tp / Rf.length;
  errs.sort((a, b) => a - b);
  return { f: P + Rc > 0 ? 2 * P * Rc / (P + Rc) : 0, p: P, r: Rc, n: E.length, ref: Rf.length, medErr: errs.length ? errs[errs.length >> 1] : 0 };
}

/* ===================================================================
   Short sound effects: envelope phases, sound objects (Schaeffer-style
   tags), NMF layers, pitch and centroid motion, space, asset checks,
   spectral silhouette bands. Needs the decoded buffer; cached on F.
   =================================================================== */
const SFX = {
  yinWin: 2048, yinThr: 0.15, fmin: 50, fmax: 4000, maxPitchPts: 900,
  tonalAper: 0.25, tonalFrac: 0.5, glideSemis: 4, rangeSemis: 5, rangeOct: 1.2, glideOct: 0.8,
  impulseDur: 0.2, grainGap: 0.4, grainDb: 12, grainOct: 2.0, grainGlideOct: 0.5, hpShare: 0.25, iterMin: 3, iterDepth: 0.35, contRise: 5,
  // riseDb/bandRiseDb 8 (was 6): picked on the tuning half in 19 of 20 repeated splits by tools/tune.js --grid
  eventFloor: 40, riseDb: 8, bandRiseDb: 8, nmfK: 3, nmfIter: 150, nmfCols: 400
};
const SFX_WORDS = {
  N: { impulse: "tonal hit", sustained: "tone", iterative: "tonal flutter" },
  X: { impulse: "noise hit", sustained: "noise", iterative: "grit" },
  Y: { impulse: "chirp", sustained: "sweep", iterative: "creak" }
};

function linSlope(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const d = n * sxx - sx * sx;
  return d > 1e-12 ? (n * sxy - sx * sy) / d : 0;
}
function pctl(arr, q) { if (!arr.length) return 0; const t = arr.slice().sort((a, b) => a - b); return t[Math.min(t.length - 1, Math.max(0, Math.round(q * (t.length - 1))))]; }

function sfxOf(F, buf, name) {
  if (F._sfx) return F._sfx;
  const X = baseOf(F);
  const n = F.nF, dt = F.dt, sr = F.sr, H = F.H, B = NMEL;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const len = Math.min(L.length, R.length);
  const fr = s => Math.max(1, Math.round(s / dt));

  /* ---------- envelope ---------- */
  // ~14 ms smoothing: removes pitch-period ripple of low voices (80 Hz = 12.5 ms) at the fine hop
  const kzS = movMean(F.kz, Math.max(1, Math.round(0.007 / dt)));
  const lev = new Float32Array(n), amp = new Float32Array(n);
  let pk = -Infinity, pm = 0, maxA = 0;
  for (let m = 0; m < n; m++) {
    lev[m] = Math.max(-100, -0.691 + 10 * Math.log10(kzS[m] + 1e-15));
    amp[m] = Math.sqrt(kzS[m]);
    if (lev[m] > pk) { pk = lev[m]; pm = m; }
    if (amp[m] > maxA) maxA = amp[m];
  }
  const tOf = m => (m + 0.5) * dt;
  let attackFix = dt;
  let eff = 0, tcN = 0, tcD = 0;
  for (let m = 0; m < n; m++) { if (amp[m] >= 0.4 * maxA) eff += dt; if (amp[m] >= 0.15 * maxA) { tcN += tOf(m) * amp[m]; tcD += amp[m]; } }
  const tcent = tcD > 0 ? tcN / tcD : 0;
  let t20 = null, t40 = null;
  for (let m = pm; m < n; m++) { if (t20 === null && lev[m] <= pk - 20) t20 = tOf(m) - tOf(pm); if (lev[m] <= pk - 40) { t40 = tOf(m) - tOf(pm); break; } }

  /* ---------- pitch (YIN, FFT-based difference function) ---------- */
  const f0 = new Float32Array(n), aper = new Float32Array(n).fill(1);
  {
    const W = Math.min(SFX.yinWin, 1 << Math.floor(Math.log2(Math.max(256, len))));
    const NF = 2 * W, fft = getFFT(NF);
    const tMin = Math.max(2, Math.floor(sr / SFX.fmax)), tMax = Math.min(W >> 1, Math.ceil(sr / SFX.fmin));
    const step = Math.max(1, Math.ceil(n / SFX.maxPitchPts));
    const re = new Float64Array(NF), im = new Float64Array(NF), seg = new Float64Array(W), E = new Float64Array(W + 1);
    const d = new Float64Array(tMax + 2), dn = new Float64Array(tMax + 2);
    const pts = [];
    const mono = new Float32Array(len), hp = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = 0.5 * (L[i] + R[i]);
    { const w0 = 2 * Math.PI * 250 / sr, al = Math.sin(w0) / (2 * 0.7071), cw = Math.cos(w0), a0 = 1 + al;
      biquadInto(mono, hp, [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - al) / a0]); }
    for (let m = 0; m < n; m += step) {
      if (lev[m] < pk - 45) { pts.push([m, 0, 1]); continue; }
      const c = m * H + (H >> 1), s0 = c - (W >> 1);
      let eFull = 0;
      for (let j = 0; j < W; j++) { const i = s0 + j; seg[j] = i >= 0 && i < len ? hp[i] : 0; const v = i >= 0 && i < len ? mono[i] : 0; eFull += v * v; }
      E[0] = 0; for (let j = 0; j < W; j++) E[j + 1] = E[j] + seg[j] * seg[j];
      const hpShare = eFull > 0 ? E[W] / eFull : 0;
      if (E[W] < 1e-10) { pts.push([m, 0, 1]); continue; }
      re.fill(0); im.fill(0);
      for (let j = 0; j < W; j++) re[j] = seg[j];
      fft(re, im);
      for (let k = 0; k < NF; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
      fft(re, im);
      let run = 0;
      for (let t = 1; t <= tMax; t++) {
        const r = re[t] / NF;
        d[t] = Math.max(0, E[W - t] + (E[W] - E[t]) - 2 * r);
        run += d[t];
        dn[t] = run > 0 ? d[t] * t / run : 1;
      }
      let best = -1;
      for (let t = tMin; t <= tMax; t++) if (dn[t] < SFX.yinThr) { while (t + 1 <= tMax && dn[t + 1] < dn[t]) t++; best = t; break; }
      if (best < 0) { let mv = Infinity; for (let t = tMin; t <= tMax; t++) if (dn[t] < mv) { mv = dn[t]; best = t; } }
      let tau = best;
      if (best > tMin && best < tMax) { const y0 = dn[best - 1], y1 = dn[best], y2 = dn[best + 1], den = y0 - 2 * y1 + y2; if (den > 0) tau = best + 0.5 * (y0 - y2) / den; }
      pts.push([m, sr / tau, hpShare >= SFX.hpShare ? dn[best] : Math.max(dn[best], 0.99)]);
    }
    let j = 0;
    for (let m = 0; m < n; m++) {
      while (j < pts.length - 1 && pts[j + 1][0] <= m) j++;
      f0[m] = pts[j][1]; aper[m] = pts[j][2];
    }
  }

  /* ---------- spectral centroid (log-frequency, from mel bands) ---------- */
  const melC = b => { const ml = 2595 * Math.log10(1 + 40 / 700), mh = 2595 * Math.log10(1 + Math.min(16000, sr * 0.475) / 700); const mm = ml + (mh - ml) * (b + 1) / (B + 1); return 700 * (Math.pow(10, mm / 2595) - 1); };
  const lf = []; for (let b = 0; b < B; b++) lf.push(Math.log2(melC(b)));
  const cent = new Float32Array(n);
  for (let m = 0; m < n; m++) {
    let s = 0, w = 0;
    for (let b = 0; b < B; b++) { const e = Math.pow(10, F.melDb[m * B + b] / 10); s += e * lf[b]; w += e; }
    cent[m] = w > 0 ? s / w : 0;
  }

  /* ---------- events: SFX onsets -> drop continuations -> group grains ---------- */
  const floorDb = pk - SFX.eventFloor;
  let first = -1, last = -1;
  for (let m = 0; m < n; m++) if (lev[m] >= floorDb) { if (first < 0) first = m; last = m; }
  const endF = last >= 0 ? last + 1 : n;
  const levS = lev;
  const kzP = movMean(F.kz, 1), levP = new Float32Array(n);
  for (let m = 0; m < n; m++) levP[m] = Math.max(-100, -0.691 + 10 * Math.log10(kzP[m] + 1e-15));
  const peakAfter = m => { let v = -Infinity; for (let k = m; k < Math.min(n, m + fr(0.03)); k++) v = Math.max(v, levP[k]); return v; };
  // (a) level re-attacks: >= 6 dB within 15 ms
  const w15 = Math.max(1, fr(0.015)), cand = [];
  {
    const dl = new Float32Array(n), lo = new Int32Array(n);
    for (let m = 0; m < n; m++) { let v = Infinity, at = m; for (let k = Math.max(0, m - w15); k <= m; k++) if (levS[k] < v) { v = levS[k]; at = k; } dl[m] = levS[m] - v; lo[m] = at; }
    const wn = Math.max(1, fr(0.01));
    for (let m = 1; m < n - 1; m++) {
      if (dl[m] < SFX.riseDb || levS[m] < floorDb) continue;
      let isMax = true; for (let k = Math.max(0, m - wn); k <= Math.min(n - 1, m + wn); k++) if (dl[k] > dl[m]) { isMax = false; break; }
      if (isMax) cand.push(lo[m]);
    }
  }
  // (b) spectral-flux onsets (new layers that barely change the level)
  const lagO = Math.max(1, Math.round(DT_REF / dt));
  const bandRise = m => {
    let fm = -Infinity; for (let b = 0; b < B; b++) fm = Math.max(fm, F.melDb[Math.min(n - 1, m + fr(0.006)) * B + b]);
    let r = 0;
    for (let b = 0; b < B; b++) {
      let mx = -Infinity; for (let k = m; k < Math.min(n, m + fr(0.012)); k++) mx = Math.max(mx, F.melDb[k * B + b]);
      if (mx < fm - 40) continue;
      r = Math.max(r, mx - F.melDb[Math.max(0, m - lagO) * B + b]);
    }
    return r;
  };
  for (const m of X.onsets) if (peakAfter(m) >= floorDb && bandRise(m) >= SFX.bandRiseDb) cand.push(m);
  cand.sort((p, q) => p - q);
  let ons = [];
  for (const m of cand) { if (m < first || m >= endF - fr(0.02)) continue; if (ons.length && m - ons[ons.length - 1] < fr(0.025)) continue; ons.push(m); }
  if (first >= 0 && (!ons.length || ons[0] - first > fr(0.03))) ons.unshift(first);
  // a sound already present at the first frame starts at 0: rise detectors need past frames and would report it a window late
  else if (first >= 0 && first <= 1 && ons.length && ons[0] > first) ons[0] = first;
  // what changed at each onset: level, and the centroid of the energy that was added
  const onInfo = ons.map(m => {
    let num = 0, den = 0;
    for (let b = 0; b < B; b++) {
      let mx = -Infinity; for (let k = m; k < Math.min(n, m + fr(0.012)); k++) mx = Math.max(mx, F.melDb[k * B + b]);
      const before = F.melDb[Math.max(0, m - lagO) * B + b];
      if (mx - before < 3) continue;
      const dd = Math.pow(10, mx / 10) - Math.pow(10, before / 10);
      if (dd > 0) { num += dd * lf[b]; den += dd; }
    }
    return { m, pk: peakAfter(m), fc: den > 0 ? num / den : cent[m] };
  });
  // continuation: no dip before it and still rising -> same event (fade-ins, swells)
  for (let i = 1; i < onInfo.length;) {
    const p = onInfo[i - 1], q = onInfo[i];
    let pmax = -Infinity; for (let k = p.m; k < q.m; k++) pmax = Math.max(pmax, levP[k]);
    let dip = Infinity; for (let k = Math.max(p.m, q.m - fr(0.01)); k <= q.m; k++) dip = Math.min(dip, levS[k]);
    const fa = Math.min(n - 1, p.m + fr(0.03)), fb = Math.min(n - 1, q.m + fr(0.03));
    const pitchJump = aper[fa] <= SFX.tonalAper && aper[fb] <= SFX.tonalAper && f0[fa] > 0 && f0[fb] > 0 && Math.abs(12 * Math.log2(f0[fb] / f0[fa])) >= 1;
    const swell = q.pk >= pmax + 3;
    if (pmax - dip < 6 && q.pk >= pmax - 1 && (swell || Math.abs(q.fc - p.fc) < 0.5) && !pitchJump) onInfo.splice(i, 1); else i++;
  }
  // grains: runs of >= 3 onsets close together, with similar level and similar rising bands
  const groups = [];
  const like = (p, q) => (q.m - p.m) * dt <= SFX.grainGap && Math.abs(p.pk - q.pk) <= SFX.grainDb && Math.abs(p.fc - q.fc) <= SFX.grainOct;
  for (let i = 0; i < onInfo.length;) {
    let j = i;
    const nxt = onInfo.slice(i + 1, i + 4).map(o => o.pk);
    const strongHead = nxt.length > 0 && onInfo[i].pk - pctl(nxt, 0.5) >= 10;
    if (!strongHead) {
      const pks = [onInfo[i].pk];
      while (j + 1 < onInfo.length) {
        const q = onInfo[j + 1], med = pctl(pks, 0.5);
        if ((q.m - onInfo[j].m) * dt <= SFX.grainGap && Math.abs(q.pk - med) <= SFX.grainDb && Math.abs(q.fc - onInfo[j].fc) <= SFX.grainOct) { j++; pks.push(q.pk); } else break;
      }
    }
    const bEnd = j + 1 < onInfo.length ? onInfo[j + 1].m : endF;
    if (j - i + 1 >= SFX.iterMin) { groups.push({ a: onInfo[i].m, b: bEnd, grains: onInfo.slice(i, j + 1).map(x => x.m), chain: true }); i = j + 1; }
    else { groups.push({ a: onInfo[i].m, b: i + 1 < onInfo.length ? onInfo[i + 1].m : endF, grains: [onInfo[i].m], chain: false }); i++; }
  }
  for (let i = 0; i + 1 < groups.length;) {
    const g = groups[i], h = groups[i + 1];
    if (g.chain) {
      const lastI = onInfo.find(o => o.m === g.grains[g.grains.length - 1]), hI = onInfo.find(o => o.m === h.a);
      if (lastI && hI && like(lastI, hI)) { g.grains.push(...h.grains); g.b = h.b; groups.splice(i + 1, 1); continue; }
    }
    i++;
  }
  const segDesc = (a, b) => {
    let ep = -Infinity, epm = a;
    for (let m = a; m < b; m++) if (lev[m] > ep) { ep = lev[m]; epm = m; }
    let effE = 0; for (let m = a; m < b; m++) if (lev[m] >= ep - 12) effE += dt;
    return { ep, epm, eff: effE };
  };
  const events = [];
  for (const gp of groups) {
    const a = gp.a, b = gp.b;
    const sd = segDesc(a, b), ep = sd.ep, epm = sd.epm, effE = sd.eff;
    const tonal = []; let wAll = 0, wTon = 0;
    for (let m = a; m < b; m++) if (lev[m] >= ep - 12) { const w = amp[m]; wAll += w; if (aper[m] <= SFX.tonalAper && f0[m] >= 60) { wTon += w; tonal.push(m); } }
    for (let m = a; m < b; m++) if (lev[m] < ep - 12 && lev[m] >= ep - 25 && aper[m] <= SFX.tonalAper && f0[m] >= 60) tonal.push(m);
    tonal.sort((p, q) => p - q);
    const tonalFrac = wAll > 0 ? wTon / wAll : 0;
    // pitch: net change (first vs last third) and range, edges trimmed
    const trim = fr(0.015);
    const tt = tonal.filter(m => m >= a + trim && m < b - trim);
    let semis = 0, sRange = 0;
    if (tt.length >= 4) {
      const lp = tt.map(m => 12 * Math.log2(f0[m])), k3 = Math.max(1, Math.floor(lp.length / 3));
      semis = pctl(lp.slice(-k3), 0.5) - pctl(lp.slice(0, k3), 0.5);
      sRange = pctl(lp, 0.9) - pctl(lp, 0.1);
    }
    // brightness: net change and range over the body (within 12 dB of the event peak)
    const cb = []; for (let m = a; m < b; m++) if (lev[m] >= ep - 12) cb.push(m);
    let cOct = 0, cRange = 0;
    if (cb.length >= 3) {
      const cv = cb.map(m => cent[m]), k3 = Math.max(1, Math.floor(cv.length / 3));
      cOct = pctl(cv.slice(-k3), 0.5) - pctl(cv.slice(0, k3), 0.5);
      cRange = pctl(cv, 0.9) - pctl(cv, 0.1);
    }
    // amplitude modulation 8-40 Hz inside a sustained event
    let depth = 0;
    if (effE >= SFX.impulseDur && b - a >= fr(0.15)) {
      const s1 = movMean(amp.subarray(a, b), Math.max(1, Math.round(0.04 / dt)));
      const s2 = movMean(amp.subarray(a, b), Math.max(1, Math.round(0.008 / dt)));
      let q2 = 0, sm = 0, k = 0;
      for (let m = a; m < b; m++) if (lev[m] >= ep - 20) { const v = s2[m - a] - s1[m - a]; q2 += v * v; sm += amp[m]; k++; }
      depth = k && sm > 0 ? Math.sqrt(q2 / k) / (sm / k) : 0;
    }
    const iterative = gp.chain || depth >= SFX.iterDepth;
    const facture = iterative ? "iterative" : effE < SFX.impulseDur ? "impulse" : "sustained";
    // dynamic profile (Peeters & Deruty categories)
    const atk = (epm - a) * dt, pos = (epm - a) / Math.max(1, b - a);
    let lo = Infinity, hi = -Infinity; for (let m = a; m < b; m++) if (lev[m] >= ep - 30) { lo = Math.min(lo, lev[m]); hi = Math.max(hi, lev[m]); }
    const profile = iterative && hi - lo < 15 && pos > 0.1 && pos < 0.9 ? "stable" : hi - lo < 6 ? "stable" : atk < 0.03 ? "impulsive" : pos > 0.6 ? "ascending" : pos > 0.25 ? "ascending/descending" : "descending";
    let gTrend = 0;
    if (gp.chain && gp.grains.length >= 6) {
      const fcs = gp.grains.map(m => { const o = onInfo.find(x => x.m === m); return o ? o.fc : cent[m]; }), k3 = Math.max(1, Math.floor(fcs.length / 3));
      const rk = a => { const ix = a.map((v, i) => i).sort((p, q) => a[p] - a[q]); const r = new Array(a.length); ix.forEach((v, i) => { r[v] = i; }); return r; };
      const rho = pearson(Float32Array.from(rk(fcs)), Float32Array.from(fcs.map((_, i) => i)), null);
      gTrend = Math.abs(rho) >= 0.6 ? pctl(fcs.slice(-k3), 0.5) - pctl(fcs.slice(0, k3), 0.5) : 0;
    }
    let mass, dir = "";
    if (iterative && gp.chain && Math.abs(gTrend) >= SFX.grainGlideOct) { mass = "Y"; dir = gTrend > 0 ? "up" : "down"; }
    else if (tonalFrac >= SFX.tonalFrac) {
      if (!iterative && Math.abs(semis) >= SFX.glideSemis) { mass = "Y"; dir = semis > 0 ? "up" : "down"; }
      else if (facture === "sustained" && sRange >= SFX.rangeSemis) { mass = "Y"; dir = "up and down"; }
      else mass = "N";
    } else if (facture === "sustained" && profile !== "impulsive" && profile !== "descending" && (Math.abs(cOct) >= SFX.glideOct || cRange >= (effE >= 0.4 ? 0.6 : 0.8))) {
      mass = "Y"; dir = Math.abs(cOct) >= 0.4 ? (cOct > 0 ? "up" : "down") : "up and down";
    } else mass = "X";
    const tag = mass + (facture === "impulse" ? "′" : facture === "iterative" ? "″" : "");
    let endA = b; for (let m = epm; m < b; m++) if (lev[m] < ep - 35) { endA = m; break; }
    events.push({
      t0: a * dt, t1: b * dt, tEnd: endA * dt, peakT: tOf(epm), peakDb: ep, eff: effE, tag, mass, facture, dir, profile,
      word: SFX_WORDS[mass][facture] + (dir ? " " + dir : ""),
      grains: gp.grains.map(m => m * dt), tonalFrac, semis, sRange, cOct, cRange, depth,
      f0: tt.length ? Math.pow(2, pctl(tt.map(m => Math.log2(f0[m])), 0.5)) : 0
    });
  }
  // attack of the loudest event (simplified Timbre Toolbox: 20% -> 90% of peak amplitude)
  {
    const ev = events.find(e => e.t0 <= tOf(pm) && e.t1 >= tOf(pm) - dt) || events[0];
    const a = ev ? Math.round(ev.t0 / dt) : 0;
    let x20 = a, x90 = pm;
    for (let m = a; m <= pm; m++) if (amp[m] >= 0.2 * maxA) { x20 = m; break; }
    for (let m = x20; m <= pm; m++) if (amp[m] >= 0.9 * maxA) { x90 = m; break; }
    attackFix = Math.max(dt, (x90 - x20) * dt);
  }

  /* ---------- envelope phases per frame: 0 silent, 1 attack, 2 body, 3 tail ---------- */
  const phase = new Uint8Array(n);
  for (let m = 0; m < n; m++) phase[m] = lev[m] < pk - 45 ? 0 : lev[m] >= pk - 12 ? 2 : 3;
  for (const e of events) {
    const a = Math.round(e.t0 / dt), p = Math.round((e.peakT) / dt - 0.5);
    for (let m = a; m <= p && m < n; m++) if (phase[m]) phase[m] = 1;
  }

  /* ---------- layers: KL-NMF on mel magnitudes, 3 components, band-split init ---------- */
  const layers = [];
  const nmfRaw = { W: [], H: [], times: [] };
  {
    const K = SFX.nmfK, g = Math.max(1, Math.ceil(n / SFX.nmfCols)), T = Math.ceil(n / g);
    const V = new Float64Array(B * T);
    for (let t = 0; t < T; t++) for (let b = 0; b < B; b++) {
      let s = 0, k = 0;
      for (let m = t * g; m < Math.min(n, (t + 1) * g); m++) { s += Math.pow(10, F.melDb[m * B + b] / 10); k++; }
      V[b * T + t] = Math.sqrt(k ? s / k : 0) + 1e-9;
    }
    const W = new Float64Array(B * K), Hh = new Float64Array(K * T);
    const ctr = [B * 0.12, B * 0.45, B * 0.8], sig = B * 0.14;
    for (let k = 0; k < K; k++) {
      let sw = 0;
      for (let b = 0; b < B; b++) { const v = Math.exp(-0.5 * Math.pow((b - ctr[k]) / sig, 2)) + 0.02; W[b * K + k] = v; sw += v; }
      for (let b = 0; b < B; b++) W[b * K + k] /= sw;
      for (let t = 0; t < T; t++) { let s = 0; for (let b = 0; b < B; b++) s += W[b * K + k] * V[b * T + t]; Hh[k * T + t] = s + 1e-9; }
    }
    const WH = new Float64Array(B * T), Q = new Float64Array(B * T);
    const recon = () => { for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) { let s = 0; for (let k = 0; k < K; k++) s += W[b * K + k] * Hh[k * T + t]; WH[b * T + t] = s + 1e-12; Q[b * T + t] = V[b * T + t] / WH[b * T + t]; } };
    for (let it = 0; it < SFX.nmfIter; it++) {
      recon();
      for (let k = 0; k < K; k++) {
        let ws = 0; for (let b = 0; b < B; b++) ws += W[b * K + k];
        for (let t = 0; t < T; t++) { let s = 0; for (let b = 0; b < B; b++) s += W[b * K + k] * Q[b * T + t]; Hh[k * T + t] *= s / (ws + 1e-12); }
      }
      recon();
      for (let k = 0; k < K; k++) {
        let hs = 0; for (let t = 0; t < T; t++) hs += Hh[k * T + t];
        for (let b = 0; b < B; b++) { let s = 0; for (let t = 0; t < T; t++) s += Hh[k * T + t] * Q[b * T + t]; W[b * K + k] *= s / (hs + 1e-12); }
      }
      for (let k = 0; k < K; k++) {
        let sw = 0; for (let b = 0; b < B; b++) sw += W[b * K + k];
        if (sw > 0) { for (let b = 0; b < B; b++) W[b * K + k] /= sw; for (let t = 0; t < T; t++) Hh[k * T + t] *= sw; }
      }
    }
    let tot = 0; const sums = [];
    for (let k = 0; k < K; k++) { let s = 0; for (let t = 0; t < T; t++) s += Hh[k * T + t]; sums.push(s); tot += s; }
    let hmax = 0; for (let i = 0; i < K * T; i++) if (Hh[i] > hmax) hmax = Hh[i];
    for (let k = 0; k < K; k++) {
      let c = 0; for (let b = 0; b < B; b++) c += W[b * K + k] * lf[b];
      const hz = Math.pow(2, c);
      const actT = new Float32Array(T); let km = 0;
      for (let t = 0; t < T; t++) { actT[t] = Hh[k * T + t]; if (actT[t] > km) km = actT[t]; }
      const times = []; for (let t = 0; t < T; t++) times.push(Math.min(F.dur, (t * g + g / 2) * dt));
      const act = interpTimes(times, Array.from(actT, v => v > 0 ? Math.max(0, 1 + 20 * Math.log10(v / hmax) / 40) : 0), n, dt);
      let s0 = null, s1 = null;
      for (let t = 0; t < T; t++) if (actT[t] >= km * 0.1) { if (s0 === null) s0 = times[t]; s1 = times[t]; }
      const nm = hz < 150 ? "sub" : hz < 400 ? "low" : hz < 1500 ? "mid" : hz < 5000 ? "high" : "air";
      layers.push({ hz, share: tot > 0 ? sums[k] / tot : 0, act, span: [s0 || 0, s1 || 0], name: nm, spec: Array.from({ length: B }, (_, b) => W[b * K + k]), comps: [k] });
      nmfRaw.W.push(Float64Array.from({ length: B }, (_, b) => W[b * K + k])); nmfRaw.H.push(actT); nmfRaw.times = times;
    }
    layers.sort((p, q) => p.hz - q.hz);
    for (let i = 0; i + 1 < layers.length;) {
      const r = pearson(layers[i].act, layers[i + 1].act, null);
      if (r > 0.8 || (r > 0.6 && layers[i + 1].hz / layers[i].hz < 1.5)) {
        const p = layers[i], q = layers[i + 1], sh = p.share + q.share;
        const act = new Float32Array(n); for (let m = 0; m < n; m++) act[m] = Math.max(p.act[m], q.act[m]);
        const hz = Math.pow(2, (p.share * Math.log2(p.hz) + q.share * Math.log2(q.hz)) / Math.max(1e-9, sh));
        layers.splice(i, 2, { hz, share: sh, act, span: [Math.min(p.span[0], q.span[0]), Math.max(p.span[1], q.span[1])], name: hz < 150 ? "sub" : hz < 400 ? "low" : hz < 1500 ? "mid" : hz < 5000 ? "high" : "air", spec: p.spec.map((v, b) => (v * p.share + q.spec[b] * q.share) / Math.max(1e-9, sh)), comps: p.comps.concat(q.comps) });
      } else i++;
    }
    const keep = layers.filter(l => l.share >= 0.05);
    // components of dropped layers go to the nearest kept layer, so a remix keeps all energy
    if (keep.length) for (const l of layers) if (!keep.includes(l)) {
      let best = keep[0]; for (const q of keep) if (Math.abs(Math.log2(q.hz / l.hz)) < Math.abs(Math.log2(best.hz / l.hz))) best = q;
      best.comps = best.comps.concat(l.comps);
    }
    layers.length = 0; (keep.length ? keep : []).forEach(l => layers.push(l));
  }

  /* ---------- space: pan and width per frame ---------- */
  const stereo = buf.numberOfChannels > 1;
  const pan = new Float32Array(n), width = new Float32Array(n);
  let identical = stereo;
  {
    const eL = new Float64Array(n), eR = new Float64Array(n), eX = new Float64Array(n);
    for (let m = 0; m < n; m++) {
      const s0 = m * H, s1 = Math.min(len, s0 + H);
      let a = 0, b = 0, c = 0;
      for (let i = s0; i < s1; i++) { a += L[i] * L[i]; b += R[i] * R[i]; c += L[i] * R[i]; if (identical && Math.abs(L[i] - R[i]) > 1e-5) identical = false; }
      eL[m] = a; eR[m] = b; eX[m] = c;
    }
    const h = Math.max(1, Math.round(0.01 / dt));
    const sL = movMean(Float32Array.from(eL), h), sR = movMean(Float32Array.from(eR), h), sX = movMean(Float32Array.from(eX), h);
    for (let m = 0; m < n; m++) {
      const t = sL[m] + sR[m];
      pan[m] = t > 1e-12 ? (sR[m] - sL[m]) / t : 0;
      const cr = sL[m] > 1e-12 && sR[m] > 1e-12 ? sX[m] / Math.sqrt(sL[m] * sR[m]) : 1;
      width[m] = Math.max(0, Math.min(2, 1 - cr));
    }
  }

  /* ---------- asset checks ---------- */
  const issues = [], marks = [];
  let pkS = 0; for (let i = 0; i < len; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > pkS) pkS = v; }
  const pkDb = 20 * Math.log10(pkS + 1e-12);
  const chans = stereo ? [L, R] : [L];
  // clipping runs
  let clipN = 0; const clipT = [];
  for (const ch of chans) {
    let run = 0;
    for (let i = 0; i < len; i++) {
      if (Math.abs(ch[i]) >= 0.9999) run++;
      else { if (run >= 3) { clipN += run; const t = (i - run) / sr; if (!clipT.length || t - clipT[clipT.length - 1] > 0.01) clipT.push(t); } run = 0; }
    }
  }
  if (clipN) { issues.push({ sev: "bad", text: "Clipped: " + clipN + " samples in " + clipT.length + (clipT.length === 1 ? " place" : " places") }); clipT.forEach(t => marks.push({ t, kind: "clip" })); }
  // DC offset
  let dc = 0;
  for (const ch of chans) { let s = 0; for (let i = 0; i < len; i++) s += ch[i]; dc = Math.max(dc, Math.abs(s / len)); }
  if (dc > 0.005) issues.push({ sev: "warn", text: "DC offset " + (20 * Math.log10(dc)).toFixed(0) + " dBFS" });
  // leading and trailing silence (below -60 dBFS)
  let li = len, ti = -1;
  for (let i = 0; i < len; i++) if (Math.max(Math.abs(L[i] - dc), Math.abs(R[i] - dc)) > 0.001) { li = i; break; }
  for (let i = len - 1; i >= 0; i--) if (Math.max(Math.abs(L[i] - dc), Math.abs(R[i] - dc)) > 0.001) { ti = i; break; }
  const lead = li / sr, trail = ti >= 0 ? (len - 1 - ti) / sr : F.dur;
  if (lead > 0.02) issues.push({ sev: "warn", text: "Leading silence " + (lead * 1000).toFixed(0) + " ms" });
  if (trail > 0.1) issues.push({ sev: "info", text: "Trailing silence " + (trail * 1000).toFixed(0) + " ms" });
  // abrupt start and end (a one-shot that starts on a non-zero sample clicks; a cut tail clicks)
  const isLoop = !!(name && /loop|(^|[_\- ])lp([_\- .]|$)/i.test(name));
  const rmsAt = (a, b) => { let s = 0, k = 0; for (let i = Math.max(0, a); i < Math.min(len, b); i++) { const v = 0.5 * (L[i] + R[i]) - dc; s += v * v; k++; } return Math.sqrt(k ? s / k : 0); };
  const endRms = rmsAt(len - Math.round(0.005 * sr), len);
  const abruptStart = !isLoop && Math.max(Math.abs(L[0]), Math.abs(R[0])) > 0.003;
  const abruptEnd = !isLoop && endRms > pkS * Math.pow(10, -35 / 20);
  if (abruptStart) { issues.push({ sev: "warn", text: "First sample is not zero (click risk)" }); marks.push({ t: 0, kind: "start" }); }
  if (abruptEnd) { issues.push({ sev: "warn", text: "Ends abruptly: tail cut at " + (20 * Math.log10(endRms / (pkS + 1e-12))).toFixed(0) + " dB below peak" }); marks.push({ t: F.dur, kind: "end" }); }
  if (pkDb > -0.1 && !clipN) issues.push({ sev: "info", text: "Peak " + pkDb.toFixed(1) + " dBFS (no headroom)" });
  if (identical) issues.push({ sev: "info", text: "Stereo file with identical channels: could be mono" });
  // loop seam, only for files named as loops
  let seam = null;
  if (isLoop) {
    const jump = Math.max(Math.abs(L[len - 1] - L[0]), Math.abs(R[len - 1] - R[0])) / (pkS + 1e-12);
    // compare the spectra either side of the wrap with the file's own window-to-window change
    // (skip edge frames that are half zero-padded)
    const k = Math.max(1, fr(0.05)), e = Math.ceil((F.N / 2) / F.H);
    const meanWin = (m0) => { const v = new Float64Array(B); for (let m = m0; m < m0 + k; m++) for (let b = 0; b < B; b++) v[b] += F.melDb[Math.min(n - 1, Math.max(0, m)) * B + b] / k; return v; };
    const dist = (p, q) => { let s2 = 0; for (let b = 0; b < B; b++) s2 += Math.abs(p[b] - q[b]); return s2 / B; };
    const sd = n > 2 * (e + k) + 2 ? dist(meanWin(n - e - k), meanWin(e)) : 0;
    const internal = [];
    for (let m = e; m + 2 * k < n - e; m += k) internal.push(dist(meanWin(m), meanWin(m + k)));
    const ref = Math.max(2, internal.length ? pctl(internal, 0.9) : 2);
    seam = { jump, specDiff: sd, ref, ok: jump < 0.05 && sd <= ref };
    issues.push(seam.ok ? { sev: "ok", text: "Loop wraps cleanly" } : { sev: "warn", text: "Loop seam: " + (jump >= 0.05 ? "sample jump " + (jump * 100).toFixed(0) + "% of peak" : "change at the wrap " + sd.toFixed(1) + " dB, file's typical " + ref.toFixed(1) + " dB") });
  }

  /* ---------- silhouette bands: 6 groups of Bark-pair loudness shares ---------- */
  const bands6 = [];
  for (let k = 0; k < 6; k++) bands6.push(new Float32Array(n));
  for (let m = 0; m < n; m++) for (let k = 0; k < 6; k++) bands6[k][m] = X.share[m * NCOARSE + 2 * k] + X.share[m * NCOARSE + 2 * k + 1];

  F._sfx = {
    lev, pk, peakT: tOf(pm), attack: attackFix, eff, tcent, t20, t40, phase, events, f0, aper, cent, layers,
    pan, width, stereo, identical, issues, marks, lead, trail, pkDb, dc, seam, bands6, nmfRaw, melCenters: Array.from({ length: B }, (_, b) => melC(b)), sound: [first >= 0 ? first * dt : 0, endF * dt]
  };
  return F._sfx;
}

/* ===================================================================
   Asset-class guess
   =================================================================== */
function guessClass(F) {
  if (F.dur < 5) return "sfx";
  const cur = computeCurves(F, "rhythmic", { scale: "fixed" });
  const g = cur.gate;
  const ed = quantileMasked(cur.raw.ED, g, 0.5);
  const ton = quantileMasked(cur.raw.tonal, g, 0.5);
  if (ed >= 1.5) return "rhythmic";
  if (ton >= 0.5) return "orchestral";
  return "ambience";
}

/* ===================================================================
   Calibration (roughness 1 asper, fluctuation 1 vacil, loudness 1 sone)
   =================================================================== */
const calCache = {};
function synthBuf(sr, len, fn) {
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = fn(i / sr);
  return { sampleRate: sr, length: len, numberOfChannels: 1, duration: len / sr, getChannelData: () => d };
}
async function calibrate(sr) {
  if (calCache[sr]) return calCache[sr];
  const midStat = (a, f) => { const s = Math.floor(a.length * 0.3), e = Math.floor(a.length * 0.7); let t = 0; for (let i = s; i < e; i++) t += a[i]; return t / Math.max(1, e - s); };
  // 1 sone: 1 kHz tone at 40 dB SPL (full-scale sine = 100 dB)
  const fN = await extractFeatures(synthBuf(sr, Math.round(sr * 1), t => 0.001 * Math.sin(2 * Math.PI * 1000 * t)), null, { coarse: true });
  fN.cal = { kN: 1, kR: 1, kF: 1 };
  const cN = computeCurves(fN, "sfx", {});
  const kN = 1 / Math.max(1e-6, midStat(cN.raw.Nsone));
  // roughness: 1 kHz, 60 dB, 100% AM at 70 Hz
  const fR = await extractFeatures(synthBuf(sr, Math.round(sr * 1.5), t => 0.01 * (1 + Math.cos(2 * Math.PI * 70 * t)) / 1.0 * Math.sin(2 * Math.PI * 1000 * t)), null, { coarse: true });
  fR.cal = { kN, kR: 1, kF: 1 };
  const cR = computeCurves(fR, "sfx", {});
  const kR = 1 / Math.max(1e-6, midStat(cR.raw.Rr));
  // fluctuation: 1 kHz, 60 dB, 100% AM at 4 Hz
  const fF = await extractFeatures(synthBuf(sr, Math.round(sr * 4), t => 0.01 * (1 + Math.cos(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 1000 * t)), null, { coarse: true });
  fF.cal = { kN, kR, kF: 1 };
  const cF = computeCurves(fF, "rhythmic", {});
  const kF = 1 / Math.max(1e-6, midStat(cF.raw.Fl));
  calCache[sr] = { kN, kR, kF };
  return calCache[sr];
}

async function analyse(buf, onProgress) {
  const cal = await calibrate(buf.sampleRate);
  const F = await extractFeatures(buf, onProgress);
  F.cal = cal;
  F.guess = guessClass(F);
  return F;
}

/* ===================================================================
   Column pooling and diagnostics
   =================================================================== */
function pool(arr, n, cols, mode, dt, dur) {
  const o = new Float32Array(cols);
  const fpc = n / cols;
  for (let c = 0; c < cols; c++) {
    const a = c * fpc, b = (c + 1) * fpc;
    let s = Math.floor(a), e = Math.ceil(b);
    if (e - s <= 1) {
      const x = Math.min(n - 1, Math.max(0, (a + b) / 2 - 0.5));
      const i = Math.floor(x), f = x - i;
      o[c] = arr[i] * (1 - f) + arr[Math.min(n - 1, i + 1)] * f;
      continue;
    }
    e = Math.min(e, n);
    if (mode === "max") { let v = -Infinity; for (let i = s; i < e; i++) if (arr[i] > v) v = arr[i]; o[c] = v; }
    else { let v = 0; for (let i = s; i < e; i++) v += arr[i]; o[c] = v / (e - s); }
  }
  return o;
}
function pearson(a, b, mask) {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) { n++; sa += a[i]; sb += b[i]; }
  if (n < 5) return NaN;
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 1e-12 && db > 1e-12 ? num / Math.sqrt(da * db) : NaN;
}
function diffCorr(a, b, mask) {
  const n = a.length - 1;
  const da = new Float32Array(n), db = new Float32Array(n), mk = new Uint8Array(n);
  for (let i = 0; i < n; i++) { da[i] = a[i + 1] - a[i]; db[i] = b[i + 1] - b[i]; mk[i] = mask ? (mask[i] && mask[i + 1] ? 1 : 0) : 1; }
  return pearson(da, db, mk);
}
function disagreements(curve, ref, mask, k, minSepFrac) {
  const n = curve.length;
  const z = (a) => {
    let s = 0, s2 = 0, c = 0;
    for (let i = 0; i < n; i++) if (mask[i]) { s += a[i]; s2 += a[i] * a[i]; c++; }
    const mu = c ? s / c : 0, sd = c ? Math.sqrt(Math.max(1e-12, s2 / c - mu * mu)) : 1;
    return Array.from(a, v => (v - mu) / sd);
  };
  const za = z(curve), zb = z(ref);
  const d = za.map((v, i) => mask[i] ? v - zb[i] : -Infinity);
  const idx = d.map((v, i) => i).filter(i => isFinite(d[i]) && d[i] > 0.75).sort((x, y) => d[y] - d[x]);
  const sep = Math.max(1, Math.round(n * minSepFrac));
  const out = [];
  for (const i of idx) { if (out.every(j => Math.abs(j - i) >= sep)) out.push(i); if (out.length >= k) break; }
  return out.sort((x, y) => x - y).map(i => ({ i, d: d[i] }));
}

// re-derive everything downstream of the features after a parameter change (calibration)
function resetDerived(F) { F.melDb = F.melRaw ? applyMelFloor(F.melRaw, F.melDb) : F.melDb; delete F._base; delete F._rhythm; delete F._struct; delete F._events; delete F._sfx; delete F._desc; F.guess = guessClass(F); return F; }
const api = { FEAT, ONSET, applyMelFloor, resetDerived, extractFeatures, computeCurves, analyse, calibrate, guessClass, pool, pearson, diffCorr, disagreements, CLASSES, REF, quantileMasked, kFilterCoeffs, rhythmOf, eventsOf, structureOf, beatF, RHYTHM, STRUCT, sfxOf, SFX, getFFT, hannP, movMean, interpTimes, biquadInto, NMEL };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.WL = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
