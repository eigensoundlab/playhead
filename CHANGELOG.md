# Changelog

## Unreleased

### Added
- **Languages**: the lab in Czech, German, Polish, Russian and Spanish, from a menu in the top bar or `?lang=` in the
  address. Missing texts fall back to English, counts follow each language's plural rules and numbers its decimal
  comma. The terms follow the shared [sound vocabulary](https://github.com/eigensoundlab/sound-vocabulary), so they
  are the same in Playhead, SFX Workbench and the papers. `Playhead.localize(table)` gives other apps the library's
  curve names, looks, legends and tools in these languages (`dist/i18n/<lang>.json`). `node tools/i18n.js` gathers the
  English, builds and checks the translations; [i18n/TRANSLATING.md](i18n/TRANSLATING.md) is the guide.
- Asset checks carry a key and values, so the lab shows them in other languages (`text` stays English).

### Changed
- Clearer English: structural change goes down for "a fall or break" (in dance music a "drop" is a loud entry); the
  rule for N tags is YIN aperiodicity under 0.25 with pitch above 60 Hz (the note said "above 250 Hz"); "Curve scale:
  same for every file / fitted to this file" replaces "Secondary scale: library reference / this asset"; N9 shows
  decay time (T60).

## 0.2.0 (2026-11-05)

The first release with a library API, so other apps can embed Playhead, and with looks: the strip is now composed
from layers instead of being fixed.

### Added
- **Library API** (`src/playhead.js`, bundled as UMD and ES module in `dist/`): `analyze()` and `fromAnalysis()` return
  a plain-JSON analysis document (schema `playhead-analysis` v1), `drawStrip()` draws it into any Canvas 2D context,
  `process()` and `tools()` run the effects bench, plus `toMarkers()` and `curveAt()`. See
  [docs/INTEGRATION.md](docs/INTEGRATION.md).
- A command-line tool (`tools/playhead-cli.js`, standalone builds by CI) and two examples (an embedded page, an
  analysis worker).
- **Looks**: a strip is a list of layers written as a short code (waveform, spectrogram, lines, lanes, sections, marks,
  outline, a waveform sculpted by loudness; in lanes or overlaid; from the baseline, mirrored, as horizon charts or
  lines). 17 ready-made looks, two of them for sound effects (Sound character, Hits and surprise).
- In the lab: **Compose your own** (build a look and compare it with the waveform and the spectrogram of the same
  file) and a feedback form for looks.
- In the document: a mel spectrogram, onset strength, novelty marks, and for music structural change (signed: up for an
  entry, down for a drop) and the local pulse.
- **Tools** (13 in all): Reverb on the tails, Drive the hits and Ring time, which follow the events and so do what an EQ
  cannot; Level the events (automatic clip gain); Fold to mono (phase lined up, energy kept, cancellations reported);
  Widen the tails (attacks centred, mono-compatible).
- Experiments: event levelling against a compressor ([experiments/compression](experiments/compression/README.md)),
  and the data behind the paper's figures.

### Changed
- The impulsiveness curve (N1) peaks at the clicks that cause it instead of up to one analysis window early. The
  summary value K is unchanged.
- Beats and bar lines are drawn so they can be seen at small heights.
- The corpus results (`experiments/corpus/`) are in the repository: `.gitignore` had hidden them along with the
  downloaded corpus audio. `experiments/dyneq-corpus.json` became `experiments/corpus/detector-comparison.json`.

`src/analysis.js` is unchanged since 0.1.0 and the descriptor changes add curves without changing summary values, so
the results in the paper, produced with 0.1.0 ([10.5281/zenodo.23932626](https://doi.org/10.5281/zenodo.23932626)),
still hold.

## 0.1.0 (2026-11-03)

First release: the waveform lab with seven intensity curves, sound-effect, rhythm and structure views, nine
cross-field descriptors, seven analysis-driven tools, and the validation behind the paper.
