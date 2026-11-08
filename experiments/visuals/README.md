<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Do Playhead's curves drive visuals better than the usual signals?

VJ tools and game engines drive visuals from a level follower, three FFT bands, an onset trigger and a BPM clock
(MilkDrop, TouchDesigner's audioAnalysis, Resolume, Synesthesia, Unreal's Audio Synesthesia, Wwise and FMOD meters).
None of them gives sections, tension, harshness or builds. The hypothesis: Playhead's curves give visuals better
dynamics than these usual signals.

This experiment checks the hypothesis without viewers, on sounds built for it so that the truth is known: where the
accents are, where the sections change, where a build runs, which blocks are harsh. A viewer page shows any two drivers
side by side on the same sound. It is a first step: the measures here are not yet validated against what people see,
and the protocol for a viewing test is below.

**Viewer:** [eigensoundlab.github.io/playhead/visuals/](https://eigensoundlab.github.io/playhead/visuals/) (or
`node tools/serve.js 8080` and `http://localhost:8080/visuals/`): a disc (size and brightness), looming rings, a
jagged contour or a camera shake, driven by two signals at once, with an option to hide which is which.

```sh
node experiments/visuals/run.js [sonic-pi-samples-dir]   # results.json, site/data/*.json, site/audio/*.flac
```

## Stimuli

Built by `run.js` from CC0 Sonic Pi samples and synthesis, mono, peak at -1 dBFS:

| Sound | Length | What it tests |
|---|---|---|
| groove | 32 s | 120 BPM in four sections: groove, breakdown (pad and quarter hats), full with bass and crash, outro. 42 accents (kick, snare, bass, crash) |
| riser | 24 s | a steady part, then a 12 s build at constant momentary loudness (noise sweeping from 300 Hz to 8 kHz, a snare roll from 2 to 16 hits per second), then a drop |
| swell | 24 s | the same shape, built by density instead of brightness: hats from 4 to 16 per second, a snare roll from 1 to 12 per second, toms joining; constant loudness |
| timbre | 36 s | 3 s blocks at equal loudness (K-weighted): smooth and dark (110 to 330 Hz sines), smooth and bright (2.5 to 5.2 kHz sines), rough (a 220 Hz harmonic tone with 70 Hz amplitude modulation), clipped (a hard-clipped 220 Hz sawtooth) |
| sfx | 24 s | 14 one-shot hits at irregular times, over a quiet ambience |
| dense | 20 s | a steady 128 BPM pattern with 16th hats; 43 accents (kick and snare) |

## Drivers

All at 60 frames per second, on 0..1:

| Driver | As |
|---|---|
| `rms` | an RMS envelope follower (10 ms attack, 250 ms release), min to max of the sound: the usual live level |
| `bass`, `mid`, `treb`, `bass_att` | FFT bands (below 250 Hz, to 4 kHz, to 16 kHz) against their own running average, as MilkDrop does (1 = normal, drawn at 0.5), and a damped bass |
| `centroid` | spectral centroid, 100 Hz to 10 kHz on a log scale |
| `hits` | an onset trigger (spectral flux over its running median), decaying over 150 ms |
| `rms_offline`, `hits_offline` | the same computed offline: zero-phase smoothing, centred windows, the 5th to 95th percentile of the sound. They separate what Playhead gains from its analysis from what it gains from seeing the whole file |
| `ph_loudness`, `ph_tension`, `ph_arousal`, `ph_activity`, `ph_harsh` | Playhead's curves (`Playhead.frames`, analysed at 100 curve points per second), each scaled from its 5th to 95th percentile in the sound (`--scale file`), as a VJ sets a gain |
| `ph_onset` | Playhead's onset strength as the strip draws it (`--scale fixed`; the file's range clips its peaks) |
| `ph_hits` | Playhead's onsets as a trigger, decaying over 150 ms |
| `shift_*` | Playhead's curves shifted by half the sound plus 0.19 s (off every beat grid here): a control that should score at chance |

## Measures

- **Accents hit**: peaks of the driver (prominence 0.15) against the accents the sound was built with. A peak counts
  from 125 ms before to 45 ms after its accent: ITU-R BT.1359 finds a picture early by up to 125 ms, or late by up to
  45 ms, unnoticed. F1 of precision and recall; the median latency.
- **Sections**: the share of the driver's variance that lies between the sections (η²), half a second around each
  change left out.
- **Builds**: the rank correlation of the driver with time over the build (ρ), and how far it rises from the first two
  seconds to the last two.
- **Timbre**: how well the driver tells the harsh blocks (rough, clipped) from the smooth ones (dark, bright) at equal
  loudness (AUC, 0.5 = chance), and its mean per kind.
- **Stability**: flashes per second if the driver set a brightness, counted as WCAG 2.3.1 counts them (a flash is two
  opposing changes of 10 % or more, the darker state below 80 %); the worst second over all sounds, and the share of
  seconds over three flashes in the worst sound. More than three flashes a second is a seizure risk, not only a
  matter of taste.
- **Level**: the rank correlation with the offline level (mean over the sounds): how much a driver says beyond "loud".

## Results

### Accents (F1)

| Driver | groove | riser | swell | sfx | dense | latency (groove) |
|---|---|---|---|---|---|---|
| `rms` | 0.86 | 0.57 | **0.81** | 0.57 | **1.00** | +16 ms |
| `bass` | 0.78 | 0.24 | 0.44 | 0.37 | **1.00** | +33 ms |
| `hits` | 0.68 | **0.59** | 0.31 | 0.47 | 0.41 | 0 ms |
| `hits_offline` | 0.68 | 0.57 | 0.30 | 0.57 | 0.40 | -17 ms |
| `rms_offline` | 0.17 | 0.16 | 0.00 | 0.56 | 0.00 | +45 ms |
| `ph_onset` | **0.91** | 0.42 | 0.45 | **0.69** | 0.99 | 0 ms |
| `ph_hits` | 0.65 | 0.48 | 0.28 | 0.67 | 0.44 | -17 ms |
| `shift_hits` (control) | 0.13 | 0.23 | 0.29 | 0.10 | 0.44 | |

### Sections, builds, stability

| Driver | sections η² (groove) | riser ρ (rise) | swell ρ (rise) | flashes/s, worst | seconds over 3 | level |
|---|---|---|---|---|---|---|
| `rms` | 0.57 | -0.61 (-0.09) | -0.22 (-0.03) | 4.0 | 0.10 | 0.72 |
| `bass_att` | 0.54 | **0.91** (0.21) | **0.89** (0.17) | 4.5 | 0.10 | 0.66 |
| `rms_offline` | 0.67 | 0.36 (0.11) | 0.73 (0.30) | 6.5 | 0.20 | 1.00 |
| `centroid` | 0.24 | 0.76 (0.24) | -0.12 (0.07) | 8.0 | 0.62 | -0.32 |
| `ph_loudness` | **0.97** | -0.75 (-0.09) | -0.54 (-0.27) | 1.5 | 0 | 0.52 |
| `ph_arousal` | 0.93 | -0.72 (-0.38) | -0.94 (-0.80) | 2.5 | 0 | 0.04 |
| `ph_tension` | 0.93 | 0.45 (0.41) | -0.85 (-0.47) | 1.5 | 0 | 0.24 |
| `ph_activity` | 0.21 | -0.53 (-0.29) | 0.03 (0.12) | 6.5 | 1.00 | -0.02 |
| `shift_loudness` (control) | 0.40 | | | 1.5 | 0 | |
| `shift_tension` (control) | 0.44 | | | 1.5 | 0 | |

### Timbre at equal loudness

| Driver | harsh vs smooth (AUC) | bright vs dark (AUC) | dark | bright | rough | clipped |
|---|---|---|---|---|---|---|
| `rms` | 0.50 | 0.00 | 0.99 | 0.51 | 0.91 | 0.85 |
| `treb` | 0.38 | 1.00 | 0.07 | 0.82 | 0.04 | 0.28 |
| `centroid` | 0.50 | 1.00 | 0.09 | 0.79 | 0.32 | 0.32 |
| `ph_harsh` | 0.50 | 1.00 | 0.34 | 0.83 | **0.99** | 0.00 |
| `ph_loudness` | 0.62 | 0.17 | 0.86 | 0.85 | 0.95 | 0.86 |
| `ph_arousal` | 0.69 | 0.67 | 0.15 | 0.24 | 0.35 | 0.36 |
| `shift_harsh` (control) | 0.41 | 0.43 | 0.61 | 0.66 | 0.77 | 0.12 |

## What it shows

The hypothesis holds for three of the five things a visual does with a sound, and fails for two:

1. **Sections: Playhead wins clearly.** Its loudness, tension and arousal put 93 to 97 % of their variance between
   the sections of the groove; the live RMS follower 57 %, the offline RMS 67 %, the damped bass 54 %, the shifted
   controls 40 to 44 %. A visual driven by them changes with the music's form and holds still within a section. The
   offline RMS does not get there, so this is the analysis, not only the look at the whole file.
2. **Stability: Playhead's slow curves never flash.** Driving a brightness, loudness and tension stay at or under
   1.5 flashes a second in the worst second of any sound; the RMS follower reaches 4, the offline RMS 6.5, the
   centroid 8, with 10 to 62 % of seconds over the WCAG limit of three. Playhead's activity flashes as much as RMS
   (it is an event curve), so it belongs on accents, not on brightness.
3. **Accents: Playhead's onset strength hits them best, on time.** F1 0.91 in the groove (RMS 0.86, the onset trigger
   0.68) and 0.69 for the sound effects (0.57), and a tie in the dense pattern (0.99 against 1.00), with no latency
   (the RMS follower is 16 ms late, the bass band 33 ms). The offline onset trigger does no better than the live one,
   so this too is more than hindsight. In the builds, where snare rolls crowd the accents, the RMS follower does better.
4. **Builds at constant loudness: not supported.** No Playhead curve follows both builds. Tension rises with the
   sweeping riser (ρ 0.45) but falls in the swell built by density (ρ -0.85), and loudness and arousal fall in both.
   MilkDrop's damped bass, against its own running average, follows both (ρ 0.91 and 0.89), and the centroid follows
   the sweep. When a build is not louder, Playhead's tension does not read it as tension: a build or riser descriptor
   (onset rate, density, spectral rise) is missing.
5. **Timbre at equal loudness: not supported.** No driver tells the harsh blocks from the smooth ones (AUC 0.5).
   Playhead's harshness puts the rough tone first (0.99) and the bright, smooth one second (0.83), but the clipped
   sawtooth last (0.00); the centroid ranks by brightness only. Playhead's harshness curve is a harshness-weighted
   loudness: at equal loudness it moves little (0.81 to 0.85 on the strip's scale), so for visuals it has to be scaled
   per file, and it does not see the buzz of a clipped tone. A loudness-independent harshness, with a distortion cue,
   would be the curve for a jagged contour.

In short: Playhead's curves are the better drivers for visuals that follow form and must not flicker, and its onset
strength for accents; for builds and timbre at equal loudness they are not, yet.

## Limits

- Synthetic and sample-built sounds: they make the truth known, but they are not music a VJ plays. The same measures
  on annotated music (beats, sections, builds) are the next step.
- One setting per usual driver (attack, release, thresholds); a VJ tunes these per set. The offline baselines show
  what better tuning can reach without Playhead.
- The measures are computational and not validated against viewers; the jitter measure (power above 8 Hz) came out
  near zero for every driver and is left out of the tables. A viewing test should decide which measures matter.
- Peak picking uses one prominence (0.15) for every driver.

## A viewing test (protocol)

From the research behind this experiment (the report "Playhead descriptor gaps rhythm and visuals"):

- **Stimuli**: 24 to 36 loudness-normalised excerpts of 20 to 40 s across beat-driven electronic, rock and pop,
  ambient, orchestral and game sound, including builds at constant loudness, drops, harsh against smooth timbres at
  equal loudness, sparse events and dense grooves.
- **Renderers**: fixed and abstract, one mapping each (the four in the viewer, plus particles and one composite
  scene), rendered offline at 60 fps and screened for flashes before anyone sees them.
- **Conditions**: no reaction (lower anchor), live RMS, MilkDrop bands, onset trigger with a BPM clock, the same
  offline, Playhead's matched curve, Playhead's curve shifted (negative control); every driver brought to the same
  5th to 95th percentile range, so that timing decides, not scale.
- **Design**: forced choice between two visuals of the same excerpt ("Which visual fits the music better?", then
  "follows the build-ups and section changes", "steadier", "hits the accents"), 30 to 60 judgements per condition,
  about 36 to 48 people online; a short 0 to 100 rating block with the anchors for effect sizes.
- **Analysis**: Bradley-Terry scaling with bootstrapped intervals, mixed-effects logistic models (participant, excerpt
  and renderer as random effects), results per kind of material; then test which of the measures above predict the
  choices, and keep only those for later regression tests.
