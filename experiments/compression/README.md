# Levelling events vs a compressor

Does analysis-driven levelling ("Level the events") even out a sound more naturally than a compressor? A listening
test decides "natural"; this measures what can be measured. Each method evens out the events to the same degree (the
same spread of event loudness), and we compare what else it changes.

```sh
node experiments/compression/compare.js      # table on stdout, results.json next to this file
```

**Methods.** A feed-forward RMS compressor (4:1, 6 dB knee, threshold 6 dB under the quietest event so every event is
compressed, 120 ms release) with a fast (5 ms) and a slow (30 ms) attack. "Level the events" (`src/effects.js`) puts
one gain on each event the analysis finds, from 20 ms before its start until its decay sinks to 6 dB above the
background, then glides back to 0 dB over 60 ms. Its amount is searched (bisection) until it reaches the compressor's
evenness. Everything is loudness-matched afterwards.

**Measures** (per event, first 200 ms unless noted):

| Measure | What it is |
|---|---|
| spread | standard deviation of event loudness (K-weighted), dB |
| attack lost | change of the attack crest: peak of the first 10 ms over the RMS of the first 200 ms, dB (negative = duller) |
| shape change | mean change of the event's envelope (5 ms RMS over 400 ms, each normalised to its own peak), dB |
| pumping | how much the gain moves inside the gaps between events (RMS, dB): the background breathing |
| steps | how much the gaps' average gain differs from gap to gap (SD, dB): a background that jumps with the events |

## Result (`results.json`)

Same evenness, compressor / levelling:

| Sound | Attack | Spread before → after | Attack lost | Shape change | Pumping | Steps |
|---|---|---|---|---|---|---|
| Hits over a bed (synthetic, 11 events) | 5 ms | 8.9 → 5.7 | −10.2 / 0.0 | 7.8 / 1.3 | 3.42 / 0.11 | 2.03 / 0.04 |
| | 30 ms | 8.9 → 7.0 | −6.0 / 0.0 | 8.1 / 0.8 | 2.98 / 0.07 | 1.91 / 0.03 |
| Footsteps over a bed (synthetic, 15) | 5 ms | 6.9 → 5.1 | −7.6 / 0.0 | 5.3 / 0.8 | 2.72 / 0.73 | 1.37 / 0.37 |
| | 30 ms | 6.9 → 5.9 | −3.7 / 0.0 | 4.4 / 0.4 | 1.88 / 0.40 | 1.00 / 0.20 |
| Shots, a burst (synthetic, 12) | 5 ms | 8.0 → 5.1 | −10.6 / −0.1 | 8.1 / 0.8 | 3.75 / 0.66 | 2.17 / 0.32 |
| | 30 ms | 8.0 → 6.1 | −6.2 / −0.1 | 8.5 / 0.5 | 3.33 / 0.43 | 1.97 / 0.21 |
| Rifle reload (built-in kit, 5) | 5 ms | 3.6 → 1.9 | −1.0 / +0.5 | 4.6 / 0.0 | 1.56 / 0.04 | 0.37 / 0.01 |
| | 30 ms | 3.6 → 2.7 | −0.5 / +0.3 | 2.8 / 0.0 | 1.48 / 0.02 | 0.53 / 0.01 |
| Explosion with debris (built-in kit, 5) | 5 ms | 8.9 → 6.7 | −1.9 / 0.0 | 3.9 / 0.0 | 1.61 / 0.00 | 0.00 / 0.00 |
| | 30 ms | 8.9 → 9.2 (worse) | −1.3 / — | 4.5 / — | 1.54 / — | — |

How far each can go: the compressor at 40:1 with a 5 ms attack reaches 5.7 / 5.0 / 5.0 / 1.9 / 7.3 dB spread (attacks
1–12 dB duller); "Level the events" at its default 70% reaches 3.5 / 2.2 / 2.9 / 1.1 / 3.4 dB with attacks unchanged.

**Reading.** At the same evenness the compressor takes 4–11 dB off the attacks of the hits, reshapes each event's
envelope by 4–8 dB and makes the background breathe by 1.5–3.8 dB; levelling leaves attacks and envelopes as they were
(within 1.3 dB) and the background nearly still. A compressor also cannot reach the evenness levelling gets by default,
because it acts on the peak of each event, not on the event as a whole.

**Limits.** These are measurements, not a listening test. The synthetic hits are simple (three damped partials and a
noise click over a noise bed). Levelling only knows the events the analysis finds: it does not control dynamics inside
an event, nor continuous sounds without events (a drone, an engine, dialogue), where a compressor is still the tool.
It is automatic clip gain, which is what an editor does by hand to footsteps or impacts, not a replacement for a
compressor in general.
