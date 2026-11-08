# Working with Playhead's curves in REAPER

Playhead turns a sound into curves: lines from 0 to 1 that follow how loud, busy, harsh or tense it is at each
moment. In REAPER they become ordinary automation envelopes on the **Playhead Control** effect, from where they can
move any parameter of any effect, or be sent as MIDI CC. This guide goes from writing a curve to using it, then gives
recipes.

## 1. The curves

| Name | What it follows |
|---|---|
| `loudness` | perceived loudness on a dB-like scale (`lufs`: the same in LUFS, written from -60 to 0) |
| `activity` | how busy the sound is: onsets and spectral change, not its level |
| `arousal` | energy and excitement: loudness, activity and sharpness together |
| `harshness` | loudness weighted by how unpleasant it is (sharpness, roughness, fluctuation) |
| `tension` | build-ups and releases: the trend of loudness, sharpness and roughness (and in music, harmony) |
| `harmonicTension` | (music) dissonance and distance from the key |
| `surprise` | how unexpected each moment is against the recent past |
| `timbreHarshness` | how harsh the sound's colour is at any level (sharpness, roughness, fluctuation without loudness) |
| `distortion` | clipping and saturation: 0 clean, about 0.7 hard-clipped |
| `pitchSlope` | the strongest partial's motion (glides, sirens, Doppler), written from -12 to 12 semitones a second |
| `pitch` | the strongest partial's pitch (a melody's contour, an engine's speed), written as MIDI notes from 36 to 96 (C2 to C7) |
| `onsetStrength` | where the hits and attacks are; `onsetLow`, `onsetMid`, `onsetHigh` the same for kick, snare and hats |
| `structureNovelty`, `localPulse`, `pulseClarity` | (music) where a section changes; how clear and strong the beat is; how clearly a beat is felt |
| `buildup` | (music) how far into a build the music is: a ramp from the build's start to its drop, 0 elsewhere |
| `patternSurprise`, `swing` | (music, per bar) how far the bar's drum pattern is from the bars before (fills and breaks); the bar's swing |
| `n1Kurtosis` ... `n8Recurrence` | descriptors: impulsiveness (clicks, crackle), repetition rate, spectral motion, periodicity, phase coherence, time arrow, surprisal, recurrence |

**Playhead - Strip window** shows any of them over the item (look code `lane:<curve>`, for example
`wave lane:harshness lane:tension`). Look there first to pick the curve that moves where you want something to move.

## 2. Writing curves

1. Select the item (or several: each is written over its own time range).
2. Run **Playhead - Write curves as automation**. Unanalysed items are analysed first.
3. Put a curve in a slot, by name or label (`harshness`, `tension`, `onset` ...). Up to eight slots; an empty slot is
   left as it is. The dialog remembers your last answers.
4. Choose the options:
   - **Scaling.**
     - `fixed` writes the curve as the strip shows it, so the same value means the same thing on every file.
     - `item` stretches the curve so that the item's own 5th to 95th percentile spans 0 to 1. This uses a parameter's
       whole range on quiet or uniform material.
   - **Point tolerance** (0.01) and **most points** (2000): how closely the envelope follows the curve. Use 0 for
     sharp attacks (onset strength), 0.03-0.05 for a calmer envelope.
   - **Write on track**: `item` (the item's own track) or `selected` (the first selected track: the item's analysis
     then drives another track).

Playhead Control is put first on the track if it is not there. The curves are written as envelopes `curve 1` ...
`curve 8`, over the item's time range only. Its window shows which curve each slot carries.

**See and edit them** like any automation:
- Click the track's envelope button, or open Playhead Control's envelopes, to show the lanes.
- You can draw, delete or move points, use **Envelope: Reduce number of points**, or bypass a lane.
- Running the action again rewrites the item's range.

**When the item moves**, the points stay where they were unless REAPER's **Options > Envelope points move with media
items** is on. Otherwise run the action again after moving or trimming.

## 3. Moving a parameter with a curve (parameter link)

Both effects must be on the same track: Playhead Control first, then the effect to drive.

1. In the target effect, touch the parameter you want to move (a knob in its window).
2. Click **Param** in the effect window, then **Parameter modulation/MIDI link** for that parameter.
3. Tick **Link from MIDI or FX parameter** and choose **Playhead Control: curve N**.
4. Set the parameter where it should sit when the curve is 0 (the baseline at the top of the dialog). Then use
   **Scale** for how far it moves when the curve reaches 1:
   - a negative scale moves it the other way (more harshness, less gain);
   - **Offset** shifts the whole range.
5. Play, and watch the parameter follow. Several parameters, in several effects on the track, can follow one curve.

Script authors can set the same link with `TrackFX_SetNamedConfigParm` and its `param.X.plink` keys.

## 4. Sending a curve as MIDI CC

In Playhead Control, set **curve N MIDI CC** to a controller number (-1 is off) and choose the **MIDI channel**. The
curve's value (0-127) is sent whenever it changes, and once at the start of playback:
- to the effects after Playhead Control on the track;
- through a MIDI send, to other tracks.

Map the CC in the receiving plug-in (a synth's filter, a plug-in's MIDI learn) or with REAPER's MIDI link (step 3
above, with **MIDI** as the source).

## 5. Recipes

Each takes a few minutes. Numbers are starting points; adjust by ear.

| Goal | Curve (scaling) | Target | Setting |
|---|---|---|---|
| Tame harsh moments only | `harshness` (item) | ReaEQ high shelf, ~5 kHz, gain | baseline 0 dB, negative scale to about -6 dB at 1 |
| Push the hits | `onsetStrength` (fixed, tolerance 0) | volume or saturation drive | a few dB up at 1 |
| Open the space in build-ups | `tension` (item) | reverb wet level (ReaVerbate) | dry at 0, the wet you want at the peak |
| Duck ambience under dialogue | dialogue's `activity`, written on the ambience track (`selected`) | volume or a low-pass on the ambience | negative scale: down while the dialogue is busy |
| Brighten with energy | `arousal` (item) | low-pass cutoff on a pad or a bus | higher cutoff as the curve rises |
| Clicks and crackle only | `n1Kurtosis` (item) | a de-clicker's or limiter's amount | in only where the sound is impulsive |
| A synth that follows a sound | `loudness` or `onsetStrength`, CC 74 | a synth on another track (MIDI send) | the synth's filter mapped to CC 74 |

More, with the steps written out, are under [Experiments](README.md#experiments) in the README: a de-harsher
compared with Playhead's own De-harsh, transient emphasis, tension to a send reverb, per-event gain, and one item's
analysis driving another track.

## 6. Tips

- **One curve, several jobs.** A slot can drive several parameters, each with its own scale: harshness can cut a
  shelf and lift a de-esser together.
- **Too jumpy?** Raise the point tolerance (0.03-0.05), or select the envelope's points and use **Envelope: Reduce
  number of points**. Parameter links have no smoothing of their own.
- **Not enough movement?** Use `item` scaling, or a larger scale in the link.
- **Hits sound late?** Write `onsetStrength` with point tolerance 0. A thinned envelope can round off an attack.
- **Several items on a track** each write their own range; between them the envelope keeps its last value. Add a
  point by hand where it should rest.
- **To keep the result without the link**, render the track, or freeze it.

## 7. When it does not work

- **The parameter does not move.** Check that Playhead Control comes before the target effect on the same track,
  that the envelope lane is not bypassed, and that the link points to the right `curve N`.
- **No envelope after writing.** The action writes over the item's time range only, and lists what it wrote in the
  ReaScript console. Show the slot's lane from the track's envelope list.
- **"The Playhead Control effect was not found."** Copy `Playhead Control.jsfx` into
  `<resource>/Effects/Playhead/`, or run Playhead - Install (or install the package with ReaPack).
- **A curve name is not accepted.** The dialog lists the curves the item has; music-only curves
  (`structureNovelty`, `localPulse`) need the music profile (Playhead - Settings).
