# Translating Playhead

`en.json` lists every English text of the app and the library: about 670 texts, about 4,500 words. A translation is
`<lang>.json` next to it: the same keys, with your text as each value. Whatever is missing shows in English, so a
translation can grow a section at a time.

```sh
node tools/i18n.js check de      # your language: coverage, unknown keys, lost {placeholders} or markup
node tools/i18n.js build         # gather all translations into src/i18n-data.js (what the page loads)
node tools/i18n.js extract       # after changing English texts in the code: rewrite en.json
```

Open `index.html?lang=de` to see a language; the menu in the top bar lists the languages that have a translation.

## Terms

Terms come from the shared vocabulary, [eigensoundlab/sound-vocabulary](https://github.com/eigensoundlab/sound-vocabulary)
(`translations/<lang>.json`): `term` in running text, `short` on buttons, menus and column heads. Use one word for one
concept everywhere, as the vocabulary does: loudness and level are different words, so are harshness, sharpness and
roughness, and an event, an onset and a beat. When a text needs a term the vocabulary lacks, use the established
word if there is one, and add it to the vocabulary rather than inventing it here.

## Rules

- **Placeholders** `{file}`, `{tool}`, `{n}`, `{curve}` and so on stay exactly as they are; move them where your
  grammar needs them.
- **Markup**: two texts carry HTML (`<b>`, `<sub>`, `<a href>`, `<code>`). Keep the same tags and attributes and
  translate the text inside them.
- **Counts**: keys ending in `.one` and `.other` are plural forms. Czech, Polish and Russian also take `.few` and
  `.many` (the categories of `Intl.PluralRules`); German and Spanish need only `.one` and `.other`.
- **Leave as they are**: the strip codes (C1, R2, X5, N4, D3 …), look codes (`form:overlay,lane:harshness`), units
  (dB, dBFS, LUFS, LU, Hz, kHz, ms, s, BPM, acum, asper, nats, oct/s), file names, the Schaeffer symbols (N, X, Y, ′, ″),
  product names (Playhead, SFX Workbench, kurator, REAPER, Wwise, FMOD, Unity, GitHub), names and years of cited work
  (Foote 2000, Grosche & Müller 2011), and the citation in the footer.
- **Matrix heads** (`matrix.*`): keep the code before the name ("C1 …"); the table shows the code and the full text on
  hover.
- **Class names inside sentences**: the app writes asset-class names (`ui.cls.*`) in lower case when it puts them into
  a sentence ("Off for {cls}"), except in German.
- **Legend pieces** (`lib.legend.*`) are joined into one line under each strip; keep their leading spaces and
  parentheses so they still join.
- **Length**: labels on buttons, menus and table heads should stay within about one and a half times the English.
  Status lines and descriptions may run longer.
- **Register**: plain and direct, as in the English: short sentences, no marketing. Address the reader as the
  language's software usually does (Czech, Polish and Russian: plural or impersonal forms; German: "Sie" only where
  unavoidable, otherwise impersonal; Spanish: "tú"/"usted" consistent with the vocabulary).
- Keys starting with `_` are notes for other translators and are ignored by the app, e.g. `"_notes": "…"`.

## English terms in explanations

In explanations (descriptions of strips, notes, the guide, tool and look descriptions, tooltips), a technical term can
carry its English original: write `[[tvrdost|harshness]]`. The lab shows "tvrdost (harshness)", or only "tvrdost" when
the reader turns English terms off (the checkbox under the language menu). Use it:

- at the first mention of a vocabulary term in each text, not at every mention;
- for terms a reader may know in English from tools, manuals or papers (waveform, onset, harshness, spectral
  surprise), not for everyday words (sound, file, time);
- never on buttons, menus, labels, column heads or legends: `node tools/i18n.js check` rejects it there.

The English inside the brackets is the vocabulary's English term, in lower case, as it is used in English text. A mark
inside parentheses is shown with square brackets, "(ve tvaru Zwickerova obtěžování [psychoacoustic annoyance])", so
brackets do not nest.

## Where the texts appear

| Keys | Where |
|---|---|
| `ui.*` | top bar, page title and intro |
| `sec.*`, `note.*`, `guide.*` | section titles, descriptions, notes and the reading guide (`index.html`) |
| `row.*`, `d3.*`, `word.*` | the name and description of each strip, and the words at the ends of colour ramps |
| `lab.*`, `now.*`, `check.*`, `obj.*`, `profile.*`, `layer.*`, `mat.*` | the measurements and badges under the strips |
| `off.*` | text drawn in a strip when it has nothing to show |
| `cmp.*` | the "Your own look" composer |
| `bench.*`, `metric.*` | the tool bench and its result table |
| `status.*` | the status line while files load and analyse |
| `aria.*` | names for screen readers |
| `lib.*` | the library: curve names, looks, legends and tools. Other apps (SFX Workbench, kurator) use these too, through `Playhead.localize(table)`, from `dist/i18n/<lang>.json` |
