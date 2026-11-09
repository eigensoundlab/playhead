# Levels: many sound files at relevant levels, without touching them

A game or a film uses hundreds to thousands of sound effects and field recordings from different libraries, recorders
and sessions, so their levels are accidents. The usual fix, normalising everything, is destructive or one-shot (change
the target and do it again), flattens the hierarchy (an explosion ends up as loud as a footstep) and hides the outliers
(the few files that are 6 dB off, clipped or recorded wrong). This guide describes another way, shared by Playhead,
Kurator, SFX Workbench, REAPER and game engines:

1. **Originals are never changed.** Gains live in REAPER take volume, in middleware properties, or in delivered copies.
2. **Measure once, keep the numbers.** Every file is measured with several measures; changing the target, the measure
   or an offset recomputes the gains from the stored numbers.
3. **Intent is metadata.** Tags say what a sound is and how it should sit; a table of rules turns tags into offsets,
   checks and processing. Every rule can be switched off.
4. **Suggestions are not tags until accepted** (batch tagging by content, recorder or analysis only proposes).
5. **The report comes first.** For a large corpus the most useful output is a list of what does not fit.

| Part | Status |
|---|---|
| Measures in every analysis (`summary.levels`), check codes (`issues[].code`) | in Playhead |
| `Playhead.levels`: rules, gains, manifests, the report | in Playhead |
| `playhead levels`: measure folders, write the manifest and the report | in Playhead |
| REAPER: level items from a manifest, settings, report | planned |
| Kurator: the rules table on a project, the report, the manifest on delivery | planned |
| SFX Workbench: manifest entries when saving | planned |
| Engine import scripts (Wwise, FMOD, Unreal, Unity) | planned, in [GAMES.md](GAMES.md) |
| Checks for field recordings, gear tags, compression detection | planned; research below |

## Quick start

```sh
# measure a folder; groups are its subfolders; a manifest and a report
playhead levels Audio/SFX --out Audio/SFX/playhead-levels.json --report levels.html

# with a project's rules and settings; the manifest from last time is the store: unchanged files are not analysed again
playhead levels Audio/SFX --spec Audio/SFX/playhead-levels.json --out Audio/SFX/playhead-levels.json --report levels.html

# other settings for one run, a CSV instead of HTML
playhead levels Audio/SFX --measure integrated@active --target -23 --depth 0.5 --report levels.csv
```

Long files take a few seconds per minute of audio; `--profile fast` skips the events (then the event measures fall
back to the whole file) for large libraries of long recordings.

## Where levels are set: four layers

| Layer | What it does | Kurator | REAPER | Game engine / middleware |
|---|---|---|---|---|
| Master | The whole mix to a delivery target (for example −24 LUFS integrated for console games, over gameplay) | – | Render: Normalize/Limit with common gain or "only too loud", so the hierarchy survives | Master bus, loudness meter |
| Buses | Dialogue, music, effects (and the player's sliders) | – | Bus tracks | Buses, mixer groups |
| **Groups** | Weapons, explosions, footsteps, UI, ambience | Rules table on the project | Take gain, or folder tracks | Wwise actor-mixers, Unreal Sound Classes, FMOD and Unity mixer groups |
| **Assets** | Each file brought to a common level, plus a trim | Measures per file | Take gain | Per-sound volume, or Wwise loudness normalisation |

The group and asset layers are where tags help: they arrive with the sounds instead of being rebuilt by hand.

## Decisions

**The default measure: `momentaryMax@event`.** The loudest 0.4 s (EBU Tech 3341's momentary loudness, the maximum),
measured over the sound's loudest event.

- *Practice:* it is the measure Wwise offers for sound effects ("Momentary Max, best suited for short individual audio
  elements such as sound effects"; Integrated is "most useful for long audio program material"). Where library
  tools and engines normalise, they use the peak (BaseHead's normalise-to-peak, Godot's import, Unity's with Force To
  Mono), and no sound-library publisher was found that states a loudness policy; a peak does not measure loudness. EBU
  R 128 s1 limits short-form programmes by the maximum short-term (3 s) loudness, which reads a 200 ms impact about
  12 dB lower than a steady sound at the same level, where hearing puts the difference at a few dB at most.
- *Perception:* the 0.4 s window gives a short sound the penalty energy averaging gives it, which follows the classic
  temporal-integration data within a few dB below about 100 ms. It may over-penalise sounds under about 100 ms at loud
  playback levels, and no study has tested it, or any other measure, against listeners on sound effects.
- *The event scope is Playhead's.* It keeps the window on the sound when a file holds several. On the 56 effects of the
  test set it changes the value by more than 2 dB for 4 files only, so the default is, for most files, the practice
  above.
- A rule can choose its own measure for its group: `integrated@active` for ambiences and beds, `momentaryMax@events` for
  footsteps and rattles. Every measure is stored, so the default can change after the listening test without measuring
  again.

**Gains in REAPER: take gain for each file; groups on take gain or folder tracks.** Each file's levelling always goes to
the take's volume, where REAPER's own Normalize writes it (clip gain, the editor's habit); the user's item volume is
left alone. Group offsets go to take gain too by default, because they then reach the render and the game. A project
setting puts them on a folder track per group instead: faders that can be ridden and automated, the mixing engineer's
habit, for linear work. Both come from the stored numbers, so switching moves the offsets without measuring again.

**One manifest per delivery:** `playhead-levels.json` next to the delivered files. A file per sound, or entries in a
database, can come later from the same format.

**Loudness in the Broadcast WAV `bext` chunk of delivered copies:** version 2 of the chunk has fields for integrated
loudness, loudness range, maximum true peak, and maximum momentary and short-term loudness. They are metadata: the
samples are not changed, nothing is baked in, and they stay true because the gains live elsewhere. REAPER plays a file
as it is and measures loudness itself; no tool was found that applies these fields as a gain.

## The file: `playhead-levels.json`

One JSON format, `"format": "playhead-levels"`, version 1. Without `files` it is a **project spec**: settings, rules,
checks. With `files` it is a **manifest**: Kurator, SFX Workbench and `playhead levels` write it next to the sounds;
REAPER and engine import scripts read it. Paths are relative to the manifest's folder, with forward slashes.

```json
{
  "format": "playhead-levels",
  "version": 1,
  "project": "Game A",
  "levels": {
    "measure": "momentaryMax@event",
    "target": -18,
    "amount": 1,
    "depth": 1,
    "limits": { "boost": 12, "cut": 40, "truePeak": -1 }
  },
  "rules": [
    { "tag": "Weapons/Shotguns", "role": "group", "offset": 3 },
    { "tag": "Explosions", "role": "group", "offset": 4 },
    { "tag": "Foley/Footsteps", "role": "group", "offset": -6, "measure": "momentaryMax@events" },
    { "tag": "Ambience", "role": "group", "offset": -10, "measure": "integrated@active" },
    { "tag": "UI", "role": "group", "offset": -8 },
    { "tag": "subtle", "role": "modifier", "offset": -4 },
    { "tag": "hero", "role": "modifier", "offset": 2, "on": false },
    { "tag": "Nature", "role": "note", "checks": { "noiseFloorMax": -55 }, "process": [{ "tool": "cleanup", "params": { "fadeIn": 0.5 } }] }
  ],
  "checks": {
    "sampleRate": [48000, 96000],
    "bitDepth": [24, 32],
    "channels": [1, 2],
    "truePeakMax": -1,
    "groupSpread": 4,
    "defects": ["clipped", "dc", "firstSample", "cutTail", "lead"],
    "disagreement": 3
  },
  "files": [
    {
      "path": "Explosions/EXPLReal_Big_01.wav",
      "size": 1234567,
      "duration": 4.21,
      "sampleRate": 48000, "channels": 2, "bitDepth": 24,
      "tags": ["Explosions", "hero", "folder:Explosions", "ucs:EXPLReal", "class:impulse"],
      "class": "impulse",
      "event": { "start": 0.012, "end": 3.98, "decayEnd": 1.9 },
      "measures": {
        "peak": -0.4, "truePeak": 0.2,
        "rms": -19.5, "integrated": -17.9, "momentaryMax": -9.8, "shortTermMax": -13.1,
        "momentaryMax@event": -9.8, "momentaryMax@events": -10.4, "integrated@active": -16.0
      },
      "checks": [{ "code": "clipped", "severity": "bad", "text": "Clipped: 6 samples in one place" }],
      "trim": 0,
      "gain": -1.2,
      "group": "Explosions",
      "limitedBy": "truePeak",
      "analysis": { "playhead": "0.4.0", "profile": "sfx" }
    }
  ]
}
```

### Measures

A measure is `<measure>@<scope>`; without a scope it covers the whole file. All loudness follows ITU-R BS.1770-5
(K-weighting, the channels' energies summed, mono counted once).

| Measure | Meaning |
|---|---|
| `peak`, `truePeak` | Sample peak (dBFS) and true peak (dBTP, 4x oversampled), of the whole file only: a gain scales the whole file |
| `rms` | RMS level, the channels' mean power (dBFS) |
| `integrated` | Integrated loudness with BS.1770's gates (LUFS); a span under 0.4 s is one block, its own mean |
| `momentaryMax`, `shortTermMax` | The loudest 0.4 s and 3 s window (LUFS), moved in 10 ms steps; a span shorter than the window counts as the window with silence around it, as a meter shows an isolated sound |

| Scope | Span |
|---|---|
| (none) | The whole file |
| `@active` | The sounding span, from Playhead's `soundStart` to `soundEnd` |
| `@event` | The loudest event, from its start to where it has decayed 35 dB |
| `@events` | Each event within 20 dB of the loudest, measured on its own: the median |

A measure whose scope a file lacks (no events in the `fast` profile) falls back to the whole file; the report says so.

### Rules

| Field | Meaning |
|---|---|
| `tag` | A tag (hierarchical: `Weapons` matches `Weapons/Shotguns`; case ignored), or a tag every file gets: `folder:<name>` (its folder), `ucs:<CatID>` (a UCS category at the start of its name, `GUNShotgn_…`), `class:impulse`, `class:iterative`, `class:sustained` (Playhead's class of its loudest event). Planned: `gear:` (recorder, microphone), `track:` (REAPER: the item's track or a parent folder track) |
| `role` | `group` (a sound has one: the first group rule that matches), `modifier` (adds; any number), `note` (no level change: checks or processing only) |
| `offset` | dB, relative to the target |
| `measure` | The group's own measure |
| `checks`, `process` | Planned: stricter checks for these files; Playhead tools applied when conforming (in REAPER as a new take, in Kurator on delivered copies only) |
| `on` | `false` keeps the rule in the table but ignores it |

When a file matches two group rules the first wins, and the report lists it, so the order is a visible decision.

### The gain

```
gain = amount × (target − measured) + depth × (group offset + modifier offsets) + trim
```

then limited: at most `limits.boost` up, `limits.cut` down, and never so high that the file's true peak goes above
`limits.truePeak`. `amount` (0–1) is how much of the levelling to apply (0: offsets only). `depth` (0–2) spreads or
squeezes the hierarchy (0: all groups equal). `trim` is a manual correction per file.

### Checks

| Key | Meaning |
|---|---|
| `sampleRate`, `bitDepth`, `channels` | Lists of what the project accepts (bit depth is read from WAV files) |
| `truePeakMax` | The highest true peak a delivered file may have as it is |
| `groupSpread` | dB from the group's median that make a file an outlier (default 4) |
| `defects` | Which of Playhead's checks count (codes: `clipped`, `dc`, `lead`, `trail`, `firstSample`, `cutTail`, `noHeadroom`, `identical`, `seamJump`, `seamChange`) |
| `disagreement` | dB of disagreement between the project's measure and LUFS-I or Max M that lists a file (default 3) |

## The report

`playhead levels --report report.html` (or `.csv`), `Playhead.levels.report(manifest)` in code:

- **Groups:** each group's median, its spread (10th to 90th percentile) as each measure sees it before levelling, and
  its outliers (more than `groupSpread` dB from the median in the project's measure).
- **To check:** defects found by Playhead's checks, files whose format the project does not accept, gains limited by the
  true-peak ceiling or the limits (with the gain the measure asked for), files a measure could not be taken for, files
  that match two groups.
- **Where the measures disagree:** for each file, how much more or less gain each usual measure (peak, RMS, LUFS-I,
  Max M, Max S over the whole file) would give it than the project's measure, each keeping the group's median where it
  is. This is the comparison of standard normalisation with Playhead's, file by file: where the numbers are large the
  choice matters, and those files are worth a listen. A measure is not right because it agrees; only listeners can say
  which one is (the listening test below).
- **Files:** every file with its group, measure, offset and gain.

### Example: Playhead's 56-effect test set

The CC0 Sonic Pi samples behind Playhead's corpus results, in folders by their name's prefix, with the default settings
(`momentaryMax@event`, groups by folder):

| Group | Files | Median | Spread: project | peak | LUFS-I | Max M | Outliers (dB from the median) |
|---|---|---|---|---|---|---|---|
| ambi | 11 | −12.3 | 6.2 | 7.8 | 7.9 | 6.2 | glass_rub +5.4 |
| elec | 8 | −15.5 | 16.4 | 6.6 | 13.0 | 14.1 | blip −14.4, wood −9.8, cymbal +8.0, ping −7.2, chime +6.6, fuzz_tom +5.3 |
| glitch | 8 | −14.0 | 4.0 | 3.1 | 5.6 | 6.1 | robot2 +5.9 |
| drum | 6 | −11.6 | 6.9 | 0.1 | 3.4 | 6.9 | roll −7.2, heavy_kick −4.4 |
| loop | 5 | −12.7 | 5.8 | 0.9 | 3.5 | 2.6 | – |
| guit | 4 | −11.4 | 11.8 | 3.4 | 10.3 | 11.8 | harmonics −10.8 |
| perc | 4 | −15.5 | 9.7 | 1.7 | 4.9 | 9.7 | bell +8.7 |
| vinyl | 4 | −15.4 | 27.0 | 7.8 | 24.8 | 24.5 | hiss −22.0, backspin +5.0 |
| bass | 3 | −10.1 | 9.5 | 0.5 | 9.8 | 9.5 | hit_c −4.8, woodsy_c +4.7 |
| misc | 3 | −12.8 | 5.0 | 3.6 | 6.1 | 5.0 | – |

To check: two clipped files, two with DC offset, five starting on a non-zero sample, one with a cut tail, one with 88
ms of leading silence, five whose gain the true-peak ceiling limited (the loops are checked as loops, by their seams).
Against the project's measure, LUFS-I would move 23 of the 56 files by more than 2 dB (median 1.6 dB), peak 27 (median
1.8 dB), Max M over the whole file 4.

What it shows:

- **A peak-normalised library is not loudness-matched.** The drum, loop and bass samples share their peak within 1 dB,
  and differ by 3.4 to 9.8 dB in integrated loudness.
- **The report is useful before any levelling:** it points at the dozen files worth a listen.
- **The measure has to fit the group.** `vinyl_hiss` reads 22 dB under its group because its loudest "event" is one
  crackle in a steady hiss: a rule giving that group `integrated@active` fixes it. `elec_blip` (0.16 s) reads 14 dB
  under because the 0.4 s window averages it with silence, the case where listeners may disagree with the measure.

## Plans

### REAPER

- *Playhead - Level items*: for the selected items (or all), finds `playhead-levels.json` in the media's folder or its
  parents and matches the file by path and size. Without a manifest it measures in REAPER with
  `CalculateNormalization(source, mode, target, start, end)` (modes 0 LUFS-I, 1 RMS-I, 2 peak, 3 true peak, 4 LUFS-M
  max, 5 LUFS-S max), with the event's bounds from Playhead's cached analysis.
- Stores per take in `P_EXT:playhead_levels` (measures, group, modifiers, trim, the gain applied, the version); the
  project's settings and rules with `SetProjExtState`.
- Owns take volume; if a take's volume differs from the gain it applied last time, someone changed it: the item is
  skipped and listed. Polarity (a negative take volume) is kept. One undo block per run.
- *Playhead - Levels settings* (target, amount, depth, measure, limits, groups on take gain or folder tracks, the rules,
  with `track:` rules) and *Playhead - Levels report* (a line selects its items).
- Optional: levelling new items as they arrive, through a background script that watches `GetProjectStateChangeCount`
  (ReaScript has no import callback), started by SWS's startup action.
- To verify in REAPER first: what `CalculateNormalization` returns (a linear gain, as community scripts assume), that its
  bounds are in source time, and what LUFS-M max gives for a span under 0.4 s.

### Kurator

- *Project → Edit… → Levels*: the rules table (tag, role, offset, measure, checks, processing, on/off), the settings and
  the checks, stored with the project.
- The sound panel shows the group, modifiers, gain, measures, checks and a trim field; a *Levels* report and an
  *Outliers* filter for the project or view; sorting by any measure.
- *Copy to…* and project *Export…* write `playhead-levels.json` next to `kurator_export.json`; delivered copies can
  carry the `bext` loudness fields.
- Measuring the library uses the Playhead command line Kurator already runs, or the browser analysis
  (`summary.levels` is in every document).
- A **Gear** tag group (recorder, microphone, format) and tag pools for sounds (Kurator's CLAP model): below.

### SFX Workbench

When it saves output it adds the file's entry to `playhead-levels.json` in the output folder; its preset groups
(weapons, power and devices, movement and foley, inventory and UI, impacts, space and character) become suggested
groups. Its finishing stage normalises with integrated loudness; with a project spec it can use the project's measure
and the group's target, or leave the level alone and only record the measures.

### Game engines

Either **baked** (render from REAPER with the take gains; render normalisation only with common gain or "only too
loud") or **live**: an import script reads the manifest, sets the group offsets on the engine's group level (Wwise
actor-mixers, where loudness normalisation with *Momentary Max* and a *Target* can also run; Unreal Sound Classes; FMOD
and Unity mixer groups) and the file's gain as the sound's own volume, so the offsets stay adjustable in the game's mix.

## Field recordings: tags, gear and checks (planned)

Suggestions come from three sources, most reliable first; each keeps its source, so the reason shows in review.

1. **Metadata.** Kurator reads the Broadcast WAV `bext` chunk, iXML, ID3/Vorbis/MP4 tags and UCS categories in names.
   What recorders write (from documentation and parsed test files):

   | Source | What is there | Examples |
   |---|---|---|
   | bext `Originator` | the device on professional recorders | `Sound Dev: 702T S#GR1112089007`, `ZOOM F8`, `ZOOM Handy Recorder H4n` |
   | bext `CodingHistory`, first line | format and model (`T=`); later `A=ANALOG` lines mean a tape transfer, `A=MPEG…` a lossy step | `A=PCM,F=48000,W=24,M=stereo,R=48000,T=2 Ch` |
   | bext `OriginatorReference` | EBU R 99: country, organisation, model and serial, time | `USSDVGR1112089007…` |
   | bext `Description` | key=value lines with the writer's prefix | Sound Devices `sTRK1=MKH516 A`, Zoom F6 `zTRK1=`, Pro Tools rewrites with `d` |
   | iXML `TRACK_LIST` | track names, often the microphones | `MKH516 A`, `Boom` |
   | iXML `USER` | Tascam `Recorder:<model> <version>`; Soundminer `RECMEDIUM`, `MICROPHONE`, `MICPERSPECTIVE`, `EMBEDDER` | `RECMEDIUM` = `Sony PCM-D100`, `MICPERSPECTIVE` = `XY` |
   | Sony ASWG iXML | `micType`, `micConfig`, `micDistance`, `recordingLoc`, `isDesigned` | written by library tools |
   | GUANO (`guan`) | `Make`, `Model`, `Serial`, `Loc Position` | bioacoustic recorders only |
   | File name | weak hints | Sony handhelds: date and time (`181010_1010.wav`); `ZOOM0001.WAV` |

   A DAW or library tool changes the picture (Pro Tools rewrites the Description; Nuendo, Pyramix and Soundminer put a
   program or a person in Originator), so such an Originator means "processed", not a recorder. **Sony's handheld PCM
   recorders write no device metadata**, and no field recorder was found that writes a location; for them the gear tag
   comes from the user, a file-name pattern, or "similar to the files you tagged".
2. **Content.** Kurator's local CLAP model already searches sounds by description; its tag pools work on images only
   today. Extended to sounds, they suggest *birds / wind / water / traffic / interior* for a field-recording corpus.
3. **The signal.**

   | Reliability | Cues |
   |---|---|
   | Tag automatically | sample rate, bit depth, integer or float; effective bit depth (low bits always zero); identical channels; a steep band-limit edge (a codec: LAME MP3 at 128 kbit/s about 17 kHz, FFmpeg's AAC at 128 kbit/s about 16 kHz) or an empty band above an older sample rate's limit (upsampled); clipping; DC offset |
   | Suggest, with a confidence | 50/60 Hz hum and the 217 Hz GSM buzz; wind (low coherence between channels plus low-frequency bursts); limiter or automatic-gain steps; noise floor against a recorder's published input noise; "tape-like" (hiss, a soft band limit, wow and flutter) |
   | "Similar to these files" only | recorder or microphone identity: published device identification reaches 90–96 % only in closed sets of phones, mostly on speech, and falls to 42–60 % across content types; nothing was found on field recorders with ambiences |

Proposed checks, each to come with a probe whose answer is known: `clicks`, `dropouts`, `hum`, `wind`, `bandLimit`,
`bitDepth` (effective), `limiter`, `noiseFloor` (sustained recordings only), `phase`. A first try showed why the
definitions matter: "where the spectrum ends" flagged a tonal bass as band-limited, and "the quietest 10 % of the file"
flagged every decaying hit as noisy.

## Compressed and limited sounds (research)

Large corpora mix raw recordings with designed sounds that were compressed or limited, sometimes hard, and they get
compressed again in the mix or the engine. Can Playhead tell which files were, estimate how much, and undo it?

**What is known.** Nothing published tests detection or decompression on sound effects; the work is on music, singing,
instruments and speech.

- Hard clipping and look-ahead limiting leave reliable signs: spikes at the edges of the sample histogram, many peaks at
  one ceiling.
- Trained classifiers detect a compressor on music about 81 % of the time (Rice et al., WASPAA 2023) and recognise known
  presets (Sun et al., 2024/25), but only the processors they were trained on. Threshold and ratio can be estimated
  roughly, attack and release poorly.
- Crest factor, peak-to-loudness ratio, DR meters and loudness range measure low dynamics, not processing; EBU Tech 3342
  says loudness range misleads on short items.
- Exact inversion works only for a known feed-forward compressor without look-ahead (Gorlow and Reiss, IEEE TASLP 2013).
  Learned de-limiting of music gains about 4 dB SI-SDR (Jeon and Lee, WASPAA 2023), without a listening test.
  Declipping is mature. Lossy-codec history is detected reliably on music; "undoing" it only invents plausible content,
  so a file with it is flagged and a lossless source preferred.

**What a first pilot showed** ([experiments/levels](../experiments/levels/README.md)): the test set's 56 effects,
limited and compressed with known settings.

- **Limiting shows.** Crest factor, peak against Max M and the share of samples near the peak moved the expected way on
  88 to 100 % of files; one threshold over the mixed set separated limited from original with AUC 0.67 to 0.83.
- **Compressing a one-shot goes the other way.** With a 5 ms attack the attack passes before the gain falls: the crest
  factor rose (median +0.6 and +3.7 dB). A crest-factor detector reads a compressed hit as less compressed.
- A simulation in the research notes found the decay's **bend** (a compressed decay gets steeper below the threshold,
  which a natural decay never does) separating compressed synthetic impacts at AUC 0.74 to 0.82, but also flagging
  editors' fade-outs.

**What Playhead could offer** (planned):

- **Detect** as a list of evidence, not a yes or no: clipping and a limiter's ceiling (reliable); the decay's bend, fades
  left out; in a file of several takes, a bend at the same level in every event; a noise floor that dips after loud
  events (pumping); a comparison with the raw sounds of the same group.
- **Estimate** ranges, not plug-in settings: effective ratio, the bend's level, the ceiling, the release.
- **Reshape**, not undo: a per-event expansion of the decay that leaves the attack alone, in the manner of *Level the
  events* (in the simulation it brought the decay time back and halved the envelope error; expanding without sparing the
  attack overshot it by 3 to 34 dB). Clipped files go to a declipper. Layered or multiband designed sounds have no
  original to recover.

**How to measure it fairly.** Raw material (an impact dataset, construction-kit libraries, own recordings) compressed by
several implementations (REAPER's ReaComp, ReaXcomp and JS limiters, a Python effects library, a commercial maximiser),
some held out for the test. Report the AUC by amount of gain reduction and by kind of sound; the false alarms on fades,
gates, steady and multi-impact sounds; the errors against the known gain curve, decay time, envelope and attack peak
(SI-SDR barely moves when a decay is restored, so it is the wrong headline); on real libraries, designed against
construction-kit editions of the same sounds. Then listeners: MUSHRA with the raw file as the hidden reference, and ABX
for whether the difference is heard at all.

## Evidence and what is still open

- The measures are checked against values known by construction (`npm test`: BS.1770-5 calibration, a burst in the
  0.4 s window, the true peak of a sine at a quarter of the sample rate, the scopes, rules, limits, the command line on
  files with a known outlier, a clipped file and a wrong sample rate).
- Nothing here says which measure listeners agree with. No published study tests peak, RMS, LUFS-I, Max M, Max S or the
  ISO 532 models against listener loudness matches on sound effects. The fair test: listeners match each raw file once
  to a reference; every method is scored offline by the spread of the corrections still needed, and the usual measures
  get the same per-group offsets as Playhead's (so it cannot win by having more settings). About 10–20 listeners and
  60–120 sounds, including dry and wet versions of one sound, reversed sounds, footsteps at different rates, booms and
  two playback levels.
- On the test set the usual measures disagree by 7–18 dB per file (5th to 95th percentile of the differences), and
  BS.1770 and Zwicker's loudness (ISO 532-1) by up to 17 dB, mostly on bass and tonal sounds: the choice matters.
