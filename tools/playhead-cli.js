#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead command line: the same analysis as the app, for editors, engines and asset managers.
//
//   playhead analyze <files or folders...> [--profile auto|fast|sfx|music] [--out file.json | --out-dir dir]
//                    [--curve-rate N] [--wave-columns N] [--fill-null V] [--pretty]
//   playhead analyze - --sr 44100 --channels 2 [...]   raw interleaved float32 (little-endian) samples on stdin
//   playhead markers <file> [--format tsv|csv|json] [--kinds sections,events,downbeats,onsets] [--profile ...]
//   playhead process <file> --tool <id> [--param name=value ...] [--out-dir dir]
//   playhead tools        list the processing tools and their parameters (JSON)
//   playhead version
//
// One file without --out or --out-dir prints the JSON document to stdout. WAV is read directly; other formats
// need ffmpeg on the PATH. Also available as a single executable built by tools/build.js --cli.
"use strict";
const fs = require("fs"), path = require("path");
const Playhead = global.__PLAYHEAD_BUNDLED__ || (require("../src/analysis.js"), require("../src/descriptors.js"), require("../src/effects.js"), require("../src/playhead.js"));
const IO = global.__PLAYHEAD_IO__ || require("./audio-io.js");

const HELP = `Playhead ${Playhead.version}: overview curves, events, sections and descriptors for sound files.

  playhead analyze <files or folders...> [--profile auto|fast|sfx|music] [--out file.json | --out-dir dir]
                   [--curve-rate N] [--wave-columns N] [--fill-null V] [--pretty]
  playhead analyze - --sr 44100 --channels 2 [...]     (raw interleaved float32 samples on stdin)
  playhead markers <file> [--format tsv|csv|json] [--kinds sections,events,downbeats,onsets]
  playhead process <file> --tool <id> [--param name=value ...] [--out-dir dir]
  playhead tools
  playhead version

Profiles: fast (curves only, for large libraries), sfx (plus events, tags, layers, checks, descriptors),
music (plus beats and sections), auto (sfx up to 10 s, music above). Output schema: ${Playhead.schema} v${Playhead.schemaVersion}.
WAV is read directly; other formats need ffmpeg on the PATH.`;

function parse(argv) {
  const o = { _: [], param: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pretty") o.pretty = true;
    else if (a === "--param") o.param.push(argv[++i]);
    else if (a.startsWith("--")) o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else o._.push(a);
  }
  return o;
}
const fail = msg => { process.stderr.write("playhead: " + msg + "\n"); process.exit(2); };
const read = (file, o) => {
  if (!fs.existsSync(file)) fail("no such file: " + file);
  try { return IO.readAudio(file, o.sr ? { sr: Number(o.sr) } : undefined); }
  catch (e) { fail("cannot read " + file + ": " + e.message + (IO.hasFfmpeg() ? "" : " (only WAV is read without ffmpeg)")); }
};
const opts = (o, file) => ({ profile: o.profile || "auto", name: path.basename(file), curveRate: o.curveRate ? Number(o.curveRate) : undefined, waveColumns: o.waveColumns ? Number(o.waveColumns) : undefined });
const value = v => v === "true" ? true : v === "false" ? false : (v !== "" && isFinite(Number(v)) ? Number(v) : v);
// raw interleaved float32 from stdin, for hosts that decode audio themselves (kurator, game engines)
function readStdin(o) {
  const sr = Number(o.sr), nc = Number(o.channels || 1);
  if (!(sr > 0) || !(nc >= 1)) fail("reading stdin needs --sr and --channels");
  const raw = fs.readFileSync(0), n = Math.floor(raw.length / 4 / nc), f = new Float32Array(raw.buffer, raw.byteOffset, n * nc);
  const chs = Array.from({ length: Math.min(2, nc) }, (_, c) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = f[i * nc + c]; return x; });
  return IO.makeBuffer(sr, chs);
}
// replace nulls (silence) in the curves for JSON readers that cannot hold them, such as Unity's JsonUtility
function fillNull(doc, v) { for (const k of Object.keys(doc.curves)) if (Array.isArray(doc.curves[k])) doc.curves[k] = doc.curves[k].map(x => x == null ? v : x); return doc; }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2), o = parse(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); return; }
  if (cmd === "version" || cmd === "--version") { console.log(Playhead.version); return; }
  if (cmd === "tools") { console.log(JSON.stringify(Playhead.tools(), null, 1)); return; }
  if (cmd === "analyze" || cmd === "analyse") {
    if (!o._.length) fail("analyze needs at least one file or folder");
    if (o._[0] === "-") {
      const doc = await Playhead.analyze(readStdin(o), opts(o, o.name || "stdin"));
      if (o.fillNull !== undefined) fillNull(doc, Number(o.fillNull));
      const json = JSON.stringify(doc, null, o.pretty ? 1 : 0);
      if (o.out) fs.writeFileSync(o.out, json + "\n"); else process.stdout.write(json + "\n");
      return;
    }
    const files = IO.listAudio(o._);
    if (!files.length) fail("no audio files found");
    const single = files.length === 1 && !o.outDir;
    if (o.outDir) fs.mkdirSync(o.outDir, { recursive: true });
    for (const f of files) {
      const doc = await Playhead.analyze(read(f, o), opts(o, f));
      doc.source.path = path.resolve(f);
      if (o.fillNull !== undefined) fillNull(doc, Number(o.fillNull));
      const json = JSON.stringify(doc, null, o.pretty ? 1 : 0);
      if (single && !o.out) process.stdout.write(json + "\n");
      else {
        const target = single && o.out ? o.out : path.join(o.outDir || ".", path.basename(f).replace(/\.[^.]+$/, "") + ".playhead.json");
        fs.writeFileSync(target, json + "\n");
        process.stderr.write(`${path.basename(f)}: ${doc.profile}, ${doc.timing.ms} ms -> ${target}\n`);
      }
    }
    return;
  }
  if (cmd === "markers") {
    const f = o._[0]; if (!f) fail("markers needs a file");
    const doc = await Playhead.analyze(read(f, o), Object.assign(opts(o, f), { profile: o.profile || "music" }));
    const marks = Playhead.toMarkers(doc, { kinds: (o.kinds || "sections,events").split(",") });
    const fmt = o.format || "tsv";
    if (fmt === "json") { console.log(JSON.stringify(marks, null, o.pretty ? 1 : 0)); return; }
    const sep = fmt === "csv" ? "," : "\t", esc = s => fmt === "csv" && /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : String(s).replace(/[\t\n]/g, " ");
    console.log(["kind", "start", "end", "name"].join(sep));
    for (const m of marks) console.log([m.kind, m.start, m.end == null ? "" : m.end, esc(m.name)].join(sep));
    return;
  }
  if (cmd === "process") {
    const f = o._[0]; if (!f) fail("process needs a file"); if (!o.tool) fail("process needs --tool (see: playhead tools)");
    const params = {}; for (const kv of o.param) { const i = kv.indexOf("="); if (i < 1) fail("--param expects name=value"); const k = kv.slice(0, i), v = kv.slice(i + 1); params[k] = k === "gains" ? v.split(",").map(Number) : value(v); }
    const r = await Playhead.process(read(f, o), o.tool, params, { name: path.basename(f) });
    const dir = o.outDir || "."; fs.mkdirSync(dir, { recursive: true });
    for (const out of r.outputs) {
      const target = path.join(dir, path.basename(f).replace(/\.[^.]+$/, "") + "_" + out.suffix + ".wav");
      IO.writeWav(target, IO.makeBuffer(out.sampleRate, out.channels), true);
      process.stderr.write("wrote " + target + "\n");
    }
    console.log(r.report.join("\n"));
    return;
  }
  fail("unknown command " + cmd + "\n\n" + HELP);
}
main().catch(e => { process.stderr.write("playhead: " + (e && e.stack || e) + "\n"); process.exit(1); });
