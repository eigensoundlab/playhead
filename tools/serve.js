// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Minimal static server for local development: node tools/serve.js [port]
// (Opening index.html directly from disk also works; this is only for convenience.)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2]) || 8080;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".wav": "audio/wav", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.normalize(path.join(root, url === "/" ? "index.html" : url));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log("Playhead at http://localhost:" + port + "/"));
