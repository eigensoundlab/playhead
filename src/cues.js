// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead cues: rules that turn what Playhead found in a sound into cues for visuals, game events and effects.
//
//   const src = Playhead.cues.source(doc);                      // the events and signals in a document
//   const cues = Playhead.cues.compile(src, rules);             // every cue, with its time, known in advance
//   Playhead.cues.evaluate(cues, mappings, src, t)              // the actions' levels at time t (0..1)
//   Playhead.cues.sheet(src, rules, mappings)                   // a cue sheet (JSON) for an engine to play
//
// A rule: when an event happens (a section starts, a build ends in a drop, a hat is struck, a shot's tail begins), do
// an action (flash, darken, sparks, shake, smoke ...) by an amount, for a time, in a shape, at the event or before it
// or after it. Because the whole sound is analysed first, a cue can start before its event: darken over the two bars
// before a drop, turn the palette a beat before a section. A mapping: an action follows a signal (the build-up, the
// distortion, the loudness) all the time. The actions are names, not drawing: an engine reads them as it likes.
// Runs in browsers, workers and Node; a source made from other signals (a live analyser) can stand in for a
// document, with live set so no cue starts before its event.
"use strict";
(function (root) {
  const P = root.Playhead || (typeof require !== "undefined" ? require("./playhead.js") : null);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const rnd = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

  /* ---------------- what can happen ---------------- */
  const EVENTS = {
    "hit.low": "a hit in the low band (below 200 Hz): kick, boom, bass note (not a snare's body)", "hit.mid": "a hit in the mid band: snare, knock, voice, note (not a kick's click)",
    "hit.high": "a hit in the high band (above 2 kHz): hat, click, spark, bolt", attack: "any attack, once per moment, labelled with its band",
    beat: "a beat (music)", bar: "a downbeat (music)", section: "a section starts (music)", "section.new": "a section unlike any before starts",
    "section.repeat": "a section like an earlier one starts", build: "a build starts; its length runs to its drop (music)",
    drop: "a build arrives (music)", fill: "a drum fill bar", break: "a break bar (the drums stop)",
    sound: "a sound starts (sound effects: a shot, an impact, a pulse)", peak: "a sound at its loudest: the boom",
    tail: "a sound's after-effect: from 10 dB under its peak to 40 dB under (its reverb, its ring)",
    glide: "the pitch slides (a spin-up, a siren, a slide)", "glide.up": "the pitch slides up", "glide.down": "the pitch slides down",
    passBy: "a source passes by (Doppler); its length runs from its approach to its leaving, its peak at the closest moment",
    vibrato: "a held note or a rotor wobbles in pitch", layer: "a spectral layer comes in (sound effects)"
  };
  const SIGNALS = {
    loudness: "loudness, 0-1", tension: "tension, 0-1", buildup: "how far into a build, 0-1", distortion: "clipping and saturation, 0-1",
    harshness: "harshness of colour at any level, 0-1", novelty: "how new the music is here (music)", surprise: "how unexpected the sound is",
    pitch: "the strongest partial's pitch, C2 to C7 as 0-1", pitchMotion: "how fast the pitch moves, 0-1 (12 semitones a second)",
    brightness: "the spectrum's centre, 100 Hz to 10 kHz as 0-1"
  };
  const ACTIONS = {
    flash: "a flash of light", darken: "the scene darkens", punch: "a punch from the centre", shockwave: "a wave runs out",
    sparks: "sparks fly", palette: "the palette turns to its next colours", streaks: "streaks rush past (speed)", shake: "the camera shakes",
    glow: "the light swells", smoke: "smoke rises", rough: "edges roughen (heat, grit)", pass: "a light crosses, blue coming, red going",
    ripple: "the scene wobbles", tint: "the colours shift (all of it: a third of the way round)", event: "a named game event (for the cue sheet)"
  };
  const SHAPES = { pulse: "full at once, then dying away", hold: "full for its length", ramp: "rising to full at its end (to land on an event, start it before)", swell: "rising and falling", fade: "falling from full" };
  const shapeAt = (shape, u) => (shape === "hold" ? 1 : shape === "ramp" ? u : shape === "swell" ? Math.sin(Math.PI * u) : shape === "fade" ? 1 - u : Math.exp(-4 * u));

  /* ---------------- a document as a cue source ---------------- */
  function source(doc, opts) {
    opts = opts || {};
    const ev = {}, put = (name, e) => { (ev[name] || (ev[name] = [])).push(e); };
    const curves = doc.curves || {}, rate = curves.rate || 20, dur = (doc.source && doc.source.duration) || 0;
    const curve = name => { const a = curves[name]; if (!Array.isArray(a) || !a.length) return null; return t => { const x = Math.max(0, Math.min(a.length - 1, t * rate - 0.5)), i = Math.floor(x), f = x - i, u = a[i], v = a[Math.min(a.length - 1, i + 1)]; return u == null ? (v == null ? null : v) : v == null ? u : u + (v - u) * f; }; };
    // hits per band (or, in older documents, the attacks by band), and the attacks. In the low and mid bands a hit is
    // left out where the attack at that moment rises there by less than a fifth (a snare's body in the low band, a
    // kick's click in the mid band), so hit.low, hit.mid and hit.high are layers to drive by; every hat is kept, also
    // one struck with a kick. doc.hits keeps everything that rises in each band.
    const B = ["low", "mid", "high"], atts = (doc.attacks || []).slice().sort((a, b) => a.t - b.t);
    const attackAt = t => { let lo = 0, hi = atts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (atts[m].t < t) lo = m + 1; else hi = m; } let b = null; for (const k of [lo - 1, lo]) { const a = atts[k]; if (a && Math.abs(a.t - t) < 0.025 && (!b || Math.abs(a.t - t) < Math.abs(b.t - t))) b = a; } return b; };
    if (doc.hits) B.forEach((b, i) => (doc.hits[b] || []).forEach(([t, s]) => { const a = i < 2 ? attackAt(t) : null; if (!a || a.band === b || !Array.isArray(a.bands) || a.bands[i] >= 0.2) put("hit." + b, { t, value: s }); }));
    else (doc.attacks || []).forEach(a => put("hit." + a.band, { t: a.t, value: a.strength == null ? 1 : a.strength }));
    (doc.attacks || []).forEach(a => put("attack", { t: a.t, value: a.strength == null ? 1 : a.strength, band: a.band }));
    // the beat, the bar, sections, builds and drops, fills and breaks
    const r = doc.rhythm || {}, beats = r.reliable ? r.beats || [] : [], downs = r.reliable ? r.downbeats || [] : [];
    beats.forEach((t, i) => put("beat", { t, value: 1, index: i, length: (beats[i + 1] || t + 0.5) - t }));
    downs.forEach((t, i) => put("bar", { t, value: 1, index: i, length: (downs[i + 1] || t + 2) - t }));
    const seen = new Set();
    (doc.sections || []).forEach((s, i) => {
      const isNew = !seen.has(s.label); seen.add(s.label);
      if (i === 0) return;
      const e = { t: s.start, value: 1, index: i, label: s.label, isNew, length: s.end - s.start };
      put("section", e); put(isNew ? "section.new" : "section.repeat", e);
    });
    (doc.builds || []).forEach(b => { put("build", { t: b.start, value: b.strength, length: b.end - b.start, drop: !!b.drop }); if (b.drop) put("drop", { t: b.end, value: b.strength }); });
    (r.bars || []).forEach(b => { if (b.change) put(b.change, { t: b.start, value: 1, length: b.beat * (r.beatsPerBar || 4) }); });
    // sounds (sound effects): their start, their peak and their after-effect, read from the level of the waveform
    // overview (its RMS per column, about 30 ms for half a minute)
    const W = doc.wave, wcols = W && W.rms ? W.rms.length : 0;
    const level = wcols ? (t => { const i = Math.max(0, Math.min(wcols - 1, Math.floor(t / Math.max(dur, 1e-9) * wcols))); return 20 * Math.log10(Math.max(1e-6, W.rms[i])); }) : null;
    const wstep = wcols ? dur / wcols : 0.05, events = (doc.events || []).slice().sort((a, b) => a.start - b.start);
    const lev = e => clamp01((e.peakDb + 60) / 60);
    let lastTailEnd = -1;
    events.forEach((e, i) => {
      // a sound starts at its attack (to the sample) where one is within 60 ms of the event's frame-time start
      const at0 = attackAt(e.start + 0.02) || attackAt(e.start + 0.045), t0 = at0 && Math.abs(at0.t - e.start) < 0.06 ? at0.t : e.start;
      put("sound", { t: t0, value: lev(e), length: e.end - t0, word: e.word, tag: e.tag });
      put("peak", { t: e.peak, value: lev(e), word: e.word });
      if (!level) return;
      // the after-effect: from where the level has fallen 10 dB under the sound's loudest to where it is 40 dB under,
      // cut where a sound about as loud (6 dB under it or more) begins; a click in the tail (a bolt) does not cut it
      let pk = -Infinity; for (let t = e.start; t <= e.peak + 0.1; t += wstep) pk = Math.max(pk, level(t));
      if (!isFinite(pk) || pk < -60) return;
      let ts = null, te = dur;
      for (let t = e.peak; t < dur; t += wstep) if (level(t) <= pk - 10) { ts = t; break; }
      if (ts == null || ts < lastTailEnd) return;
      for (let t = ts; t < dur; t += wstep) if (level(t) <= pk - 40) { te = t; break; }
      for (const o of events.slice(i + 1)) { if (o.start >= te) break; if (o.start > e.peak && level(o.peak) >= pk - 6) { te = Math.min(te, o.start); break; } }
      if (te - ts >= 0.1) { put("tail", { t: rnd(ts, 3), value: clamp01((te - ts) / 2), length: rnd(te - ts, 3), word: e.word }); lastTailEnd = te; }
    });
    // pitch motion, pass-bys, vibrato, layers
    (doc.glides || []).forEach(g => {
      const semis = g.semitones, e = { t: g.start, value: clamp01(Math.abs(semis) / 12), length: g.end - g.start, semitones: semis };
      if (g.passBy) put("passBy", Object.assign({}, e, { value: clamp01((g.speed || 0) / 40), speed: g.speed, peak: g.closest }));
      else { put("glide", e); put(semis > 0 ? "glide.up" : "glide.down", e); }
    });
    (doc.vibrato || []).forEach(v => put("vibrato", { t: v.start, value: clamp01(v.depth / 100), length: v.end - v.start, rate: v.rate }));
    (doc.layers || []).forEach(l => put("layer", { t: l.start, value: l.share, length: l.end - l.start, name: l.name }));
    for (const k in ev) ev[k].sort((a, b) => a.t - b.t);
    // signals, 0..1
    const sig = {}, c = name => curve(name);
    const lin = (f, lo, hi) => f && (t => { const v = f(t); return v == null ? null : clamp01((v - lo) / (hi - lo)); });
    if (c("loudness")) sig.loudness = c("loudness");
    if (c("tension")) sig.tension = c("tension");
    if (c("buildup")) sig.buildup = c("buildup");
    if (c("distortion")) sig.distortion = c("distortion");
    if (c("timbreHarshness")) sig.harshness = c("timbreHarshness");
    if (c("structureNovelty")) sig.novelty = c("structureNovelty");
    if (c("surprise")) sig.surprise = c("surprise");
    if (c("pitch")) sig.pitch = lin(c("pitch"), 36, 96);
    if (c("pitchSlope")) { const f = c("pitchSlope"); sig.pitchMotion = t => { const v = f(t); return v == null ? null : clamp01(Math.abs(v) / 12); }; }
    const sp = doc.spectrum;
    if (sp && sp.data && sp.columns && sp.bands) {
      const bytes = b64(sp.data), ml = 2595 * Math.log10(1 + sp.fmin / 700), mh = 2595 * Math.log10(1 + sp.fmax / 700), fc = [];
      for (let b = 0; b < sp.bands; b++) fc.push(700 * (Math.pow(10, (ml + (mh - ml) * (b + 1) / (sp.bands + 1)) / 2595) - 1));
      sig.brightness = t => {
        const col = Math.max(0, Math.min(sp.columns - 1, Math.floor(t / Math.max(dur, 1e-9) * sp.columns)));
        let num = 0, den = 0; for (let b = 0; b < sp.bands; b++) { const p = Math.pow(10, (bytes[col * sp.bands + b] / 255 * 80 - 80) / 10); num += p * Math.log2(fc[b] / 100); den += p; }
        return den > 1e-9 ? clamp01(num / den / Math.log2(100)) : null;
      };
    }
    const beatAt = t => { if (beats.length < 2) return 0.5; let i = beats.findIndex(b => b > t); if (i < 1) i = i < 0 ? beats.length - 1 : 1; return beats[i] - beats[i - 1]; };
    return { name: (doc.source && doc.source.name) || opts.name || "", duration: dur, events: ev, signals: sig, beatAt, barAt: t => beatAt(t) * (r.beatsPerBar || 4), live: false };
  }
  function b64(s) {
    if (typeof atob === "function") { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return Uint8Array.from(Buffer.from(s, "base64"));
  }

  /* ---------------- rules into cues ---------------- */
  // a time in seconds from a value in s, beats or bars at time t
  const span = (src, t, v, unit) => (unit === "beats" ? v * src.beatAt(t) : unit === "bars" ? v * src.barAt(t) : v);
  // where: { field: value } (equal), { field: [a, b] } (any of them), { field: { min, max } } (within)
  const matches = (e, where) => !where || Object.keys(where).every(k => { const w = where[k], v = e[k]; if (Array.isArray(w)) return w.includes(v); if (w && typeof w === "object") return v != null && (w.min == null || v >= w.min) && (w.max == null || v <= w.max); return v === w; });
  /** Every cue the rules make from a source: [{ t, length, action, amount, shape, on, rule, name?, data }] by time. A
   *  live source cannot look ahead: a cue set before its event starts at the event, and an event's own length (a build
   *  to its drop) is not known, so such a cue lasts its length in seconds or half a second. */
  function compile(src, rules) {
    const out = [];
    (rules || []).forEach((rule, ri) => {
      if (!rule || !rule.on || !rule.do) return;
      const list = src.events[rule.on] || [];
      let k = 0;
      for (const e of list) {
        if (!matches(e, rule.where)) continue;
        if (rule.every > 1 && (k++ % rule.every) !== 0) continue;
        let t = e.t + span(src, e.t, rule.at || 0, rule.unit);
        if (src.live && t < e.t) t = e.t;
        let len = rule.lengthUnit === "event" ? (src.live || e.length == null ? Math.max(0.5, rule.length || 0) : e.length * (rule.length || 1)) : span(src, e.t, rule.length == null ? 0.3 : rule.length, rule.lengthUnit);
        if (rule.lengthUnit !== "event" && rule.at < 0 && rule.shape === "ramp" && src.live) len = Math.min(len, 0.25);
        if (!(len > 0)) len = 0.05;
        const amount = (rule.amount == null ? 1 : rule.amount) * (rule.scale === false ? 1 : e.value == null ? 1 : Math.max(0.25, e.value));
        const cue = { t: rnd(t, 4), length: rnd(len, 4), action: rule.do, amount: rnd(amount, 3), shape: rule.shape || "pulse", on: rule.on, rule: ri };
        if (rule.do === "event") cue.name = rule.name || rule.on;
        if (rule.do === "pass") cue.data = { start: e.t, length: e.length || len, peak: e.peak == null ? e.t + (e.length || len) / 2 : e.peak };
        if (rule.do === "palette" && e.label != null) cue.data = { label: e.label };
        out.push(cue);
      }
    });
    return out.sort((a, b) => a.t - b.t || a.rule - b.rule);
  }
  /** The actions' levels at time t: { flash, darken, ... 0..1, palette (how many turns, with the latest crossfading),
   *  passX (-1 coming to 1 going) and passOn, age (per action, seconds since its latest running cue began: for a wave's
   *  radius) and seed (per action, that cue's index: to scatter sparks anew) }. Cues of one action combine by their
   *  maximum; a mapping adds its signal times its amount (gamma shapes it) to the same maximum. */
  function evaluate(cues, mappings, src, t) {
    const out = {};
    for (const a in ACTIONS) out[a] = 0;
    out.palette = 0; out.passX = 0; out.passOn = 0; out.age = {}; out.seed = {};
    let maxLen = 0; for (const c of cues) if (c.length > maxLen) maxLen = c.length;
    // the cues that started up to the longest cue's length ago
    let lo = 0, hi = cues.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cues[m].t <= t) lo = m + 1; else hi = m; }
    for (let i = lo - 1; i >= 0 && cues[i].t >= t - maxLen; i--) {
      const c = cues[i], u = (t - c.t) / c.length;
      if (u < 0 || u > 1) continue;
      const v = c.amount * shapeAt(c.shape, u);
      if (out.age[c.action] == null) { out.age[c.action] = t - c.t; out.seed[c.action] = i; }
      if (c.action === "pass") { const d = c.data || { start: c.t, length: c.length, peak: c.t + c.length / 2 }; const x = (t - d.peak) / Math.max(1e-3, Math.max(d.peak - d.start, d.start + d.length - d.peak)); if (v > out.passOn) { out.passOn = v; out.passX = Math.max(-1, Math.min(1, x)); } }
      else if (c.action !== "palette" && c.action !== "event") out[c.action] = Math.max(out[c.action], v);
    }
    // the palette: one turn per palette cue so far, the latest crossfading over its length
    for (let i = 0; i < lo; i++) if (cues[i].action === "palette") out.palette += Math.min(1, (t - cues[i].t) / Math.max(1e-3, cues[i].length));
    for (const m of mappings || []) {
      const f = src.signals[m.from]; if (!f || !m.do) continue;
      const v = f(t); if (v == null) continue;
      const w = (m.amount == null ? 1 : m.amount) * Math.pow(clamp01(v), m.gamma || 1);
      if (m.do === "pass" || m.do === "palette" || m.do === "event") continue;
      out[m.do] = Math.max(out[m.do], w);
    }
    return out;
  }
  /** A cue sheet for an engine: the cues, and each mapping sampled at rate (30 a second by default), with the rules
   *  that made them. Times in seconds from the start of the sound. */
  function sheet(src, rules, mappings, opts) {
    opts = opts || {};
    const rate = opts.rate || 30, cues = compile(src, rules), n = Math.ceil(src.duration * rate), curves = {};
    for (const m of mappings || []) {
      const f = src.signals[m.from]; if (!f || !m.do) continue;
      const key = m.do + (curves[m.do] ? "." + m.from : "");
      curves[key] = Array.from({ length: n }, (_, i) => { const v = f(i / rate); return v == null ? 0 : rnd((m.amount == null ? 1 : m.amount) * Math.pow(clamp01(v), m.gamma || 1), 3); });
    }
    return { format: "playhead-cues", version: 1, generator: "Playhead " + ((P && P.version) || ""), source: { name: src.name, duration: src.duration }, rules: rules || [], mappings: mappings || [],
      cues: cues.map(c => Object.assign({}, c, { t: rnd(c.t, 3), length: rnd(c.length, 3) })), curves: { rate, values: curves } };
  }

  /* ---------------- presets ---------------- */
  const R = (on, act, o) => Object.assign({ on, do: act }, o || {});
  const PRESETS = {
    playhead: { name: "Rhythm: Playhead's reading", kind: "music", rules: [
      R("hit.low", "punch", { length: 0.14 }), R("hit.mid", "shockwave", { length: 0.5, shape: "fade" }), R("hit.high", "sparks", { length: 0.08 }),
      R("section", "palette", { length: 1, shape: "hold" }), R("build", "streaks", { lengthUnit: "event", length: 1, shape: "ramp" }),
      R("drop", "flash", { length: 0.6 }), R("fill", "sparks", { lengthUnit: "event", length: 1, shape: "hold", amount: 0.6, scale: false }),
      R("break", "darken", { lengthUnit: "event", length: 1, shape: "hold", amount: 0.55, scale: false }), R("passBy", "pass", { lengthUnit: "event", length: 1, shape: "hold", scale: false })],
      mappings: [{ from: "distortion", do: "rough", amount: 1 }, { from: "tension", do: "glow", amount: 0.8 }] },
    usual: { name: "Rhythm: the usual mapping", kind: "music", rules: [
      R("hit.low", "punch", { length: 0.14 }), R("hit.mid", "shockwave", { length: 0.5, shape: "fade" }), R("hit.high", "sparks", { length: 0.08 }), R("drop", "flash", { length: 0.6 })],
      mappings: [{ from: "buildup", do: "streaks", amount: 1 }, { from: "loudness", do: "glow", amount: 0.8 }, { from: "harshness", do: "rough", amount: 0.8 }, { from: "brightness", do: "tint", amount: 1 }] },
    anticipation: { name: "Anticipation: cues that land on the moment", kind: "music", rules: [
      R("drop", "darken", { at: -2, unit: "bars", length: 2, lengthUnit: "bars", shape: "ramp", amount: 0.8, scale: false }), R("drop", "flash", { length: 0.8, scale: false }),
      R("drop", "shake", { length: 0.6, scale: false }), R("section", "palette", { at: -1, unit: "beats", length: 1, lengthUnit: "beats", shape: "ramp" }),
      R("bar", "punch", { length: 0.2, amount: 0.5 }), R("fill", "streaks", { lengthUnit: "event", length: 1, shape: "ramp", scale: false }),
      R("hit.mid", "shockwave", { length: 0.4, shape: "fade", amount: 0.6 })],
      mappings: [{ from: "tension", do: "glow", amount: 0.7 }] },
    furnace: { name: "Game: the furnace", kind: "music", rules: [
      R("hit.high", "sparks", { length: 0.25, amount: 1 }), R("hit.low", "glow", { length: 0.3, amount: 0.7 }), R("section.new", "palette", { length: 1.5, shape: "hold" }),
      R("section.repeat", "smoke", { length: 3, shape: "swell", scale: false }), R("build", "darken", { lengthUnit: "event", length: 1, shape: "ramp", amount: 0.7, scale: false }),
      R("drop", "flash", { length: 0.7, scale: false }), R("drop", "shake", { length: 1, scale: false }), R("drop", "event", { name: "eruption", length: 0.1 }),
      R("fill", "shockwave", { lengthUnit: "event", length: 1, shape: "fade", scale: false })],
      mappings: [{ from: "loudness", do: "glow", amount: 0.6 }, { from: "distortion", do: "rough", amount: 1 }] },
    melodic: { name: "Melody: phrases, slides and vibrato", kind: "music", rules: [
      R("section", "palette", { length: 2, shape: "hold" }), R("glide", "streaks", { lengthUnit: "event", length: 1, shape: "swell", amount: 1 }),
      R("vibrato", "ripple", { lengthUnit: "event", length: 1, shape: "hold" }), R("hit.mid", "sparks", { length: 0.2, amount: 0.5 }),
      R("bar", "glow", { length: 0.4, amount: 0.4, scale: false })],
      mappings: [{ from: "loudness", do: "glow", amount: 0.5 }] },
    weapon: { name: "Sound effects: weapon", kind: "sfx", rules: [
      R("sound", "flash", { length: 0.1, where: { word: ["noise", "noise hit"] } }), R("hit.low", "punch", { length: 0.25 }), R("peak", "shake", { length: 0.45 }),
      R("tail", "smoke", { lengthUnit: "event", length: 1, shape: "fade", scale: false }), R("hit.high", "sparks", { length: 0.15 }),
      R("sound", "event", { name: "impact", length: 0.05 })],
      mappings: [{ from: "distortion", do: "rough", amount: 1 }, { from: "loudness", do: "glow", amount: 0.6 }] },
    impact: { name: "Sound effects: impacts and explosions", kind: "sfx", rules: [
      R("sound", "flash", { length: 0.12 }), R("peak", "shockwave", { length: 0.8, shape: "fade" }), R("peak", "shake", { length: 0.5 }),
      R("hit.low", "punch", { length: 0.3 }), R("hit.high", "sparks", { length: 0.2 }),
      R("tail", "smoke", { lengthUnit: "event", length: 1.5, shape: "swell", scale: false }), R("tail", "glow", { lengthUnit: "event", length: 1, shape: "fade", amount: 0.6, scale: false }),
      R("sound", "event", { name: "impact", length: 0.05 })],
      mappings: [{ from: "distortion", do: "rough", amount: 1 }] },
    device: { name: "Sound effects: devices and vehicles", kind: "sfx", rules: [
      R("glide.up", "streaks", { lengthUnit: "event", length: 1, shape: "ramp", scale: false }), R("glide.down", "streaks", { lengthUnit: "event", length: 1, shape: "fade", scale: false }),
      R("vibrato", "ripple", { lengthUnit: "event", length: 1, shape: "hold" }), R("passBy", "pass", { lengthUnit: "event", length: 1, shape: "hold", scale: false }),
      R("sound", "glow", { length: 0.3, amount: 0.6 }), R("tail", "smoke", { lengthUnit: "event", length: 1, shape: "fade", scale: false })],
      mappings: [{ from: "distortion", do: "rough", amount: 1.2 }, { from: "pitchMotion", do: "streaks", amount: 0.6 }] }
  };

  const api = { events: EVENTS, signals: SIGNALS, actions: ACTIONS, shapes: SHAPES, presets: PRESETS, source, compile, evaluate, sheet, shapeAt };
  if (P) P.cues = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PlayheadCues = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
