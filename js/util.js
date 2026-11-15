// Общие утилиты без DOM — их можно гонять в Node.

export const APP_VERSION = '1.0.1';

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** Локальная дата YYYY-MM-DD */
export function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Локальное время "YYYY-MM-DD HH:MM" */
export function ymdhm(ts) {
  const d = new Date(ts);
  return `${ymd(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Понедельник недели (локально), как ключ YYYY-MM-DD */
export function weekKey(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // пн = 0
  d.setDate(d.getDate() - dow);
  return ymd(d.getTime());
}

export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function fmtNum(n, lang = 'ru', maxFrac = 2) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: maxFrac }).format(Number(n));
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

export function roundTo(x, step) {
  if (!step) return x;
  return Math.round(x / step) * step;
}

/** Округление до 0.01, чтобы 2.5 + 2.5 + ... не давало 7.499999 */
export const clean = (x) => Math.round(x * 100) / 100;

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'да';
}

export function toNum(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}
