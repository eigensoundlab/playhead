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

From the 8 sessions of experiments/arrange: layered impacts of four CC0 Sonic Pi samples each (sub, body, transient,
tail).
- Per session: the rough placement and the search's best candidate for each goal, mixed exactly as the arrangement
  experiment mixes them. That gives 32 sounds of 0.7 to 2.7 s.
- **Loudness matched.** Every sound is set to the same maximum momentary loudness (ITU-R BS.1770, 400 ms), so that
  the louder of two sounds does not win "punchier" or "bigger" for its level. The search's gains change the balance of
  the layers, not the overall level.
- **Two checks** with an answer anyone hears: a clean hit against the same hit with two of its layers 45 and 90 ms
  late ("cleaner"), and a big hit against the same hit without its sub and tail ("bigger").
- 16-bit FLAC, 44.1 kHz, mono; each starts 50 ms before its first sound.

```sh
node experiments/listening/render.js [sonic-pi-samples-dir]   # site/stimuli/*.flac and site/manifest.json
```

`render.js` reads the arrangements from `experiments/arrange/results.json` and needs the Sonic Pi samples
(`tools/fetch-corpus.sh`). The stimuli are kept in the repository, so every listener hears the same files and the page
needs no build step.

## Procedure

- Two questions about the listener first: what they listen on, and their experience in sound design, mixing or music
  production. Then a volume check on one of the sounds; the volume stays fixed for the test.
- **34 pairs, each heard once:**
  - 24 main pairs: per session and goal, the rough placement against that goal's best candidate.
  - 8 cross pairs: per session, two goals' candidates, asked about one of the two (rotating through the goals).
  - 2 checks.
- **4 main pairs heard again** later with A and B swapped, for consistency. That makes 38 answers.
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

The rendered measures favour the rough placement in one main pair (session 5, big: the best candidate gains in the
prediction but not in the mix). It stays in the main question as it is: the question is about what the search returns.

## How many listeners

`node experiments/listening/analyse.js --power` simulates listeners whose choice follows the rendered score
difference: the probability of choosing a sound is a logistic function of beta times its score advantage. Each
simulated listener also has a bias of their own, and one in ten answers at random.

Share of 200 simulated tests whose interval excludes one half, given as punch / big / clean / follows the measures:

| Listeners | No effect | beta 4 (a typical gain of 0.12 chosen 62 %) | beta 6 (67 %) | beta 8 (72 %) |
|---|---|---|---|---|
| 8 | 9 / 6 / 7 / 7 | 17 / 31 / 40 / 54 | 44 / 47 / 59 / 77 | 64 / 73 / 87 / 97 |
| 12 | 7 / 4 / 6 / 4 | 38 / 42 / 53 / 73 | 58 / 76 / 81 / 99 | 84 / 92 / 98 / 100 |
| 16 | 7 / 7 / 5 / 5 | 46 / 57 / 66 / 86 | 76 / 85 / 94 / 99 | 89 / 96 / 99 / 100 |
| 24 | 6 / 5 / 5 / 5 | 64 / 73 / 81 / 96 | 93 / 97 / 99 / 100 | 98 / 100 / 100 / 100 |

- **The aim is 16 listeners, or more.** With 16, a moderate effect (beta 6) is found per goal in 76 to 94 % of tests,
  and the agreement with the measures in 99 %.
- With 8 listeners, only the overall agreement with the measures is likely to show.
- Without an effect, the intervals exclude one half in 4 to 9 % of tests, close to the nominal 5 %.

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
