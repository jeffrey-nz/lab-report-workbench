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
4. **Draw the figure.** Multi-panel, mean ± SEM, every animal shown, significance
   marked, lettered A/B/C, exported as **one** 300 dpi PNG or as vector SVG.
5. **Draft the words.** A figure legend and a results paragraph carrying the real
   numbers, in the structure these are marked on. They are a starting point to
   rewrite, not something to submit.

It also exports a **tidy CSV** and a **Prism-ready table** (one column per group,
one row per animal) if you would rather do the graphs in GraphPad yourself.

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

- **A different rubric:** edit `checklist.js` — it is a plain list of
  `{ do, why }` items grouped by section.
- **A different workbook layout:** `parse.js` finds blocks by shape. The regular
  expressions at the top (`ID_RE`, `STAT_RE`, `DIET_RE`, …) are the knobs.
- **Different colours:** `charts.js` holds two one-hue ordinal ramps — hue carries
  the diet, lightness carries time on diet.

## Running it locally

The app is ES modules, so it needs to be served rather than opened from the file
system:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

## Licence

MIT.
