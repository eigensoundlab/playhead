<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Audiovisual Playhead

One scene, drawn twice from the same sound by the same rules. On the left the rules run on the signals audio-reactive
visuals usually have, worked out live; on the right on what Playhead found in the sound, known in advance. Under each
side, a timeline of what that side detected and what its rules did. For the three built-in demos, whose every part is
known, a table of what each side found. The rules can be edited and exported as a cue sheet for a game engine
([docs/GAMES.md](../../docs/GAMES.md)).

**Page:** [eigensoundlab.github.io/playhead/av/](https://eigensoundlab.github.io/playhead/av/) (linked from the app's
footer), or locally `npm run build:dist && node tools/serve.js 8080` and `http://localhost:8080/av/`. Open your own file
from the Sound menu. In the address: `?demo=rhythm|melodic|sfx`, `?scene=rings|ribbon|forge`, `?preset=` a rule set,
`?t=27` to show that moment without playing, `?gl` to draw with WebGL 2 even where WebGPU is available.

## The two sides

The scenes (`site/scene.js`) are fragment shaders written once and drawn with **WebGPU** where the browser has it and
**WebGL 2** where it does not (the WGSL is generated from the GLSL), from the same 88 numbers per frame. Some of what
they draw follows the sound all the time; the rest is done by the rules.

**All the time** (`site/drivers.js`):

| In the scene | Usual audio-reactive | Playhead |
|---|---|---|
| overall brightness | RMS follower (10 ms attack, 250 ms release), automatic gain | `loudness` |
| 8 octaves (rings, bars, the fire) | WebAudio's AnalyserNode as visualisers read it (Blackman window, 2048-point FFT, smoothing 0.8, -100 to -30 dB), averaged per octave | `rhythm.spectral`: what hits on this 16th in each octave group, over a dim floor of what sounds; without a grid, each band's hits over the mel spectrogram |
| the bar (a hand going round, 16 steps) | none: the hand spins with the level | `rhythm.downbeats` |
| the tune (the ribbon's line) | the loudest bin of the analyser | the `pitch` curve (the strongest partial) |

**The rules.** When an event happens, an action: by an amount, for a length, in a shape (pulse, hold, ramp, swell,
fade), at the event or before or after it in seconds, beats or bars. Mappings make an action follow a signal. The
actions are what the scenes can do: flash, darken, punch, shockwave, sparks, palette, streaks, shake, glow, smoke,
rough, pass, ripple, tint, and `event` (a named game event, in the cue sheet only). On the usual side each event and
signal is the nearest usual one, live:

| Rule on | Usual side | Playhead |
|---|---|---|
| `hit.low`, `hit.mid`, `hit.high` | MilkDrop's bass, mid and treble beats (a band 1.5 times over its 4 s average and rising, 120 ms apart) | `hits`, each band's own onsets to the sample; low and mid without what another band's attack leaks into them |
| `attack`, `sound` | any band's beat | `attacks`; `events` (a sound's start, snapped to its attack) |
| `drop` | a level jump (the 50 ms level 0.35 over the 2 s level) | the end of a build marked `drop` |
| `beat`, `bar`, `section`, `build`, `fill`, `break`, `peak`, `tail`, `glide`, `passBy`, `vibrato`, `layer` | none | the rhythm, the form, each sound's loudest moment and its after-effect, the partial's motion |
| signal `loudness` | the level | `loudness` |
| `buildup` | the energy trend (the level over 2 s against its 16 s average) | `buildup` |
| `distortion`, `harshness` | treble against its average | `distortion`, `harshness` |
| `tension` | damped bass | `tension` |
| `brightness` | the spectral centroid | the mel spectrum's centre |
| `pitch`, `pitchMotion` | the loudest bin, its motion | `pitch` and its motion |
| `novelty`, `surprise` | none | `structureNovelty`, `surprise` |

The editor names the usual equivalent beside each rule, in red where there is none. A live source cannot look ahead:
a cue set before its event starts at the event (with a ramp, briefly), and a cue as long as its event lasts half a
second, since the event's end is not known yet.

The usual side is worked out frame by frame (60 a second) without looking ahead, as a live visualiser is; it is
computed from the decoded sound rather than read from a playing AnalyserNode so that its timeline can be drawn whole
and the page can show any moment, but it is the same arithmetic. Playhead's analysis runs once, in a worker, before
playing. "Reduce flashing" (on by default) caps the flashes.

**Both sides start alike.** Before the first frame neither side has heard anything. The usual side's averages are the
mean of what it has heard so far until their window is full, and its automatic gain starts from a reference of
-20 dBFS RMS; a first version let them rise from zero, which in the first seconds read as a full level, a build
(streaks) and a level-jump flash, and hid that its energy trend does rise in the build (0.50 inside, 0.27 elsewhere;
it was 0.57 against 0.54). Where a side knows no bar (the usual side never, Playhead's before its first trusted
downbeat) its hand spins with its level by the same rule. What still differs at the start is what each side reads.

## Rule sets

| Preset | For | What it does |
|---|---|---|
| Rhythm: Playhead's reading | the rings | punches on low hits, shockwaves on mid hits, sparks on high hits, the palette on sections, streaks over builds, a flash on the drop, sparks over fills, darkness over breaks, the pass-by light; distortion roughens |
| Rhythm: the usual mapping | the rings | what a usual visualiser does: three band beats, a flash on level jumps, streaks from the energy trend, the tint from the centroid |
| Anticipation | any | cues that land on the moment: darkening for the two bars before a drop, the palette turning over the beat before a section, a punch each bar |
| Game: the furnace | the forge | a game scene's director: sparks on hats, glow on kicks, the palette on new sections, smoke on repeats, darkening over builds, a flash, a shake and an `eruption` event on the drop, a shockwave over fills |
| Melody | the ribbon | the palette on phrases, streaks over slides, ripples over vibrato at its rate, sparks on notes, a glow each bar |
| Sound effects: weapon | the forge | a flash on each shot, a punch on its boom, a shake on its peak, smoke over its after-effect, sparks on the bolt's clicks |
| Sound effects: impacts and explosions | the forge | a flash, a shockwave and a shake on the peak, a punch on the boom, sparks, smoke and a fading glow over the after-effect |
| Sound effects: devices and vehicles | the forge | streaks rising over a spin-up and falling over a spin-down, ripples at the rotor's rate, the pass-by light, smoke after |

The presets are starting points: change any rule, add rules and mappings, and export. "Export the cue sheet" saves the
cues the rules make on Playhead's side with their times (the format in [GAMES.md](../../docs/GAMES.md#the-cue-sheet));
"Copy the rules" gives the JSON that `playhead cues --rules` reads.

## The scenes

- **Rings** (rhythm): eight rings are eight octaves, low inside; a hand goes round once a bar; the centre punches,
  waves run out, sparks fly, streaks rush past.
- **Ribbon** (melody): the tune as a line over the last three seconds, octave bars below; slides streak, vibrato
  ripples the line at its own rate, notes spark at the line's head.
- **Forge** (sound effects, a game scene): a brick wall with an arched furnace whose fire follows the glow, the low
  octaves and the punches; sparks fly from it, shock rings run out, smoke rises over an after-effect, heat roughens the
  air, a light crosses for a pass-by.

## The demos

Three sounds synthesized in the page, with every part known (`experiments/bench`; `test/grid-tests.js` and
`test/cues-tests.js` check the Playhead column).

**Rhythm** ([`arrangement.js`](../bench/arrangement.js)): 64 s at 124 BPM. Intro (pad, hats), groove (kick on 1 and 3,
snare on 2 and 4, off-beat hats, bass), a fill, a break with a source passing 20 m away at 25 m/s, a build (a snare
roll from quarters to 16ths under a riser, not louder), a drop (four-on-the-floor, 16th hats, an off-beat bass, a
hard-clipped stab in its second half), an outro.

| | Usual audio-reactive | Playhead |
|---|---|---|
| Kicks (79) | 79 (129 triggers), +9 ms | 79 (137 triggers), 0 ms |
| Snares (81) | 29 (119 triggers), +8 ms | 80 (159 triggers), -1 ms |
| Hats (190) | 133 (186 triggers), +9 ms | **168** (237 triggers), -1 ms |
| Section boundaries (5) | no such signal | 5, one other |
| Fill and break | no such signal | both, no other fill |
| Build (31.0 to 38.7 s) | energy trend 0.50 inside, 0.27 elsewhere (no start, end or drop) | 30.96 to 38.70 s, overlap 1.00 |
| Drop (38.7 s) | no level jump there (5 elsewhere) | 14 ms off |
| Pass-by (27.1 s, 25 m/s) | no such signal | 23 ms off, 24.3 m/s |
| Distortion (the stab) | treble roughness 0.38 in it, 0.29 before | distortion 0.17 in it, 0.08 before |

**Melody** ([`melodic.js`](../bench/melodic.js)): 45 s at 90 BPM, four phrases (A, A', B, A); a lead with vibrato at
5.5 Hz on its long notes, legato slides in the B phrase and a long fall at the end, over soft chords, a light kick, a
rim on 2 and 4 and a shaker.

| | Usual audio-reactive | Playhead |
|---|---|---|
| Pitch on the notes (within 50 cents) | 92 % (the loudest bin) | 94 % |
| Note starts (38) | 1 (1 trigger) | 31 (36 triggers), +1 ms |
| Slides of 0.2 s and more (6) | no such signal | 4, one other |
| Vibrato on the long notes (17, 5.5 Hz) | no such signal | 17, at 5.52 Hz |
| Phrases (3 boundaries) | no such signal | 3 within a beat, 8 other boundaries |

**Sound effects** ([`sounddesign.js`](../bench/sounddesign.js)): 32 s. A shot (a crack, a boom falling from 110 to
42 Hz, a two-click bolt, a reverberant tail), a burst of three, a motor that spins up, runs with a 24 Hz rotor and spins
down, a vehicle passing at 25 m/s, a distorted alarm, a metal hit, a wooden knock and an explosion with a long tail.

| | Usual audio-reactive | Playhead |
|---|---|---|
| Shots and the explosion (5) | 5 (58 triggers), 0 ms | 5 (28 triggers), -1 ms |
| Booms (low hits at them) | 5 (25 triggers), +17 ms | 5 (20 triggers), -1 ms |
| Bolt clicks (4) | 4 (23 triggers), +3 ms | 4 (79 triggers), -1 ms |
| After-effects (the tails of 3 sounds) | no such signal | 3, and 2 more sounds' |
| Motor spin-up and spin-down | no such signal | both (7.6 to 9.1 s and 12.3 to 13.6 s; built 7.5 to 9.1 and 12.3 to 13.7) |
| Rotor (24 Hz) | no such signal | 24.2 Hz |
| Pass-by (16.5 s, 25 m/s) | no such signal | 49 ms off, 21.6 m/s |
| Distortion (the alarm) | treble roughness 0.60 in it, 0.02 elsewhere | distortion 0.60 in it, 0.03 elsewhere |

A beat or hit counts for a true one from 125 ms before it to 45 ms after (ITU-R BT.1359), one for one (closest pairs
first); the latency is the median over those found. A first version of the rhythm table matched each true hit to any
trigger in its window, so with 16th hats 121 ms apart one trigger could count for two hats: it gave the usual side
185 of 190 hats where one for one it finds 133.

## What it shows

- **Where the music is, Playhead's side knows it.** Kicks, snares and hats land on their hits with no latency; the
  hand keeps the bar; the colours change with the sections; the build runs exactly from its section start to the drop
  and the drop flashes on it, the fill and the break show, and the pass-by crosses the scene at the moment it passes.
  The usual side has no signal for sections, fills, breaks or a pass-by; it flashes on level jumps (the groove's entry
  and four others) but not at the drop; its energy trend does rise in the build (0.50 against 0.27 elsewhere), though
  it gives no start, end or drop, since the build is not louder.
- **Cues before their moment.** Only a side that knows the drop in advance can darken for the two bars before it and
  be full on it (the Anticipation rules); live, the same rule starts at the drop.
- **Snares the usual way are mostly missed**: the mid band jumping over its own average fires 119 times but on only
  29 of the 81 snares. **Hats**: Playhead's high-band hits find 168 of 190, the usual treble beats 133; Playhead's
  layers fire more often than there are hats (237 triggers), since a snare's noise rises above 2 kHz as well.
- **A tune**: the loudest bin follows the melody nearly as well as Playhead's pitch (92 against 94 % of the note time
  within 50 cents), so a line drawn from it looks right; what it lacks is the notes' starts (it barely jumps on a
  legato tune), the slides, the vibrato and its rate, and the phrases.
- **Sound effects**: the usual beats find every shot, boom and bolt click too, 17 ms late on the booms and with twice
  the triggers; what they cannot give is the after-effect, the motor's spin-up and spin-down, the rotor's rate, the
  pass-by, or a peak and a tail per sound for a cue to start from.
- **Where Playhead does not win.** Distortion of a whole sound is a tie (the alarm: 0.60 on both sides); distortion of
  one part inside a mix is weakly seen by both (the stab: Playhead's cue doubles but stays low, since it looks for
  clipping of the whole signal and a flattened crest; separating the harmonic part from the drums before measuring is
  the next thing to try). The high band's hits include the snare's noise. On the melody: 8 boundaries more than the 3
  phrase starts; 4 of the 6 slides (the two 0.2 s slides 2 semitones down are missed, and the found ones are cut
  short: 2.7 of 5 semitones, 1.8 of 3); 31 of the 38 note starts, the 7 others being the notes slid into, which have
  no attack of their own.

## Limits

- Three synthesized demos with known parts; music and sound effects need annotations (fills, builds and drops, tails
  marked by ear) before these numbers mean much beyond them.
- The usual side is one reasonable set of settings (thresholds, time constants); visualisers tune these per set.
- No viewing test yet: the protocol in [experiments/visuals](../visuals/README.md) applies, with these scenes as
  renderers.
