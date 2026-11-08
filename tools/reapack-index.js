// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The ReaPack index of Playhead for REAPER (integrations/reaper), from the ReaPack headers of its main script
// (@description, @version, @author, @about, @links, @provides, @changelog), with every file pinned to one commit of
// the repository. The site build writes it to _site/reaper/index.xml, so that ReaPack users add
//   https://eigensoundlab.github.io/playhead/reaper/index.xml
// once (Extensions > ReaPack > Import repositories...) and get each new @version as an update.
//
//   node tools/reapack-index.js [--ref <commit>] [--out <file>]     (ref: $GITHUB_SHA, else the checked-out commit)
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "integrations", "reaper");
const MAIN = "Playhead - Analyse selected items.lua";
const REPO = "eigensoundlab/playhead";
const CATEGORY = "Analysis";

// "-- @tag value" lines, with the indented lines under them ("--   text") as the value's following lines
function headers(text) {
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("--")) break;
    const m = /^--\s*@(\w+)\s*(.*)$/.exec(line);
    if (m) { cur = m[1]; out[cur] = m[2] ? [m[2]] : []; continue; }
    const c = /^-- {2,}(.*)$/.exec(line), blank = /^--\s*$/.test(line);
    if (cur && c) out[cur].push(c[1]);
    else if (cur && blank && cur === "about") out[cur].push("");
    else cur = null;
  }
  return out;
}
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = s => "<![CDATA[" + String(s).replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
// a short Markdown text as RTF, which ReaPack's About window shows: headings bold and larger, paragraphs
function rtf(lines) {
  const esc = s => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&").replace(/[^\x00-\x7f]/g, ch => "\\u" + ch.charCodeAt(0) + "?");
  const paras = [], buf = [];
  const flush = () => { if (buf.length) { paras.push("{\\pard \\sa180 " + esc(buf.join(" ")) + "\\par}"); buf.length = 0; } };
  for (const l of lines) {
    const h = /^#+\s+(.*)$/.exec(l);
    if (h) { flush(); paras.push("{\\pard \\sa180 \\fs28 \\b " + esc(h[1]) + "\\b0\\par}"); }
    else if (!l.trim()) flush();
    else buf.push(l.trim());
  }
  flush();
  return "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 \\fswiss Helvetica;}}\\f0\\fs20\n" + paras.join("\n") + "\n}";
}

function build(ref, time) {
  const h = headers(fs.readFileSync(path.join(PKG, MAIN), "utf8"));
  for (const k of ["description", "version", "author", "provides"]) if (!h[k] || !h[k].length) throw new Error(MAIN + ": no @" + k);
  const url = f => "https://raw.githubusercontent.com/" + REPO + "/" + ref + "/integrations/reaper/" + f.split("/").map(encodeURIComponent).join("/");
  // each file's SHA-256 (as a multihash: 1220 + hex), which ReaPack 1.2.2 and later check after downloading
  const hash = f => "1220" + crypto.createHash("sha256").update(fs.readFileSync(path.join(PKG, f))).digest("hex");
  const sources = [`<source main="main" hash="${hash(MAIN)}">${xml(url(MAIN))}</source>`];
  for (const line of h.provides) {
    const m = /^\[([\w,]+)\]\s+(.+)$/.exec(line.trim());
    if (!m) throw new Error("@provides: cannot read " + line);
    const [, opts, file] = m;
    if (!fs.existsSync(path.join(PKG, file))) throw new Error("@provides: no file " + file);
    if (file === MAIN) continue;
    const attrs = [`file="${xml(file)}"`, `hash="${hash(file)}"`];
    if (opts === "main") attrs.push('main="main"');
    else if (opts === "effect") attrs.push('type="effect"');
    else if (opts !== "nomain") throw new Error("@provides: unknown option [" + opts + "]");
    sources.push(`<source ${attrs.join(" ")}>${xml(url(file))}</source>`);
  }
  const links = (h.links || []).map(l => { const m = /^(.*?)\s+(https?:\S+)$/.exec(l.trim()); return m ? `<link rel="website" href="${xml(m[2])}">${xml(m[1])}</link>` : `<link rel="website">${xml(l.trim())}</link>`; });
  const version = h.version[0];
  return `<?xml version="1.0" encoding="utf-8"?>
<index version="1" name="Playhead" commit="${xml(ref)}">
  <category name="${CATEGORY}">
    <reapack name="${xml(MAIN)}" type="script" desc="${xml(h.description.join(" "))}">
      <metadata>
        <description>${cdata(rtf(h.about || []))}</description>
        ${links.join("\n        ")}
      </metadata>
      <version name="${xml(version)}" author="${xml(h.author.join(" "))}" time="${xml(time)}">
        <changelog>${cdata((h.changelog || []).join("\n"))}</changelog>
        ${sources.join("\n        ")}
      </version>
    </reapack>
  </category>
  <metadata>
    <description>${cdata(rtf(["# Playhead", "", "Playhead's analysis in REAPER: curves, markers, automation, analysis-driven processing and a strip window. https://github.com/" + REPO]))}</description>
    <link rel="website" href="https://github.com/${REPO}">Playhead on GitHub</link>
  </metadata>
</index>
`;
}

if (require.main === module) {
  const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const git = a => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  const ref = opt("--ref") || process.env.GITHUB_SHA || git(["rev-parse", "HEAD"]);
  let time;
  try { time = new Date(git(["show", "-s", "--format=%cI", ref])).toISOString().replace(/\.\d+Z$/, "Z"); } catch (e) { time = new Date().toISOString().replace(/\.\d+Z$/, "Z"); }
  const out = opt("--out") || path.join(ROOT, "_site", "reaper", "index.xml");
  write(out, ref, time);
  console.log("ReaPack index for " + ref.slice(0, 12) + " written to " + path.relative(process.cwd(), out));
}
function write(out, ref, time) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, build(ref, time));
}
// for the site build: the index for the commit being built ($GITHUB_SHA in GitHub Actions), or null without git
function forSite(out) {
  try {
    const git = a => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const ref = process.env.GITHUB_SHA || git(["rev-parse", "HEAD"]);
    const time = new Date(git(["show", "-s", "--format=%cI", ref])).toISOString().replace(/\.\d+Z$/, "Z");
    write(out, ref, time);
    return ref;
  } catch (e) { return null; }
}
module.exports = { build, headers, forSite };
