// Простые SVG-графики без внешних библиотек — работают офлайн.
import { esc } from './util.js';

const W = 340, H = 180, PL = 36, PR = 8, PT = 10, PB = 24;

function niceRange(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1;
  return [Math.max(0, min - pad), max + pad];
}

function ticks(min, max, n = 4) {
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + step * i);
}

const fmt = (v, span = 100) => String(span < 10 ? Math.round(v * 10) / 10 : Math.round(v)).replace('.', ',');

/** series: [{cls:'s1', points:[{x: ts, y}]}], xLabel(ts) → string */
export function lineChart(series, xLabel) {
  const pts = series.flatMap((s) => s.points);
  if (pts.length === 0) return '';
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  if (x0 === x1) { x0 -= 86400000; x1 += 86400000; }
  const [y0, y1] = niceRange(Math.min(...ys), Math.max(...ys));
  const sx = (x) => PL + ((x - x0) / (x1 - x0)) * (W - PL - PR);
  const sy = (y) => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks(y0, y1)) {
    out += `<line class="axis" x1="${PL}" x2="${W - PR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    out += `<text class="lbl" x="${PL - 4}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, y1 - y0)}</text>`;
  }
  out += `<text class="lbl" x="${PL}" y="${H - 6}">${esc(xLabel(x0))}</text>`;
  out += `<text class="lbl" x="${W - PR}" y="${H - 6}" text-anchor="end">${esc(xLabel(x1))}</text>`;
  series.forEach((s, i) => {
    if (!s.points.length) return;
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    out += `<path class="${s.cls || 's' + (i + 1)}" d="${d}"/>`;
    for (const p of s.points) out += `<circle class="${(s.cls || 's' + (i + 1)).replace('s', 'p')}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3"/>`;
  });
  return out + '</svg>';
}

/** bars: [{label, y}] */
export function barChart(bars) {
  if (!bars.length) return '';
  const ys = bars.map((b) => b.y);
  const y1 = Math.max(...ys) * 1.1 || 1;
  const bw = (W - PL - PR) / bars.length;
  const sy = (y) => PT + (1 - y / y1) * (H - PT - PB);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks(0, y1)) {
    out += `<line class="axis" x1="${PL}" x2="${W - PR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    out += `<text class="lbl" x="${PL - 4}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, y1)}</text>`;
  }
  const every = Math.ceil(bars.length / 6);
  bars.forEach((b, i) => {
    const x = PL + i * bw + bw * 0.15;
    const h = H - PB - sy(b.y);
    out += `<rect class="bar" x="${x.toFixed(1)}" y="${sy(b.y).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3"/>`;
    if (i % every === 0) out += `<text class="lbl" x="${(x + bw * 0.35).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return out + '</svg>';
}
