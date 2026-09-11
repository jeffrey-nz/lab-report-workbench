/* checklist.js — the points that most often cost marks on a scientific lab
   report. General conventions for reporting biomedical data, not any one
   course's marking scheme; edit this file to match the rubric you are given. */

export const CHECKLIST = [
  {
    title: "The figure",
    note: "Presentation marks are usually the easiest to lose and the easiest to keep.",
    items: [
      { do: "One figure is one image file.",
        why: "Panels pasted in separately drift out of alignment and read as two figures. Export the whole figure as a single PNG." },
      { do: "The legend starts on the same page as the figure.",
        why: "A legend stranded on the next page makes the reader hold the figure in their head while they scroll." },
      { do: "Every axis names the thing measured and its units.",
        why: "\"Protein\" or \"expression\" alone is not enough — say which protein, in what units, from which tissue." },
      { do: "Panels are the same size, aligned, and lettered A, B, C.",
        why: "The text refers to panels by letter, so the letters have to be there and in reading order." },
      { do: "The axis range covers the data without stretching far beyond it.",
        why: "An axis running to 100 for data that reach 12 flattens the effect you are describing." },
      { do: "Error bars are defined in the legend.",
        why: "Mean ± SEM and mean ± SD look identical on the page and mean different things." },
      { do: "Exported at 300 dpi or as vector.",
        why: "A screenshot of a graph goes soft in print. The PNG this tool writes is already 300 dpi." }
    ]
  },
  {
    title: "The statistics",
    note: "Reported in the order the reader needs them.",
    items: [
      { do: "The overall test comes before any multiple comparisons.",
        why: "ANOVA first, then the post-hoc test. Reporting comparisons first inverts the logic of the analysis." },
      { do: "Degrees of freedom travel with every F and t.",
        why: "F(3, 33) = 30.22 can be checked; \"F = 30.22\" cannot." },
      { do: "The test named matches the design.",
        why: "Animals measured more than once are repeated measures. Treating them as independent samples inflates your n and your significance." },
      { do: "p-values carry only the digits that matter.",
        why: "Round to two decimals when the result is not significant; keep enough figures that the reader can see which side of 0.05 it falls (0.0341 → 0.034)." },
      { do: "Anything odd in the data is mentioned, not hidden.",
        why: "Naming an outlier and saying what you did with it earns the mark that quietly dropping it loses." }
    ]
  },
  {
    title: "The writing",
    note: "What the marker is reading for.",
    items: [
      { do: "The legend says what was found, not only what was plotted.",
        why: "\"IL-6 mRNA over time\" describes the axes. \"IL-6 mRNA rose transiently at week 6\" describes the result." },
      { do: "Each result is pinned to where it can be seen.",
        why: "Point at the panel: \"(Figure 2B)\", not \"as shown above\"." },
      { do: "Nothing is said twice.",
        why: "If the trend is in the text, the legend does not need to repeat it — and repetition costs readability marks and word count." },
      { do: "One or two findings per section, chosen.",
        why: "Reporting every significant comparison buries the message. Pick the comparisons that answer the question." },
      { do: "Every result mentioned has an outcome attached.",
        why: "Never say a test was done without saying what it showed." }
    ]
  },
  {
    title: "What this tool cannot do for you",
    note: "The marks these carry are yours to earn.",
    items: [
      { do: "Check the drafted text against your own data and rewrite it.",
        why: "The drafts here carry the right numbers, but the wording is generic and a marker will know it." },
      { do: "Write the introduction, discussion and conclusions.",
        why: "They are the bulk of the marks and they need reading you have done, not arithmetic." },
      { do: "Compare your findings to published studies.",
        why: "Critical analysis against the literature is usually the single largest block of discussion marks." },
      { do: "Confirm which comparisons your instructions actually ask for.",
        why: "This tool will happily test groups your assignment never asked you to compare." }
    ]
  }
];
