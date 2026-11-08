# Using Playhead in other applications

Playhead's analysis can run inside another program in three ways:

| Way | For | Files |
|---|---|---|
| **Library** in the browser or Node | web tools (SFX Workbench, kurator's front end), Node tools | `dist/playhead-core.mjs` (ES module), `dist/playhead-core.js` (script tag, `importScripts`, `require`) |
| **Command line** | anything that can start a process: REAPER scripts, Python (kurator's server), Unity editor scripts, batch jobs | `playhead` / `playhead.exe` (one file, no Node needed), or `node tools/playhead-cli.js` |
| **JSON documents** | storing analysis next to assets, databases, game data | the output of both, schema `playhead-analysis` version 1 |

Everything is deterministic: the same audio gives the same document. The bundles produce exactly the documents the sources do (checked by `npm test`), and they define no globals in the host page or module.

## Getting the files

- `npm run build` writes `dist/` and copies it to the site, so after deployment the bundles are at `https://eigensoundlab.github.io/playhead/dist/playhead-core.mjs` (and `.js`). Vendor a copy into your project rather than loading it from there, and record the version (`Playhead.version`).
- Each GitHub release gets the bundles and the executables for Linux, macOS and Windows (`.github/workflows/cli.yml`). `npm run build:cli` builds the executable for the current machine.
- The executable reads WAV itself; other formats need `ffmpeg` on the PATH, or decode them yourself and pipe the samples in (see kurator below).

## API

```js
import Playhead from "./vendor/playhead-core.mjs";   // or: const Playhead = require("./playhead-core.js")

const doc = await Playhead.analyze({ sampleRate: 48000, channels: [left, right] }, { profile: "auto", name: "door_slam.wav" });
Playhead.drawStrip(canvas.getContext("2d"), doc, { from: 0, to: doc.source.duration });
const marks = Playhead.toMarkers(doc, { kinds: ["sections", "downbeats"] });
const v = Playhead.curveAt(doc, "tension", 12.5);
const r = await Playhead.process(sound, "deharsh", { amount: 0.6 });   // r.outputs[0].channels, r.report
const whole = Playhead.combine([{ doc: kick }, { doc: bass, offset: 0.5, gain: -3 }]);   // the sum, from documents alone
```

| Function | Returns |
|---|---|
| `analyze(input, opts)` | a JSON document (below). `input` is an `AudioBuffer` or `{ sampleRate, channels: [Float32Array, ...] }` (mono or stereo). `opts`: `profile`, `name`, `curveRate` (curve samples per second; default 100 up to 10 s, 20 above), `waveColumns` (default 1000), `assetClass` (override the guess), `onProgress(p)` |
| `drawStrip(ctx, doc, opts)` | draws a strip into any Canvas 2D context, including an `OffscreenCanvas` in a worker, and returns `{ code, layers, legend, items }` (`items`: one `{ label, colour }` or `{ label, ramp }` per coloured element, for a host's own key). `opts`: `width`, `height`, `from`, `to` (seconds), `theme`, and `look` (a look name or look code, see [Looks](#looks)) or `layers`; without them the automatic look, which the older options `curve`, `colour`, `lineRange`, `events`, `sections`, `beats` still adjust |
| `fromAnalysis(F, input, opts)` | the document for an existing `WL.analyse()` result, without analysing again |
| `parseLook(code)`, `lookCode(layers)`, `describeLook(layers, doc)` | look code to layers and back; a plain-language legend |
| `looks`, `curveLabels` | the ready-made looks (`name`, `desc`, `code`) and readable names of the curves, for menus |
| `toMarkers(doc, { kinds })` | `[{ kind: "region" | "marker", start, end?, name }]` from `sections`, `events`, `downbeats`, `onsets` |
| `curveAt(doc, name, t, fallback)` | a curve's value at time `t`, interpolated: for driving generator and effect parameters |
| `frames(doc, { fps, curves, scale })` | the curves once per video frame, each value the curve's mean over its frame: `{ fps, frames, curves: { name: [...] }, onsets, beats, downbeats, events }` (frame numbers). `scale` `"fixed"` (default: every curve 0..1 as the strip draws it), `"file"` (each curve from its 5th to 95th percentile in the file) or `"raw"` |
| `process(input, toolId, params)` | runs one of the effects bench tools: `{ outputs: [{ suffix, sampleRate, channels }], report }` |
| `tools()` | the tools and their parameters (id, label, range, default) |
| `combine(parts, opts)` | a document for the sum of several sounds, from their documents alone (no audio, no new analysis), for folder tracks, layered effects and stems. `parts`: `[{ doc, offset, gain }]` (seconds, dB). `opts`: `rate`, `duration`, `wave` (a real overview of the sum, instead of the estimate), `aligned`. `doc.combined` lists the parts and the rule used for each curve ([Combining](#combining-documents)) |
| `align(parts, opts)` | the parts on one time axis: per part its power per column and, when all have spectrograms, per column and band. For views that show which part carries what |
| `measureParts(parts, opts)` | measures of the whole around its main peak, from the documents: `rise` (s), `contrast` and `focus` (dB before and after the peak), `together`, `overlap`, `coverage`, `low`, `shared` (0..1), `tail` (s), `harshness`, and `scores` for the goals (`punch`, `size`, `clean`) |
| `arrange(parts, opts)` | searches offsets and gains for a goal (`"punch"`, `"big"`, `"clean"` or weights) and returns `{ baseline, candidates: [{ parts: [{ offset, gain }], score, measures, changes }], evaluated, ms }`, about 500 arrangements in 0.1 to 0.3 s. Parts with `lock: true` stay; without any, the loudest stays. A part may be trimmed with `start` and `end` (seconds of its document: the part of the file heard, as an editor's item that starts later in its file). `opts`: `range` (s, default 0.25), `gainRange` (dB, default [-6, 3]), `minOffset`, `maxOffset`, `count`, `seed`, `maxHarshness` |
| `view(doc, kind, opts)` | a view as numbers, for hosts that draw it themselves or measure it ([Views](#views)): `{ kind, rows, cols, values, yTicks, colAt(t) }`, or for the raster `timeRows` in place of `colAt`. `kind`: `"raster"` (`opts.curve`, `opts.bars` 1 or 4), `"tempo"` (`opts.cyclic`), `"lag"`, `"mod"`, `"scale"` (`opts.curve`); `null` when the document cannot give it |
| `localize(table, lang)` | shows the curve names, looks, legends and tools in another language; `table` is `dist/i18n/<lang>.json` (Czech, German, Polish, Russian, Spanish), `null` returns to English. Counts follow the language's plural rules (from `lang`, or the table's `lib.lang`). Documents are unaffected: only labels change |

**Profiles** (one core of the development machine, stereo 44.1 kHz; document size in brackets, measured with 0.3.0 on
`tools/profile.js`'s signals; the times were measured with 0.2.0):

| Profile | Computes | 2 s | 30 s | 120 s |
|---|---|---|---|---|
| `fast` | curves C1–C7, onsets, loudness summary, waveform overview | 0.13 s (25 KB) | 0.37 s (54 KB) | 1.3 s (151 KB) |
| `sfx` | + events with tags, NMF layers, asset checks, descriptors N1–N9, spectrogram, modulation spectrogram | 0.41 s (54 KB) | 1.5 s (154 KB) | |
| `music` | + beats, downbeats, sections, tempogram, lag view | 0.54 s (58 KB) | 1.7 s (172 KB) | 4.1 s (566 KB) |
| `auto` | `sfx` up to 10 s, `music` above | | | |

The first analysis at a new sample rate adds about 0.25 s of one-time calibration. The `sfx` and `music` documents
also carry a small mel spectrogram for the spectrogram layer: about 5.3 KB per second of sound up to 10 s (100 columns
per second) and 1.1 KB per second above (20 columns per second), and the modulation spectrogram (at most about 26 KB).
`analyze(..., { spectrum: false })` leaves both out; `fast` leaves them out unless `spectrum: true`. Music documents add
the tempogram (about 11 KB a minute) and the lag view (20 to 45 KB whatever the length) for the views of rhythm and
form.

**Combining documents.** Analyse the parts with the same `profile`, `assetClass` and `curveRate`. LUFS and the
spectrogram add as power and a part's gain moves them exactly; loudness follows from the summed LUFS; harshness is the
whole's loudness plus the parts' power-weighted harshness above their own loudness; activity, arousal, tension and
novelty take the strongest part; onset strength adds up; onsets, events and novelty ticks are merged (a part that starts
with sound gets an onset at its entry). The beat grid is the clearest part's, and sections, the tempogram, the lag view
and the modulation spectrogram are left out: they need the whole (their looks draw the waveform instead). On 14 sessions built from separate parts ([experiments/compose](../experiments/compose/README.md)) loudness and
the spectrogram matched the analysed mix closely, activity, arousal and harshness roughly (r 0.8 to 0.99), tension and
novelty less (0.72, 0.51), events poorly (F about 0.5): three layers struck together are one event in the mix. Where
the combined and the analysed whole differ is itself worth showing: it is where the parts interact.

**Searching arrangements.** Combining takes about a millisecond, so `arrange()` can try some 500 offsets and gains in a
fraction of a second (stochastic hill climbing from the current arrangement and from random ones, on the curve columns:
10 ms for sound effects) and return the best few that differ from each other. The goals are first heuristics, meant to
be tested by listening: *punch* favours a short rise, the layers starting together and sounding in the hit, a peak
that stands out and little masking; *big* favours a full spectrum, low end and a long tail; *clean* favours few shared bands with every layer still
in the hit. Each dB of gain change costs a little, so turning the other layers down is not a free win. Power sums cannot
see phase, so a host lines the chosen arrangement up to the sample (SFX Workbench's "Align hits"). Mixed and analysed,
the arrangements measure as predicted ([experiments/arrange](../experiments/arrange/README.md), 175 arrangements of 8
layered impacts): peak level r 0.99 (0.2 LU), rise 0.90, contrast 0.92, focus 0.95, spectral coverage 0.97; the search
ranks them as their mixes rank (median Spearman 0.92 to 0.95 per goal), and its best candidate beats a rough placement
in 23 of 24 cases. A file is analysed as heard with silence before and after it, so a clip's document is its share of
any mix it is placed in.

## The document (schema `playhead-analysis`, version 1)

| Field | Contents |
|---|---|
| `schema`, `schemaVersion`, `generator` | `"playhead-analysis"`, `1`, `{ name, version }` |
| `source` | `name`, `sampleRate`, `channels`, `duration` (s); the command line adds `path` |
| `profile`, `assetClass`, `guessedClass` | what was computed; the class used for the curves (`sfx`, `rhythmic`, `orchestral`, `ambience`…) |
| `summary` | `peakLufs`, `loudnessRange`, `soundStart`, `soundEnd`; with events also `peakDb`, `attack` |
| `curves` | `rate` (samples per second), `start` (0), then one array per curve, `null` where silent. 0–1 on fixed library-wide scales: `loudness`, `activity`, `arousal`, `harshness`, `tension`, `harmonicTension`, `surprise`, and `timbreHarshness` (the psychoacoustic annoyance factor behind `harshness`, from sharpness, fluctuation and roughness, without the loudness that `harshness` adds it to: harsh at any level, for a tint, a jagged shape or a tempogram of harsh hits); in LUFS: `lufs`; with descriptors also `n1Kurtosis`, `n2RepetitionHz`, `n4Velocity` (oct/s), `n5Cpp` (dB), `n5Coherence`, `n6Arrow`, `n7Surprisal`, `n8Recurrence`; `onsetStrength` (spectral flux, the beat tracker's input, 0–1 to its 99th percentile: where the hits and attacks are) and the same per band, `onsetLow`, `onsetMid`, `onsetHigh` (each to its own 99th percentile: the kick, snare and hat rows of a bar raster, `raster:onsetLow`); music profile also `pulseClarity` (how clearly a beat is felt, 0–1, from the tempogram's strongest periodicity); music profile also `structureNovelty` (Foote novelty, 0–1, values in silence too) and `localPulse` (PLP scaled by its clarity, 0–1). `n1Kurtosis` is drawn where the impulses are (each 0.5 s window's value given to its frames in proportion to their power), so it no longer rises half a window before an impulse; the descriptor summaries keep the window values. New curves are added without changing the schema version: read the ones you know and ignore the rest |
| `noveltyTicks` | times (s) of the strongest spectral surprises, the lab's novelty ticks (music and ambience; empty for sound effects) |
| `modulation` | `sfx` and `music` profiles: the modulation spectrogram, how strongly the level pulses at each rate over time. `rows` rates from `rateMin` (0.5 Hz) up, `perOctave` (6) to an octave, to 128 Hz; `columns` every `hop` s; `data` base64 of one byte per rate and column, column after column, slowest rate first: 0 for no data (silence, or a rate too slow for the sound's length), else 1 + 254 × the square root of the modulation depth (`scale: "sqrt"`; depth 1 is a level swinging fully at that rate). From the band envelopes (12 pairs of Bark bands at about 345 per second), each band's envelope spectrum over its mean, averaged over the bands by power, at three resolutions (windows of 3, 0.75 and 0.19 s for rates below 4 Hz, 4 to 24 Hz and above). At most 400 columns: up to about 26 KB |
| `spectrum` | `sfx` and `music` profiles: a mel spectrogram for drawing. `bands` (40), `fmin`, `fmax` (Hz), `columns` (as the curves), `dbTop` and `dbRange` (80 dB mapped to 0–255), `data`: base64 of one byte per band and column, column after column, lowest band first |
| `wave` | `columns`, `min`, `max`, `rms`: a waveform overview for thumbnails without decoding again |
| `onsets` | onset times (s), on the analysis's 11.6 ms frames (they come up to about 25 ms before the sound) |
| `attacks` | `sfx` and `music` profiles: one per onset, `{ t, band, bands }`: `t` the time to the sample where its level starts to rise (median error 0.5 to 0.7 ms on the bench, [experiments/bench](../experiments/bench/README.md)), `band` where it rises most (`"low"` below 200 Hz: kick, bass; `"mid"` to 2 kHz: snare, body; `"high"` above: hats, cymbals), `bands` the three shares. Use these for cuts and for timing |
| `events` | `start`, `end`, `decayEnd`, `peak`, `peakDb`, `tag` (Schaeffer-style, e.g. `N′`), `word` (e.g. `tonal hit`), `facture`, `mass`, `direction`, `f0`, `grains` |
| `layers` | NMF layers: `name`, `hz`, `share`, `start`, `end` |
| `issues` | asset checks: `severity` (`bad`, `warn`, `info`), `text` |
| `descriptors` | whole-file summaries of N1–N9: `kurtosis`, `repetition`, `events` (burstiness, b-value, temporal entropy), `motion`, `periodicity`, `arrow`, `interest`, `recurrence`, `decay` (`t60`, `logTauD`, `material`) |
| `rhythm`, `sections` | music profile: `tempo`, `reliable`, `clarity`, `beats`, `downbeats`, `beatsPerBar` (4, or 3 where the beats clearly fall in threes), `downbeatConfidence` (0–1: how far the chosen downbeat stands above the next best; low where beats 1 and 3 look alike), `meter` (`{ 3, 4 }`: the evidence for bars of 3 and 4 beats), `tempogram`, and with a steady beat the grid: `grid` (`[{ t, bar, pos, dev, band }]`: each attack's bar, its place in the bar in beats, e.g. `1.5` the "and" of 2 or `0.667` a swung 8th, and its deviation from that place in ms), `bars` (`[{ start, beat, tightness, offsets: { low, mid, high } }]`: the bar's grid, and per band the median deviation in ms; the grid is where the low band puts the beats, so `mid: 25` is a snare 25 ms behind the kick; `tightness` the spread in ms once each band's offset is taken out), `timing` (the medians over the bars), `swing` (the 8th-note swing ratio: 1 straight, 2 the triplet feel, 3 dotted; null with too few single off-beats); `[{ start, end, label }]`. `tempogram`: how strongly each tempo is present, one column per 8 s window every `hop` s from `start`: `bins` rows from `bpmMin` (30 BPM; 40 in documents of Playhead 0.3) up, `perOctave` (24) to an octave, `peak` (the strongest value, mapped to 255), `data` base64 of one byte per bin and column, column after column, slowest first. The autocorrelation of the onset envelope with its mean removed, so only periodicity counts, faded where the onsets are weak; a tempo and its half show alike (about 17 KB per minute) |
| `repetition` | music profile: how alike each moment is to the moment a lag earlier (the time-lag form of the self-similarity matrix behind `sections`). `unit` (`"beat"`, or `"time"` without a steady beat), `unitSeconds`, `columns` with their start `times` (s), `lags` rows, row `l` a lag of `(l + 1) × lagStep` units (with beats `lagStep` is 1, 2, 4… so rows are whole bars from 4 beats up), `data` base64 of one byte per lag and column, column after column, shortest lag first: 0 for no data (before the start of the sound), else 1 + 254 × similarity (at most 256 columns and 128 lags, 20 to 45 KB) |
| `timing` | `ms` taken |

Fields not computed by a profile are `null`. Version 1 may gain fields; a change that removes or redefines one raises `schemaVersion`.

## Looks

A strip is a list of layers on one time axis; a **look** is a named list, and a **look code** is the same list as short
text that hosts can store, offer in a menu, paste between apps and send with feedback.

| Layer | Code | Draws |
|---|---|---|
| waveform | `wave` or `wave:<curve>` | the waveform, plain or tinted along the theme's ramp (`waveRamp`, several stops, or `waveLow` → `waveHigh`) by a 0–1 curve; over a spectrogram, its outline |
| spectrogram | `spec` | the document's mel spectrogram (40 bands, 40 Hz–16 kHz, low at the bottom, colours from `specRamp`) |
| line | `line:<curve>` | a curve over the waveform (descriptor curves on their 5th–95th percentile) |
| lane | `lane:<curve>` or `lane:<curve>~signed` | a curve in its own lane under the waveform (up to three lanes share about half the height). `~signed` is for change curves such as `structureNovelty`: drawn up where the level rises across the change (an entry), down where it falls (a fall in level, a break into silence) and centred where only the material changes, so a break never reads as "more" |
| sections | `sections` | boundaries and letters (music profile) |
| marks | `ticks:<kinds>` | `events`, `onsets`, `beats` under the waveform, `downbeats` as ticks with faint bar lines through the strip, and `novelty` (the strongest spectral surprises) from the top edge, joined with `+`. Beats and bar lines are faint where the beat is not steady and missing for sound effects (the legend says so) |
| outline | `outline` | the ordinary peak waveform as a contour over what is drawn before it (theme key `outline`) |
| height | `sculpt:<curve>` | reshapes the waveform layer: its envelope follows the curve while its detail stays. `sculpt:loudness` gives a waveform as loud as it sounds (a dB-like scale); the outline layer keeps the ordinary peaks for comparison |
| form | `form:lanes` (default) or `form:overlay` | lanes each in their own band under the waveform, or all of them drawn on the waveform itself (light fill and a contour, so the waveform stays visible) |
| shape | `shape:base` (default), `shape:mirror`, `shape:horizon`, `shape:line` | how a lane's curve is drawn: filled from the bottom; mirrored around the middle, like a waveform; a horizon chart (folded into three bands of rising strength, compact at small heights); a line |
| tempogram | `spec:tempo` or `spec:tempo~cyclic` | in the spectrogram's place: how strongly each tempo is present over time, 30 to 590 BPM, fast at the top; `~cyclic` folds the octaves onto 80 to 160 BPM, so a tempo, its half and its double share a row (music profile) |
| lag view | `spec:lag` | in the spectrogram's place: how alike each moment is to the moment a lag earlier, the lag going up; a bright horizontal line is a repeat (music profile) |
| modulation | `spec:mod` | in the spectrogram's place: how fast the level pulses and how strongly, 0.5 to 128 Hz, fast at the top: rhythm, then fluctuation, tremolo and flutter, then roughness (sound effects and music) |
| scalogram | `scalogram:<curve>` | in the spectrogram's place: the periodic patterns in a curve, fast at the top, slow at the bottom, fainter near the ends (any profile) |
| bar raster | `raster:<curve>` or `raster:<curve>~4bars` | a row per bar (or per 4 bars), top to bottom, coloured by a curve; takes the whole strip, with `sections` as rules between rows and `ticks:onsets`, `events` or `novelty` as dots where they fall in the bar (music profile) |

Without a waveform or spectrogram the lanes share the whole strip, so curves can stand in for the waveform
(`shape:mirror,lane:loudness,lane:activity,lane:harshness`).

Ready-made looks (`Playhead.looks`): `auto` (the default: by profile), the two references `plain` (waveform only) and
`spectrum` (spectrogram), `structure` (`wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats`),
`rhythm`, `tension`, `events`, `lanes` (three separate lanes, no colour mixing), `shapes` (curves mirrored like
waveforms, no waveform), `overlay` (curves drawn on the waveform), `horizon` (horizon lanes) and `specstructure`
(spectrogram with sections and structural change), `overview` (music: curves only, overlaid and mirrored, with
sections, bar lines and novelty marks), `hits` (onset strength and local pulse under the waveform), two sound-effect
looks suggested by testing, `character` (`form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n1Kurtosis,ticks:onsets`:
where the hits are, how harsh, how impulsive) and `surprise` (the same with spectral surprise in place of
impulsiveness), `sculpted` (`sculpt:loudness,wave:harshness,outline,ticks:events+novelty`: the waveform as loud as
it sounds, coloured by harshness, over the ordinary peak outline), and four views of rhythm and form: `raster`
(`raster:onsetStrength,sections`), `tempogram` (`spec:tempo,ticks:downbeats`), `repetition` (`spec:lag,sections`) and
`rhythms` (`scalogram:onsetStrength`), and for any sound `modulation` (`spec:mod`).
`Playhead.lookFits(doc, look)` says whether a look shows something for a document (every curve it uses is there and not
empty), for menus that hide looks a file cannot use. A layer whose curve is not in the document is left out and the
legend says so (`structure` and `rhythm` need the music profile).

```js
const r = Playhead.drawStrip(g, doc, { look: "wave:harshness,lane:activity,ticks:events", theme });
legendElement.textContent = r.legend;      // "colour: harshness · lane: activity · marks: events"
```

### Views

Five views read rhythm, texture and form where the waveform shows only amplitude. Each draws in the spectrogram's place (the
raster takes the whole strip), in the theme's `specRamp`, with its axis along the right edge. Where a document cannot
give one (a beat view of a sound effect), the plain waveform is drawn instead and the legend says why.

- **Bar raster** (`raster:<curve>`): time folded into bars, like a drum machine's pattern view or a DJ's beat grid.
  Rows are bars cut at the downbeats (gaps where the beat dropped out are filled and both ends extended with the median
  bar, so every moment is in a row); left to right is the position in the bar, with a faint beat grid. Bars that hit the
  same way line up in columns; fills, breaks and drops are rows that differ. `drawStrip` returns
  `raster: { rows: [[start, end], ...] }` for the rows drawn, so a host can seek by row and place its cursor at a
  moment's position in its bar (the Playhead app does both).
- **Tempogram** (`spec:tempo`): drawn from `rhythm.tempogram`. A steady beat is a bright line, a tempo change bends it,
  double and half tempo are fainter lines.
- **Playhead tempograms** (`spec:tempo~of:<curve>`, `spec:tempo~of:speed`, `spec:tempo~w:<curve>`; they combine, and
  work with `~cyclic`): a tempogram is the autocorrelation of whatever curve it is fed, so it can be fed a descriptor.
  - `of:<curve>`: the tempogram of the curve's rises (above their 0.5 s local mean), computed when drawn by the same
    method as the analysis's (8 s windows every 0.5 s, the mean removed, 30 to 590 BPM, 24 rows an octave). It answers
    "how periodic are the rises in timbre harshness (or loudness, tension, impulsiveness)?": harsh hits on the off-beats, a
    tension that swells every two bars, a layer with its own period beside the beat. Any profile, for sounds of 8 s or
    more.
  - `of:speed`: the tempogram of how fast all the descriptors change together. The curves (loudness, timbre harshness,
    tension, activity and four of the n-descriptors) are each divided by their interquartile range, and the length of
    their joint step is a novelty curve for every kind of change at once: the descriptors seen as one curve in feature
    space, whose speed is a multi-descriptor flux.
  - `w:<curve>`: the tempogram drawn weaker where the curve is low (its mean over each 8 s window, from its 5th to its
    95th percentile in the file). A weak column goes toward one grey, not toward the ramp's black (a value-suppressing
    palette, Correll, Moritz and Heer 2018), so "little of the curve here" stays apart from "no beat here".
  - What they never do: move a ridge along the tempo axis. Multiplying the onsets by a fast descriptor before the
    analysis makes false ridges at the descriptor's own rates (a product is a convolution of spectra: a 7 Hz harshness
    tremolo under 100 BPM puts ridges near 320 and 520 BPM); warping time by a descriptor before the analysis makes a
    steady tempo drift; bending the tempo axis overwrites the most exact channel, position, with something that is not
    tempo. Background: Foote's beat spectrum of any feature, Pampalk's fluctuation patterns, joint time-frequency
    scattering (Andén, Lostanlen and Mallat) as the general theory. A display-only warp of time by a descriptor (with
    ticks in real seconds) is a further option, not drawn yet.
- **Lag view** (`spec:lag`): drawn from `repetition`, with the median likeness set to black so repeats stand out. A
  bright horizontal line from some moment on means the music now repeats what played that lag before; its height says
  how long before (in bars, with a beat).
- **Modulation spectrogram** (`spec:mod`): drawn from `modulation`, from the image's median depth (black: the
  texture every moment has, such as the envelope fluctuation of noise) to its 99th percentile (white). A level that
  pulses at one rate is a bright row at that rate: the beat and its subdivisions below 4 Hz, tremolo, flutter, engine
  and rotor rates from 4 to 20 Hz, roughness (growls, buzzes, beating partials) above. It reaches rates the curves
  cannot (they have 20 or 100 samples a second), and it is computed from the audio at analysis, so it costs about 60 ms
  a file whatever its length.
- **Scalogram** (`scalogram:<curve>`): a continuous wavelet transform (Morlet, ω₀ = 6) of any curve, computed when drawn
  (about 35 ms for a minute at 20 curve samples per second): periods from four curve samples to a fifth of the sound,
  8 rows an octave, power divided by scale so that equal swings read equally at every period (Liu et al. 2007), 30 dB
  from the peak to black. Cells outside the cone of influence (Torrence & Compo 1998), where the period is longer than
  the sound around the moment, are drawn faint. In music the beat, bar and phrase are marked on its axis; in effects it
  shows flutter, tremolo and other modulation of the curve. A research view: what it shows best is still to be learnt.

`Playhead.view(doc, kind, opts)` gives the same images as numbers (row 0 at the top, values 0 to 1, -1 where there is
no data; for the tempogram `opts.source` and `opts.weight` as above, the weight given back as `suppress`, one value per
column). The tests check them on signals with a known answer: the raster's rows are the cue arc's 2 s bars with its
hits on the beats, the tempogram peaks at its 120 BPM and follows the tempo ramp from 96 to 144 BPM, the lag view lights
up 40 s back where the groove returns, the scalogram of a tremolo finds 0.125 s and 0.333 s, and the modulation
spectrogram of noise swinging at 4, 16 and 60 Hz finds each rate within a row while steady noise stays dark.

Hosts should draw only through `drawStrip` and take the legend from its return value, so a new Playhead build
changes the look everywhere by replacing one file. The Playhead app's composer ("Compose your own") builds look codes
and links to a feedback form (`.github/ISSUE_TEMPLATE/look-feedback.yml`, prefilled with the code); hosts can link to
`https://github.com/eigensoundlab/playhead/issues/new?template=look-feedback.yml&look=<code>&app=<host name>`.

## Recipes

These are starting points: the library, command line and document are tested here, the host-side code below is not yet tested inside each host.

### SFX Workbench (browser, ES modules)

Implemented in SFX Workbench 0.6.0 (optional, off by default): a Playhead view of the source and output lanes, Playhead
events as accent anchors next to the built-in transients, a Reaction engine whose medium follows the action's level or
a Playhead curve, morph amounts that follow a curve of A, and a Playhead check of every generated sound. The notes
below are the general recipe.

Copy `dist/playhead-core.mjs` to `src/vendor/`. Analyse in a module worker, as `examples/analysis-worker.mjs` does; for the single-file offline build, either create the worker from a Blob of the bundle's text, or analyse short sounds on the main thread (a 2 s sound takes about 0.4 s; the analysis yields to the page regularly).

```js
// src/app/playhead.js
import Playhead from '../vendor/playhead-core.mjs';
export const analyse = (chs, sr, name) => Playhead.analyze({ sampleRate: sr, channels: chs }, { profile: 'sfx', name });
export function drawPlayhead(canvas, doc, from, to) {
  const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
  Playhead.drawStrip(g, doc, { from, to, curve: 'activity', colour: 'harshness' });   // a third display mode next to waveform and spectrum
}
```

Uses that fit the Workbench:
- **Accents from events.** `doc.events` (start, peak, tag, f0) and `doc.layers` are anchor points for `renderAccents()`: an impulse (`′`) gets a slap or debris, an iterative event (`″`) a ring on every grain, a sustained one a swell.
- **Action and reaction.** For an object moving through a reacting medium, the object's analysis drives the medium: its events trigger the medium's response, `n4Velocity` (spectral glide, oct/s) steers the medium's filter or pitch the way a pass-by does, `activity` sets the density of a texture, `n6Arrow` tells a hit (positive) from a swell (negative).
  ```js
  const at = (name, t, fb = 0) => Playhead.curveAt(doc, name, t, fb);
  for (const e of doc.events) medium.excite(e.start, e.facture === 'impulse' ? 'slap' : 'swell', e.peakDb);
  textureParams.density = t => 0.2 + 0.8 * at('activity', t);
  filter.cutoff = t => 2000 * Math.pow(2, at('n4Velocity', t) * 0.25);
  ```
- **Checking generators.** The decay measure (N9) reads the material back from a generated impact: in a first test, the impact engine's loss factors predicted `log τd` within 0.02–0.08 for steel, brass, glass, aluminium, ice, ceramic and wood, in the right order. Very damped materials (plastic, stone, cardboard, rubber) decay faster than the 0.12 s the measure needs.
- **Effects bench tools** through `Playhead.process()`: de-harsh, layer remix, attack and body, tension shaper, loop maker, variations.

### kurator (Python server, JavaScript front end)

Two parts:
1. **Server, for the library.** Run the executable on each sound (the `fast` profile for browsing, `auto` on demand) and store the document next to the existing wave data. kurator already decodes with soundfile, so it can pipe samples in and needs no ffmpeg:
   ```python
   import json, shutil, subprocess
   from . import audio_analysis

   def playhead_doc(path: str, profile: str = "fast") -> dict | None:
       exe = shutil.which("playhead")
       if not exe:
           return None
       x, sr = audio_analysis.mono(path, rate=44100)          # or the stereo blocks from audio_analysis.blocks()
       r = subprocess.run([exe, "analyze", "-", "--sr", str(sr), "--channels", "1", "--profile", profile, "--name", path],
                          input=x.astype("<f4").tobytes(), capture_output=True, timeout=600)
       return json.loads(r.stdout) if r.returncode == 0 else None
   ```
   Descriptor summaries then become sort keys and filters (impulsive, repetitive, metal-like, long ring, harsh), and `wave` plus two curves are enough to draw a thumbnail without decoding again.
2. **Front end, for the viewer.** Serve `playhead-core.mjs` from `kurator/static/vendor/`, add a "Playhead" mode to `WAVE_MODES` in `waveview.js`, fetch the stored document from a new endpoint (for example `/api/audio/{id}/playhead`) and draw it with `drawStrip()` at the viewer's zoom (`from`, `to`).

### REAPER (Lua scripts and the executable)

[`integrations/reaper/`](../integrations/reaper/README.md) is a ReaScript package (ReaPack headers included) that
runs the executable without blocking REAPER and keeps the documents in a cache. Its actions analyse the selected
items, add events and onsets as take markers and sections and downbeats as regions and markers, write curves as
automation on a small JSFX (Playhead Control) whose parameters can drive any plug-in through parameter links or
MIDI CC, render the effects bench tools as new takes, and draw the item in any look in a dockable strip window,
the views of rhythm and form included (the bar raster maps the cursor and clicks through its rows). All of them follow
the take's start offset, playback rate, loop and reversed sections. Its Lua core (document reader, time mapping, views,
strip renderer, command lines) is tested against the documents, `Playhead.view` and `drawStrip` here.

### Unity (editor import, runtime curves and events)

Analyse in the editor and ship the documents; the game only reads them, which costs almost nothing at runtime. Unity's `JsonUtility` cannot hold `null`, so ask for numbers in silent places with `--fill-null 0`:

```csharp
// Assets/Editor/PlayheadImport.cs
using System.Diagnostics; using System.IO; using UnityEditor; using UnityEngine;
public static class PlayheadImport {
    const string Exe = "playhead";   // or the full path to playhead.exe
    [MenuItem("Assets/Playhead/Analyse selected audio")]
    static void Analyse() {
        foreach (var clip in Selection.GetFiltered<AudioClip>(SelectionMode.Assets)) {
            var asset = AssetDatabase.GetAssetPath(clip);
            var psi = new ProcessStartInfo(Exe, $"analyze \"{Path.GetFullPath(asset)}\" --fill-null 0") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi); var json = p.StandardOutput.ReadToEnd(); p.WaitForExit();
            File.WriteAllText(Path.ChangeExtension(asset, ".playhead.json"), json);
        }
        AssetDatabase.Refresh();
    }
}
```

```csharp
// Runtime: curves and events of the playing clip (TextAsset = the .playhead.json)
using UnityEngine; using UnityEngine.Events;
public class PlayheadDriver : MonoBehaviour {
    [System.Serializable] public class Curves { public float rate; public float[] activity, tension, harshness; }
    [System.Serializable] public class Ev { public float start; public string tag, word; }
    [System.Serializable] public class Doc { public Curves curves; public Ev[] events; }
    public AudioSource source; public TextAsset analysis; public UnityEvent<string> onEvent;
    Doc doc; int next; float last;
    void Awake() { doc = JsonUtility.FromJson<Doc>(analysis.text); }
    public float At(float[] c) => c[Mathf.Clamp((int)(source.time * doc.curves.rate), 0, c.Length - 1)];
    void Update() {
        float t = source.time; if (t < last) next = 0; last = t;                   // looped or restarted
        while (next < doc.events.Length && doc.events[next].start <= t) onEvent.Invoke(doc.events[next++].word);
        // e.g. camera shake from impacts, rumble from activity, music intensity from tension:
        // shake.amplitude = At(doc.curves.activity);
    }
}
```

The same documents give adaptive music its section and downbeat times (transitions on bar lines), and give mixing its trigger curves (duck the music under impacts, a de-harsh-style band cut that follows `harshness`).

### Audio and video editors (markers)

`playhead markers` reads an audio file or a `.playhead.json` document (no second analysis) and writes the sections,
events, downbeats or onsets (`--kinds`) in an editor's own format:

| Editor | Command | Import |
|---|---|---|
| Audacity | `--format audacity > labels.txt` | File > Import > Labels: point labels for events and bars, region labels for sections |
| DaVinci Resolve | `--format edl --fps 25 > markers.edl` (`--start-tc` if the timeline does not start at 01:00:00:00) | Timeline > Import > Timeline Markers from EDL: sections as blue markers with their duration, events and bars as yellow ones |
| Premiere Pro, Final Cut Pro, Resolve, Shotcut, Kdenlive | `--format srt > sections.srt` | import as captions: a caption track that names each section or event in time |
| REAPER | the [REAPER actions](../integrations/reaper/README.md) | take markers, project markers and regions, clipped to what each item plays |
| spreadsheets, scripts | `--format csv` / `tsv` / `json` | `kind, start, end, name` |

The EDL and SRT formats follow what those editors export; please report an editor that reads them differently.

### VJ, 3D and game tools (frames)

`playhead frames` gives the curves once per video frame, so a visual can follow the sound without analysing it live:
each frame's value is the curve's mean over that frame (nothing aliased at 24, 30 or 60 fps), on 0..1 as the strip
draws it, plus columns that are 1 on the frames with an onset, a beat or a downbeat. For a visual, `--scale file`
spreads each curve over the whole 0..1 range (from its 5th to its 95th percentile in the file), as a VJ would set a
gain; leave onset strength at the default scale, which keeps its peaks apart. `--curve-rate 100` when analysing gives
the curves finer steps than the default 20 per second for long files.

```sh
playhead frames hit.wav --fps 60 --curves loudness,onsetStrength,harshness,tension > hit.csv
playhead frames cue.playhead.json --fps 24 --curves loudness,tension --format blender > cue_keys.py
playhead frames cue.wav --fps 60 --format json > cue.frames.json
```

- **TouchDesigner**: load the CSV into a Table DAT and turn it into channels with a DAT to CHOP (first row as names);
  a Lookup CHOP or the timeline frame picks the row. Onset, beat and downbeat columns trigger with a Trigger CHOP.
- **Blender**: run the script in the Text Editor. It keys each curve as a custom property of an Empty named after the
  sound (one key per frame from frame 1) and sets the scene's frame rate; drive any property from one (Copy as New
  Driver, then Paste Driver).
- **Unreal Engine**: import the CSV as a DataTable (the frame column is the row name), or read the JSON; sample the row
  at `AudioComponent` time × fps. **Unity**: the JSON or the document itself (see Unity above).
- **After Effects, Resolume and others**: the CSV through the host's expression or script import.

Which curves suit visuals best is an open question; [experiments/visuals](../experiments/visuals/README.md) compares
Playhead's curves with the usual drivers (level, three FFT bands, beat) on measures of what a visual does with them.

### Markers and automation as a research area

Markers and automation carry more than positions: a marker is a decision (cut here, this is a section, this hit
counts), an envelope is a judgement over time (how harsh, how tense). Playhead writes both from the same analysis, so
they can be compared with what editors place by hand. Open questions worth testing: whether Playhead's events agree
with where editors cut sound effects (precision and recall against hand-placed cuts, with a tolerance of a few
milliseconds); whether its sections agree with the regions mixers and editors draw; whether curves written as
automation (harshness to a shelf, tension to a reverb) save the passes a mixer would otherwise ride by hand, and
sound as good in a blind test; and whether a tempo map from a recording's bars keeps edits musical where a fixed grid
does not.

## Limits

- Whole-file analysis: the sound must fit in memory (stereo 44.1 kHz is about 21 MB per minute).
- Mono and stereo; further channels are ignored.
- Decays shorter than 0.12 s get no material estimate.
- NMF layers are at most three, and layer and event analysis is meant for sounds up to a few minutes.
- The browser decodes only what it supports (Ogg Vorbis needs Safari 18.4 or later).
