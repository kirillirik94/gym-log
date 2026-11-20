// Простые SVG-графики без внешних библиотек — работают офлайн.
import { esc } from './util.js';

const W = 340, H = 170, PL = 34, PR = 10, PT = 12, PB = 24;

const fmt = (v, span = 100) => String(span < 8 ? Math.round(v * 10) / 10 : Math.round(v)).replace('.', ',');

/**
 * series: [{cls:'s1', points:[{x: ts, y, i?, pr?}], main?, dots?}]
 * main — точки серии можно нажать (data-a=tapAction, data-i=i), sel — выбранная точка.
 * xLabel(ts) → string
 */
export function lineChart(series, xLabel, { sel = null, tapAction = null } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (pts.length === 0) return '';
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  if (x0 === x1) { x0 -= 2 * 86400000; x1 += 2 * 86400000; }
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) { y0 -= 5; y1 += 5; }
  const padY = (y1 - y0) * 0.15;
  y0 = Math.max(0, y0 - padY); y1 += padY;
  const sx = (x) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR);
  const sy = (y) => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 3; i++) {
    const t = y0 + ((y1 - y0) * i) / 3;
    out += `<line class="axis" x1="${PL}" x2="${W - PR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    out += `<text class="lbl" x="${PL - 5}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, y1 - y0)}</text>`;
  }
  [x0, (x0 + x1) / 2, x1].forEach((x, i) => {
    out += `<text class="lbl" x="${sx(x)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${esc(xLabel(x))}</text>`;
  });
  series.forEach((s, si) => {
    const cls = s.cls || `s${si + 1}`;
    if (s.points.length > 1) out += `<path class="${cls}" d="${s.points.map((p, j) => `${j ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')}"/>`;
    if (s.dots === false) return;
    for (const p of s.points) {
      const cx = sx(p.x).toFixed(1), cy = sy(p.y).toFixed(1);
      out += `<circle class="${p.pr ? 'pr' : cls.replace('s', 'p')}" cx="${cx}" cy="${cy}" r="${p.pr ? 5 : 3.5}"/>`;
      if (s.main && sel === p.i) out += `<circle class="sel" cx="${cx}" cy="${cy}" r="8"/>`;
      if (s.main && tapAction) out += `<circle class="hit" data-a="${esc(tapAction)}" data-i="${p.i}" cx="${cx}" cy="${cy}" r="14"/>`;
    }
  });
  return out + '</svg>';
}

/** bars: [{label, y, warn?}]. При ≤ 8 столбиках подписывает значения. */
export function barChart(bars, valueFmt = (v) => fmt(v)) {
  if (!bars.length) return '';
  const y1 = Math.max(...bars.map((b) => b.y)) * 1.15 || 1;
  const bw = (W - PL - PR) / Math.max(bars.length, 4);
  const sy = (y) => PT + (1 - y / y1) * (H - PT - PB);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 3; i++) {
    const t = (y1 * i) / 3;
    out += `<line class="axis" x1="${PL}" x2="${W - PR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    out += `<text class="lbl" x="${PL - 5}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, y1)}</text>`;
  }
  const every = Math.ceil(bars.length / 7);
  bars.forEach((b, i) => {
    const x = PL + i * bw + bw * 0.18, wd = bw * 0.64;
    out += `<rect class="bar${b.warn ? ' warn' : ''}" x="${x.toFixed(1)}" y="${sy(b.y).toFixed(1)}" width="${wd.toFixed(1)}" height="${Math.max(0, H - PB - sy(b.y)).toFixed(1)}" rx="3"/>`;
    if (bars.length <= 8 && b.y > 0) out += `<text class="lbl val" x="${(x + wd / 2).toFixed(1)}" y="${(sy(b.y) - 4).toFixed(1)}" text-anchor="middle">${esc(valueFmt(b.y))}</text>`;
    if (i % every === 0) out += `<text class="lbl" x="${(x + wd / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return out + '</svg>';
}

/** Мини-график без осей для списка упражнений. */
export function sparkline(vals) {
  const w = 76, h = 28, p = 4;
  if (!vals.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  let [y0, y1] = [Math.min(...vals), Math.max(...vals)];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const sx = (i) => (vals.length === 1 ? w / 2 : p + (i / (vals.length - 1)) * (w - 2 * p));
  const sy = (v) => p + (1 - (v - y0) / (y1 - y0)) * (h - 2 * p);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}">${vals.length > 1 ? `<path d="${d}"/>` : ''}<circle cx="${sx(vals.length - 1).toFixed(1)}" cy="${sy(vals.at(-1)).toFixed(1)}" r="2.5"/></svg>`;
}
