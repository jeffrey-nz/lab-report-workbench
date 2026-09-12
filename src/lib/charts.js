/* charts.js — publication-style panels drawn as one SVG.
   Figures are always drawn on white with black type, whatever theme the app is
   in: they are destined for a Word document, not for the screen. Every panel of
   a figure goes into a single SVG, so the export is one image, not several.

   Two channels carry group identity, so the figure survives greyscale printing
   and colour-vision deficiency: hue (diet) with lightness (weeks on diet), and
   an independent marker shape. */

const FONT = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const INK = "#111111";
const AXIS = "#2b2b2b";
const GRID = "#ededed";

/* Categorical slots 1 and 2 of the validated palette. */
export const DIET_COLORS = { NCD: "#2a78d6", HFD: "#eb6834", other: "#1baf7a" };

/* One-hue ordinal ramps, each validated light-end-first against white:
   lightness carries weeks on diet, hue carries the diet. */
const RAMPS = {
  NCD: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"],
  HFD: ["#f2a077", "#ec7a45", "#e05a24", "#b34418", "#7d2f13"],
  other: ["#7fd9b8", "#35c48d", "#1baf7a", "#12805a", "#0a5138"]
};

const SHAPES = ["circle", "square", "triangle", "diamond", "down", "cross"];

/* What a diet is called in a key, where there is room for words. */
const DIET_NAMES = { NCD: "Normal chow", HFD: "High-fat diet" };

import { groupMeta } from "./parse.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (v) => Number(v).toFixed(1);

/* ---------- scales ---------- */

function niceTicks(lo, hi, target = 5) {
  if (!isFinite(lo) || !isFinite(hi)) return { ticks: [0, 1], lo: 0, hi: 1, step: 1 };
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, lo: start, hi: end, step };
}

const fmtTick = (v, step) => {
  const d = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Math.abs(v) < 1e-9 ? "0" : v.toFixed(d);
};

/* ---------- colour and shape assignment ---------- */

export function groupColors(groups, records) {
  const meta = groupMeta(records);
  const byDiet = new Map();
  for (const g of groups) {
    const d = meta(g).diet || "other";
    byDiet.set(d, [...(byDiet.get(d) || []), g]);
  }
  const out = {};
  for (const [diet, list] of byDiet) {
    const ramp = RAMPS[diet] || RAMPS.other;
    if (list.length === 1) { out[list[0]] = DIET_COLORS[diet] || DIET_COLORS.other; continue; }
    const ordered = [...list].sort((a, b) => (meta(a).weeks ?? 0) - (meta(b).weeks ?? 0));
    // with only two steps in play, skip the palest end: a near-white line reads
    // as faint rather than as "early"
    const first = ordered.length <= 2 ? 1 : 0;
    const last = ramp.length - 1;
    const span = Math.max(1, ordered.length - 1);
    ordered.forEach((g, i) => { out[g] = ramp[first + Math.round(i / span * (last - first))]; });
  }
  return out;
}

/**
 * Decide once, for the whole figure, what carries what.
 *
 * Where every group is a diet at a known duration and no panel is a time
 * course, duration belongs on the x-axis and diet in the colour: two colours
 * and six positions rather than six colours whose meaning the reader has to
 * fetch from a legend that repeats the axis.
 */
export function planEncoding(panels, records) {
  const meta = groupMeta(records);
  const groups = [...new Set(panels.flatMap((p) =>
    p.analysis?.ok ? p.analysis.summary.map((s) => s.group) : []))];
  const anyLine = panels.some((p) => p.sel.hasTime && p.sel.levels.length > 1);
  const diets = [...new Set(groups.map((g) => meta(g).diet).filter(Boolean))]
    .sort((a, b) => (a === "NCD" ? -1 : b === "NCD" ? 1 : a.localeCompare(b)));

  const grouped = !anyLine && groups.length > 1 &&
    groups.every((g) => meta(g).weeks !== null && meta(g).diet);

  const ordered = groups.sort((a, b) => {
    const A = meta(a), B = meta(b);
    if ((A.diet || "") !== (B.diet || "")) return (A.diet || "") < (B.diet || "") ? -1 : 1;
    return (A.weeks ?? 0) - (B.weeks ?? 0);
  });

  const colors = grouped
    ? Object.fromEntries(ordered.map((g) => [g, DIET_COLORS[meta(g).diet] || DIET_COLORS.other]))
    : groupColors(ordered, records);

  return {
    meta, groups: ordered, diets, grouped, anyLine, colors,
    shapes: groupShapes(ordered),
    // a legend that would only repeat the x-axis is left off
    legend: anyLine ? "groups" : grouped && diets.length > 1 ? "diets" : "none"
  };
}

/** A marker shape per group, so identity survives a greyscale print. */
export function groupShapes(groups) {
  return Object.fromEntries(groups.map((g, i) => [g, SHAPES[i % SHAPES.length]]));
}

function marker(shape, cx, cy, r, fill, ring = "#ffffff", rw = 1.5) {
  const common = `fill="${fill}" stroke="${ring}" stroke-width="${rw}" stroke-linejoin="round"`;
  const pts = (a) => a.map(([x, y]) => `${n1(cx + x)},${n1(cy + y)}`).join(" ");
  switch (shape) {
    case "square":
      return `<rect x="${n1(cx - r)}" y="${n1(cy - r)}" width="${n1(r * 2)}" height="${n1(r * 2)}" rx="0.7" ${common}/>`;
    case "triangle":
      return `<polygon points="${pts([[0, -r * 1.15], [r * 1.05, r * 0.78], [-r * 1.05, r * 0.78]])}" ${common}/>`;
    case "down":
      return `<polygon points="${pts([[0, r * 1.15], [r * 1.05, -r * 0.78], [-r * 1.05, -r * 0.78]])}" ${common}/>`;
    case "diamond":
      return `<polygon points="${pts([[0, -r * 1.3], [r * 1.12, 0], [0, r * 1.3], [-r * 1.12, 0]])}" ${common}/>`;
    case "cross":
      return `<polygon points="${pts([[-r, -r * .38], [-r * .38, -r * .38], [-r * .38, -r], [r * .38, -r],
        [r * .38, -r * .38], [r, -r * .38], [r, r * .38], [r * .38, r * .38], [r * .38, r],
        [-r * .38, r], [-r * .38, r * .38], [-r, r * .38]])}" ${common}/>`;
    default:
      return `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" ${common}/>`;
  }
}

/* ---------- panel geometry ---------- */

/** Type and padding scale with the panel, so a 3-column figure stays legible. */
export function metrics(panelW, panelH) {
  const k = Math.min(1.15, Math.max(0.82, panelW / 340));
  return {
    k,
    tick: +(10 * k).toFixed(1),
    axis: +(11 * k).toFixed(1),
    letter: +(13.5 * k).toFixed(1),
    star: +(12.5 * k).toFixed(1),
    dot: +(2.6 * k).toFixed(2),
    mark: +(4.1 * k).toFixed(2)
  };
}

function panelFrame(box, m, { tallX = false } = {}) {
  const pad = {
    l: Math.round(50 * m.k + 8),
    r: Math.round(12 * m.k),
    t: Math.round(26 * m.k),
    b: Math.round((tallX ? 60 : 42) * m.k)
  };
  return {
    px: box.x + pad.l, py: box.y + pad.t,
    pw: box.w - pad.l - pad.r, ph: box.h - pad.t - pad.b, pad
  };
}

/* ---------- axes ---------- */

function wrapLabel(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

/**
 * Decide which x labels to print. A course with twenty-four time points cannot
 * name them all: tick marks stay, labels thin out, and the first and last are
 * always kept so the range is readable.
 */
export function xTickPlan(ticks, pw, m) {
  const chars = Math.max(...ticks.map((t) => String(t.label).length));
  const widest = chars * m.tick * 0.58;
  const slot = pw / Math.max(1, ticks.length);
  const all = ticks.map(() => true);
  if (widest <= slot - 4) return { tilt: false, show: all };

  // Short labels are numbers on a scale: printing every third one still reads.
  // Long labels are names, and a name that is dropped cannot be inferred, so
  // those tilt instead — and only thin if even tilted they would collide.
  const areNames = chars > 4;
  if (areNames && slot >= m.tick * 1.15) return { tilt: true, show: all };

  const need = areNames ? m.tick * 1.15 : widest + 10;
  const fit = Math.max(2, Math.floor(pw / need));
  if (ticks.length <= fit) return { tilt: areNames, show: all };

  const step = Math.ceil((ticks.length - 1) / (fit - 1));
  const show = ticks.map((_, i) => i % step === 0);
  show[show.length - 1] = true;
  // the last label must not crowd the one before it
  const shown = show.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (shown.length > 1) {
    const [a, b] = shown.slice(-2);
    if ((b - a) * slot < need) show[a] = false;
  }
  return { tilt: areNames, show };
}

function axes(f, m, xTicks, yT, xLabel, yLabel, xScale, yScale, plan) {
  const { px, py, pw, ph } = f;
  const out = [];

  for (const t of yT.ticks) {
    const y = n1(yScale(t));
    out.push(`<line x1="${px}" y1="${y}" x2="${px + pw}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
  }
  out.push(`<path d="M${px},${py} L${px},${py + ph} L${px + pw},${py + ph}" fill="none" stroke="${AXIS}" stroke-width="1.3" stroke-linecap="square"/>`);

  for (const t of yT.ticks) {
    const y = n1(yScale(t));
    out.push(`<line x1="${px - 4}" y1="${y}" x2="${px}" y2="${y}" stroke="${AXIS}" stroke-width="1.2"/>`);
    out.push(`<text x="${px - 7}" y="${n1(yScale(t) + m.tick * 0.35)}" text-anchor="end" font-family="${FONT}" font-size="${m.tick}" fill="${INK}">${esc(fmtTick(t, yT.step))}</text>`);
  }

  const { tilt, show } = plan;
  xTicks.forEach((t, i) => {
    const x = n1(xScale(t.value));
    out.push(`<line x1="${x}" y1="${py + ph}" x2="${x}" y2="${py + ph + (show[i] ? 4 : 2.5)}" stroke="${AXIS}" stroke-width="1.2"/>`);
    if (!show[i]) return;
    out.push(tilt
      ? `<text transform="translate(${n1(xScale(t.value) - 2)},${py + ph + 6 + m.tick}) rotate(-38)" text-anchor="end" font-family="${FONT}" font-size="${m.tick}" fill="${INK}">${esc(t.label)}</text>`
      : `<text x="${x}" y="${py + ph + 6 + m.tick}" text-anchor="middle" font-family="${FONT}" font-size="${m.tick}" fill="${INK}">${esc(t.label)}</text>`);
  });

  out.push(`<text x="${px + pw / 2}" y="${py + ph + (tilt ? 48 : 30) * m.k + m.axis * 0.4}" text-anchor="middle" font-family="${FONT}" font-size="${m.axis}" fill="${INK}">${esc(xLabel)}</text>`);

  const lines = wrapLabel(yLabel, Math.max(16, Math.floor(ph / (m.axis * 0.58))));
  const spans = lines.map((l, i) =>
    `<tspan x="0" dy="${i === 0 ? -(lines.length - 1) * m.axis * 0.55 : m.axis * 1.1}">${esc(l)}</tspan>`).join("");
  out.push(`<text transform="translate(${px - 34 * m.k - 6},${py + ph / 2}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="${m.axis}" fill="${INK}">${spans}</text>`);

  return out.join("");
}

function errorBar(x, mid, e, color, w) {
  x = +x; mid = +mid; e = +e;
  if (!isFinite(e) || e <= 0) return "";
  return `<path d="M${n1(x - w)},${n1(mid - e)} H${n1(x + w)} M${n1(x)},${n1(mid - e)} V${n1(mid + e)} M${n1(x - w)},${n1(mid + e)} H${n1(x + w)}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`;
}

/* ---------- time course ---------- */

function linePanel(box, sel, analysis, enc, labels, m) {
  const xTicks = sel.levels.map((v) => ({ value: v, label: String(v) }));
  const probe = panelFrame(box, m);
  const plan = xTickPlan(xTicks, probe.pw, m);
  const f = panelFrame(box, m, { tallX: plan.tilt });
  const { px, py, pw, ph } = f;
  const out = [];
  const summary = analysis.summary;

  const ys = summary.flatMap((s) => s.points.flatMap((p) =>
    p.n ? [p.mean - (p.err || 0), p.mean + (p.err || 0)] : []));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const yT = niceTicks(lo, hi + (hi - lo) * 0.1);
  const xs = sel.levels;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  // keep the end markers clear of the axes rather than flush against them
  const inset = Math.min(pw * 0.07, m.mark * 2.6);
  const span = pw - inset * 2;
  const xScale = (v) => px + inset + (xMax === xMin ? span / 2 : (v - xMin) / (xMax - xMin) * span);
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  out.push(axes(f, m, xTicks, yT, labels.x, labels.y, xScale, yScale, plan));

  for (const s of summary) {
    const c = enc.colors[s.group];
    const pts = s.points.filter((p) => p.n);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${n1(xScale(p.x))},${n1(yScale(p.mean))}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${(1.9 * m.k).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of pts) {
      const X = xScale(p.x), Y = yScale(p.mean);
      const e = isFinite(p.err) ? Math.abs(yScale(p.mean + p.err) - Y) : 0;
      out.push(errorBar(X, Y, e, c, 3.6 * m.k));
    }
  }
  // markers last, so they sit above every line and whisker
  for (const s of summary) {
    const c = enc.colors[s.group];
    for (const p of s.points.filter((q) => q.n))
      out.push(marker(enc.shapes[s.group], xScale(p.x), yScale(p.mean), m.mark, c, "#ffffff", 1.5 * m.k));
  }

  // One mark per time point becomes a picket fence on a long course, so a run
  // of consecutive significant points is drawn once, spanned by a rule.
  const byX = new Map();
  for (const c of analysis.posthoc || []) {
    if (c.p >= 0.05 || c.x == null) continue;
    if (!byX.has(c.x) || c.p < byX.get(c.x).p) byX.set(c.x, c);
  }
  const topAt = (xv) => Math.min(...summary.map((s) => {
    const p = s.points.find((q) => q.x === xv);
    return p && p.n ? yScale(p.mean + (p.err || 0)) : Infinity;
  }));

  const runs = [];
  xs.forEach((xv) => {
    const c = byX.get(xv);
    if (!c) { runs.push(null); return; }
    const last = runs[runs.length - 1];
    if (last) last.points.push({ xv, c });
    else runs.push({ points: [{ xv, c }] });
  });
  for (const run of runs.filter(Boolean)) {
    const first = run.points[0].xv, last = run.points[run.points.length - 1].xv;
    const top = Math.min(...run.points.map((p) => topAt(p.xv)));
    if (!isFinite(top)) continue;
    // report the weakest result in the run, so the mark never overstates it
    const weakest = run.points.reduce((a, b) => (b.c.p > a.c.p ? b : a)).c;
    const y = Math.max(py + m.star * 0.9, top - 9 * m.k);
    // Collapse only where individual marks would collide. Where there is room,
    // per-point marks say more: a run reports its weakest result, which would
    // otherwise hide a strong effect inside a long one.
    const spacing = run.points.length > 1
      ? (xScale(last) - xScale(first)) / (run.points.length - 1)
      : Infinity;
    if (run.points.length >= 4 && spacing < m.star * 2.6) {
      out.push(`<line x1="${n1(xScale(first))}" y1="${n1(y + 2 * m.k)}" x2="${n1(xScale(last))}" y2="${n1(y + 2 * m.k)}" stroke="${AXIS}" stroke-width="1.1" stroke-linecap="round"/>`);
      out.push(`<text x="${n1((xScale(first) + xScale(last)) / 2)}" y="${n1(y - 3 * m.k)}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${weakest.stars}</text>`);
    } else {
      for (const { xv, c } of run.points) {
        const half = c.stars.length * m.star * 0.28;
        const ax = Math.min(px + pw - half, Math.max(px + half, xScale(xv)));
        out.push(`<text x="${n1(ax)}" y="${n1(Math.max(py + m.star * 0.9, topAt(xv) - 7 * m.k))}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
      }
    }
  }
  return out.join("");
}

/* ---------- grouped columns ---------- */

/**
 * Lay individual animals out as a swarm rather than a fixed jitter: points step
 * sideways only when they would collide, so the spread of the group is readable
 * instead of forming columns.
 */
function beeswarm(values, yScale, radius, maxOffset) {
  const placed = [];
  const offsets = new Array(values.length).fill(0);
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const step = radius * 2.1;
  for (const { v, i } of order) {
    const y = yScale(v);
    let dx = 0;
    for (let k = 0; k < 60; k++) {
      dx = k === 0 ? 0 : step * Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      if (Math.abs(dx) > maxOffset) { dx = 0; break; }
      const clash = placed.some((p) =>
        Math.abs(p.y - y) < radius * 2 && Math.abs(p.dx - dx) < radius * 1.9);
      if (!clash) break;
    }
    placed.push({ y, dx });
    offsets[i] = dx;
  }
  return offsets;
}

function barPanel(box, sel, analysis, enc, labels, m) {
  const probe = panelFrame(box, m);
  const out = [];
  const summary = analysis.summary.filter((s) => s.points[0].n);
  if (!summary.length) return "";

  // One column per duration when duration is on the axis; otherwise one per group.
  let columns;
  if (enc.grouped) {
    const byWeek = new Map();
    for (const s of summary) {
      const w = enc.meta(s.group).weeks;
      byWeek.set(w, [...(byWeek.get(w) || []), s]);
    }
    columns = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([weeks, members]) => ({
      label: String(weeks),
      members: members.sort((a, b) =>
        enc.diets.indexOf(enc.meta(a.group).diet) - enc.diets.indexOf(enc.meta(b.group).diet))
    }));
  } else {
    columns = summary.map((s) => ({ label: shortGroup(s.group), members: [s] }));
  }

  const xTicks = columns.map((c, i) => ({ value: i, label: c.label }));
  const plan = xTickPlan(xTicks, probe.pw, m);
  const f = panelFrame(box, m, { tallX: plan.tilt });
  const { px, py, pw, ph } = f;

  const allValues = summary.flatMap((s) => s.points[0].values);
  const tops = summary.map((s) => s.points[0].mean + (s.points[0].err || 0));
  const sig = new Map((analysis.posthoc || []).filter((c) => c.p < 0.05).map((c) => [c.group, c]));
  const useBrackets = summary.length <= 3 && sig.size && sig.size <= 2;
  const yT = niceTicks(0, Math.max(...allValues, ...tops) * (useBrackets ? 1.3 : 1.14));
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  const slot = pw / columns.length;
  const widest = Math.max(...columns.map((c) => c.members.length));
  const gap = widest > 1 ? Math.max(3, 3.5 * m.k) : 0;
  const barW = Math.min(32 * m.k, (slot * 0.62 - gap * (widest - 1)) / widest);
  const centre = (i) => px + slot * (i + 0.5);

  out.push(axes(f, m, xTicks, yT, labels.x, labels.y, centre, yScale, plan));

  // place every bar first, so significance marks can be laid over them
  const bars = [];
  columns.forEach((col, i) => {
    const span = col.members.length * barW + (col.members.length - 1) * gap;
    const left = centre(i) - span / 2;
    col.members.forEach((s, j) => {
      bars.push({ s, x: left + j * (barW + gap) + barW / 2 });
    });
  });

  for (const { s, x } of bars) {
    const p = s.points[0];
    const c = enc.colors[s.group];
    const y = yScale(p.mean), base = yScale(0);
    out.push(`<rect x="${n1(x - barW / 2)}" y="${n1(y)}" width="${n1(barW)}" height="${n1(Math.max(0, base - y))}" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="${(1.5 * m.k).toFixed(2)}"/>`);
    const e = isFinite(p.err) ? Math.abs(yScale(p.mean + p.err) - y) : 0;
    out.push(errorBar(x, y, e, c, barW * 0.24));
  }

  if (enc.showPoints !== false) {
    for (const { s, x } of bars) {
      const p = s.points[0];
      const c = enc.colors[s.group];
      // a shape is only worth carrying when colour alone cannot tell groups apart
      const shape = enc.grouped ? "circle" : enc.shapes[s.group];
      const offsets = beeswarm(p.values, yScale, m.dot * 1.25, barW * 0.6);
      p.values.forEach((v, k) =>
        out.push(marker(shape, x + offsets[k], yScale(v), m.dot, "#ffffff", c, 1.15 * m.k)));
    }
  }

  const topOf = ({ s, x }) => {
    const p = s.points[0];
    const e = isFinite(p.err) ? Math.abs(yScale(p.mean + p.err) - yScale(p.mean)) : 0;
    const highest = enc.showPoints === false ? Infinity : yScale(Math.max(...p.values)) - m.dot;
    return Math.min(highest, yScale(p.mean) - e);
  };

  const ctrl = bars.find((b) => b.s.group === analysis.control);
  if (useBrackets && ctrl) {
    let lift = 0;
    for (const bar of bars) {
      const c = sig.get(bar.s.group);
      if (!c) continue;
      const a = Math.min(bar.x, ctrl.x), b = Math.max(bar.x, ctrl.x);
      const yb = Math.min(topOf(bar), topOf(ctrl)) - (11 + lift * 14) * m.k;
      out.push(`<path d="M${n1(a)},${n1(yb + 4 * m.k)} V${n1(yb)} H${n1(b)} V${n1(yb + 4 * m.k)}" fill="none" stroke="${AXIS}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`);
      out.push(`<text x="${n1((a + b) / 2)}" y="${n1(yb - 3 * m.k)}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
      lift++;
    }
  } else {
    for (const bar of bars) {
      const c = sig.get(bar.s.group);
      if (!c) continue;
      out.push(`<text x="${n1(bar.x)}" y="${n1(topOf(bar) - 7 * m.k)}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
    }
  }
  return out.join("");
}

function shortGroup(g) {
  return String(g).replace(/^HFD\s*/, "").replace(/^NCD\s*/, "chow ").trim() || String(g);
}

/* ---------- figure assembly ---------- */

export function renderFigure(panels, { cols = 2, panelW = 360, panelH = 290,
                                       records = [], showPoints = true } = {}) {
  const rows = Math.ceil(panels.length / cols);
  const m = metrics(panelW, panelH);
  const W = cols * panelW;
  const body = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const enc = { ...planEncoding(panels, records), showPoints };

  panels.forEach((p, i) => {
    const box = { x: (i % cols) * panelW, y: Math.floor(i / cols) * panelH, w: panelW, h: panelH };
    body.push(`<text x="${box.x + 6}" y="${box.y + m.letter + 2}" font-family="${FONT}" font-size="${m.letter}" font-weight="700" fill="${INK}">${letters[i]}</text>`);
    if (!p.analysis?.ok) {
      const lines = wrapLabel(p.analysis?.reason || "No analysis for this selection.", 34);
      lines.forEach((l, k) => body.push(
        `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + k * 15}" text-anchor="middle" font-family="${FONT}" font-size="${m.tick}" fill="#8a8a8a">${esc(l)}</text>`));
      return;
    }
    const labels = p.labels || { x: "", y: "" };
    body.push(p.sel.hasTime && p.sel.levels.length > 1
      ? linePanel(box, p.sel, p.analysis, enc, labels, m)
      : barPanel(box, p.sel, p.analysis, enc, labels, m));
  });

  // Only draw a key that tells the reader something the axes do not.
  const entries = enc.legend === "groups" ? enc.groups
    : enc.legend === "diets" ? enc.diets.map((d) => ({ diet: d }))
    : [];
  const legendText = (e) => (e.diet ? DIET_NAMES[e.diet] || e.diet : e);
  const legendColor = (e) => (e.diet ? DIET_COLORS[e.diet] || DIET_COLORS.other : enc.colors[e]);

  const perRow = Math.max(1, Math.min(5, Math.floor(W / 165)));
  const legendRows = entries.length ? Math.ceil(entries.length / perRow) : 0;
  const legendH = legendRows ? legendRows * 20 + 14 : 0;
  const H = rows * panelH + legendH;

  entries.forEach((e, i) => {
    const x = 16 + (i % perRow) * (W / perRow);
    const y = rows * panelH + 18 + Math.floor(i / perRow) * 20;
    const colour = legendColor(e);
    if (enc.anyLine) {
      body.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 17}" y2="${y - 4}" stroke="${colour}" stroke-width="2.2"/>`);
      body.push(marker(enc.shapes[e], x + 8.5, y - 4, 4, colour, "#ffffff", 1.5));
    } else {
      body.push(`<rect x="${x}" y="${y - 11}" width="14" height="13" fill="${colour}" fill-opacity="0.18" stroke="${colour}" stroke-width="1.5"/>`);
    }
    body.push(`<text x="${x + 25}" y="${y}" font-family="${FONT}" font-size="11.5" fill="${INK}">${esc(legendText(e))}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
         `<rect width="${W}" height="${H}" fill="#ffffff"/>${body.join("")}</svg>`;
}

/** Rasterise at print resolution — 300 dpi against the SVG's 96 dpi geometry. */
export function svgToPng(svg, dpi = 300) {
  return new Promise((resolve, reject) => {
    const scale = dpi / 96;
    const mm = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!mm) return reject(new Error("the figure has no viewBox"));
    const w = Number(mm[1]), h = Number(mm[2]);
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode PNG"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not render the figure")); };
    img.src = url;
  });
}
