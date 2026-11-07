# Do searched arrangements hold up when mixed?

`Playhead.arrange` judges arrangements of layers from the layers' documents alone. This experiment mixes what it
proposes and analyses the real mix, to see whether the measures and the ranking survive.

**Sessions.** 8 layered impacts, each built from four parts (sub, body, transient, tail) taken from CC0 Sonic Pi
samples (the kits of [experiments/compose](../compose/README.md)). Each starts roughly placed. The sub sits at 0.1 s
and every other part is up to 40 ms off, at its own level.

**Arrangements.** 22 per session, 175 in all (one session gave only one candidate for punch):
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

One run takes about 70 s: 175 mixes analysed at about 0.3 s each. Searching takes 0.15 s for 489 arrangements.

## Result (`results.json`)

Pearson r between predicted and rendered over all 175 arrangements, with mean absolute error in brackets:

| Measure of the whole | Before the fix | After |
|---|---|---|
| Peak level (LUFS) | 0.956 (0.98 LU) | **0.993** (0.19 LU) |
| Rise (last 20 dB into the peak) | 0.463 (60 ms) | **0.898** (17 ms) |
| Contrast (peak over the 60–250 ms before) | 0.561 (12.3 dB) | **0.918** (5.7 dB) |
| Focus (peak over the 150–400 ms after) | 0.794 (1.6 dB) | **0.951** (0.6 dB) |
| Tail (to −30 dB) | 0.833 (0.12 s) | **0.896** (0.07 s) |
| Spectral coverage | 0.707 | **0.972** |
| Low end (below 120 Hz) | 0.775 | **0.934** |
| Harshness | 0.945 (0.09) | 0.934 (0.09) |

Scores per session, median Spearman rank correlation between predicted and rendered [range], and the sessions where
the best candidate still beats the rough placement once mixed:

| Goal | Before the fix | After | Best beats rough, rendered (after) | Median gain, predicted / rendered |
|---|---|---|---|---|
| punch | 0.86 [0.62, 0.90] | **0.94** [0.87, 0.99] | 8 of 8 | +0.12 / +0.12 |
| big | 0.72 [0.21, 0.81] | **0.92** [0.69, 0.97] | 7 of 8 | +0.18 / +0.13 |
| clean | 0.87 [0.60, 0.95] | **0.95** [0.83, 0.97] | 8 of 8 | +0.15 / +0.14 |

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
  that the search's view of an arrangement matches the arrangement mixed.
- Mono samples, power sums: the search does not see phase, so layers that cancel are not caught. SFX Workbench's
  "Align hits" handles that to the sample after the search.
- As a proxy for *together*, onsets of the rendered mix within 80 ms before its peak were counted. It did not separate
  arrangements: the onset detector merges layers that start within a few tens of milliseconds.
