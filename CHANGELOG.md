# Changelog

## Unreleased

### Added
- **Audiovisual Playhead** ([experiments/av](experiments/av/README.md), on the site at `/av/`): one scene drawn twice
  from the same sound by the same rules, with WebGPU or WebGL 2. The left side runs them on the usual signals (level,
  WebAudio analyser octaves, MilkDrop-style band beats, energy trend, level jumps, the loudest bin), worked out frame by
  frame without looking ahead; the right side on Playhead's analysis, known in advance. A timeline of what each side
  detected and did under each; for three demos with known parts (a dance arrangement, a melodic piece, a sound-design
  reel) what each side found. On the arrangement every kick, 80 of 81 snares and 168 of 190 hats at 0 to 1 ms against
  79 kicks, 29 snares and 133 hats at +8 to +9 ms, the build exactly, the drop 14 ms off and the pass-by 23 ms off
  where the usual signals have none; on the melody 31 of 38 note starts (usual 1), 17 of 17 vibratos at their rate;
  on the reel every shot and boom to a millisecond (usual +17 ms on the booms), the shots' after-effects, the motor's
  spin-up, spin-down and rotor. Where it does not win: the alarm's distortion is a tie, a clipped part inside a mix is
  weakly seen by both. Three scenes (rings, a ribbon for melody, a forge for sound effects and games). Both sides start
  alike (bias-corrected averages, the automatic gain from a reference level). Linked from the app's footer; open your
  own file to compare.
- **Cues** (`Playhead.cues`, `src/cues.js`, and the rule editor on the Audiovisual page): rules that turn events into
  cues: on an event (each band's hits, beats, bars, sections new or repeated, builds and drops, fills, breaks, a
  sound's start, its peak and its after-effect, glides up and down, pass-bys, vibrato), an action, by an amount, for a
  length (seconds, beats, bars, or the event's own), in a shape (pulse, hold, ramp, swell, fade), at the event or
  before or after it; mappings make an action follow a signal. Presets for rhythm, anticipation (cues that land on a
  drop), a game scene (the furnace), melody, and sound effects (weapon, impacts and explosions, devices and vehicles).
  A cue sheet (JSON, `playhead-cues` v1) lists the cues with their times for engines; the page exports it, and
  `playhead cues <file> [--preset name | --rules rules.json]` makes it from any sound or document.
- **[docs/GAMES.md](docs/GAMES.md)**: Playhead in games and audio-driven visuals: the pipeline (analyse at import,
  cue sheets, play against the sound's clock), the rule format, Unity code (a cue sheet reader and player, a weapon
  driven by its sound's cues), notes for Unreal, Godot, the web, FMOD and Wwise, and sound-effect cues: start, boom,
  after-effect, mechanical detail, spin-up, rotor, pass-by, reverb, and rules that drive sound (sweeteners, ducking,
  reverb sends, debris).
- **`pitch` curve** (sfx and music profiles): the strongest partial's pitch as a MIDI note number, null where no
  partial is clear; where a drum or a click is the strongest partial for a moment (0.15 s at most), the line is
  bridged between the notes, so a melody's line does not dive at each kick. Drawn on C2 to C7. In the lab, REAPER
  (Playhead Control) and the curve menus.
- **Two bench demos** with every part known: `experiments/bench/melodic.js` (phrases, legato slides, vibrato) and
  `experiments/bench/sounddesign.js` (shots with boom, bolt and tail, a motor with a rotor, a pass-by, a distorted
  alarm, impacts, an explosion). `test/cues-tests.js` checks the cues and the analysis on them.
- **Hits per band** (`hits`, sfx and music profiles): each band's own onsets, `{ low, mid, high: [[t, strength]] }`,
  to the sample: the kick, snare and hat layers for visuals and triggers. A hat struck with a kick is a high hit as
  well as a low one, and quiet 16th hats over an open hat's tail are found (the high band from the signal above 2 kHz
  at 1 ms). On the bench every hit of every band is found (attacks labelled high: 75 %).
- **Builds on the form**: a build now ends at the section it arrives at, which makes it a drop, and starts at a section
  start or a downbeat; builds left shorter than 5 s (a rise across a section change) are dropped. The `buildup` curve
  ramps from each build's start to its drop. Bench riser overlap 1.00 (was 0.71), swell 0.75 (0.67); the
  arrangement's build exact to 10 ms.
- **Fills** must stand out from the bars after them too: a bar where a new part enters and stays is no longer a fill.
- **Spectral playheads**: views of the spectrum on the beat grid, for what a tempogram cannot show (where in the bar
  the onsets fall, and which part of the spectrum makes them). `rhythm.spectral` keeps, per bar, 16th step and octave
  group, the level and the attack strength (about 350 bytes a bar). Three looks: **Bar spectrum** (`raster:spectrum`, a
  row per bar, a column per 16th, low red, mid green, high blue), **Spectral groove** (`raster:spectrum~attacks`, the
  same in attacks: each bar's drum pattern from the mix) and **Metrical spectrogram** (`spec:metric`, per octave group
  and bar the finest metrical level its attacks keep to, bar to 16ths). In the app's look composer, `Playhead.view`
  (kinds `raster` with curve `spectrum`, and `metric`), and REAPER's strip window (the Lua port equals the library's
  drawing at every point). On the new bench arrangement (`experiments/bench/arrangement.js`: intro, groove, break with
  a pass-by, build, drop, outro, synthesized with its form known) the metrical spectrogram reads the kick band as the
  half bar in the groove and the beat in the drop, the off-beat bass and the hats as 8ths, and the build's snare band
  going from the beat to 8ths to 16ths.
- **Rhythm changes, builds and sound motion** (descriptors from the research report, each tested on the bench first):
  - Per bar on the beat grid: `swing`, the drum `pattern` (per band, 16 steps), `surprise` against the four bars
    before, and `change` (`fill` or `break`); `rhythm.template`, the groove (per band and step the median strength and
    timing); curves `patternSurprise` and `swing`. On the bench every fill and break is found with none false, and a
    groove that starts to swing at bar 8 is followed bar by bar.
  - `builds`: stretches where the sound keeps building second by second by density, brightness or loudness, with
    `drop` where a jump or a hit follows; the `buildup` curve. A riser at one loudness and a swell of more hits are
    found (overlap 0.71 and 0.67), no groove has a false build.
  - `distortion` curve: clipped runs and the flattened crest of a saturated sound (clipped against clean blocks at one
    loudness: AUC 1).
  - `glides` (the strongest partial's steady pitch motion, drum pitch drops left out) and pass-bys among them: the
    Doppler shift of a source going past, with the moment it passes and the speed it shows (a lower bound: 19.6 m/s for
    25); `pitchSlope` curve. `vibrato`: held notes whose pitch swings regularly, from a singer's 6 Hz to a rotor's 28 Hz
    (micro-Doppler), from the note's instantaneous frequency.
  - `rhythm.signature` and `rhythmSimilarity(a, b)`: the rhythm's shape at any tempo (the scale transform), 0.99 for
    the same groove 30 BPM faster. It separates weakly (a waltz 0.92) and microtiming moves it.
  - `toMarkers` and `playhead markers --kinds changes`: builds as regions, fills, breaks and pass-bys as markers.
  - REAPER: Add markers adds them ("Builds, fills and pass-bys"); the five new curves can be written as automation.
  - `attacks` carry their `strength`. Tightness is measured with each band's offset over the whole file (was per bar,
    which took some of the spread for offset: 10.8 ms now for 11.3 ms of random timing).
- **Timing to the sample, and the beat grid** (the infrastructure for rhythm descriptors):
  - `attacks`: every onset refined to the sample where its level starts to rise, with the band it rises in (low:
    kick and bass, mid: snare and body, high: hats and cymbals). The frame onsets came about 14 ms early; the
    attacks are within 0.5 to 0.7 ms (median) on the bench.
  - `onsetLow`, `onsetMid`, `onsetHigh`: onset strength per band, so `raster:onsetLow` is the kick's bar raster.
  - `rhythm.grid`: each attack's bar, place in the bar and deviation in ms; `rhythm.bars`: per bar the tightness and
    each band's offset from the low band (a laid-back snare reads +25 ms); `rhythm.timing`, their medians;
    `rhythm.swing`, the 8th-note swing ratio.
  - `rhythm.beatsPerBar` (3/4 told from 4/4, downbeats every 3 beats where the beats clearly fall in threes),
    `rhythm.downbeatConfidence`, `rhythm.meter` (the evidence for 3 and 4), and the `pulseClarity` curve.
  - The tempogram reaches 30 to 590 BPM (was 40 to 240): slow phrase pulses below, 16ths and rolls above. The legend
    gives each document's own range.
  - REAPER: Split items at sounds cuts at the attacks (to the sample); Analyse prints the timing (tightness, the
    snare and hat bands against the kick, swing, beats a bar); the new curves can be written as automation.
- **The descriptor bench** ([experiments/bench](experiments/bench/README.md)): grooves from synthesized drums whose
  every hit is known to the sample (straight, a laid-back snare, pushed hats, loose timing, swing 1.5 to 3, a waltz,
  16ths, pulses at 32 and 480 BPM, no beat), with the measures, so old and new descriptors are tested on the same
  ground. Swing comes out within 0.07, offsets within 0.3 ms, tightness 10.9 ms for 12 ms of random timing, the waltz
  as 3/4. `test/grid-tests.js` runs it with the tests.
- **Stretch keeping the attacks** (tool `stretch`, in the lab, the command line and REAPER's Process items): changes the
  length without changing the pitch and keeps every attack as it is. Playhead's onsets (or its event starts), refined to
  the sample where the level starts to rise, mark the attacks; the first 30 ms of each are copied unchanged and placed
  at onset × length, and only the sound between them is stretched (WSOLA). Tested on five hits ×2 and ×0.5: each attack
  within 1 ms of its place and copied sample for sample, where a plain stretch, rendered beside it, moves them by up to
  25 ms. In all six languages. In REAPER the new takes start at the same moment of the sound, and the item is
  lengthened (or shortened) to play them.
- **A listening test of the arrangement goals** ([experiments/listening](experiments/listening/README.md), on the site
  at `/listening/`): do the search's arrangements sound punchier, bigger or cleaner than the rough placement they start
  from? 36 to 38 blind A/B answers in about 8 minutes, loudness matched, with two checks and four repeats. The
  sounds come from the arrangement experiment's 16 sessions (8 drum and percussion kits, 8 of varied material:
  robot, glass and metal, tabla, guitar, cinematic bass, vinyl, electronic, choir); each listener hears one of each
  pair, 8 sessions, and the page loads only those sounds. The page sends nothing; listeners save a file and send it
  through a GitHub form. The analysis treats listeners as the unit; simulations put the aim at 24 listeners. The lab links to it from its
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
- **Trimmed parts** in `arrange` and `measureParts`: a part's `start` and `end` (seconds of its document) keep only
  that stretch of it, as an item in an editor plays only part of its source.
- **`playhead arrange --parts parts.json`** on the command line: the search for arrangements from a list of parts
  (documents or audio files, with offset, gain, start, end and lock), printing the best arrangements as JSON. Options
  `--goal`, `--range`, `--gains`, `--count` and `--seed`.
- **`timbreHarshness` curve**: the psychoacoustic annoyance factor behind `harshness` (sharpness, fluctuation, roughness)
  without the loudness that `harshness` adds it to, so a quiet harsh sound reads as harsh. In the lab's composer (tint,
  lanes, views), in REAPER's curves and Playhead Control, and combined across layers as a power-weighted mean.
- **Playhead tempograms** (look codes `spec:tempo~of:<curve>`, `~of:speed`, `~w:<curve>`; in the lab's composer as
  "Tempogram of" and "Weighted by", Czech included): the tempogram of a descriptor's rises, of how fast all the
  descriptors change together, or the tempogram weighted by a curve, drawn toward grey where the curve is low. Tempi
  stay true: nothing moves a ridge along the tempo axis. On a groove at 120 BPM the harshness and change tempograms
  peak at 120 BPM; a curve pulsing at 80 BPM in half a sound shows 80 BPM there only.
- **Frames for visuals, engines and 3D tools**: `Playhead.frames(doc, { fps, curves, scale })` and
  `playhead frames <file> --fps 60 [--curves ...] [--format csv|json|blender]`: the curves once per video frame, each
  value the curve's mean over its frame, on 0..1 as the strip draws it (or `--scale file`: from each curve's 5th to
  95th percentile in the file), with onset, beat and downbeat frames. The CSV
  goes into TouchDesigner, Unreal DataTables or spreadsheets; the Blender script keys the curves as custom properties
  of an Empty, for drivers.
- **`experiments/visuals`**: Playhead's curves against the usual audio-reactive drivers (an RMS follower, MilkDrop-style
  FFT bands, centroid, an onset trigger, and the same computed offline) on six sounds built with known accents,
  sections, builds and timbres. Playhead's loudness, tension and arousal separate sections far better (η² 0.93 to
  0.97 against 0.54 to 0.67) and never pass 2.5 flashes a second where the usual drivers reach 4 to 8; its onset
  strength hits accents best or as well, with no latency. Builds at constant loudness and harshness at equal loudness
  are not read yet; the README says what is missing. A viewer at `/visuals/` drives two visuals side by side.
- **Markers for editors**: `playhead markers` writes Audacity labels (`--format audacity`), DaVinci Resolve timeline
  markers (`--format edl`, with `--fps` and `--start-tc`) and subtitles for any video editor (`--format srt`), and reads
  a `.playhead.json` document as well as audio, so nothing is analysed twice.
- **`experiments/arrange` with 16 sessions**: 8 kits of varied material (robot, glass and metal, tabla, guitar,
  cinematic bass, vinyl, electronic, choir) beside the 8 drum kits. Predicted and rendered measures agree as before
  (r 0.95 to 0.99); where the varied kits gain little, the README says why.
- **REAPER: installing and removing.**
  - Each release gets `playhead-reaper-<system>.zip`, with the actions, the effect and the command line for that
    system. Run its **Playhead - Install** once from REAPER: it copies everything into the resource folder, adds the
    actions to the action list and checks the command line. Running it again updates.
  - **Playhead - Uninstall** takes the actions off the list and deletes the files. If asked, it also deletes the
    stored analyses and the settings.
  - A **ReaPack** repository at `https://eigensoundlab.github.io/playhead/reaper/index.xml`, written by the site build
    (`tools/reapack-index.js`), with every file pinned to the commit built and its checksum.
- **REAPER: editing tools** (three new actions):
  - **Arrange selected layers**: for a sound built from layers on items of their own, `playhead arrange` searches
    small moves and gain changes for a punchier, bigger or cleaner whole and offers the best six. Each is applied and
    played as you pick it; keep one (one undo step) or go back. Locked items stay.
  - **Split items at sounds**: a cut a few milliseconds before each event or onset; the pieces named after their
    sounds, ended where they have decayed (with a faded tail) and given regions, for rendering one file per sound.
  - **Tempo map from item**: tempo markers at a recording's bars (or beats), each putting the next bar on its
    downbeat, the first with the time signature; the item is set to time base Time so it stays.
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
- **Vibrato and rotor rates** of harmonic-rich sounds: the note is demodulated over whole periods of itself, so its
  harmonics no longer ripple the measured frequency (the bench rotor reads 28 Hz, 26 cents for 28 Hz, 30 cents: it
  read 29.5 Hz, 49 cents), and a note held between two glides (a motor running between its spin-up and spin-down) is
  found. Depths under 15 cents (a metal hit's ringing) are no longer vibrato.
- **Glides** end where the partial jumps by more than 1.5 semitones from one frame to the next, so a note's end and the
  chord or drum left after it are no longer read as a slide of tens of semitones; a kick's pitch drop read across such
  a jump is still a drum's.
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
