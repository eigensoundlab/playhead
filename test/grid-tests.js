// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The timing infrastructure on the bench's grooves (experiments/bench), whose every hit is known to the sample:
// attacks to the sample, the band each rises in, the grid with each band's offset and the tightness, swing, the meter,
// the tempogram's range and pulse clarity.
"use strict";

module.exports = async function (check) {
  const B = require("../experiments/bench/stimuli.js"), { measure } = require("../experiments/bench/run.js");
  const all = Object.fromEntries(B.all(44100).map(s => [s.name, s]));
  const M = {};
  for (const k of ["straight", "snare-laid-back", "hats-pushed", "loose", "swing-2", "waltz", "pulse-32", "pulse-480", "no-beat", "fills", "swing-change"]) M[k] = (await measure(all[k])).m;
  const D = {};
  for (const k of ["riser", "swell", "timbres", "pass-by", "straight-140", "sixteenths"]) { const r = await measure(all[k]); M[k] = r.m; D[k] = r.doc; }
  D.straight = (await measure(all.straight)).doc; D.waltz = (await measure(all.waltz)).doc;
  const s = M.straight;
  check("grid: attacks to the sample (the frame onsets were about 14 ms early), each in its band",
    `attacks ${s.onsets.medianMs} ms (90 % within ${s.onsets.p90Ms}), onsets ${s.onsets.oldMedianMs} ms; bands ${s.bands}`,
    s.onsets.found === 1 && s.onsets.medianMs < 1.5 && s.onsets.p90Ms < 8 && s.onsets.oldMedianMs > 8 && s.bands >= 0.95 && M.loose.bands >= 0.9);
  const off = (m, b) => m.rhythm.timing.offsets[b];
  check("grid: a snare 25 ms behind the kick and hats 15 ms ahead are read as such; a straight groove is tight, a loose one (12 ms) is not",
    `snare ${off(M["snare-laid-back"], "mid")} ms, hats ${off(M["hats-pushed"], "high")} ms; tightness ${s.tightnessMs} and ${M.loose.tightnessMs} ms`,
    Math.abs(off(M["snare-laid-back"], "mid") - 25) < 3 && Math.abs(off(M["hats-pushed"], "high") + 15) < 3 && Math.abs(off(s, "mid")) < 3
      && s.tightnessMs < 3 && Math.abs(M.loose.tightnessMs - 12) < 4);
  check("grid: swing ratio, the meter (3/4 against 4/4) and the downbeats",
    `swing ${M["swing-2"].rhythm.swing} (true 2), straight ${s.rhythm.swing}; waltz ${M.waltz.rhythm.beatsPerBar} beats a bar, downbeats ${M.waltz.downbeats}; 4/4 ${s.rhythm.beatsPerBar}`,
    Math.abs(M["swing-2"].rhythm.swing - 2) < 0.15 && Math.abs(s.rhythm.swing - 1) < 0.1 && M.waltz.rhythm.beatsPerBar === 3 && M.waltz.downbeats >= 0.9
      && s.rhythm.beatsPerBar === 4 && s.downbeats >= 0.9);
  check("grid: the tempogram reaches 30 to 590 BPM (a 32 BPM and a 480 BPM pulse at their tempo); pulse clarity is low without a beat",
    `${M["pulse-32"].tempogram.top} and ${M["pulse-480"].tempogram.top} BPM in ${M["pulse-32"].tempogram.range.join(" to ")}; clarity ${s.pulseClarity} against ${M["no-beat"].pulseClarity}`,
    M["pulse-32"].tempogram.octaveOff === 0 && M["pulse-32"].tempogram.withinPct < 3 && M["pulse-480"].tempogram.octaveOff === 0 && M["pulse-480"].tempogram.withinPct < 3
      && M["pulse-32"].tempogram.range[0] === 30 && M["pulse-32"].tempogram.range[1] >= 585 && M["no-beat"].pulseClarity < s.pulseClarity - 0.15);
  check("grid: fills and a break found bar by bar (pattern surprise), swing followed bar by bar",
    `${M.fills.changes.found.join(" ")} (precision ${M.fills.changes.precision}, recall ${M.fills.changes.recall}); swing per bar off by ${M["swing-change"].barSwingErr} (at most ${M["swing-change"].barSwingMax})`,
    M.fills.changes.precision === 1 && M.fills.changes.recall >= 0.99 && M["swing-change"].barSwingErr < 0.1 && M["swing-change"].barSwingMax < 0.3);
  const P = require("../src/playhead.js");
  check("motion: builds that are not louder found (a riser and a swell at constant loudness), none in a steady groove",
    `riser overlap ${M.riser.buildIoU}, swell ${M.swell.buildIoU}; builds in straight: ${M.straight.builds.length}, no-beat: ${M["no-beat"].builds.length}`,
    M.riser.buildIoU >= 0.5 && M.swell.buildIoU >= 0.5 && M.straight.builds.length === 0 && M["no-beat"].builds.length === 0 && M["swing-2"].builds.length === 0);
  check("motion: distortion tells a clipped tone from smooth, bright and rough ones at equal loudness",
    `AUC ${M.timbres.distortion.auc}; ${JSON.stringify(M.timbres.distortion.means)}`, M.timbres.distortion.auc >= 0.95);
  const pb = M["pass-by"].passBy, vib = M["pass-by"].vibrato;
  check("motion: a pass-by (Doppler glide, loudest in the middle) with its moment and a speed; vibrato and a rotor rate",
    pb ? `closest at ${pb.closest} s (true 4), ${pb.speed} m/s (true 25, a lower bound); vibrato ${vib.map(v => v && v.rate).join(" and ")} Hz (true 6 and 28)` : "no pass-by",
    !!pb && Math.abs(pb.closestErr) < 0.3 && pb.speed > 12 && pb.speed < 30 && vib.every(v => v && Math.abs(v.rate - v.trueRate) / v.trueRate < 0.1) && M.straight.glides === 0);
  const sim = k => P.rhythmSimilarity(D.straight, D[k]);
  check("motion: the rhythm signature finds the same beat alike at another tempo, other rhythms less so",
    `110 against 140 BPM ${sim("straight-140")}; waltz ${sim("waltz")}, 16ths ${sim("sixteenths")}`,
    sim("straight-140") > 0.95 && sim("straight-140") - Math.max(sim("waltz"), sim("sixteenths")) > 0.04);
};
