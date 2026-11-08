<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# The descriptor bench

A place to test Playhead's descriptors, old and new, against a truth known to the sample. Most sounds are grooves
built from synthesized drums: each hit starts rising at its first sample, and its time, band, place in the bar and
deviation from the grid are recorded as it is placed. A descriptor that claims to measure timing, swing, meter or
tempo is measured here before it is trusted on music, where the truth is a matter of annotation.

```sh
node experiments/bench/run.js        # the table below on stdout, results.json beside this file
```

`test/grid-tests.js` runs the main cases with every `npm test`, so a change to the analysis that breaks the timing,
the fills, the builds, the distortion cue, the pass-by or the rhythm signature fails there.

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
| fills | 16 bars at 112 BPM: a snare fill in every 4th bar (3, 7, 11, 15), bar 12 a break (the kick alone on 1) | pattern surprise, fills and breaks |
| swing-change | 16 bars at 100 BPM, straight for 8 bars, then swung 2:1 | swing per bar |
| straight-140 | the straight groove at 140 BPM | the rhythm signature at another tempo |
| riser | 4 s of groove, a 12 s build at one loudness (noise sweeping from 300 Hz to 8 kHz, a snare roll from 2 to 16 hits a second), a drop | a build that is not louder |
| swell | the same with more and more hits at an even brightness (hats from 4 to 16 a second, a snare roll, toms) | a build by density alone |
| timbres | 3 s blocks at one loudness: dark sines, bright sines, a rough tone (70 Hz modulation), a hard-clipped sawtooth | the distortion cue; no false builds from a change of colour |
| pass-by | a 180 Hz tone passing 20 m away at 25 m/s (Doppler shift and level), then a note with 6 Hz vibrato (±40 cents) and one with a 28 Hz rotor (±15 cents) | glides, the pass-by and its speed, vibrato and rotor rates |

The hats sit off the beats so that no hit hides another; where hits coincide in music (a kick and a hat on the
beat), Playhead sees one attack, in the band that rises most.

## The arrangement (`arrangement.js`)

A 64 s dance arrangement at 124 BPM, synthesized with its form known: intro (pad, hats), groove (kick on 1 and 3,
snare on 2 and 4, off-beat hats, bass), a fill, a break (pad and a source passing by at 25 m/s), a build (a snare roll
from quarters to 16ths under a riser, not louder), a drop (four-on-the-floor, 16th hats, an off-beat bass, a clipped
stab in its second half) and an outro. It runs in Node and in the browser, for the spectral views (`test/grid-tests.js`
checks the metrical spectrogram on it) and for the audiovisual comparison
([experiments/av](../av/README.md)). Analysed, its pass-by is placed within 0.03 s at 24.3 m/s, the fill and
the break are found, and the build is found from 29 to 37 s (true 31 to 39 s).

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
- **Changes**: the bars marked `fill` or `break`, precision and recall against the bars built so; swing per bar, the
  median error against each bar's true ratio.
- **Builds**: the builds found and their overlap with the true one (intersection over union); in the grooves, any
  build found is a false one.
- **Distortion**: how well the curve's mean per block tells the clipped blocks from the clean ones (AUC, 1 perfect).
- **Motion**: the pass-by's closest moment and speed; each vibrato's rate and depth (peak to peak).
- **Rhythm signature**: the similarity of each groove's signature to the straight groove's.

## Results: timing (Playhead 0.3.0+)

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

## Results: rhythm changes, builds and motion (Playhead 0.3.0+)

| Sound | fills and breaks found (precision, recall) | swing per bar (median error) | builds found (s) | build overlap | distortion AUC | pass-by: closest, speed (true) | vibrato: rate, depth (true) |
|---|---|---|---|---|---|---|---|
| straight, laid-back, pushed, loose, swing 1.5 to 3, waltz, sixteenths, pulses, no-beat, straight-140 | – | – | **none** | – | – | – | – |
| fills | bars 3, 7, 11 fill, 12 break (**1, 1**) | – | none | – | – | – | – |
| swing-change | – | **0** | none | – | – | – | – |
| riser | – | – | 2 to 14 | **0.71** | – | – | – |
| swell | – | – | 5 to 13 | **0.67** | – | – | – |
| timbres | – | – | 2 to 8 (false) | – | **1** | – | – |
| pass-by | – | – | none | – | – | **3.88 s, 19.6 m/s** (4 s, 25 m/s) | **6.1 Hz, 97 c** (6 Hz, 80 c); **29.5 Hz, 49 c** (28 Hz, 30 c) |

Rhythm signature, similarity to `straight`: straight-140 **0.988**, fills 0.998, waltz 0.924, sixteenths 0.909,
swing-2 0.859, snare-laid-back 0.784.

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
- **Fills and breaks** are found bar by bar with no false ones, and **swing per bar** follows a groove that starts
  straight and swings from bar 8 exactly. Bar 15's fill is the last bar and has no neighbour after it to stand out
  from.
- **Builds that are not louder** are found: a riser that only sweeps up and thickens at one loudness (overlap 0.71 with
  the true build: the 12 s found start 2 s early and end 2 s before the drop) and a swell of more and
  more hits (0.67). No groove has a false build. The timbre blocks have one (2 to 8 s), where dark, clipped and bright
  blocks follow each other as a staircase of brightness.
- **Distortion** tells every clipped block from every clean one at the same loudness (AUC 1), rough and bright ones
  included.
- **The pass-by** is placed 0.12 s from its closest moment, at 19.6 m/s where it went at 25: the speed comes from the
  pitch at both ends of the glide, which is never the full shift (the source is heard only from about 75 m), so it is a
  lower bound. **Vibrato** at 6 Hz and a **28 Hz rotor** are found at their rates (within 0.1 and 1.5 Hz), their depths
  read high (97 and 49 cents for 80 and 30).
- **The rhythm signature** finds the same groove 30 BPM faster alike (0.988) and a fill-only change nearly the same
  (0.998), but it separates weakly: a waltz (0.92) and 16ths (0.91) are not much further away, and a snare 25 ms late
  moves it more (0.78) than a change of meter. It is a shape of the attacks' autocorrelation, so microtiming shows in
  it. Comparing rhythms needs the grid's patterns as well.
- **Downbeat confidence** is low on these grooves (0.17 to 0.25): with the kick on 1 and 3, beats 1 and 3 look alike,
  and the confidence says so. The waltz, whose kick marks only beat 1, reaches 0.40. It needs calibrating on music.

## Limits

- Synthesized drums, mono, one sound per band; real kits overlap in bands and ring into each other.
- Hits that coincide are one attack; a flam closer than about 50 ms is one onset.
- The grid takes the low band (kick, bass) as its reference where a bar has some; music whose kick drags behind the
  rest reads as everything else being early.
- 8th-note swing only; 16th swing and swing that changes within a bar are not measured yet.
- One build, one pass-by and two vibratos: the thresholds are set on these and need music (EDM builds, field
  recordings of traffic, singers) before their values are trusted.
- The analysis now takes 1.8 to 2.7 s for 20 to 35 s of sound; the partial track (a 4096-point FFT per frame) is most
  of the added time.

## Next on the bench

Music with annotations (fills, builds and drops marked by ear), real drum kits, traffic and engine recordings; 16th
swing; a timbre staircase that should not count as a build.
