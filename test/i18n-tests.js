// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Translations: the English list is current, translations keep their placeholders and markup, the page loads what was
// built, missing texts fall back to English, plurals follow each language, and the library's labels switch and return.
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = async function (check) {
  const root = path.join(__dirname, "..");
  const I = require("../tools/i18n.js");
  const en = JSON.parse(fs.readFileSync(path.join(root, "i18n/en.json"), "utf8"));
  {
    const fresh = I.sorted(I.extract());
    const added = Object.keys(fresh).filter(k => !(k in en)), gone = Object.keys(en).filter(k => !(k in fresh));
    const changed = Object.keys(fresh).filter(k => k in en && fresh[k] !== en[k]);
    check("i18n: i18n/en.json lists every English text", Object.keys(en).length + " texts",
      !added.length && !gone.length && !changed.length, added.concat(gone, changed).slice(0, 3).join(", ") || "");
  }
  {
    const data = require("../src/i18n-data.js"), errs = [], stale = [];
    for (const l of I.LANGS) {
      const f = path.join(root, "i18n", l + ".json");
      if (!fs.existsSync(f)) continue;
      const tr = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const e of I.problems(en, tr)) errs.push(l + ": " + e);
      const keep = Object.fromEntries(Object.entries(tr).filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && v.trim()));
      if (JSON.stringify(keep) !== JSON.stringify(data[l] || {})) stale.push(l);
    }
    check("i18n: translations keep placeholders and markup; built data current", Object.keys(data).join(" ") || "English only",
      !errs.length && !stale.length, errs.slice(0, 3).join("; ") + (stale.length ? " stale: " + stale.join(" ") : ""));
  }
  {
    // the runtime, against a stand-in table: fallback, placeholders, plural rules
    delete require.cache[require.resolve("../src/i18n.js")];
    const R = require("../src/i18n.js");
    R.data.cs = R.data.cs || {};
    const saved = Object.assign({}, R.data.cs);
    Object.assign(R.data.cs, { "test.hello": "Ahoj {name}", "test.ev.one": "{n} událost", "test.ev.few": "{n} události", "test.ev.other": "{n} událostí",
      "test.gloss": "[[Tvrdost|harshness]] roste v {file}" });
    R.setLanguage("cs", { remember: false });
    const got = [R.T("test.hello", "Hello {name}", { name: "Dan" }), R.T("test.none", "Fallback {x}", { x: 1 }),
      R.TP("test.ev", 1, "{n} event", "{n} events"), R.TP("test.ev", 3, "{n} event", "{n} events"), R.TP("test.ev", 7, "{n} event", "{n} events")];
    // English terms in brackets in explanations, on by default; off shows the term alone
    const glossOn = R.T("test.gloss", "Harshness rises in {file}", { file: "a[[b|c]].wav" });
    R.setEnglishTerms(false); const glossOff = R.T("test.gloss", "Harshness rises in {file}", { file: "x.wav" }); R.setEnglishTerms(true);
    got.push(glossOn, glossOff);
    R.setLanguage("en", { remember: false });
    const back = R.TP("test.ev", 3, "{n} event", "{n} events");
    for (const k of Object.keys(R.data.cs)) if (!(k in saved)) delete R.data.cs[k];
    check("i18n: fallback, placeholders, plural forms, English terms in brackets", got.join(" | "),
      got.join("|") === "Ahoj Dan|Fallback 1|1 událost|3 události|7 událostí|Tvrdost (harshness) roste v a[[b|c]].wav|Tvrdost roste v x.wav" && back === "3 events");
  }
  {
    // the library's labels switch with Playhead.localize(table) and return to English with localize(null)
    const P = require("../src/playhead.js");
    const before = [P.curveLabels.loudness, P.looks.structure.name, P.tools()[0].name, P.describeLook(P.parseLook(P.looks.structure.code))].join("|");
    const tool0 = P.tools()[0].id;
    P.localize({ "lib.curve.loudness": "Hlasitost", "lib.look.structure.name": "Struktura", ["lib.tool." + tool0 + ".name"]: "Nástroj", "lib.legend.line": "čára: {curve}" });
    const during = [P.curveLabels.loudness, P.looks.structure.name, P.tools()[0].name];
    const legend = P.describeLook(P.parseLook("line:loudness"));
    P.localize(null);
    const after = [P.curveLabels.loudness, P.looks.structure.name, P.tools()[0].name, P.describeLook(P.parseLook(P.looks.structure.code))].join("|");
    check("i18n: library labels switch and return", during.join(", "),
      during.join("|") === "Hlasitost|Struktura|Nástroj" && /čára: Hlasitost/.test(legend) && after === before, legend);
  }
  {
    // the page loads the built texts and the runtime before the app, as the single-file build does
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8"), b = fs.readFileSync(path.join(root, "tools/build.js"), "utf8");
    const order = [...html.matchAll(/<script src="(src\/[\w-]+\.js)"/g)].map(m => m[1]);
    const sources = JSON.parse((/const SOURCES = (\[[^\]]*\]);/.exec(b) || [, "[]"])[1]);
    check("i18n: page and single-file build load the same scripts in order", order.length + " scripts", order.join() === sources.join(), order.join(" "));
  }
};
