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
```

| Function | Returns |
|---|---|
| `analyze(input, opts)` | a JSON document (below). `input` is an `AudioBuffer` or `{ sampleRate, channels: [Float32Array, ...] }` (mono or stereo). `opts`: `profile`, `name`, `curveRate` (curve samples per second; default 100 up to 10 s, 20 above), `waveColumns` (default 1000), `assetClass` (override the guess), `onProgress(p)` |
| `drawStrip(ctx, doc, opts)` | draws a strip into any Canvas 2D context, including an `OffscreenCanvas` in a worker. `opts`: `width`, `height`, `from`, `to` (seconds), `curve` (the line), `colour` (the curve that colours the waveform, `null` for none), `lineRange`, `events`, `sections`, `beats`, `theme` |
| `toMarkers(doc, { kinds })` | `[{ kind: "region" | "marker", start, end?, name }]` from `sections`, `events`, `downbeats`, `onsets` |
| `curveAt(doc, name, t, fallback)` | a curve's value at time `t`, interpolated: for driving generator and effect parameters |
| `process(input, toolId, params)` | runs one of the effects bench tools: `{ outputs: [{ suffix, sampleRate, channels }], report }` |
| `tools()` | the tools and their parameters (id, label, range, default) |

**Profiles** (one core of the development machine, stereo 44.1 kHz; document size in brackets):

| Profile | Computes | 2 s | 30 s | 120 s |
|---|---|---|---|---|
| `fast` | curves C1–C7, onsets, loudness summary, waveform overview | 0.13 s (27 KB) | 0.37 s (54 KB) | 1.3 s (151 KB) |
| `sfx` | + events with tags, NMF layers, asset checks, descriptors N1–N9 | 0.41 s (38 KB) | 1.5 s (94 KB) | |
| `music` | + beats, downbeats, sections | 0.54 s | 1.7 s (94 KB) | 4.1 s (315 KB) |
| `auto` | `sfx` up to 10 s, `music` above | | | |

The first analysis at a new sample rate adds about 0.25 s of one-time calibration.

## The document (schema `playhead-analysis`, version 1)

| Field | Contents |
|---|---|
| `schema`, `schemaVersion`, `generator` | `"playhead-analysis"`, `1`, `{ name, version }` |
| `source` | `name`, `sampleRate`, `channels`, `duration` (s); the command line adds `path` |
| `profile`, `assetClass`, `guessedClass` | what was computed; the class used for the curves (`sfx`, `rhythmic`, `orchestral`, `ambience`…) |
| `summary` | `peakLufs`, `loudnessRange`, `soundStart`, `soundEnd`; with events also `peakDb`, `attack` |
| `curves` | `rate` (samples per second), `start` (0), then one array per curve, `null` where silent. 0–1 on fixed library-wide scales: `loudness`, `activity`, `arousal`, `harshness`, `tension`, `harmonicTension`, `surprise`; in LUFS: `lufs`; with descriptors also `n1Kurtosis`, `n2RepetitionHz`, `n4Velocity` (oct/s), `n5Cpp` (dB), `n5Coherence`, `n6Arrow`, `n7Surprisal`, `n8Recurrence` |
| `wave` | `columns`, `min`, `max`, `rms`: a waveform overview for thumbnails without decoding again |
| `onsets` | onset times (s) |
| `events` | `start`, `end`, `decayEnd`, `peak`, `peakDb`, `tag` (Schaeffer-style, e.g. `N′`), `word` (e.g. `tonal hit`), `facture`, `mass`, `direction`, `f0`, `grains` |
| `layers` | NMF layers: `name`, `hz`, `share`, `start`, `end` |
| `issues` | asset checks: `severity` (`bad`, `warn`, `info`), `text` |
| `descriptors` | whole-file summaries of N1–N9: `kurtosis`, `repetition`, `events` (burstiness, b-value, temporal entropy), `motion`, `periodicity`, `arrow`, `interest`, `recurrence`, `decay` (`t60`, `logTauD`, `material`) |
| `rhythm`, `sections` | music profile: `tempo`, `reliable`, `clarity`, `beats`, `downbeats`; `[{ start, end, label }]` |
| `timing` | `ms` taken |

Fields not computed by a profile are `null`. Version 1 may gain fields; a change that removes or redefines one raises `schemaVersion`.

## Recipes

These are starting points: the library, command line and document are tested here, the host-side code below is not yet tested inside each host.

### SFX Workbench (browser, ES modules)

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

### REAPER (Lua script and the executable)

`playhead markers <file>` prints tab-separated lines (`kind  start  end  name`) that a script turns into regions and markers at the item's position:

```lua
-- Playhead: sections and downbeats of the selected item as regions and markers (starting point)
local PLAYHEAD = "playhead"   -- or the full path to playhead.exe
local item = reaper.GetSelectedMediaItem(0, 0)
if not item then reaper.ShowMessageBox("Select an item first.", "Playhead", 0) return end
local take = reaper.GetActiveTake(item)
local file = reaper.GetMediaSourceFileName(reaper.GetMediaItemTake_Source(take), "")
local pos, len = reaper.GetMediaItemInfo_Value(item, "D_POSITION"), reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
local offs, rate = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS"), reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
local out = reaper.ExecProcess(string.format('"%s" markers "%s" --kinds sections,downbeats', PLAYHEAD, file), 0)
if not out then return end
reaper.Undo_BeginBlock()
for line in out:gmatch("[^\r\n]+") do
  local kind, s, e, name = line:match("^(%a+)\t([%d%.]+)\t([%d%.]*)\t(.*)$")
  if kind then
    local t = pos + (tonumber(s) - offs) / rate
    if t >= pos and t <= pos + len then
      if kind == "region" and e ~= "" then reaper.AddProjectMarker2(0, true, t, math.min(pos + len, pos + (tonumber(e) - offs) / rate), name, -1, 0)
      else reaper.AddProjectMarker2(0, false, t, 0, name, -1, 0) end
    end
  end
end
reaper.Undo_EndBlock("Playhead markers", -1)
```

Next steps for REAPER: curves as take or track envelopes (`curveAt` sampled at the envelope's points), and de-harsh's gate written as automation for ReaEQ, the "analysis drives ordinary plug-ins" case from the paper.

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
