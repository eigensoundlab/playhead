# Paper: outline

The LaTeX source of the first paper is kept in a separate repository (private until it is posted), which pins this software at version 0.1.0 and checks every quoted number against `experiments/`. This outline records the plan and the evaluation table.

Working title: **Playhead waveforms: interpretable overview curves and analysis-driven tools for music and game audio**

Author: Daniel Sandner (ORCID [0000-0002-1041-814X](https://orcid.org/0000-0002-1041-814X)). Licence: CC BY 4.0 (see `LICENSE.md`). Target length: 4–8 pages.

## Claim

A plain waveform shows level only. Calibrated feature lines over it (activity, tension, harshness, beats, sections, event type, and cross-field descriptors) carry information about what happens where that the waveform and standard features do not: measured objectively, without listeners, by analytic reference values, label-free self-checks, a held-out calibration and a labelled dataset. The same descriptors can locate and drive processing (gating, layer masks, automation) whose results are checked by re-measuring them and by asking how much of each change an ordinary static or dynamic EQ could have made.

Whether people read the strips faster is a separate, partly subjective question that depends on the interface; the paper proposes a protocol for it (below) rather than claiming it.

## Contributions

1. A small set of overview curves chosen for low redundancy with the waveform, with fixed absolute scales so assets in a library compare directly.
2. A sound-effect view for 0.5–5 s clips: event segmentation, Schaeffer-style tags (impulse / iterative / sustained × pitched / complex / varying), NMF layers and export QA.
3. A closed loop for analysis-driven tools (analyse, map, render, re-analyse, report), demonstrated with seven tools. Two use descriptors not previously found driving processing: psychoacoustic annoyance gating (de-harsh) and the tension curve (tension shaper). Each tool is placed against a hierarchy of ordinary EQ (static, ideal dynamic, ideal automation, all fitted to its output), and the annoyance detector is compared with a level detector driving identical processing.
4. Cross-field descriptors chosen for having analytic reference values (spectral kurtosis, envelope-spectrum repetition, STA/LTA burstiness and b-value, optimal-transport spectral velocity, cepstral peak prominence, time-irreversibility, predictive information rate, recurrence quantification, Klatzky damping), tested against those values rather than against thresholds tuned on test signals, and shown on ESC-50 to add class information beyond a 130-feature hand-crafted baseline.
5. Label-free self-checks for real libraries: edits whose correct answer is known by construction (level, shift, inserted events, reversal, speed change, joins, defects) give pass rates per asset class and a calibration loop with a held-out half.
6. An open, dependency-free browser implementation with synthetic CC0 test signals that have ground truth.

## Methods (one paragraph each)

- Features and frame rates; BS.1770 and ISO 532-1 loudness; sharpness, roughness and fluctuation strength; annoyance.
- Curves C1–C7 and the redundancy matrix (correlation of each curve and its derivative with the waveform envelope).
- Rhythm: onset envelope, tempogram with prior, dynamic-programming beats, local pulse, downbeats.
- Structure: self-similarity, checkerboard novelty, section labels.
- Sound effects: fine-resolution analysis, events, tags, layers, QA.
- Tools: STFT mask engine, gating and loudness matching, loop search, variation rules.

## Evaluation plan

| Question | Data | Measure |
|---|---|---|
| Do the descriptors match their analytic values? | Generated noises, tones, sweeps, click trains, modal synthesis (CC0) | Deviation from the reference value |
| Does label-free calibration generalise? | Tuning half vs held-out half of a library, stratified | Self-check pass rate, shipped vs frozen values (first result: 94.1 % → 95.8 % held out, 73 files; over 20 random splits the held-out gain is +1.54 ± 0.48 points, positive in all 20) |
| Do the descriptors carry information standard features lack? | ESC-50, 2,000 clips, 50 classes, official 5 folds (never used for design or calibration) | Accuracy with and without N1–N9 against MFCC (26) and librosa (130) baselines, paired McNemar test, add-one and drop-one families. First result: librosa 60.6 % → 66.8 % with the descriptors (p = 6e-13); MFCC + descriptors (74 features) 65.2 % beats librosa |
| Do they behave correctly on real audio? | Any library (CC0 Sonic Pi samples, librosa examples) | Self-check pass rates: invariance to level, sign flip under reversal, ×1.06 under speed change |
| Do the detectors work where truth is known? | Synthetic CC0 probes (this repo) | Beat and downbeat F-measure at ±70 ms, boundary hit rate at ±1 s, event and tag accuracy |
| Do the curves add information beyond the waveform? | Probes plus real music | Correlation with RMS envelope, and of first differences |
| Does the intensity curve follow listeners? | DEAM continuous arousal ratings | Correlation against a loudness-only baseline |
| Do beats and sections hold on real music? | Public beat-tracking and structure datasets | Standard MIR metrics against librosa / madmom baselines |
| Can the test battery be fooled? | ESC-50 negative controls: noise, shuffled descriptors, loudness copies (3 seeds each) | No control beats the baseline (55.8–59.9 % against 60.6 %); real descriptors beat every control at p ≤ 5e-15 |
| Proposed, not run: can people read the strips? | Task study, 12–20 participants | Accuracy and time on "where is the build-up / the drop / the second hit" at 48, 24 and 12 px height, against waveform only |
| How far is each tool from ordinary EQ? | 73 real files | Share of the spectrogram change reproduced by a static EQ, an ideal dynamic EQ and ideal third-octave automation (layer remix 84/86/95 %, de-harsh 72/81/88 %, attack and body 60/68/76 %, variations 34/50/54 %) |
| Does an analysis-driven trigger differ from a level trigger? | 52 real files, identical processing, two detectors | Overlap of open moments (median Jaccard 17 %); sharpness removed in the harshest 10 % (0.042 vs 0.018 acum) and in the calmer half (0 vs 0.010) at a smaller average cut |
| Do the tools do what the descriptors claim? | Kit and real assets | Descriptor change at matched loudness, plus a loudness-matched blind A/B listening test |

State plainly that thresholds were tuned on the synthetic kit, and report real-material results separately.

## Venues

- **DAFx27**, Cremona, Italy, 24–27 August 2027. Best fit: audio effects, analysis and perception, open access. Deadlines not yet published (DAFx26's was 30 March 2026).
- **Web Audio Conference**: short papers of 2–4 pages, CC-licensed proceedings, strong fit for the browser implementation. Next edition not yet announced.
- **ICAD 2027**: extended abstracts if framed as auditory display.
- **ISMIR 2027 late-breaking demo**: 2 pages, not archival.
- Preprint on **arXiv** (cs.SD, cross-list eess.AS) under CC BY 4.0, after checking the venue's preprint policy.

## Reproducibility

- Software archived on Zenodo: version 0.1.0 is [10.5281/zenodo.23932626](https://doi.org/10.5281/zenodo.23932626) (cite this one for the reported results); all versions [10.5281/zenodo.23932625](https://doi.org/10.5281/zenodo.23932625). Tag and archive a new version if the submitted results change.
- `npm test` reproduces the synthetic results. Figures are generated from the app's own rendering code.
