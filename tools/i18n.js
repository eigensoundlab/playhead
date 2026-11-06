#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead
//
// Translations.
//   node tools/i18n.js extract   gathers every English text into i18n/en.json (the list translators work from)
//   node tools/i18n.js build     turns i18n/<lang>.json into src/i18n-data.js (what the page loads)
//   node tools/i18n.js check     coverage per language, and errors: unknown keys, lost {placeholders} or markup
//   node tools/i18n.js check de  the same for one language only (while a translation is being written)
//   node tools/i18n.js terms ../sound-vocabulary [de]   where a translation strays from the shared vocabulary
// English stays where it is used (index.html, T("key", "English") in src/app.js, the library's own labels), so the
// app needs none of this to run in English. No dependencies.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const DIR = path.join(root, "i18n");
const LANGS = ["cs", "de", "es", "pl", "ru"];
const STR = '"((?:[^"\\\\]|\\\\.)*)"';                       // a double-quoted JS string, escapes kept
const js = lit => JSON.parse('"' + lit + '"');               // its value
const squash = t => t.replace(/\s+/g, " ").trim();
const entities = t => t.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function extract() {
  const out = {}, where = {};
  const put = (k, v, from) => {
    if (v == null || v === "") return;
    if (Object.prototype.hasOwnProperty.call(out, k) && out[k] !== v) throw new Error(`key ${k} has two texts:\n  ${out[k]} (${where[k]})\n  ${v} (${from})`);
    out[k] = v; where[k] = from;
  };

  // index.html: data-i18n (text), data-i18n-html (markup kept), data-i18n-<attribute>
  const html = read("index.html");
  const elRe = /<(\w+)\b([^>]*)>/g;
  let m;
  while ((m = elRe.exec(html))) {
    const [, tag, attrs] = m;
    for (const a of attrs.matchAll(/data-i18n-(title|aria-label|placeholder|content|alt)="([^"]+)"/g)) {
      const v = (attrs.match(new RegExp("\\s" + a[1] + '="([^"]*)"')) || [])[1];
      put(a[2], squash(entities(v || "")), "index.html");
    }
    const txt = attrs.match(/\sdata-i18n="([^"]+)"/), mk = attrs.match(/\sdata-i18n-html="([^"]+)"/);
    if (!txt && !mk) continue;
    // the element's content up to its matching end tag (same-name tags nested inside are counted)
    let depth = 1, i = elRe.lastIndex;
    const tagRe = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
    tagRe.lastIndex = i;
    let t;
    while ((t = tagRe.exec(html))) { depth += t[1] ? -1 : 1; if (!depth) break; }
    if (!t) throw new Error("no end tag for <" + tag + "> " + (txt || mk)[1]);
    const inner = html.slice(i, t.index);
    if (txt) put(txt[1], squash(entities(inner.replace(/<[^>]+>/g, ""))), "index.html");
    else put(mk[1], squash(inner), "index.html");
  }

  // src/app.js: T("key", "English"), TP("key", n, "one", "other"), the strip rows, D3 texts, legend words, menus
  const code = f => read(f).replace(/^\s*\/\/.*$/gm, "");    // comment lines out: they show T() in examples
  const app = code("src/app.js");
  for (const c of app.matchAll(new RegExp('\\bT\\(\\s*"([\\w.-]+)"\\s*,\\s*' + STR, "g"))) put(c[1], js(c[2]), "app.js");
  for (const c of app.matchAll(new RegExp('\\bTP\\(\\s*"([\\w.-]+)"\\s*,\\s*[\\w.]+\\s*,\\s*' + STR + "\\s*,\\s*" + STR, "g"))) { put(c[1] + ".one", js(c[2]), "app.js"); put(c[1] + ".other", js(c[3]), "app.js"); }
  for (const c of app.matchAll(new RegExp('\\{ id: "([\\w-]+)",(?: code: "[^"]*",)? name: ' + STR + ", desc: " + STR, "g"))) { put("row." + c[1] + ".name", js(c[2]), "app.js rows"); put("row." + c[1] + ".desc", js(c[3]), "app.js rows"); }
  for (const c of app.matchAll(new RegExp('(\\w+):\\s+\\{ h: "\\w+", col: "\\w+", lab: \\[[^\\]]*\\], ticks: \\w+, text: ' + STR, "g"))) put("d3." + c[1], js(c[2]), "app.js D3MAP");
  for (const c of app.matchAll(/lab: \["([^"]+)", "([^"]+)"\]/g)) { put("word." + c[1], c[1], "app.js"); put("word." + c[2], c[2], "app.js"); }
  for (const c of app.matchAll(/\bword\("([^"]+)"\)/g)) put("word." + c[1], c[1], "app.js");
  for (const [name, group] of [["CMP_BG", "bg"], ["CMP_FORMS", "forms"], ["CMP_SHAPES", "shapes"], ["CMP_MARKS", "marks"]]) {
    const line = (app.match(new RegExp("const " + name + " = \\[(.*)\\];")) || [])[1];
    if (!line) throw new Error("app.js: " + name + " not found");
    for (const c of line.matchAll(new RegExp('\\["(\\w+)", ' + STR + "\\]", "g"))) put("cmp." + group + "." + c[1], js(c[2]), "app.js " + name);
  }
  const mx = (app.match(/const label0 = \{(.*?)\};/) || [])[1];
  if (!mx) throw new Error("app.js: matrix labels not found");
  for (const c of mx.matchAll(new RegExp("(\\w+): " + STR, "g"))) put("matrix." + c[1], js(c[2]), "app.js matrix");

  // texts that come from the analysis: asset checks, sound-object words, layers, materials
  const an = code("src/analysis.js");
  for (const c of an.matchAll(new RegExp('\\bissue\\("\\w+", "(\\w+)", ' + STR, "g"))) put("check." + c[1], js(c[2]), "analysis.js");
  const words = (an.match(/const SFX_WORDS = \{([\s\S]*?)\n\};/) || [])[1];
  if (!words) throw new Error("analysis.js: SFX_WORDS not found");
  for (const row of words.matchAll(/(\w): \{([^}]*)\}/g)) for (const c of row[2].matchAll(/(\w+): "([^"]+)"/g)) put("obj." + row[1] + "." + c[1], c[2], "analysis.js SFX_WORDS");
  const need = (src, file, list) => { for (const w of list) if (!src.includes('"' + w + '"')) throw new Error(file + ": expected the text \"" + w + "\" (update tools/i18n.js)"); };
  const DIRS = { up: "up", down: "down", upDown: "up and down" }, PROFILES = ["stable", "impulsive", "ascending", "ascending/descending", "descending"];
  const LAYERS = ["sub", "low", "mid", "high", "air"];
  need(an, "analysis.js", Object.values(DIRS).concat(PROFILES, LAYERS));
  for (const [k, v] of Object.entries(DIRS)) put("obj.dir." + k, v, "analysis.js");
  for (const p of PROFILES) put("profile." + p.replace("/", "-"), p, "analysis.js");
  for (const l of LAYERS) put("layer." + l, l, "analysis.js");
  const ds = read("src/descriptors.js"), MATS = { damped: "damped (rubber, wood)", glass: "glass-like", metal: "metal-like", notModal: "not modal" };
  need(ds, "descriptors.js", Object.values(MATS));
  for (const [k, v] of Object.entries(MATS)) put("mat." + k, v, "descriptors.js");

  // the library (src/playhead.js, src/effects.js): curve names, looks, legends, tools. Other apps use these through
  // Playhead.localize(table), so they are a block of their own (lib.*).
  delete require.cache[require.resolve("../src/playhead.js")];
  const P = require("../src/playhead.js");
  P.localize(null);
  for (const [k, v] of Object.entries(P.curveLabels)) put("lib.curve." + k, v, "playhead.js");
  for (const [k, v] of Object.entries(P.looks)) { put("lib.look." + k + ".name", v.name, "playhead.js"); put("lib.look." + k + ".desc", v.desc, "playhead.js"); }
  const ph = code("src/playhead.js");
  for (const c of ph.matchAll(new RegExp('\\bL\\(\\s*"(lib\\.[\\w.]+)"\\s*,\\s*' + STR, "g"))) put(c[1], js(c[2]), "playhead.js");
  const tk = (ph.match(/const TICK_KINDS = \[([^\]]*)\]/) || [])[1];
  for (const c of (tk || "").matchAll(/"(\w+)"/g)) if (c[1] !== "downbeats") put("lib.mark." + c[1], c[1], "playhead.js");
  const FX = require("../src/effects.js");
  for (const t of FX.TOOLS) {
    const b = "lib.tool." + t.id;
    put(b + ".name", t.name, "effects.js"); put(b + ".desc", t.desc, "effects.js");
    put("lib.kind." + t.kind.toLowerCase().replace(/\s+(\w)/g, (x, ch) => ch.toUpperCase()), t.kind, "effects.js");
    if (Array.isArray(t.params)) for (const p of t.params) {
      put(b + ".param." + p.id, p.label, "effects.js");
      if (p.options) for (const [v, en] of p.options) put(b + ".opt." + p.id + "." + v, en, "effects.js");
    }
  }
  return out;
}

// keys in a fixed, readable order: page first, then app texts, then the library
const ORDER = ["ui.", "sec.", "note.", "guide.", "foot.", "row.", "d3.", "word.", "aria.", "off.", "cmp.", "bench.", "metric.", "lab.", "now.", "matrix.", "status.", "check.", "obj.", "profile.", "layer.", "mat.", "lib."];
function sorted(o) {
  const rank = k => { const i = ORDER.findIndex(p => k.startsWith(p)); return i < 0 ? ORDER.length : i; };
  const keys = Object.keys(o).map((k, i) => [k, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  return Object.fromEntries(keys.map(k => [k, o[k]]));
}
const loadJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));
const langFile = l => path.join(DIR, l + ".json");
const isMeta = k => k.startsWith("_");
const pluralBase = k => k.replace(/\.(zero|one|two|few|many|other)$/, "");

/** Problems of one translation against the English: unknown keys, placeholders and markup that differ. */
function problems(en, tr) {
  const out = [], enPlural = new Set(Object.keys(en).filter(k => /\.(one|other)$/.test(k)).map(pluralBase));
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(" ");
  const tags = s => (String(s).match(/<\/?[a-z][^>]*>/gi) || []).map(t => t.replace(/\s.*?(\/?>)$/, "$1").toLowerCase()).sort().join(" ");
  for (const [k, v] of Object.entries(tr)) {
    if (isMeta(k)) continue;
    const base = Object.prototype.hasOwnProperty.call(en, k) ? k : enPlural.has(pluralBase(k)) ? pluralBase(k) + ".other" : null;
    if (!base) { out.push("unknown key " + k); continue; }
    if (typeof v !== "string") { out.push(k + ": not a string"); continue; }
    if (!v.trim()) { out.push(k + ": empty"); continue; }
    // a plural form may drop {n} (Czech "jedna událost") but must not invent placeholders
    // a plural form may use any placeholder of the English forms ({n} in Russian "one", which also covers 21, 31 …) or
    // drop one (Czech "jedna událost"); any other text keeps exactly the English placeholders
    const plural = enPlural.has(pluralBase(k)), got = ph(v);
    const want = plural ? [...new Set([".one", ".other"].flatMap(f => ph(en[pluralBase(k) + f] || "").split(" ").filter(Boolean)))].sort().join(" ") : ph(en[base]);
    if (plural ? got.split(" ").some(x => x && !want.split(" ").includes(x)) : want !== got) out.push(k + ": placeholders " + (got || "none") + ", English has " + (want || "none"));
    if (tags(en[base]) !== tags(v)) out.push(k + ": markup differs from the English");
  }
  return out;
}

function build() {
  const en = loadJSON(langFile("en")), data = {};
  let bad = 0;
  for (const l of LANGS) {
    if (!fs.existsSync(langFile(l))) continue;
    const tr = loadJSON(langFile(l)), errs = problems(en, tr);
    if (errs.length) { bad += errs.length; console.error(l + ".json:\n  " + errs.join("\n  ")); }
    const keep = {};
    for (const [k, v] of Object.entries(tr)) if (!isMeta(k) && typeof v === "string" && v.trim()) keep[k] = v;
    data[l] = keep;
  }
  const text = "// SPDX-License-Identifier: Apache-2.0\n// Generated by `node tools/i18n.js build` from i18n/*.json; edit those, not this file.\n"
    + "(function (root) {\n\"use strict\";\nconst DATA = " + JSON.stringify(data, null, 0).replace(/\},"/g, '},\n"') + ";\n"
    + "if (typeof module !== \"undefined\" && module.exports) module.exports = DATA;\nroot.PH_I18N_DATA = DATA;\n})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(path.join(root, "src/i18n-data.js"), text);
  console.log("wrote src/i18n-data.js:", Object.entries(data).map(([l, d]) => l + " " + Object.keys(d).length).join(", ") || "no translations yet");
  return bad;
}

/** The library's texts (lib.*) per language, for other apps: Playhead.localize(table). */
function libTables() {
  const out = {};
  for (const l of LANGS) {
    if (!fs.existsSync(langFile(l))) continue;
    const tr = loadJSON(langFile(l));
    out[l] = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith("lib.")));
  }
  return out;
}

// only: one language, checked on its own (while others are being written), without the built-data comparison
function check(only) {
  const en = loadJSON(langFile("en"));
  let bad = 0;
  if (!only && JSON.stringify(sorted(extract())) !== JSON.stringify(en)) { bad++; console.error("i18n/en.json is out of date: run node tools/i18n.js extract"); }
  const keys = Object.keys(en), pluralKeys = new Set(keys.filter(k => /\.(one|other)$/.test(k)));
  console.log("English: " + keys.length + " texts");
  for (const l of only ? [only] : LANGS) {
    if (!fs.existsSync(langFile(l))) { console.log(l + ": no translation"); continue; }
    const tr = loadJSON(langFile(l)), errs = problems(en, tr);
    const done = keys.filter(k => Object.prototype.hasOwnProperty.call(tr, k) || (pluralKeys.has(k) && Object.keys(tr).some(x => pluralBase(x) === pluralBase(k))));
    const miss = keys.filter(k => !done.includes(k));
    console.log(l + ": " + done.length + "/" + keys.length + " (" + Math.round(100 * done.length / keys.length) + "%)" + (miss.length ? ", missing e.g. " + miss.slice(0, 3).join(", ") : "") + (errs.length ? ", " + errs.length + " errors" : ""));
    for (const e of errs) console.error("  " + e);
    bad += errs.length;
  }
  if (only) return bad;
  const built = fs.existsSync(path.join(root, "src/i18n-data.js")) ? require("../src/i18n-data.js") : {};
  for (const l of LANGS) if (fs.existsSync(langFile(l))) {
    const tr = Object.fromEntries(Object.entries(loadJSON(langFile(l))).filter(([k, v]) => !isMeta(k) && typeof v === "string" && v.trim()));
    if (JSON.stringify(tr) !== JSON.stringify(built[l] || {})) { bad++; console.error("src/i18n-data.js is out of date for " + l + ": run node tools/i18n.js build"); }
  }
  return bad;
}

/** Term consistency against the shared vocabulary (a checkout of eigensoundlab/sound-vocabulary): where an English
 *  text uses a vocabulary term, the translation should use that language's term or one of its alternatives. Inflection
 *  is allowed for by comparing word stems; the result is a list to read, not an error. */
function terms(vocabDir, only) {
  const tsv = fs.readFileSync(path.join(vocabDir, "src/terms.en.tsv"), "utf8").trim().split("\n");
  const head = tsv.shift().split("\t");
  const rows = tsv.map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v]))).filter(r => /playhead/.test(r.apps));
  const en = loadJSON(langFile("en"));
  // stems without diacritics, found anywhere in a word: inflection (Kanal, Kanäle; událost, události) and compounds (Bandpegel)
  const plain = t => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const stem = w => w.slice(0, Math.max(3, Math.ceil(w.length * 0.6)));
  const words = t => plain(t).match(/[\p{L}\p{N}]+/gu) || [];
  const uses = (text, phrase) => { const ws = words(phrase).filter(w => w.length > 1); return ws.length > 0 && ws.every(w => words(text).some(x => x.includes(stem(w)))); };
  let total = 0;
  for (const l of only ? [only] : LANGS) {
    if (!fs.existsSync(langFile(l)) || !fs.existsSync(path.join(vocabDir, "translations", l + ".json"))) continue;
    const tr = loadJSON(langFile(l)), voc = loadJSON(path.join(vocabDir, "translations", l + ".json"));
    const V = voc.terms || voc, misses = [];
    let checked = 0;
    for (const r of rows) {
      const e = V[r.id]; if (!e) continue;
      const re = new RegExp("\\b" + r.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(s|es)?\\b", r.id === "playhead" ? "" : "i");   // "Playhead" is the app's name, not the moving line
      const forms = [e.term, e.short].concat(e.alt || []).filter(Boolean);
      for (const [k, v] of Object.entries(en)) {
        if (!re.test(v.replace(/\{\w+\}/g, "")) || !tr[k] || k.startsWith("_")) continue;
        checked++;
        if (!forms.some(f => uses(tr[k], f))) misses.push(r.term + " → " + e.term + "   " + k + ": " + tr[k].slice(0, 90));
      }
    }
    total += misses.length;
    console.log(l + ": " + checked + " uses of " + rows.length + " vocabulary terms checked, " + misses.length + " to look at");
    for (const m of misses.slice(0, only ? 400 : 12)) console.log("  " + m);
  }
  return total;
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "extract") {
    const en = sorted(extract());
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(langFile("en"), JSON.stringify(en, null, 1) + "\n");
    console.log("wrote i18n/en.json:", Object.keys(en).length, "texts");
  } else if (cmd === "build") process.exitCode = build() ? 1 : 0;
  else if (cmd === "check") {
    const only = process.argv[3];
    if (only && !LANGS.includes(only)) { console.error("unknown language " + only + " (" + LANGS.join(", ") + ")"); process.exitCode = 2; }
    else process.exitCode = check(only) ? 1 : 0;
  } else if (cmd === "terms") terms(process.argv[3] || path.join(root, "../sound-vocabulary"), process.argv[4]);
  else { console.log("usage: node tools/i18n.js extract | build | check [language] | terms [vocabulary-dir] [language]"); process.exitCode = 2; }
}
module.exports = { extract, sorted, problems, libTables, LANGS };
