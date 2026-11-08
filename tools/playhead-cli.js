#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead command line: the same analysis as the app, for editors, engines and asset managers.
//
//   playhead analyze <files or folders...> [--profile auto|fast|sfx|music] [--out file.json | --out-dir dir]
//                    [--curve-rate N] [--wave-columns N] [--fill-null V] [--pretty]
//   playhead analyze - --sr 44100 --channels 2 [...]   raw interleaved float32 (little-endian) samples on stdin
//   playhead markers <file> [--format tsv|csv|json|audacity|edl|srt] [--kinds sections,events,downbeats,onsets]
//                         [--fps N --start-tc 01:00:00:00 (edl)] [--profile ...]   (file: audio or a .playhead.json)
//   playhead frames <file> [--fps 60] [--curves a,b,...] [--scale fixed|file|raw] [--format csv|json|blender]
//                         the curves once per video frame, for engines, VJ and 3D tools
//   playhead process <file> --tool <id> [--param name=value ...] [--out-dir dir]
//   playhead arrange --parts parts.json [--goal punch|big|clean] [--range s] [--gains lo,hi] [--count N] [--seed N]
//                         layers: parts.json is [{ doc: "a.playhead.json", offset, gain, start, end, lock }]; prints the
//                         candidates (JSON), as Playhead.arrange
//   playhead tools        list the processing tools and their parameters (JSON)
//   playhead version
//
// One file without --out or --out-dir prints the JSON document to stdout. WAV is read directly; other formats
// need ffmpeg on the PATH. Also available as a single executable built by tools/build.js --cli.
// Files are written whole: into a temporary file next to the target, then renamed, so a host waiting for one never
// reads it half-written.
"use strict";
const fs = require("fs"), path = require("path");
const Playhead = global.__PLAYHEAD_BUNDLED__ || (require("../src/analysis.js"), require("../src/descriptors.js"), require("../src/effects.js"), require("../src/playhead.js"));
const IO = global.__PLAYHEAD_IO__ || require("./audio-io.js");

const HELP = `Playhead ${Playhead.version}: overview curves, events, sections and descriptors for sound files.

  playhead analyze <files or folders...> [--profile auto|fast|sfx|music] [--out file.json | --out-dir dir]
                   [--curve-rate N] [--wave-columns N] [--fill-null V] [--pretty]
  playhead analyze - --sr 44100 --channels 2 [...]     (raw interleaved float32 samples on stdin)
  playhead markers <file> [--format tsv|csv|json|audacity|edl|srt] [--kinds sections,events,downbeats,onsets]
                   [--fps 25 --start-tc 01:00:00:00]      (edl: DaVinci Resolve timeline markers)
  playhead frames <file> [--fps 60] [--curves loudness,onsetStrength,...] [--scale fixed|file|raw] [--format csv|json|blender]
  playhead process <file> --tool <id> [--param name=value ...] [--out-dir dir]
  playhead arrange --parts parts.json [--goal punch|big|clean] [--range s] [--gains lo,hi] [--count N] [--seed N]
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
// write a file so that no reader (a host polling for it, a cache) ever sees it half-written: into a temporary file
// next to the target, then renamed over it; a failed write leaves the target as it was and no temporary file
function writeAtomic(target, write) {
  const tmp = path.join(path.dirname(target), "." + path.basename(target) + "." + process.pid + ".tmp");
  try { write(tmp); fs.renameSync(tmp, target); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) { } throw e; }
}
const writeText = (target, text) => writeAtomic(target, tmp => fs.writeFileSync(tmp, text));

// the document for a file: read when it is a .json document, analysed otherwise
async function documentOf(f, o, profile) {
  if (/\.json$/i.test(f)) {
    let doc; try { doc = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail("cannot read " + f + ": " + e.message); }
    if (!doc || doc.schema !== Playhead.schema || !doc.curves) fail(f + " is not a Playhead document");
    return doc;
  }
  return Playhead.analyze(read(f, o), Object.assign(opts(o, f), { profile: o.profile || profile }));
}

// markers for editors: Audacity labels, DaVinci Resolve timeline markers (EDL), subtitles (SRT) for any video editor
const pad2 = n => String(n).padStart(2, "0");
function timecode(frames, fps) {
  const f = Math.round(frames), r = Math.round(fps);
  return [Math.floor(f / (3600 * r)), Math.floor(f / (60 * r)) % 60, Math.floor(f / r) % 60, f % r].map(pad2).join(":");
}
const srtTime = t => { const ms = Math.round(t * 1000); return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(pad2).join(":") + "," + String(ms % 1000).padStart(3, "0"); };
const oneLine = s => String(s == null ? "" : s).replace(/[\t\r\n|]+/g, " ").trim();
const MARKER_FORMATS = {
  // File > Import > Labels: start, end and text, tab-separated; a point label has end = start
  audacity: marks => marks.map(m => [m.start.toFixed(6), (m.end == null ? m.start : m.end).toFixed(6), oneLine(m.name)].join("\t") + "\n").join(""),
  // Timeline > Import > Timeline Markers from EDL; --fps (default 25) and --start-tc (default 01:00:00:00, Resolve's
  // usual timeline start); a region becomes a marker with its duration
  edl: (marks, doc, o) => {
    const fps = o.fps ? Number(o.fps) : 25, r = Math.round(fps);
    const tc = String(o.startTc || "01:00:00:00").split(":").map(Number), start = ((tc[0] * 60 + (tc[1] || 0)) * 60 + (tc[2] || 0)) * r + (tc[3] || 0);
    const colour = { region: "ResolveColorBlue", marker: "ResolveColorYellow" };
    let out = "TITLE: " + oneLine((doc.source && doc.source.name) || "Playhead") + "\nFCM: NON-DROP FRAME\n\n";
    marks.forEach((m, i) => {
      const a = start + Math.round(m.start * r), d = Math.max(1, m.end == null ? 1 : Math.round((m.end - m.start) * r));
      out += String(i + 1).padStart(3, "0") + "  001      V     C        " + timecode(a, r) + " " + timecode(a + 1, r) + " " + timecode(a, r) + " " + timecode(a + 1, r) + "  \n";
      out += " |C:" + colour[m.kind] + " |M:" + oneLine(m.name) + " |D:" + d + "\n\n";
    });
    return out;
  },
  // subtitles: every video editor imports them, as a caption track that shows the sections and events in time
  srt: marks => marks.map((m, i) => {
    const next = marks.slice(i + 1).find(x => x.start > m.start + 1e-6);
    const end = m.end != null ? m.end : Math.min(m.start + 1, next ? next.start : m.start + 1);
    return (i + 1) + "\n" + srtTime(m.start) + " --> " + srtTime(Math.max(end, m.start + 0.04)) + "\n" + oneLine(m.name) + "\n\n";
  }).join("")
};

// frames as CSV: frame, time, one column per curve, then 1 on the frames with an onset, beat or downbeat (TouchDesigner:
// a Table DAT, then DAT to CHOP; Unreal: a DataTable with the frame as row name; any spreadsheet)
function framesCsv(fr) {
  const names = Object.keys(fr.curves), mark = list => { const s = new Set(list); return i => (s.has(i) ? 1 : 0); };
  const on = mark(fr.onsets), be = mark(fr.beats), db = mark(fr.downbeats);
  let out = ["frame", "time", ...names, "onset", "beat", "downbeat"].join(",") + "\n";
  for (let i = 0; i < fr.frames; i++) out += [i, (i / fr.fps).toFixed(4), ...names.map(k => fr.curves[k][i]), on(i), be(i), db(i)].join(",") + "\n";
  return out;
}
// frames as a Blender script: run it in the Text Editor; it keys the curves as custom properties of an Empty (one key
// per frame, from frame 1), for drivers on anything; the scene takes the frames' rate when that is a whole number
function framesBlender(fr, name) {
  const data = {};
  for (const k of Object.keys(fr.curves)) data[k] = fr.curves[k];
  data.onset = new Array(fr.frames).fill(0);
  for (const i of fr.onsets) data.onset[i] = 1;
  const title = "Playhead " + oneLine(name);
  return `# Playhead ${Playhead.version}: curves for Blender. Run in the Text Editor (Run Script).
# Keys each curve as a custom property of the Empty ${JSON.stringify(title)}, one key per frame from frame 1, values
# 0..1 (scale: ${fr.scale}). To drive anything with one: right-click the property > Copy as New Driver, then right-click
# the target > Paste Driver. onset is 1 on the frames where a sound starts.
import bpy

NAME = ${JSON.stringify(title)}
FPS = ${fr.fps}
DATA = ${JSON.stringify(data)}

scene = bpy.context.scene
if float(FPS).is_integer():
    scene.render.fps, scene.render.fps_base = int(FPS), 1.0
obj = bpy.data.objects.get(NAME)
if obj is None:
    obj = bpy.data.objects.new(NAME, None)
    scene.collection.objects.link(obj)
if obj.animation_data:
    obj.animation_data_clear()
n = 0
for key, values in DATA.items():
    for i, v in enumerate(values):
        obj[key] = float(v)
        obj.keyframe_insert(data_path='["%s"]' % key, frame=i + 1)
    n = max(n, len(values))
scene.frame_start, scene.frame_end = 1, max(scene.frame_end, n)
print("Playhead: keyed %d curves over %d frames on %s" % (len(DATA), n, NAME))
`;
}

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
      if (o.out) writeText(o.out, json + "\n"); else process.stdout.write(json + "\n");
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
        writeText(target, json + "\n");
        process.stderr.write(`${path.basename(f)}: ${doc.profile}, ${doc.timing.ms} ms -> ${target}\n`);
      }
    }
    return;
  }
  if (cmd === "markers") {
    const f = o._[0]; if (!f) fail("markers needs a file");
    const doc = await documentOf(f, o, "music");
    const marks = Playhead.toMarkers(doc, { kinds: (o.kinds || "sections,events").split(",") });
    const fmt = o.format || "tsv";
    if (fmt === "json") { console.log(JSON.stringify(marks, null, o.pretty ? 1 : 0)); return; }
    if (MARKER_FORMATS[fmt]) { process.stdout.write(MARKER_FORMATS[fmt](marks, doc, o)); return; }
    if (fmt !== "tsv" && fmt !== "csv") fail("unknown marker format " + fmt + " (tsv, csv, json, " + Object.keys(MARKER_FORMATS).join(", ") + ")");
    const sep = fmt === "csv" ? "," : "\t", esc = s => fmt === "csv" && /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : String(s).replace(/[\t\n]/g, " ");
    console.log(["kind", "start", "end", "name"].join(sep));
    for (const m of marks) console.log([m.kind, m.start, m.end == null ? "" : m.end, esc(m.name)].join(sep));
    return;
  }
  if (cmd === "frames") {
    const f = o._[0]; if (!f) fail("frames needs a file (audio, or a .playhead.json document)");
    const doc = await documentOf(f, o, "auto");
    const fps = o.fps ? Number(o.fps) : 60;
    if (!(fps > 0 && fps <= 1000)) fail("--fps must be a number from 1 to 1000");
    const want = o.curves ? String(o.curves).split(",").map(x => x.trim()).filter(Boolean) : null;
    const fr = Playhead.frames(doc, { fps, curves: want, scale: o.scale });
    const missing = (want || []).filter(k => !fr.curves[k]);
    if (missing.length) fail("not in this analysis: " + missing.join(", ") + " (curves: " + Object.keys(doc.curves).filter(k => Array.isArray(doc.curves[k])).join(", ") + ")");
    const fmt = o.format || "csv";
    if (fmt === "json") { console.log(JSON.stringify(fr, null, o.pretty ? 1 : 0)); return; }
    if (fmt === "csv") { process.stdout.write(framesCsv(fr)); return; }
    if (fmt === "blender") { process.stdout.write(framesBlender(fr, o.name || path.basename(f).replace(/(\.playhead)?\.[^.]+$/, ""))); return; }
    fail("unknown frames format " + fmt + " (csv, json, blender)");
  }
  if (cmd === "process") {
    const f = o._[0]; if (!f) fail("process needs a file"); if (!o.tool) fail("process needs --tool (see: playhead tools)");
    const params = {}; for (const kv of o.param) { const i = kv.indexOf("="); if (i < 1) fail("--param expects name=value"); const k = kv.slice(0, i), v = kv.slice(i + 1); params[k] = k === "gains" ? v.split(",").map(Number) : value(v); }
    const r = await Playhead.process(read(f, o), o.tool, params, { name: path.basename(f) });
    const dir = o.outDir || "."; fs.mkdirSync(dir, { recursive: true });
    for (const out of r.outputs) {
      const target = path.join(dir, path.basename(f).replace(/\.[^.]+$/, "") + "_" + out.suffix + ".wav");
      writeAtomic(target, tmp => IO.writeWav(tmp, IO.makeBuffer(out.sampleRate, out.channels), true));
      process.stderr.write("wrote " + target + "\n");
    }
    console.log(r.report.join("\n"));
    return;
  }
  if (cmd === "arrange") {
    // layers, each a document (a .playhead.json file, or an audio file analysed with the sfx profile) with where it
    // sits (offset, s), its gain (dB) and the part of the file heard (start, end, s)
    if (!o.parts) fail("arrange needs --parts parts.json ([{ doc, offset, gain, start, end, lock }])");
    let spec; try { spec = JSON.parse(fs.readFileSync(o.parts, "utf8")); } catch (e) { fail("cannot read " + o.parts + ": " + e.message); }
    if (!Array.isArray(spec) || spec.length < 2) fail("arrange needs two parts or more");
    const base = path.dirname(o.parts), parts = [];
    for (const p of spec) {
      const f = path.resolve(base, String(p.doc || ""));
      let doc;
      if (/\.json$/i.test(f)) { try { doc = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail("cannot read " + f + ": " + e.message); } }
      else doc = await Playhead.analyze(read(f, o), { profile: "sfx", assetClass: "sfx", name: path.basename(f) });
      parts.push({ doc, offset: Number(p.offset) || 0, gain: Number(p.gain) || 0, start: p.start == null ? undefined : Number(p.start), end: p.end == null ? undefined : Number(p.end), lock: !!p.lock });
    }
    const gr = o.gains ? o.gains.split(",").map(Number) : undefined;
    const r = Playhead.arrange(parts, { goal: o.goal || "punch", range: o.range ? Number(o.range) : undefined, gainRange: gr, count: o.count ? Number(o.count) : undefined, seed: o.seed ? Number(o.seed) : undefined });
    console.log(JSON.stringify(r, null, o.pretty ? 1 : 0));
    return;
  }
  fail("unknown command " + cmd + "\n\n" + HELP);
}
main().catch(e => { process.stderr.write("playhead: " + (e && e.stack || e) + "\n"); process.exit(1); });
