// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Daniel Sandner
//
// Analysis of the listening test (see README.md): the result files listeners saved, against site/manifest.json.
//   node experiments/listening/analyse.js <results-folder>            table on stdout, summary.json in the folder
//   node experiments/listening/analyse.js --simulate 12 [--beta 6]    the same for 12 simulated listeners
//   node experiments/listening/analyse.js --power                     how many listeners the test needs
//
// Each listener's first hearing of each pair counts; the repeated pairs (A and B swapped) measure consistency only.
// Listeners who fail both checks are left out (rule fixed before the test). Listeners are the unit: a share is the
// mean of the listeners' shares, with a 95 % t interval over listeners, since one listener's answers are not
// independent of each other; the pooled binomial p-values assume they are and are given for reference.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { plan, rng } = require("./site/plan.js");
const M = JSON.parse(fs.readFileSync(path.join(__dirname, "site", "manifest.json"), "utf8"));
const GOALS = ["punch", "big", "clean"];
const TRIAL = Object.fromEntries(M.trials.map(t => [t.id, t]));

// ---------------------------------------------------------------- statistics
function binomTwoSided(k, n) {
  if (!n) return null;
  const lp = [];
  let lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  for (let i = 0; i <= n; i++) lp[i] = lf[n] - lf[i] - lf[n - i] - n * Math.LN2;
  const pk = lp[k];
  let p = 0; for (let i = 0; i <= n; i++) if (lp[i] <= pk + 1e-9) p += Math.exp(lp[i]);
  return Math.min(1, p);
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const quant = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1) + 0.5)))]; };
function ranks(a) { const ix = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < ix.length;) { let j = i; while (j + 1 < ix.length && ix[j + 1][0] === ix[i][0]) j++; for (let k = i; k <= j; k++) r[ix[k][1]] = (i + j) / 2; i = j + 1; } return r; }
function pearson(a, b) { const ma = mean(a), mb = mean(b); let ab = 0, aa = 0, bb = 0; a.forEach((v, i) => { ab += (v - ma) * (b[i] - mb); aa += (v - ma) ** 2; bb += (b[i] - mb) ** 2; }); return aa && bb ? ab / Math.sqrt(aa * bb) : null; }
const spearman = (a, b) => pearson(ranks(a), ranks(b));
// share of hits over the listeners' pooled answers, and a 95 % interval from resampling listeners
// the 97.5 % point of Student's t with df degrees of freedom (Cornish-Fisher expansion; within 0.002 from df 3)
function t975(df) {
  const z = 1.959964, z3 = z ** 3, z5 = z ** 5, z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}
// listeners as the unit: each listener's share of hits, their mean with a 95 % t interval (with few listeners a
// bootstrap over them is too narrow: in simulations without an effect it excluded one half in 10-13 % of tests of
// 8 listeners), a sign test over listeners, and the pooled share with its binomial p for reference
function clustered(perListener) {
  const L = perListener.filter(x => x.n > 0);
  if (!L.length) return null;
  const k = L.reduce((s, x) => s + x.k, 0), n = L.reduce((s, x) => s + x.n, 0), sh = L.map(x => x.k / x.n), m = mean(sh);
  const sd = L.length > 1 ? Math.sqrt(sh.reduce((s, v) => s + (v - m) ** 2, 0) / (L.length - 1)) : 0, half = L.length > 1 ? t975(L.length - 1) * sd / Math.sqrt(L.length) : 0.5;
  const above = sh.filter(v => v > 0.5).length, below = sh.filter(v => v < 0.5).length;
  return { k, n, share: m, pooled: k / n, ci: [Math.max(0, m - half), Math.min(1, m + half)], pPooled: binomTwoSided(k, n), listeners: { above, below, pSign: binomTwoSided(above, above + below) } };
}
const r3 = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000);

// ---------------------------------------------------------------- analysis
function analyse(results) {
  const listeners = results.map(R => {
    const first = R.answers.filter(a => !a.repeat), checks = first.filter(a => TRIAL[a.trial] && TRIAL[a.trial].type === "check");
    const passed = checks.filter(a => a.chosen === TRIAL[a.trial].expected).length;
    const reps = R.answers.filter(a => a.repeat).map(a => { const f = first.find(x => x.trial === a.trial); return f ? f.chosen === a.chosen : null; }).filter(v => v != null);
    return { id: R.id, device: R.device, experience: R.experience, answers: first, checks: { passed, of: checks.length }, consistent: reps.length ? reps.filter(Boolean).length / reps.length : null, repeats: reps.length,
      medianMs: quant(R.answers.map(a => a.ms), 0.5), excluded: checks.length > 0 && passed === 0 };
  });
  const kept = listeners.filter(l => !l.excluded);
  const tally = (pred, hit) => kept.map(l => { const a = l.answers.filter(x => TRIAL[x.trial] && pred(TRIAL[x.trial])); return { k: a.filter(x => hit(TRIAL[x.trial], x)).length, n: a.length }; });
  const out = { listeners: { total: listeners.length, kept: kept.length, excluded: listeners.filter(l => l.excluded).map(l => l.id) }, goals: {}, sessions: {} };
  // 1. does the search's best candidate for a goal win over the rough placement, asked about that goal?
  for (const g of GOALS) out.goals[g] = clustered(tally(t => t.type === "main" && t.goal === g, (t, a) => a.chosen === t.candidate));
  out.allGoals = clustered(tally(t => t.type === "main", (t, a) => a.chosen === t.candidate));
  // 2. do choices follow the rendered measures (main and cross trials where the measures favour one sound)?
  out.followsMeasures = clustered(tally(t => t.type !== "check" && t.favoured, (t, a) => a.chosen === t.favoured));
  // 3. is each goal's candidate heard as more of that goal than another goal's candidate?
  out.cross = clustered(tally(t => t.type === "cross", (t, a) => a.chosen === t.candidate));
  // 4. per pair: the share choosing the candidate, against the gain the measures predicted and saw in the mix
  const pairs = M.trials.filter(t => t.type === "main").map(t => {
    const a = kept.flatMap(l => l.answers.filter(x => x.trial === t.id));
    return { id: t.id, goal: t.goal, n: a.length, share: a.length ? a.filter(x => x.chosen === t.candidate).length / a.length : null, predicted: t.gain.predicted, rendered: t.gain.rendered };
  }).filter(p => p.n > 0);
  out.pairs = pairs.map(p => ({ ...p, share: r3(p.share) }));
  out.gainVsShare = pairs.length >= 5 ? { rendered: r3(spearman(pairs.map(p => p.rendered), pairs.map(p => p.share))), predicted: r3(spearman(pairs.map(p => p.predicted), pairs.map(p => p.share))), pairs: pairs.length } : null;
  out.checks = { passedBoth: listeners.filter(l => l.checks.passed === l.checks.of).length, passedOne: listeners.filter(l => l.checks.passed === 1).length, failedBoth: listeners.filter(l => l.excluded).length };
  const cons = kept.filter(l => l.consistent != null);
  out.consistency = cons.length ? r3(cons.reduce((s, l) => s + l.consistent * l.repeats, 0) / cons.reduce((s, l) => s + l.repeats, 0)) : null;
  out.perListener = listeners.map(l => ({ id: l.id, device: l.device, experience: l.experience, excluded: l.excluded, checks: l.checks.passed + "/" + l.checks.of, consistent: r3(l.consistent), medianMs: l.medianMs,
    candidate: Object.fromEntries(GOALS.map(g => { const a = l.answers.filter(x => TRIAL[x.trial] && TRIAL[x.trial].type === "main" && TRIAL[x.trial].goal === g); return [g, a.length ? r3(a.filter(x => x.chosen === TRIAL[x.trial].candidate).length / a.length) : null]; })) }));
  return out;
}

function report(o) {
  const f = c => c ? (100 * c.share).toFixed(0) + " % (pooled " + c.k + "/" + c.n + "), 95 % CI " + (100 * c.ci[0]).toFixed(0) + "-" + (100 * c.ci[1]).toFixed(0) + " %, listeners " + c.listeners.above + " for / " + c.listeners.below + " against (sign p " + c.listeners.pSign.toFixed(3) + "), pooled p " + c.pPooled.toFixed(4) : "no answers";
  const lines = [];
  lines.push("Listeners: " + o.listeners.kept + " analysed of " + o.listeners.total + (o.listeners.excluded.length ? " (left out, both checks failed: " + o.listeners.excluded.join(", ") + ")" : ""));
  lines.push("Checks: both passed " + o.checks.passedBoth + ", one " + o.checks.passedOne + ", none " + o.checks.failedBoth + ". Repeated pairs answered the same: " + (o.consistency == null ? "-" : (100 * o.consistency).toFixed(0) + " %"));
  lines.push("");
  lines.push("The search's best candidate chosen over the rough placement:");
  for (const g of GOALS) lines.push("  " + g.padEnd(6) + f(o.goals[g]));
  lines.push("  all   " + f(o.allGoals));
  lines.push("Choices that follow the rendered measures (main and cross pairs): " + f(o.followsMeasures));
  lines.push("A goal's candidate chosen over another goal's, asked about its goal: " + f(o.cross));
  if (o.gainVsShare) lines.push("Per pair, share choosing the candidate against its score gain (Spearman, " + o.gainVsShare.pairs + " pairs): rendered " + o.gainVsShare.rendered + ", predicted " + o.gainVsShare.predicted);
  return lines.join("\n");
}

// ---------------------------------------------------------------- simulated listeners
// A listener chooses x over y with probability sigmoid(beta * (rendered score of x - of y) + bias), the bias per
// listener (spread 0.3) and per side (A slightly favoured); checks are passed with probability 0.95, and one in ten
// listeners answers at random.
function simulate(n, beta, seed) {
  const r = rng(seed), out = [], score = (id, g) => { const s = M.stimuli.find(x => x.id === id); return s && s.scores ? s.scores[g].rendered : 0; };
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  for (let i = 0; i < n; i++) {
    const id = "sim" + seed + "-" + i, random = r() < 0.1, bias = 0.3 * gauss(), answers = [];
    for (const p of plan(M, id)) {
      const t = TRIAL[p.trial];
      let pa;
      if (random) pa = 0.5;
      else if (t.type === "check") pa = p.a === t.expected ? 0.95 : 0.05;
      else { const d = score(p.a, t.goal) - score(p.b, t.goal); pa = 1 / (1 + Math.exp(-(beta * d + 0.1 + (TRIAL[p.trial].candidate === p.a ? bias : -bias)))); }
      if (p.repeat && !random) { const f = answers.find(x => x.trial === p.trial && !x.repeat); if (f && r() < 0.6) { answers.push({ trial: p.trial, repeat: true, a: p.a, b: p.b, chosen: f.chosen, playsA: 1, playsB: 1, ms: 6000 }); continue; } }
      answers.push({ trial: p.trial, repeat: p.repeat, a: p.a, b: p.b, chosen: r() < pa ? p.a : p.b, playsA: 1 + Math.floor(r() * 3), playsB: 1 + Math.floor(r() * 3), ms: Math.round(4000 + 6000 * r()) });
    }
    out.push({ test: M.test, version: M.version, manifest: M.generator, id, device: "headphones", experience: ["none", "hobby", "pro"][i % 3], answers });
  }
  return out;
}

module.exports = { analyse, simulate, report, clustered, binomTwoSided };
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (require.main !== module) { /* used as a module */ }
else if (args.includes("--power")) {
  // how often the test finds an effect (each goal's 95 % interval above one half, and choices following the measures),
  // by listeners and strength; beta 0 is no effect, where it should find one in about 5 % of tests
  console.log("Share of 200 simulated tests whose 95 % interval excludes one half (punch / big / clean / follows the measures)");
  console.log("listeners  beta 0 (none)        beta 4               beta 6               beta 8");
  for (const n of [8, 12, 16, 24]) {
    const cells = [0, 4, 6, 8].map(beta => {
      const hits = { punch: 0, big: 0, clean: 0, follows: 0 }, R = 200;
      for (let k = 0; k < R; k++) {
        const o = analyse(simulate(n, beta, "p" + n + "-" + beta + "-" + k));
        for (const g of GOALS) if (o.goals[g] && (o.goals[g].ci[0] > 0.5 || o.goals[g].ci[1] < 0.5)) hits[g]++;
        if (o.followsMeasures && (o.followsMeasures.ci[0] > 0.5 || o.followsMeasures.ci[1] < 0.5)) hits.follows++;
      }
      return [hits.punch, hits.big, hits.clean, hits.follows].map(h => Math.round(100 * h / R)).join("/");
    });
    console.log(String(n).padEnd(11) + cells.map(c => c.padEnd(21)).join(""));
  }
} else {
  let results, dir = args.find(a => !a.startsWith("--") && a !== opt("--simulate") && a !== opt("--beta"));
  if (opt("--simulate")) {
    results = simulate(+opt("--simulate"), opt("--beta") == null ? 6 : +opt("--beta"), "demo");
    dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), "playhead-listening-sim-"));
  } else {
    if (!dir) { console.error("usage: node experiments/listening/analyse.js <results-folder> | --simulate N [--beta B] | --power"); process.exit(1); }
    results = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "summary.json").map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))).filter(R => R.test === M.test);
    const other = results.filter(R => R.manifest !== M.generator);
    if (other.length) console.warn("note: " + other.length + " result file(s) were made with other stimuli (" + other[0].manifest + ")");
  }
  const o = analyse(results);
  console.log(report(o));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ generator: "experiments/listening/analyse.js", manifest: M.generator, simulated: !!opt("--simulate"), ...o }, null, 1) + "\n");
  console.log("\nsummary.json written to " + dir);
}
