# Using Playhead in other applications

Playhead's analysis can run inside another program in three ways:

| Way | For | Files |
|---|---|---|
| **Library** in the browser or Node | web tools (SFX Workbench, kurator's front end), Node tools | `dist/playhead-core.mjs` (ES module), `dist/playhead-core.js` (script tag, `importScripts`, `require`) |
| **Command line** | anything that can start a process: REAPER scripts, Python (kurator's server), Unity editor scripts, batch jobs | `playhead` / `playhead.exe` (one file, no Node needed), or `node tools/playhead-cli.js` |
| **JSON documents** | storing analysis next to assets, databases, game data | the output of both, schema `playhead-analysis` version 1 |

Everything is deterministic: the same audio gives the same document. The bundles produce exactly the documents the sources do (checked by `npm test`), and they define no globals in the host page or module.

## Getting the files

- `npm run build` writes `dist/` and copies it to the site, so after deployment the bundles are at `https://eigensoundlab.github.io/playhead/dist/playhead-core.mjs` (and `.js`). Vendor a copy into your project rather than loading it from there, and record the version (`Playhead.version`).
- Each GitHub release gets the bundles and the executables for Linux, macOS and Windows (`.github/workflows/cli.yml`). `npm run build:cli` builds the executable for the current machine.
- The executable reads WAV itself; other formats need `ffmpeg` on the PATH, or decode them yourself and pipe the samples in (see kurator below).

## API

```js
import Playhead from "./vendor/playhead-core.mjs";   // or: const Playhead = require("./playhead-core.js")

const doc = await Playhead.analyze({ sampleRate: 48000, channels: [left, right] }, { profile: "auto", name: "door_slam.wav" });
Playhead.drawStrip(canvas.getContext("2d"), doc, { from: 0, to: doc.source.duration });
const marks = Playhead.toMarkers(doc, { kinds: ["sections", "downbeats"] });
const v = Playhead.curveAt(doc, "tension", 12.5);
const r = await Playhead.process(sound, "deharsh", { amount: 0.6 });   // r.outputs[0].channels, r.report
const whole = Playhead.combine([{ doc: kick }, { doc: bass, offset: 0.5, gain: -3 }]);   // the sum, from documents alone
```

| Function | Returns |
|---|---|
| `analyze(input, opts)` | a JSON document (below). `input` is an `AudioBuffer` or `{ sampleRate, channels: [Float32Array, ...] }` (mono or stereo). `opts`: `profile`, `name`, `curveRate` (curve samples per second; default 100 up to 10 s, 20 above), `waveColumns` (default 1000), `assetClass` (override the guess), `onProgress(p)` |
| `drawStrip(ctx, doc, opts)` | draws a strip into any Canvas 2D context, including an `OffscreenCanvas` in a worker, and returns `{ code, layers, legend, items }` (`items`: one `{ label, colour }` or `{ label, ramp }` per coloured element, for a host's own key). `opts`: `width`, `height`, `from`, `to` (seconds), `theme`, and `look` (a look name or look code, see [Looks](#looks)) or `layers`; without them the automatic look, which the older options `curve`, `colour`, `lineRange`, `events`, `sections`, `beats` still adjust |
| `fromAnalysis(F, input, opts)` | the document for an existing `WL.analyse()` result, without analysing again |
| `parseLook(code)`, `lookCode(layers)`, `describeLook(layers, doc)` | look code to layers and back; a plain-language legend |
| `looks`, `curveLabels` | the ready-made looks (`name`, `desc`, `code`) and readable names of the curves, for menus |
| `toMarkers(doc, { kinds })` | `[{ kind: "region" | "marker", start, end?, name }]` from `sections`, `events`, `downbeats`, `onsets` |
| `curveAt(doc, name, t, fallback)` | a curve's value at time `t`, interpolated: for driving generator and effect parameters |
| `process(input, toolId, params)` | runs one of the effects bench tools: `{ outputs: [{ suffix, sampleRate, channels }], report }` |
| `tools()` | the tools and their parameters (id, label, range, default) |
| `combine(parts, opts)` | a document for the sum of several sounds, from their documents alone (no audio, no new analysis), for folder tracks, layered effects and stems. `parts`: `[{ doc, offset, gain }]` (seconds, dB). `opts`: `rate`, `duration`, `wave` (a real overview of the sum, instead of the estimate), `aligned`. `doc.combined` lists the parts and the rule used for each curve ([Combining](#combining-documents)) |
| `align(parts, opts)` | the parts on one time axis: per part its power per column and, when all have spectrograms, per column and band. For views that show which part carries what |
| `localize(table)` | shows the curve names, looks, legends and tools in another language; `table` is `dist/i18n/<lang>.json` (Czech, German, Polish, Russian, Spanish), `null` returns to English. Documents are unaffected: only labels change |

**Profiles** (one core of the development machine, stereo 44.1 kHz; document size in brackets):

| Profile | Computes | 2 s | 30 s | 120 s |
|---|---|---|---|---|
| `fast` | curves C1–C7, onsets, loudness summary, waveform overview | 0.13 s (27 KB) | 0.37 s (54 KB) | 1.3 s (151 KB) |
| `sfx` | + events with tags, NMF layers, asset checks, descriptors N1–N9 | 0.41 s (38 KB) | 1.5 s (94 KB) | |
| `music` | + beats, downbeats, sections | 0.54 s | 1.7 s (94 KB) | 4.1 s (315 KB) |
| `auto` | `sfx` up to 10 s, `music` above | | | |

The first analysis at a new sample rate adds about 0.25 s of one-time calibration. The `sfx` and `music` documents
also carry a small mel spectrogram for the spectrogram layer: about 5.3 KB per second of sound up to 10 s (100 columns
per second) and 1.1 KB per second above (20 columns per second). `analyze(..., { spectrum: false })` leaves it out;
`fast` leaves it out unless `spectrum: true`.

**Combining documents.** Analyse the parts with the same `profile`, `assetClass` and `curveRate`. LUFS and the
spectrogram add as power and a part's gain moves them exactly; loudness follows from the summed LUFS; harshness is the
whole's loudness plus the parts' power-weighted harshness above their own loudness; activity, arousal, tension and
novelty take the strongest part; onset strength adds up; onsets, events and novelty ticks are merged (a part that starts
with sound gets an onset at its entry). The beat grid is the clearest part's, and sections are left out: they need the
whole. On 14 sessions built from separate parts ([experiments/compose](../experiments/compose/README.md)) loudness and
the spectrogram matched the analysed mix closely, activity, arousal and harshness roughly (r 0.8 to 0.99), tension and
novelty less (0.72, 0.51), events poorly (F about 0.5): three layers struck together are one event in the mix. Where
the combined and the analysed whole differ is itself worth showing: it is where the parts interact.

## The document (schema `playhead-analysis`, version 1)

| Field | Contents |
|---|---|
| `schema`, `schemaVersion`, `generator` | `"playhead-analysis"`, `1`, `{ name, version }` |
| `source` | `name`, `sampleRate`, `channels`, `duration` (s); the command line adds `path` |
| `profile`, `assetClass`, `guessedClass` | what was computed; the class used for the curves (`sfx`, `rhythmic`, `orchestral`, `ambience`…) |
| `summary` | `peakLufs`, `loudnessRange`, `soundStart`, `soundEnd`; with events also `peakDb`, `attack` |
| `curves` | `rate` (samples per second), `start` (0), then one array per curve, `null` where silent. 0–1 on fixed library-wide scales: `loudness`, `activity`, `arousal`, `harshness`, `tension`, `harmonicTension`, `surprise`; in LUFS: `lufs`; with descriptors also `n1Kurtosis`, `n2RepetitionHz`, `n4Velocity` (oct/s), `n5Cpp` (dB), `n5Coherence`, `n6Arrow`, `n7Surprisal`, `n8Recurrence`; `onsetStrength` (spectral flux, the beat tracker's input, 0–1 to its 99th percentile: where the hits and attacks are); music profile also `structureNovelty` (Foote novelty, 0–1, values in silence too) and `localPulse` (PLP scaled by its clarity, 0–1). `n1Kurtosis` is drawn where the impulses are (each 0.5 s window's value given to its frames in proportion to their power), so it no longer rises half a window before an impulse; the descriptor summaries keep the window values. New curves are added without changing the schema version: read the ones you know and ignore the rest |
| `noveltyTicks` | times (s) of the strongest spectral surprises, the lab's novelty ticks (music and ambience; empty for sound effects) |
| `spectrum` | `sfx` and `music` profiles: a mel spectrogram for drawing. `bands` (40), `fmin`, `fmax` (Hz), `columns` (as the curves), `dbTop` and `dbRange` (80 dB mapped to 0–255), `data`: base64 of one byte per band and column, column after column, lowest band first |
| `wave` | `columns`, `min`, `max`, `rms`: a waveform overview for thumbnails without decoding again |
| `onsets` | onset times (s) |
| `events` | `start`, `end`, `decayEnd`, `peak`, `peakDb`, `tag` (Schaeffer-style, e.g. `N′`), `word` (e.g. `tonal hit`), `facture`, `mass`, `direction`, `f0`, `grains` |
| `layers` | NMF layers: `name`, `hz`, `share`, `start`, `end` |
| `issues` | asset checks: `severity` (`bad`, `warn`, `info`), `text` |
| `descriptors` | whole-file summaries of N1–N9: `kurtosis`, `repetition`, `events` (burstiness, b-value, temporal entropy), `motion`, `periodicity`, `arrow`, `interest`, `recurrence`, `decay` (`t60`, `logTauD`, `material`) |
| `rhythm`, `sections` | music profile: `tempo`, `reliable`, `clarity`, `beats`, `downbeats`; `[{ start, end, label }]` |
| `timing` | `ms` taken |

Fields not computed by a profile are `null`. Version 1 may gain fields; a change that removes or redefines one raises `schemaVersion`.

## Looks

A strip is a list of layers on one time axis; a **look** is a named list, and a **look code** is the same list as short
text that hosts can store, offer in a menu, paste between apps and send with feedback.

| Layer | Code | Draws |
|---|---|---|
| waveform | `wave` or `wave:<curve>` | the waveform, plain or tinted along the theme's ramp (`waveLow` → `waveHigh`) by a 0–1 curve; over a spectrogram, its outline |
| spectrogram | `spec` | the document's mel spectrogram (40 bands, 40 Hz–16 kHz, low at the bottom, colours from `specRamp`) |
| line | `line:<curve>` | a curve over the waveform (descriptor curves on their 5th–95th percentile) |
| lane | `lane:<curve>` or `lane:<curve>~signed` | a curve in its own lane under the waveform (up to three lanes share about half the height). `~signed` is for change curves such as `structureNovelty`: drawn up where the level rises across the change (an entry), down where it falls (a fall in level, a break into silence) and centred where only the material changes, so a break never reads as "more" |
| sections | `sections` | boundaries and letters (music profile) |
| marks | `ticks:<kinds>` | `events`, `onsets`, `beats` under the waveform, `downbeats` as ticks with faint bar lines through the strip, and `novelty` (the strongest spectral surprises) from the top edge, joined with `+`. Beats and bar lines are faint where the beat is not steady and missing for sound effects (the legend says so) |
| outline | `outline` | the ordinary peak waveform as a contour over what is drawn before it (theme key `outline`) |
| height | `sculpt:<curve>` | reshapes the waveform layer: its envelope follows the curve while its detail stays. `sculpt:loudness` gives a waveform as loud as it sounds (a dB-like scale); the outline layer keeps the ordinary peaks for comparison |
| form | `form:lanes` (default) or `form:overlay` | lanes each in their own band under the waveform, or all of them drawn on the waveform itself (light fill and a contour, so the waveform stays visible) |
| shape | `shape:base` (default), `shape:mirror`, `shape:horizon`, `shape:line` | how a lane's curve is drawn: filled from the bottom; mirrored around the middle, like a waveform; a horizon chart (folded into three bands of rising strength, compact at small heights); a line |

Without a waveform or spectrogram the lanes share the whole strip, so curves can stand in for the waveform
(`shape:mirror,lane:loudness,lane:activity,lane:harshness`).

Ready-made looks (`Playhead.looks`): `auto` (the default: by profile), the two references `plain` (waveform only) and
`spectrum` (spectrogram), `structure` (`wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats`),
`rhythm`, `tension`, `events`, `lanes` (three separate lanes, no colour mixing), `shapes` (curves mirrored like
waveforms, no waveform), `overlay` (curves drawn on the waveform), `horizon` (horizon lanes) and `specstructure`
(spectrogram with sections and structural change), `overview` (music: curves only, overlaid and mirrored, with
sections, bar lines and novelty marks), `hits` (onset strength and local pulse under the waveform), two sound-effect
looks suggested by testing, `character` (`form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n1Kurtosis,ticks:onsets`:
where the hits are, how harsh, how impulsive) and `surprise` (the same with spectral surprise in place of
impulsiveness), and `sculpted` (`sculpt:loudness,wave:harshness,outline,ticks:events+novelty`: the waveform as loud as
it sounds, coloured by harshness, over the ordinary peak outline).
`Playhead.lookFits(doc, look)` says whether a look shows something for a document (every curve it uses is there and not
empty), for menus that hide looks a file cannot use. A layer whose curve is not in the document is left out and the
legend says so (`structure` and `rhythm` need the music profile).

```js
const r = Playhead.drawStrip(g, doc, { look: "wave:harshness,lane:activity,ticks:events", theme });
legendElement.textContent = r.legend;      // "colour: harshness · lane: activity · marks: events"
```

Hosts should draw only through `drawStrip` and take the legend from its return value, so a new Playhead build
changes the look everywhere by replacing one file. The Playhead app's composer ("Compose your own") builds look codes
and links to a feedback form (`.github/ISSUE_TEMPLATE/look-feedback.yml`, prefilled with the code); hosts can link to
`https://github.com/eigensoundlab/playhead/issues/new?template=look-feedback.yml&look=<code>&app=<host name>`.

## Recipes

These are starting points: the library, command line and document are tested here, the host-side code below is not yet tested inside each host.

### SFX Workbench (browser, ES modules)

Implemented in SFX Workbench 0.6.0 (optional, off by default): a Playhead view of the source and output lanes, Playhead
events as accent anchors next to the built-in transients, a Reaction engine whose medium follows the action's level or
a Playhead curve, morph amounts that follow a curve of A, and a Playhead check of every generated sound. The notes
below are the general recipe.

Copy `dist/playhead-core.mjs` to `src/vendor/`. Analyse in a module worker, as `examples/analysis-worker.mjs` does; for the single-file offline build, either create the worker from a Blob of the bundle's text, or analyse short sounds on the main thread (a 2 s sound takes about 0.4 s; the analysis yields to the page regularly).

```js
// src/app/playhead.js
import Playhead from '../vendor/playhead-core.mjs';
export const analyse = (chs, sr, name) => Playhead.analyze({ sampleRate: sr, channels: chs }, { profile: 'sfx', name });
export function drawPlayhead(canvas, doc, from, to) {
  const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
  Playhead.drawStrip(g, doc, { from, to, curve: 'activity', colour: 'harshness' });   // a third display mode next to waveform and spectrum
}
```

Uses that fit the Workbench:
- **Accents from events.** `doc.events` (start, peak, tag, f0) and `doc.layers` are anchor points for `renderAccents()`: an impulse (`′`) gets a slap or debris, an iterative event (`″`) a ring on every grain, a sustained one a swell.
- **Action and reaction.** For an object moving through a reacting medium, the object's analysis drives the medium: its events trigger the medium's response, `n4Velocity` (spectral glide, oct/s) steers the medium's filter or pitch the way a pass-by does, `activity` sets the density of a texture, `n6Arrow` tells a hit (positive) from a swell (negative).
  ```js
  const at = (name, t, fb = 0) => Playhead.curveAt(doc, name, t, fb);
  for (const e of doc.events) medium.excite(e.start, e.facture === 'impulse' ? 'slap' : 'swell', e.peakDb);
  textureParams.density = t => 0.2 + 0.8 * at('activity', t);
  filter.cutoff = t => 2000 * Math.pow(2, at('n4Velocity', t) * 0.25);
  ```
- **Checking generators.** The decay measure (N9) reads the material back from a generated impact: in a first test, the impact engine's loss factors predicted `log τd` within 0.02–0.08 for steel, brass, glass, aluminium, ice, ceramic and wood, in the right order. Very damped materials (plastic, stone, cardboard, rubber) decay faster than the 0.12 s the measure needs.
- **Effects bench tools** through `Playhead.process()`: de-harsh, layer remix, attack and body, tension shaper, loop maker, variations.

### kurator (Python server, JavaScript front end)

Two parts:
1. **Server, for the library.** Run the executable on each sound (the `fast` profile for browsing, `auto` on demand) and store the document next to the existing wave data. kurator already decodes with soundfile, so it can pipe samples in and needs no ffmpeg:
   ```python
   import json, shutil, subprocess
   from . import audio_analysis

   def playhead_doc(path: str, profile: str = "fast") -> dict | None:
       exe = shutil.which("playhead")
       if not exe:
           return None
       x, sr = audio_analysis.mono(path, rate=44100)          # or the stereo blocks from audio_analysis.blocks()
       r = subprocess.run([exe, "analyze", "-", "--sr", str(sr), "--channels", "1", "--profile", profile, "--name", path],
                          input=x.astype("<f4").tobytes(), capture_output=True, timeout=600)
       return json.loads(r.stdout) if r.returncode == 0 else None
   ```
   Descriptor summaries then become sort keys and filters (impulsive, repetitive, metal-like, long ring, harsh), and `wave` plus two curves are enough to draw a thumbnail without decoding again.
2. **Front end, for the viewer.** Serve `playhead-core.mjs` from `kurator/static/vendor/`, add a "Playhead" mode to `WAVE_MODES` in `waveview.js`, fetch the stored document from a new endpoint (for example `/api/audio/{id}/playhead`) and draw it with `drawStrip()` at the viewer's zoom (`from`, `to`).

### REAPER (Lua scripts and the executable)

[`integrations/reaper/`](../integrations/reaper/README.md) is a ReaScript package (ReaPack headers included) that
runs the executable without blocking REAPER and keeps the documents in a cache. Its actions analyse the selected
items, add events and onsets as take markers and sections and downbeats as regions and markers, write curves as
automation on a small JSFX (Playhead Control) whose parameters can drive any plug-in through parameter links or
MIDI CC, render the effects bench tools as new takes, and draw the item in any look in a dockable strip window. All
of them follow the take's start offset, playback rate, loop and reversed sections. Its Lua core (document reader,
time mapping, strip renderer, command lines) is tested against the documents and `drawStrip` here.

### Unity (editor import, runtime curves and events)

Analyse in the editor and ship the documents; the game only reads them, which costs almost nothing at runtime. Unity's `JsonUtility` cannot hold `null`, so ask for numbers in silent places with `--fill-null 0`:

```csharp
// Assets/Editor/PlayheadImport.cs
using System.Diagnostics; using System.IO; using UnityEditor; using UnityEngine;
public static class PlayheadImport {
    const string Exe = "playhead";   // or the full path to playhead.exe
    [MenuItem("Assets/Playhead/Analyse selected audio")]
    static void Analyse() {
        foreach (var clip in Selection.GetFiltered<AudioClip>(SelectionMode.Assets)) {
            var asset = AssetDatabase.GetAssetPath(clip);
            var psi = new ProcessStartInfo(Exe, $"analyze \"{Path.GetFullPath(asset)}\" --fill-null 0") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi); var json = p.StandardOutput.ReadToEnd(); p.WaitForExit();
            File.WriteAllText(Path.ChangeExtension(asset, ".playhead.json"), json);
        }
        AssetDatabase.Refresh();
    }
}
```

```csharp
// Runtime: curves and events of the playing clip (TextAsset = the .playhead.json)
using UnityEngine; using UnityEngine.Events;
public class PlayheadDriver : MonoBehaviour {
    [System.Serializable] public class Curves { public float rate; public float[] activity, tension, harshness; }
    [System.Serializable] public class Ev { public float start; public string tag, word; }
    [System.Serializable] public class Doc { public Curves curves; public Ev[] events; }
    public AudioSource source; public TextAsset analysis; public UnityEvent<string> onEvent;
    Doc doc; int next; float last;
    void Awake() { doc = JsonUtility.FromJson<Doc>(analysis.text); }
    public float At(float[] c) => c[Mathf.Clamp((int)(source.time * doc.curves.rate), 0, c.Length - 1)];
    void Update() {
        float t = source.time; if (t < last) next = 0; last = t;                   // looped or restarted
        while (next < doc.events.Length && doc.events[next].start <= t) onEvent.Invoke(doc.events[next++].word);
        // e.g. camera shake from impacts, rumble from activity, music intensity from tension:
        // shake.amplitude = At(doc.curves.activity);
    }
}
```

The same documents give adaptive music its section and downbeat times (transitions on bar lines), and give mixing its trigger curves (duck the music under impacts, a de-harsh-style band cut that follows `harshness`).

## Limits

- Whole-file analysis: the sound must fit in memory (stereo 44.1 kHz is about 21 MB per minute).
- Mono and stereo; further channels are ignored.
- Decays shorter than 0.12 s get no material estimate.
- NMF layers are at most three, and layer and event analysis is meant for sounds up to a few minutes.
- The browser decodes only what it supports (Ogg Vorbis needs Safari 18.4 or later).
