// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead levels (summary.levels, src/levels.js, playhead levels): the measures against values known by construction
// (BS.1770-5 calibration, a window over a short burst, the true peak of a sine at a quarter of the sample rate), the
// rules and the gain, and a manifest and report made by the command line from files whose answer is known.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");

module.exports = async function (check) {
  const P = require("../src/playhead.js"), L = require("../src/levels.js"), IO = require("../tools/audio-io.js");
  const root = path.join(__dirname, ".."), sr = 48000;
  const tone = (secs, f, amp, o = {}) => {
    const n = Math.round((o.total || secs) * sr), x = new Float32Array(n), a = Math.round((o.at || 0) * sr), m = Math.round(secs * sr), fade = Math.round((o.fade || 0) * sr);
    for (let k = 0; k < m && a + k < n; k++) { const w = fade ? Math.min(1, k / fade, (m - 1 - k) / fade) : 1; x[a + k] = amp * w * Math.sin(2 * Math.PI * f * k / sr + (o.phase || 0)); }
    return x;
  };
  const levels = async (chans, profile) => (await P.analyze(IO.makeBuffer(sr, chans), { profile: profile || "sfx" })).summary.levels;

  // the measures
  const mono = await levels([tone(2, 997, 1)]), stereo = await levels([tone(2, 997, 1), tone(2, 997, 1)]);
  check("levels: BS.1770-5 calibration: a 997 Hz sine at 0 dBFS reads -3.01 LUFS in one channel and 0 LUFS in two; the 3 s window over a 2 s sound is that window with silence around it",
    `mono: integrated ${mono.file.integrated}, Max M ${mono.file.momentaryMax}, Max S ${mono.file.shortTermMax} (expected -4.77), RMS ${mono.file.rms} dBFS; stereo: ${stereo.file.integrated} LUFS`,
    Math.abs(mono.file.integrated + 3.01) < 0.02 && Math.abs(mono.file.momentaryMax + 3.01) < 0.02 && Math.abs(mono.file.shortTermMax + 4.77) < 0.02 && Math.abs(mono.file.rms + 3.01) < 0.02
      && Math.abs(stereo.file.integrated) < 0.02);
  const burst = await levels([tone(0.1, 997, 1, { at: 0.9, total: 2 })]);
  check("levels: a 100 ms burst: the loudest 0.4 s window holds it with 300 ms of silence (-6.02 dB), as a meter shows an isolated sound; the event's own span reads the burst",
    `Max M ${burst.file.momentaryMax} (expected -9.03), event span ${burst.event && burst.event.start}–${burst.event && burst.event.end} s, its RMS ${burst.event && burst.event.rms} dBFS`,
    Math.abs(burst.file.momentaryMax + 9.03) < 0.05 && burst.event && burst.event.start > 0.85 && burst.event.start < 0.95 && Math.abs(burst.event.rms + 3.01) < 1.5);
  const qs = await levels([tone(1, sr / 4, 1, { phase: Math.PI / 4, fade: 0.01 })]);
  check("levels: the true peak of a sine at a quarter of the sample rate sampled 45 degrees off its crests: samples at -3.01 dBFS, true peak 0 dBTP",
    `peak ${qs.peak} dBFS, true peak ${qs.truePeak} dBTP`, Math.abs(qs.peak + 3.01) < 0.02 && Math.abs(qs.truePeak) < 0.1);
  const two = await levels([(() => { const x = tone(0.3, 600, 0.1, { at: 0.2, total: 3, fade: 0.005 }), y = tone(0.3, 600, 0.8, { at: 1.6, total: 3, fade: 0.005 }); return x.map((v, i) => v + y[i]); })()]);
  check("levels: the event scope is the loudest event; the events scope is the median of the events within 20 dB of it",
    `event at ${two.event && two.event.start} s, Max M ${two.event && two.event.momentaryMax}; events: ${two.events && two.events.count} (the quiet one is 18 dB down), median Max M ${two.events && two.events.momentaryMax}`,
    two.event && Math.abs(two.event.start - 1.6) < 0.05 && two.events && two.events.count === 2 && two.events.momentaryMax < two.event.momentaryMax);
  const fast = await levels([tone(2, 997, 0.5)], "fast");
  check("levels: the fast profile has no events, so no event scopes; a rule asking for one falls back to the whole file",
    `event ${fast.event}, events ${fast.events}; momentaryMax@event -> ${L.valueOf(L.flat(fast), "momentaryMax@event").used}`,
    fast.event === null && fast.events === null && L.valueOf(L.flat(fast), "momentaryMax@event").used === "momentaryMax");

  // rules and the gain
  const spec = { format: "playhead-levels", version: 1, levels: { measure: "integrated", target: -20, amount: 1, depth: 1, limits: { boost: 12, cut: 40, truePeak: -1 } },
    rules: [{ tag: "Weapons/Shotguns", role: "group", offset: 3 }, { tag: "Weapons", role: "group", offset: 2 }, { tag: "Explosions", role: "group", offset: 4 },
      { tag: "subtle", role: "modifier", offset: -4 }, { tag: "hero", role: "modifier", offset: 2, on: false }, { tag: "Nature", role: "note" }] };
  const E = (tags, integrated, truePeak) => ({ tags, measures: { integrated, truePeak: truePeak == null ? -10 : truePeak } });
  const g1 = L.gainOf(spec, E(["Weapons/Shotguns/Pump", "subtle", "hero", "Nature"], -25));
  const g2 = L.gainOf(spec, E(["Weapons", "Explosions"], -25));
  const g3 = L.gainOf(Object.assign({}, spec, { levels: Object.assign({}, spec.levels, { depth: 0.5, amount: 0.5 }) }), E(["Explosions"], -25));
  const g4 = L.gainOf(spec, E(["Explosions"], -40, -6)), g5 = L.gainOf(spec, E([], -50, -40));
  check("levels: rules: the first group rule that matches wins (a parent tag matches its children), modifiers add, rules switched off and notes change nothing; gain = amount x (target - measured) + depth x offsets",
    `shotgun, subtle: ${g1.group} ${g1.gain} dB (5 + 3 - 4), notes ${g1.notes}; weapon and explosion: ${g2.group} ${g2.gain} dB, also ${g2.alsoGroups}; half amount and depth: ${g3.gain} dB (2.5 + 2)`,
    g1.group === "Weapons/Shotguns" && g1.gain === 4 && g1.notes.join() === "Nature" && g1.modifiers.join() === "subtle"
      && g2.group === "Weapons" && g2.gain === 7 && g2.alsoGroups.join() === "Explosions" && g3.gain === 4.5);
  check("levels: limits: the gain never lifts a file's true peak over the ceiling, nor goes past the boost limit; the wanted gain is kept for the report",
    `quiet explosion: wanted ${g4.wanted}, got ${g4.gain} (${g4.limitedBy}); very quiet file: wanted ${g5.wanted}, got ${g5.gain} (${g5.limitedBy})`,
    g4.limitedBy === "truePeak" && g4.gain === 5 && g4.wanted === 24 && g5.limitedBy === "boost" && g5.gain === 12);
  check("levels: automatic tags: the folder, the UCS category in the name, Playhead's class; tags match case-insensitively and by parent",
    L.autoTags("Audio/Guns/GUNShotgn_Pump Close_01.wav", "impulse").join(" "),
    L.autoTags("Audio/Guns/GUNShotgn_Pump Close_01.wav", "impulse").join(" ") === "folder:Guns ucs:GUNShotgn class:impulse" && L.matchTag("weapons", "Weapons/Shotguns") && !L.matchTag("Weapon", "Weapons"));

  // the command line on a folder whose answer is known: five hits of one kind, one of them 8 dB quiet; one clipped;
  // a bed at a sample rate the spec does not expect
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playhead-levels-")), hits = path.join(tmp, "hits"), beds = path.join(tmp, "beds");
  fs.mkdirSync(hits); fs.mkdirSync(beds);
  const hit = (amp, seed) => { const x = new Float32Array(sr); let s = seed; for (let i = 0; i < 0.6 * sr; i++) { s = (s * 16807) % 2147483647; x[i] = amp * Math.exp(-i / (0.08 * sr)) * (s / 2147483647 * 2 - 1); } return x; };
  [0.5, 0.45, 0.55, 0.5, 0.2].forEach((a, i) => IO.writeWav(path.join(hits, `hit_${i + 1}.wav`), IO.makeBuffer(sr, [hit(a, 7 + i)]), true));
  const clipped = hit(3, 99).map(v => Math.max(-1, Math.min(1, v))); IO.writeWav(path.join(hits, "hit_clipped.wav"), IO.makeBuffer(sr, [clipped]), true);
  IO.writeWav(path.join(beds, "bed_22k.wav"), IO.makeBuffer(22050, [tone(4, 200, 0.05).slice(0, 4 * 22050)]), true);
  const specFile = path.join(tmp, "spec.json"), out = path.join(tmp, "playhead-levels.json"), rep = path.join(tmp, "report.html");
  fs.writeFileSync(specFile, JSON.stringify({ format: "playhead-levels", version: 1, levels: { measure: "momentaryMax@event", target: -18 },
    rules: [{ tag: "folder:beds", role: "group", offset: -10, measure: "integrated@active" }], checks: { sampleRate: [44100, 48000] } }));
  const cli = path.join(root, "tools/playhead-cli.js");
  const run1 = spawnSync(process.execPath, [cli, "levels", tmp, "--spec", specFile, "--out", out, "--report", rep], { encoding: "utf8" });
  let man = null; try { man = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { man = null; }
  const R = man ? L.report(man) : null, gH = R && R.groups.find(g => g.name === "folder:hits");
  const quiet = gH && gH.outliers.find(o => /hit_5/.test(o.path)), clip = R && R.problems.find(p => /hit_clipped/.test(p.path)), bed = R && R.problems.find(p => /bed_22k/.test(p.path));
  const bedFile = man && man.files.find(f => /bed_22k/.test(f.path));
  check("levels: the command line: a manifest with every file, the quiet hit an outlier of its folder by about -8 dB, the clipped hit and the bed at 22.05 kHz to check, the bed measured by its group's own measure",
    run1.status !== 0 ? "failed: " + (run1.stderr || "").slice(0, 300) : `${man.files.length} files; hits median ${gH && gH.median}, outlier ${quiet && quiet.path} ${quiet && quiet.off} dB; clipped: ${clip && clip.why.join("; ")}; bed: ${bed && bed.why.join("; ")} (gain ${bedFile && bedFile.gain})`,
    run1.status === 0 && man.format === "playhead-levels" && man.files.length === 7 && !!quiet && Math.abs(quiet.off + 8) < 1.5 && !!clip && clip.why.some(w => /Clipped/.test(w))
      && !!bed && bed.why.some(w => /22050/.test(w)) && bedFile && Math.abs(bedFile.gain - (-18 - 10 - bedFile.measures["integrated@active"])) < 0.02 && fs.readFileSync(rep, "utf8").includes("<h2>Groups</h2>"));
  const run2 = spawnSync(process.execPath, [cli, "levels", tmp, "--spec", out, "--out", out, "--report", path.join(tmp, "r.csv")], { encoding: "utf8" });
  check("levels: the manifest is the store: run again with it, no file is analysed again; the CSV report has a row per file",
    (run2.stderr || "").trim(), run2.status === 0 && /7 files \(7 measured before\)/.test(run2.stderr) && fs.readFileSync(path.join(tmp, "r.csv"), "utf8").trim().split("\n").length === 8);
  let bundled = null; try { const U = require("../dist/playhead-core.js").levels; bundled = U && U.gainOf(spec, E(["Weapons/Shotguns/Pump", "subtle"], -25)).gain; } catch (e) { bundled = null; }
  check("levels: the library bundle has the same levels", `bundle ${bundled == null ? "missing (npm run build:dist)" : bundled + " dB"}`, bundled === 4);
  fs.rmSync(tmp, { recursive: true, force: true });
};
