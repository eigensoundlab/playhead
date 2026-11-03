# Playhead

**A waveform plus one or two lines that show what the waveform can't: intensity, busyness, tension, beats, sections and the kind of event, for music and game sound effects. The same analysis then drives editing, mixing and mastering tools.**

Live: <https://eigensoundlab.github.io/playhead/> · Author: Daniel Sandner · Licence: Apache-2.0

Playhead is a research prototype. It runs entirely in the browser: audio you drop in is decoded and analysed locally and never leaves the tab. A Unity editor preview is the intended first integration.

## What it shows

| Lane | What it measures | Basis |
|---|---|---|
| C1 Loudness | Short-term loudness in LUFS | ITU-R BS.1770 K-weighting; ISO 532-1 sone loudness |
| C2 Activity | How busy the sound is: onsets and spectral change, not level | Log-mel spectral flux (SuperFlux-style) plus event density |
| C3 Arousal | Energy and excitement composite | Loudness, activity, sharpness |
| C4 Harshness | Loudness weighted by how unpleasant it is | Zwicker psychoacoustic annoyance: DIN 45692 sharpness, roughness, fluctuation strength |
| C5 Tension | Build-ups and releases | Farbood-style trend salience of loudness, activity and harmony |
| C6 Harmonic tension | Dissonance and distance from key | Tonal interval vectors (TIV) |
| C7 Surprise | How unexpected each moment is | Feature novelty against recent context |
| Rhythm | Tempo, beats, downbeats, pulse clarity | Autocorrelation tempogram, Ellis dynamic-programming beats, predominant local pulse |
| Structure | Sections and repeats (A B A …) | Foote checkerboard novelty on a self-similarity matrix |
| Sound effects | Events, Schaeffer-style tags (impulse / iterative / sustained), layers, pitch, attack, QA problems | YIN, Timbre Toolbox descriptors, KL-NMF, Peeters–Deruty profiles |

Five combined preview designs (D1–D5) put the most useful of these onto one strip. The library view uses D5 for sound effects and D4 for music.

### Cross-field descriptors

Nine further rows borrow measures from other fields (`src/descriptors.js`). Most have a value fixed by mathematics for noise, a steady tone or time reversal, and the tests check exactly that rather than thresholds tuned on test signals.

| Row | Measure | Borrowed from | Analytic reference (tested) |
|---|---|---|---|
| N1 Impulsiveness | Spectral kurtosis, per band | Machine diagnostics | 0 for Gaussian noise, −1 for a steady tone |
| N2 Repetition rate | Squared-envelope spectrum, confirmed by autocorrelation; experimental speech-rate modulation (3–7 Hz vs 0.5–2.5 Hz per octave, which did not separate single speech clips from music) | Machine diagnostics; speech science | rate of an amplitude-modulated noise; ×1.06 when played 6 % faster; none for noise or a tone |
| N3 Event statistics | STA/LTA trigger, burstiness, Gutenberg–Richter b-value, temporal entropy | Seismology; ecoacoustics | burstiness −1 periodic, ≈0 Poisson, > 0 clustered; Aki b-value of a known distribution |
| N4 Spectral motion | Wasserstein-1 (1-D optimal transport) velocity on a log-frequency axis | Applied mathematics | a 2 oct/s sweep reads 2.00 oct/s, its reverse −2.00 |
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

Each descriptor's column-to-column changes correlate only weakly with loudness's: median |r| 0.06 (N4) to 0.17 (N1), against 0.77 for the existing tension curve C5. That shows they carry different information, not yet that it is useful to a listener.

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
| Acts on the harshest 10 % of moments | 100 % (by construction) | 41 % (music 33 %) |
| Acts on the calmer half | 0 % | 18 % (music 23 %) |
| Sharpness removed in the harshest 10 % | 0.041 acum | 0.018 acum |
| Sharpness removed in the calmer half | 0.000 | 0.009 acum |

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

Negative controls show the test cannot be fooled by adding columns: 48 columns of noise, of the real descriptor values shuffled between clips, or of loudness copies all leave the librosa set at or below its 60.6 % (55.8–59.9 % over three seeds), and the real descriptors beat each of them at p ≤ 4e-15.

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
index.html            the app
css/playhead.css
src/analysis.js       feature extraction, curves, rhythm, structure, sound-effect analysis
src/descriptors.js    cross-field descriptors N1–N9
src/probes.js         synthetic test signals with ground truth, descriptor tour
src/effects.js        analysis-driven tools, WAV encoder
src/app.js            user interface
test/run-tests.js     regression checks
test/descriptor-tests.js  analytic reference tests for the descriptors
tools/batch.js        batch analysis, self-checks and tool comparison for folders of files
tools/selfchecks.js   the self-checks and whole-pipeline analysis shared by batch and tune
tools/tune.js         threshold calibration with a held-out half
tools/params.js       the calibrated parameters and their candidate values
tools/fetch-corpus.sh fetches the CC0 and CC-licensed test recordings
tools/profile.js      per-stage timing (--fx: tool rendering)
tools/dyneq.js        de-harsh with its harshness detector against a conventional level-driven dynamic EQ
tools/export-features.js  one feature vector per file (MFCC baseline, psychoacoustic curves, descriptors) as CSV
experiments/esc50/    ESC-50 experiment: librosa baseline, evaluation, HTML report, results.json
tools/audio-io.js     WAV reader/writer; other formats through ffmpeg
tools/build.js        builds _site/ and a single-file version
tools/serve.js        local static server
paper/                outline of the accompanying paper (CC BY 4.0)
```

`analysis.js`, `descriptors.js`, `probes.js` and `effects.js` are plain UMD scripts: they run in the browser and in Node without a bundler.

## Roadmap

- Optional WebGPU path for batched FFTs and NMF, behind the CPU reference implementation and its tests.
- Fallback decoder for Ogg/Opus where the browser can't decode them.
- Unity editor package: `[CustomPreview(typeof(AudioClip))]` with `ObjectPreview`, analysis cached by asset GUID through `AssetPostprocessor`.
- Validation on real material: DEAM continuous arousal ratings, beat and structure datasets, and a short user study comparing the preview designs at 48, 24 and 12 px height.
- Second tier of descriptors from the research notes: DMD/ESPRIT modal decomposition, texture statistics, horizontal visibility graphs, detrended fluctuation analysis, a phasegram for growls.
- More calibrated parameters (structure noise floors, STA/LTA trigger, repetition thresholds) in the joint grid, and a larger, more varied calibration library.
- Localised processing: any effect applied through a layer, event or descriptor mask (saturation on the body layer only, reverb only on impact tails, de-noise only in gaps), and export of the analysis as EQ settings and automation lanes for ordinary plug-ins.
- Real-input transforms for mono material (two frames per FFT) and an optional WebGPU path for long renders and batch generation, both checked against the current float64 path.
- Descriptor validation on further labelled sets (FSD50K for sound effects, DEAM for music) and per-frame use of the curves, not only clip summaries.

## Unity Asset Store note

The Asset Store submission guidelines (§1.2.b) currently exclude packages carrying licences "such as … Apache 2.0 … that requires attribution". As the copyright holder, the author can offer a store edition under the Asset Store EULA alongside the Apache-2.0 edition here, or distribute the Unity package outside the store (GitHub releases or a UPM git URL). Contributions are accepted on the understanding that this dual licensing stays possible. Confirm with Unity before submitting.

## Citing and licences

- Code: Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
- Paper and its figures: CC BY 4.0, see [paper/LICENSE.md](paper/LICENSE.md).
- Generated test signals: CC0 1.0.
- Audio you process with Playhead is yours; the tool claims no rights in its output.

Cite with [CITATION.cff](CITATION.cff) (GitHub shows a "Cite this repository" button).

### Releasing

1. Set the new version in `package.json`, `CITATION.cff`, `.zenodo.json` and the footer and citation in `index.html`; `npm test` fails if they disagree.
2. Tag `vX.Y.Z` and publish a GitHub release. With the repository switched on in Zenodo's GitHub settings, Zenodo archives the release and mints a DOI, using `.zenodo.json` (which takes precedence over `CITATION.cff`).
3. After the first release, add the concept DOI (it always resolves to the latest version) to `CITATION.cff` as `doi:`, to the footer citation and as a badge here. When the paper is out, add it as `preferred-citation` in `CITATION.cff` and as a related identifier (`isDescribedBy`) in `.zenodo.json`.
