// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Playhead levels: measured loudness, tag rules and project settings turned into one gain per file, and a report of
// what does not fit (docs/LEVELS.md).
//
//   const entry = Playhead.levels.entryOf(doc, { path, size, tags });   // what a manifest keeps about one file
//   const m = Playhead.levels.manifest(spec, entries);                  // the files with their groups and gains
//   const rep = Playhead.levels.report(m);                              // groups, outliers, checks, disagreements
//
// A spec ("format": "playhead-levels") holds the settings (measure, target, amount, depth, limits), rules (a tag sets a
// group offset, adds a modifier, or only asks for checks or processing) and checks. A manifest is a spec with files.
// Nothing here touches audio: gains are numbers for REAPER, an engine or a delivery step to apply.
"use strict";
(function (root) {
  const P = root.Playhead || (typeof require !== "undefined" ? require("./playhead.js") : null);
  const rnd = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const FORMAT = "playhead-levels", VERSION = 1;

  const MEASURES = {
    peak: "sample peak of the file (dBFS)", truePeak: "true peak of the file (dBTP, 4x oversampled)",
    rms: "RMS level (dBFS)", integrated: "integrated loudness, ITU-R BS.1770-5 with its gates (LUFS)",
    momentaryMax: "the loudest 0.4 s window (LUFS)", shortTermMax: "the loudest 3 s window (LUFS)"
  };
  const SCOPES = {
    "": "the whole file", active: "the sounding span: silence before and after left out",
    event: "the loudest event, from its start to where it has decayed 35 dB",
    events: "each event within 20 dB of the loudest, measured on its own: the median (footsteps, rattles, bursts)"
  };
  // the usual ways of levelling, compared with the project's measure in the report
  const STANDARD = ["peak", "rms", "integrated", "momentaryMax", "shortTermMax"], FLAG = ["integrated", "momentaryMax"];
  const DEFAULTS = {
    measure: "momentaryMax@event", target: -18, amount: 1, depth: 1,
    limits: { boost: 12, cut: 40, truePeak: -1 }
  };
  const CHECKS = { groupSpread: 4, truePeakMax: null, sampleRate: null, bitDepth: null, channels: null, defects: ["clipped", "dc", "firstSample", "cutTail", "lead"], disagreement: 3 };

  /* ---------------- measures ---------------- */
  // summary.levels of a document as a flat map: "integrated", "momentaryMax@event", "rms@active" ...
  function flat(L) {
    const out = {}; if (!L) return out;
    if (L.peak != null) out.peak = L.peak;
    if (L.truePeak != null) out.truePeak = L.truePeak;
    for (const [scope, key] of [["", "file"], ["active", "active"], ["event", "event"], ["events", "events"]]) {
      const s = L[key]; if (!s) continue;
      for (const m of ["rms", "integrated", "momentaryMax", "shortTermMax"]) if (s[m] != null) out[m + (scope ? "@" + scope : "")] = s[m];
    }
    return out;
  }
  function parseMeasure(name) {
    const [m, s] = String(name || "").split("@");
    if (!MEASURES[m]) throw new Error(`unknown measure "${m}" (one of ${Object.keys(MEASURES).join(", ")})`);
    if (s && !(s in SCOPES)) throw new Error(`unknown scope "@${s}" (one of ${Object.keys(SCOPES).filter(Boolean).map(k => "@" + k).join(", ")})`);
    if (s && (m === "peak" || m === "truePeak")) throw new Error(`${m} is of the whole file only`);
    return { measure: m, scope: s || "" };
  }
  // the value of a measure, falling back to the whole file when the scope is missing (no events in the fast profile)
  function valueOf(measures, name) {
    if (measures[name] != null) return { value: measures[name], used: name };
    const { measure } = parseMeasure(name);
    return measures[measure] != null ? { value: measures[measure], used: measure } : { value: null, used: null };
  }

  /* ---------------- tags ---------------- */
  const UCS_CAT = /^([A-Z]{3,}[A-Za-z]*)_/;
  // tags every file gets without anyone tagging it: its folder, the UCS category in its name, Playhead's class
  function autoTags(path, cls, folder) {
    const parts = String(path || "").split(/[\\/]/), name = parts[parts.length - 1] || "", out = [];
    const dir = folder || (parts.length > 1 ? parts[parts.length - 2] : null);
    if (dir) out.push("folder:" + dir);
    const u = UCS_CAT.exec(name); if (u) out.push("ucs:" + u[1]);
    if (cls) out.push("class:" + cls);
    return out;
  }
  // a rule's tag matches a file's tag exactly or as a parent ("Weapons" matches "Weapons/Shotguns"); case ignored
  const matchTag = (rule, tag) => { const r = String(rule).toLowerCase(), t = String(tag).toLowerCase(); return t === r || t.startsWith(r + "/"); };
  const hasTag = (rule, tags) => tags.some(t => matchTag(rule, t));

  /* ---------------- rules and the gain ---------------- */
  function settingsOf(spec) {
    const L = Object.assign({}, DEFAULTS, (spec && spec.levels) || {});
    L.limits = Object.assign({}, DEFAULTS.limits, (spec && spec.levels && spec.levels.limits) || {});
    parseMeasure(L.measure);
    return L;
  }
  function checksOf(spec) { return Object.assign({}, CHECKS, (spec && spec.checks) || {}); }
  // which rules apply to a file: its group (the first group rule that matches), modifiers, notes; and other group
  // rules that also match (shown, so the order is a visible decision)
  function resolve(spec, tags) {
    const rules = ((spec && spec.rules) || []).filter(r => r && r.on !== false && r.tag);
    let group = null; const modifiers = [], notes = [], alsoGroups = [];
    for (const r of rules) {
      if (!hasTag(r.tag, tags)) continue;
      const role = r.role || "group";
      if (role === "group") { if (!group) group = r; else alsoGroups.push(r.tag); }
      else if (role === "modifier") modifiers.push(r);
      else notes.push(r);
    }
    return { group, modifiers, notes, alsoGroups };
  }
  // gain = amount x (target - measured) + depth x (group offset + modifier offsets) + trim, then limited: at most
  // limits.boost up, limits.cut down, and the file's true peak not above limits.truePeak
  function gainOf(spec, entry) {
    const S = settingsOf(spec), R = resolve(spec, entry.tags || []);
    const name = (R.group && R.group.measure) || S.measure, v = valueOf(entry.measures || {}, name);
    const offset = (R.group ? +R.group.offset || 0 : 0) + R.modifiers.reduce((a, r) => a + (+r.offset || 0), 0);
    const trim = +entry.trim || 0;
    const lv = v.value == null ? 0 : S.amount * (S.target - v.value);
    let gain = lv + S.depth * offset + trim, limitedBy = null; const wanted = gain;
    if (gain > S.limits.boost) { gain = S.limits.boost; limitedBy = "boost"; }
    if (gain < -S.limits.cut) { gain = -S.limits.cut; limitedBy = "cut"; }
    const tp = entry.measures && (entry.measures.truePeak != null ? entry.measures.truePeak : entry.measures.peak);
    if (S.limits.truePeak != null && tp != null && tp + gain > S.limits.truePeak) { gain = S.limits.truePeak - tp; limitedBy = "truePeak"; }
    return { gain: rnd(gain, 2), wanted: rnd(wanted, 2), measure: name, used: v.used, measured: v.value, offset: rnd(offset, 2), group: R.group ? R.group.tag : null,
      modifiers: R.modifiers.map(r => r.tag), notes: R.notes.map(r => r.tag), alsoGroups: R.alsoGroups, limitedBy, unmeasured: v.value == null };
  }

  /* ---------------- entries and manifests ---------------- */
  function classOf(doc) {
    const ev = (doc.events || []).filter(e => e.peakDb != null);
    if (!ev.length) return null;
    return ev.reduce((a, e) => (e.peakDb > a.peakDb ? e : a)).facture || null;
  }
  // what a manifest keeps about one analysed file
  function entryOf(doc, o) {
    o = o || {};
    const L = doc.summary && doc.summary.levels, top = (doc.events || []).filter(e => e.peakDb != null).reduce((a, e) => (!a || e.peakDb > a.peakDb ? e : a), null);
    const cls = classOf(doc);
    const tags = Array.from(new Set([...(o.tags || []), ...autoTags(o.path, cls, o.folder)]));
    const e = {
      path: o.path || (doc.source && doc.source.name) || null, size: o.size != null ? o.size : null,
      duration: doc.source ? doc.source.duration : null, sampleRate: doc.source ? doc.source.sampleRate : null, channels: doc.source ? doc.source.channels : null,
      tags, class: cls,
      event: top ? { start: top.start, end: top.end, decayEnd: top.decayEnd } : null,
      measures: flat(L),
      checks: (doc.issues || []).filter(i => i.severity !== "info").map(i => ({ code: i.code || null, severity: i.severity, text: i.text })),
      trim: o.trim || 0,
      analysis: { playhead: doc.generator ? doc.generator.version : null, profile: doc.profile || null }
    };
    if (o.bitDepth) e.bitDepth = o.bitDepth;
    return e;
  }
  function manifest(spec, entries, generator) {
    const S = settingsOf(spec);
    const files = entries.map(e => { const g = gainOf(spec, e); return Object.assign({}, e, { gain: g.gain, group: g.group, limitedBy: g.limitedBy }); });
    return { format: FORMAT, version: VERSION, generator: generator || { name: "playhead", version: P ? P.version : null },
      project: (spec && spec.project) || null, levels: S, rules: (spec && spec.rules) || [], checks: checksOf(spec), files };
  }

  /* ---------------- the report ---------------- */
  const median = a => { const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
  const pct = (a, p) => { const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))] : null; };
  // groups: by the group rules; files without a group are grouped by opts.groupBy ("folder", "ucs", "class" or "none")
  function groupKey(m, f, groupBy) {
    const g = gainOf(m, f);
    if (g.group) return g.group;
    if (groupBy && groupBy !== "none") { const t = (f.tags || []).find(t => t.startsWith(groupBy + ":")); if (t) return t; }
    return "(no group)";
  }
  function report(m, opts) {
    opts = opts || {};
    const C = checksOf(m), S = settingsOf(m), groupBy = opts.groupBy || "folder";
    const rows = m.files.map(f => {
      const g = gainOf(m, f);
      // what each usual measure would do to this file, against the project's measure (each centred on its median below)
      const alt = {}; for (const k of STANDARD) alt[k] = f.measures && f.measures[k] != null ? f.measures[k] : null;
      return { f, g, key: groupKey(m, f, groupBy), alt };
    });
    // disagreement: where each measure would put a file among the others of its group (its gain minus the group's
    // median gain in that measure), against where the project's measure puts it; groups of fewer than three files are
    // compared over all files. The files where the choice of measure matters most.
    const centred = {};
    const keys = Array.from(new Set(rows.map(r => r.key))), small = new Set(keys.filter(k => rows.filter(r => r.key === k).length < 3));
    for (const k of [...STANDARD, "project"]) {
      const vals = rows.map(r => (k === "project" ? r.g.measured : r.alt[k])), med = {};
      for (const key of keys) med[key] = median(rows.map((r, i) => (small.has(key) ? small.has(r.key) : r.key === key) ? vals[i] : null));
      centred[k] = vals.map((v, i) => { const m0 = med[rows[i].key]; return v == null || m0 == null ? null : -(v - m0); });
    }
    rows.forEach((r, i) => {
      const p = centred.project[i]; r.vs = {};
      for (const k of STANDARD) r.vs[k] = p == null || centred[k][i] == null ? null : rnd(centred[k][i] - p, 1);
      // flagged by the loudness measures a project would otherwise use (peak and the 3 s window are shown, not flagged:
      // they disagree with any loudness measure on most short sounds)
      const d = FLAG.map(k => r.vs[k]).filter(v => v != null).map(Math.abs); r.disagree = d.length ? Math.max(...d) : null;
    });
    const groups = [];
    for (const key of Array.from(new Set(rows.map(r => r.key)))) {
      const G = rows.filter(r => r.key === key), vals = G.map(r => r.g.measured), med = median(vals);
      const spread = {}; for (const k of [...STANDARD, "project"]) { const v = k === "project" ? vals : G.map(r => r.alt[k]); spread[k] = v.filter(x => x != null).length >= 3 ? rnd(pct(v, 0.9) - pct(v, 0.1), 1) : null; }
      const outliers = G.length >= 3 && med != null ? G.filter(r => r.g.measured != null && Math.abs(r.g.measured - med) > C.groupSpread)
        .map(r => ({ path: r.f.path, off: rnd(r.g.measured - med, 1) })).sort((a, b) => Math.abs(b.off) - Math.abs(a.off)) : [];
      groups.push({ name: key, files: G.length, measure: G[0].g.measure, median: med == null ? null : rnd(med, 1), spread, outliers });
    }
    groups.sort((a, b) => b.files - a.files || String(a.name).localeCompare(String(b.name)));
    const defects = new Set(C.defects || []);
    const problems = [];
    for (const r of rows) {
      const f = r.f, why = [];
      for (const c of f.checks || []) if (!c.code || defects.has(c.code)) why.push(c.text);
      if (C.sampleRate && f.sampleRate && !C.sampleRate.includes(f.sampleRate)) why.push(`sample rate ${f.sampleRate} Hz (expected ${C.sampleRate.join(" or ")})`);
      if (C.bitDepth && f.bitDepth && !C.bitDepth.includes(f.bitDepth)) why.push(`${f.bitDepth}-bit (expected ${C.bitDepth.join(" or ")})`);
      if (C.channels && f.channels && !C.channels.includes(f.channels)) why.push(`${f.channels} channels (expected ${C.channels.join(" or ")})`);
      if (C.truePeakMax != null && f.measures && f.measures.truePeak != null && f.measures.truePeak > C.truePeakMax) why.push(`true peak ${f.measures.truePeak} dBTP (above ${C.truePeakMax})`);
      if (r.g.limitedBy) why.push(`gain ${sg(r.g.wanted)} dB limited to ${sg(r.g.gain)} dB by ${r.g.limitedBy === "truePeak" ? `the true-peak ceiling (${num(S.limits.truePeak)} dBTP)` : r.g.limitedBy === "boost" ? `the boost limit (${S.limits.boost} dB)` : `the cut limit (${S.limits.cut} dB)`}`);
      if (r.g.unmeasured) why.push("not measured (silent, or no analysis)");
      else if (r.g.used !== r.g.measure) why.push(`${r.g.measure} unavailable: used ${r.g.used}`);
      if (r.g.alsoGroups.length) why.push(`also matches the group${r.g.alsoGroups.length > 1 ? "s" : ""} ${r.g.alsoGroups.join(", ")} (the first rule wins: ${r.g.group})`);
      if (why.length) problems.push({ path: f.path, why });
    }
    const disagreements = rows.filter(r => r.disagree != null && r.disagree > C.disagreement).sort((a, b) => b.disagree - a.disagree)
      .map(r => ({ path: r.f.path, class: r.f.class, vs: r.vs, max: r.disagree }));
    const agreeSummary = {};
    for (const k of STANDARD) { const d = rows.map(r => r.vs[k]).filter(v => v != null).map(Math.abs); agreeSummary[k] = d.length ? { median: rnd(median(d), 1), over2: d.filter(v => v > 2).length, of: d.length } : null; }
    return { project: m.project || null, settings: S, checks: C, files: rows.length, groupBy, groups, problems, disagreements, agree: agreeSummary,
      table: rows.map(r => ({ path: r.f.path, group: r.key, class: r.f.class, measure: r.g.used, measured: r.g.measured, offset: r.g.offset, gain: r.g.gain, limitedBy: r.g.limitedBy, modifiers: r.g.modifiers, notes: r.g.notes, vs: r.vs })) };
  }

  /* ---------------- the report as text ---------------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sg = v => (v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1));
  const num = v => (v == null ? "–" : (v < 0 ? "−" : "") + Math.abs(v).toFixed(1));
  const LABEL = { peak: "Peak", rms: "RMS", integrated: "LUFS-I", momentaryMax: "Max M", shortTermMax: "Max S", project: "Project" };
  function csv(rep) {
    const q = s => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    const head = ["path", "group", "class", "measure", "measured", "offset", "gain", "limited_by", "modifiers", "notes", ...STANDARD.map(k => "vs_" + k)];
    return [head.join(","), ...rep.table.map(r => [r.path, r.group, r.class || "", r.measure || "", r.measured == null ? "" : r.measured, r.offset, r.gain, r.limitedBy || "",
      r.modifiers.join(" "), r.notes.join(" "), ...STANDARD.map(k => (r.vs[k] == null ? "" : r.vs[k]))].map(q).join(","))].join("\n") + "\n";
  }
  function html(rep) {
    const S = rep.settings, cell = v => `<td class="n">${v}</td>`;
    const groupRows = rep.groups.map(g => `<tr><td>${esc(g.name)}</td>${cell(g.files)}${cell(num(g.median))}${["project", ...STANDARD].map(k => cell(g.spread[k] == null ? "–" : g.spread[k].toFixed(1))).join("")}<td>${g.outliers.map(o => `${esc(o.path.split(/[\\/]/).pop())} ${sg(o.off)}`).join(", ") || "–"}</td></tr>`).join("");
    const probRows = rep.problems.map(p => `<tr><td>${esc(p.path)}</td><td>${p.why.map(esc).join("<br>")}</td></tr>`).join("");
    const disRows = rep.disagreements.slice(0, 40).map(d => `<tr><td>${esc(d.path)}</td><td>${esc(d.class || "")}</td>${STANDARD.map(k => cell(sg(d.vs[k]))).join("")}</tr>`).join("");
    const agree = STANDARD.map(k => rep.agree[k] ? `<li>${LABEL[k]}: median difference ${rep.agree[k].median.toFixed(1)} dB; more than 2 dB for ${rep.agree[k].over2} of ${rep.agree[k].of} files</li>` : "").join("");
    const fileRows = rep.table.map(r => `<tr><td>${esc(r.path)}</td><td>${esc(r.group)}</td><td>${esc(r.class || "")}</td><td>${esc(r.measure || "–")}</td>${cell(num(r.measured))}${cell(sg(r.offset))}${cell(sg(r.gain))}<td>${esc([r.limitedBy ? "limited: " + r.limitedBy : "", ...r.modifiers, ...r.notes.map(n => "note: " + n)].filter(Boolean).join(", "))}</td></tr>`).join("");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Playhead levels${rep.project ? ": " + esc(rep.project) : ""}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1d2330;max-width:1200px}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;margin:8px 0}td,th{border-bottom:1px solid #dde2ea;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f2f4f8;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}p.note{color:#5c6372;max-width:860px}code{background:#f2f4f8;padding:0 3px}</style></head><body>
<h1>Playhead levels${rep.project ? ": " + esc(rep.project) : ""}</h1>
<p>${rep.files} files. Measure <code>${esc(S.measure)}</code>, target ${num(S.target)}, amount ${S.amount}, depth ${S.depth}; limits: up ${S.limits.boost} dB, down ${S.limits.cut} dB, true peak ${num(S.limits.truePeak)} dBTP. Files without a group rule are grouped by ${esc(rep.groupBy)}.</p>
<h2>Groups</h2>
<p class="note">Spread: how far apart the files of a group are (10th to 90th percentile, dB) as each measure sees them, before levelling. Outliers: more than ${rep.checks.groupSpread} dB from the group's median in the project's measure.</p>
<table><tr><th>Group</th><th>Files</th><th>Median</th>${["project", ...STANDARD].map(k => `<th>Spread ${LABEL[k]}</th>`).join("")}<th>Outliers</th></tr>${groupRows}</table>
<h2>To check (${rep.problems.length})</h2>
<table><tr><th>File</th><th>Why</th></tr>${probRows || "<tr><td colspan=2>Nothing.</td></tr>"}</table>
<h2>Where the measures disagree (${rep.disagreements.length})</h2>
<p class="note">How much more (+) or less (−) gain each usual measure would give a file than the project's measure, each keeping the group's median where it is (groups under three files are taken together). Files are listed where LUFS-I or Max M differ from the project's measure by more than ${rep.checks.disagreement} dB: there the choice of measure matters, so listen to them. A measure is not right because it agrees; only listeners can say which is.</p>
<ul>${agree}</ul>
<table><tr><th>File</th><th>Class</th>${STANDARD.map(k => `<th>${LABEL[k]}</th>`).join("")}</tr>${disRows || "<tr><td colspan=7>None above " + rep.checks.disagreement + " dB.</td></tr>"}</table>
<h2>Files</h2>
<table><tr><th>File</th><th>Group</th><th>Class</th><th>Measure</th><th>Measured</th><th>Offset</th><th>Gain</th><th>Notes</th></tr>${fileRows}</table>
</body></html>
`;
  }

  const api = { format: FORMAT, version: VERSION, measures: MEASURES, scopes: SCOPES, standard: STANDARD, defaults: DEFAULTS, checks: CHECKS,
    flat, parseMeasure, valueOf, autoTags, matchTag, resolve, settingsOf, gainOf, entryOf, manifest, report, csv, html };
  if (P) P.levels = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PlayheadLevels = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
