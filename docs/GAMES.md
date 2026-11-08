<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Playhead in games: visuals, events and effects driven by sound

A game knows most of its sounds before they play: the music, its stems, every weapon, door, engine and footstep. Playhead
analyses each one once, when it is imported or built, and gives what happens in it with its time: hits in each band to
the sample, the bar, sections, builds and their drops, fills and breaks, slides and vibrato, where a sound starts, booms
and rings out, a source passing by, distortion. Rules turn those events into **cues**: flash here, shake there, darken
the scene for the two bars before the drop. At run time the game plays the cues against the audio clock. Nothing is
analysed while the game runs.

The usual way analyses the sound as it plays: bands of a spectrum, a level, a beat when a band jumps over its average.
It reacts after the fact, knows no structure, and its thresholds need tuning for each track. On the demos in the
[Audiovisual Playhead](https://eigensoundlab.github.io/playhead/av/) ([experiments/av](../experiments/av/README.md)):

| | Usual audio-reactive | Playhead |
|---|---|---|
| Kicks, snares and hats of a dance arrangement | all kicks, 29 of 81 snares, 133 of 190 hats, 8 to 9 ms late (and a frame) | all kicks, 80 of 81 snares, 168 of 190 hats, on time |
| The build and its drop (not louder) | no start, no end, no drop | from its section start to the drop, the drop 14 ms off |
| Sections, a fill, a break, a pass-by | none | all |
| A melody's note starts | 1 of 38 | 31 of 38 |
| Its slides, vibrato and phrases | none | 4 of 6 slides, 17 of 17 vibratos at 5.5 Hz, 3 of 3 phrase starts |
| A weapon's shots, booms and bolt clicks | all, from beats in any band (58 triggers for 5 shots) | all, each to its attack |
| The shots' after-effects, a motor's spin-up and its rotor | none | 3 of 3 tails, both glides, the rotor at 24.2 Hz |

These are synthesized demos with their parts known, not a survey of games' audio. They show the kinds of cue each way
can give.

## The pipeline

1. **Analyse** every sound once, at import or in the build:
   ```
   playhead analyze Music/ --profile music --out-dir Analysis/
   playhead analyze Sfx/Weapons/ --profile sfx --out-dir Analysis/
   ```
   (`auto` takes sfx up to 10 s and music above.) The documents are JSON ([INTEGRATION.md](INTEGRATION.md)).
2. **Make cue sheets** from rules:
   ```
   playhead cues Analysis/level3.playhead.json --preset furnace --out Cues/level3.cues.json
   playhead cues Analysis/rifle.playhead.json --rules Rules/weapon.json --out Cues/rifle.cues.json
   ```
   Or write the rules in the [Audiovisual Playhead](https://eigensoundlab.github.io/playhead/av/), watch them on the
   sound, and export the cue sheet (or copy the rules as JSON for the command line).
3. **Play** the cue sheet with the sound: each frame, read the sound's own clock, fire the cues that have started,
   and read each action's level.

## Rules

A rule: when an **event** happens, do an **action**, by an amount, for a time, in a shape, at the event, before it or
after it. Actions are names: your game decides what `sparks` or `darken` means.

```json
{ "rules": [
    { "on": "hit.high", "do": "sparks", "amount": 1, "length": 0.25 },
    { "on": "section.new", "do": "palette", "length": 1.5, "shape": "hold" },
    { "on": "build", "do": "darken", "lengthUnit": "event", "length": 1, "shape": "ramp", "amount": 0.7, "scale": false },
    { "on": "drop", "do": "darken", "at": -2, "unit": "bars", "length": 2, "lengthUnit": "bars", "shape": "ramp" },
    { "on": "drop", "do": "event", "name": "eruption", "length": 0.1 },
    { "on": "sound", "where": { "word": ["noise", "noise hit"] }, "do": "flash", "length": 0.1 }
  ],
  "mappings": [ { "from": "distortion", "do": "rough", "amount": 1 } ] }
```

| Field | Meaning |
|---|---|
| `on` | the event (below) |
| `where` | only events whose data match: `{ "word": "noise" }`, `{ "word": ["noise", "noise hit"] }`, `{ "label": "B" }`, `{ "semitones": { "min": 3 } }` |
| `every` | only every n-th matching event |
| `at`, `unit` | when, against the event: negative before it, positive after, in `s`, `beats` or `bars` (default 0, at it) |
| `do` | the action's name; `event` with `name` is a game event, for gameplay rather than looks |
| `amount` | the peak level (default 1), times the event's own strength unless `scale` is false |
| `length`, `lengthUnit` | how long, in `s`, `beats`, `bars`, or `event`: that many times the event's own length (a build to its drop, a tail, a glide) |
| `shape` | `pulse` (full, dying away), `hold`, `ramp` (rising to full at its end: start it before an event to land on it), `swell` (up and down), `fade` |

A **mapping** makes an action follow a signal all the time: `{ "from": "buildup", "do": "streaks", "amount": 1, "gamma": 1 }`.

**Events**: `hit.low`, `hit.mid`, `hit.high` (each band's hits: below 200 Hz, to 2 kHz, above; a snare's body is left
out of the low band and a kick's click out of the mid, every hat is kept), `attack` (one per moment, with its band),
`beat`, `bar`, `section`, `section.new`, `section.repeat` (with its `label`), `build` (its length runs to its drop),
`drop`, `fill`, `break`, `sound` (a sound starts, to its attack, with its `word`: noise, noise hit, tonal hit, sweep,
chirp ...), `peak` (its loudest moment, the boom), `tail` (its after-effect: from 10 dB under its peak to 40 dB under,
cut where another sound about as loud begins), `glide`, `glide.up`, `glide.down` (with `semitones`), `passBy` (its length
from approach to leaving, its `peak` the closest moment, its `speed`), `vibrato` (with its `rate` in Hz), `layer`.

**Signals** for mappings, 0 to 1: `loudness`, `tension`, `buildup`, `distortion`, `harshness`, `novelty`, `surprise`,
`pitch` (C2 to C7), `pitchMotion`, `brightness`.

**Presets** (`playhead cues --preset`): `playhead` (rhythm as Playhead reads it), `usual` (the usual mapping, for
comparison), `anticipation` (cues that land on the moment), `furnace` (a game scene), `melodic` (phrases, slides,
vibrato), `weapon`, `impact` and `device` (sound effects). Each is a starting point to copy and change.

## The cue sheet

```json
{ "format": "playhead-cues", "version": 1, "source": { "name": "level3", "duration": 63.4 },
  "rules": [...], "mappings": [...],
  "cues": [ { "t": 34.88, "length": 3.87, "action": "darken", "amount": 0.8, "shape": "ramp", "on": "drop", "rule": 0 },
            { "t": 38.70, "length": 0.1, "action": "event", "name": "eruption", "amount": 1, "shape": "pulse", "on": "drop", "rule": 4 } ],
  "curves": { "rate": 30, "values": { "rough": [0, 0, 0.02, ...] } } }
```

Times in seconds from the start of the sound, sorted. A cue's level at time `t` is `amount × shape(u)`, `u = (t −
cue.t) / length` from 0 to 1, with `pulse` = e^(−4u), `hold` = 1, `ramp` = u, `swell` = sin(πu), `fade` = 1 − u. Cues of
one action combine by their maximum; a mapping's curve joins the same maximum. `palette` counts turns (each cue one,
crossfading over its length); `pass` carries `data.start`, `data.length` and `data.peak` to place the passing light.
A live source (the usual signals) cannot look ahead: there, a cue set before its event starts at the event.

## Unity

The cue sheet is plain JSON; read it with Newtonsoft Json (package `com.unity.nuget.newtonsoft-json`), since its curves
are a dictionary. Time the cues by the **sound's own clock**, not by frames: `AudioSource.timeSamples` divided by the
clip's frequency.

```csharp
// PlayheadCues.cs: a Playhead cue sheet, and its levels at a time (Unity 2020.2 or later, Newtonsoft Json)
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

[Serializable] public class PlayheadCue {
    public float t, length, amount; public string action, shape, on, name; public int rule;
    public Newtonsoft.Json.Linq.JObject data;      // pass: start, length, peak; palette: the section's label
}
[Serializable] public class PlayheadCurves { public float rate; public Dictionary<string, float[]> values; }
[Serializable] public class PlayheadCueSheet {
    public string format; public int version; public List<PlayheadCue> cues; public PlayheadCurves curves;

    public static PlayheadCueSheet Parse(string json) {
        var s = JsonConvert.DeserializeObject<PlayheadCueSheet>(json);
        s.cues.Sort((a, b) => a.t.CompareTo(b.t));
        foreach (var c in s.cues) s.maxLength = Mathf.Max(s.maxLength, c.length);
        return s;
    }
    [NonSerialized] public float maxLength;

    public static float Shape(string shape, float u) => shape switch {
        "hold" => 1f, "ramp" => u, "swell" => Mathf.Sin(Mathf.PI * u), "fade" => 1f - u, _ => Mathf.Exp(-4f * u) };

    // each action's level at time t: the strongest running cue, and the mapping curves
    public void Levels(float t, Dictionary<string, float> into) {
        into.Clear();
        int hi = cues.FindLastIndex(c => c.t <= t);
        for (int i = hi; i >= 0 && cues[i].t >= t - maxLength; i--) {
            var c = cues[i]; float u = (t - c.t) / c.length;
            if (u < 0f || u > 1f || c.action == "event" || c.action == "palette") continue;
            float v = c.amount * Shape(c.shape, u);
            if (!into.TryGetValue(c.action, out var old) || v > old) into[c.action] = v;
        }
        if (curves?.values == null) return;
        foreach (var kv in curves.values) {
            var a = kv.Key.Split('.')[0]; int k = Mathf.Clamp((int)(t * curves.rate), 0, kv.Value.Length - 1);
            if (!into.TryGetValue(a, out var old) || kv.Value[k] > old) into[a] = kv.Value[k];
        }
    }
}
```

```csharp
// PlayheadCuePlayer.cs: plays a cue sheet with an AudioSource; bind actions to anything in the Inspector
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class PlayheadCuePlayer : MonoBehaviour {
    [Serializable] public class Binding {
        public string action;                       // "sparks", "darken", "event" ...
        public string eventName;                    // for "event": which one
        public UnityEvent<float> level;             // every frame: the action's level, 0..1
        public UnityEvent<PlayheadCue> started;     // once per cue, when it starts
    }
    public TextAsset cueSheet;
    public AudioSource source;
    public List<Binding> bindings = new List<Binding>();

    PlayheadCueSheet sheet;
    readonly Dictionary<string, float> levels = new Dictionary<string, float>();
    int next; float last = -1f;

    void Awake() { sheet = PlayheadCueSheet.Parse(cueSheet.text); }

    public float Now => source.clip ? (float)source.timeSamples / source.clip.frequency : 0f;

    void Update() {
        if (sheet == null || !source.isPlaying) return;
        float t = Now;
        if (t < last) { int i = sheet.cues.FindIndex(c => c.t >= t); next = i < 0 ? sheet.cues.Count : i; }   // looped or sought back
        // the cues that started since the last frame (a cue shorter than a frame still starts once)
        while (next >= 0 && next < sheet.cues.Count && sheet.cues[next].t <= t) {
            var c = sheet.cues[next++];
            foreach (var b in bindings)
                if (b.action == c.action && (c.action != "event" || b.eventName == c.name)) b.started?.Invoke(c);
        }
        last = t;
        sheet.Levels(t, levels);
        foreach (var b in bindings) if (b.action != "event") b.level?.Invoke(levels.TryGetValue(b.action, out var v) ? v : 0f);
    }

    // what is coming: for gameplay that must get ready (spawn, aim, load) before its moment
    public IEnumerable<PlayheadCue> Upcoming(string action, float within) {
        float t = Now;
        foreach (var c in sheet.cues) { if (c.t > t + within) yield break; if (c.t > t && c.action == action) yield return c; }
    }
}
```

Bind in the Inspector: `sparks.started` → a `ParticleSystem.Emit` wrapper that emits `amount × 40`; `darken.level` →
a post-processing Volume's `weight`; `flash.level` → a Light's intensity; `palette.started` → a material colour lerp;
`shake.started` → your camera shake with `amount` and `length`; `event` `eruption` → the gameplay. A pulse shorter than
a frame still starts once; read `started` for those rather than `level`.

For the tightest sync, start the music with `AudioSource.PlayScheduled(AudioSettings.dspTime + 0.1)`, so the clock
and the picture start together, and on platforms with long output latency (Bluetooth, some Android devices) shift `Now`
back by it.

## Sound effects

Short effects follow the same principle, per asset. Analyse each with the `sfx` profile at import; one rule set per
category of sound (weapon, impact, device, vehicle, interface) then fits every sound of that category, and when a sound
designer replaces an asset its cues follow with it. Out of the box an animation gets its moments from the sound itself.

| Cue | From | Typical use |
|---|---|---|
| Start (muzzle, contact) | `sound`, to its attack | muzzle flash, hit spark, decal |
| Boom | `peak`, `hit.low` | camera shake and recoil scaled by `amount`, controller rumble |
| After-effect | `tail`, `lengthUnit: "event"` | smoke, heat haze, ringing glow for as long as the sound rings |
| Mechanical detail | `hit.high` after the start (`at` or `where`) | bolt, shell ejection, latch, servo clicks |
| Spin-up, spin-down | `glide.up`, `glide.down` with their length | rotor or turbine animation speed, charge-up glow |
| Rotor, engine flutter | `vibrato`, its `rate` (Hz) | blade blur, vibration at the same rate |
| Pass-by | `passBy`, its `peak` and `speed` | fly-by camera, Doppler light, wind gust |
| Grit | the `distortion` mapping | screen grain, sparks density |
| Reverb | `tail`'s length, the document's `descriptors.decay.t60` | a reverb zone's or a smoke volume's lifetime |

```csharp
// WeaponFx.cs: one sound, its cues, any number of shots; pitch-varied playback scales the cue times
using System.Collections;
using UnityEngine;

public class WeaponFx : MonoBehaviour {
    public AudioSource source; public AudioClip shot; public TextAsset shotCues;
    public Light muzzle; public ParticleSystem smoke, casing; public float shakeScale = 1f;
    PlayheadCueSheet sheet;
    void Awake() { sheet = PlayheadCueSheet.Parse(shotCues.text); }

    public void Fire() {
        float pitch = Random.Range(0.95f, 1.05f);
        double start = AudioSettings.dspTime + 0.02;
        source.pitch = pitch; source.clip = shot; source.PlayScheduled(start);
        StartCoroutine(Run(start, pitch));
    }
    IEnumerator Run(double start, float pitch) {
        foreach (var c in sheet.cues) {
            double at = start + c.t / pitch;
            while (AudioSettings.dspTime < at) yield return null;
            float len = c.length / pitch;
            switch (c.action) {
                case "flash": StartCoroutine(Pulse(v => muzzle.intensity = 8f * v, c.amount, len)); break;
                case "shake": CameraShake.Instance?.Shake(c.amount * shakeScale, len); break;   // your camera shake
                case "smoke": { var em = smoke.emission; em.rateOverTime = 60f * c.amount; StartCoroutine(After(len, () => { var e2 = smoke.emission; e2.rateOverTime = 0f; })); break; }
                case "punch": transform.localPosition -= Vector3.forward * 0.03f * c.amount; break;  // recoil, sprung back elsewhere
                case "sparks": casing.Emit(1); break;                                               // the bolt's clicks
            }
        }
    }
    static IEnumerator Pulse(System.Action<float> set, float amount, float len) {
        for (float u = 0; u < 1f; u += Time.deltaTime / len) { set(amount * Mathf.Exp(-4f * u)); yield return null; }
        set(0f);
    }
    static IEnumerator After(float s, System.Action then) { yield return new WaitForSeconds(s); then(); }
}
```

The weapon rules behind it are the `weapon` preset; for a sound with a different character, change the rules, not the
code: a shotgun's longer tail lengthens the smoke by itself, a silenced pistol with no low boom gets no punch and,
quieter, shakes less. The `impact` preset (impacts and explosions) and the `device` preset (motors, turbines, vehicles)
are the other starting points.

### How short effects differ from music

- **No beat or bar.** Give times and lengths in seconds (`unit` and `lengthUnit` `s`, or `event`); in a sound without a
  beat a beat counts as half a second.
- **Times from the sound's own start.** One cue sheet serves every instance of the sound: run it from where that
  instance starts, divide its times by the playback pitch, and give each instance its own run, so overlapping shots
  each keep their cues.
- **Variations.** A random container of five variations has five cue sheets, one per clip; pick the sheet with the
  clip. Analysing a library is quick (a 32 s reel takes about 2.5 s; a thousand one-second sounds, minutes).
- **Layers.** When an effect is assembled from layers at run time (transient, body, tail), analyse each layer and
  offset its cues by the layer's start, or analyse the bounced whole; the bounced whole also gives the tail and the
  boom as they are heard together.
- **Strength.** A cue's `amount` follows its event's strength (unless `scale` is false), so the same rules give a
  heavier shake to a heavier boom; quiet variations get gentler cues without other rules.
- **Each sound start is a `sound`.** A shot whose bolt rings separately has the bolt as a second, quieter sound with
  its own peak: filter with `where` (`{ "word": "noise" }`, `{ "value": { "min": 0.7 } }`) when a rule is meant for
  the shot alone.

### Cues that drive sound

The actions are only names, so a rule set can drive the audio as well as the picture: a sub-bass sweetener or
controller rumble on the boom, the music and ambience ducked for as long as the boom lasts, debris or a shell casing
falling when the after-effect starts, a reverb send that follows the tail, a looping hum pitched along a spin-up, a
rattle modulated at the rotor's rate. One rule set for an explosion:

```json
{ "rules": [
    { "on": "sound", "do": "flash", "length": 0.12 },
    { "on": "peak", "do": "sub", "length": 0.6, "shape": "fade" },
    { "on": "peak", "do": "duck", "length": 1.2, "shape": "fade" },
    { "on": "peak", "do": "rumble", "length": 0.5 },
    { "on": "tail", "do": "debris", "length": 0.05 },
    { "on": "tail", "do": "reverbSend", "lengthUnit": "event", "length": 1, "shape": "fade", "scale": false },
    { "on": "tail", "do": "smoke", "lengthUnit": "event", "length": 1.5, "shape": "swell", "scale": false },
    { "on": "hit.high", "where": { "value": { "min": 0.3 } }, "do": "clank", "length": 0.05 }
  ],
  "mappings": [ { "from": "distortion", "do": "grit", "amount": 1 } ] }
```

On the explosion of the sound-design reel (true start 27.6 s) it gives: flash and clank at 27.599 s, sub, duck and
rumble on its peak at 27.614 s (amount 0.84), debris, the reverb send and the smoke where its after-effect starts at
28.126 s, the send fading over the 0.93 s the tail rings and the smoke swelling over 1.4 s. In Unity, `sub` and
`debris` play clips with `PlayScheduled` at the cue's time, `duck` and `reverbSend` set exposed parameters of an
`AudioMixer` from their level (`mixer.SetFloat("MusicDuck", -12f * level)`), `rumble` drives
`Gamepad.current.SetMotorSpeeds`.

A tail is how long the sound rings in its own recording. For a dry asset in a large space, raise the send over it; for
an asset that already carries its room (a long tail, a high `descriptors.decay.t60`), lower the send so the space is
not doubled.

## Other engines

- **Unreal**: load the cue sheet as a JSON Data Asset (or `FJsonObjectConverter`), time it by the audio component's
  playback (`OnAudioPlaybackPercent` times the sound's duration), or schedule the sound and the cues together with
  Quartz for sample-accurate starts.
- **Godot**: `AudioStreamPlayer.get_playback_position() + AudioServer.get_time_since_last_mix() -
  AudioServer.get_output_latency()` is the sound's time; parse the sheet with `JSON.parse_string`.
- **Web** (three.js, Babylon, PixiJS): `audioContext.currentTime - start - audioContext.outputLatency`; the library
  itself is there too: `Playhead.cues.compile(Playhead.cues.source(doc), rules)` and `Playhead.cues.evaluate(...)`
  each frame, as the Audiovisual Playhead does.
- **FMOD, Wwise**: keep the cue sheet beside the event and read the event's timeline position, or turn the cues into
  markers: `playhead markers --kinds sections,changes` gives sections, builds, fills, breaks and pass-bys as markers for
  the authoring tool.

## Limits

- The analysis is offline: about a tenth of the sound's duration on a laptop. For sound that is not known in advance
  (voice chat, a microphone, fully procedural audio) the usual live signals remain; the cue engine takes them as a live
  source, with no cue before its event.
- The demos are synthesized. On music, section boundaries can be more than the form has (the melodic demo has 3 phrase
  starts and 8 boundaries more); a band's hits include what of other parts rises in it (the high band fires on a
  snare's noise too); distortion of one part inside a clean mix barely shows.
- Each sound's cue sheet is made for that sound as it is: a game that time-stretches or layers sounds at run time
  scales or merges the cue times itself.
