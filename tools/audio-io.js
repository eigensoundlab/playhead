// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Audio file input/output for the Node tools.
// - With ffmpeg on the PATH, any format ffmpeg can read is decoded (and optionally resampled).
// - Without it, PCM and float WAV files are read directly; other formats are skipped.
// Buffers mimic the Web Audio AudioBuffer interface used by src/*.js.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const AUDIO_EXT = new Set([".wav", ".wave", ".aif", ".aiff", ".aifc", ".flac", ".ogg", ".oga", ".opus", ".mp3", ".m4a", ".aac", ".wma", ".caf", ".webm"]);

let ffmpegOk = null;
function hasFfmpeg() {
  if (ffmpegOk === null) {
    try { ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0; }
    catch (e) { ffmpegOk = false; }
  }
  return ffmpegOk;
}

function makeBuffer(sr, chans) {
  return { sampleRate: sr, length: chans[0].length, numberOfChannels: chans.length, duration: chans[0].length / sr, getChannelData: c => chans[c] };
}

/* ---------- WAV reader (RIFF/RF64-free, PCM 8/16/24/32, float 32/64, extensible) ---------- */
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4), body = p + 8;
    if (id === "fmt ") {
      let tag = b.readUInt16LE(body);
      const ch = b.readUInt16LE(body + 2), sr = b.readUInt32LE(body + 4), bits = b.readUInt16LE(body + 14);
      if (tag === 0xFFFE && size >= 26) tag = b.readUInt16LE(body + 24);
      fmt = { tag, ch, sr, bits };
    } else if (id === "data") { data = [body, Math.min(size, b.length - body)]; }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  const { tag, ch, sr, bits } = fmt, bps = bits >> 3, n = Math.floor(data[1] / (bps * ch));
  const chans = Array.from({ length: ch }, () => new Float32Array(n));
  let o = data[0];
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += bps) {
    let v;
    if (tag === 3) v = bps === 4 ? b.readFloatLE(o) : b.readDoubleLE(o);
    else if (tag === 1) {
      if (bps === 1) v = (b[o] - 128) / 128;
      else if (bps === 2) v = b.readInt16LE(o) / 32768;
      else if (bps === 3) v = b.readIntLE(o, 3) / 8388608;
      else v = b.readInt32LE(o) / 2147483648;
    } else throw new Error("unsupported WAV encoding " + tag);
    chans[c][i] = v;
  }
  return makeBuffer(sr, chans);
}

/* ---------- ffmpeg decoder ---------- */
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "ffprobe failed").trim().split("\n").pop());
  const s = (JSON.parse(r.stdout).streams || [])[0];
  if (!s) throw new Error("no audio stream");
  return { ch: Number(s.channels) || 1, sr: Number(s.sample_rate) || 44100 };
}
function readFfmpeg(file, sr) {
  const info = probe(file), ch = Math.min(2, info.ch), rate = sr || info.sr;
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", String(ch), "-ar", String(rate), "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(String(r.stderr || "ffmpeg failed").trim().split("\n").pop());
  const raw = r.stdout, n = Math.floor(raw.length / (4 * ch));
  const f = new Float32Array(raw.buffer, raw.byteOffset, n * ch);
  const chans = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0, k = 0; i < n; i++) for (let c = 0; c < ch; c++) chans[c][i] = f[k++];
  return makeBuffer(rate, chans);
}

/** Read an audio file. opts.sr resamples (ffmpeg only). Returns an AudioBuffer-like object. */
function readAudio(file, opts) {
  const sr = opts && opts.sr;
  if (hasFfmpeg()) return readFfmpeg(file, sr);
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".wav" && ext !== ".wave") throw new Error("needs ffmpeg to decode " + ext);
  const buf = readWav(file);
  if (sr && buf.sampleRate !== sr) process.emitWarning("resampling needs ffmpeg; analysing " + path.basename(file) + " at " + buf.sampleRate + " Hz");
  return buf;
}

/** Write a 16-bit or 32-bit float WAV. */
function writeWav(file, buf, float32) {
  const ch = buf.numberOfChannels, n = buf.length, bps = float32 ? 4 : 2, dataLen = n * ch * bps;
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(float32 ? 3 : 1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(buf.sampleRate, 24); b.writeUInt32LE(buf.sampleRate * ch * bps, 28); b.writeUInt16LE(ch * bps, 32); b.writeUInt16LE(bps * 8, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(dataLen, 40);
  const cs = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += bps) {
    const v = cs[c][i];
    if (float32) b.writeFloatLE(v, o); else b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), o);
  }
  fs.writeFileSync(file, b);
}

/** Recursively list audio files under the given paths (files or folders), sorted. */
function listAudio(paths) {
  const out = [];
  const walk = p => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) if (!e.startsWith(".")) walk(path.join(p, e)); }
    else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) out.push(p);
  };
  for (const p of paths) walk(path.resolve(p));
  return out;
}

module.exports = { readAudio, readWav, writeWav, listAudio, makeBuffer, hasFfmpeg, AUDIO_EXT };
