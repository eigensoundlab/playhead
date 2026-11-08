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
  for (const k of ["straight", "snare-laid-back", "hats-pushed", "loose", "swing-2", "waltz", "pulse-32", "pulse-480", "no-beat"]) M[k] = (await measure(all[k])).m;
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
};
