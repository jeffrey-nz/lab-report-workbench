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
  const meta = new Map();
  for (const r of records) if (!meta.has(r.groupLabel))
    meta.set(r.groupLabel, { diet: r.diet, weeks: r.weeks });
  const byDiet = new Map();
  for (const g of groups) {
    const d = meta.get(g)?.diet || "other";
    byDiet.set(d, [...(byDiet.get(d) || []), g]);
  }
  const out = {};
  for (const [diet, list] of byDiet) {
    const ramp = RAMPS[diet] || RAMPS.other;
    if (list.length === 1) { out[list[0]] = DIET_COLORS[diet] || DIET_COLORS.other; continue; }
    const ordered = [...list].sort((a, b) => (meta.get(a)?.weeks ?? 0) - (meta.get(b)?.weeks ?? 0));
    // with only two steps in play, skip the palest end: a near-white line reads
    // as faint rather than as "early"
    const first = ordered.length <= 2 ? 1 : 0;
    const last = ramp.length - 1;
    const span = Math.max(1, ordered.length - 1);
    ordered.forEach((g, i) => { out[g] = ramp[first + Math.round(i / span * (last - first))]; });
  }
  return out;
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
function metrics(panelW, panelH) {
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

function axes(f, m, xTicks, yT, xLabel, yLabel, xScale, yScale) {
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

  const slotW = pw / Math.max(1, xTicks.length);
  const widest = Math.max(...xTicks.map((t) => String(t.label).length)) * m.tick * 0.56;
  const tilt = widest > slotW - 4;
  for (const t of xTicks) {
    const x = n1(xScale(t.value));
    out.push(`<line x1="${x}" y1="${py + ph}" x2="${x}" y2="${py + ph + 4}" stroke="${AXIS}" stroke-width="1.2"/>`);
    out.push(tilt
      ? `<text transform="translate(${n1(xScale(t.value) - 2)},${py + ph + 6 + m.tick}) rotate(-38)" text-anchor="end" font-family="${FONT}" font-size="${m.tick}" fill="${INK}">${esc(t.label)}</text>`
      : `<text x="${x}" y="${py + ph + 6 + m.tick}" text-anchor="middle" font-family="${FONT}" font-size="${m.tick}" fill="${INK}">${esc(t.label)}</text>`);
  }

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

function linePanel(box, sel, analysis, colors, shapes, labels, m) {
  const f = panelFrame(box, m);
  const { px, py, pw, ph } = f;
  const out = [];
  const summary = analysis.summary;

  const ys = summary.flatMap((s) => s.points.flatMap((p) =>
    p.n ? [p.mean - (p.sem || 0), p.mean + (p.sem || 0)] : []));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const yT = niceTicks(lo, hi + (hi - lo) * 0.1);
  const xs = sel.levels;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  // keep the end markers clear of the axes rather than flush against them
  const inset = Math.min(pw * 0.07, m.mark * 2.6);
  const span = pw - inset * 2;
  const xScale = (v) => px + inset + (xMax === xMin ? span / 2 : (v - xMin) / (xMax - xMin) * span);
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  out.push(axes(f, m, xs.map((v) => ({ value: v, label: String(v) })), yT,
                labels.x, labels.y, xScale, yScale));

  for (const s of summary) {
    const c = colors[s.group];
    const pts = s.points.filter((p) => p.n);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${n1(xScale(p.x))},${n1(yScale(p.mean))}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${(1.9 * m.k).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of pts) {
      const X = xScale(p.x), Y = yScale(p.mean);
      const e = isFinite(p.sem) ? Math.abs(yScale(p.mean + p.sem) - Y) : 0;
      out.push(errorBar(X, Y, e, c, 3.6 * m.k));
    }
  }
  // markers last, so they sit above every line and whisker
  for (const s of summary) {
    const c = colors[s.group];
    for (const p of s.points.filter((q) => q.n))
      out.push(marker(shapes[s.group], xScale(p.x), yScale(p.mean), m.mark, c, "#ffffff", 1.5 * m.k));
  }

  const byX = new Map();
  for (const c of analysis.posthoc || []) {
    if (c.p >= 0.05 || c.x == null) continue;
    if (!byX.has(c.x) || c.p < byX.get(c.x).p) byX.set(c.x, c);
  }
  for (const [xv, c] of byX) {
    const top = Math.min(...summary.map((s) => {
      const p = s.points.find((q) => q.x === xv);
      return p && p.n ? yScale(p.mean + (p.sem || 0)) : Infinity;
    }));
    const half = c.stars.length * m.star * 0.28;
    const ax = Math.min(px + pw - half, Math.max(px + half, xScale(xv)));
    out.push(`<text x="${n1(ax)}" y="${n1(Math.max(py + m.star * 0.8, top - 7 * m.k))}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
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

function barPanel(box, sel, analysis, colors, shapes, labels, m) {
  const f = panelFrame(box, m, { tallX: true });
  const { px, py, pw, ph } = f;
  const out = [];
  const summary = analysis.summary;
  const groups = summary.map((s) => s.group);

  const allVals = summary.flatMap((s) => s.points[0].values);
  const tops = summary.map((s) => s.points[0].mean + (s.points[0].sem || 0));
  const sig = new Map((analysis.posthoc || []).filter((c) => c.p < 0.05).map((c) => [c.group, c]));
  // A bracket reads well across two or three columns and badly across seven,
  // where an asterisk over the column it belongs to is clearer.
  const useBrackets = groups.length <= 3 && sig.size <= 2;
  const headroom = useBrackets ? 1.3 : 1.14;
  const yT = niceTicks(0, Math.max(...allVals, ...tops) * headroom);
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  const slot = pw / groups.length;
  const barW = Math.min(34 * m.k, slot * 0.5);
  const cx = (i) => px + slot * (i + 0.5);

  out.push(axes(f, m, groups.map((g, i) => ({ value: i, label: shortGroup(g) })), yT,
                labels.x, labels.y, cx, yScale));

  const tops2 = [];
  summary.forEach((s, i) => {
    const p = s.points[0];
    if (!p.n) { tops2[i] = py + ph; return; }
    const c = colors[s.group];
    const X = cx(i), Y = yScale(p.mean), base = yScale(0);
    out.push(`<rect x="${n1(X - barW / 2)}" y="${n1(Y)}" width="${n1(barW)}" height="${n1(Math.max(0, base - Y))}" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="${(1.5 * m.k).toFixed(2)}"/>`);
    const e = isFinite(p.sem) ? Math.abs(yScale(p.mean + p.sem) - Y) : 0;
    out.push(errorBar(X, Y, e, c, barW * 0.22));

    const offs = beeswarm(p.values, yScale, m.dot * 1.25, barW * 0.62);
    p.values.forEach((v, k) => {
      out.push(marker(shapes[s.group], X + offs[k], yScale(v), m.dot, "#ffffff", c, 1.15 * m.k));
    });
    tops2[i] = Math.min(yScale(Math.max(...p.values)) - m.dot, Y - e);
  });

  // a few comparisons read best as brackets; many read best as asterisks
  const ctrlIdx = groups.indexOf(analysis.control);
  if (useBrackets && sig.size && ctrlIdx >= 0) {
    let lift = 0;
    for (const [g, c] of sig) {
      const i = groups.indexOf(g);
      if (i < 0) continue;
      const a = cx(Math.min(i, ctrlIdx)), b = cx(Math.max(i, ctrlIdx));
      const yb = Math.min(tops2[i], tops2[ctrlIdx]) - (10 + lift * 13) * m.k;
      out.push(`<path d="M${n1(a)},${n1(yb + 4 * m.k)} V${n1(yb)} H${n1(b)} V${n1(yb + 4 * m.k)}" fill="none" stroke="${AXIS}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`);
      out.push(`<text x="${n1((a + b) / 2)}" y="${n1(yb - 3 * m.k)}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
      lift++;
    }
  } else {
    for (const [g, c] of sig) {
      const i = groups.indexOf(g);
      if (i < 0) continue;
      out.push(`<text x="${n1(cx(i))}" y="${n1(tops2[i] - 7 * m.k)}" text-anchor="middle" font-family="${FONT}" font-size="${m.star}" font-weight="700" fill="${INK}">${c.stars}</text>`);
    }
  }
  return out.join("");
}

function shortGroup(g) {
  return String(g).replace(/^HFD\s*/, "").replace(/^NCD\s*/, "chow ").trim() || String(g);
}

/* ---------- figure assembly ---------- */

export function renderFigure(panels, { cols = 2, panelW = 340, panelH = 265,
                                       records = [], showLegend = true } = {}) {
  const n = panels.length;
  const rows = Math.ceil(n / cols);
  const m = metrics(panelW, panelH);
  const W = cols * panelW;
  const body = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const weekOf = new Map();
  for (const r of records) if (!weekOf.has(r.groupLabel))
    weekOf.set(r.groupLabel, { w: r.weeks ?? 0, d: r.diet });
  const allGroups = [...new Set(panels.flatMap((p) =>
    p.analysis?.ok ? p.analysis.summary.map((s) => s.group) : []))]
    .sort((a, b) => {
      const A = weekOf.get(a) || {}, B = weekOf.get(b) || {};
      if ((A.d || "") !== (B.d || "")) return (A.d || "") < (B.d || "") ? -1 : 1;
      return (A.w ?? 0) - (B.w ?? 0);
    });
  const colors = groupColors(allGroups, records);
  const shapes = groupShapes(allGroups);

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
      ? linePanel(box, p.sel, p.analysis, colors, shapes, labels, m)
      : barPanel(box, p.sel, p.analysis, colors, shapes, labels, m));
  });

  const anyLine = panels.some((p) => p.sel.hasTime && p.sel.levels.length > 1);
  const perRow = Math.max(1, Math.min(5, Math.floor(W / 155)));
  const legendLines = showLegend && allGroups.length ? Math.ceil(allGroups.length / perRow) : 0;
  const legendH = legendLines ? legendLines * 19 + 12 : 0;
  const H = rows * panelH + legendH;

  if (legendLines) {
    const per = W / perRow;
    allGroups.forEach((g, i) => {
      const x = 14 + (i % perRow) * per;
      const y = rows * panelH + 16 + Math.floor(i / perRow) * 19;
      if (anyLine) {
        body.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 17}" y2="${y - 4}" stroke="${colors[g]}" stroke-width="2.2"/>`);
        body.push(marker(shapes[g], x + 8.5, y - 4, 4, colors[g], "#ffffff", 1.5));
      } else {
        body.push(`<rect x="${x}" y="${y - 10}" width="13" height="12" fill="${colors[g]}" fill-opacity="0.18" stroke="${colors[g]}" stroke-width="1.5"/>`);
        body.push(marker(shapes[g], x + 6.5, y - 4, 2.6, "#ffffff", colors[g], 1.15));
      }
      body.push(`<text x="${x + 24}" y="${y}" font-family="${FONT}" font-size="11" fill="${INK}">${esc(g)}</text>`);
    });
  }

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
