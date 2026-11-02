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

## Analysis-driven tools

| Tool | What it does |
|---|---|
| Clean up for export | Removes DC, rebuilds clipped peaks, trims silence, adds fades, folds identical channels to mono, normalises |
| De-harsh | Suppresses narrow 0.8–10 kHz resonances, only while the annoyance model says the sound is harsh |
| Layer remix | Rebalances NMF layers (sub, body, ring, debris) with soft Wiener masks |
| Attack and body | Median-filter harmonic/percussive split with separate levels |
| Tension shaper | Turns the tension curve into gain and brightness automation |
| Loop maker | Finds the best-matching loop points (on downbeats when the beat is clear) and renders a click-free seam |
| Variations | Makes game-ready variants: layer balance, grain order, small pitch changes |

Every result is re-analysed, so the bench shows what changed (loudness, harshness, layer shares, loudness range, problems) next to an A/B player and a WAV download.

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
| Sound-effect kit (13 files): events found / tags correct | 25 of 25 / 25 of 25 |
| Clean-up on a faulty export | 4 problems → 0 |
| Layer remix on a pistol shot (sub −12 dB, matched loudness) | sub layer share −29 points |
| De-harsh on breaking glass | harshness −18 % at 0.0 LU loudness change (scored by the same model that gates the tool) |
| Tension shaper on the cue arc | loudness range 19.5 → 26.4 LU |

A full analysis of a 320 s stereo file (features, curves, rhythm, structure) took about 8 s in Node on the development machine; browser timings will vary.

## Browser support

Decoding uses the browser's `decodeAudioData`. WAV, MP3, AAC/M4A and FLAC decode in current Chrome, Firefox and Safari. Ogg Vorbis needs Safari 18.4 or later. Ogg Opus on desktop Safari is unreliable. Files are resampled to the audio context's rate.

## Layout

```
index.html            the app
css/playhead.css
src/analysis.js       feature extraction, curves, rhythm, structure, sound-effect analysis
src/probes.js         synthetic test signals with ground truth
src/effects.js        analysis-driven tools, WAV encoder
src/app.js            user interface
test/run-tests.js     regression checks
tools/build.js        builds _site/ and a single-file version
tools/serve.js        local static server
paper/                outline of the accompanying paper (CC BY 4.0)
```

`analysis.js`, `probes.js` and `effects.js` are plain UMD scripts: they run in the browser and in Node without a bundler.

## Roadmap

- Move analysis to a Web Worker (decoding stays on the main thread, since workers have no `AudioContext`).
- Fallback decoder for Ogg/Opus where the browser can't decode them.
- Unity editor package: `[CustomPreview(typeof(AudioClip))]` with `ObjectPreview`, analysis cached by asset GUID through `AssetPostprocessor`.
- Validation on real material: DEAM continuous arousal ratings, beat and structure datasets, and a short user study comparing the preview designs at 48, 24 and 12 px height.
- Further descriptors from the research notes: arrow-of-time (envelope irreversibility), recurrence-based organisation, predictive information rate, modal decay ("material").

## Unity Asset Store note

The Asset Store submission guidelines (§1.2.b) currently exclude packages carrying licences "such as … Apache 2.0 … that requires attribution". As the copyright holder, the author can offer a store edition under the Asset Store EULA alongside the Apache-2.0 edition here, or distribute the Unity package outside the store (GitHub releases or a UPM git URL). Contributions are accepted on the understanding that this dual licensing stays possible. Confirm with Unity before submitting.

## Citing and licences

- Code: Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
- Paper and its figures: CC BY 4.0, see [paper/LICENSE.md](paper/LICENSE.md).
- Generated test signals: CC0 1.0.
- Audio you process with Playhead is yours; the tool claims no rights in its output.

Cite with [CITATION.cff](CITATION.cff) (GitHub shows a "Cite this repository" button).
