// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The thresholds that tools/tune.js calibrates, their candidate values, and how to set them.
// Values are applied to the live constants in src/analysis.js (WL) and src/descriptors.js (PHD).
"use strict";
const WL = require("../src/analysis.js");
const PHD = require("../src/descriptors.js");

const SPACE = {
  melFloor: { label: "Mel spectrum floor", note: "absolute dB, or relative to the file's loudest band (level-invariant)", values: ["abs-80", "rel-70", "rel-80", "rel-90"] },
  onsetMin: { label: "Onset minimum, dB per band", note: "absolute part of the adaptive onset threshold", values: [0.4, 0.6, 0.9] },
  sfxRise: { label: "Event re-attack and band-rise threshold, dB", note: "sound-effect event segmentation", values: [4, 6, 8] },
  recEps: { label: "Recurrence threshold range", note: "clamp for the 10th-percentile distance (N8)", values: ["0.75-2", "1-2.5", "1.5-3"] }
};

/** The values the code ships with. */
function current() {
  return {
    melFloor: WL.FEAT.melRelDb > 0 ? "rel-" + WL.FEAT.melRelDb : "abs-" + Math.abs(WL.FEAT.melFloorDb),
    onsetMin: WL.ONSET.min, sfxRise: WL.SFX.riseDb, recEps: PHD.DESC.recEpsLo + "-" + PHD.DESC.recEpsHi
  };
}
const BASE = current();

function apply(cfg) {
  const c = Object.assign({}, BASE, cfg || {});
  const [kind, v] = String(c.melFloor).split("-");
  if (kind === "rel") { WL.FEAT.melRelDb = Number(v); } else { WL.FEAT.melRelDb = 0; WL.FEAT.melFloorDb = -Number(v); }
  WL.ONSET.min = Number(c.onsetMin);
  WL.SFX.riseDb = WL.SFX.bandRiseDb = Number(c.sfxRise);
  const [lo, hi] = String(c.recEps).split("-").map(Number); PHD.DESC.recEpsLo = lo; PHD.DESC.recEpsHi = hi;
  return c;
}
const label = cfg => Object.keys(SPACE).map(k => k + "=" + cfg[k]).join(" ");

module.exports = { SPACE, BASE, current, apply, label };
