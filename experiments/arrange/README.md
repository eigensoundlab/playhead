# Do searched arrangements hold up when mixed?

`Playhead.arrange` judges arrangements of layers from the layers' documents alone. This experiment mixes what it
proposes and analyses the real mix, to see whether the measures and the ranking survive.

**Sessions.** 16 layered impacts, each built from four parts (sub, body, transient, tail) taken from CC0 Sonic Pi
samples.
- The first 8 are drum and percussion kits (those of [experiments/compose](../compose/README.md)).
- The other 8 were added for the [listening test](../listening/README.md), to vary the material: robot, glass and
  metal, tabla, guitar, cinematic bass, vinyl, electronic and choir.
- Each starts roughly placed. The sub sits at 0.1 s and every other part is up to 40 ms off, at its own level.

**Arrangements.** Up to 22 per session, 347 in all (some sessions gave fewer candidates; the glass and metal kit gave
none for big):
- the rough placement;
- the three best candidates of `arrange()` for each goal (punch, big, clean);
- 12 random placements within the search's limits (moves up to 0.25 s, gains −6 to +3 dB), so that the measures spread.

**Compared.**
- *Predicted* is `measureParts` on the parts' documents.
- *Rendered* is the parts mixed at those offsets and gains, analysed with the same profile, class and curve rate, and
  measured as one part.
- The rendered scores keep the predicted values of the three measures that are about the parts themselves (together,
  overlap, shared). A mix cannot show those, so the scores test the measures of the whole.

```sh
node experiments/arrange/arrange.js [sonic-pi-samples-dir]    # table on stdout, results.json next to this file
```

One run takes about 150 s: 347 mixes analysed at about 0.3 s each. Searching takes 0.15 s for 489 arrangements.

## Result (`results.json`)

Pearson r between predicted and rendered, with mean absolute error in brackets. The first two columns are the 8 drum
kits (175 arrangements) before and after the fix below; the last is all 16 kits (347 arrangements). The varied kits
widen the range of every measure, which raises r by itself; the errors are the fairer comparison.

| Measure of the whole | 8 kits, before the fix | 8 kits, after | 16 kits |
|---|---|---|---|
| Peak level (LUFS) | 0.956 (0.98 LU) | **0.993** (0.19 LU) | 0.991 (0.18 LU) |
| Rise (last 20 dB into the peak) | 0.463 (60 ms) | **0.898** (17 ms) | 0.987 (23 ms) |
| Contrast (peak over the 60–250 ms before) | 0.561 (12.3 dB) | **0.918** (5.7 dB) | 0.950 (4.5 dB) |
| Focus (peak over the 150–400 ms after) | 0.794 (1.6 dB) | **0.951** (0.6 dB) | 0.974 (0.5 dB) |
| Tail (to −30 dB) | 0.833 (0.12 s) | **0.896** (0.07 s) | 0.945 (0.06 s) |
| Spectral coverage | 0.707 | **0.972** | 0.993 |
| Low end (below 120 Hz) | 0.775 | **0.934** | 0.964 |
| Harshness | 0.945 (0.09) | 0.934 (0.09) | 0.951 (0.09) |

Scores per session, median Spearman rank correlation between predicted and rendered [range], and the sessions where
the best candidate still beats the rough placement once mixed:

| Goal | 8 kits, before the fix | 8 kits, after | 16 kits | Best beats rough, rendered (8 / 16 kits) | Median gain, predicted / rendered (16 kits) |
|---|---|---|---|---|---|
| punch | 0.86 [0.62, 0.90] | **0.94** [0.87, 0.99] | 0.94 [0.53, 1.00] | 8 of 8 / 15 of 16 | +0.12 / +0.10 |
| big | 0.72 [0.21, 0.81] | **0.92** [0.69, 0.97] | 0.93 [0.65, 0.98] | 7 of 8 / 12 of 15 | +0.13 / +0.11 |
| clean | 0.87 [0.60, 0.95] | **0.95** [0.83, 0.97] | 0.96 [0.83, 1.00] | 8 of 8 / 16 of 16 | +0.14 / +0.12 |

**Where the varied kits fall short.**
- *Cinematic bass* (a bass hit layered with a bass drop): the search predicts gains of 0.19 (punch) and 0.33 (clean),
  and the mixes keep 0.04 and 0.12. Its two low parts share their frequencies, and their phases add or cancel, which
  power sums cannot see (see Limits).
- *Guitar* (big, −0.09 once mixed) and *electronic* (big, −0.01): the long, pitched tails add less size in the mix
  than in the prediction.
- *Glass and metal* and *choir*: nothing to gain. The search finds arrangements within 0.01 of the rough placement,
  so their listening pairs are nearly the same sound.

**The fix.** The first run (before) found that a clip's document did not match its contribution to a mix.
- The cause: a file analysed alone started at full loudness, because the smoothing of the loudness curve began from the
  file's first frame. Inside a mix, the same clip rises from silence, and its first moments already enter the smoothing
  window 25 ms before its start.
- The effect: predicted peaks were up to 2 dB too high and 20–60 ms too early, and rises too short.
- Every measure is taken around the main peak, so a misplaced peak also moved the windows for coverage and low end.
- Playhead now treats a file as heard with silence before and after it: the loudness window counts silence beyond the
  ends, and the attack runs from silence through the half window before the start. This changes only the first and
  last moments of a file. On [experiments/compose](../compose/README.md), where the parts start in silence, the results
  are unchanged.
- *Together* now looks at every part in the main hit, not only the parts sounding at its peak. A part that comes in
  80 ms late used to be left out, which counted as together; now it counts against it.
- The "before" column is this experiment run with the earlier analysis and the earlier *together*.

**Reading.**
- From the documents alone, the search ranks arrangements nearly as their real mixes rank them.
- Its best candidate improves on a rough placement by about as much as it predicts (punch and clean) or by
  three-quarters of it (big).
- Level, focus and spectrum now carry over almost exactly.
- Rise and contrast carry over well (r 0.9). What remains is the 25 ms before a clip's start, which a document that
  begins at the clip cannot hold.
- Harshness ranks well but reads 0.09 too high on average. The parts' harshness above their own loudness does not fully
  add up in the sum.

**Limits.**
- What the measures say about punch, size and cleanness is not yet checked by listening. This experiment checks only
  that the search's view of an arrangement matches the arrangement mixed. The listening test in
  [experiments/listening](../listening/README.md) asks listeners, with these arrangements as its stimuli.
- Mono samples, power sums: the search does not see phase, so layers that cancel are not caught. SFX Workbench's
  "Align hits" handles that to the sample after the search.
- As a proxy for *together*, onsets of the rendered mix within 80 ms before its peak were counted. It did not separate
  arrangements: the onset detector merges layers that start within a few tens of milliseconds.
