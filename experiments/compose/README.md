# Combining Playheads without analysing the mix again

Can a mix's Playhead be predicted from its parts' documents? Each session is built from parts: 6 music sessions of 12
bars (kick, snare, hats, bass, pad, lead) and 8 layered impacts (sub, body, transient, tail), all from CC0 Sonic Pi
samples. Every part and the true mix (their sum) are analysed with the same profile and asset class, and the mix's
document is predicted from the parts' documents alone.

```sh
node experiments/compose/compose.js [sonic-pi-samples-dir]    # table on stdout, results.json next to this file
```

The samples come with `tools/fetch-corpus.sh`; ffmpeg decodes them. One run takes about 80 s.

**Rules.** Short-term loudness (LUFS) and the mel spectrogram by power sum; the 0–1 curves by the maximum of the parts,
their loudness-weighted mean, or the loudest part's value (loudness also mapped from the summed LUFS); onset strength by
sum; onsets and events by the union of the parts', merged within 30 ms. Measures: Pearson r over the frames where the
mix sounds, mean absolute error, and F-measure at ±50 ms.

## Result (`results.json`, Playhead 0.2.0)

Median over the sessions, [range]:

| Measure | Rule | Music (6) | Impacts (8) |
|---|---|---|---|
| Spectral change (flux) | summed spectra | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| Loudness, LUFS | power sum | r 0.94 [0.90, 0.99], 1.0 LU | r 1.00 [1.00, 1.00], 0.2 LU |
| Loudness curve | from summed LUFS | 0.93 [0.88, 0.98] | 1.00 [0.99, 1.00] |
| Arousal | max | 0.87 [0.36, 0.94] | 0.99 [0.85, 1.00] |
| Onsets (F) | union | 0.85 [0.77, 0.96] | 0.93 [0.46, 1.00] |
| Activity | max | 0.84 [0.76, 0.90] | 0.92 [0.79, 1.00] |
| Harshness | weighted mean | 0.80 [0.73, 0.92] | 0.98 [0.96, 1.00] |
| Onset strength | sum | 0.76 [0.73, 0.79] | 0.95 [0.82, 0.99] |
| Tension | max | 0.72 [0.43, 0.80] | |
| Surprise | max | 0.51 [0.20, 0.80] | |
| Events (F) | union | 0.49 [0.40, 0.73] | 0.57 [0.33, 1.00] |

The mel spectrogram sums to within 0.4 dB of the mix's (its storage step is 0.31 dB). The loudest part's onsets alone
reach F = 0.38 (music) and 0.86 (impacts). Prediction takes 2–6% of the time of analysing the mix.

**Reading.** Energy adds, so level, spectrum and anything derived from the spectrum compose from the parts almost
exactly. Perceptual curves compose roughly by simple rules. What depends on context does not: surprise is novelty
against the past, tension follows harmony over time, and events are grouped differently in the mix (three layers struck
together are one event). Computing curves on summed features, rather than combining finished curves, is the next step.

**Limits.** Synthetic arrangements from samples; no shared sources between parts (phase), no bus processing. Playhead's
activity curve is not the stored spectrogram's flux (r = 0.34 music, 0.62 impacts, even on the mix itself), so it cannot
be recomputed from what the document stores today.
