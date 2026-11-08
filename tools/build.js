// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Builds the deployable site and single-file versions of Playhead.
//   node tools/build.js                 -> _site/ (for GitHub Pages) incl. _site/playhead-single.html
//   node tools/build.js --fragment out  -> a single HTML fragment without <html>/<head>/<body>
//                                          (for hosts that add their own document skeleton)
// No dependencies; the app itself needs no build step and runs straight from index.html.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const SOURCES = ["src/analysis.js", "src/descriptors.js", "src/probes.js", "src/effects.js", "src/playhead.js", "src/i18n-data.js", "src/i18n.js", "src/app.js"];
const CORE = ["src/analysis.js", "src/descriptors.js", "src/effects.js", "src/playhead.js", "src/cues.js"];
const VERSION = require("../package.json").version;

function parts() {
  const index = read("index.html");
  const head = index.slice(index.indexOf("<head>") + 6, index.indexOf("</head>"));
  const fonts = (head.match(/<link rel="preconnect"[\s\S]*?display=swap" rel="stylesheet">/) || [""])[0];
  const bodyAll = index.slice(index.indexOf("<body>") + 6, index.indexOf("</body>"));
  const body = bodyAll.slice(0, bodyAll.indexOf("<script")).trim();
  const css = read("css/playhead.css");
  const js = SOURCES.map(read);
  return { fonts, body, css, js };
}
// inline scripts carry an id so the app can build its analysis workers from their text
const inlineScripts = js => js.map((s, i) => "<script id=\"ph-" + SOURCES[i].replace(/^src\/|\.js$/g, "") + "\">\n" + s.replace(/<\/script/gi, "<\\/script") + "\n</script>").join("\n");

function single(allowSave) {
  const { fonts, body, css, js } = parts();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Playhead</title>
${fonts}
<style>
${css}
</style>
</head>
<body>
${body}
<script>window.PLAYHEAD_ALLOW_SAVE = ${allowSave ? "true" : "false"};</script>
${inlineScripts(js)}
</body>
</html>
`;
}
function fragment(title) {
  const { fonts, body, css, js } = parts();
  return `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
${inlineScripts(js)}
`;
}
/* ---------- library bundles for other applications (dist/) ----------
   Each core file is a UMD script that attaches one object (WL, PHD, WLFX, Playhead) to its root. The bundles run all of
   them against a private object instead of the global one, so nothing leaks into the host page or module. */
const FOOTER = /\}\)\(typeof globalThis !== "undefined" \? globalThis : this\);\s*$/;
function coreBody() {
  return "const __ph = {};\n" + CORE.map(f => {
    const src = read(f);
    if (!FOOTER.test(src)) throw new Error("unexpected module footer in " + f);
    return "// ---- " + f + "\n" + src.replace(FOOTER, "})(__ph);\n");
  }).join("\n") + "\nconst Playhead = __ph.Playhead;\nPlayhead.internals = { WL: __ph.WL, PHD: __ph.PHD, FX: __ph.WLFX };\n";
}
const BANNER = `/*! Playhead core ${VERSION} | Apache-2.0 | (c) 2026 Daniel Sandner | https://github.com/eigensoundlab/playhead */\n`;
function coreUMD() {
  return BANNER + "(function (g, factory) {\n  const P = factory();\n  if (typeof module === \"object\" && module && module.exports) module.exports = P; else g.Playhead = P;\n})(typeof globalThis !== \"undefined\" ? globalThis : this, function () {\n\"use strict\";\nconst module = undefined, require = undefined;\n"
    + coreBody() + "return Playhead;\n});\n";
}
function coreESM() {
  return BANNER + "const module = undefined, require = undefined;\n" + coreBody()
    + "export default Playhead;\nexport const { version, schema, schemaVersion, profiles, analyze, process, tools, toMarkers, curveAt, drawStrip, cues } = Playhead;\n";
}
// command line as one CommonJS file (Node built-ins only), the input of the single-executable build
function cliBundle() {
  const io = read("tools/audio-io.js").replace(/^#!.*\n/, ""), cli = read("tools/playhead-cli.js").replace(/^#!.*\n/, "");
  return "#!/usr/bin/env node\n" + BANNER + "\"use strict\";\nglobal.__PLAYHEAD_BUNDLED__ = (function () {\nconst module = undefined, require = undefined;\n" + coreBody() + "return Playhead;\n})();\n"
    + "global.__PLAYHEAD_IO__ = (function () { const module = { exports: {} };\n" + io + "\nreturn module.exports; })();\n" + cli;
}
function writeDist(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "playhead-core.js"), coreUMD());
  fs.writeFileSync(path.join(dir, "playhead-core.mjs"), coreESM());
  fs.writeFileSync(path.join(dir, "playhead-cli.cjs"), cliBundle(), { mode: 0o755 });
  // the library's labels in other languages, for apps that draw strips: Playhead.localize(table)
  const lib = require("./i18n.js").libTables();
  fs.rmSync(path.join(dir, "i18n"), { recursive: true, force: true });
  if (Object.keys(lib).length) {
    fs.mkdirSync(path.join(dir, "i18n"), { recursive: true });
    for (const [l, t] of Object.entries(lib)) fs.writeFileSync(path.join(dir, "i18n", l + ".json"), JSON.stringify(t, null, 1) + "\n");
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--dist") { writeDist(path.join(root, "dist")); console.log("wrote dist/"); }
else if (args[0] === "--fragment") {
  const out = args[1] || "playhead-fragment.html";
  fs.writeFileSync(out, fragment(args[2] || "Playhead"));
  console.log("wrote", out);
} else {
  const site = path.join(root, "_site");
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  fs.copyFileSync(path.join(root, "index.html"), path.join(site, "index.html"));
  copyDir(path.join(root, "css"), path.join(site, "css"));
  copyDir(path.join(root, "src"), path.join(site, "src"));
  fs.writeFileSync(path.join(site, ".nojekyll"), "");
  fs.writeFileSync(path.join(site, "playhead-single.html"), single(true));
  writeDist(path.join(root, "dist"));
  writeDist(path.join(site, "dist"));
  copyDir(path.join(root, "examples"), path.join(site, "examples"));
  copyDir(path.join(root, "experiments", "listening", "site"), path.join(site, "listening"));     // the listening test
  copyDir(path.join(root, "experiments", "visuals", "site"), path.join(site, "visuals"));         // the visuals viewer
  copyDir(path.join(root, "experiments", "av", "site"), path.join(site, "av"));                   // the audiovisual Playhead
  for (const f of ["arrangement.js", "melodic.js", "sounddesign.js"]) fs.copyFileSync(path.join(root, "experiments", "bench", f), path.join(site, "av", f));
  // the ReaPack index of Playhead for REAPER, its files pinned to this commit (https://.../playhead/reaper/index.xml)
  if (!require("./reapack-index.js").forSite(path.join(site, "reaper", "index.xml"))) console.log("(no git: the ReaPack index was not written)");
  console.log("built", site, "and dist/ (playhead-core.js, playhead-core.mjs, playhead-cli.cjs)");
}
