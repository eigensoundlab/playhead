// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The stimuli of the listening test (see README.md), from the arrangements of experiments/arrange (results.json):
//   per session   the rough placement and the search's best candidate for each goal (punch, big, clean), mixed from the
//                 CC0 Sonic Pi samples exactly as arrange.js mixes them; 16 sessions (8 drum kits, 8 varied), of
//                 which each listener hears 8: one of each pair (session k, session k + 8)
//   two checks    with an answer anyone hears: a clean hit against the same hit with its parts 45 and 90 ms late
//                 ("cleaner"), and a big hit against the same hit without its sub and tail ("bigger")
// Every stimulus is set to the same maximum momentary loudness (ITU-R BS.1770, 400 ms), so that level does not decide
// what sounds punchier or bigger, starts 50 ms before its first sound and is written as 16-bit FLAC to site/stimuli/.
// site/manifest.json lists the stimuli with their measures (predicted and rendered, from results.json) and the trials.
//
//   node experiments/listening/render.js [sonic-pi-samples-dir]
"use strict";
const path = require("path"), fs = require("fs"), os = require("os"), { execFileSync } = require("child_process");
const P = require("../../src/playhead.js"), WL = require("../../src/analysis.js"), IO = require("../../tools/audio-io.js");

const SR = 44100;
const DIR = process.argv[2] || path.join(__dirname, "../corpus/src/sonic-pi/etc/samples");
const SITE = path.join(__dirname, "site"), OUT = path.join(SITE, "stimuli");
const RESULTS = JSON.parse(fs.readFileSync(path.join(__dirname, "../arrange/results.json"), "utf8"));
const ROLES = ["sub", "body", "transient", "tail"], GOALS = ["punch", "big", "clean"];
const TARGET_MAX = -16;                  // LUFS, maximum momentary loudness, lowered if a stimulus would peak above -1 dBFS
const GOAL_TEXT = {
  punch: { question: "Which one hits punchier?", help: "Punchy: the hit lands hard and at once, tight and focused, with nothing soft or late around it." },
  big: { question: "Which one sounds bigger?", help: "Big: large and full, with weight in the low end, a wide spread of frequencies and a long body or tail." },
  clean: { question: "Which one sounds cleaner?", help: "Clean: one clear hit whose parts don't smear or cover each other; no flams, no mud." }
};

// as experiments/arrange/arrange.js: a clip as an editor holds it (at most 2.5 s, faded out over its last 50 ms)
function load(name) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(DIR, name + ".flac"), "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice();
  const n = Math.min(x.length, Math.round(2.5 * SR)), y = x.slice(0, n), f = Math.round(0.05 * SR);
  for (let i = 0; i < f && i < n; i++) y[n - 1 - i] *= i / f;
  return y;
}
function mix(clips, parts) {
  const n = Math.max(...clips.map((x, k) => Math.round(parts[k].offset * SR) + x.length)) + Math.round(0.05 * SR), y = new Float32Array(n);
  clips.forEach((x, k) => { const o = Math.round(parts[k].offset * SR), g = Math.pow(10, parts[k].gain / 20); for (let i = 0; i < x.length; i++) if (o + i >= 0) y[o + i] += g * x[i]; });
  return y;
}
// maximum momentary loudness: K-weighted mean square over 400 ms windows every 10 ms (silence padded at both ends)
function maxMomentary(x) {
  const [s1, s2] = WL.kFilterCoeffs(SR), pad = Math.round(0.4 * SR), z = new Float32Array(x.length + 2 * pad), t = new Float32Array(z.length), k = new Float32Array(z.length);
  z.set(x, pad); WL.biquadInto(z, t, s1); WL.biquadInto(t, k, s2);
  const w = Math.round(0.4 * SR), hop = Math.round(0.01 * SR);
  let best = -Infinity;
  for (let a = 0; a + w <= k.length; a += hop) { let e = 0; for (let i = a; i < a + w; i++) e += k[i] * k[i]; best = Math.max(best, -0.691 + 10 * Math.log10(e / w + 1e-20)); }
  return best;
}
const peakDb = x => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return 20 * Math.log10(p + 1e-20); };
// 50 ms before the first sound (above -60 dBFS), a 20 ms fade-out at the end
function trim(x) {
  let i = 0; while (i < x.length && Math.abs(x[i]) < 1e-3) i++;
  const y = x.slice(Math.max(0, i - Math.round(0.05 * SR))), f = Math.round(0.02 * SR);
  for (let j = 0; j < f; j++) y[y.length - 1 - j] *= j / f;
  return y;
}
const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);

(async () => {
  await WL.calibrate(SR);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const stimuli = [], trials = [];
  const add = (id, y, meta) => { const s = { id, y: trim(y), ...meta }; s.loudness = maxMomentary(s.y); s.peak = peakDb(s.y); stimuli.push(s); return s; };
  const sessions = RESULTS.detail;
  for (let si = 0; si < sessions.length; si++) {
    const S = sessions[si], n = si + 1, clips = ROLES.map(r => load(S.kit[r]));
    const arr = kind => S.arrangements.find(a => a.kind === kind);
    const info = a => ({ parts: a.parts, scores: a.scores, predicted: a.predicted, rendered: a.rendered });
    add("s" + n + "-rough", mix(clips, S.base), { session: n, kind: "rough", kit: S.kit, ...info(arr("baseline")) });
    for (const g of GOALS) { const a = arr(g + "1"); if (a) add("s" + n + "-" + g, mix(clips, a.parts), { session: n, kind: g, kit: S.kit, ...info(a) }); }
    // the checks: session 3 for "cleaner" (its clean hit with the body 45 ms and the transient 90 ms late), session 6
    // for "bigger" (its big hit without the sub and the tail)
    if (n === 3) { const a = arr("clean1"), p = a.parts.map((q, k) => ({ ...q, offset: q.offset + (k === 1 ? 0.045 : k === 2 ? 0.09 : 0) })); add("check-smeared", mix(clips, p), { session: n, kind: "check", kit: S.kit, parts: p }); }
    if (n === 6) { const a = arr("big1"), p = a.parts.map((q, k) => ({ ...q, gain: k === 0 || k === 3 ? -80 : q.gain })); add("check-small", mix(clips, p), { session: n, kind: "check", kit: S.kit, parts: p }); }
  }
  // one gain per stimulus to the same maximum momentary loudness, the highest that keeps every peak below -1 dBFS
  const target = Math.min(TARGET_MAX, ...stimuli.map(s => s.loudness + (-1 - s.peak)));
  for (const s of stimuli) {
    s.gainDb = target - s.loudness;
    const g = Math.pow(10, s.gainDb / 20), y = Float32Array.from(s.y, v => v * g);
    const tmp = path.join(os.tmpdir(), "playhead-listening-" + s.id + ".wav");
    IO.writeWav(tmp, { numberOfChannels: 1, length: y.length, sampleRate: SR, getChannelData: () => y }, true);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "8", path.join(OUT, s.id + ".flac")]);
    fs.rmSync(tmp);
    s.duration = y.length / SR;
  }
  const byId = Object.fromEntries(stimuli.map(s => [s.id, s]));
  // the rendered score for a goal (what the measures say of the mix as heard); a check has none
  const said = (id, g) => byId[id].scores ? byId[id].scores[g].rendered : null;
  // main trials: the rough placement against the search's best for a goal, asked about that goal
  for (let n = 1; n <= sessions.length; n++) for (const g of GOALS) {
    const c = "s" + n + "-" + g;
    if (byId[c]) trials.push({ id: "s" + n + "-" + g, type: "main", goal: g, session: n, pair: ["s" + n + "-rough", c], candidate: c,
      gain: { predicted: r3(byId[c].scores[g].predicted - byId["s" + n + "-rough"].scores[g].predicted), rendered: r3(said(c, g) - said("s" + n + "-rough", g)) } });
  }
  // cross trials, one per session: two goals' best candidates, asked about one of the two goals (rotating)
  const CROSS = [["punch", "big", "big"], ["big", "clean", "clean"], ["clean", "punch", "punch"], ["punch", "big", "punch"], ["big", "clean", "big"], ["clean", "punch", "clean"], ["punch", "big", "big"], ["big", "clean", "clean"],
    ["clean", "punch", "clean"], ["punch", "big", "big"], ["big", "clean", "big"], ["clean", "punch", "punch"], ["punch", "big", "punch"], ["big", "clean", "clean"], ["clean", "punch", "punch"], ["punch", "big", "big"]];
  for (let n = 1; n <= sessions.length; n++) {
    const [g1, g2, ask] = CROSS[(n - 1) % CROSS.length], a = "s" + n + "-" + g1, b = "s" + n + "-" + g2;
    if (!byId[a] || !byId[b] || JSON.stringify(byId[a].parts) === JSON.stringify(byId[b].parts)) continue;
    const target2 = ask === g1 ? a : b, other = target2 === a ? b : a;
    trials.push({ id: "s" + n + "-cross-" + g1 + "-" + g2, type: "cross", goal: ask, session: n, pair: [a, b], candidate: target2, gain: { rendered: r3(said(target2, ask) - said(other, ask)) } });
  }
  trials.push({ id: "check-clean", type: "check", goal: "clean", session: 3, pair: ["s3-clean", "check-smeared"], expected: "s3-clean" });
  trials.push({ id: "check-big", type: "check", goal: "big", session: 6, pair: ["s6-big", "check-small"], expected: "s6-big" });
  // which of the two the rendered measures favour, where they say
  for (const t of trials) if (t.type !== "check") { const [a, b] = t.pair, d = said(a, t.goal) - said(b, t.goal); t.favoured = d > 0 ? a : d < 0 ? b : null; }

  const manifest = {
    test: "playhead-listening-goals", version: 2,
    // each listener hears one session of each pair: [k, k + half]
    sessionPairs: Array.from({ length: sessions.length / 2 }, (_, k) => [k + 1, k + 1 + sessions.length / 2]),
    generator: "experiments/listening/render.js, Playhead " + P.version + ", from experiments/arrange/results.json (" + RESULTS.generator + ")",
    loudness: { measure: "maximum momentary loudness (ITU-R BS.1770, 400 ms windows)", target: r3(target) },
    goals: GOAL_TEXT,
    stimuli: stimuli.map(s => ({ id: s.id, file: "stimuli/" + s.id + ".flac", session: s.session, kind: s.kind, kit: s.kit, duration: r3(s.duration), gainDb: r3(s.gainDb), parts: s.parts,
      scores: s.scores || null, predicted: s.predicted || null, rendered: s.rendered || null })),
    trials
  };
  fs.writeFileSync(path.join(SITE, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  const bytes = fs.readdirSync(OUT).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(stimuli.length + " stimuli (" + (bytes / 1e6).toFixed(2) + " MB of FLAC) at " + target.toFixed(1) + " LUFS maximum momentary loudness; " + trials.length + " trials: " +
    ["main", "cross", "check"].map(k => trials.filter(t => t.type === k).length + " " + k).join(", "));
  const fav = trials.filter(t => t.type === "main" && t.favoured !== t.candidate);
  if (fav.length) console.log("main trials where the rendered measures favour the rough placement: " + fav.map(t => t.id).join(", "));
})().catch(e => { console.error(e); process.exit(1); });
