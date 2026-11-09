# Levels: two pilots behind docs/LEVELS.md

Two small experiments on the 56 sound effects of the corpus (CC0 Sonic Pi samples, `tools/fetch-corpus.sh`), run
before any listening test. Neither says which measure listeners agree with; they say where the choice matters and what
a sound's own numbers can show.

```sh
pip install numpy scipy soundfile pyloudnorm mosqito    # Python 3.10+
mkdir out && cd out
node ../experiments/levels/analyse.js ../corpus/sfx      # Playhead's events and checks -> playhead.json
python3 ../experiments/levels/measures.py ../corpus/sfx  # every measure per file -> measures.json (about 3 min)
python3 ../experiments/levels/summarise.py               # the tables below
python3 ../experiments/levels/compress_pilot.py ../corpus/sfx   # compression and limiting -> compress_pilot.json
```

`measures.json` and `compress_pilot.json` here are the results quoted in the guide.

## How far the usual measures disagree

Per file: sample peak, RMS, BS.1770 integrated loudness (LUFS-I), the loudest 0.4 s and 3 s (Max M, Max S), Zwicker's
time-varying loudness (ISO 532-1, through MoSQITo; its maximum and 5 % percentile as loudness levels, a full-scale sine
taken as 100 dB SPL), and two event-aware candidates from Playhead's events (the loudest event's own span; a measure
chosen by the event's type).

- **The measures disagree by 7 to 18 dB per file.** Normalising with one measure instead of another moves a file by up to
  that much (the 5th to 95th percentile of the differences, the files' median difference removed): LUFS-I against Max M
  7.5 dB, LUFS-I against RMS 8.9, peak against LUFS-I 10.8, peak against Max S 17.6.
- **Two loudness models disagree by up to 17 dB.** BS.1770 and Zwicker part most on bass and tonal sustained sounds
  (bass, drones, a bell: Zwicker 8 to 12 dB quieter) and on short bright noisy hits (Zwicker up to 6 dB louder).
- **With Zwicker standing in for listeners, LUFS-I evens the set best** (spread after normalising: 4.4 to 4.7 dB standard
  deviation, against 5.5 for Max M and 5.5 to 6.2 for the two event-aware candidates). The stand-in is weak: published
  evaluations find the ISO 532 models 4 to 12 dB off on individual impulsive sounds, and the spread here comes mostly from
  spectrum (bass, tones), not from timing. Only listeners can decide.

## Can a sound's own numbers show that it was compressed?

Each file was compressed (4:1 from 18 dB under its peak, 10:1 from 30 dB under, 5 ms attack, 100 ms release, made up to
its original peak) and limited (6 and 12 dB of drive into a look-ahead limiter at −1 dBFS), and four detectors measured
on the original and the copy: crest factor (peak against RMS of the sounding part), peak against Max M, the share of
samples within 1 dB of the peak, and the decay's shape (the time for the second 10 dB of decay against the first).

| Process | Crest factor | Peak to Max M | Samples near the peak | Decay shape |
|---|---|---|---|---|
| Limiter, 12 dB | expected way on 98 % of files, AUC 0.80 | 100 %, 0.78 | 96 %, 0.83 | 69 %, 0.63 |
| Limiter, 6 dB | 93 %, 0.67 | 95 %, 0.69 | 88 %, 0.74 | 62 %, 0.55 |
| Compressor 4:1 | 39 %, 0.44 (median +0.6 dB) | 25 %, 0.37 | 18 %, 0.35 | 53 %, 0.49 |
| Compressor 10:1 | 23 %, 0.27 (median +3.7 dB) | 13 %, 0.22 | 16 %, 0.27 | 37 %, 0.33 |

"Expected way": the detector moved as limiting or compression should move it, on the same file. AUC: how well one
threshold separates the originals from the processed copies over the whole set (0.5 is chance), the case of a library
where the original is not at hand.

- **Limiting shows.** Every detector moves the expected way on nearly every file. Over a mixed set one threshold
  separates moderately (0.67 to 0.83), because some originals are already dense.
- **Compression of one-shots goes the other way.** With a 5 ms attack the attack passes before the gain falls, so the
  peak stays and the body drops: the crest factor rises (median +0.6 and +3.7 dB). Compressing a hit adds punch, and a
  crest-factor detector reads it as less compressed. The simple decay measure did not catch it either.
- What would: the decay's bend (a compressed decay gets steeper below the threshold, which a natural decay never does)
  and the attack against the body per event. The research note on compression found the bend separating compressed
  synthetic impacts at AUC 0.74 to 0.82, but also flagging editors' fade-outs. See docs/LEVELS.md.
