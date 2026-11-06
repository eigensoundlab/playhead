<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Daniel Sandner -->

# Test fixtures

Written by `../make_fixtures.js` (or `../run_tests.py --update-fixtures`); JSON cannot carry a licence header, so
it is given here.

| File | What | Licence |
|---|---|---|
| `robot-hit-steel.playhead.json` | `playhead analyze --profile sfx` of `experiments/paper/robot-hit-steel.wav`, a sound by Daniel Sandner | CC BY 4.0, as the sound |
| `cue-arc.playhead.json` | `playhead analyze --profile music --wave-columns 400` of the built-in cue arc (`src/probes.js`) | CC0 1.0, as the signal |
| `tools.json` | `playhead tools` | Apache-2.0 |
| `reference.json` | what `src/playhead.js` computes from the two documents (curveAt, toMarkers, looks, drawStrip's drawing) | Apache-2.0 |

Only `source.path` (made relative) and `timing` (set to 0) differ from the command line's output.
