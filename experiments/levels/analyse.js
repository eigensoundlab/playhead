// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The events and checks of each sound in a folder (sfx profile), for measures.py: node analyse.js <folder> writes
// playhead.json in the current folder.
"use strict";
const fs = require("fs"), path = require("path");
const P = require(path.join(__dirname, "../../src/playhead.js")), IO = require(path.join(__dirname, "../../tools/audio-io.js"));
(async () => {
  const dir = process.argv[2], out = {};
  if (!dir) { console.error("usage: node analyse.js <folder of sounds>"); process.exit(2); }
  for (const f of fs.readdirSync(dir).filter(f => /\.(flac|wav)$/i.test(f)).sort()) {
    const doc = await P.analyze(IO.readAudio(path.join(dir, f)), { profile: "sfx" });
    out[f] = { dur: doc.source.duration, summary: doc.summary, assetClass: doc.assetClass, issues: doc.issues,
      events: (doc.events || []).map(e => ({ start: e.start, end: e.end, decayEnd: e.decayEnd, peak: e.peak, peakDb: e.peakDb, facture: e.facture })) };
    process.stderr.write(".");
  }
  fs.writeFileSync("playhead.json", JSON.stringify(out, null, 1));
  process.stderr.write("\n");
})();
