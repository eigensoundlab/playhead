// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The descriptor bench: Playhead's analysis of sounds whose truth is known to the sample (stimuli.js), measured
// against that truth. Old and new descriptors are measured the same way, so a change to the analysis shows here first.
//
//   node experiments/bench/run.js            # table on stdout, results.json beside this file
//   const { measure } = require("./run.js")  # the measures of one stimulus (used by test/grid-tests.js)
"use strict";
const path = require("path"), fs = require("fs");
const B = require("./stimuli.js"), P = require("../../src/playhead.js"), IO = require("../../tools/audio-io.js");

const median = v => { if (!v.length) return null; const w = v.slice().sort((a, b) => a - b); return w.length % 2 ? w[w.length >> 1] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2; };
const pct = (v, p) => { if (!v.length) return null; const w = v.slice().sort((a, b) => a - b); return w[Math.min(w.length - 1, Math.floor(p * (w.length - 1)))]; };
const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
// the time of the nearest of `times` to t (or null)
function nearest(times, t) { let b = null; for (const x of times) if (b == null || Math.abs(x - t) < Math.abs(b - t)) b = x; return b; }

/** The measures of one stimulus: the document, and what it gets right against the truth. */
async function measure(S) {
  const doc = await P.analyze(IO.makeBuffer(S.sr, [S.y]), { profile: "music", name: S.name });
  const T = S.truth, hits = T.hits, m = { name: S.name };
  // onsets: the old frame onsets and the new attacks, against the hits (those found within 50 ms)
  const err = times => { const e = hits.map(h => { const x = nearest(times, h.t); return x == null ? null : (x - h.t) * 1000; }).filter(v => v != null && Math.abs(v) <= 50); return e; };
  const eOld = err(doc.onsets), eNew = err(doc.attacks.map(a => a.t));
  m.onsets = { found: eNew.length / hits.length, oldMedianMs: r2(median(eOld.map(Math.abs))), oldBiasMs: r2(median(eOld)), medianMs: r2(median(eNew.map(Math.abs))), p90Ms: r2(pct(eNew.map(Math.abs), 0.9)) };
  // bands: for hits with no other hit within 15 ms, the band of the nearest attack
  const alone = hits.filter(h => !hits.some(o => o !== h && Math.abs(o.t - h.t) < 0.015));
  const bandOk = alone.filter(h => { const a = doc.attacks.reduce((p, c) => (p == null || Math.abs(c.t - h.t) < Math.abs(p.t - h.t) ? c : p), null); return a && Math.abs(a.t - h.t) < 0.03 && a.band === h.band; });
  m.bands = alone.length ? r2(bandOk.length / alone.length) : null;
  const R = doc.rhythm || {};
  m.rhythm = { tempo: R.tempo, reliable: R.reliable, beatsPerBar: R.beatsPerBar, downbeatConfidence: R.downbeatConfidence, swing: R.swing == null ? null : R.swing, timing: R.timing || null };
  const pc = (doc.curves.pulseClarity || []).filter(v => v != null);
  m.pulseClarity = pc.length ? r2(pc.reduce((a, b) => a + b, 0) / pc.length) : null;
  if (T.bpm && T.beatsPerBar) {
    // downbeats: the share of true bar starts with a downbeat within 70 ms
    const starts = Array.from({ length: T.bars }, (_, k) => T.start + k * T.beatsPerBar * 60 / T.bpm);
    m.downbeats = r2(starts.filter(t => (R.downbeats || []).some(d => Math.abs(d - t) < 0.07)).length / starts.length);
    m.meterRight = R.beatsPerBar === T.beatsPerBar;
    // per band offsets against the truth (read against the low band, as Playhead reads them)
    const truthOff = band => { const inst = { low: "kick", mid: "snare", high: "hat" }[band]; return (T.offsets[inst] || 0) - (T.offsets.kick || 0); };
    if (R.timing) m.offsetErrMs = Object.fromEntries(["mid", "high"].map(b => [b, R.timing.offsets[b] == null ? null : r2(R.timing.offsets[b] - truthOff(b))]));
    if (R.timing) m.tightnessMs = R.timing.tightness;
    if (T.swing !== 1 || R.swing != null) m.swingErr = R.swing == null ? null : r2(R.swing - T.swing);
  }
  // the tempogram's strongest tempo, against a pulse's (or a groove's) tempo, octaves allowed
  if (doc.rhythm && doc.rhythm.tempogram && T.bpm) {
    const v = P.view(doc, "tempo"), tg = doc.rhythm.tempogram, rows = [];
    for (let r = 0; r < v.rows; r++) { let s = 0; for (let c = 0; c < v.cols; c++) s += Math.max(0, v.values[r * v.cols + c]); rows.push([s, tg.bpmMin * Math.pow(2, (v.rows - 1 - r) / tg.perOctave)]); }
    rows.sort((a, b) => b[0] - a[0]);
    const top = rows[0][1], oct = Math.log2(top / T.bpm);
    m.tempogram = { top: Math.round(top), octaveOff: Math.round(oct), withinPct: r2(100 * Math.abs(Math.pow(2, oct - Math.round(oct)) - 1)), range: [tg.bpmMin, Math.round(tg.bpmMin * Math.pow(2, (tg.bins - 1) / tg.perOctave))] };
  }
  return { doc, m };
}

if (require.main === module) (async () => {
  const out = [], stimuli = B.all(44100);
  for (const S of stimuli) { const { m } = await measure(S); out.push(m); process.stderr.write(S.name + " "); }
  process.stderr.write("\n");
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ generator: "experiments/bench/run.js, Playhead " + P.version, results: out }, null, 1) + "\n");
  const f = v => (v == null ? "–" : typeof v === "number" ? String(v) : String(v));
  console.log("| Sound | onsets found | old onset error (median, bias) | attack error (median, p90) | bands | tempo | bars of | downbeats | downbeat conf. | swing (error) | tightness | offsets mid, high (error) | pulse clarity | tempogram top |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of out) {
    const R = m.rhythm;
    console.log("| " + [m.name, f(r2(m.onsets.found)), f(m.onsets.oldMedianMs) + " ms, " + f(m.onsets.oldBiasMs), f(m.onsets.medianMs) + ", " + f(m.onsets.p90Ms) + " ms", f(m.bands), f(R.tempo),
      f(R.beatsPerBar) + (m.meterRight === false ? " (wrong)" : ""), f(m.downbeats), f(R.downbeatConfidence), R.swing == null ? "–" : R.swing + (m.swingErr != null ? " (" + m.swingErr + ")" : ""),
      f(m.tightnessMs), m.offsetErrMs ? f(R.timing.offsets.mid) + ", " + f(R.timing.offsets.high) + " (" + f(m.offsetErrMs.mid) + ", " + f(m.offsetErrMs.high) + ")" : "–", f(m.pulseClarity),
      m.tempogram ? m.tempogram.top + (m.tempogram.octaveOff ? " (" + (m.tempogram.octaveOff > 0 ? "×" + Math.pow(2, m.tempogram.octaveOff) : "÷" + Math.pow(2, -m.tempogram.octaveOff)) + ")" : "") : "–"].join(" | ") + " |");
  }
})().catch(e => { console.error(e); process.exit(1); });

module.exports = { measure };
