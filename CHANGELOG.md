# Changelog

## Unreleased

### Added
- **Stretch keeping the attacks** (tool `stretch`, in the lab, the command line and REAPER's Process items): changes the
  length without changing the pitch and keeps every attack as it is. Playhead's onsets (or its event starts), refined to
  the sample where the level starts to rise, mark the attacks; the first 30 ms of each are copied unchanged and placed
  at onset × length, and only the sound between them is stretched (WSOLA). Tested on five hits ×2 and ×0.5: each attack
  within 1 ms of its place and copied sample for sample, where a plain stretch, rendered beside it, moves them by up to
  25 ms. In all six languages. In REAPER the new takes start at the same moment of the sound, and the item is
  lengthened (or shortened) to play them.
- **A listening test of the arrangement goals** ([experiments/listening](experiments/listening/README.md), on the site
  at `/listening/`): do the search's arrangements sound punchier, bigger or cleaner than the rough placement they start
  from? 38 blind A/B answers in about 8 minutes, from the arrangement experiment's sessions, loudness matched, with
  two checks and four repeats. The page sends nothing; listeners save a file and send it through a GitHub form. The
  analysis treats listeners as the unit; simulations put the aim at 16 listeners. The lab links to it from its
  header and footer (in all six languages; the test itself is in English), and `tools/serve.js` serves it at
  `/listening/` as the site does.
- **REAPER: the views of rhythm and form in the strip window** (package 0.2.0): bar raster, tempogram, repetition,
  modulation spectrogram and curve rhythms, drawn by the Lua port as the library draws them (checked at 38,300 points
  of 26 strips against `drawStrip`, and as numbers against `Playhead.view`). On the bar raster the cursors are drawn
  in the row of their bar, and a click moves the edit cursor to that point of that bar. A view the analysis does not
  have leaves the waveform in its place, as in the library.
- **REAPER strip window: zoom and colours.**
  - The mouse wheel zooms around the mouse, as in REAPER's arrange view. Ctrl, Shift or Alt with the wheel, or a
    horizontal wheel, scrolls; the middle button drags the view.
  - While zoomed in, a bar along the bottom shows where the view is in the item. The view follows playback when
    REAPER's own view does. *Show the whole item* in the menu zooms out.
  - A *Colours* menu offers five palettes: REAPER theme, Playhead, Heat, Colour-blind safe (viridis and Okabe-Ito) and
    Greyscale. Each keeps the waveform's tint apart from the peak outline and the lines, on dark and light backgrounds.
    In the REAPER theme the outline keeps REAPER's peak colour and tints run from neutral to a hot yellow. Before, a
    harshness tint in blues met a blue peak colour.
- **`waveRamp`** (theme): a waveform's tint through several colours instead of the two ends `waveLow` → `waveHigh`.
- **REAPER: installing and removing.**
  - Each release gets `playhead-reaper-<system>.zip`, with the actions, the effect and the command line for that
    system. Run its **Playhead - Install** once from REAPER: it copies everything into the resource folder, adds the
    actions to the action list and checks the command line. Running it again updates.
  - **Playhead - Uninstall** takes the actions off the list and deletes the files. If asked, it also deletes the
    stored analyses and the settings.
  - A **ReaPack** repository at `https://eigensoundlab.github.io/playhead/reaper/index.xml`, written by the site build
    (`tools/reapack-index.js`), with every file pinned to the commit built and its checksum.
- **REAPER: [a guide to Playhead's curves as envelopes](integrations/reaper/ENVELOPES.md):** writing them, seeing
  and editing them, linking parameters, MIDI CC, recipes and what to check when nothing moves.

### Changed
- **The lab's strips:**
  - Spectrograms and views (tempogram, repetition, modulation, curve rhythms, bar raster) use the library's magma
    ramp, as REAPER does. Its black low end gives faint detail room, such as a tempo's harmonics or a weak repeat.
    Before, the panel's ramp started at mid-blue, or ran through blues only in the light panel.
  - A waveform's tint runs through the panel's six spectral colours.
- **The axis of a view** (BPM, lag, rate, period) is drawn light or dark by the ramp's low end, not by the page, so it
  stays readable on a light page or REAPER theme.

### Fixed
- **REAPER tests on Windows** (`python integrations\reaper\test\run_tests.py`): the core tests run there, with a real
  batch job through `cmd.exe` in place of the POSIX shell checks; the action tests, which need a POSIX shell, are
  skipped with a note unless asked for.
- **REAPER: the analysing window** is sized for scaled displays (Windows at 125 or 150 %), and its note keeps a margin
  from the bottom edge.

## 0.3.0 (2026-11-07)

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
  octaves), the **lag view** (`spec:lag`, where the music repeats), the **modulation spectrogram** (`spec:mod`, any
  sound: how fast the level pulses, 0.5 to 128 Hz, from rhythm through tremolo and flutter to roughness, from the band
  envelopes at analysis) and the **curve scalogram** (`scalogram:<curve>`, a Morlet wavelet transform of any curve with
  its cone of influence). Sound effect and music documents carry `modulation` (up to about 26 KB), music documents also
  `rhythm.tempogram` and `repetition` (the tempogram about 11 KB a minute, the lag view at most about 45 KB);
  `Playhead.view(doc, kind)` returns any view as numbers. A view a document cannot give leaves the waveform in its place.
- `Playhead.localize(table, lang)`: counts in the library's labels ("4 bars") follow the language's plural rules.
- `experiments/arrange`: arrangements found by `arrange()` mixed and analysed. Predicted and rendered measures agree
  (peak level r 0.99, rise 0.90, contrast 0.92, focus 0.95, coverage 0.97), the search ranks arrangements as their mixes
  rank (median Spearman 0.92 to 0.95), and its best candidate beats a rough placement in 23 of 24 sessions and goals.

### Changed
- The loudness curve hears a file with silence before and after it: its window counts silence beyond the ends, and its
  attack runs from silence through the half window before the start. A clip that starts at once used to begin at full
  loudness; inside a mix it rises from silence, so combined documents put the peak up to 2 dB too high and 20 to 60 ms
  too early. Only the first and last moments of a file change: on the 73-file corpus, the loudness range of short
  one-shots (by 1 LU or more in 16 files) and the tension range of a few; the self-checks pass and fail as before
  ([experiments/corpus](experiments/corpus/README.md)).
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
