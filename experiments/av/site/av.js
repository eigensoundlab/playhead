// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// The audiovisual page: a sound (three demos with their parts known, or a file), the usual signals and Playhead's
// analysis of it (in a worker), rules that turn events into cues (Playhead.cues), one scene drawn twice by the same
// rules, a timeline of what each side did, a cue sheet to export, and for the demos what each side found.
// ?demo=rhythm|melodic|sfx, ?scene=rings|ribbon|forge, ?preset=<name>, ?t=<seconds> shows that moment without
// playing; ?gl draws with WebGL 2 even where WebGPU is available.
"use strict";
(function () {
  const $ = id => document.getElementById(id), D = window.AVDrivers, Cues = window.Playhead.cues, Q = new URLSearchParams(location.search);
  const DEMOS = {
    rhythm: { gen: () => window.PlayheadArrangement, scene: "rings", preset: "playhead", profile: "music" },
    melodic: { gen: () => window.PlayheadMelodic, scene: "ribbon", preset: "melodic", profile: "music" },
    sfx: { gen: () => window.PlayheadSoundDesign, scene: "forge", preset: "weapon", profile: "sfx" }
  };
  const SCENE_NOTES = {
    rings: "Rings: eight rings are eight octaves (low inside), lit by the analyser's energy on the left and by Playhead's hits per octave on the beat grid on the right; the hand goes round once a bar where the bar is known and spins with the level where it is not. The rules punch the centre, send out waves, scatter sparks, turn the palette, run streaks, flash, darken, shake, roughen the edges, raise smoke and send a light across.",
    ribbon: "Ribbon: the tune as a line over the last three seconds, from the analyser's loudest bin on the left and Playhead's pitch on the right, with octave bars below; the rules make slides streak, vibrato ripple the line at its own rate, notes spark at the line's head, and the phrases turn the palette.",
    forge: "Forge: a furnace whose fire follows the glow, the low octaves and the punches; the rules throw sparks, send shock rings, raise smoke for an after-effect, shake, flash, roughen the air with heat, and send a light across for a pass-by."
  };
  const st = { kind: null, sr: 0, channels: null, name: "", truth: null, S: null, doc: null, dur: 0, ctx: null, src: null, ab: null, playing: false, t0: 0, offset: 0,
    spin: 0, spinP: 0, last: 0, job: 0, rules: [], maps: [], srcU: null, srcP: null, cuesU: [], cuesP: [], baseU: null, baseP: null };
  let scene = null;
  const stages = [$("stageS"), $("stageP")], status = t => { $("status").textContent = t; }, progress = p => { $("prog").firstElementChild.style.width = Math.round(100 * p) + "%"; };
  const fmt = (v, d) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(d == null ? 2 : d));
  const sceneName = () => $("scene").value;

  /* ---------------- sizes ---------------- */
  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of stages) { const w = Math.round(c.clientWidth * dpr), h = Math.round(w * 10 / 16); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    drawTimelines(); if (!st.playing) frame(true);
  }
  new ResizeObserver(() => fit()).observe(stages[0]);

  /* ---------------- sounds ---------------- */
  async function loadDemo(kind) {
    status("Synthesizing the demo…");
    await new Promise(r => setTimeout(r, 30));
    const R = DEMOS[kind].gen().render(44100);
    return { kind, sr: R.sr, channels: [R.y], name: R.name, truth: R.truth, profile: DEMOS[kind].profile };
  }
  async function loadFile(file) {
    status("Decoding " + file.name + "…");
    const data = await file.arrayBuffer(), ac = new OfflineAudioContext(1, 1, 44100), ab = await ac.decodeAudioData(data);
    const channels = []; for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) channels.push(ab.getChannelData(c).slice());
    return { kind: "file", sr: ab.sampleRate, channels, name: file.name, truth: null, profile: "auto" };
  }
  // both sides worked out in a worker (on the page's thread where workers cannot load, as from a file:// address)
  async function analyse(src) {
    stop(); const job = ++st.job;
    Object.assign(st, { kind: src.kind, sr: src.sr, channels: src.channels, name: src.name, truth: src.truth, S: null, doc: null, ab: null, dur: src.channels[0].length / src.sr, offset: 0, spin: 0, spinP: 0,
      srcU: null, srcP: null, cuesU: [], cuesP: [], baseU: null, baseP: null });
    $("play").disabled = true; $("cmp").hidden = true; progress(0); drawTimelines();
    status("Analysing " + src.name + "…");
    const t0 = performance.now();
    const done = (S, doc) => {
      if (job !== st.job) return;
      st.S = S; st.doc = doc; st.baseU = D.usualBase(S); st.baseP = D.playheadBase(doc);
      progress(1);
      const r = doc.rhythm;
      status(src.name + ": " + fmt(st.dur, 0) + " s, " + doc.profile + " profile, analysed in " + fmt((performance.now() - t0) / 1000, 1) + " s" + (r && r.reliable ? ", " + fmt(r.tempo, 1) + " BPM" : ""));
      $("play").disabled = false; recompile(); compareTable();
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
        if (m.standard) { S = m.standard; st.S = S; st.baseU = D.usualBase(S); recompile(); }
        if (m.doc) { worker.terminate(); done(S, m.doc); }
        if (m.error) { worker.terminate(); status("The analysis stopped: " + m.error); }
      };
      worker.onerror = () => { if (failed) return; failed = true; worker.terminate(); mainThread(); };
      worker.postMessage({ id: job, sr: src.sr, channels: src.channels, name: src.name, profile: src.profile });
    } else mainThread();
    async function mainThread() {
      await new Promise(r => setTimeout(r, 30));
      const S = D.standardDrivers(src.channels[0], src.sr);
      const doc = await window.Playhead.analyze({ sampleRate: src.sr, channels: src.channels }, { profile: src.profile, name: src.name, onProgress: p => progress(0.1 + 0.9 * p) });
      done(S, doc);
    }
  }

  /* ---------------- rules ---------------- */
  for (const [k, p] of Object.entries(Cues.presets)) { const o = document.createElement("option"); o.value = k; o.textContent = p.name; $("preset").appendChild(o); }
  function usePreset(name) {
    const p = Cues.presets[name]; if (!p) return;
    $("preset").value = name;
    st.rules = JSON.parse(JSON.stringify(p.rules)); st.maps = JSON.parse(JSON.stringify(p.mappings || []));
    renderRules(); recompile();
  }
  function recompile() {
    if (st.S) { st.srcU = D.usualSource(st.S, st.name); st.cuesU = Cues.compile(st.srcU, st.rules); }
    if (st.doc) { st.srcP = Cues.source(st.doc); st.cuesP = Cues.compile(st.srcP, st.rules); }
    drawTimelines(); if (!st.playing) frame(true);
  }
  const el = (tag, props, kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids || []) e.appendChild(k); return e; };
  const select = (opts, value, onchange, titles) => { const s = el("select"); for (const o of opts) { const op = el("option", { value: o[0], textContent: o[1] }); if (titles && titles[o[0]]) op.title = titles[o[0]]; s.appendChild(op); } s.value = value; s.onchange = () => onchange(s.value); return s; };
  const num = (value, step, onchange) => { const n = el("input", { type: "number", value, step, min: 0 }); n.onchange = () => onchange(Math.max(0, +n.value || 0)); return n; };
  const range = (value, onchange) => { const r = el("input", { type: "range", min: 0, max: 1.5, step: 0.05, value }), out = el("span", { className: "mute", textContent: " " + fmt(value) }); r.oninput = () => { out.textContent = " " + fmt(+r.value); onchange(+r.value); }; return el("span", {}, [r, out]); };
  const UNITS = [["s", "s"], ["beats", "beats"], ["bars", "bars"]];
  function usualFor(rule) {
    const eq = D.USUAL_EVENTS[rule.on];
    if (!eq) return { text: "no such signal: nothing happens", none: true };
    const notes = [eq];
    if (rule.at < 0) notes.push("at the event (it cannot look ahead)");
    if (rule.lengthUnit === "event") notes.push("half a second (its length is not known live)");
    else if (rule.lengthUnit === "beats" || rule.lengthUnit === "bars" || rule.unit === "beats" || rule.unit === "bars") notes.push("beats as 0.5 s, bars as 2 s (no beat known)");
    return { text: notes.join("; "), none: false };
  }
  function renderRules() {
    const body = $("rules").tBodies[0]; body.innerHTML = "";
    const change = () => { renderRules(); recompile(); };
    st.rules.forEach((rule, i) => {
      const timing = rule.at < 0 ? "before" : rule.at > 0 ? "after" : "at";
      const tSel = select([["at", "at it"], ["before", "before"], ["after", "after"]], timing, v => { const n = Math.abs(rule.at || 0) || 1; rule.at = v === "at" ? 0 : v === "before" ? -n : n; if (v === "before" && rule.shape !== "ramp") rule.shape = "ramp"; change(); });
      const tNum = num(Math.abs(rule.at || 0), 0.25, v => { rule.at = (rule.at < 0 ? -1 : 1) * v; change(); }), tUnit = select(UNITS, rule.unit || "s", v => { rule.unit = v; change(); });
      const timingCell = el("td", {}, timing === "at" ? [tSel] : [tSel, document.createTextNode(" "), tNum, document.createTextNode(" "), tUnit]);
      const doCell = el("td", {}, [select(Object.keys(Cues.actions).map(a => [a, a]), rule.do, v => { rule.do = v; change(); }, Cues.actions)]);
      if (rule.do === "event") { const name = el("input", { value: rule.name || "", placeholder: "name", size: 8 }); name.onchange = () => { rule.name = name.value; recompile(); }; doCell.appendChild(document.createTextNode(" ")); doCell.appendChild(name); }
      const lenUnit = select(UNITS.concat([["event", "× the event's"]]), rule.lengthUnit || "s", v => { rule.lengthUnit = v; if (v === "event" && !(rule.length > 0)) rule.length = 1; change(); });
      const u = usualFor(rule);
      body.appendChild(el("tr", {}, [
        el("td", {}, [select(Object.keys(Cues.events).map(e => [e, e]), rule.on, v => { rule.on = v; change(); }, Cues.events)]), timingCell, doCell,
        el("td", {}, [range(rule.amount == null ? 1 : rule.amount, v => { rule.amount = v; recompile(); })]),
        el("td", {}, [num(rule.length == null ? 0.3 : rule.length, 0.05, v => { rule.length = v; recompile(); }), document.createTextNode(" "), lenUnit]),
        el("td", {}, [select(Object.keys(Cues.shapes).map(s => [s, s]), rule.shape || "pulse", v => { rule.shape = v; recompile(); }, Cues.shapes)]),
        el("td", { className: "eq" + (u.none ? " none" : ""), textContent: u.text }),
        el("td", {}, [Object.assign(el("button", { className: "x", textContent: "×", title: "remove" }), { onclick: () => { st.rules.splice(i, 1); change(); } })])
      ]));
    });
    const mb = $("maps").tBodies[0]; mb.innerHTML = "";
    st.maps.forEach((m, i) => {
      const eq = D.USUAL_SIGNALS[m.from];
      mb.appendChild(el("tr", {}, [
        el("td", {}, [select(Object.keys(Cues.signals).map(s => [s, s]), m.from, v => { m.from = v; change(); }, Cues.signals)]), el("td", { textContent: "→" }),
        el("td", {}, [select(Object.keys(Cues.actions).filter(a => a !== "pass" && a !== "palette" && a !== "event").map(a => [a, a]), m.do, v => { m.do = v; change(); }, Cues.actions)]),
        el("td", {}, [range(m.amount == null ? 1 : m.amount, v => { m.amount = v; recompile(); })]),
        el("td", { className: "eq" + (eq ? "" : " none"), textContent: eq || "no such signal: nothing happens" }),
        el("td", {}, [Object.assign(el("button", { className: "x", textContent: "×", title: "remove" }), { onclick: () => { st.maps.splice(i, 1); change(); } })])
      ]));
    });
  }
  $("preset").onchange = () => usePreset($("preset").value);
  $("addRule").onclick = () => { st.rules.push({ on: "hit.high", do: "sparks", amount: 1, length: 0.15, shape: "pulse" }); renderRules(); recompile(); };
  $("addMap").onclick = () => { st.maps.push({ from: "loudness", do: "glow", amount: 0.6 }); renderRules(); recompile(); };
  $("export").onclick = () => {
    if (!st.srcP) return;
    const sheet = Cues.sheet(st.srcP, st.rules, st.maps, { rate: 30 }), url = URL.createObjectURL(new Blob([JSON.stringify(sheet, null, 1)], { type: "application/json" }));
    const a = el("a", { href: url, download: (st.name || "sound").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") + ".cues.json" }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  $("copy").onclick = () => { const text = JSON.stringify({ rules: st.rules, mappings: st.maps }, null, 1); if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => status("The rules are on the clipboard.")); };

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
  for (const id of ["tlS", "tlP"]) $(id).addEventListener("click", e => { if (!st.dur) return; const r = $(id).getBoundingClientRect(); seek((e.clientX - r.left) / r.width * st.dur); });
  $("source").onchange = () => { const v = $("source").value; if (v === "file") { $("file").click(); return; } setDemo(v); };
  $("file").onchange = () => { const f = $("file").files[0]; if (f) loadFile(f).then(analyse).catch(e => status("Could not read the file: " + e.message)); };
  $("scene").onchange = () => { $("sceneNote").textContent = SCENE_NOTES[sceneName()]; if (!st.playing) frame(true); };
  document.addEventListener("keydown", e => { if (e.code === "Space" && !$("play").disabled && e.target === document.body) { e.preventDefault(); $("play").click(); } });
  async function setDemo(kind) {
    $("source").value = kind; $("scene").value = Q.get("scene") || DEMOS[kind].scene; $("sceneNote").textContent = SCENE_NOTES[sceneName()];
    usePreset(Q.get("preset") || DEMOS[kind].preset);
    analyse(await loadDemo(kind));
  }

  /* ---------------- the scenes ---------------- */
  function loop() { if (!st.playing) return; frame(false); requestAnimationFrame(loop); }
  function frame(still) {
    if (!scene || !st.S || !st.srcU) return;
    const t = now(), nowMs = performance.now(), dt = still ? 0 : Math.min(0.1, (nowMs - st.last) / 1000);
    st.last = nowMs;
    const safe = $("safe").checked, cap = d => { d.flash *= safe ? 0.35 : 0.8; return d; };
    // where a side knows no bar (the usual side never, Playhead's before its first trusted downbeat) its hand spins
    // with its level, by the same rule on both sides
    const dS = D.drive(st.baseU, st.cuesU, st.maps, st.srcU, t, st.spin);
    st.spin -= dt * (0.8 + 2.5 * dS.level);
    scene.draw(0, sceneName(), cap(dS), t);
    if (st.baseP && st.srcP) { const dP = D.drive(st.baseP, st.cuesP, st.maps, st.srcP, t, st.spinP); st.spinP -= dt * (0.8 + 2.5 * dP.level); scene.draw(1, sceneName(), cap(dP), t); }
    for (const id of ["tlS", "tlP"]) $(id).querySelector(".cursor").style.left = (100 * t / Math.max(st.dur, 1e-9)) + "%";
    if (st.playing && t >= st.dur) stop();
  }

  /* ---------------- timelines ---------------- */
  const hsl = (h, s, l) => "hsl(" + Math.round(((h % 1) + 1) % 1 * 360) + "," + Math.round(s * 100) + "%," + Math.round(l * 100) + "%)";
  const ACTION_COLOURS = { flash: "#ffffff", darken: "#6d7a86", punch: "#e8453c", shockwave: "#f3e3c8", sparks: "#ffd166", palette: "#b388eb", streaks: "#c08bd8", shake: "#ef8354",
    glow: "#ffb347", smoke: "#9aa5ac", rough: "#d8a35c", pass: "#5a99ff", ripple: "#4cc9f0", tint: "#90be6d" };
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
      g.save(); g.beginPath(); g.rect(0, y, W, r.h); g.clip(); r.draw(g, y, r.h, W, x, T); g.restore();
      g.font = "9px system-ui, sans-serif"; g.textBaseline = "top";
      const tw = g.measureText(r.label).width;
      g.fillStyle = "rgba(13,16,19,0.72)"; g.fillRect(2, y, tw + 6, Math.min(11, r.h));
      g.fillStyle = "#c9d1d6"; g.fillText(r.label, 5, y + 1);
      y += r.h + 2;
    }
  }
  const OCT = [0.0, 0.04, 0.09, 0.15, 0.3, 0.5, 0.6, 0.68];
  const heat = cell => (g, y, h, W) => { const rh = h / 8; for (let px = 0; px < W; px++) { const v = cell(px, W); for (let k = 0; k < 8; k++) { const u = v[k]; if (u < 0.03) continue; g.fillStyle = hsl(OCT[k], 0.85, 0.12 + 0.5 * Math.min(1, u)); g.fillRect(px, y + h - (k + 1) * rh, 1, rh); } } };
  const fnArea = (fn, colour) => (g, y, h, W, x, T) => { g.fillStyle = colour; g.beginPath(); g.moveTo(0, y + h); for (let px = 0; px <= W; px++) { const v = Math.max(0, Math.min(1, fn(T(px)) || 0)); g.lineTo(px, y + h - v * (h - 1)); } g.lineTo(W, y + h); g.fill(); };
  // the actions the rules and mappings use, each as a row of its level over time (sampled at each pixel, so a short
  // pulse between two pixels may not show)
  function actionRows(cues, src) {
    const acts = []; for (const r of st.rules) if (r.do && r.do !== "event" && !acts.includes(r.do)) acts.push(r.do); for (const m of st.maps) if (m.do && !acts.includes(m.do)) acts.push(m.do);
    const rows = acts.map(a => ({ label: a, h: a === "palette" ? 8 : 12, draw: (g, y, h, W, x, T) => {
      if (a === "palette" || a === "tint") { for (let px = 0; px < W; px++) { const e = Cues.evaluate(cues, st.maps, src, T(px)); g.fillStyle = hsl(0.58 + 0.137 * e.palette + 0.3 * e.tint, 0.55, 0.35); g.fillRect(px, y, 1, h); } return; }
      fnArea(t => { const e = Cues.evaluate(cues, st.maps, src, t); return a === "pass" ? e.passOn : e[a]; }, ACTION_COLOURS[a] || "#8fa1ad")(g, y, h, W, x, T);
    } }));
    if (st.rules.some(r => r.do === "event")) rows.push({ label: "game events", h: 10, draw: (g, y, h, W, x) => { g.fillStyle = "#ffffff"; for (const c of cues) if (c.action === "event") g.fillRect(Math.round(x(c.t)), y, 1, h); } });
    return rows;
  }
  function drawTimelines() {
    const S = st.S, doc = st.doc;
    if (!S || !st.srcU || !st.baseU) timeline("tlS", [{ label: "working out the usual signals…", h: 14, draw() {} }]);
    else timeline("tlS", [
      { label: "level (RMS follower, automatic gain)", h: 16, draw: fnArea(t => S.level[Math.min(S.frames - 1, Math.floor(t * D.FPS))], "#8fa1ad") },
      { label: "octaves (analyser)", h: 24, draw: heat((px, W) => st.baseU.octaves(px / W * st.dur, (px + 1) / W * st.dur)) }
    ].concat(actionRows(st.cuesU, st.srcU)));
    if (!doc || !st.srcP || !st.baseP) { timeline("tlP", [{ label: st.S ? "Playhead is analysing…" : "", h: 14, draw() {} }]); return; }
    const downs = st.baseP.downbeats || [];
    const withBars = f => (g, y, h, W, x, T) => { g.fillStyle = "rgba(255,255,255,0.10)"; for (const t of downs) g.fillRect(Math.round(x(t)), y, 1, h); f(g, y, h, W, x, T); };
    const rows = [
      { label: "loudness", h: 16, draw: withBars(fnArea(t => (st.srcP.signals.loudness ? st.srcP.signals.loudness(t) : 0), "#8fa1ad")) },
      { label: doc.rhythm && doc.rhythm.spectral ? "octaves: hits on the grid" : "octaves: hits per band", h: 24, draw: withBars(heat((px, W) => st.baseP.octaves(px / W * st.dur, (px + 1) / W * st.dur))) }
    ];
    if (doc.sections && doc.sections.length > 1) rows.push({ label: "sections", h: 11, draw: (g, y, h, W, x) => { doc.sections.forEach((s, i) => { g.fillStyle = hsl(0.58 + 0.137 * i, 0.5, 0.3); g.fillRect(x(s.start), y, x(s.end) - x(s.start) - 1, h); g.fillStyle = "#e4e8ea"; g.font = "9px system-ui"; g.fillText(s.label, x(s.start) + 2, y + 1); }); } });
    timeline("tlP", rows.concat(actionRows(st.cuesP, st.srcP).map(r => Object.assign(r, { draw: withBars(r.draw) }))));
  }

  /* ---------------- what each side found ---------------- */
  function compareTable() {
    if (!st.truth || !st.S || !st.doc) { $("cmp").hidden = true; return; }
    const rows = D.compare(st.kind, st.truth, st.S, st.doc), body = $("cmpBody");
    body.innerHTML = "";
    for (const r of rows) body.appendChild(el("tr", {}, [el("th", { textContent: r.what }), el("td", { textContent: r.std == null ? "no such signal" : r.std, className: r.std == null ? "na" : "" }), el("td", { textContent: r.ph })]));
    $("cmpNote").textContent = "Against the parts the demo was built with. A beat or a hit counts for a true one from 125 ms before it to 45 ms after (ITU-R BT.1359: a picture that early or that late goes unnoticed), one for one; the latency is the median over those found. What each side detected does not depend on the rules.";
    $("cmp").hidden = false;
  }

  /* ---------------- start ---------------- */
  (async () => {
    try { scene = await window.AVScene.create(stages, Q.has("gl") ? "webgl2" : null); }
    catch (e) { console.error(e); }
    $("sceneNote").textContent = SCENE_NOTES[sceneName()] + " " + (scene ? "Drawn with " + scene.name + "." : "This browser draws neither WebGPU nor WebGL 2.");
    document.body.dataset.renderer = scene ? scene.name : "none";
    fit();
    setDemo(DEMOS[Q.get("demo")] ? Q.get("demo") : "rhythm");
  })();
})();
