<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Audiovisual Playhead

One scene, drawn twice from the same sound. On the left it reacts the way audio-reactive visuals usually do; on the
right it reacts to what Playhead found in the sound. Under each side, a timeline of what that side detected. For the
built-in demo, whose every part is known, a table of what each side found.

**Page:** [eigensoundlab.github.io/playhead/av/](https://eigensoundlab.github.io/playhead/av/), or locally
`npm run build:dist && node tools/serve.js 8080` and `http://localhost:8080/av/`. Open your own file from the Sound
menu. `?t=27` shows that moment without playing; `?gl` draws with WebGL 2 even where WebGPU is available.

## The two sides

The scene (`site/scene.js`) is one fragment shader, drawn with **WebGPU** where the browser has it and **WebGL 2** where
it does not; both draw the same picture (on one frame, a mean difference of 0.1 of 255 between the two). Its slots, and
what fills them on each side (`site/drivers.js`):

| Slot | In the scene | Usual audio-reactive | Playhead |
|---|---|---|---|
| level | overall brightness | RMS follower (10 ms attack, 250 ms release), automatic gain | `loudness` |
| 8 octaves | eight rings, low inside | WebAudio's AnalyserNode as visualisers read it (Blackman window, 2048-point FFT, smoothing 0.8, -100 to -30 dB), averaged per octave | `rhythm.spectral`: what hits on this 16th in each octave group, over a dim floor of what sounds; the mel spectrogram where there is no grid |
| kick, snare, hat | the centre punches; a shockwave; sparkles | MilkDrop's bass, mid and treble beats (a band 1.5 times over its 4 s average and rising, 120 ms apart) | `attacks`, to the sample; an attack drives every band it rises in by a fifth or more |
| the bar | a hand that goes round once a bar, and the bar's 16 steps | none: the hand spins with the level | `rhythm.downbeats` |
| colour | the palette | spectral centroid | `sections` (a hue per letter), shifted by `tension` |
| build | streaks running outward, rings widening | energy trend: the level over 2 s against its 16 s average | `buildup` |
| drop | a flash | a level jump (the 50 ms level 0.35 over the 2 s level) | the next section after a build, from a second before its end to four after |
| roughness | jagged ring edges | treble against its average | `distortion` and `timbreHarshness` |
| fill, break | sparkles; dimmed rings | none | `rhythm.bars[].change` |
| pass-by | a light crossing, blue as it comes, red as it goes | none | `glides` with `passBy` |

The usual side is worked out frame by frame (60 a second) without looking ahead, as a live visualiser is; it is
computed from the decoded sound rather than read from a playing AnalyserNode so that its timeline can be drawn whole
and the page can show any moment, but it is the same arithmetic. Playhead's analysis runs once, in a worker, before
playing. "Reduce flashing" (on by default) caps the drop's flash.

## The demo

[`experiments/bench/arrangement.js`](../bench/arrangement.js): 64 s at 124 BPM, synthesized in the page with every hit
and the form known. Intro (pad, hats), groove (kick on 1 and 3, snare on 2 and 4, off-beat hats, bass), a fill, a break
with a source passing 20 m away at 25 m/s, a build (a snare roll from quarters to 16ths under a riser, not louder), a
drop (four-on-the-floor, 16th hats, an off-beat bass, a hard-clipped stab in its second half), an outro.

What each side found (`test/grid-tests.js` checks the Playhead column):

| | Usual audio-reactive | Playhead |
|---|---|---|
| Kicks (79) | 79 (129 triggers), +9 ms | 79 (136 triggers), 0 ms |
| Snares (81) | 34 (119 triggers), +8 ms | 81 (165 triggers), 0 ms |
| Hats (190) | **185** (186 triggers), +5 ms | 123 (164 triggers), -6 ms |
| Section changes (5) | no such signal | 4, none other |
| Fill and break | no such signal | both |
| Build (31.0 to 38.7 s) | energy trend 0.57 inside, 0.54 elsewhere | 29.0 to 36.9 s, overlap 0.61 |
| Drop (38.7 s) | no level jump there (6 elsewhere) | 14 ms off |
| Pass-by (27.1 s, 25 m/s) | no such signal | 23 ms off, 24.3 m/s |
| Distortion (the stab) | treble roughness 0.38 in it, 0.29 before | distortion 0.16 in it, 0.08 before |

A beat or attack counts for a hit from 125 ms before it to 45 ms after (ITU-R BT.1359); the latency is the median over
the hits found.

## What it shows

- **Where the music is, Playhead's side knows it.** Kicks and snares land on their attacks with no latency; the hand
  keeps the bar; the colours change with the sections; the drop flashes on the drop, the fill and the break show, and
  the pass-by crosses the scene at the moment it passes. The usual side has no signal for sections, fills, breaks or a
  pass-by, flashes on level jumps in the first 20 seconds and not at the drop, and its energy trend does not tell the
  build from the rest, since the build is not louder.
- **Snares the usual way are mostly missed**: the mid band jumping over its own average fires 119 times but on only
  34 of the 81 snares.
- **Hats the usual way are better here** (185 of 190 against 123): synthetic hats alone in the treble band are what a
  treble beat detector is made for. Playhead has no onset of its own for 41 of them (quiet 16ths right after an open
  hat), and some others are the attack of a kick or snare struck at the same moment in which the high band rises by
  less than a fifth. On real hi-hats, which ring into each other, this is to be measured.
- **The rings tell two different stories.** The analyser's octaves are all lit most of the time (energy smears across
  the frame); Playhead's octaves pulse each on its own 16ths, so the kick ring beats four to the bar in the drop, the
  off-beat bass ring between, the hat rings on the 8ths: the metrical spectrogram, moving.
- **Distortion inside a mix is weakly seen** by both: Playhead's cue doubles in the stab (0.08 to 0.16) but stays low,
  since it looks for clipping of the whole signal and a flattened crest, and a clipped instrument under a clean master
  shows neither.

## Limits

- One synthesized arrangement with known parts; music needs annotations (fills, builds and drops marked by ear) before
  these numbers mean much beyond it.
- The usual side is one reasonable set of settings (thresholds, time constants); visualisers tune these per set.
- No viewing test yet: the protocol in [experiments/visuals](../visuals/README.md) applies, with this scene as a
  renderer.
