// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The audiovisual page: a sound, the usual signals and Playhead's analysis of it (in a worker), one scene drawn twice,
// a timeline of what each side detected, and for the demo arrangement what each side found against how it was built.
// ?t=<seconds> shows that moment without playing; ?gl uses WebGL 2 even where WebGPU is there.
"use strict";
(function () {
  const $ = id => document.getElementById(id), D = window.AVDrivers, Q = new URLSearchParams(location.search);
  const st = { sr: 0, channels: null, name: "", truth: null, S: null, doc: null, P: null, dur: 0, ctx: null, src: null, ab: null, playing: false, t0: 0, offset: 0, spin: 0, spinP: 0, last: 0, job: 0 };
  let scene = null;
  const stages = [$("stageS"), $("stageP")], status = t => { $("status").textContent = t; }, progress = p => { $("prog").firstElementChild.style.width = Math.round(100 * p) + "%"; };
  const fmt = (v, d) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(d == null ? 2 : d));

  /* ---------------- sizes ---------------- */
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of stages) { const w = Math.round(c.clientWidth * dpr), h = Math.round(w * 10 / 16); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    drawTimelines(); if (!st.playing) frame(true);
  }
  new ResizeObserver(() => fit()).observe(stages[0]);

  /* ---------------- sounds ---------------- */
  async function loadDemo() {
    status("Synthesizing the demo arrangement…");
    await new Promise(r => setTimeout(r, 30));
    const A = window.PlayheadArrangement.render(44100);
    return { sr: A.sr, channels: [A.y], name: "demo arrangement", truth: A.truth };
  }
  async function loadFile(file) {
    status("Decoding " + file.name + "…");
    const data = await file.arrayBuffer(), ac = new OfflineAudioContext(1, 1, 44100), ab = await ac.decodeAudioData(data);
    const channels = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) channels.push(ab.getChannelData(c).slice());
    return { sr: ab.sampleRate, channels, name: file.name, truth: null };
  }
  // both sides worked out in a worker (on the page's thread where workers cannot load, as from a file:// address)
  async function analyse(src) {
    stop(); const job = ++st.job;
    Object.assign(st, { sr: src.sr, channels: src.channels, name: src.name, truth: src.truth, S: null, doc: null, P: null, ab: null, dur: src.channels[0].length / src.sr, offset: 0 });
    $("play").disabled = true; $("cmp").hidden = true; progress(0); drawTimelines();
    status("Analysing " + src.name + "…");
    const t0 = performance.now();
    const done = (S, doc) => {
      if (job !== st.job) return;
      st.S = S; st.doc = doc; st.P = D.playheadDriver(doc);
      progress(1); status(src.name + ": " + fmt(st.dur, 0) + " s, analysed in " + fmt((performance.now() - t0) / 1000, 1) + " s" + (doc.rhythm && doc.rhythm.reliable ? ", " + fmt(doc.rhythm.tempo, 1) + " BPM" : ", no steady beat"));
      $("play").disabled = false; drawTimelines(); compareTable();
      if (Q.has("t")) st.offset = Math.max(0, Math.min(st.dur, +Q.get("t") || 0));
      frame(true);
      document.body.dataset.ready = "1";
    };
    let worker = null;
    try { worker = new Worker("av-worker.js"); } catch (e) { worker = null; }
    if (worker) {
      let S = null, failed = false;
      worker.onmessage = e => {
        const m = e.data; if (job !== st.job) { worker.terminate(); return; }
        if (m.progress != null) progress(0.1 + 0.9 * m.progress);
        if (m.standard) { S = m.standard; st.S = S; drawTimelines(); }
        if (m.doc) { worker.terminate(); done(S, m.doc); }
        if (m.error) { worker.terminate(); status("The analysis stopped: " + m.error); }
      };
      worker.onerror = () => { if (failed) return; failed = true; worker.terminate(); mainThread(); };
      worker.postMessage({ id: job, sr: src.sr, channels: src.channels, name: src.name });
    } else mainThread();
    async function mainThread() {
      await new Promise(r => setTimeout(r, 30));
      const mono = src.channels[0], S = D.standardDrivers(mono, src.sr);
      const doc = await window.Playhead.analyze({ sampleRate: src.sr, channels: src.channels }, { profile: "music", name: src.name, onProgress: p => progress(0.1 + 0.9 * p) });
      done(S, doc);
    }
  }

  /* ---------------- playing ---------------- */
  const now = () => (st.playing ? Math.max(0, st.ctx.currentTime - st.t0 - (st.ctx.outputLatency || st.ctx.baseLatency || 0)) : st.offset);
  async function play() {
    if (!st.ctx) st.ctx = new AudioContext();
    if (st.ctx.state === "suspended") await st.ctx.resume();
    if (!st.ab || st.ab.sampleRate !== st.sr) { st.ab = st.ctx.createBuffer(st.channels.length, st.channels[0].length, st.sr); st.channels.forEach((c, i) => st.ab.copyToChannel(c, i)); }
    if (st.offset >= st.dur - 0.05) st.offset = 0;
    if (st.offset === 0) st.spin = st.spinP = 0;
    const src = st.ctx.createBufferSource(); src.buffer = st.ab; src.connect(st.ctx.destination);
    src.start(0, st.offset); st.src = src; st.t0 = st.ctx.currentTime - st.offset; st.playing = true; st.last = performance.now();
    src.onended = () => { if (st.src === src) { st.offset = Math.min(st.dur, now()); st.playing = false; st.src = null; $("play").textContent = "Play"; } };
    $("play").textContent = "Pause"; requestAnimationFrame(loop);
  }
  function stop() { if (st.src) { st.offset = now(); const s = st.src; st.src = null; try { s.stop(); } catch (e) { /* already stopped */ } } st.playing = false; $("play").textContent = "Play"; }
  function seek(t) { const was = st.playing; stop(); st.offset = Math.max(0, Math.min(st.dur, t)); if (st.offset === 0) st.spin = st.spinP = 0; if (was) play(); else frame(true); }
  $("play").onclick = () => (st.playing ? stop() : play());
  for (const [id, k] of [["tlS", 0], ["tlP", 1]]) $(id).addEventListener("click", e => { if (!st.dur) return; const r = $(id).getBoundingClientRect(); seek((e.clientX - r.left) / r.width * st.dur); });
  $("source").onchange = () => { if ($("source").value === "file") $("file").click(); else loadDemo().then(analyse); };
  $("file").onchange = () => { const f = $("file").files[0]; if (f) loadFile(f).then(analyse).catch(e => status("Could not read the file: " + e.message)); };
  document.addEventListener("keydown", e => { if (e.code === "Space" && !$("play").disabled && e.target === document.body) { e.preventDefault(); $("play").click(); } });

  /* ---------------- the scene ---------------- */
  function loop() { if (!st.playing) return; frame(false); requestAnimationFrame(loop); }
  function frame(still) {
    if (!scene || !st.S) return;
    const t = now(), nowMs = performance.now(), dt = still ? 0 : Math.min(0.1, (nowMs - st.last) / 1000);
    st.last = nowMs;
    // where a side knows no bar (the usual side never, Playhead's before its first trusted downbeat) its hand spins with
    // its level, by the same rule on both sides
    const dS = D.standardDrive(st.S, t, st.spin);
    st.spin -= dt * (0.8 + 2.5 * dS.level);
    const safe = $("safe").checked, cap = d => { d.flash *= safe ? 0.35 : 0.8; return d; };
    scene.draw(0, cap(dS), t);
    if (st.P) { const dP = st.P.drive(t); dP.spin = st.spinP; st.spinP -= dt * (0.8 + 2.5 * dP.level); scene.draw(1, cap(dP), t); }
    for (const id of ["tlS", "tlP"]) $(id).querySelector(".cursor").style.left = (100 * t / Math.max(st.dur, 1e-9)) + "%";
    if (st.playing && t >= st.dur) stop();
  }

  /* ---------------- timelines ---------------- */
  const hsl = (h, s, l) => "hsl(" + Math.round(((h % 1) + 1) % 1 * 360) + "," + Math.round(s * 100) + "%," + Math.round(l * 100) + "%)";
  function timeline(id, rows) {
    const cv = $(id).querySelector("canvas"), dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.max(100, cv.clientWidth || cv.parentNode.clientWidth);
    const H = rows.reduce((s, r) => s + r.h + 2, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0d1013"; g.fillRect(0, 0, W, H);
    if (!st.dur) return;
    const x = t => t / st.dur * W, T = px => px / W * st.dur;
    let y = 2;
    for (const r of rows) {
      g.save(); g.beginPath(); g.rect(0, y, W, r.h); g.clip();
      r.draw(g, y, r.h, W, x, T);
      g.restore();
      g.font = "9px system-ui, sans-serif"; g.textBaseline = "top";
      const tw = g.measureText(r.label).width;
      g.fillStyle = "rgba(13,16,19,0.72)"; g.fillRect(2, y, tw + 6, Math.min(11, r.h));
      g.fillStyle = "#c9d1d6"; g.fillText(r.label, 5, y + 1);
      y += r.h + 2;
    }
  }
  const area = (arr, rate, colour) => (g, y, h, W, x, T) => {
    g.fillStyle = colour; g.beginPath(); g.moveTo(0, y + h);
    for (let px = 0; px <= W; px++) { const t = T(px), i = Math.min(arr.length - 1, Math.floor(t * rate)); const v = arr[i] == null ? 0 : Math.max(0, Math.min(1, arr[i])); g.lineTo(px, y + h - v * (h - 1)); }
    g.lineTo(W, y + h); g.fill();
  };
  const ticks = (sets) => (g, y, h, W, x) => {
    const lh = h / sets.length;
    sets.forEach(([list, colour], k) => { g.fillStyle = colour; for (const e of list) { g.globalAlpha = Math.max(0.35, Math.min(1, e.s == null ? (e.strength == null ? 1 : e.strength) : e.s)); g.fillRect(Math.round(x(e.t)), y + k * lh, 1, lh - 0.5); } });
    g.globalAlpha = 1;
  };
  const OCT = [0.0, 0.04, 0.09, 0.15, 0.3, 0.5, 0.6, 0.68];
  const heat = cell => (g, y, h, W) => {
    const rh = h / 8;
    for (let px = 0; px < W; px++) { const v = cell(px); for (let k = 0; k < 8; k++) { const u = v[k]; if (u < 0.03) continue; g.fillStyle = hsl(OCT[k], 0.85, 0.12 + 0.5 * Math.min(1, u)); g.fillRect(px, y + h - (k + 1) * rh, 1, rh); } }
  };
  function drawTimelines() {
    const S = st.S, P = st.P, doc = st.doc, FPS = D.FPS;
    timeline("tlS", !S ? [{ label: "working out the usual signals…", h: 14, draw() {} }] : [
      { label: "level (RMS follower, automatic gain)", h: 18, draw: area(S.level, FPS, "#8fa1ad") },
      { label: "octaves (analyser)", h: 28, draw: heat(px => { const i = Math.min(S.frames - 1, Math.floor(px / timelineW("tlS") * S.frames)); return S.bands.map(b => Math.max(0, (b[i] - 0.25) / 0.6)); }) },
      { label: "beats: bass, mid, treble", h: 21, draw: ticks([[S.kicks, "#e8453c"], [S.snares, "#4cc76a"], [S.hats, "#3f9ff2"]]) },
      { label: "colour (spectral centroid)", h: 12, draw: (g, y, h, W) => { for (let px = 0; px < W; px++) { const i = Math.min(S.frames - 1, Math.floor(px / W * S.frames)); g.fillStyle = hsl(0.62 - 0.55 * S.hue[i], 0.6, 0.18 + 0.35 * S.level[i]); g.fillRect(px, y, 1, h); } } },
      { label: "energy trend (for builds)", h: 16, draw: area(S.trend, FPS, "#c08bd8") },
      { label: "level jumps (for drops)", h: 12, draw: ticks([[S.flashes, "#ffffff"]]) },
      { label: "roughness (treble)", h: 14, draw: area(S.rough, FPS, "#d8a35c") }
    ]);
    if (!P) { timeline("tlP", [{ label: st.S ? "Playhead is analysing…" : "", h: 14, draw() {} }]); return; }
    const c = doc.curves, rate = c.rate, bars = (doc.rhythm && doc.rhythm.reliable && doc.rhythm.downbeats) || [];
    const barLines = (g, y, h, W, x) => { g.fillStyle = "rgba(255,255,255,0.10)"; for (const t of bars) g.fillRect(Math.round(x(t)), y, 1, h); };
    const withBars = f => (g, y, h, W, x, T) => { barLines(g, y, h, W, x); f(g, y, h, W, x, T); };
    timeline("tlP", [
      { label: "loudness", h: 18, draw: withBars(area(c.loudness || [], rate, "#8fa1ad")) },
      { label: "octaves: attacks on the grid", h: 28, draw: withBars(heat(px => { const W = timelineW("tlP"), o = P.octaves(px / W * st.dur, (px + 1) / W * st.dur); return o.values; })) },
      { label: "hits: low, mid, high", h: 21, draw: withBars(ticks([[P.byBand.low, "#e8453c"], [P.byBand.mid, "#4cc76a"], [P.byBand.high, "#3f9ff2"]])) },
      { label: "sections", h: 12, draw: (g, y, h, W, x) => { for (const s of P.sections) { const h0 = ({ A: 0.58, B: 0.92, C: 0.08, D: 0.33, E: 0.75, F: 0.15, G: 0.48, H: 0 })[String(s.label)[0]] ?? 0.58; g.fillStyle = hsl(h0, 0.6, 0.32); g.fillRect(x(s.start), y, x(s.end) - x(s.start) - 1, h); g.fillStyle = "#e4e8ea"; g.font = "9px system-ui"; g.fillText(s.label, x(s.start) + 2, y + 1); } } },
      { label: "build-up and drops", h: 16, draw: withBars((g, y, h, W, x, T) => { area(c.buildup || [], rate, "#c08bd8")(g, y, h, W, x, T); g.fillStyle = "#ffffff"; for (const b of P.builds) if (b.dropAt != null) g.fillRect(Math.round(x(b.dropAt)) - 1, y, 3, h); }) },
      { label: "fills, breaks, pass-bys", h: 12, draw: withBars((g, y, h, W, x) => {
        for (const b of P.bars) { if (!b.change) continue; const e = b.start + b.beat * (doc.rhythm.beatsPerBar || 4); g.fillStyle = b.change === "fill" ? "#f39a2b" : "#5b666d"; g.fillRect(x(b.start), y, Math.max(2, x(e) - x(b.start)), h); }
        for (const p of P.passes) { const grd = g.createLinearGradient(x(p.start), 0, x(p.end), 0); grd.addColorStop(0, "#5a99ff"); grd.addColorStop(1, "#ff5a40"); g.fillStyle = grd; g.fillRect(x(p.start), y + 2, x(p.end) - x(p.start), h - 4); g.fillStyle = "#fff"; g.fillRect(Math.round(x(p.closest)), y, 1, h); }
      }) },
      { label: "distortion", h: 14, draw: withBars(area(c.distortion || [], rate, "#d8a35c")) }
    ]);
  }
  const timelineW = id => $(id).querySelector("canvas").clientWidth || 600;

  /* ---------------- what each side found ---------------- */
  function compareTable() {
    if (!st.truth || !st.S || !st.doc) { $("cmp").hidden = true; return; }
    const rows = D.compare(st.truth, st.S, st.doc), body = $("cmpBody"), barNo = k => k + 1;
    const hit = r => r.found + " of " + r.of + " (" + r.triggers + " triggers), " + (r.latencyMs == null ? "–" : (r.latencyMs > 0 ? "+" : "") + r.latencyMs + " ms");
    const cells = {
      Kicks: r => [hit(r.std), hit(r.ph)], Snares: r => [hit(r.std), hit(r.ph)], Hats: r => [hit(r.std), hit(r.ph)],
      "Section boundaries": r => [null, r.ph.found + " of " + r.ph.of + (r.ph.extra ? ", " + r.ph.extra + " others" : ", none other")],
      "Fill and break": r => [null, (r.ph.fill ? "the fill in bar " + barNo(st.truth.fills[0]) : "the fill missed") + "; " + (r.ph.brk ? "the break from bar " + barNo(st.truth.breaks[0]) : "the break missed")
        + (r.ph.fills.filter(b => b !== st.truth.fills[0]).length ? "; also a fill in bar " + r.ph.fills.filter(b => b !== st.truth.fills[0]).map(barNo).join(" and ") : "")],
      "Build (not louder)": r => ["energy trend " + fmt(r.std.trendIn) + " inside it, " + fmt(r.std.trendOut) + " elsewhere",
        r.ph ? fmt(r.ph.start, 1) + " to " + fmt(r.ph.end, 1) + " s (built " + fmt(r.truth[0], 1) + " to " + fmt(r.truth[1], 1) + " s), overlap " + fmt(r.ph.overlap) : "not found"],
      Drop: r => [r.std.found ? "a level jump " + fmt(1000 * r.std.err, 0) + " ms off" : "no level jump there" + (r.std.others ? " (" + r.std.others + " elsewhere)" : ""),
        r.ph.found ? "at the next section, " + fmt(1000 * r.ph.err, 0) + " ms off" + (r.ph.others ? " (" + r.ph.others + " elsewhere)" : "") : "not found"],
      "Pass-by": r => [null, r.ph ? "closest " + fmt(r.ph.err * 1000, 0) + " ms off, " + fmt(r.ph.speed, 1) + " m/s (built " + r.ph.trueSpeed + ", a lower bound)" : "not found"],
      "Distortion (the clipped stab)": r => ["treble roughness " + fmt(r.std.inStab) + " in it, " + fmt(r.std.before) + " before", "distortion " + fmt(r.ph.inStab) + " in it, " + fmt(r.ph.before) + " before"]
    };
    body.innerHTML = "";
    for (const r of rows) {
      const [a, b] = cells[r.what](r), tr = document.createElement("tr");
      for (const [v, cls] of [[r.what, ""], [a == null ? "no such signal" : a, a == null ? "na" : ""], [b, ""]]) { const td = document.createElement(tr.children.length ? "td" : "th"); td.textContent = v; if (cls) td.className = cls; tr.appendChild(td); }
      body.appendChild(tr);
    }
    $("cmpNote").textContent = "Against the parts the demo was built with. A beat or an attack counts for a hit from 125 ms before it to 45 ms after (ITU-R BT.1359: a picture that early or that late goes unnoticed); the latency is the median over the hits found. Playhead's kick, snare and hat layers are its hits per band (low, mid, high), so a hat struck with a kick counts as both.";
    $("cmp").hidden = false;
  }

  /* ---------------- start ---------------- */
  (async () => {
    try { scene = await window.AVScene.create(stages, Q.has("gl") ? "webgl2" : null); }
    catch (e) { console.error(e); }
    $("renderer").textContent = scene ? "Drawn with " + scene.name + "." : "This browser draws neither WebGPU nor WebGL 2.";
    document.body.dataset.renderer = scene ? scene.name : "none";
    fit();
    analyse(await loadDemo());
  })();
})();
