<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# The descriptor bench

A place to test Playhead's descriptors, old and new, against a truth known to the sample. The sounds are grooves
built from synthesized drums: each hit starts rising at its first sample, and its time, band, place in the bar and
deviation from the grid are recorded as it is placed. A descriptor that claims to measure timing, swing, meter or
tempo is measured here before it is trusted on music, where the truth is a matter of annotation.

```sh
node experiments/bench/run.js        # the table below on stdout, results.json beside this file
```

`test/grid-tests.js` runs nine of the sounds with every `npm test`, so a change to the analysis that breaks the timing
fails there.

## Sounds (`stimuli.js`)

| Sound | What it is | What it tests |
|---|---|---|
| straight | rock beat at 110 BPM: kick on 1, 3 and the "and" of 3, snare on 2 and 4, hats on the off-beat 8ths | the baseline: every deviation 0 |
| snare-laid-back | the same, the snare 25 ms late | offsets per band |
| hats-pushed | the same, the hats 15 ms early | offsets per band |
| loose | the same, every hit moved by a random 12 ms (SD) | tightness |
| swing-1.5, swing-2, swing-3 | 100 BPM, the off-beat 8ths swung to 1.5, 2 (triplet) and 3 (dotted) | swing ratio |
| waltz | 3/4 at 132 BPM | meter, downbeats |
| sixteenths | 96 BPM with 16th hats | the grid with dense hits |
| pulse-32, pulse-480 | clicks at 32 and 480 BPM | the tempogram's range |
| no-beat | hits at random times | pulse clarity without a pulse |

The hats sit off the beats so that no hit hides another; where hits coincide in music (a kick and a hat on the
beat), Playhead sees one attack, in the band that rises most.

## What is measured

- **Onsets**: the share of hits found within 50 ms; the error of the analysis's onsets (11.6 ms frames) and of the new
  attacks (refined to the sample), median and 90th percentile.
- **Bands**: for hits with no other hit within 15 ms, whether the attack's band is the hit's (kick low, snare mid,
  hats high).
- **Rhythm**: tempo, beats per bar, the share of bar starts with a downbeat within 70 ms, downbeat confidence, swing
  ratio, tightness, and the mid and high bands' offsets from the low band.
- **Pulse clarity**: the mean of the new curve.
- **Tempogram**: the strongest tempo, against the true one (octaves allowed: an autocorrelation tempogram favours half
  the tempo).

## Results (Playhead 0.3.0+)

| Sound | old onsets: error | attacks: error (median, 90 %) | bands | bars of | downbeats | swing (true) | tightness ms | mid, high offset ms (true) | pulse clarity | tempogram top |
|---|---|---|---|---|---|---|---|---|---|---|
| straight | 14.5 ms early | 0.7, 4.7 ms | 100 % | 4 | 100 % | 1 (1) | 0.4 | -1.7, -0.4 (0, 0) | 0.58 | 55 (half) |
| snare-laid-back | 14.2 ms early | 0.6, 4.7 ms | 100 % | 4 | 100 % | 1 (1) | 0.1 | **24.9**, -0.4 (25, 0) | 0.58 | 55 (half) |
| hats-pushed | 14.7 ms early | 0.7, 10.6 ms | 95 % | 4 | 100 % | 1 (1) | 0.6 | -1.7, **-15.3** (0, -15) | 0.59 | 55 (half) |
| loose | 15.0 ms early | 0.6, 7.9 ms | 94 % | 4 | 100 % | 1 (1) | **10.9** (12) | -5.7, 0.7 (0, 0) | 0.54 | 55 (half) |
| swing-1.5 | 14.6 ms early | 0.5, 2.0 ms | 100 % | 4 | 100 % | **1.535** (1.5) | 0.1 | -1.0, -3.7 | 0.53 | 50 (half) |
| swing-2 | 13.7 ms early | 0.5, 4.2 ms | 100 % | 4 | 100 % | **2.036** (2) | 1.5 | -2.1, -2.7 | 0.50 | 50 (half) |
| swing-3 | 14.6 ms early | 0.5, 6.2 ms | 100 % | 4 | 100 % | **3.072** (3) | 2.1 | -3.0, -3.0 | 0.47 | 50 (half) |
| waltz | 12.5 ms early | 0.6, 1.3 ms | 100 % | **3** | 100 % | 1 (1) | 0.3 | -0.1, -0.6 | 0.81 | 131 |
| sixteenths | 14.2 ms early | 0.7, 23.1 ms | 96 % | 4 | 100 % | – | 0.1 | -0.1, -0.4 | 0.81 | 95 |
| pulse-32 | 9.8 ms early | 0.7, 0.7 ms | 100 % | | | | | | 0 | **32** |
| pulse-480 | 14.2 ms early | 0.7, 0.7 ms | 100 % | | | | | | 0.84 | **480** |
| no-beat | 15.2 ms early | 0.5, 2.1 ms | 100 % | | | | | | **0.29** | – |

## What it shows

- **Attacks to the sample.** The analysis's onsets come about 14 ms before the sound (they are frame times); the
  attacks are within 0.5 to 0.7 ms (median), which is the resolution microtiming needs (shifts of 15 to 25 ms change
  how listeners rate a groove, and jazz soloists delay their downbeats by about 30 ms).
- **Offsets and tightness come out as built**: a snare 25 ms behind the kick reads 24.9 ms, hats 15 ms ahead -15.3 ms,
  random 12 ms timing a tightness of 10.9 ms, a straight groove 0.1 to 2 ms.
- **Swing** within 0.07 of the true ratio from 1.5 to 3, and straight grooves read as 1.
- **3/4** is told from 4/4 in the waltz, with every downbeat right.
- **The tempogram** now reaches a 32 BPM pulse and a 480 BPM roll, which the old 40 to 240 BPM range could not show.
- **Pulse clarity** is low without a pulse (0.29) and 0.47 to 0.84 with one.
- **Downbeat confidence** is low on these grooves (0.17 to 0.25): with the kick on 1 and 3, beats 1 and 3 look alike,
  and the confidence says so. The waltz, whose kick marks only beat 1, reaches 0.40. It needs calibrating on music.

## Limits

- Synthesized drums, mono, one sound per band; real kits overlap in bands and ring into each other.
- Hits that coincide are one attack; a flam closer than about 50 ms is one onset.
- The grid takes the low band (kick, bass) as its reference where a bar has some; music whose kick drags behind the
  rest reads as everything else being early.
- 8th-note swing only; 16th swing and swing that changes within a bar are not measured yet.

## Next on the bench

The descriptors the research report names, each to be added as a measure here first: a swing curve over time,
pattern surprise from bar to bar (fills and breaks), per-band bar rasters as groove templates, the scale transform for
comparing rhythms at any tempo, glides and pass-bys (instantaneous frequency), micro-Doppler (rotors, engines) from
the modulation spectrogram, a build detector for builds that are not louder, and a distortion cue for harshness.
