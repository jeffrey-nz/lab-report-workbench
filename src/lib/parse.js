/* parse.js — turns a course workbook into one tidy table.
   The course sheets are laid out for reading, not for analysis: repeated
   header blocks, tissue bands spanning merged columns, pre-computed Avg/
   StDev/StErr rows mixed in with animals, and free-text notes in the margin.
   Nothing below is keyed to a cell address; blocks are found by their shape,
   so a workbook with the same conventions parses next semester too. */

const ID_RE = /\b(animal|mouse|rat|subject)\s*id\b/i;
const STAT_RE = /^(avg|average|mean|stdev|std\s*dev|sd|sterr|std\s*err|sem|n)\b/i;
const DIET_RE = /^(diet|group|diet\s*\/\s*time|treatment)/i;
const EXCLUDE_RE = /don'?t\s*use|do\s*not\s*use|exclude|omit/i;
const TIME_RE = /^(-?\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|d|day|days|w|wk|wks|weeks?)?$/i;
const BAD_NUM = /^(#\w+!?|n\/?a|ns|nd|-{1,2}|\.)$/i;

const norm = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

/* ---------- workbook -> grids ---------- */

export function sheetsToGrids(workbook, XLSX) {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true });
    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const merges = (ws["!merges"] || []).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
    return { name, grid: grid.map((r) => { const o = r.slice(); o.length = width; return [...o]; }), merges, width };
  });
}

/* ---------- label understanding ---------- */

/** "HFD/2W", "10W chow", "EXPERIMENTAL GROUP (5 WEEKS HFD)" -> {diet, weeks}. */
export function readGroupLabel(raw) {
  const s = norm(raw);
  if (!s) return { diet: null, weeks: null, raw: s };
  const u = s.toUpperCase();
  let diet = null;
  if (/\b(NCD|CHOW|CONTROL|NORMAL)\b/.test(u)) diet = "NCD";
  if (/\bHFD?\b|HIGH\s*FAT|EXPERIMENTAL/.test(u)) diet = "HFD";
  if (/START\s*-?\s*HFD/.test(u)) diet = "HFD";
  const wk = u.match(/(\d+(?:\.\d+)?)\s*(?:W\b|WK|WEEKS?)/) || u.match(/WEEK\s*(\d+)/);
  const weeks = wk ? Number(wk[1]) : null;
  if (diet == null && weeks === 0) diet = "NCD";   // "0W" blocks are the chow baseline
  return { diet, weeks, raw: s };
}

/** Column header -> a time level, when the headers form a numeric series. */
function readTimeHeader(raw) {
  const s = norm(raw);
  const m = s.match(TIME_RE);
  if (!m) return null;
  const unitMap = { m: "min", min: "min", mins: "min", minutes: "min",
                    h: "h", hr: "h", hrs: "h", d: "day", day: "day", days: "day",
                    w: "week", wk: "week", wks: "week", week: "week", weeks: "week" };
  return { value: Number(m[1]), unit: m[2] ? unitMap[m[2].toLowerCase()] : null, label: s };
}

function toNumber(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = norm(v);
  if (!s) return null;
  if (BAD_NUM.test(s)) return null;
  const cleaned = s.replace(/[^0-9eE.+-]/g, "");
  if (!cleaned || (cleaned.match(/\./g) || []).length > 1) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/** Why a cell that should hold a number does not. */
function badCellReason(v) {
  const s = norm(v);
  if (!s) return null;
  if (/^#/.test(s)) return `spreadsheet error ${s}`;
  if (/^(ns|nd|n\/?a)$/i.test(s)) return `marked "${s}" (not determined)`;
  if ((s.match(/\./g) || []).length > 1) return `malformed number "${s}"`;
  return `non-numeric "${s}"`;
}

/* ---------- block discovery ---------- */

function findHeaderRows(grid) {
  const out = [];
  grid.forEach((row, r) => {
    const c = row.findIndex((cell) => ID_RE.test(norm(cell)));
    if (c >= 0) out.push({ row: r, idCol: c });
  });
  return out;
}

/** Nearest non-empty text above `row` that reads like a block title. */
function titleAbove(grid, row, idCol) {
  for (let r = row - 1; r >= 0 && r >= row - 6; r--) {
    const cells = (grid[r] || []).map(norm).filter(Boolean);
    if (!cells.length) continue;
    const cand = cells[0];
    if (/group|diet|control|experimental|cohort/i.test(cand) && cand.length > 3) return cand;
  }
  return null;
}

/** Tissue / unit bands sitting above the header row, carried right across merges. */
function bandsAbove(grid, headerRow, width) {
  const bands = [];
  for (let r = Math.max(0, headerRow - 3); r < headerRow; r++) {
    const row = grid[r] || [];
    const filled = row.map(norm);
    if (filled.filter(Boolean).length === 0) continue;
    const carried = [];
    let cur = "";
    for (let c = 0; c < width; c++) { if (filled[c]) cur = filled[c]; carried[c] = cur; }
    bands.push({ row: r, raw: filled, carried });
  }
  return bands;
}


/**
 * Locate the run of columns that are time levels of one measurement, as
 * opposed to distinct analytes. Tries the header row, then each band row
 * above it, and keeps the longest run. A run may be extended leftwards over
 * unlabelled columns that repeat the same header text (the baseline
 * measurements the course sheets leave without a day number).
 */
function findTimeRun(measureCols, headerCells, bands) {
  const candidates = [];
  const scan = (readAt, source) => {
    const parsed = measureCols.map(readAt);
    let best = null, i = 0;
    while (i < parsed.length) {
      if (!parsed[i]) { i++; continue; }
      let j = i;
      while (j + 1 < parsed.length && parsed[j + 1]) j++;
      if (!best || j - i > best.end - best.start) best = { start: i, end: j };
      i = j + 1;
    }
    if (best && best.end - best.start + 1 >= 3) {
      candidates.push({ source, start: best.start, end: best.end,
                        levels: parsed.slice(best.start, best.end + 1) });
    }
  };
  scan((c) => readTimeHeader(headerCells[c]), "header");
  for (const b of bands) scan((c) => readTimeHeader(b.raw[c]), `row ${b.row + 1}`);
  if (!candidates.length) return null;

  const best = candidates.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  let { start, end, levels } = best;

  // The columns are levels of one axis, so the axis has one unit. Take it from
  // whichever reading found one — a header like "30m", or a band label such as
  // "TIME In Days" sitting beside bare day numbers.
  const unit = candidates.map((c) => c.levels.find((l) => l.unit)?.unit).find(Boolean)
    || unitFromText([...bands.map((b) => b.raw), headerCells]);
  if (unit) levels = levels.map((l) => ({ ...l, unit: l.unit || unit }));

  // Extend left over unlabelled columns repeating the run's header text.
  const runHeader = headerCells[measureCols[start]];
  const gaps = levels.slice(1).map((l, i) => l.value - levels[i].value).sort((x, y) => x - y);
  const step = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) || 1 : 1;
  const inferred = [];
  while (start > 0 && headerCells[measureCols[start - 1]] === runHeader) {
    start--;
    const lvl = { value: levels[0].value - step, unit: levels[0].unit,
                  label: String(levels[0].value - step), inferred: true };
    levels = [lvl, ...levels];
    inferred.push(measureCols[start]);
  }
  return { cols: measureCols.slice(start, end + 1), levels, inferred,
           source: best.source, first: start, last: end };
}

/** A time unit named in words anywhere near the header, e.g. "TIME In Days". */
function unitFromText(rowGroups) {
  for (const row of rowGroups) {
    for (const cell of row || []) {
      const s = norm(cell);
      if (!s || TIME_RE.test(s)) continue;
      if (/\bmin(ute)?s?\b/i.test(s)) return "min";
      if (/\bhours?\b|\bhrs?\b/i.test(s)) return "h";
      if (/\bdays?\b/i.test(s)) return "day";
      if (/\bweeks?\b|\bwks?\b/i.test(s)) return "week";
    }
  }
  return null;
}

/* ---------- the parser ---------- */

export function parseWorkbook(sheets) {
  const records = [];
  const issues = [];
  const tables = [];
  let uid = 0;

  for (const sheet of sheets) {
    const { name, grid, width } = sheet;
    const headers = findHeaderRows(grid);
    if (!headers.length) continue;

    headers.forEach((h, hi) => {
      const endRow = hi + 1 < headers.length ? headers[hi + 1].row : grid.length;
      const headerCells = (grid[h.row] || []).map(norm);
      const bands = bandsAbove(grid, h.row, width);

      // Which column carries the group label for each animal?
      let dietCol = headerCells.findIndex((c, i) => i >= h.idCol && DIET_RE.test(c));
      if (dietCol < 0) dietCol = null;

      // Measure columns: everything right of the id column that has a header.
      const measureCols = [];
      for (let c = h.idCol + 1; c < width; c++) {
        if (c === dietCol) continue;
        if (!headerCells[c]) continue;
        measureCols.push(c);
      }
      if (!measureCols.length) return;

      const timeRun = findTimeRun(measureCols, headerCells, bands);
      const timeAt = new Map();
      if (timeRun) timeRun.cols.forEach((c, i) => timeAt.set(c, timeRun.levels[i]));
      if (timeRun && timeRun.inferred.length) {
        const shown = timeRun.levels.filter((l) => l.inferred).map((l) => l.label).join(", ");
        issues.push({ kind: "inferred-time", sheet: name, severity: "info",
                      where: `${timeRun.inferred.length} leading column(s)`,
                      detail: `no time label in the sheet; placed at ${shown} by continuing the series backwards — check against your instructions` });
      }

      const blockTitle = titleAbove(grid, h.row, h.idCol);
      const titleInfo = readGroupLabel(blockTitle);

      // Per-measure metadata: tissue band + unit band + analyte name.
      const unitBand = bands.find((b) => b.raw.some((v) => /per\s*mg|fold|\bng\b|\bpg\b|mmol|mg\/|g\b\s*$/i.test(v)));
      const tissueBand = bands.find((b) => b !== unitBand &&
        b.raw.some((v) => /tissue|liver|adipose|ileum|ilium|hypothalamus|intestine|muscle|plasma|serum/i.test(v)));

      const meta = measureCols.map((c) => {
        const tissue = tissueBand ? tidyTissue(tissueBand.carried[c]) : null;
        const time = timeAt.get(c) || null;
        const header = headerCells[c];
        const paren = String(header).match(/\(([^)]+)\)/);
        let unit = unitBand ? norm(unitBand.carried[c]) : null;
        if (!unit && paren) unit = paren[1];
        let analyte = header;
        if (time) {
          analyte = inferSeriesName(name, header);
          if (!unit) unit = inferSeriesUnit(name);
        }
        return { col: c, tissue, unit: unit || null, analyte: tidyAnalyte(analyte), time };
      });

      // Walk the data rows.
      const rows = [];
      let lastGroup = null;
      for (let r = h.row + 1; r < endRow; r++) {
        const row = grid[r] || [];
        const labelCell = norm(row[h.idCol]) || norm(row[dietCol ?? h.idCol + 1]);
        if (STAT_RE.test(labelCell)) continue;                    // sheet's own Avg/SD/SEM
        if (row.slice(h.idCol).every((v) => norm(v) === "")) continue;
        const subject = toNumber(row[h.idCol]);
        if (subject == null) continue;

        // trailing free-text note in the margin, e.g. "don't use"
        const note = row.slice(Math.max(...measureCols) + 1).map(norm).filter(Boolean).join(" ");
        const excluded = EXCLUDE_RE.test(note);

        let groupRaw = dietCol != null ? norm(row[dietCol]) : "";
        let g = readGroupLabel(groupRaw || blockTitle || "");
        let inherited = false;
        if (groupRaw && g.diet == null && lastGroup && lastGroup.diet) {
          // e.g. a row labelled just "10W" inside a run of "HFD/10W"
          g = { ...g, diet: lastGroup.diet, weeks: g.weeks ?? lastGroup.weeks };
          inherited = true;
        }
        if (g.weeks == null && titleInfo.weeks != null) g.weeks = titleInfo.weeks;
        if (g.diet == null && titleInfo.diet) g.diet = titleInfo.diet;
        if (g.diet) lastGroup = g;

        rows.push({ r, subject, group: g, groupRaw: groupRaw || blockTitle || "",
                    note, excluded, inherited });
      }
      if (!rows.length) return;

      const tableId = `t${++uid}`;
      const seen = new Set();

      for (const row of rows) {
        for (const m of meta) {
          const raw = (grid[row.r] || [])[m.col];
          const value = toNumber(raw);
          const key = `${m.tissue || ""}|${m.analyte}`;
          if (value == null) {
            const reason = badCellReason(raw);
            if (reason && !seen.has(key + reason)) {
              seen.add(key + reason);
              issues.push({ kind: "bad-cell", sheet: name, table: tableId,
                            where: `${m.tissue ? m.tissue + " " : ""}${m.analyte}`,
                            detail: reason, severity: /^#/.test(norm(raw)) ? "warn" : "info" });
            }
            continue;
          }
          records.push({
            id: `${tableId}_${row.subject}_${m.col}`,
            table: tableId, sheet: name, subject: row.subject,
            diet: row.group.diet, weeks: row.group.weeks,
            groupRaw: row.groupRaw,
            groupLabel: groupName(row.group),
            tissue: m.tissue, analyte: m.analyte, unit: m.unit,
            x: m.time ? m.time.value : null,
            xUnit: m.time ? m.time.unit : null,
            xLabel: m.time ? m.time.label : null,
            value, excluded: row.excluded, note: row.note
          });
        }
        if (row.excluded)
          issues.push({ kind: "excluded", sheet: name, table: tableId,
                        where: `Animal ${row.subject}`, detail: `flagged in the sheet: "${row.note}"`,
                        severity: "warn" });
        if (row.inherited)
          issues.push({ kind: "label", sheet: name, table: tableId,
                        where: `Animal ${row.subject}`,
                        detail: `group written as "${row.groupRaw}"; read as ${groupName(row.group)} from the surrounding block`,
                        severity: "info" });
      }

      tables.push({ id: tableId, sheet: name, title: blockTitle,
                    repeated: !!timeRun, headerRow: h.row,
                    analytes: [...new Set(meta.map((m) => m.analyte))],
                    tissues: [...new Set(meta.map((m) => m.tissue).filter(Boolean))] });
    });
  }

  issues.push(...auditSheetStats(sheets, records));
  return { records, issues, tables };
}

function groupName(g) {
  if (!g.diet && g.weeks == null) return g.raw || "—";
  if (!g.diet) return `${g.weeks}W`;
  if (g.weeks == null) return g.diet;
  return `${g.diet} ${g.weeks}W`;
}

function tidyTissue(s) {
  const t = norm(s).replace(/\s*tissue\s*$/i, "").trim();
  if (!t) return null;
  const map = { "white adipose": "WAT", "ilium": "Ileum", "ileum": "Ileum",
                liver: "Liver", hypothalamus: "Hypothalamus" };
  const k = t.toLowerCase();
  return map[k] || t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function tidyAnalyte(s) {
  // the unit in a header like "BW (g)" is captured separately, so drop it here
  const t = norm(s).replace(/\s*\([^)]*\)\s*$/, "").trim() || norm(s);
  const map = { "il1b": "IL-1β", "il-1b": "IL-1β", "il1-b": "IL-1β", "il-1β": "IL-1β",
                "tnfa": "TNF-α", "tnf-a": "TNF-α", "tnfα": "TNF-α",
                "il6": "IL-6", "il-6": "IL-6", "cd68": "CD68",
                "bw": "Body weight", "body weight": "Body weight" };
  return map[t.toLowerCase()] || t;
}

function inferSeriesName(sheet, header) {
  const s = (sheet + " " + header).toLowerCase();
  if (/glucose/.test(s)) return "Blood glucose";
  if (/insulin/.test(s)) return "Blood glucose";
  if (/weight|bw/.test(s)) return "Body weight";
  return norm(header) || "Value";
}

function inferSeriesUnit(sheet) {
  const s = sheet.toLowerCase();
  if (/glucose|insulin/.test(s)) return "mmol/L";
  if (/weight/.test(s)) return "g";
  return null;
}

/* ---------- audit the workbook's own summary rows ---------- */

/** Recompute every Avg the sheet states and report disagreements.
    Values are taken only from the animal rows of the block the Avg row sits in,
    so numeric band rows above the header are never swept in. */
function auditSheetStats(sheets, records) {
  const out = [];
  for (const { name, grid, width } of sheets) {
    const headers = findHeaderRows(grid);
    grid.forEach((row, r) => {
      const labelIdx = (row || []).findIndex((c) => /^(avg|average|mean)$/i.test(norm(c)));
      if (labelIdx < 0) return;
      const head = headers.filter((h) => h.row < r).pop();
      if (!head) return;
      const { row: blockTop, idCol } = head;
      for (let c = labelIdx + 1; c < width; c++) {
        const stated = typeof row[c] === "number" ? row[c] : null;
        if (stated == null) continue;
        const col = [];
        for (let rr = r - 1; rr > blockTop; rr--) {
          const v = grid[rr]?.[c];
          const idCell = (grid[rr] || [])[idCol];
          if (typeof idCell !== "number") break;  // not an animal row: block boundary
          if (typeof v === "number") col.push(v);
        }
        if (col.length < 3) continue;
        const m = col.reduce((x, y) => x + y, 0) / col.length;
        if (Math.abs(m - stated) / (Math.abs(m) || 1) > 0.02) {
          out.push({ kind: "stat-mismatch", sheet: name, severity: "error",
                     where: `${colLetter(c)}${r + 1}`,
                     stated, actual: m, n: col.length });
        }
      }
    });
  }
  const bySheet = new Map();
  for (const i of out) {
    if (!bySheet.has(i.sheet)) bySheet.set(i.sheet, { ...i, cells: [] });
    bySheet.get(i.sheet).cells.push(i);
  }
  return [...bySheet.values()].map((g) => {
    const f = g.cells[0];
    return { kind: "stat-mismatch", sheet: g.sheet, severity: "error",
             where: g.cells.length > 1 ? `${g.cells.length} summary cells` : f.where,
             detail: `the workbook's own Avg is wrong here — cell ${f.where} states ${f.stated.toFixed(2)} but the ${f.n} animal values above it average ${f.actual.toFixed(2)}. Every figure and test below is recomputed from the animal values, not these cells.` };
  });
}

function colLetter(c) {
  let s = "";
  for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/**
 * What a group label means: taken from the parsed records where possible, and
 * read back off the label itself when the label did not come from this data.
 * Returns a lookup function, so callers pay for the index once.
 */
export function groupMeta(records) {
  const known = new Map();
  for (const r of records) if (!known.has(r.groupLabel))
    known.set(r.groupLabel, { diet: r.diet, weeks: r.weeks });
  return (label) => {
    if (known.has(label)) return known.get(label);
    const read = readGroupLabel(label);
    return { diet: read.diet, weeks: read.weeks };
  };
}

/* ---------- shaping for analysis ---------- */

/** Distinct series present: one entry per (tissue, analyte, sheet). */
export function seriesIndex(records) {
  const map = new Map();
  for (const r of records) {
    if (r.excluded) continue;
    const key = `${r.sheet}|${r.tissue || ""}|${r.analyte}`;
    if (!map.has(key)) map.set(key, {
      key, sheet: r.sheet, tissue: r.tissue, analyte: r.analyte, unit: r.unit,
      hasTime: r.x != null, xUnit: r.xUnit, groups: new Set(), n: 0
    });
    const e = map.get(key);
    e.groups.add(r.groupLabel);
    e.n++;
    if (r.x != null) e.hasTime = true;
  }
  return [...map.values()].map((e) => ({ ...e, groups: [...e.groups] }));
}
