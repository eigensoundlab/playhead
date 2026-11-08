// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead cues (src/cues.js) on the demos whose parts are known (experiments/bench): events from a document, rules
// into cues known in advance, a live source that cannot look ahead, evaluation, the cue sheet; and what the demos
// show of the analysis itself (pitch, glides, vibrato and rotor rates, a sound's tail).
"use strict";

module.exports = async function (check) {
  const P = require("../src/playhead.js"), C = require("../src/cues.js"), IO = require("../tools/audio-io.js");
  const AV = require("../experiments/av/site/drivers.js");
  const render = async (gen, profile) => { const R = require("../experiments/bench/" + gen).render(44100); return { R, doc: await P.analyze(IO.makeBuffer(R.sr, [R.y]), { profile }) }; };
  const near = (list, t, w) => list.some(x => Math.abs(x - t) <= w);

  // the sound-design reel: shots, a motor, a pass-by, an alarm
  const { R: reel, doc: sfx } = await render("sounddesign.js", "sfx");
  const src = C.source(sfx), E = n => src.events[n] || [];
  const shots = reel.truth.shots.map(s => s.t), bolts = [].concat(...reel.truth.shots.map(s => s.bolt));
  check("cues: a sound-design reel as events: every shot a sound (to its attack), a boom (low hit) and the bolts (high hits), the tails of the shots that ring out",
    `sounds at shots ${shots.filter(t => near(E("sound").map(e => e.t), t, 0.03)).length}/${shots.length}, booms ${shots.filter(t => near(E("hit.low").map(e => e.t), t, 0.03)).length}, bolts ${bolts.filter(t => near(E("hit.high").map(e => e.t), t, 0.03)).length}/${bolts.length}; tails ${E("tail").map(e => e.t.toFixed(2) + "+" + e.length.toFixed(2)).join(" ")}`,
    shots.every(t => near(E("sound").map(e => e.t), t, 0.03)) && shots.every(t => near(E("hit.low").map(e => e.t), t, 0.03)) && bolts.every(t => near(E("hit.high").map(e => e.t), t, 0.03))
      && [reel.truth.shots[0].t, reel.truth.shots[3].t, reel.truth.explosion.t].every(t => E("tail").some(e => e.t > t && e.t - t < 0.8)));
  const m = reel.truth.motor, up = E("glide.up").find(e => e.t < m.up[1] && e.t + e.length > m.up[0]), down = E("glide.down").find(e => e.t < m.down[1] && e.t + e.length > m.down[0]);
  const rotor = E("vibrato").find(e => e.t < m.run[1] && e.t + e.length > m.run[0]), pb = E("passBy")[0];
  check("cues: the motor's spin-up and spin-down as glides, its 24 Hz rotor as vibrato, the pass-by with its closest moment",
    `up ${up && up.t.toFixed(2)}+${up && up.length.toFixed(2)}, down ${down && down.t.toFixed(2)}; rotor ${rotor && rotor.rate} Hz; pass-by closest ${pb && pb.peak} (true ${reel.truth.passBy.closest})`,
    !!up && !!down && !!rotor && Math.abs(rotor.rate - 24) < 1 && !!pb && Math.abs(pb.peak - reel.truth.passBy.closest) < 0.15);

  // rules into cues; the weapon preset; a live source
  const W = C.presets.weapon, cues = C.compile(src, W.rules);
  const flashes = cues.filter(c => c.action === "flash").map(c => c.t), smokes = cues.filter(c => c.action === "smoke");
  const at = C.evaluate(cues, W.mappings, src, reel.truth.shots[0].t + 0.01), boom = C.evaluate(cues, W.mappings, src, reel.truth.shots[0].t + 0.06), later = C.evaluate(cues, W.mappings, src, 1.2);
  check("cues: the weapon rules flash on each shot, shake on its boom, raise smoke over its tail; evaluated, the actions rise and fall",
    `flashes at shots ${shots.filter(t => near(flashes, t, 0.03)).length}/${shots.length}; smoke cues ${smokes.length}; at the first shot flash ${at.flash.toFixed(2)} punch ${at.punch.toFixed(2)}, 60 ms later shake ${boom.shake.toFixed(2)}; at 1.2 s smoke ${later.smoke.toFixed(2)}, flash ${later.flash.toFixed(2)}`,
    shots.every(t => near(flashes, t, 0.03)) && smokes.length >= 3 && at.flash > 0.3 && at.punch > 0.3 && boom.shake > 0.3 && later.flash === 0 && later.smoke > 0.2);

  const I = C.presets.impact, ic = C.compile(src, I.rules), xt = reel.truth.explosion.t;
  const xs = a => ic.filter(c => c.action === a && c.t > xt - 0.03 && c.t < xt + 0.8);
  check("cues: the impact rules on the explosion: a shockwave and a shake on its peak, then smoke and a fading glow over its after-effect",
    `shockwave ${xs("shockwave").map(c => c.t.toFixed(3)).join(" ")}, shake ${xs("shake").map(c => c.t.toFixed(3)).join(" ")}, smoke ${xs("smoke").map(c => c.t.toFixed(3) + "+" + c.length.toFixed(2)).join(" ")}, glow ${xs("glow").map(c => c.t.toFixed(3) + "+" + c.length.toFixed(2)).join(" ")} (explosion ${xt})`,
    xs("shockwave").some(c => c.t - xt < 0.05) && xs("shake").length >= 1 && xs("smoke").some(c => c.t > xt + 0.1 && c.length > 0.5) && xs("glow").some(c => c.t > xt + 0.1 && c.shape === "fade"));

  // the arrangement: anticipation lands on the drop; a live source cannot
  const { R: arr, doc: music } = await render("arrangement.js", "music");
  const msrc = C.source(music), A = C.presets.anticipation, mc = C.compile(msrc, A.rules), dark = mc.find(c => c.action === "darken");
  const drop = arr.truth.drop, bar = arr.truth.bar;
  const before = C.evaluate(mc, [], msrc, drop - bar).darken, onIt = C.evaluate(mc, [], msrc, drop - 0.02).darken;
  const S = AV.standardDrivers(arr.y, arr.sr), live = AV.usualSource(S), lc = C.compile(live, A.rules);
  check("cues: anticipation: darkening starts two bars before the drop and is full on it, known in advance; a live source can only start at its events",
    `darken from ${dark && dark.t.toFixed(2)} to ${dark && (dark.t + dark.length).toFixed(2)} (drop ${drop.toFixed(2)}); halfway ${before.toFixed(2)}, on the drop ${onIt.toFixed(2)}; live cues before their events: ${lc.filter(c => c.t < 0).length}, live darkening ${lc.filter(c => c.action === "darken").length}`,
    !!dark && Math.abs(dark.t - (drop - 2 * bar)) < 0.1 && Math.abs(dark.t + dark.length - drop) < 0.1 && before > 0.3 && before < 0.5 && onIt > 0.75
      && lc.filter(c => c.action === "darken").every(c => live.events.drop.some(e => Math.abs(e.t - c.t) < 1e-3)));
  const sheet = C.sheet(msrc, C.presets.playhead.rules, C.presets.playhead.mappings, { rate: 30 });
  let bundled = null; try { const U = require("../dist/playhead-core.js").cues; bundled = U && JSON.stringify(U.sheet(U.source(music), U.presets.playhead.rules, U.presets.playhead.mappings, { rate: 30 }).cues); } catch (e) { bundled = null; }
  check("cues: a cue sheet: every cue with its time, length, action and amount, and the mappings at 30 a second; the library bundle makes the same",
    `${sheet.cues.length} cues, curves ${Object.keys(sheet.curves.values).join(", ")} of ${sheet.curves.values.rough.length} values (${music.source.duration.toFixed(1)} s); bundle ${bundled == null ? "missing (npm run build:dist)" : bundled === JSON.stringify(sheet.cues) ? "the same" : "different"}`,
    sheet.format === "playhead-cues" && sheet.cues.length > 100 && sheet.cues.every(c => c.t >= 0 && c.length > 0 && C.actions[c.action]) && sheet.curves.values.rough.length === Math.ceil(music.source.duration * 30)
      && bundled === JSON.stringify(sheet.cues));

  // the melodic piece: the pitch curve, slides, vibrato
  const { R: mel, doc: md } = await render("melodic.js", "music");
  const rows = Object.fromEntries(AV.compare("melodic", mel.truth, AV.standardDrivers(mel.y, mel.sr), md).map(r => [r.what.split(" (")[0], r.raw]));
  check("cues: a melodic piece: the pitch curve on the notes, the long slides, the vibrato and its rate, the phrase boundaries",
    `pitch ${Math.round(100 * rows["Pitch on the notes"].ph)} % (the loudest bin ${Math.round(100 * rows["Pitch on the notes"].std)} %); slides ${rows["Slides of 0.2 s and more"].found}/${rows["Slides of 0.2 s and more"].of}; vibrato ${rows["Vibrato on long notes"].found}/${rows["Vibrato on long notes"].of} at ${rows["Vibrato on long notes"].rate} Hz; phrases ${rows.Phrases.found}/${rows.Phrases.of}`,
    rows["Pitch on the notes"].ph > 0.9 && rows["Slides of 0.2 s and more"].found >= 3 && rows["Vibrato on long notes"].found >= 15 && Math.abs(rows["Vibrato on long notes"].rate - 5.5) < 0.3 && rows.Phrases.found === rows.Phrases.of);
};
