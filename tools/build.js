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
const SOURCES = ["src/analysis.js", "src/probes.js", "src/effects.js", "src/app.js"];

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
const inlineScripts = js => js.map(s => "<script>\n" + s.replace(/<\/script/gi, "<\\/script") + "\n</script>").join("\n");

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
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--fragment") {
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
  console.log("built", site);
}
