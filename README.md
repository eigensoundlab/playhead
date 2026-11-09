# Playhead

**A waveform plus one or two lines that show what the waveform can't: intensity, busyness, tension, beats, sections and the kind of event, for music and game sound effects. The same analysis then drives editing, mixing and mastering tools.**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23932625.svg)](https://doi.org/10.5281/zenodo.23932625)
[![Paper](https://img.shields.io/badge/paper-10.5281%2Fzenodo.24008127-blue)](https://doi.org/10.5281/zenodo.24008127)

Live: <https://eigensoundlab.github.io/playhead/> · Author: Daniel Sandner ([ORCID 0000-0002-1041-814X](https://orcid.org/0000-0002-1041-814X)) · Licence: Apache-2.0

Playhead is a research prototype. It runs entirely in the browser: audio you drop in is decoded and analysed locally and never leaves the tab. A Unity editor preview is the intended first integration.

## What it shows

| Lane | What it measures | Basis |
|---|---|---|
| C1 Loudness | Short-term loudness in LUFS | ITU-R BS.1770-5 K-weighting; ISO 532-1 sone loudness |
| C2 Activity | How busy the sound is: onsets and spectral change, not level | Log-mel spectral flux (SuperFlux-style) plus event density |
| C3 Arousal | Energy and excitement composite | Loudness, activity, sharpness |
| C4 Harshness | Loudness weighted by how unpleasant it is | Zwicker psychoacoustic annoyance: DIN 45692 sharpness, roughness, fluctuation strength |
| C5 Tension | Build-ups and releases | Farbood-style trend salience of loudness, sharpness, roughness and (music) harmonic tension, mixed with loudness |
| C6 Harmonic tension | Dissonance and distance from key | Tonal interval vectors (TIV) |
| C7 Surprise | How unexpected each moment is | Feature novelty against recent context |
| Rhythm | Tempo, beats, downbeats, pulse clarity | Autocorrelation tempogram, Ellis dynamic-programming beats, predominant local pulse |
| Structure | Sections and repeats (A B A …) | Foote checkerboard novelty on a self-similarity matrix |
| Sound effects | Events, Schaeffer-style tags (impulse / iterative / sustained), layers, pitch, attack, QA problems | YIN, Timbre Toolbox descriptors, KL-NMF, Peeters–Deruty profiles |
| Views of rhythm and form | Bar raster, tempogram, lag view, modulation spectrogram, curve scalogram; spectral playheads (bar spectrum, spectral groove, metrical spectrogram) | Beat-synchronous folding, of curves and of the spectrum in octave groups; autocorrelation tempogram (Grosche & Müller); time-lag self-similarity (Goto); modulation spectrum (Atlas & Shamma); Morlet wavelet with cone of influence (Torrence & Compo) |

Five combined preview designs (D1–D5) put the most useful of these onto one strip. The library view uses D5 for sound effects and D4 for music.

### Cross-field descriptors

Nine further rows borrow measures from other fields (`src/descriptors.js`). Most have a value fixed by mathematics for noise, a steady tone or time reversal, and the tests check exactly that rather than thresholds tuned on test signals.

| Row | Measure | Borrowed from | Analytic reference (tested) |
|---|---|---|---|
| N1 Impulsiveness | Spectral kurtosis, per band | Machine diagnostics | 0 for Gaussian noise, −1 for a steady tone |
| N2 Repetition rate | Squared-envelope spectrum, confirmed by autocorrelation; experimental speech-rate modulation (3–7 Hz vs 0.5–2.5 Hz per octave, which did not separate single speech clips from music) | Machine diagnostics; speech science | rate of an amplitude-modulated noise; ×1.06 when played 6 % faster; none for noise or a tone |
| N3 Event statistics | STA/LTA trigger, burstiness, Gutenberg–Richter b-value, temporal entropy | Seismology; ecoacoustics | burstiness −1 periodic, ≈0 Poisson, > 0 clustered; Aki b-value of a known distribution |
| N4 Spectral motion | Signed 1-D Wasserstein velocity on a log-frequency axis (the rate of change of the spectral centroid there); the unsigned remainder shows reshaping | Applied mathematics | a 2 oct/s sweep reads 2.00 oct/s, its reverse −2.00 |
| N5 Periodicity | Cepstral peak prominence; magnitude-weighted phase coherence | Voice science | phase coherence 1 for a tone, ≈0 for noise |
| N6 Arrow of time | Third-moment asymmetry of the log envelope | Statistical physics | ≈0 for Gaussian noise; exact sign flip under reversal |
| N7 Interest | Predictive information rate and learning of an online Markov model on timbre symbols | Information dynamics | 0 for iid and deterministic sequences; h(a²) − h(a) for a known chain |
| N8 Recurrence | Recurrence rate, determinism, laminarity on timbre and harmony | Nonlinear dynamics | a repeated phrase recurs, distinct notes do not; held states laminar |
| N9 Decay and material | Schroeder band decays, Klatzky damping τd = f/b | Room and impact acoustics | modal glass, wood and metal recovered; unchanged when played faster |

A "Descriptor tour" signal (CC0) in the lab plays each reference case in turn, so every row can be seen doing what the maths says.

## Analysis-driven tools

| Tool | What it does |
|---|---|
| Clean up for export | Removes DC, rebuilds clipped peaks, trims silence, adds fades, folds identical channels to mono, normalises |
| De-harsh | Suppresses narrow 0.8–10 kHz resonances and tilts the top while the annoyance model is high: on the harshest moments of the file (default), only on sounds harsh in absolute terms, or always. The detector can be switched to the band level, which turns it into a conventional dynamic EQ for comparison. Also renders what was removed |
| Layer remix | Rebalances NMF layers (sub, body, ring, debris) with soft Wiener masks |
| Attack and body | Median-filter harmonic/percussive split with separate levels |
| Tension shaper | Turns the tension curve into gain and brightness automation |
| Loop maker | Finds the best-matching loop points (on downbeats when the beat is clear) and renders a click-free seam |
| Variations | Makes game-ready variants: layer balance, grain order, small pitch changes |

Every result is re-analysed, so the bench shows what changed (loudness, harshness, layer shares, loudness range, problems) next to an A/B player with its own playhead and a WAV download.

### Tools no EQ can copy

The bench's first tools mostly turn frequencies up and down at the right moments, which a good EQ can approach (the
shares above). Three newer tools do what an EQ cannot, because they follow the events the analysis finds:

| Tool | What it does | Change (dB) | Static EQ | Dynamic EQ | Ideal automation |
|---|---|---|---|---|---|
| Reverb on the tails | reverb sent only from each hit's peak to the end of its decay; attacks stay dry | 0.9 | 0% | 57% | 38% |
| Drive the hits (attacks) | saturation on the events only, held at the original level, so only the harmonics change | 0.7 | 39% | 69% | 47% |
| Drive the hits (bodies) | the same after each peak | 0.4 | 16% | 68% | 35% |
| Ring time ×2 | each event rings twice as long, relative to its own peak (T60 0.066 → 0.128 s on the glass hit) | 2.0 | 36% | 85% | 89% |
| Ring time ×0.5 | damped (T60 0.066 → 0.038 s) | 1.6 | 52% | 79% | 79% |
| *De-harsh, for comparison* | | 1.9 | 83% | 91% | 96% |
| *Layer remix (sub −12 dB)* | | 10.8 | 98% | 99% | 98% |

Medians over five built-in sounds (glass, pistol, door, footstep, sword), the same measure as above; a first look, not
a corpus result. Reverb on the tails and the drive change what no EQ can (new energy after the sound, new harmonics).
Ring time is mostly within reach of an ideal level-driven dynamic EQ on single hits; its point is the target (a decay
the material descriptor N9 reads), which no ordinary EQ offers.

### Levelling and stereo, guided by the events

| Tool | What it does | Measured |
|---|---|---|
| Level the events | One gain per event (footsteps, impacts, a burst of shots), held from just before its start to the end of its decay: automatic clip gain | At the evenness a compressor reaches, attacks keep their crest (the compressor takes 4–11 dB off) and the background stays still (the compressor pumps 1.5–3.8 dB). It also goes further: 2–3.5 dB spread where a 40:1 compressor stops at 5–7 dB. [experiments/compression](experiments/compression/README.md) |
| Fold to mono | Per frequency, turns the right channel to the left's phase before summing and keeps the level per channel; each attack is folded in the time domain with its own delay and polarity, so there is no pre-echo. The report names the bands and events a plain (L+R)/2 would cancel, which doubles as a mono-compatibility check; the plain sum is rendered too | Spaced pair 2 ms apart: worst third-octave −13.5 dB with a plain sum, 0.0 dB folded. Inverted layer: −25 / −1.6 dB. Stereo reverb tails: −1.9 / −0.6 dB. Pre-echo before the attacks as in the source |
| Widen the tails | Adds a decorrelated copy (velvet-noise decorrelator) to the side only after the attacks, at the sound's own level, with the lows centred. Only the side changes, so (L+R)/2 is the original, sample for sample | No side signal on the attacks; channel correlation where widened 0.5 at 60% width and 0 at 100% (glass, sword) |

Together the last two make a round trip: widening a mono sound and folding it back returns the original exactly, and
a stereo file that folds badly is caught by the fold's report before it ships.

### Time, guided by the onsets

| Tool | What it does | Measured |
|---|---|---|
| Stretch keeping the attacks | Changes the length (×0.25 to ×4) without changing the pitch. Playhead's onsets (or its event starts), each refined to the sample where the level starts to rise, mark the attacks; the first 30 ms of each are copied as they are and placed at onset × length, and only the sound between them is stretched (WSOLA). A plain stretch is rendered beside it | Five decaying hits ×2 and ×0.5: every attack within 1 ms of onset × length and copied sample for sample; the plain stretch moves them by up to 25 ms, smears or doubles them, and loses some when shrinking hard |

## Using Playhead in other applications

The analysis is also a library and a command line, so other tools can use it ([docs/INTEGRATION.md](docs/INTEGRATION.md)):

```js
import Playhead from "./playhead-core.mjs";            // dist/, or the script build playhead-core.js
const doc = await Playhead.analyze({ sampleRate, channels }, { profile: "auto" });   // plain JSON, schema playhead-analysis v1
Playhead.drawStrip(canvas.getContext("2d"), doc);      // the strip, in a page or an OffscreenCanvas
```

```sh
playhead analyze sound.wav > sound.playhead.json       # one executable per platform, no Node needed
playhead markers song.wav --kinds sections,downbeats   # tab-separated regions and markers for editors
playhead process shot.wav --tool layers --param gains=-12
playhead cues rifle.wav --preset weapon > rifle.cues.json   # cues for a game engine (docs/GAMES.md)
playhead levels Audio/SFX --out Audio/SFX/playhead-levels.json --report levels.html   # levels, groups, outliers (docs/LEVELS.md)
```

**Looks.** What goes on the strip is a list of layers (a plain or coloured waveform or a spectrogram behind, a line, up
to three curves, sections and marks), written as a short look code such as
`wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats`. Curves can sit in separate bands or be
overlaid on the waveform, drawn from the baseline, mirrored like a waveform, as horizon charts or as lines, and without
a waveform they take the whole strip. The app's **Compose your own** section builds a look and previews it above the
ordinary waveform and spectrogram of the same file; the same code works in every host that draws with `drawStrip`, and
the feedback link sends it with your notes. Structural change is drawn signed: up for an entry, down for a fall in
level or a break into silence.

**Views of rhythm and form.** Several looks put something other than amplitude on the strip. The **bar raster** folds time
into bars, a row per bar like a drum pattern, so bars that hit alike line up and fills and drops stand out (click a row
to play from there). The **tempogram** shows which tempi are present over time, the **lag view** where the music repeats
what played some bars before, the **modulation spectrogram** (for any sound) how fast the level pulses, from the beat
through tremolo and flutter to roughness, and the **scalogram** (a research view) the periodic patterns in a curve:
beat, bar and phrase in music, flutter and tremolo in effects. Three **spectral playheads** put the spectrum on the beat
grid: the **bar spectrum** (a row per bar, a column per 16th, low red, mid green, high blue), the **spectral groove**
(the same in attacks: the drum pattern of every bar, read from the mix) and the **metrical spectrogram** (per octave
band and bar, whether its attacks keep to the bar, the beat, 8ths or 16ths: which part of the spectrum carries which
level, and when that changes). `Playhead.view` gives them to other hosts as numbers.

**Audiovisual Playhead.** [experiments/av](experiments/av/README.md) draws one scene twice from the same sound, with
WebGPU or WebGL 2, by the same rules: once on the usual audio-reactive signals (level, analyser bands, band beats),
worked out live, once on Playhead's analysis (hits per band, the bar, the spectrum on the grid, sections, builds and
drops, slides and vibrato, a sound's boom and its after-effect, distortion, pass-bys), known in advance, each with a
timeline of what it detected. Three demos (a dance arrangement, a melodic piece, a sound-design reel) and three scenes
(rings, a ribbon, a forge). The rules are edited on the page (on a high hit throw sparks, darken for the two bars
before a drop, raise smoke while a shot rings out) and export as a **cue sheet** for game engines:
`Playhead.cues` and `playhead cues` make the same from any document ([docs/GAMES.md](docs/GAMES.md): Unity, other
engines, sound-effect cues).

**Levels for many files.** `playhead levels` measures a folder of sound effects or recordings (peak, true peak, RMS,
LUFS-I, the loudest 0.4 s and 3 s, over the file, the sounding span, the loudest event and each event), applies a
project's tag rules (a group sets an offset, a modifier adds one, a note asks for checks) and settings (measure,
target, amount, depth, limits), and writes one gain per file into a manifest, `playhead-levels.json`, without touching
the files. Its report lists each group's spread and outliers, the files to check (clipping, DC, clicks at the start,
wrong sample rate, gains the true-peak ceiling limits) and where the usual measures (peak, LUFS-I, Max M) would level a
file differently from the project's: the comparison of standard normalisation with Playhead's, file by file. On the
test set's 56 effects a peak-normalised library turned out 3.4 to 9.8 dB apart in loudness within its groups. REAPER,
Kurator, SFX Workbench and engine scripts are to read the same manifest ([docs/LEVELS.md](docs/LEVELS.md)).

**Tracks in a folder.** Documents combine: `Playhead.combine([{ doc, offset, gain }, ...])` returns a document for the
sum of several sounds without the audio or a new analysis, so a folder track, a group of layered effects or a set of
stems can show the whole as the parts move. The app's **Tracks in a folder** section tries it hands-on: up to three
files as tracks under a folder, as in a DAW, with clips to drag (snapping to each other's onsets), gain, mute, solo
and playback. The folder draws the tracks' look combined at once, or the mix analysed a moment later for reference,
with how closely they agree; three more folder views show each track's share of the energy, the loudest track in each
band, and the bands two tracks share, where one may mask the other. `Playhead.align` gives other hosts the per-track
power and spectrogram behind such views. How well each curve combines is measured in
[experiments/compose](experiments/compose/README.md).

Because a whole combines in about a millisecond, a computer can search it: `Playhead.arrange(parts, { goal: "punch" })`
tries some 500 offsets and gains in a fraction of a second and returns the best few arrangements that differ from each
other, for punchy, big (cinematic) or clean layering, with `Playhead.measureParts` reporting the measures behind them
(rise time, the layers starting together, focus, spectral coverage, tail, shared bands). SFX Workbench offers it as
"Find arrangements" in its layer stack. Whether the arrangements survive mixing is measured in
[experiments/arrange](experiments/arrange/README.md); whether they *sound* punchier, bigger or cleaner is the question of
a short [listening test](https://eigensoundlab.github.io/playhead/listening/) ([experiments/listening](experiments/listening/README.md)).

For visuals, games and video, `playhead frames` gives the curves once per video frame (CSV, JSON or a Blender script)
and `playhead markers` writes Audacity labels, DaVinci Resolve markers and subtitles. Whether Playhead's curves drive
visuals better than the usual level, FFT bands and onset triggers is measured in
[experiments/visuals](experiments/visuals/README.md), with a [viewer](https://eigensoundlab.github.io/playhead/visuals/)
that drives two visuals side by side: they follow sections and accents better and never flicker, but do not yet read
builds at constant loudness or harshness at equal loudness.

Profiles trade detail for speed: `fast` (curves only, 0.13 s for a 2 s sound), `sfx` (plus events, tags, layers, checks and descriptors, 0.4 s), `music` (plus beats and sections, 1.7 s for 30 s). The guide has recipes for a browser sound tool, an asset manager with a Python server, REAPER and Unity, and `examples/embed.html` is a working host page.

**REAPER.** [integrations/reaper](integrations/reaper/README.md) is a ReaPack package of nine actions around the command
line: analyse the selected items, add their events, sections and bars as markers and regions, write curves as
automation through a small JSFX (Playhead Control) that any effect parameter can follow, run the tools as new takes,
a dockable strip window, and editing tools: arrange the layers of a sound for punch, size or clarity, split a
recording into its sounds (named, trimmed, with regions for rendering), and a tempo map from a recording's bars. Its
README has recipes for mixing, mastering and sound-design experiments.

**Languages.** The lab is in English, Czech, German, Polish, Russian and Spanish (the menu in the top bar, or
`?lang=cs`). The terms follow a shared [sound vocabulary](https://github.com/eigensoundlab/sound-vocabulary), so
loudness and level, or harshness, sharpness and roughness, stay apart in every language. Apps that draw strips show
the library's labels in these languages with `Playhead.localize(table)` and `dist/i18n/<lang>.json`;
[i18n/TRANSLATING.md](i18n/TRANSLATING.md) says how to add a language.

## Batch analysis and self-checks

`tools/batch.js` runs the same analysis over folders of real files, with no browser:

```sh
node tools/batch.js ~/Sounds/library --out batch-out            # analysis only
node tools/batch.js ~/Sounds/library --out batch-out --checks   # plus self-checks
node tools/batch.js ~/Sounds/library --out batch-out --fx       # plus tools compared with a static EQ
```

It writes `summary.csv`, `checks.csv`, `fx.csv`, `results.json` and `report.html` (every file drawn as a strip with loudness, activity, tension, downbeats, sections and events). WAV is read directly; other formats need `ffmpeg` on the PATH.

**Self-checks** need no labels. Each one edits the file in a way whose correct answer is known by construction, re-analyses it and compares:

| Check | Edit | Expected |
|---|---|---|
| level | copy 12 dB quieter | loudness −12.0 LU; activity, events, tempo and sections unchanged |
| shift | 0.5 s of silence in front | events, beats and sections move by +0.5 s |
| hit | a 25 ms noise burst at the quietest moment | a new event or onset within ±25 ms |
| dc, clip, cut | DC offset, clipping, a tail cut at 60 % | each problem flagged |
| speed | played 6 % faster | tempo ×1.06, pitch +1 semitone, length ÷1.06 |
| noise | pink noise 30 LU below | loudness and activity curves still correlate with the original |
| join | two tracks butted together | a section boundary at the join |

**Threshold calibration** (`tools/tune.js`) uses the self-checks as an objective that needs no labels:

```sh
node tools/tune.js ~/Sounds/library --out tune-out          # writes tune.html and tune.json
```

1. The files are split into a tuning half and a held-out half, stratified by top-level folder.
2. Each parameter in `tools/params.js` (mel spectrum floor, onset minimum, event threshold, recurrence range) is varied one at a time on the tuning half. Features are extracted once per file and edit; each candidate re-runs only what depends on it.
3. A variant is kept if it passes at least two more checks than the shipped value. A guard then runs the synthetic and analytic tests under the combination and falls back to the next-best value for any parameter that breaks them.
4. The shipped and frozen values are compared on both halves. The held-out number is the one to report.

On the 73-file corpus this replaced the absolute −80 dB mel floor by a floor 80 dB below each file's loudest band, and widened the recurrence range to 1.5–3. The 70 dB floor scored best but broke the synthetic cue-arc sections, so the guard took the next best. Held-out self-checks rose from 94.1 % to 95.8 % (651 → 663 of 692), almost entirely in the level-invariance checks (events 32 → 36 of 36, activity 34 → 36, recurrence 13 → 18 of 18), with one loss (sections under a shift 6 → 5 of 6). All synthetic tests still pass; the sound-effect kit, whose thresholds were tuned on itself, went from 25 to 24 of 25 tags.

One split can be lucky, so `node tools/tune.js <folder> --grid --splits 20` repeats it: 11 settings are evaluated once on every file (8 s per file, one hour on two cores), then for each of 20 random stratified splits the best setting on the tuning half that passes all tests is scored on the held-out half. Against the original values the held-out gain was **+1.54 points (sd 0.48), between +0.74 and +2.40 and positive in all 20 splits**. In 19 of them the joint search chose a value the one-at-a-time search had missed: an 8 dB instead of 6 dB re-attack threshold for sound-effect events, which changes only whether events move exactly with a shift (better on 6 files, worse on 1). It is now the default. The test suite still passes, with the same 24 of 25 kit tags.

**Tool comparison** measures how much of each tool's spectrogram change the single best static EQ could reproduce ("EQ share"). Near 100 % means an ordinary EQ would do the same; near 0 % means the change depends on time and content.

## Quick start

No build step and no dependencies.

```sh
git clone https://github.com/eigensoundlab/playhead.git
cd playhead
npm start          # http://localhost:8080  (or just open index.html)
npm test           # regression checks on the built-in test signals (Node 18+)
npm run build      # _site/ for GitHub Pages, plus _site/playhead-single.html
```

## Validation so far

The built-in signals are synthesised with known beats, sections and events (CC0). These results are functional checks on that material. Several thresholds were tuned on the same signals, so they are optimistic, not a validation on real recordings.

| Check | Result |
|---|---|
| Cue arc (120 BPM): tempo / beat F / downbeat F | 120.2 BPM / 0.98 / 1.00 |
| Tempo ramp 96→144 BPM: local-pulse beat F | 1.00 |
| Cue arc section boundaries / labels | 6 of 6 / A B B C D E A B A |
| Sound-effect kit (13 files): events found / tags correct | 25 of 25 / 24 of 25 (25 before the level-invariant mel floor) |
| Clean-up on a faulty export | 4 problems → 0 |
| Layer remix on a pistol shot (sub −12 dB, matched loudness) | sub layer share −29 points |
| De-harsh on breaking glass | harshness −18 % at 0.0 LU loudness change (scored by the same model that gates the tool) |
| Tension shaper on the cue arc | loudness range 19.5 → 26.4 LU |

A full analysis of a 320 s stereo file (features, curves, rhythm, structure) took about 8 s in Node on the development machine; browser timings will vary.

### Real recordings

Self-checks on 73 real files (56 CC0 Sonic Pi samples and 17 librosa example excerpts of music, speech and nature; first 60 s; `tools/fetch-corpus.sh` fetches them), with the calibrated defaults: **1363 of 1436 passed (94.9 %)**, of which the cross-field descriptors **485 of 498 (97 %)**. Before calibration: 1331 (92.7 %) and 472. These figures include the tuning half; the held-out figure is in the calibration paragraph above.

| Holds well | Pass rate |
|---|---|
| Same events, activity, sections and tempo for a copy 12 dB quieter | 73/73, 73/73, 16/16, 7/7 (before calibration 67, 68, 11, 6) |
| DC offset and clipping flagged; length after speed change | 73/73 each |
| Section boundary found where two tracks are joined | 13/13 |
| Loudness −12.0 LU for a copy 12 dB quieter | 71/73 (two quiet files hit the BS.1770 absolute gate) |

| Needs work | Pass rate | Cause found |
|---|---|---|
| Events move exactly with a 0.5 s shift | 59/73 (56 before the 8 dB re-attack threshold) | detections near threshold flip when the frame grid moves, most in dense music |
| Sections under a 0.5 s shift | 9/16 | boundaries between similar passages move; the calibrated floor cost two |
| Inserted 25 ms hit detected in sound effects | 18/24 | misses inside drum loops and sweeps |
| Pitch +1 semitone after 6 % speed-up | 23/28 | median pitch is unreliable on polyphonic music |

| Descriptors | Pass rate |
|---|---|
| N6 arrow of time flips sign when the file is reversed | 42/42 |
| N4 net glide flips sign when reversed | 37/37 |
| N1 kurtosis and N5 cepstral peak prominence unchanged at −12 dB | 73/73 each |
| N7 interest and N8 recurrence unchanged at −12 dB | 51/51, 40/40 |
| N2 repetition rate ×1.06 when played 6 % faster | 10/11 |
| N9 ring time ÷1.06 and material unchanged when faster (sound effects) | 17/17, 5/5 |
| N9 ring time on music | 7/14: decays overlap, so material is marked unreliable on mixes |

Each descriptor's column-to-column changes correlate only weakly with loudness's: median |r| 0.05 (N2) to 0.17 (N1), against 0.77 for the existing tension curve C5. That shows they carry different information, not yet that it is useful to a listener.

Bugs found this way and fixed: a sound already present at sample 0 had its event reported a window (23 ms) late; the absolute mel floor made activity, events and recurrence depend on playback level.

**Tools against ordinary EQ.** How much of each tool's spectrogram change could an EQ have made? Three EQs are fitted to each output, so they are upper bounds that flatter the EQ: a static EQ, an ideal dynamic EQ (third-octave gains following each band's own input level, instant attack and release, like a dynamic EQ or multiband compressor), and ideal EQ automation (third-octave gains free to change every 0.1 s). Median over the 73 files (`tools/batch.js --fx`):

| Tool | Static EQ | Dynamic EQ | EQ automation | Left for no EQ |
|---|---|---|---|---|
| Layer remix | 84 % | 86 % | 95 % | 5 % |
| De-harsh | 72 % | 81 % | 88 % | 12 % |
| Attack and body | 60 % | 68 % | 76 % | 24 % |
| Variations | 34 % | 50 % | 54 % | 46 % |

A dynamic EQ adds only 2 to 16 points over a static one. Layer remix is almost entirely EQ plus automation, so its value is in finding which bands and moments to change. The analysis could equally write those settings into an ordinary EQ. Attack and body and the variations do things no EQ can.

**Which moments, not which shape.** A dynamic EQ could imitate much of de-harsh's spectral shape, but its detector decides when it acts. `tools/dyneq.js` runs de-harsh twice with identical processing, once triggered by the harshness model and once by the level in the same frequency range, both opening between the file's own median and 90th percentile (52 files over 1 s):

| | Harshness model | Band level (conventional dynamic EQ) |
|---|---|---|
| Open / average cut | 21 % / 0.4 dB | 26 % / 0.6 dB |
| Gate opening on the harshest 10 % of moments | 100 % (by construction) | 42 % (music 33 %) |
| Gate opening on the calmer half | 0 % | 19 % (music 23 %) |
| Sharpness removed in the harshest 10 % | 0.042 acum | 0.018 acum |
| Sharpness removed in the calmer half | 0.000 | 0.010 acum |

The two detectors open on the same moments only 17 % of the time (median Jaccard; gate correlation 0.23). With less cut overall, the analysis-driven gate removes more than twice the sharpness where the file is harshest and leaves the rest alone. Sharpness is one input of the harshness model, so this shows the trigger works as designed; whether listeners prefer the result needs a listening test.

### Labelled data: ESC-50

Do the descriptors carry information that standard features lack? On [ESC-50](https://github.com/karolpiczak/ESC-50) (2,000 environmental recordings, 50 classes, official 5-fold split), never used for design or calibration, a random forest on one vector per clip:

| Features | Count | Accuracy |
|---|---|---|
| MFCC mean and sd | 26 | 49.2 % |
| librosa hand-crafted set (MFCC and deltas, spectral shape, contrast, chroma) | 130 | 60.6 % |
| Descriptors N1–N9 alone | 48 | 55.7 % |
| MFCC + descriptors | 74 | **65.2 %** |
| librosa + descriptors | 178 | **66.8 %** |
| librosa + psychoacoustic curves + descriptors | 196 | 68.2 % (logistic regression 70.0 %) |

Adding the descriptors helps with both classifiers and against both baselines (paired McNemar tests, p from 2e-42 to 4e-8), and 74 features of MFCC + descriptors beat the 130-feature librosa set (p = 3e-5). Added one at a time, repetition (+2.6 points), impulsiveness (+2.2) and events (+1.9) help most; the families overlap, so dropping any single one costs under a point. The largest class gains are engine, coughing, chainsaw, sneezing and drinking (F1 +0.17 to +0.27). Learned networks reach about 98 % on this set; the point is complementary, interpretable information, not classification accuracy. Details and reproduction: [experiments/esc50](experiments/esc50/README.md).

Negative controls show the test cannot be fooled by adding columns: 48 columns of noise, of the real descriptor values shuffled between clips, or of loudness copies all leave the librosa set at or below its 60.6 % (55.8–59.9 % over three seeds), and the real descriptors beat each of them at p ≤ 5e-15.

### Testing a new descriptor

The same battery applies to any descriptor added later, and each gate catches what the others miss:

| Gate | Asks | Tool | Blind spot it covers |
|---|---|---|---|
| Analytic reference | Is it computed correctly? | `test/descriptor-tests.js`: signals whose value is known in closed form | A descriptor can be stable and informative yet wrong |
| Metamorphic self-checks | Is it stable where it should be, and does it move where it should? (level, shift, speed, reversal, joins) | `tools/batch.js --checks` on any unlabelled library | A constant passes every invariance check, so this gate alone is not enough |
| Independence | Does it move apart from loudness? | `independence()` in `tools/selfchecks.js` | Redundant curves |
| Calibration | Do its thresholds generalise? | `tools/tune.js --grid --splits 20` | Thresholds fitted to one corpus |
| Labelled information | Does it carry class information beyond standard features? | `export-features.js` → `evaluate.py` (add-one, drop-one, McNemar) → `controls.py` | Stable, correct but useless descriptors |

It has caught real faults: the self-checks found that the absolute mel floor made activity, events and recurrence depend on playback level, and the ESC-50 drop-one test shows N7 interest adds nothing for classification (it may still be useful to read). Its limits: the labelled test uses clip summaries of short environmental sounds, so it says nothing about music or about the curves over time; the corpus for the self-checks is small; and tools scored by the same model that drives them (de-harsh) need an outside judge, ideally listeners.

## Performance

`node tools/profile.js` times every stage (the browser runs the same JavaScript on V8 and measured within 10 %). One core, 44.1 kHz stereo:

| File | Features | Curves, rhythm, structure | Sound-effect analysis | Descriptors | Total | Speed |
|---|---|---|---|---|---|---|
| 2 s sound effect | 0.10 s | 0.18 s | 0.31 s | 0.11 s | 0.95 s (0.25 s one-time calibration) | 2.1× real time |
| 30 s | 0.47 s | 0.44 s | 0.94 s | 0.39 s | 2.2 s (was 3.2 s) | 13.5× |
| 120 s | 1.3 s | 0.78 s | 1.3 s | 1.3 s | 4.7 s (was 7.6 s) | 26× |
| 300 s | 2.9 s | 1.6 s | 1.1 s | 2.8 s | 8.5 s (was 12.8 s) | 35× |

The FFT is a radix-2² transform: after the bit reversal, each pass does two radix-2 stages at once, so the data is read and written half as often, and trivial twiddles skip their multiplications. It is about 2× faster than the plain radix-2 it replaced (31 µs instead of 64 µs for 2048 points here) and agrees with it to 3e-16. On the 73-file corpus every self-check value and every summary value is identical to the old FFT's (1436 and 3723 of them), and the corpus run took 453 s instead of 646 s.

The descriptors were made about 3× faster without changing results (all tests pass with the same values): cepstral peak prominence uses half the frames, two frames per FFT and complex products instead of `atan2`; the repetition envelopes are converted to dB once and overlapping Welch segments are shared; recurrence uses a selection algorithm instead of a sort; the short STFT packs two real frames per complex FFT.

In the app, analysis runs in a pool of Web Workers (up to four, one per spare core) built from the page's own scripts, so the page stays responsive (about 53 frames per second during analysis instead of 22) and several files are analysed at once. Where workers are blocked it falls back to the main thread; `?noworker` forces that for comparison.

**GPU.** WebGPU compute shaders are available in current Chrome and Edge (since 113), Safari 26 and Firefox on Windows (141), and reached Baseline in January 2026, with gaps in Linux Firefox and older iPhones. The parts that would map well to the GPU are the batched FFTs and band sums in the features, cepstral peak prominence, the short STFT, NMF and the recurrence distance matrix: about 55–65 % of the time above. By Amdahl's law even an infinitely fast GPU would make a single file at most about 2.5× faster, at the cost of WGSL kernels, a float32-only path, cold shader compiles of over 200 ms and a CPU fallback that must stay. Parallel workers already give a similar gain for libraries on multi-core machines. A GPU path is worth it for batch scans of large libraries or for the Unity port (compute shaders, or Burst jobs first), not yet for the browser prototype.

**Rendering the tools** (`node tools/profile.js --fx`, one core, stereo):

| Tool | 2 s | 30 s | 120 s | 300 s |
|---|---|---|---|---|
| STFT engine alone (analysis and resynthesis, no change) | 0.06 s | 0.46 s | 2.0 s | 4.3 s (was 10.9 s) |
| De-harsh | 0.12 s | 0.89 s | 4.3 s | 10.5 s (was 17.4 s) |
| Layer remix | 0.06 s | 0.56 s | 2.3 s | 6.2 s (was 13.4 s) |
| Attack and body | 0.09 s | 1.1 s | 4.8 s | 14.4 s (was 106 s) |
| Tension shaper | 0.08 s | 0.56 s | 2.7 s | 6.6 s (was 14.8 s) |
| Four variations | 0.17 s | 2.1 s | 9.1 s | 32 s (was 65 s) |

Three CPU changes, all with outputs identical to float32 precision on reference renders: attack and body's median filters keep a sorted window instead of sorting every one, the STFT engine transforms two channels per complex FFT, and the faster FFT above.

Unlike the analysis, almost all of the rendering is data-parallel: every frame's FFT, every bin's gain, every median window. Only de-harsh's release smoothing runs in sequence over time, and even that is independent per bin. The GPU-friendly share is over 90 %, so a WebGPU path could make long renders several times faster. That matters for long files and for batch generation (hundreds of variations, whole libraries). It does not matter for a 2 s sound effect, which already renders in a quarter of a second. Real-time use in a game does not need the GPU at all: the analysis runs offline and only its control curves ship, and applying them at runtime is a cheap dynamic EQ.

## Browser support

Decoding uses the browser's `decodeAudioData`. WAV, MP3, AAC/M4A and FLAC decode in current Chrome, Firefox and Safari. Ogg Vorbis needs Safari 18.4 or later. Ogg Opus on desktop Safari is unreliable. Files are resampled to the audio context's rate.

## Layout

```
CHANGELOG.md          what changed in each release
index.html            the app
css/playhead.css
src/analysis.js       feature extraction, curves, rhythm, structure, sound-effect analysis
src/descriptors.js    cross-field descriptors N1–N9
src/probes.js         synthetic test signals with ground truth, descriptor tour
src/effects.js        analysis-driven tools, WAV encoder
src/playhead.js       public API: analyze(), drawStrip(), toMarkers(), curveAt(), process(), combine(), align(), arrange(), localize()
src/cues.js           rules into cues and cue sheets (Playhead.cues): visuals, game events, sound-effect cues
src/levels.js         tag rules and settings into one gain per file, manifests and the levels report (Playhead.levels)
src/i18n.js           translations at run time; src/i18n-data.js is built from i18n/<lang>.json
src/app.js            user interface
i18n/                 the English texts (en.json), the translations and the translators' guide
test/run-tests.js     regression checks
test/descriptor-tests.js  analytic reference tests for the descriptors
test/i18n-tests.js    translations: complete English list, placeholders and markup kept, plurals, library labels
test/combine-tests.js combining documents: a moved, turned-down part against the analysed mix; gain, order, drawing
tools/batch.js        batch analysis, self-checks and tool comparison for folders of files
tools/selfchecks.js   the self-checks and whole-pipeline analysis shared by batch and tune
tools/tune.js         threshold calibration with a held-out half
tools/params.js       the calibrated parameters and their candidate values
tools/fetch-corpus.sh fetches the CC0 and CC-licensed test recordings
tools/profile.js      per-stage timing (--fx: tool rendering)
tools/dyneq.js        de-harsh with its harshness detector against a conventional level-driven dynamic EQ
tools/export-features.js  one feature vector per file (MFCC baseline, psychoacoustic curves, descriptors) as CSV
experiments/esc50/    ESC-50 experiment: librosa baseline, evaluation, negative controls, HTML report, results
experiments/corpus/   results on the 73-file corpus behind the README and the paper (self-checks, calibration, tools vs EQ, triggers)
experiments/paper/    figure data, figure script and a sound for the paper (tools/paper-data.js, figures.py)
experiments/listening/  the listening test of the arrangement goals: stimuli, test page (on the site at /listening/), analysis
experiments/visuals/  Playhead's curves against the usual audio-reactive signals as drivers of visuals; viewer at /visuals/
experiments/av/       the Audiovisual Playhead: one scene twice, usual signals against Playhead's, a rule editor; at /av/
experiments/levels/   how far the usual loudness measures disagree on the corpus; whether compression and limiting show
tools/audio-io.js     WAV reader/writer; other formats through ffmpeg
tools/build.js        builds _site/, a single-file version and dist/ (library bundles, command-line bundle)
tools/playhead-cli.js command line: analyze, markers, frames, cues, process, arrange, tools
tools/build-cli.js    one executable for the current platform (Node single executable application)
examples/             a host page and an analysis worker using the library bundle
docs/INTEGRATION.md   API, document schema and recipes for other applications
docs/GAMES.md         games and audio-driven visuals: rules, cue sheets, Unity and other engines, sound-effect cues
docs/LEVELS.md        levels for many files: measures, tag rules, the manifest, the report; plans for REAPER, Kurator, engines
tools/serve.js        local static server
tools/i18n.js         translations: extract the English, build, check, compare with the sound vocabulary
integrations/reaper/  REAPER actions, the Playhead Control JSFX and their tests (ReaPack package)
paper/                outline and licence of the accompanying paper (CC BY 4.0); the LaTeX source is kept in a separate repository
```

`analysis.js`, `descriptors.js`, `probes.js` and `effects.js` are plain UMD scripts: they run in the browser and in Node without a bundler.

## Roadmap

- Pilots of the library and command line in a sound-effect workbench, an asset manager, REAPER and a Unity game; short-decay material estimates (under 0.12 s) for very damped impacts; generators checked against the descriptors (material, event statistics, arrow of time).
- Optional WebGPU path for batched FFTs and NMF, behind the CPU reference implementation and its tests, once a pilot shows it is the bottleneck.
- Fallback decoder for Ogg/Opus where the browser can't decode them.
- Unity editor package: `[CustomPreview(typeof(AudioClip))]` with `ObjectPreview`, analysis cached by asset GUID through `AssetPostprocessor`.
- Looks: an objective comparison on the built-in signals (does the strongest visible change land on the true event,
  boundary or harshest moment, also at thumbnail size), then a task study with sound designers; feedback from the
  composer, SFX Workbench and kurator decides the defaults.
- Validation on real material: DEAM continuous arousal ratings, beat and structure datasets, and a short user study comparing the preview designs at 48, 24 and 12 px height.
- Second tier of descriptors from the research notes: DMD/ESPRIT modal decomposition, texture statistics, horizontal visibility graphs, detrended fluctuation analysis, a phasegram for growls.
- More calibrated parameters (structure noise floors, STA/LTA trigger, repetition thresholds) in the joint grid, and a larger, more varied calibration library.
- Localised processing: any effect applied through a layer, event or descriptor mask (saturation on the body layer only, reverb only on impact tails, de-noise only in gaps), and export of the analysis as EQ settings and automation lanes for ordinary plug-ins.
- Real-input transforms for mono material (two frames per FFT).
- Descriptor validation on further labelled sets (FSD50K for sound effects, DEAM for music) and per-frame use of the curves, not only clip summaries.

## Unity Asset Store note

The Asset Store submission guidelines (§1.2.b) currently exclude packages carrying licences "such as … Apache 2.0 … that requires attribution". As the copyright holder, the author can offer a store edition under the Asset Store EULA alongside the Apache-2.0 edition here, or distribute the Unity package outside the store (GitHub releases or a UPM git URL). Contributions are accepted on the understanding that this dual licensing stays possible. Confirm with Unity before submitting.

## Citing and licences

- Code: Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
- Paper and its figures: CC BY 4.0, see [paper/LICENSE.md](paper/LICENSE.md).
- Generated test signals: CC0 1.0.
- The listening test's stimuli (`experiments/listening/site/stimuli/`) and the visuals experiment's sounds
  (`experiments/visuals/site/audio/`), made from CC0 Sonic Pi samples and synthesis: CC0 1.0.
- `experiments/paper/robot-hit-steel.wav`, a sound by the author used for one of the paper's figures: CC BY 4.0.
- Audio you process with Playhead is yours; the tool claims no rights in its output.

The method and its evaluation are described in the paper (preprint):

> Sandner, D. (2026). *Playhead Beyond the Waveform: Cross-Field Descriptors for Sound Design* [Preprint]. Zenodo. https://doi.org/10.5281/zenodo.24008128

All versions of the paper: [10.5281/zenodo.24008127](https://doi.org/10.5281/zenodo.24008127). To cite the software, cite the version you used. The corpus, ESC-50 and EQ-comparison results reported here were produced with 0.1.0:

> Sandner, D. (2026). *Playhead: overview curves and analysis-driven tools for music and game audio* (Version 0.1.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.23932626

For 0.2.0:

> Sandner, D. (2026). *Playhead: overview curves and analysis-driven tools for music and game audio* (Version 0.2.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.23985438

For 0.3.0, which produced the combining and arrangement experiments (`experiments/compose`, `experiments/arrange`):

> Sandner, D. (2026). *Playhead: overview curves and analysis-driven tools for music and game audio* (Version 0.3.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24043447

To refer to the software in general, use the concept DOI [10.5281/zenodo.23932625](https://doi.org/10.5281/zenodo.23932625), which always resolves to the latest version. [CITATION.cff](CITATION.cff) lists them all, with the paper as the preferred citation (GitHub's "Cite this repository" button shows it).

### Releasing

1. Set the new version in `package.json`, `CITATION.cff`, `.zenodo.json` and the footer and citation in `index.html`; `npm test` fails if they disagree.
2. Tag `vX.Y.Z` and publish a GitHub release. With the repository switched on in Zenodo's GitHub settings, Zenodo archives the release and mints a DOI, using `.zenodo.json` (which takes precedence over `CITATION.cff`).
3. Zenodo mints a new version DOI for each release; the concept DOI (10.5281/zenodo.23932625) stays the same. After the release, add the new version DOI to `CITATION.cff` (`identifiers`) and to the footer citation in `index.html`, and update `date-released`. GitHub Pages serves the main branch, so the live app shows it even though the archived release cannot contain its own DOI.
4. The paper is the `preferred-citation` in `CITATION.cff`, a related identifier (`isDescribedBy`) in `.zenodo.json` and a link in the footer; a new version of the paper changes its version DOI in those three places and in this section.
