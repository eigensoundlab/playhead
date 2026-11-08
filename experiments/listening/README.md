# Do the arrangements sound punchier, bigger, cleaner?

[experiments/arrange](../arrange/README.md) shows that what `Playhead.arrange` predicts about an arrangement of layers
holds when the layers are mixed: the measures of the real mix rank the arrangements nearly as the search does. It
does not show that the result *sounds* punchier, bigger or cleaner. This short listening test asks listeners.

**Test page:** [eigensoundlab.github.io/playhead/listening/](https://eigensoundlab.github.io/playhead/listening/)
(about 8 minutes; English). It runs in the browser and sends nothing: each listener saves a file with their answers
and sends it in, through the [results form](https://github.com/eigensoundlab/playhead/issues/new?template=listening-results.yml)
or by e-mail.

## Questions

1. **Main.** Is the search's best arrangement for a goal heard as more of that goal than the rough placement it
   started from? Answered per goal (punch, big, clean) and over all three.
2. **Measures.** Do listeners' choices follow the measures of the rendered mix (the score for the goal asked about),
   over every pair where the measures favour one of the two?
3. **Specificity.** Is the arrangement made for one goal heard as more of that goal than the arrangement made for
   another? (An exploratory question: the goals share measures, so their best arrangements are often close.)

## Stimuli

From the 16 sessions of experiments/arrange: layered impacts of four CC0 Sonic Pi samples each (sub, body, transient,
tail).
- 8 drum and percussion kits, and 8 of varied material: robot, glass and metal, tabla, guitar, cinematic bass, vinyl,
  electronic and choir.
- Per session: the rough placement and the search's best candidate for each goal, mixed exactly as the arrangement
  experiment mixes them. That gives 63 sounds of 0.3 to 2.7 s. The glass and metal kit has no candidate for big.
- **Each listener hears 8 sessions:** one of each pair (drum kit k, varied kit k), drawn from their random id. Every
  session is heard by about half of the listeners, the test stays at about 8 minutes, and the page loads only that
  listener's sounds.
- **Loudness matched.** Every sound is set to the same maximum momentary loudness (ITU-R BS.1770, 400 ms), so that
  the louder of two sounds does not win "punchier" or "bigger" for its level. The search's gains change the balance of
  the layers, not the overall level.
- **Two checks** with an answer anyone hears: a clean hit against the same hit with two of its layers 45 and 90 ms
  late ("cleaner"), and a big hit against the same hit without its sub and tail ("bigger").
- 16-bit FLAC, 44.1 kHz, mono, 5.6 MB in all; each starts 50 ms before its first sound.

```sh
node experiments/listening/render.js [sonic-pi-samples-dir]   # site/stimuli/*.flac and site/manifest.json
```

`render.js` reads the arrangements from `experiments/arrange/results.json` and needs the Sonic Pi samples
(`tools/fetch-corpus.sh`). The stimuli are kept in the repository, so every listener hears the same files and the page
needs no build step.

## Procedure

- Two questions about the listener first: what they listen on, and their experience in sound design, mixing or music
  production. Then a volume check on one of the sounds; the volume stays fixed for the test.
- **About 34 pairs, each heard once** (for the listener's 8 sessions):
  - 24 main pairs: per session and goal, the rough placement against that goal's best candidate (23 when the glass and
    metal kit is among them).
  - 8 cross pairs: per session, two goals' candidates, asked about one of the two (rotating through the goals; left
    out where the two are the same arrangement).
  - 2 checks.
- **4 main pairs heard again** later with A and B swapped, for consistency. That makes 36 to 38 answers.
- Each pair asks one question: "Which one hits punchier?", "Which one sounds bigger?" or "Which one sounds cleaner?",
  with a one-line description of the word (on the page and above). Forced choice between A and B.
- Both sounds must be played before choosing; each can be played again as often as wanted.
- The order of the pairs and which sound is A are shuffled per listener, from a random id: `site/plan.js`, which the
  analysis uses to read the files back. A listener can close the page and continue later in the same browser.
- Recorded per answer: the pair, which sound was A, the sound chosen, how often each was played and the time taken.
  No name, address or browser details.

## Analysis (fixed before the test)

```sh
node experiments/listening/analyse.js <folder-with-result-files>   # table on stdout, summary.json in the folder
```

- **Exclusion:** listeners who fail both checks are left out. Only first hearings count; repeats measure
  consistency.
- **Unit:** listeners. A share is the mean of the listeners' shares, with a 95 % t interval over listeners and a sign
  test over listeners. The pooled binomial p-value assumes independent answers and is given for reference only.
- **Main:** the share choosing the search's candidate, per goal and over all goals. A goal "holds" when its interval
  lies above one half.
- **Measures:** the share of choices that agree with the rendered score, over main and cross pairs.
- **Specificity:** the share choosing the asked goal's candidate in the cross pairs.
- **Per pair:** across the 24 main pairs, the rank correlation between the share choosing the candidate and its
  score gain, rendered and predicted.
- **Reported alongside:** the checks, consistency on the repeated pairs, and each listener's shares, device and
  experience.

The rendered measures favour the rough placement in four main pairs: session 5 (big), session 10 (punch, by 0.001),
session 12 (big) and session 13 (big). In each, the best candidate gains in the prediction but not in the mix. They
stay in the main question as they are: the question is about what the search returns. Several varied kits gain
little (glass and metal, choir), which makes their pairs nearly the same sound; they show how listeners answer when
there is little to hear.

## How many listeners

`node experiments/listening/analyse.js --power` simulates listeners whose choice follows the rendered score
difference: the probability of choosing a sound is a logistic function of beta times its score advantage. Each
simulated listener also has a bias of their own, and one in ten answers at random.

Share of 200 simulated tests whose interval excludes one half, given as punch / big / clean / follows the measures:

| Listeners | No effect | beta 4 (a typical gain of 0.12 chosen 62 %) | beta 6 (67 %) | beta 8 (72 %) |
|---|---|---|---|---|
| 8 | 6 / 6 / 8 / 8 | 14 / 15 / 26 / 36 | 32 / 38 / 46 / 65 | 49 / 50 / 71 / 88 |
| 12 | 7 / 4 / 4 / 7 | 29 / 26 / 35 / 63 | 51 / 43 / 60 / 91 | 68 / 66 / 90 / 100 |
| 16 | 5 / 5 / 4 / 5 | 32 / 28 / 45 / 75 | 58 / 52 / 76 / 96 | 82 / 73 / 94 / 100 |
| 24 | 5 / 2 / 6 / 6 | 55 / 39 / 60 / 91 | 78 / 72 / 93 / 100 | 94 / 93 / 99 / 100 |

- **The aim is 24 listeners.** Each listener hears half of the sessions, and several of the varied kits gain little, so
  the test needs more listeners than with the 8 drum kits alone. With 24, a moderate effect (beta 6) is found per goal
  in 72 to 93 % of tests, and the agreement with the measures in all of them.
- With 12 to 16 listeners, the agreement with the measures is likely to show, and the goals with the larger gains
  (clean, then punch).
- Without an effect, the intervals exclude one half in 2 to 8 % of tests, close to the nominal 5 %.

`node experiments/listening/analyse.js --simulate 12` runs the whole analysis on 12 simulated listeners, as a check of
the pipeline before real results arrive.

## Limits

- Few, synthetic-sounding layered impacts from one sample library, mono, and short. The results speak for this kind of
  material.
- Loudness matching on the maximum momentary loudness is one choice among several. A punchier arrangement often has a
  higher peak level at the same loudness, and that difference stays in the stimuli.
- The words are given with a description each. Listeners may still hear "big" or "clean" differently; the comments
  field and the experience question help to read the results.
- An online test cannot control headphones or rooms. Device is recorded, and the analysis can be repeated on
  headphone listeners only.
