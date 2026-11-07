# Results on the 73-file corpus

The real-recording results reported in the README and the paper, as produced by Playhead 0.1.0 ([10.5281/zenodo.23932626](https://doi.org/10.5281/zenodo.23932626)). Playhead 0.2.0 reproduces `summary.csv` exactly (every column but the analysis time); `independence.json` was produced with 0.2.0.

Playhead 0.3.0 hears a file with silence before and after it (the loudness curve no longer starts at full level when a sound starts at once; see `../arrange`). On this corpus that changes two columns of `summary.csv` and nothing else: the loudness range (`lra`) of 43 files, by a median of 0.1 LU and by 1 LU or more in 16 short one-shots (0.2 to 7.4 s; at most 4.2 LU, mostly smaller, as the attack no longer counts at its unsmoothed level), and the tension range of 11 files (at most 0.19). The self-checks pass and fail exactly as before (1363 of 1436); 50 of their values move slightly, 44 of them in the check that harshness-weighted loudness drops with the level. The paper's figure data change in the first 30 ms of the robot hit's harshness curve (which now rises into the hit) and in 7 of 900 loudness values of the cue arc (at most 0.013). The audio itself is not included: `tools/fetch-corpus.sh` downloads it (56 CC0 Sonic Pi samples and 17 librosa example recordings, chosen by the names in `summary.csv`; the first 60 s of each file are used).

| File | Produced by | Contents |
|---|---|---|
| `selfchecks.csv` | `node tools/batch.js corpus --checks --max-dur 60` | every self-check: file, class, check, what was tested, value, pass |
| `summary.csv` | same run | per-file summary (class, loudness, tempo, sections, events, descriptor summaries) |
| `calibration-one-split.json` | `node tools/tune.js corpus --max-dur 12` | one stratified tuning/held-out split: one-at-a-time search, guard, frozen values, pass counts per half and per check |
| `calibration-splits.json` | `node tools/tune.js corpus --grid --splits 20 --max-dur 8` | 11 settings on every file, then 20 random stratified tuning/held-out splits |
| `tools-vs-eq.csv` | `node tools/batch.js corpus --fx --max-dur 60` | each tool's change and the share reproduced by a static EQ, an ideal dynamic EQ and ideal EQ automation |
| `detector-comparison.json` | `node tools/dyneq.js corpus --max-dur 60` | de-harsh driven by the harshness model and by band level, per file |
| `independence.json` | `node tools/batch.js corpus --max-dur 60` (0.2.0) | how far each curve moves on its own: per file, the median absolute correlation between its changes and those of loudness, and the medians over files |

The ESC-50 results are in [`../esc50`](../esc50/README.md).
