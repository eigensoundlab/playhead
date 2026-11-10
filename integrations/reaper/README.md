<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Playhead for REAPER

ReaScripts that bring [Playhead](https://github.com/eigensoundlab/playhead)'s analysis and tools into REAPER: the
curves (loudness, activity, harshness, tension, onset strength, impulsiveness and the other descriptors), events,
onsets, beats, bar lines and sections of an item, as markers, as automation that can drive any effect, as processed
takes from Playhead's analysis-driven tools, and as a strip view of the item in any Playhead look; and editing tools
built on the analysis: arranging the layers of a sound, splitting a recording into its sounds, a tempo map that
follows a recording's bars, and levelling many items from measured loudness and tag rules. The parts that do
not need REAPER (document reading, time mapping, the strip renderer, command lines) are a plain Lua library with its
own tests, so the package is also a base for your own analysis-driven scripts.

**Status.** New. Tested outside REAPER in a mock REAPER that checks every API call against its documented signature,
with the real command line, and against REAPER's documentation and published scripts (see [Tests](#tests) and
[Limits](#limits)); first runs in REAPER on Windows went well. Please report what does not work, with the
ReaScript console's output.

**Guides:** [working with Playhead's curves (envelopes) in REAPER](ENVELOPES.md).

## Requirements

- REAPER 6 or 7 on Windows, macOS or Linux. No SWS or js_ReaScriptAPI.
- The Playhead command line, one of:
  - the executable for your system from the [Playhead releases](https://github.com/eigensoundlab/playhead/releases)
    (`playhead` or `playhead.exe`; no Node needed). Put it in `<REAPER resource folder>/Scripts/Playhead/`, or
    anywhere and choose it in **Playhead - Settings**. On macOS and Linux make it executable (`chmod +x playhead`);
    on macOS, a file downloaded with a browser may also need `xattr -d com.apple.quarantine playhead` once;
  - `tools/playhead-cli.js` from a Playhead checkout (or `dist/playhead-cli.cjs` from a build) with Node.js 18 or
    later: choose the `.js`/`.cjs` file as the executable in **Playhead - Settings** and, if REAPER does not find
    `node` itself, the full path to Node.
- WAV files are read directly. Other formats (FLAC, MP3, OGG, AIFF, ...) need [ffmpeg](https://ffmpeg.org/) where
  Playhead can find it. REAPER started from the macOS Dock does not see your shell's PATH; Homebrew's folders
  (`/opt/homebrew/bin`, `/usr/local/bin`) are added for you, other folders go under "Extra folders" in Settings.

Find the resource folder with REAPER's **Options > Show REAPER resource path in explorer/finder**.

## Installing

Use one of these ways, not two: each adds its own set of actions.

**With the installer (simplest).**
1. Download `playhead-reaper-<system>.zip` from the [Playhead releases](https://github.com/eigensoundlab/playhead/releases)
   and unpack it anywhere. It holds the actions, their library, the effect, this README and the Playhead command line
   for your system.
2. In REAPER, open **Actions > Show action list**, then **New action > Load ReaScript...**, choose
   `Playhead - Install.lua` in the unpacked folder, and **Run** it.
3. It copies everything into REAPER's resource folder (`Scripts/Playhead`, `Effects/Playhead`), adds the nine actions
   and **Playhead - Uninstall** to the action list, and checks the command line.

To update, run the installer from a newer download; settings and analyses are kept. To remove Playhead, run
**Playhead - Uninstall** from the action list. It takes the actions off the list and deletes the files. It then asks
whether to delete the stored analyses and settings too.

**With ReaPack** (installs and updates through ReaPack).
1. **Extensions > ReaPack > Import repositories...**, paste `https://eigensoundlab.github.io/playhead/reaper/index.xml`.
2. **Extensions > ReaPack > Browse packages**, find **Playhead for REAPER**, install it, and **Apply**.

The package holds the nine actions, the library and the effect, pinned to one commit with checksums. ReaPack offers
each new version as an update. The command line is not part of it: put the executable for your system in
`<resource>/Scripts/Playhead/`, or choose it in **Playhead - Settings**. ReaPack removes the package by itself
(right-click it in Browse packages).

**From a Playhead checkout** (to follow development):
- Load the six `Playhead - ....lua` files from `integrations/reaper/` with **Load ReaScript...**; they find `lib/`
  next to them.
- Copy `Playhead Control.jsfx` into `<resource>/Effects/Playhead/`.
- Choose `tools/playhead-cli.js` (with Node) or an executable in **Playhead - Settings**.

After `git pull`, REAPER runs the new scripts, with no copying. Running `Playhead - Install.lua` from the checkout
installs a copy instead.

**By hand.** Copy the six `Playhead - ....lua` files and the `lib` folder into `<resource>/Scripts/Playhead/`
(with the executable, if you use it), and `Playhead Control.jsfx` into `<resource>/Effects/Playhead/`. Then
**Actions > Show action list > New action > Load ReaScript...**, select the six action files, and bind keys or
toolbar buttons to them as you like.

## The actions

All actions work on the selected items, each through its active take. Items that are not analysed yet are analysed
first, with a small progress window; REAPER stays usable meanwhile, and closing the window stops waiting.

**Playhead - Analyse selected items.** Analyses the selected items' files and keeps the results in
`<resource>/Data/Playhead/cache/` (keyed by file path, size and length, the analysis profile and the Playhead
version), where all other actions find them. Prints a summary of each to the ReaScript console: duration, profile,
loudness, events, onsets, tempo and bars, sections, asset checks and the curves present. Items that are analysed
already are analysed again only if you say so. Several items that play the same file are analysed once.

**Playhead - Add markers for selected items.** Asks what to add, and remembers your answers:
events as take markers (named by their tag and word, such as `N′ tonal hit`), onsets as take markers, sections as
project regions (`A`, `B`, ...) and downbeats as project markers (`bar 1`, `bar 2`, ...). Take markers sit in the
take's source and move with it; regions and bar markers are placed where the item plays them. Everything is clipped
to the part of the file the item plays. "Replace" removes the markers this action added to the same items before
(those still at the same place with the same name), so you can run it again after moving or trimming an item.
Bars and sections come from the music profile (sounds over 10 s with the automatic profile).
*Builds, fills and pass-bys* adds builds as regions (`build`, or `build to a drop` where a jump or a strong hit
follows), fills and breaks as project markers at their bar, and pass-bys as markers at the moment the source passes,
named with the speed its Doppler shift shows (`pass-by (72 km/h or more)`). Builds and fills come from the music
profile; pass-bys from either. Documents from before Playhead 0.4 have none: analyse again.

**Playhead - Write curves as automation.** Asks which curve goes to which of eight slots (by name or label, for
example `harshness`, `tension`, `onset`, `impulsiveness`, `n1Kurtosis`; an empty slot is left as it was), and writes
each as envelope points on that slot of the **Playhead Control** effect, inserting the effect first on the track if
it is missing. Points are written over the item's time range only; points outside it stay, and the envelope keeps
its value at the item's edges. The curve follows the take: start offset, playback rate, loop and reversed sections.
Options:
- *Scaling*: `fixed` writes the curves as the strip shows them (the 0..1 curves as they are, the descriptor curves on
  their 5th to 95th percentile in the file, loudness in LUFS from -60 to 0); `item` stretches each curve so that its
  5th to 95th percentile inside the item spans 0..1, which uses a parameter's full range on any material.
  Step-by-step use, linking, MIDI CC and recipes: [ENVELOPES.md](ENVELOPES.md).
- *Point tolerance* (default 0.01) and *most points per curve* (default 2000): the points are thinned so that the
  envelope stays within the tolerance of the full curve, then to at most that many points.
- *Write on track*: `item` (the item's own track) or `selected` (the first selected track, to drive another track).
Where REAPER lets scripts rename effects, the effect's name lists its slots, for example "Playhead Control (1
harshness, 2 tension)"; its own window always does.

**Playhead - Process selected items.** Shows the tools the command line offers (`playhead tools`; new tools appear
without an update of the scripts): clean up for export, de-harsh, layer remix, attack and body, tension shaper,
loop maker, variations, reverb on the tails, drive the hits, ring time, level the events, fold to mono, widen the
tails. A dialog built from the tool's parameters follows (numbers with their range and unit, yes/no, and choices by
name, by the start of their label or by number; your last values are remembered per tool). Each result becomes a new
take in the same item, named after the tool ("De-harsh", "De-harsh (removed)"), with the original take kept and the
first result made active. The new takes keep the original take's offset, rate, pitch, volume and pan. The files go
to the project's media folder, in `Playhead/`; each run keeps its own files. The tool's report (what it changed, by
how much) is printed to the console. The active take is what is processed, so a processed take can be processed
again. **Stretch keeping the attacks** changes the length: its takes start at the same moment of the sound, and the
item is lengthened (or shortened) by the same factor to play them; the other takes keep their timing.

**Playhead - Arrange selected layers.** For a sound built from layers on items of their own (a sub, a body, a
transient and a tail, say): Playhead searches small moves and gain changes of the layers for a **punchier**, **bigger**
or **cleaner** whole and offers the best six, each with its score and its changes (`click +12 ms -1.5 dB`). Picking
one moves the items and plays the sound; pick another to compare, *Play again*, then *Keep this one* (one undo step)
or *Back to how it was*. The search (`playhead arrange`) works from the layers' analyses alone, about 500
arrangements in a fraction of a second, so nothing is rendered; [experiments/arrange](../../experiments/arrange/README.md)
checks that the mixes rank as the search predicts. Asks for the goal, how far a layer may move (default 250 ms) and
how far its gain may go down and up (6 and 3 dB). A locked item (Item properties: Lock) stays; without one, the
loudest layer stays. Each item counts with the part of its file it plays and its item and take volume. Items that play
backwards, at another rate or loop their source are left out with a note.

**Playhead - Split items at sounds.** Splits each selected item into its sounds: a cut a few milliseconds before each
event (or each onset), placed from the sample where the sound starts to rise (with Playhead 0.4 and later), so no
attack is cut, and never two cuts closer than the shortest piece (default 60 ms; the
sound joins the piece before). Each piece can be named after its sound (`door 03 tonal hit`), ended where its sound
has decayed (plus a faded tail, default 60 ms) and given a region of the same name: with the region render matrix
(or *Render: regions*, `$region` in the file name) a recording of many hits becomes one file per hit. Pieces before
the first sound (an item that starts during an earlier one) are left as they are. Onsets come closer together than
events and split without shortening (they have no decay).

**Playhead - Tempo map from item.** Makes REAPER's tempo follow a recording that was not played to a click: a tempo
marker at each bar (or each beat) Playhead's beat tracking finds in the first selected item, each with the tempo
that puts the next bar exactly on its downbeat, the first with the time signature (beats per bar as found, over 4).
The grid, snapping, MIDI and tempo-synced effects then line up with the recording. Before adding, it says how many
markers and the tempo range, and offers to remove tempo markers already in the item's range. The item is set to time
base *Time* so it stays where it is; items on a *Beats* time base move with the new tempo (Undo takes all of it
back). Needs the music profile (sounds over 10 s, or profile `music` in Settings) and a steady beat.

**Playhead - Strip window.** A dockable window that draws the selected item as a Playhead strip in a chosen look:
the waveform (plain, tinted by a curve or sculpted by loudness), the spectrogram, curves as lanes or over the
waveform (filled, mirrored, horizon or line), events, onsets, beats, bar lines, sections and novelty marks, with a
legend under the strip. It follows the take (offset, rate, loop, reversed sections), shows the edit and play
cursors, and moves the edit cursor where you click. Right-click for the ready-made looks (those a file cannot show
are greyed), your own look code (for example `wave:harshness lane:activity ticks:events`; codes from the Playhead
app can be pasted), analysing again, automatic analysis of newly selected items, colours, and docking. Space starts
and stops playback.

**Zoom** works as in REAPER's arrange view:
- the mouse wheel zooms around the mouse;
- Ctrl, Shift or Alt with the wheel, or a horizontal wheel, scrolls;
- the middle button drags the view.

While zoomed in, a bar along the bottom shows where the view is in the item. The view follows the play cursor when
REAPER's own view does (**View: Toggle auto-view-scroll during playback**). **Show the whole item** in the menu zooms
out. **Colours** in the menu offers five palettes, kept between sessions:
- REAPER theme: REAPER's background and peak colour, with tints from neutral to a hot yellow;
- Playhead's own colours;
- Heat;
- Colour-blind safe: viridis and Okabe-Ito;
- Greyscale.

The views of rhythm and form are drawn here as in the Playhead app:
- **Bar raster** (`raster:<curve>`, `~4bars` for a row per 4 bars; music): a row per bar, top to bottom, the curve
  through each bar, with the beat grid, sections between rows and onsets as dots. The cursors are drawn in the row of
  the bar they are in, and a click moves the edit cursor to that point of that bar.
- **Tempogram** (`spec:tempo`, `~cyclic` folds the octaves), **repetition** (`spec:lag`) (both music) and the
  **modulation spectrogram** (`spec:mod`, any profile but fast), from the analysis.
- **Spectral playheads** (music): the **bar spectrum** (`raster:spectrum`) and the **spectral groove**
  (`raster:spectrum~attacks`), a row per bar and a column per 16th coloured low red, mid green, high blue by level or by
  attack, and the **metrical spectrogram** (`spec:metric`), per octave band and bar the finest level its attacks keep
  to (bar, half bar, beat, 8ths, 16ths). From analyses of Playhead 0.4 and later.
- **Curve rhythms** (`scalogram:<curve>`), computed in the window from the curve. On a long item this takes a moment
  the first time the look is shown.

A view the analysis does not have (a tempogram of a sound effect) leaves the waveform in its place, and the legend
says why. The strip is drawn once and redrawn only when the item, the look, the zoom, the window size or the colours
change. As a toolbar button it shows whether the window is open.

**Playhead - Level items.** Brings the selected items (with none selected: all items, after asking) to relevant
levels without changing their files ([docs/LEVELS.md](../../docs/LEVELS.md)). Each sound's measures come from a
`playhead-levels.json` in its file's folder or up to three folders above it (written by Kurator, SFX Workbench or
`playhead levels`, with the sound's tags), else from Playhead's analysis (analysed first if needed; analyses from a
Playhead without level measures are made again). The gain is amount × (target − measured) + depth × (group and
modifier offsets) + trim, limited by the most boost and cut and the true-peak ceiling, with the tag rules of the
project, else of the manifest. Tags are the manifest's, the file's folder (`folder:`), the UCS category in its name
(`ucs:`), Playhead's class (`class:impulse` …) and the item's track and the folder tracks above it (`track:Weapons`).

- The gain goes to the **take's volume**; the item's volume stays yours. The polarity is kept.
- **Group offsets** go to the take too (they then reach the render and a game), or, with "track" in the settings, to
  the nearest track named like the group that holds the item (a folder track `Explosions` for the group
  `Explosions`, `folder:Explosions` or `Weapons/Explosions`): a fader to ride. Back on "take", offsets Playhead put on
  tracks return to 0 dB.
- A take volume set before (by Normalize, or by hand) or changed since Playhead set it, and a track fader moved since,
  are left alone unless you say otherwise. Playhead keeps what it set on each take and track (`P_EXT:playhead_levels`).
- The measures are kept, so running it again after changing the settings recomputes the gains without analysing.
- The ReaScript console gets a report: each group's median and the sounds more than 4 dB from it, gains a limit held
  back (with the gain asked for), measures that fell back to the whole file, asset checks, items left alone.
- Measures are of the whole file, also when an item plays part of it.

**Playhead - Levels settings.** This project's settings for levelling, kept in the project: the measure
(`momentaryMax@event` by default; `integrated@active`, `peak` …), the target, the amount (0–1), the depth of the groups'
offsets (0–2), where group offsets go (take or track), the most boost and cut and the true-peak ceiling; and the rules,
taken from a `playhead-levels.json` chosen here, or each sound's own manifest's.

**Playhead - Settings.** The executable (empty: look in `<resource>/Scripts/Playhead/`, then on the PATH), Node for
the `.js` command line, the analysis profile (`auto`: sound effects up to 10 s, music above; `fast`: curves only;
`sfx`; `music`), the timeout, extra folders for ffmpeg and Node, automatic analysis in the strip window, and emptying
the cache. Checks the command line after saving and shows its version.

## Playhead Control (the effect)

Audio and incoming MIDI pass through unchanged. It has eight automatable parameters, `curve 1` to `curve 8` (0..1),
which the curves action writes; its window shows each slot's curve and current value. To use a curve:

- **Parameter link.** In the effect you want to drive (on the same track), click **Param**, choose the parameter,
  then **Parameter modulation/MIDI link > Link from MIDI or FX parameter** and pick `Playhead Control: curve N`. Set
  *Scale* and *Offset* to map 0..1 onto the range you want (a negative scale turns the curve upside down: high
  harshness, lower gain). Several parameters can follow one curve. Script authors can set the same link with
  `TrackFX_SetNamedConfigParm` and its `param.X.plink` keys.
- **MIDI CC.** Set `curve N MIDI CC` to a controller number (-1 is off) and the MIDI channel: the value (0..127) is
  sent whenever it changes, and once at the start of playback, to the effects after Playhead Control and, through a
  MIDI send, to other tracks. Map the CC in the receiving plug-in or with REAPER's MIDI link.

## Experiments

Starting points for analysis-driven mastering, mixing and sound design; each takes a few minutes to set up.

1. **A de-harsher driven by the harshness model.** Write `harshness` (scaling `item`) into slot 1. Add ReaEQ after
   Playhead Control with a high shelf around 5 kHz, and link the shelf's gain to `curve 1` with a negative scale and
   an offset that gives 0 dB where the curve is 0, about -6 dB where it is 1. The shelf now cuts only while the sound
   is harsh, the way Playhead's De-harsh gate opens. Render De-harsh on the same item with **Process selected items**
   and switch takes to compare the shelf against the tool's narrow, moment-by-moment cuts.
2. **Transient emphasis from onset strength.** Write `onsetStrength` with point tolerance 0 (to keep the attacks
   sharp) and link it to the gain of a volume or saturation plug-in after Playhead Control (positive scale, a few dB
   at full strength). Unlike a transient shaper, which reacts to level, this follows where the analysis finds the
   hits; `n1Kurtosis` (impulsiveness) instead picks out clicks and crackle.
3. **Tension to a reverb.** Write `tension` (scaling `item`) on a track with a reverb (for example ReaVerbate) after
   Playhead Control and link the reverb's wet level to the curve, so build-ups open the space and releases dry it.
   For a send to a shared reverb, give the slot a CC number, send the track's MIDI to the reverb's track and map the
   CC there.
4. **Per-event gain without SWS.** Add events as take markers to see where Playhead finds each event, then compare
   two ways of levelling them: Playhead's **Level the events** tool (one gain per event, held from just before its
   start to the end of its decay), and splitting the item at its events with one item volume per piece, which this
   short script does (save it next to the Playhead actions, so it finds `lib/`):
   <!-- example: per-event gain -->
   ```lua
   -- Playhead experiment: split the selected item at its events and bring each event's peak to -12 dBFS
   local dir = debug.getinfo(1, "S").source:match("^@?(.*[/\\])") or ""
   package.path = dir .. "lib/?.lua;" .. package.path
   local R = require("playhead_reaper")
   local core = R.core
   local item = reaper.GetSelectedMediaItem(0, 0)
   local cli = item and R.require_cli()
   if not cli then return end
   R.with_documents({ item }, cli, {}, function(entries, problems)
     local e = entries[1]
     if not e or not e.doc.events then return R.report_problems(problems, "No events") end
     local cuts = {}
     for _, ev in ipairs(e.doc.events) do
       for _, t in ipairs(core.file_to_project(e.info.map, ev.start)) do cuts[#cuts + 1] = { t = t, db = ev.peakDb } end
     end
     table.sort(cuts, function(a, b) return a.t < b.t end)
     R.undoable("Playhead: level the events by splitting", function()
       for i = #cuts, 1, -1 do                  -- from the end, so the item keeps the part before each cut
         local piece = item
         if cuts[i].t > e.info.map.pos + 1e-6 then piece = reaper.SplitMediaItem(item, cuts[i].t) end
         if piece then reaper.SetMediaItemInfo_Value(piece, "D_VOL", 10 ^ ((-12 - cuts[i].db) / 20)) end
       end
     end)
   end)
   ```
   Splitting cuts each event's tail at the next event's start; the tool holds each gain to the end of the decay.
5. **A tool's take against the original.** Run any tool from **Process selected items**, then switch between the
   original and the new takes (**Take: Switch items to next take**, T by default) while playing. Most tools match
   the loudness of the original, so what you hear is the change itself; De-harsh also renders what it removed, and
   Fold to mono the plain (L+R)/2 sum, as further takes. Run **Analyse selected items** on each take to read the
   change in numbers (harshness, loudness range, events).
6. **One item's analysis driving another track.** Select the item whose analysis should lead (dialogue, a kick, a
   sound effect), select the track to be driven (music, ambience), and write curves with "Write on track:
   selected": Playhead Control lands on that track with the leading item's curves over its time range. Link a
   volume or a filter on that track with a negative scale to duck it under the leading sound's activity or onset
   strength: ducking that follows what the analysis hears rather than a sidechain level.

For your own scripts, `lib/playhead_core.lua` has the document model (`curve_at`, `curve_names`, `marker_plan`), the
time mapping of a take (`take_map`, `project_to_file`, `file_to_project`), the plans of the editing tools
(`item_part`, `split_plan`, `tempo_plan`), point reduction, the strip renderer and look codes, and
`lib/playhead_reaper.lua` has the REAPER side (finding the command line, the cache, `with_documents`, runs that do not
block, remembered dialogs with `form`, Playhead Control and its envelopes); the example above shows the pattern.

## Limits

- The whole file is analysed, not the item's part, and the analysis follows the take's start offset, playback rate,
  loop and reversed sections, but not stretch markers (a warning names such takes), take envelopes or pitch shifts.
- Take markers are placed in the take's source time; on takes with a section or a reversed source (Item properties)
  this assumes REAPER counts take markers in the section's own time, as it does the start offset. Check the first
  such take.
- A run cannot be stopped from a script: closing the progress window stops waiting, and an analysis that finishes
  later is still cached.
- On Windows each run opens a minimised console window for a moment.
- Not yet tried on Windows with folder or file names outside ASCII (for example an accented user name in REAPER's
  resource path): the job scripts switch the console to UTF-8 with `chcp 65001`. If runs fail only for such paths,
  please report it.
- Dialog fields cannot contain commas (REAPER's dialog separates fields with them); the look code dialog, a single
  field, accepts them.
- Writing curves replaces the points in the item's range on the chosen slots; overlapping items on one track share
  the slots.
- Mono and stereo are analysed; further channels are ignored. MIDI items, empty items and sources without a file are
  skipped with a message.

## Tests

Outside REAPER, with Python and [lupa](https://pypi.org/project/lupa/) (Lua 5.4, and 5.3 for the core):

```sh
pip install lupa
python3 integrations/reaper/test/run_tests.py                    # all tests
python3 integrations/reaper/test/run_tests.py --update-fixtures  # rewrite the fixtures first (needs Node)
```

On Windows the command is `python` (or `py`), not `python3`:

```bat
python integrations\reaper\test\run_tests.py
```

There the core tests run, with a real batch job through `cmd.exe` in place of the POSIX shell checks. The action
scripts' tests simulate REAPER on macOS and Linux, starting the command line through POSIX job scripts, so on Windows
they are skipped unless you add `--actions` and Git for Windows' `sh` is found. GitHub Actions runs all of them on
every push. The ReaPack index (`tools/reapack-index.js`) is checked too: every file, its checksum and the version.

The core is checked against documents made by the command line and against what `src/playhead.js` computes from
them: `curveAt`, `toMarkers`, look codes, legends and the rectangles, triangles and texts `drawStrip` draws for
every look without a spectrogram; the views as numbers (`Playhead.view`) and as drawn, compared at 38,300 points of
26 strips (`test/make_fixtures.js` writes `test/fixtures/`). Every action script then runs in
a mock REAPER that checks each API call against its documented signature, with the real command line (when Node is
installed) started through the job scripts. What cannot be checked outside REAPER: the drawing itself, the dialogs'
look, the JSFX, and REAPER's own behaviour behind the calls (listed in the scripts' comments where it matters).
