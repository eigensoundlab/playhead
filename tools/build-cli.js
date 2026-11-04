#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Builds the command line as one executable file for the current platform, with Node's single executable
// applications (Node 20+): dist/playhead (Linux, macOS) or dist/playhead.exe (Windows). No Node needed to run it.
//   node tools/build-cli.js
// Uses postject (fetched by npx) to inject the bundle into a copy of the running node binary. The release workflow
// (.github/workflows/cli.yml) runs this on Linux, macOS and Windows and attaches the three files to the release.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, ".."), dist = path.join(root, "dist");
const win = process.platform === "win32", mac = process.platform === "darwin";
const run = (cmd, args, shell) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, shell: !!shell });

run(process.execPath, [path.join(__dirname, "build.js"), "--dist"]);
const cfg = path.join(dist, "sea-config.json"), blob = path.join(dist, "sea-prep.blob");
fs.writeFileSync(cfg, JSON.stringify({ main: path.join(dist, "playhead-cli.cjs"), output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }));
run(process.execPath, ["--experimental-sea-config", cfg]);
const exe = path.join(dist, win ? "playhead.exe" : "playhead");
fs.copyFileSync(process.execPath, exe);
if (!win) fs.chmodSync(exe, 0o755);
if (mac) run("codesign", ["--remove-signature", exe]);
const inject = ["--yes", "postject@1.0.0-alpha.6", exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (mac) inject.push("--macho-segment-name", "NODE_SEA");
run(win ? "npx.cmd" : "npx", inject, win);
if (mac) run("codesign", ["--sign", "-", exe]);
fs.rmSync(cfg); fs.rmSync(blob);
const out = execFileSync(exe, ["version"], { encoding: "utf8" }).trim();
console.log(`built ${path.relative(root, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(0)} MB, ${os.platform()}-${os.arch()}), reports version ${out}`);
