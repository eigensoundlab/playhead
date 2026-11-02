# Paper: outline

Working title: **Playhead waveforms: interpretable overview curves and analysis-driven tools for music and game audio**

Author: Daniel Sandner. Licence: CC BY 4.0 (see `LICENSE.md`). Target length: 4–8 pages.

## Claim

A plain waveform shows level only. One or two calibrated feature lines over it (activity, tension, harshness, beats, sections, event type) let a person tell what happens where in a music cue or a short game sound at a glance. The same descriptors can drive editing and mixing tools whose results are checked by re-measuring them.

## Contributions

1. A small set of overview curves chosen for low redundancy with the waveform, with fixed absolute scales so assets in a library compare directly.
2. A sound-effect view for 0.5–5 s clips: event segmentation, Schaeffer-style tags (impulse / iterative / sustained × pitched / complex / varying), NMF layers and export QA.
3. A closed loop for analysis-driven tools (analyse, map, render, re-analyse, report), demonstrated with seven tools. Two use descriptors not previously found driving processing: psychoacoustic annoyance gating (de-harsh) and the tension curve (tension shaper).
4. An open, dependency-free browser implementation with synthetic CC0 test signals that have ground truth.

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
| Do the detectors work where truth is known? | Synthetic CC0 probes (this repo) | Beat and downbeat F-measure at ±70 ms, boundary hit rate at ±1 s, event and tag accuracy |
| Do the curves add information beyond the waveform? | Probes plus real music | Correlation with RMS envelope, and of first differences |
| Does the intensity curve follow listeners? | DEAM continuous arousal ratings | Correlation against a loudness-only baseline |
| Do beats and sections hold on real music? | Public beat-tracking and structure datasets | Standard MIR metrics against librosa / madmom baselines |
| Can people read the strips? | Task study, 12–20 participants | Accuracy and time on "where is the build-up / the drop / the second hit" at 48, 24 and 12 px height, against waveform only |
| Do the tools do what the descriptors claim? | Kit and real assets | Descriptor change at matched loudness, plus a loudness-matched blind A/B listening test |

State plainly that thresholds were tuned on the synthetic kit, and report real-material results separately.

## Venues

- **DAFx27**, Cremona, Italy, 24–27 August 2027. Best fit: audio effects, analysis and perception, open access. Deadlines not yet published (DAFx26's was 30 March 2026).
- **Web Audio Conference**: short papers of 2–4 pages, CC-licensed proceedings, strong fit for the browser implementation. Next edition not yet announced.
- **ICAD 2027**: extended abstracts if framed as auditory display.
- **ISMIR 2027 late-breaking demo**: 2 pages, not archival.
- Preprint on **arXiv** (cs.SD, cross-list eess.AS) under CC BY 4.0, after checking the venue's preprint policy.

## Reproducibility

- Tag a release for the submitted version and archive it with Zenodo (gives a DOI for the code).
- `npm test` reproduces the synthetic results. Figures are generated from the app's own rendering code.
