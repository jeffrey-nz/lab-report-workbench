/* checklist.js — the shape of the pre-submission checklist. The wording lives
   in the language catalogues, keyed "cl.<group>.<item>.do" and ".why", so the
   list reads in whichever language the tool is set to.

   To adapt this to a different rubric, change SECTIONS here and add the
   matching keys to src/i18n/en.js and src/i18n/ja.js. */

export const SECTIONS = [
  { key: 0, items: 7 },   // the figure
  { key: 1, items: 5 },   // the statistics
  { key: 2, items: 5 },   // the writing
  { key: 3, items: 4 }    // what this tool cannot do for you
];
