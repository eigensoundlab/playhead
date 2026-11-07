# Changelog

## Unreleased

### Added
- **Languages**: the lab in Czech, German, Polish, Russian and Spanish, from a menu in the top bar or `?lang=` in the
  address. Missing texts fall back to English, counts follow each language's plural rules and numbers its decimal
  comma. The terms follow the shared [sound vocabulary](https://github.com/eigensoundlab/sound-vocabulary), so they
  are the same in Playhead, SFX Workbench and the papers. `Playhead.localize(table)` gives other apps the library's
  curve names, looks, legends and tools in these languages (`dist/i18n/<lang>.json`). `node tools/i18n.js` gathers the
  English, builds and checks the translations; [i18n/TRANSLATING.md](i18n/TRANSLATING.md) is the guide.
- **REAPER** ([integrations/reaper](integrations/reaper/README.md), installable with ReaPack): analyse items; events,
  sections and bars as markers and regions; curves as automation through the Playhead Control JSFX, which any effect
  parameter can follow; the tools as new takes; a dockable strip window in any look. Tested against the command line
  in a mock REAPER; not yet run in REAPER itself.
- **English terms in explanations**: translations can follow a technical term with its English original, "tvrdost
  (harshness)", written `[[tvrdost|harshness]]`; a checkbox under the language menu turns it off. Czech has it
  throughout, with the terms its author chose on the vocabulary's review sheet (tvrdost, saturace úderů, srovnat
  hlasitost událostí, nečekaná změna spektra, změna struktury, tvarování napětí, směr času).
- **The paper** (preprint, [10.5281/zenodo.24008127](https://doi.org/10.5281/zenodo.24008127)) is linked in the footer,
  with its citation beside the software's, and is the preferred citation in `CITATION.cff`. The footer also links the
  sound vocabulary, and "Comment on the translation" under the language menu opens a GitHub form with the language
  filled in.
- **Tracks in a folder**: `Playhead.combine(parts)` returns a document for the sum of several sounds from their
  documents alone (parts with an offset and a gain; no audio, no new analysis), and `Playhead.align(parts)` puts the
  parts on one time axis for views of who carries what. The lab's new section layers up to three files as tracks under
  a folder track, as in a DAW: drag the clips (they snap to each other's onsets, or move with the arrow keys), set gain,
  mute, solo and play the whole. The folder shows the tracks' look combined at once or from the analysed mix, with
  their agreement, and three new views: each track's share, the loudest track in each band, and bands two tracks
  share. In all six languages.
- **Searching arrangements**: `Playhead.arrange(parts, { goal })` tries some 500 offsets and gains of the parts from their
  documents in a fraction of a second and returns the best few arrangements, kept apart from each other, for punchy,
  big or clean layering (or weights of your own); `Playhead.measureParts(parts)` gives the measures behind them: rise
  time, contrast and focus around the main peak, the layers starting together and overlapping, spectral coverage, low
  end, tail, shared bands and harshness. First heuristics, to be tested by listening.
- `experiments/compose`: can a mix's Playhead be predicted from its parts'? 14 sessions from CC0 Sonic Pi samples;
  level, spectrum and onsets combine almost exactly, perceptual curves roughly, novelty and events poorly.
- Asset checks carry a key and values, so the lab shows them in other languages (`text` stays English).
- **Views of rhythm and form**, as looks and in the composer's "Behind" menu, in all six languages: the **bar raster**
  (`raster:<curve>`, a row per bar or per 4 bars, seekable by row), the **tempogram** (`spec:tempo`, `~cyclic` folds the
  octaves), the **lag view** (`spec:lag`, where the music repeats) and the **curve scalogram** (`scalogram:<curve>`,
  a Morlet wavelet transform of any curve with its cone of influence). Music documents carry `rhythm.tempogram` and
  `repetition` (the tempogram about 11 KB a minute, the lag view at most about 45 KB); `Playhead.view(doc, kind)` returns any view as numbers. A view a document
  cannot give leaves the waveform in its place.
- `Playhead.localize(table, lang)`: counts in the library's labels ("4 bars") follow the language's plural rules.
- `experiments/arrange`: arrangements found by `arrange()` mixed and analysed. Predicted and rendered measures agree
  (peak level r 0.99, rise 0.90, contrast 0.92, focus 0.95, coverage 0.97), the search ranks arrangements as their mixes
  rank (median Spearman 0.92 to 0.95), and its best candidate beats a rough placement in 23 of 24 sessions and goals.

### Changed
- The loudness curve hears a file with silence before and after it: its window counts silence beyond the ends, and its
  attack runs from silence through the half window before the start. A clip that starts at once used to begin at full
  loudness; inside a mix it rises from silence, so combined documents put the peak up to 2 dB too high and 20 to 60 ms
  too early. Only the first and last moments of a file change.
- `measureParts`: *together* takes every part in the main hit, so a part that comes in up to 100 ms late counts against
  it instead of being left out.
- Parts of very different lengths combine on the longest part's grid: a clip of a few tens of milliseconds has a rounded
  curve rate (3 columns for 34 ms) and was refused as "analysed with another curveRate".
- The command line writes `--out` and `--out-dir` files whole (a temporary file, then renamed), so a host waiting for
  them never reads half a file.
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
