/* charts.js — publication-style panels drawn as one SVG.
   Figures are always drawn on white with black type, whatever theme the app is
   in: they are destined for a Word document, not for the screen. Every panel of
   a figure is laid out in a single SVG so the export is one image, not several. */

const FONT = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const INK = "#111111";
const AXIS = "#333333";
const GRID = "#e6e6e6";

/* Categorical slots 1 and 2, and the blue ordinal ramp, from the validated palette. */
export const DIET_COLORS = { NCD: "#2a78d6", HFD: "#eb6834", other: "#1baf7a" };
/* One-hue ordinal ramps, both validated light-end-first against a white
   surface: lightness carries weeks on diet, hue carries the diet. */
const RAMPS = {
  NCD: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"],
  HFD: ["#f2a077", "#ec7a45", "#e05a24", "#b34418", "#7d2f13"],
  other: ["#7fd9b8", "#35c48d", "#1baf7a", "#12805a", "#0a5138"]
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- scales ---------- */

function niceTicks(lo, hi, target = 5) {
  if (!isFinite(lo) || !isFinite(hi)) return { ticks: [0, 1], lo: 0, hi: 1 };
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
  const d = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Math.abs(v) < 1e-9 ? "0" : v.toFixed(d);
};

/* ---------- colour assignment ---------- */

/**
 * Hue carries the diet, lightness carries time on diet: two entities, two
 * channels, and no rainbow. A diet contributing a single group keeps the plain
 * categorical slot, so the common two-group figure is exactly blue vs orange.
 */
export function groupColors(groups, records) {
  const meta = new Map();
  for (const r of records) if (!meta.has(r.groupLabel))
    meta.set(r.groupLabel, { diet: r.diet, weeks: r.weeks });
  const byDiet = new Map();
  for (const g of groups) {
    const d = meta.get(g)?.diet || "other";
    if (!byDiet.has(d)) byDiet.set(d, []);
    byDiet.get(d).push(g);
  }
  const out = {};
  for (const [diet, list] of byDiet) {
    const ramp = RAMPS[diet] || RAMPS.other;
    if (list.length === 1) { out[list[0]] = DIET_COLORS[diet] || DIET_COLORS.other; continue; }
    const ordered = [...list].sort((a, b) => (meta.get(a)?.weeks ?? 0) - (meta.get(b)?.weeks ?? 0));
    const span = Math.max(1, ordered.length - 1);
    ordered.forEach((g, i) => { out[g] = ramp[Math.round(i / span * (ramp.length - 1))]; });
  }
  return out;
}

/* ---------- panel drawing ---------- */

function panelFrame(box, { tallX = false } = {}) {
  const { x, y, w, h } = box;
  const pad = { l: 56, r: 14, t: 28, b: tallX ? 62 : 44 };
  return { px: x + pad.l, py: y + pad.t, pw: w - pad.l - pad.r, ph: h - pad.t - pad.b, pad };
}

function axes(f, xTicks, yTicks, xLabel, yLabel, xScale, yScale, opts = {}) {
  const out = [];
  const { px, py, pw, ph } = f;
  // horizontal guides, recessive
  for (const t of yTicks.ticks) {
    const yy = yScale(t);
    out.push(`<line x1="${px}" y1="${yy.toFixed(1)}" x2="${px + pw}" y2="${yy.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`);
  }
  out.push(`<line x1="${px}" y1="${py}" x2="${px}" y2="${py + ph}" stroke="${AXIS}" stroke-width="1.4"/>`);
  out.push(`<line x1="${px}" y1="${py + ph}" x2="${px + pw}" y2="${py + ph}" stroke="${AXIS}" stroke-width="1.4"/>`);
  for (const t of yTicks.ticks) {
    const yy = yScale(t);
    out.push(`<line x1="${px - 4}" y1="${yy.toFixed(1)}" x2="${px}" y2="${yy.toFixed(1)}" stroke="${AXIS}" stroke-width="1.2"/>`);
    out.push(`<text x="${px - 7}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${INK}">${esc(fmtTick(t, yTicks.step))}</text>`);
  }
  const slotW = pw / Math.max(1, xTicks.length);
  const widest = Math.max(...xTicks.map((t) => String(t.label).length)) * 5.6;
  const tilt = widest > slotW - 4;
  for (const t of xTicks) {
    const xx = xScale(t.value);
    out.push(`<line x1="${xx.toFixed(1)}" y1="${py + ph}" x2="${xx.toFixed(1)}" y2="${py + ph + 4}" stroke="${AXIS}" stroke-width="1.2"/>`);
    out.push(tilt
      ? `<text transform="translate(${(xx - 2).toFixed(1)},${py + ph + 15}) rotate(-38)" text-anchor="end" font-family="${FONT}" font-size="10" fill="${INK}">${esc(t.label)}</text>`
      : `<text x="${xx.toFixed(1)}" y="${py + ph + 16}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}">${esc(t.label)}</text>`);
  }
  out.push(`<text x="${px + pw / 2}" y="${py + ph + (tilt ? 52 : 35)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(xLabel)}</text>`);
  const cy = py + ph / 2;
  const lines = wrapLabel(yLabel, Math.max(18, Math.floor(ph / 6.2)));
  const spans = lines.map((l, i) =>
    `<tspan x="0" dy="${i === 0 ? -(lines.length - 1) * 6 : 12}">${esc(l)}</tspan>`).join("");
  out.push(`<text transform="translate(${px - 40},${cy}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${spans}</text>`);
  return out.join("");
}

/** Break a label on spaces so a long axis title never runs past its panel. */
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

function errorBar(x, m, e, color, w = 4) {
  x = +x; m = +m; e = +e;
  if (!isFinite(e) || e <= 0) return "";
  const f = (v) => v.toFixed(1);
  return `<line x1="${f(x)}" y1="${f(m - e)}" x2="${f(x)}" y2="${f(m + e)}" stroke="${color}" stroke-width="1.4"/>` +
         `<line x1="${f(x - w)}" y1="${f(m - e)}" x2="${f(x + w)}" y2="${f(m - e)}" stroke="${color}" stroke-width="1.4"/>` +
         `<line x1="${f(x - w)}" y1="${f(m + e)}" x2="${f(x + w)}" y2="${f(m + e)}" stroke="${color}" stroke-width="1.4"/>`;
}

/** Time course: one line per group, mean ± SEM, asterisks at significant points. */
function linePanel(box, sel, analysis, colors, labels) {
  const f = panelFrame(box);
  const { px, py, pw, ph } = f;
  const out = [];
  const summary = analysis.summary;

  const ys = summary.flatMap((s) => s.points.flatMap((p) =>
    p.n ? [p.mean - (p.sem || 0), p.mean + (p.sem || 0)] : []));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const yT = niceTicks(lo, hi + (hi - lo) * 0.1);
  const xs = sel.levels;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xScale = (v) => px + (xMax === xMin ? pw / 2 : (v - xMin) / (xMax - xMin) * pw);
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  out.push(axes(f, xs.map((v) => ({ value: v, label: String(v) })), yT,
                labels.x, labels.y, xScale, yScale));

  for (const s of summary) {
    const c = colors[s.group];
    const pts = s.points.filter((p) => p.n);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${xScale(p.x).toFixed(1)},${yScale(p.mean).toFixed(1)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const p of pts) {
      const X = xScale(p.x), Y = yScale(p.mean);
      const e = isFinite(p.sem) ? Math.abs(yScale(p.mean + p.sem) - Y) : 0;
      out.push(errorBar(X.toFixed(1), Y.toFixed(1), e.toFixed(1), c));
      out.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="4" fill="${c}" stroke="#ffffff" stroke-width="1.6"/>`);
    }
  }

  // significance: asterisks above the highest mark at each x that differs
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
    const half = c.stars.length * 3.2;
    const ax = Math.min(px + pw - half, Math.max(px + half, xScale(xv)));
    out.push(`<text x="${ax.toFixed(1)}" y="${Math.max(py + 9, top - 7).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${INK}">${c.stars}</text>`);
  }
  return out.join("");
}

/** Mean ± SEM columns with every animal shown, and asterisks versus control. */
function barPanel(box, sel, analysis, colors, labels) {
  const f = panelFrame(box, { tallX: true });
  const { px, py, pw, ph } = f;
  const out = [];
  const summary = analysis.summary;
  const groups = summary.map((s) => s.group);

  const allVals = summary.flatMap((s) => s.points[0].values);
  const tops = summary.map((s) => s.points[0].mean + (s.points[0].sem || 0));
  const hi = Math.max(...allVals, ...tops);
  const yT = niceTicks(0, hi * 1.12);
  const yScale = (v) => py + ph - (v - yT.lo) / (yT.hi - yT.lo) * ph;

  const slot = pw / groups.length;
  const barW = Math.min(30, slot * 0.52);
  const cx = (i) => px + slot * (i + 0.5);

  out.push(axes(f, groups.map((g, i) => ({ value: i, label: shortGroup(g) })), yT,
                labels.x, labels.y, (i) => cx(i), yScale));

  const sig = new Map((analysis.posthoc || []).map((c) => [c.group, c]));

  summary.forEach((s, i) => {
    const p = s.points[0];
    if (!p.n) return;
    const c = colors[s.group];
    const X = cx(i), Y = yScale(p.mean), base = yScale(0);
    out.push(`<rect x="${(X - barW / 2).toFixed(1)}" y="${Y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, base - Y).toFixed(1)}" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="1.6"/>`);
    const e = isFinite(p.sem) ? Math.abs(yScale(p.mean + p.sem) - Y) : 0;
    out.push(errorBar(X.toFixed(1), Y.toFixed(1), e.toFixed(1), c, 5));
    // individual animals, jittered deterministically so the figure is stable
    p.values.forEach((v, k) => {
      const jx = X + ((k % 5) - 2) * (barW / 6.5);
      out.push(`<circle cx="${jx.toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="2.4" fill="#ffffff" stroke="${c}" stroke-width="1.1"/>`);
    });
    const st = sig.get(s.group);
    if (st && st.p < 0.05) {
      const top = Math.min(yScale(Math.max(...p.values)), Y - e);
      out.push(`<text x="${X.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${INK}">${st.stars}</text>`);
    }
  });
  return out.join("");
}

function shortGroup(g) {
  return String(g).replace(/^HFD\s*/, "").replace(/^NCD\s*/, "chow ").trim() || String(g);
}

/* ---------- figure assembly ---------- */

/**
 * Lay every panel out in one SVG.
 * `panels` = [{ sel, analysis, labels:{x,y} }]; `cols` sets the grid.
 */
export function renderFigure(panels, { cols = 2, panelW = 320, panelH = 250,
                                        records = [], showLegend = true } = {}) {
  const n = panels.length;
  const rows = Math.ceil(n / cols);
  const perRow = Math.max(1, Math.min(4, Math.floor(cols * panelW / 150)));
  const legendRows = showLegend ? 1 : 0;   // replaced below once groups are known
  const W = cols * panelW;
  const body = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const seen = [...new Set(panels.flatMap((p) => p.analysis?.ok ? p.analysis.summary.map((s) => s.group) : []))];
  const weekOf = new Map();
  for (const r of records) if (!weekOf.has(r.groupLabel)) weekOf.set(r.groupLabel, { w: r.weeks ?? 0, d: r.diet });
  const allGroups = seen.sort((a, b) => {
    const A = weekOf.get(a) || {}, B = weekOf.get(b) || {};
    if ((A.d || "") !== (B.d || "")) return (A.d || "") < (B.d || "") ? -1 : 1;
    return (A.w ?? 0) - (B.w ?? 0);
  });
  const colors = groupColors(allGroups, records);

  panels.forEach((p, i) => {
    const box = { x: (i % cols) * panelW, y: Math.floor(i / cols) * panelH, w: panelW, h: panelH };
    body.push(`<text x="${box.x + 6}" y="${box.y + 15}" font-family="${FONT}" font-size="13" font-weight="700" fill="${INK}">${letters[i]}</text>`);
    if (!p.analysis?.ok) {
      body.push(`<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#888">${esc(p.analysis?.reason || "no analysis")}</text>`);
      return;
    }
    const labels = p.labels || { x: "", y: "" };
    body.push(p.sel.hasTime && p.sel.levels.length > 1
      ? linePanel(box, p.sel, p.analysis, colors, labels)
      : barPanel(box, p.sel, p.analysis, colors, labels));
  });

  const anyLine = panels.some((p) => p.sel.hasTime && p.sel.levels.length > 1);
  const legendLines = showLegend && allGroups.length ? Math.ceil(allGroups.length / perRow) : 0;
  const legendH = legendLines * 18 + (legendLines ? 10 : 0);
  const H = rows * panelH + legendH;

  if (showLegend && allGroups.length) {
    const per = W / perRow;
    allGroups.forEach((g, i) => {
      const x = 14 + (i % perRow) * per, y = rows * panelH + 16 + Math.floor(i / perRow) * 18;
      body.push(anyLine
        ? `<line x1="${x}" y1="${y - 4}" x2="${x + 18}" y2="${y - 4}" stroke="${colors[g]}" stroke-width="2.4"/>` +
          `<circle cx="${x + 9}" cy="${y - 4}" r="3.6" fill="${colors[g]}" stroke="#fff" stroke-width="1.4"/>`
        : `<rect x="${x}" y="${y - 10}" width="14" height="12" fill="${colors[g]}" fill-opacity="0.25" stroke="${colors[g]}" stroke-width="1.5"/>`);
      body.push(`<text x="${x + 24}" y="${y}" font-family="${FONT}" font-size="11" fill="${INK}">${esc(g)}</text>`);
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
         `<rect width="${W}" height="${H}" fill="#ffffff"/>${body.join("")}</svg>`;
}

/** Rasterise at print resolution — 300 dpi against the SVG's 96 dpi geometry. */
export function svgToPng(svg, dpi = 300) {
  return new Promise((resolve, reject) => {
    const scale = dpi / 96;
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const w = Number(m[1]), h = Number(m[2]);
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode PNG"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not render the figure")); };
    img.src = url;
  });
}
