// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Cross-field descriptors against analytic reference values (not thresholds tuned on the same signals):
// spectral kurtosis 0 for Gaussian noise and -1 for a tone, burstiness -1 periodic / ~0 Poisson, Aki b-value,
// time-reversal flips the arrow of time, a sweep's optimal-transport velocity equals its rate, the predictive
// information rate of a known Markov chain, Klatzky damping of modal synthesis, and invariance under speed change.
"use strict";
const WL = require("../src/analysis.js");
const P = require("../src/probes.js");
const PHD = require("../src/descriptors.js");
const { DP, mkMono } = P;

module.exports = async function run(check) {
  const sr = 44100;
  const q = (a, p) => { const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
  const D = async x => { const b = mkMono(sr, x); const F = await WL.analyse(b); return PHD.describe(F, b); };
  const resample = (x, r) => { const n = Math.floor(x.length / r), o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i * r, j = Math.floor(t), u = t - j; o[i] = x[j] * (1 - u) + (x[Math.min(x.length - 1, j + 1)] || 0) * u; } return o; };
  const sineSweep = (f0, R, dur) => { const x = new Float32Array(Math.round(dur * sr)); let ph = 0; for (let i = 0; i < x.length; i++) { ph += 2 * Math.PI * f0 * Math.pow(2, R * i / sr) / sr; x[i] = 0.2 * Math.sin(ph); } return x; };
  const f2 = v => Number.isFinite(v) ? v.toFixed(2) : String(v);

  const noise = await D(DP.noise(sr, 4, 21, 0.08)), tone = await D(DP.tone(sr, 4, 440, 0.2)), pink = await D(DP.pink(sr, 6));
  check("descriptors: spectral kurtosis, noise 0 / tone −1", f2(noise.summary.kurtosis.K) + " / " + f2(tone.summary.kurtosis.K), Math.abs(noise.summary.kurtosis.K) < 0.1 && Math.abs(tone.summary.kurtosis.K + 1) < 0.02);

  const per = await D(DP.clicks(sr, 10, DP.periodicTimes(10, 8))), poi = await D(DP.clicks(sr, 30, DP.poissonTimes(30, 8, 22))), clu = await D(DP.clicks(sr, 30, DP.clusterTimes(30, 23)));
  check("descriptors: clicks are impulsive (kurtosis > 10)", f2(per.summary.kurtosis.K), per.summary.kurtosis.K > 10);
  check("descriptors: burstiness periodic / Poisson / clustered", [per, poi, clu].map(d => f2(d.summary.events.B)).join(" / "),
    per.summary.events.B < -0.95 && Math.abs(poi.summary.events.B) < 0.15 && clu.summary.events.B > 0.25 && per.summary.events.n === DP.periodicTimes(10, 8).length);
  { const r = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
    const mags = Array.from({ length: 3000 }, () => -2 + (-Math.log(1 - r()) / Math.LN10)), b = PHD.bValue(mags).b;
    check("descriptors: Gutenberg–Richter b-value (true 1.0)", f2(b), Math.abs(b - 1) < 0.1); }
  { const one = await D(DP.clicks(sr, 2, [1.0])); check("descriptors: temporal entropy, noise ~1 / one click low", f2(noise.summary.events.Ht) + " / " + f2(one.summary.events.Ht), noise.summary.events.Ht > 0.98 && one.summary.events.Ht < 0.3); }

  const imp = await D(DP.impacts(sr, 4, 0.5, 26)), rev = await D(DP.reverse(DP.impacts(sr, 4, 0.5, 26)));
  check("descriptors: arrow of time, pink noise ~0", f2(pink.summary.arrow.T20), Math.abs(pink.summary.arrow.T20) < 0.1 && !Number.isFinite(tone.summary.arrow.T20));
  check("descriptors: arrow of time flips under reversal", f2(imp.summary.arrow.T20) + " / " + f2(rev.summary.arrow.T20), imp.summary.arrow.T20 > 2 && Math.abs(imp.summary.arrow.T20 + rev.summary.arrow.T20) < 0.05 * imp.summary.arrow.T20);

  const up = await D(sineSweep(200, 2, 3)), dn = await D(DP.reverse(sineSweep(200, 2, 3)));
  check("descriptors: spectral velocity of a 2 oct/s sweep", f2(q(up.curves.vel, 0.5)) + " / " + f2(q(dn.curves.vel, 0.5)), Math.abs(q(up.curves.vel, 0.5) - 2) < 0.1 && Math.abs(q(dn.curves.vel, 0.5) + 2) < 0.1 && Math.abs(q(noise.curves.vel, 0.5)) < 0.15);

  const am23 = DP.am(sr, 6, 23, 25), a23 = await D(am23), a23f = await D(resample(am23, 1.06));
  check("descriptors: repetition rate 23 Hz, ×1.06 when sped up", f2(a23.summary.repetition.hz) + " → " + f2(a23f.summary.repetition.hz), Math.abs(a23.summary.repetition.hz - 23) < 0.1 && Math.abs(a23f.summary.repetition.hz - 23 * 1.06) < 0.15);
  check("descriptors: no repetition in noise, a tone or one hit", [noise, tone].map(d => f2(d.summary.repetition.hz)).join(" / "), !Number.isFinite(noise.summary.repetition.hz) && !Number.isFinite(tone.summary.repetition.hz) && Math.abs(per.summary.repetition.hz - 8) < 0.05);
  { const s5 = await D(DP.am(sr, 6, 5, 24)), s15 = await D(DP.am(sr, 6, 1.5, 24)); check("descriptors: speech-rate modulation 5 Hz vs 1.5 Hz", f2(s5.summary.repetition.speech) + " / " + f2(s15.summary.repetition.speech) + " dB", s5.summary.repetition.speech > 10 && s15.summary.repetition.speech < -10); }

  const pul = await D(DP.pulses(sr, 3, 150));
  check("descriptors: cepstral peak prominence, pulses vs noise", f2(pul.summary.periodicity.cpp - noise.summary.periodicity.cpp) + " dB", pul.summary.periodicity.cpp - noise.summary.periodicity.cpp > 20);
  check("descriptors: phase coherence, tone 1 / noise ~0", f2(tone.summary.periodicity.pci) + " / " + f2(noise.summary.periodicity.pci), tone.summary.periodicity.pci > 0.95 && noise.summary.periodicity.pci < 0.1);

  { const r = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
    const iid = Int32Array.from({ length: 20000 }, () => Math.floor(r() * 8)), cyc = Int32Array.from({ length: 20000 }, (_, i) => i % 8), two = new Int32Array(20000);
    for (let i = 1; i < two.length; i++) two[i] = (two[i - 1] + 1 + (r() < 0.5 ? 0 : 1)) % 8;
    const pir = s => { const m = PHD.markovInfo(s, 8, { beta: 1 }); const t = Array.from(m.pi.slice(5000)); return t.reduce((a, b) => a + b, 0) / t.length; };
    const pi = [pir(iid), pir(cyc), pir(two)];
    check("descriptors: predictive information rate iid / cycle / chain (0, 0, 0.347)", pi.map(v => v.toFixed(3)).join(" / "), pi[0] < 0.01 && pi[1] < 0.01 && Math.abs(pi[2] - (1.0397 - Math.LN2)) < 0.02);
    check("descriptors: no interest in steady noise or a tone", f2(noise.summary.info.pir) + " / " + f2(tone.summary.info.pir), noise.summary.info.pir < 0.05 && tone.summary.info.pir < 0.05); }

  const p3 = await D(DP.phrase(sr, 6, 3, 29)), p1 = await D(DP.phrase(sr, 18, 1, 31));
  check("descriptors: recurrence, repeated phrase vs no repeats", f2(p3.summary.recurrence.RR) + " / " + f2(p1.summary.recurrence.RR), p3.summary.recurrence.RR > 0.08 && p1.summary.recurrence.RR < 0.03);
  check("descriptors: held state (laminarity), tone and noise", f2(tone.summary.recurrence.LAM) + " / " + f2(noise.summary.recurrence.LAM), tone.summary.recurrence.LAM > 0.95 && noise.summary.recurrence.LAM > 0.95);

  const gl = DP.modal(sr, 2.5, 900, 0.002, 27), G = await D(gl), W = await D(DP.modal(sr, 1.5, 400, 0.03, 28)), M = await D(DP.modal(sr, 4, 600, 0.0005, 30)), Gf = await D(resample(gl, 1.06));
  const lt = d => d.summary.decay.logTau;
  check("descriptors: Klatzky damping, glass / wood / metal (2.20, 1.03, 2.80)", [G, W, M].map(d => f2(lt(d))).join(" / "),
    Math.abs(lt(G) - 2.2) < 0.25 && Math.abs(lt(W) - 1.03) < 0.25 && Math.abs(lt(M) - 2.8) < 0.25 && G.summary.decay.material === "glass-like" && W.summary.decay.material.startsWith("damped") && M.summary.decay.material === "metal-like");
  check("descriptors: material survives a speed change; ring time ÷1.06", f2(lt(Gf) - lt(G)) + " / " + f2(G.summary.decay.t60 / Gf.summary.decay.t60), Math.abs(lt(Gf) - lt(G)) < 0.1 && Math.abs(G.summary.decay.t60 / Gf.summary.decay.t60 - 1.06) < 0.08);
  check("descriptors: noise bursts are not called a material", imp.summary.decay.material, imp.summary.decay.material === "not modal");
};
