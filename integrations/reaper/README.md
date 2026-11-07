<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Playhead for REAPER

ReaScripts that bring [Playhead](https://github.com/eigensoundlab/playhead)'s analysis and tools into REAPER: the
curves (loudness, activity, harshness, tension, onset strength, impulsiveness and the other descriptors), events,
onsets, beats, bar lines and sections of an item, as markers, as automation that can drive any effect, as processed
takes from Playhead's analysis-driven tools, and as a strip view of the item in any Playhead look. The parts that do
not need REAPER (document reading, time mapping, the strip renderer, command lines) are a plain Lua library with its
own tests, so the package is also a base for your own analysis-driven scripts.

**Status.** New, and so far tested outside REAPER: in a mock REAPER that checks every API call against its documented
signature, with the real command line, and against REAPER's documentation and published scripts (see [Tests](#tests)
and [Limits](#limits)). First runs in REAPER are welcome; please report what does not work, with the ReaScript
console's output.

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

**By hand.** Copy the six `Playhead - ....lua` files and the `lib` folder into `<resource>/Scripts/Playhead/`
(with the executable, if you use it), and `Playhead Control.jsfx` into `<resource>/Effects/Playhead/`. Then
**Actions > Show action list > New action > Load ReaScript...**, select the six action files, and bind keys or
toolbar buttons to them as you like.

**ReaPack.** The scripts carry ReaPack headers for [reapack-index](https://github.com/cfillion/reapack-index): one
package, "Playhead for REAPER", whose entry is `Playhead - Analyse selected items.lua`. It provides the other five
actions, the two library files and the effect (installed into REAPER's Effects folder). After installing, put the
executable in `<resource>/Scripts/Playhead/` or choose it in **Playhead - Settings**.

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

**Playhead - Write curves as automation.** Asks which curve goes to which of eight slots (by name or label, for
example `harshness`, `tension`, `onset`, `impulsiveness`, `n1Kurtosis`; an empty slot is left as it was), and writes
each as envelope points on that slot of the **Playhead Control** effect, inserting the effect first on the track if
it is missing. Points are written over the item's time range only; points outside it stay, and the envelope keeps
its value at the item's edges. The curve follows the take: start offset, playback rate, loop and reversed sections.
Options:
- *Scaling*: `fixed` writes the curves as the strip shows them (the 0..1 curves as they are, the descriptor curves on
  their 5th to 95th percentile in the file, loudness in LUFS from -60 to 0); `item` stretches each curve so that its
  5th to 95th percentile inside the item spans 0..1, which uses a parameter's full range on any material.
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
again.

**Playhead - Strip window.** A dockable window that draws the selected item as a Playhead strip in a chosen look:
the waveform (plain, tinted by a curve or sculpted by loudness), the spectrogram, curves as lanes or over the
waveform (filled, mirrored, horizon or line), events, onsets, beats, bar lines, sections and novelty marks, with a
legend under the strip. It follows the take (offset, rate, loop, reversed sections), shows the edit and play
cursors, and moves the edit cursor where you click. Right-click for the ready-made looks (those a file cannot show
are greyed), your own look code (for example `wave:harshness lane:activity ticks:events`; codes from the Playhead
app can be pasted; the views of rhythm and form, such as the bar raster, the tempogram and the modulation spectrogram,
are not drawn here yet and the waveform stands in for them), analysing again, automatic analysis of newly selected
items, and docking. Space starts and stops
playback. Colours follow the REAPER theme where it offers them. The strip is drawn once and redrawn only when the
item, the look, the window size or the theme changes. As a toolbar button it shows whether the window is open.

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
time mapping of a take (`take_map`, `project_to_file`, `file_to_project`), point reduction, the strip renderer and
look codes, and `lib/playhead_reaper.lua` has the REAPER side (finding the command line, the cache,
`with_documents`, runs that do not block, Playhead Control and its envelopes); the example above shows the pattern.

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

The core is checked against documents made by the command line and against what `src/playhead.js` computes from
them: `curveAt`, `toMarkers`, look codes, legends and the rectangles, triangles and texts `drawStrip` draws for
every look without a spectrogram (`test/make_fixtures.js` writes `test/fixtures/`). Every action script then runs in
a mock REAPER that checks each API call against its documented signature, with the real command line (when Node is
installed) started through the job scripts. What cannot be checked outside REAPER: the drawing itself, the dialogs'
look, the JSFX, and REAPER's own behaviour behind the calls (listed in the scripts' comments where it matters).
