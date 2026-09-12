# Lab Report Workbench

A browser tool for turning a course data workbook into checked figures, the right
statistical test, and a drafted figure legend — the parts of writing up a lab
report that are the same every time.

**Live app:** https://jeffrey-nz.github.io/lab-report-workbench/

## What it does

Drop in the spreadsheet you were given and it will:

1. **Read the sheet's layout rather than its cell addresses.** Repeated header
   blocks, tissue bands across merged columns, `Avg`/`StDev`/`StErr` rows mixed in
   with animals, and margin notes are all worked out from the shape of the sheet,
   so a workbook following the same conventions parses again next semester.
2. **Check the data before you use it.** It recomputes every summary cell the
   workbook states and flags the ones that disagree with the animal values above
   them; it also catches `#VALUE!` cells, malformed numbers, rows marked
   *don't use*, and group labels written inconsistently.
3. **Pick the test from the design, not from habit.** Animals measured more than
   once become a repeated-measures analysis; separate cohorts become an
   independent-groups analysis. Unpaired *t*-test, one-way ANOVA, mixed-design
   two-way RM ANOVA and fully-within two-way RM ANOVA are all implemented, with
   Šídák-corrected multiple comparisons and Grubbs' test for outliers.
4. **Draw the figure.** Multi-panel, lettered A/B/C, exported as **one** 300 dpi
   PNG or as vector SVG. Duration goes on the x-axis and diet into the colour, so
   a six-timepoint experiment needs two colours rather than six; a key that would
   only repeat the axis is left off. Error bars are your choice of SEM or SD — it
   says which question each answers — every animal is shown as a swarm, and the
   figure reports what share of a page it will take, since a figure past half a
   page pushes its own legend onto the next one.

   One measurement can appear **twice in a figure with different groups**: a
   tolerance test shown against its control, and again followed across durations.
   That is one figure answering two questions, and it is what the marking form
   means by a logical progression.
5. **Draft the words.** A figure legend and a results paragraph carrying the real
   numbers, in the structure these are marked on. They are a starting point to
   rewrite, not something to submit.
6. **Draft the report title.** Marked on naming the aim, the outcome and the
   species. Name the animals once and it is written from the findings your
   figures actually show.
7. **Build the whole results section, not one figure.** It reads the workbook and
   proposes the figures a report would actually contain — a figure per tissue
   with protein above mRNA, time courses collected together, one measurement
   compared across the tissues it was made in. Take them one at a time, or build
   them all at once; each figure keeps its own panels, groups, options and
   drafted text, and *Save everything* writes every figure plus one statistics
   file and one draft.

It also exports a **tidy CSV** and a **Prism-ready table** (one column per group,
one row per animal) if you would rather do the graphs in GraphPad yourself.

## Language

The whole tool speaks **English and Japanese** — the interface, the figure axis
labels and keys, the drafted legends and results paragraphs, the statistical
terms, and the submission checklist. It starts in whichever of the two your
browser asks for and falls back to English rather than to a half-translated
page; the toggle in the header overrides that, and the choice is remembered.

Names that came from your spreadsheet are left alone. WAT, IL-1β and TNF-α are
what the literature uses in either language, so translating them would be wrong;
names this tool generated — *body weight*, *blood glucose*, *liver* — are
translated. The statistics never change: a test run in Japanese reports the same
F, the same degrees of freedom and the same p as the same test run in English.

To add a third language, copy `src/i18n/en.js`, translate the values, and
register it in `src/i18n/index.js`. A test holds every catalogue to the same key
set, so a partial translation fails the build rather than shipping.

## Privacy

There is no server. The workbook is read in your browser with
[SheetJS](https://sheetjs.com) and never leaves your device. Nothing is uploaded,
stored, or logged. This repository contains no study data.

## Statistical methods

`stats.js` implements the distributions directly (log-gamma, the regularised
incomplete beta by continued fraction) rather than approximating *p*-values.
Every model was checked against SciPy, statsmodels and pingouin and agrees to
at least 10 significant figures; Grubbs' critical values reproduce the published
tables exactly.

| Design | Model |
|---|---|
| Two independent groups | Welch's unpaired *t*-test |
| Several independent groups | One-way ANOVA + Šídák |
| One between factor × one within factor | Two-way mixed-design RM ANOVA |
| Both factors within-subject | Two-way RM ANOVA, matched in both factors |

Post-hoc comparisons use the model's pooled error term with a Šídák correction,
which is what Prism reports as *Šídák's multiple comparisons test*.

## Adapting it

- **A different rubric:** edit `src/data/checklist.js` — a plain list of
  `{ do, why }` items grouped by section.
- **A different workbook layout:** `src/lib/parse.js` finds blocks by shape. The
  regular expressions at the top (`ID_RE`, `STAT_RE`, `DIET_RE`, …) are the knobs.
- **Which figures get proposed:** `src/lib/suggest.js`. It works from the shape of
  the data — tissues, assays, time courses — not from this course's sections.
- **Different colours:** `styles/tokens.css` holds the interface palette;
  `src/lib/charts.js` holds the categorical slots and the one-hue ordinal ramps.
  `planEncoding()` is where the figure decides what carries what — read it first
  if you want to change how groups are distinguished.

## How the code is laid out

```
index.html              markup only — no inline styles or scripts
styles/
  tokens.css            palette, type scale, both themes
  base.css              reset, document typography, page frame
  components.css        buttons, chips, cards, tables, issues, toast
  views.css             layout belonging to one screen
src/
  app.js                shell: theme, step navigation, focus restoration
  state.js              one store; views read it and call update()
  dom.js                el(), $, toast, safe localStorage
  labels.js             how a measurement is named, everywhere
  exports.js            PNG, SVG, CSV, Markdown, "save everything"
  views/                one module per step
  i18n/                 en.js, ja.js and the lookup that serves them
  lib/                  parse, stats, analyse, charts, suggest, demo — no DOM
  data/checklist.js     the pre-submission checklist
```

`src/lib` never touches the DOM, so the parser and the statistics can be run and
tested from Node directly.

## Running it locally

The app is ES modules, so it needs to be served rather than opened from the file
system:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

## Tests

```sh
node --test tests/              # 209 unit tests, no dependencies
```

The suite covers four things:

- **The statistics**, against values from SciPy, statsmodels and pingouin, and
  against the published Grubbs' tables. Agreement is asserted to 1e-11 or better
  for the distributions and every model.
- **The parser**, against hand-built grids carrying the quirks real course
  sheets have: a wrong `Avg`, a `#VALUE!` cell, a malformed number, a row marked
  *don't use*, a group label missing its diet, and day numbers that only appear
  on a band row.
- **The figures**, by parsing the generated SVG: well-formed tags, quoted
  attributes, no `NaN` in any coordinate, markup in a label escaped, and colour
  that follows the group rather than its position.
- **The structure**, so the codebase does not drift back to shapes that caused
  bugs — no inline styles or scripts in `index.html`, no DOM in `src/lib`, no
  direct `replaceChildren` (a `null` child renders as the text "null"), and no
  English prose outside the language catalogues.
- **Both languages**, by generating every legend, results paragraph, statistics
  file and figure in each and asserting that no untranslated key, and no
  difference in any number, reaches the output.

A browser smoke test drives the real page through every step and asserts that no
placeholder text reaches the DOM:

```sh
npm install --no-save puppeteer
python3 -m http.server 8731 &
node tests/smoke.mjs http://localhost:8731/index.html
```

Both run on every push — see `.github/workflows/test.yml`.

## Licence

MIT.
