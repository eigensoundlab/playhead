// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
// Part of Playhead, https://github.com/eigensoundlab/playhead
//
// Translations. English is written where the text is used: in index.html (elements marked data-i18n="key", or
// data-i18n-html for text with markup, and data-i18n-<attribute>="key" for title, aria-label, placeholder) and in the
// code as T("key", "English text", { name: value }), or TP("key", n, "one thing", "{n} things") for a count. Other
// languages are i18n/<lang>.json, gathered into src/i18n-data.js by `node tools/i18n.js build`; a missing translation
// falls back to English. Terms follow the shared sound vocabulary (https://github.com/eigensoundlab/sound-vocabulary).
(function (root) {
"use strict";
const LANGUAGES = { en: "English", cs: "Čeština", de: "Deutsch", es: "Español", pl: "Polski", ru: "Русский" };
const STORE = "playhead.language";
let DATA = root.PH_I18N_DATA || null;
if (!DATA && typeof require !== "undefined") { try { DATA = require("./i18n-data.js"); } catch (e) { DATA = null; } }
DATA = DATA || {};
let lang = "en", table = {};
const listeners = [];

function has(k) { return Object.prototype.hasOwnProperty.call(table, k); }
function fill(s, vars) { return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s; }
/** The text for key in the current language, else the English default; {name} is replaced from vars. */
function T(key, en, vars) {
  let s = has(key) ? table[key] : en;
  if (s == null) s = key;
  return fill(s, vars);
}
/** A count with its noun: key.one, key.few, key.many or key.other by the language's plural rules (Czech, Polish and
 *  Russian need few and many), else the English one/other; {n} is the count. */
function TP(key, n, one, other, vars) {
  let c = n === 1 ? "one" : "other";
  try { c = new Intl.PluralRules(lang).select(n); } catch (e) { /* no Intl: English rule */ }
  const v = Object.assign({ n: n }, vars || {});
  if (has(key + "." + c)) return fill(table[key + "." + c], v);
  if (has(key + ".other")) return fill(table[key + ".other"], v);
  return fill(n === 1 ? one : other, v);
}
/** The language to start in: ?lang= in the address, the last choice, then the browser's languages. */
function preferred() {
  try { const q = new URLSearchParams(root.location.search).get("lang"); if (q && LANGUAGES[q]) return q; } catch (e) { /* no location */ }
  try { const s = root.localStorage.getItem(STORE); if (s && LANGUAGES[s]) return s; } catch (e) { /* storage blocked */ }
  try { for (const l of root.navigator.languages || [root.navigator.language]) { const b = String(l).toLowerCase().split("-")[0]; if (LANGUAGES[b] && (b === "en" || DATA[b])) return b; } } catch (e) { /* no navigator */ }
  return "en";
}
const ATTRS = ["title", "aria-label", "placeholder", "content", "alt"];
/** Put the current language into the page: marked elements and attributes keep their English to fall back on. */
function applyDom(scope) {
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll("[data-i18n]").forEach(el => {
    if (!el.hasAttribute("data-i18n-en")) el.setAttribute("data-i18n-en", el.textContent);
    const k = el.getAttribute("data-i18n");
    el.textContent = has(k) ? table[k] : el.getAttribute("data-i18n-en");
  });
  scope.querySelectorAll("[data-i18n-html]").forEach(el => {
    if (!el.hasAttribute("data-i18n-en")) el.setAttribute("data-i18n-en", el.innerHTML);
    const k = el.getAttribute("data-i18n-html");
    el.innerHTML = has(k) ? table[k] : el.getAttribute("data-i18n-en");   // translations ship with the app, never user text
  });
  for (const a of ATTRS) scope.querySelectorAll("[data-i18n-" + a + "]").forEach(el => {
    const keep = "data-i18n-en-" + a;
    if (!el.hasAttribute(keep)) el.setAttribute(keep, el.getAttribute(a) || "");
    const k = el.getAttribute("data-i18n-" + a);
    el.setAttribute(a, has(k) ? table[k] : el.getAttribute(keep));
  });
}
/** Switch language: remember it, translate the page and the library's labels, and tell the app to redraw. */
function setLanguage(l, opts) {
  lang = LANGUAGES[l] ? l : "en";
  table = lang === "en" ? {} : (DATA[lang] || {});
  if (!(opts && opts.remember === false)) { try { root.localStorage.setItem(STORE, lang); } catch (e) { /* not remembered */ } }
  if (root.document) { root.document.documentElement.lang = lang; applyDom(root.document); }
  if (root.Playhead && root.Playhead.localize) root.Playhead.localize(lang === "en" ? null : table);
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
  return lang;
}
/** Languages with translations available, as [[code, native name], ...]. */
function available() { return Object.keys(LANGUAGES).filter(l => l === "en" || DATA[l]).map(l => [l, LANGUAGES[l]]); }
/** Share of the English keys a language translates (0..1), for the language menu. */
function coverage(l, keys) { const d = DATA[l] || {}; return l === "en" ? 1 : keys.length ? keys.filter(k => Object.prototype.hasOwnProperty.call(d, k)).length / keys.length : 0; }

const api = { T, TP, setLanguage, applyDom, preferred, available, coverage, languages: LANGUAGES, get language() { return lang; }, get table() { return table; }, onChange: fn => listeners.push(fn), data: DATA };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.PHI18N = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
