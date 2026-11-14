import * as db from './db.js';
import { t, setLang, getLang, weekdayName, fmtDate, dayName } from './i18n.js';
import { normalizeProgram, exName, weightStepFor } from './program.js';
import { createWorkout, suggestNextDay, newSet, adhocExercise, elapsedMs, uncheckedSets, usesBackCheck } from './workout.js';
import { previousSessions, progressionHint, lastSetsText } from './progression.js';
import {
  computeSummary, workoutXp, levelFromXp, weeklyStreak, computeAchievements, ACHIEVEMENTS, factCandidates, pickFact, e1rm,
} from './stats.js';
import { api, enqueue, processQueue } from './sync.js';
import { lineChart, barChart } from './charts.js';
import { esc, fmtNum, fmtDuration, clean, toNum, ymd, weekKey, addDays, APP_VERSION } from './util.js';

/* =========================================================
   Состояние
   ========================================================= */

const DEFAULT_SETTINGS = { lang: 'ru', scriptUrl: '', secret: '', target: 3, weightSteps: {} };

const S = {
  settings: { ...DEFAULT_SETTINGS },
  program: normalizeProgram(null, 'default'),
  workouts: [],
  bodyweight: [],
  queue: [],
  active: null,
  ui: { historyTab: 'calendar', calOffset: 0, chartEx: 'bench_press', pickerQuery: '' },
  modal: null,
  syncError: null,
};

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');
const $nav = document.getElementById('nav');

const fmt = (n, d = 2) => fmtNum(n, getLang(), d);
const kg = (n) => `${fmt(n)} ${t('kg')}`;
const exDef = (id) => S.program.exercises[id];

async function loadAll() {
  const [settings, program, workouts, bw, queue, active] = await Promise.all([
    db.kvGet('settings'), db.kvGet('program'), db.getAll('workouts'), db.getAll('bodyweight'), db.getAll('queue'), db.kvGet('active'),
  ]);
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  setLang(S.settings.lang);
  if (program) S.program = normalizeProgram(program.raw, program.source || 'cache');
  S.workouts = (workouts || []).filter((w) => w.status === 'done').sort((a, b) => a.startedAt - b.startedAt);
  S.bodyweight = (bw || []).sort((a, b) => a.date - b.date);
  S.queue = queue || [];
  S.active = active || null;
}

const saveSettings = () => db.kvSet('settings', S.settings);
async function saveActive() { if (S.active) await db.kvSet('active', S.active); else await db.kvDel('active'); }
async function refreshQueue() { S.queue = await db.getAll('queue'); }

/** Мутация активной тренировки: сразу в IndexedDB, потом перерисовка. */
async function mutate(fn) {
  fn(S.active);
  await saveActive();
  render();
}

/* =========================================================
   Программа и синхронизация
   ========================================================= */

async function fetchProgram({ silent = true } = {}) {
  try {
    const data = await api(S.settings, 'getProgram');
    const raw = { program: data.program, exercises: data.exercises, fetched_at: data.fetched_at || new Date().toISOString() };
    await db.kvSet('program', { raw, source: 'sheet', savedAt: Date.now() });
    S.program = normalizeProgram(raw, 'sheet');
    if (!silent) toast(t('program_updated'));
    render();
    return true;
  } catch (e) {
    if (!silent) toast(t('conn_fail', { e: e.message }));
    if (S.program.source === 'sheet') S.program.source = 'cache';
    return false;
  }
}

async function runSync(force = false) {
  const r = await processQueue(S.settings, { force, onChange: refreshQueue });
  await refreshQueue();
  const fresh = await db.getAll('workouts');
  S.workouts = fresh.filter((w) => w.status === 'done').sort((a, b) => a.startedAt - b.startedAt);
  S.syncError = S.queue.find((q) => q.lastError)?.lastError || null;
  if (!r.skipped) render();
  return r;
}

/* =========================================================
   Роутинг
   ========================================================= */

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [name, id] = h.split('/');
  return { name, id };
}

function go(path) {
  if (location.hash === `#/${path}`) render();
  else location.hash = `#/${path}`;
}

window.addEventListener('hashchange', () => { S.modal = null; render(); window.scrollTo(0, 0); });

/* =========================================================
   Рендер
   ========================================================= */

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  workout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
};

function render() {
  const r = route();
  let html = '';
  $app.classList.remove('in-workout');
  if (r.name === 'workout') {
    if (!S.active) { location.replace('#/home'); return; }
    $app.classList.add('in-workout');
    html = S.active.status === 'rating' ? viewRating() : viewWorkout();
  } else if (r.name === 'summary') html = viewSummary(r.id);
  else if (r.name === 'history') html = viewHistory();
  else if (r.name === 'settings') html = viewSettings();
  else html = viewHome();
  $app.innerHTML = html;
  renderNav(r.name);
  renderModal();
  tick();
}

function renderNav(current) {
  const items = [['home', t('nav_home')]];
  if (S.active) items.push(['workout', t('nav_workout')]);
  items.push(['history', t('nav_history')], ['settings', t('nav_settings')]);
  const map = { summary: 'history' };
  const cur = map[current] || current;
  $nav.innerHTML = `<div class="nav-inner">${items.map(([k, label]) =>
    `<a href="#/${k}" class="${cur === k ? 'on' : ''}">${ICONS[k]}<span>${esc(label)}</span></a>`).join('')}</div>`;
}

/* ---------- Главная ---------- */

function programBanner() {
  const p = S.program;
  const when = p.fetchedAt ? fmtDate(new Date(p.fetchedAt).getTime(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  if (p.source === 'sheet') return `<p class="muted small">${esc(t('program_from_sheet', { when }))}</p>`;
  if (p.source === 'cache') return `<p class="muted small">${esc(t('program_cached', { when }))}</p>`;
  return `<div class="banner warn">${esc(t('program_default'))}</div>`;
}

function syncLine() {
  const n = S.queue.length;
  if (!S.settings.scriptUrl || !S.settings.secret) return `<div class="banner warn">${esc(t('sync_no_url'))}${n ? ' · ' + esc(t('sync_pending', { n })) : ''}</div>`;
  if (!n) return `<p class="muted small">✓ ${esc(t('sync_all_ok'))}</p>`;
  const err = S.syncError ? `<div class="small">${esc(t('sync_error', { e: S.syncError }))}. ${esc(t('sync_will_retry'))}.</div>` : '';
  return `<div class="banner"><div class="row"><span>${esc(t('sync_pending', { n }))}</span><span class="spacer"></span>
    <button class="btn sm" data-a="sync-now">${esc(t('sync_now'))}</button></div>${err}</div>`;
}

function levelCard() {
  const xp = S.workouts.reduce((a, w) => a + (w.xp || 0), 0);
  const lv = levelFromXp(xp);
  const st = weeklyStreak(S.workouts, S.settings.target);
  return `<div class="card">
    <div class="row"><b>${esc(t('level', { n: lv.level }))}</b><span class="spacer"></span><span class="muted small">${esc(t('xp_to_next', { into: lv.into, need: lv.need }))}</span></div>
    <div class="xpbar"><div style="width:${Math.round((lv.into / lv.need) * 100)}%"></div></div>
    <div class="row" style="margin-top:10px"><span>🔥 ${esc(t('streak_weeks', { n: st.streak }))}</span><span class="spacer"></span>
    <span class="muted">${esc(t('week_progress', { n: st.thisWeek, target: st.target }))}</span></div>
  </div>`;
}

function viewHome() {
  let main;
  if (S.active) {
    main = `<button class="btn primary big block" data-a="open-active">${esc(S.active.status === 'rating' ? t('continue_rating') : t('continue_workout'))}</button>
      <p class="muted small center">${esc(dayName(S.active.day))} · ${fmtDuration(elapsedMs(S.active))}</p>`;
  } else {
    const days = Object.keys(S.program.days).sort();
    const next = suggestNextDay(S.workouts, days);
    const others = days.filter((d) => d !== next);
    main = `<p class="muted small">${esc(t('next_suggested'))}</p>
      <button class="btn primary big block" data-a="start" data-day="${esc(next)}">${esc(t('start_day', { day: dayName(next) }))}</button>
      ${others.length ? `<div class="row" style="margin-top:8px">${others.map((d) =>
        `<button class="btn block" data-a="start" data-day="${esc(d)}">${esc(dayName(d))}</button>`).join('')}</div>` : ''}`;
  }
  const last = S.workouts[S.workouts.length - 1];
  const lastCard = last
    ? `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#/summary/${esc(last.id)}">
        <div class="muted small">${esc(t('last_workout'))}</div>
        <div class="row"><b>${esc(last.title)}</b><span class="spacer"></span><span class="muted small">${fmtDate(last.startedAt)}</span></div>
        <div class="muted small">${esc(t('volume'))}: ${fmt(last.summary.volumeWork / 1000, 1)} т · ${esc(t('sets_count'))}: ${last.summary.workSets}</div>
      </a>`
    : `<p class="muted">${esc(t('no_workouts'))}</p>`;
  return `<h1>${esc(t('app_name'))}</h1>
    ${navigator.onLine ? '' : `<div class="banner" style="margin-bottom:10px">${esc(t('offline'))}</div>`}
    <div class="stack">${main}</div>
    <div style="margin-top:16px">${levelCard()}</div>
    <div style="margin-top:12px">${lastCard}</div>
    <div class="stack" style="margin-top:14px">${syncLine()}${programBanner()}</div>`;
}

/* ---------- Тренировка ---------- */

function hintChip(e) {
  const ex = exDef(e.exerciseId);
  if (!ex) return { chips: '', last: '' };
  const sessions = previousSessions(e.exerciseId, S.active.day, S.workouts, S.program.days[S.active.day]);
  const h = progressionHint(e, ex, sessions, weightStepFor(ex, S.settings));
  const cls = { up: 'up', up_bw: 'up', reps: 'hint', reps_bw: 'hint', stay: 'warn', reduce: 'warn', back_rollback: 'danger', need_back_ok: 'warn', no_failure_repeat: 'warn' }[h.kind];
  let text = '';
  if (h.kind !== 'none') {
    const p = { ...h.params };
    if (h.kind === 'back_rollback') p.to = p.to ? `: ~${fmt(p.to)} ${t('kg')}` : '';
    text = t(`hint_${h.kind}`, p);
    if ((h.kind === 'up') && h.noFailure) text += t('hint_up_safe_suffix');
  }
  let chips = text ? `<span class="chip ${cls}" data-hint="${esc(h.kind)}">${esc(text)}</span>` : '';
  if (h.noFailure) chips += `<span class="chip warn">${esc(t('no_failure_chip'))}</span>`;
  const s0 = sessions[0];
  const last = s0 ? `${esc(s0.baseline ? t('last_time_baseline') : t('last_time'))}: ${esc(lastSetsText(s0, ex.type === 'bodyweight', (x) => fmt(x)))}` : '';
  return { chips, last };
}

function weightCell(e, s, ei, si) {
  const ex = exDef(e.exerciseId);
  const isBW = ex?.type === 'bodyweight';
  const num = isBW ? (s.weight > 0 ? `+${fmt(s.weight)}` : t('bw')) : fmt(s.weight);
  const unit = isBW ? (s.weight > 0 ? `${t('bw')} + ${t('kg')}` : '') : t('kg');
  return stepper(ei, si, 'weight', num, unit);
}

function stepper(ei, si, field, num, unit) {
  const d = `data-ex="${ei}" data-set="${si}" data-field="${field}"`;
  return `<div class="stepper" data-lp="num" ${d}>
    <button data-a="step" data-dir="-1" ${d} aria-label="−">−</button>
    <div class="val"><span class="num${String(num).length >= 5 ? ' long' : ''}">${esc(num)}</span>${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>
    <button data-a="step" data-dir="1" ${d} aria-label="+">+</button>
  </div>`;
}

function exerciseCard(e, ei) {
  const ex = exDef(e.exerciseId);
  const lang = getLang();
  const subs = [];
  if (ex) subs.push(t(`type_${ex.type}`));
  if (ex?.type === 'dumbbell') subs.push(t('per_dumbbell'));
  subs.push(t('target_reps', { min: e.repMin, max: e.repMax }));
  const ss = e.superset ? `<span class="superset-tag">⇄ ${esc(e.superset)}</span> ` : '';
  if (e.skipped) {
    return `<div class="card ex skipped" data-exi="${ei}"><div class="ex-head"><div style="flex:1"><div class="ex-name">${esc(exName(ex, lang))}</div>
      <div class="ex-sub">${esc(t('skipped'))}</div></div>
      <button class="btn sm" data-a="unskip" data-ex="${ei}">${esc(t('unskip_exercise'))}</button></div></div>`;
  }
  const { chips, last } = hintChip(e);
  let workNo = 0;
  const rows = e.sets.map((s, si) => {
    const label = s.warmup ? t('warmup') : String(++workNo);
    return `<div class="setrow ${s.done ? 'is-done' : ''} ${s.warmup ? 'is-warm' : ''}" data-row="${ei}-${si}">
      <div class="setno" data-a="toggle-done" data-ex="${ei}" data-set="${si}" role="checkbox" aria-checked="${s.done}">${esc(label)}</div>
      ${weightCell(e, s, ei, si)}
      ${stepper(ei, si, 'reps', String(s.reps), s.rir !== null && s.rir !== undefined ? t('rir_short', { n: s.rir }) : t('reps'))}
      <button class="iconbtn setmenu" data-a="set-menu" data-ex="${ei}" data-set="${si}" aria-label="menu">${ICONS.dots}</button>
    </div>`;
  }).join('');
  const note = e.notes?.[lang] || e.notes?.ru || '';
  const restBtn = e.superset
    ? `<button class="btn" data-a="rest-start" data-ex="${ei}">${ICONS.timer.replace('<svg', '<svg width="20" height="20"')} ${esc(t('rest_default', { t: fmtDuration(e.restSec * 1000) }))}</button>`
    : '';
  return `<div class="card ex" data-exi="${ei}" data-exid="${esc(e.exerciseId)}">
    <div class="ex-head">
      <div style="flex:1">
        <div class="ex-name">${ss}${esc(exName(ex, lang))}</div>
        <div class="ex-sub">${esc(subs.join(' · '))}</div>
      </div>
      <button class="iconbtn" data-a="ex-menu" data-ex="${ei}" aria-label="menu">${ICONS.dots}</button>
    </div>
    ${chips ? `<div class="ex-chips">${chips}</div>` : ''}
    ${last ? `<div class="ex-note">${last}</div>` : ''}
    ${note ? `<div class="ex-note">${esc(note)}</div>` : ''}
    <div class="sets">${rows}</div>
    <div class="ex-actions"><button class="btn" data-a="add-set" data-ex="${ei}">${esc(t('add_set'))}</button>${restBtn}</div>
  </div>`;
}

function viewWorkout() {
  const w = S.active;
  const paused = !!w.pausedAt;
  return `<div class="wbar">
      <div class="row">
        <div><div class="clock" data-clock>${fmtDuration(elapsedMs(w))}</div><div class="wtitle">${esc(dayName(w.day))}</div></div>
        <span class="spacer"></span>
        <button class="btn" data-a="${paused ? 'resume' : 'pause'}">${paused ? esc(t('resume')) : ICONS.pause.replace('<svg', '<svg width="20" height="20"') + ' ' + esc(t('pause'))}</button>
      </div>
      ${w.rest ? `<div class="restbar" data-restbar><div class="fill" data-rest-fill></div>
        <span data-rest-label>${esc(t('rest'))}</span><span class="t" data-rest-t></span><span class="spacer"></span>
        <button class="btn" data-a="rest-adj" data-d="-15">−15</button><button class="btn" data-a="rest-adj" data-d="15">+15</button>
        <button class="btn" data-a="rest-stop">✕</button></div>` : ''}
    </div>
    ${w.exercises.map(exerciseCard).join('')}
    <div class="stack" style="margin-top:12px">
      <button class="btn block" data-a="add-ex">${esc(t('add_exercise'))}</button>
      <button class="btn done big block" data-a="finish">${esc(t('finish'))}</button>
      <button class="btn ghost danger block" data-a="discard">${esc(t('discard_workout'))}</button>
    </div>
    ${paused ? `<div class="pause-veil"><div class="clock">${esc(t('paused'))}</div><button class="btn primary big" data-a="resume">${esc(t('resume'))}</button></div>` : ''}`;
}

/* ---------- Оценки ---------- */

function choiceGroup(key, n, cols) {
  const v = S.active.ratings[key];
  const btns = Array.from({ length: n }, (_, i) => i + 1).map((i) =>
    `<button class="choice ${v === i ? 'on' : ''}" data-a="rate" data-k="${key}" data-v="${i}"><b>${i}</b>${esc(t(`${key}_${i}`))}</button>`).join('');
  return `<div class="field"><span>${esc(t(key))}</span><div class="choices ${cols}">${btns}</div></div>`;
}

function bodyweightDue() {
  const last = S.bodyweight[S.bodyweight.length - 1];
  return !last || Date.now() - last.date > 7 * 86400000;
}

function viewRating() {
  const w = S.active;
  const r = w.ratings;
  const back = usesBackCheck(w, S.program)
    ? `<div class="field"><span>${esc(t('back_q'))}</span><div class="choices c2">
        <button class="choice ${r.backOk === true ? 'on' : ''}" data-a="back-set" data-v="1">${esc(t('back_ok'))}</button>
        <button class="choice ${r.backOk === false ? 'on bad' : ''}" data-a="back-set" data-v="0">${esc(t('back_bad'))}</button>
      </div></div>` : '';
  const lastBw = S.bodyweight[S.bodyweight.length - 1];
  return `<div class="wbar"><div class="row"><button class="btn ghost" data-a="back-to-workout">${esc(t('back_to_workout'))}</button></div></div>
    <h1>${esc(t('rating_title'))}</h1>
    <div class="stack">
      <label class="field"><span>${esc(t('title'))}</span><input data-in="title" value="${esc(w.title)}" maxlength="80"></label>
      ${choiceGroup('feel', 5, 'c5')}
      ${choiceGroup('sleep', 5, 'c5')}
      ${choiceGroup('food', 3, 'c3')}
      ${choiceGroup('mood', 5, 'c5')}
      ${back}
      <label class="field"><span>${esc(t('comment'))}</span><textarea data-in="comment" placeholder="${esc(t('comment_ph'))}" maxlength="1000">${esc(r.comment)}</textarea></label>
      ${bodyweightDue() ? `<div class="banner warn">${esc(t('bodyweight_due'))}</div>` : ''}
      <label class="field"><span>${esc(t('bodyweight'))}</span><input data-in="bodyweight" inputmode="decimal" value="${r.bodyweight ? esc(fmt(r.bodyweight)) : ''}" placeholder="${lastBw ? esc(fmt(lastBw.kg)) : esc(t('bodyweight_ph'))}"></label>
      <button class="btn primary big block" data-a="save-workout">${esc(t('save_workout'))}</button>
    </div>`;
}

/* ---------- Итоги ---------- */

function delta(now, prev, unit = '') {
  if (prev === undefined || prev === null) return '';
  const d = clean(now - prev);
  if (d === 0) return `<span class="muted">=</span>`;
  return d > 0 ? `<span class="delta-up">↑ ${fmt(d)}${unit}</span>` : `<span class="delta-down">↓ ${fmt(-d)}${unit}</span>`;
}

function prText(p) {
  const ex = exDef(p.exerciseId);
  const name = exName(ex, getLang());
  let what;
  if (p.type === 'weight') what = ex?.type === 'bodyweight' ? t('bw_plus', { kg: kg(p.value) }) : t('pr_weight', { v: p.value });
  else if (p.type === 'reps') what = ex?.type === 'bodyweight' ? t('pr_reps_bw', { reps: p.reps, weight: kg(p.weight) }) : t('pr_reps', { reps: p.reps, weight: p.weight });
  else what = t('pr_e1rm', { v: p.value });
  return `<div class="list-row"><span>🏆</span><div><b>${esc(name)}</b><div class="small muted">${esc(what)}</div></div></div>`;
}

function factText(f) {
  if (!f) return '';
  const p = { ...f.params };
  if (p.ex) p.ex = exName(exDef(p.ex), getLang());
  if (p.obj) p.obj = t(`obj_${p.obj}`);
  if (f.key === 'fact_standard') {
    if (!p.level) return t('fact_standard_below', { ...p, level: t(`lvl_${p.next.level}`), kg: p.next.needKg });
    p.next = p.next ? t('fact_standard_next', { level: t(`lvl_${p.next.level}`), kg: p.next.needKg }) : '';
    p.level = t(`lvl_${p.level}`);
  }
  if (f.key === 'fact_dynamics') {
    const d = p.days;
    p.period = d >= 60 ? t('period_months', { n: Math.round(d / 30) }) : d >= 14 ? t('period_weeks', { n: Math.round(d / 7) }) : t('period_days', { n: d });
  }
  return t(f.key, p);
}

function viewSummary(id) {
  const w = S.workouts.find((x) => x.id === id);
  if (!w) return `<h1>${esc(t('summary'))}</h1><p class="muted">${esc(t('no_data'))}</p>`;
  const s = w.summary;
  const c = s.compare;
  const lang = getLang();
  const synced = !S.queue.some((q) => q.id === w.id);
  const xpTotal = S.workouts.reduce((a, x) => a + (x.xp || 0), 0);
  const lv = levelFromXp(xpTotal);
  const per = s.perExercise.map((pe) => {
    const q = c?.perExercise?.[pe.exerciseId];
    return `<div class="list-row"><div style="flex:1"><b>${esc(exName(exDef(pe.exerciseId), lang))}</b>
      <div class="small muted">${esc(t('volume'))} ${kg(Math.round(pe.volume))} ${q ? delta(pe.volume, q.volume) : ''} · ${pe.reps} ${esc(t('reps'))} ${q ? delta(pe.reps, q.reps) : ''}${pe.avgWeight > 0 ? ` · ${esc(t('avg_weight'))} ${kg(pe.avgWeight)}` : ''}</div></div></div>`;
  }).join('');
  const ach = (w.newAchievements || []).map((a) => `<div class="ach"><div class="medal">★</div><b>${esc(t(`ach_${a}`))}</b></div>`).join('');
  return `<h1>${esc(t('summary'))}</h1>
    <div class="row wrap" style="margin-bottom:12px"><b>${esc(w.title)}</b><span class="spacer"></span>
      <span class="chip ${synced ? 'up' : 'warn'}" data-sync-state="${synced ? 'synced' : 'queued'}">${esc(synced ? t('synced') : t('queued'))}</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${fmt(s.volumeWork / 1000, 2)} т</div><div class="l">${esc(t('volume'))}, ${esc(t('volume_work'))} ${c ? delta(s.volumeWork, c.volumeWork[1]) : ''}</div>
        <div class="small muted">${fmt(s.volume / 1000, 2)} т ${esc(t('volume_all'))}</div></div>
      <div class="stat"><div class="v">${s.workSets}</div><div class="l">${esc(t('sets_count'))} ${c ? delta(s.workSets, c.workSets[1]) : ''}</div>
        <div class="small muted">${esc(t('warmups_n', { n: s.warmupSets }))}</div></div>
      <div class="stat"><div class="v">${s.reps}</div><div class="l">${esc(t('reps_count'))} ${c ? delta(s.reps, c.reps[1]) : ''}</div></div>
      <div class="stat"><div class="v">${kg(s.maxWeight)}</div><div class="l">${esc(t('max_weight'))} ${c ? delta(s.maxWeight, c.maxWeight[1]) : ''}</div></div>
      <div class="stat"><div class="v">${Math.round(w.durationMs / 60000)} ${getLang() === 'ru' ? 'мин' : 'min'}</div><div class="l">${esc(t('duration'))}</div></div>
      <div class="stat"><div class="v">${esc(t('xp_gained', { xp: w.xp }))}</div><div class="l">${esc(t('level', { n: lv.level }))}</div></div>
    </div>
    <div class="card" style="margin-top:12px"><div class="muted small">💡 ${esc(t('fact'))}</div><div class="fact" data-fact="${esc(w.fact?.id || '')}">${esc(factText(w.fact))}</div></div>
    ${ach ? `<h2>${esc(t('new_achievements'))}</h2><div class="card">${ach}</div>` : ''}
    <h2>${esc(t('prs'))}</h2>
    <div class="card">${s.prs.length ? s.prs.map(prText).join('') : `<span class="muted">${esc(t('no_prs'))}</span>`}</div>
    ${c ? `<p class="muted small">${esc(t('vs_prev'))}</p>` : ''}
    <h2>${esc(t('by_exercise'))}</h2>
    <div class="card">${per}</div>
    <div class="stack" style="margin-top:16px">
      <button class="btn block" data-a="export">${esc(t('backup_json'))}</button>
      <button class="btn primary block" data-a="go" data-to="home">${esc(t('to_home'))}</button>
    </div>`;
}

/* ---------- История ---------- */

function viewHistory() {
  const tab = S.ui.historyTab;
  const tabs = ['calendar', 'charts', 'workouts', 'achievements'];
  const seg = `<div class="seg">${tabs.map((k) => `<button class="${tab === k ? 'on' : ''}" data-a="htab" data-tab="${k}">${esc(t(k))}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'calendar') body = viewCalendar();
  else if (tab === 'charts') body = viewCharts();
  else if (tab === 'workouts') body = viewWorkoutList();
  else body = viewAchievements();
  return `<h1>${esc(t('history'))}</h1>${levelCard()}<div style="margin-top:12px">${seg}</div><div style="margin-top:12px">${body}</div>`;
}

function viewCalendar() {
  const now = new Date();
  const m = new Date(now.getFullYear(), now.getMonth() + S.ui.calOffset, 1);
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const lead = (m.getDay() + 6) % 7;
  const byDay = {};
  for (const w of S.workouts) (byDay[ymd(w.startedAt)] ||= []).push(w);
  const dows = Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2024, 0, 1 + i).getTime(), { weekday: 'narrow' }));
  let cells = dows.map((d) => `<div class="dow">${esc(d)}</div>`).join('');
  cells += '<div></div>'.repeat(lead);
  const today = ymd(Date.now());
  for (let d = 1; d <= days; d++) {
    const key = ymd(new Date(m.getFullYear(), m.getMonth(), d).getTime());
    const ws = byDay[key] || [];
    const cls = ws.length ? `has ${ws[0].day}` : '';
    const inner = `${d}${ws.length ? `<small>${esc(ws.map((w) => w.day).join(''))}</small>` : ''}`;
    cells += ws.length
      ? `<a class="d ${cls} ${key === today ? 'today' : ''}" href="#/summary/${esc(ws[0].id)}" style="text-decoration:none">${inner}</a>`
      : `<div class="d ${key === today ? 'today' : ''}">${inner}</div>`;
  }
  const title = fmtDate(m.getTime(), { month: 'long', year: 'numeric' });
  return `<div class="card"><div class="row" style="margin-bottom:8px">
      <button class="iconbtn" data-a="cal" data-d="-1">‹</button><b class="spacer center">${esc(title)}</b>
      <button class="iconbtn" data-a="cal" data-d="1">›</button></div>
    <div class="cal">${cells}</div></div>`;
}

function viewCharts() {
  const lang = getLang();
  const used = new Set();
  for (const w of S.workouts) for (const e of w.exercises) if (!e.skipped) used.add(e.exerciseId);
  for (const d of Object.values(S.program.days)) for (const p of d) used.add(p.exerciseId);
  const ids = [...used].filter((id) => exDef(id));
  if (!ids.includes(S.ui.chartEx)) S.ui.chartEx = ids[0];
  const id = S.ui.chartEx;
  const ex = exDef(id);
  const wPts = [], ePts = [];
  for (const w of S.workouts) {
    const e = w.exercises.find((x) => x.exerciseId === id && !x.skipped);
    if (!e) continue;
    const ws = e.sets.filter((s) => s.done && !s.warmup);
    if (!ws.length) continue;
    wPts.push({ x: w.startedAt, y: Math.max(...ws.map((s) => s.weight)) });
    if (ex.type !== 'bodyweight') ePts.push({ x: w.startedAt, y: clean(Math.max(...ws.map((s) => e1rm(s.weight, s.reps)))) });
  }
  const xl = (ts) => fmtDate(ts);
  const exChart = wPts.length
    ? `<div class="chart">${lineChart([{ cls: 's1', points: wPts }, { cls: 's2', points: ePts }], xl)}</div>
       <div class="legend"><span><i style="background:var(--chart-1)"></i>${esc(t('chart_weight'))}${ex.type === 'bodyweight' ? ' (+кг)' : ''}</span>${ePts.length ? `<span><i style="background:var(--chart-2)"></i>${esc(t('chart_e1rm'))}</span>` : ''}</div>`
    : `<p class="muted">${esc(t('no_data'))}</p>`;

  const weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push(weekKey(addDays(Date.now(), -7 * i)));
  const wv = Object.fromEntries(weeks.map((k) => [k, 0]));
  for (const w of S.workouts) { const k = weekKey(w.startedAt); if (k in wv) wv[k] += w.summary.volumeWork / 1000; }
  const weekBars = weeks.map((k) => ({ label: k.slice(8) + '.' + k.slice(5, 7), y: clean(wv[k]) }));
  const perW = S.workouts.slice(-20).map((w) => ({ label: fmtDate(w.startedAt, { day: 'numeric' }), y: clean(w.summary.volumeWork / 1000) }));
  const bwPts = S.bodyweight.map((b) => ({ x: b.date, y: b.kg }));

  return `<div class="card"><label class="field"><span>${esc(t('chart_exercise'))}</span>
      <select class="sel" data-in="chartEx">${ids.map((i) => `<option value="${esc(i)}" ${i === id ? 'selected' : ''}>${esc(exName(exDef(i), lang))}</option>`).join('')}</select></label>
      <div style="margin-top:10px">${exChart}</div></div>
    <div class="card"><h3>${esc(t('chart_week_volume'))}</h3><div class="chart">${S.workouts.length ? barChart(weekBars) : `<p class="muted">${esc(t('no_data'))}</p>`}</div></div>
    <div class="card"><h3>${esc(t('chart_workout_volume'))}</h3><div class="chart">${perW.length ? barChart(perW) : `<p class="muted">${esc(t('no_data'))}</p>`}</div></div>
    <div class="card"><h3>${esc(t('chart_bodyweight'))}</h3><div class="chart">${bwPts.length ? lineChart([{ cls: 's1', points: bwPts }], xl) : `<p class="muted">${esc(t('no_data'))}</p>`}</div></div>`;
}

function viewWorkoutList() {
  if (!S.workouts.length) return `<p class="muted">${esc(t('no_workouts'))}</p>`;
  return `<div class="card">${[...S.workouts].reverse().map((w) =>
    `<a class="list-row" href="#/summary/${esc(w.id)}" style="text-decoration:none;color:inherit">
      <div style="flex:1"><b>${esc(w.title)}</b><div class="small muted">${fmtDate(w.startedAt, { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(w.summary.volumeWork / 1000, 2)} т · ${w.summary.workSets} ${esc(t('sets_count').toLowerCase())}${w.summary.prs.length ? ' · 🏆 ' + w.summary.prs.length : ''}</div></div>
      <span class="muted">›</span></a>`).join('')}</div>`;
}

function viewAchievements() {
  const got = computeAchievements(S.workouts, S.settings.target);
  return `<div class="card">${ACHIEVEMENTS.map((id) => {
    const g = got[id];
    return `<div class="ach ${g ? '' : 'locked'}"><div class="medal">${g ? '★' : '·'}</div><div><b>${esc(t(`ach_${id}`))}</b>
      ${g ? `<div class="small muted">${fmtDate(g.date, { day: 'numeric', month: 'short', year: 'numeric' })}</div>` : ''}</div></div>`;
  }).join('')}</div>`;
}

/* ---------- Настройки ---------- */

function viewSettings() {
  const st = S.settings;
  const lang = getLang();
  const progIds = [...new Set(Object.values(S.program.days).flat().map((p) => p.exerciseId))].filter((id) => exDef(id) && exDef(id).type !== 'bodyweight');
  const stepOpts = [1, 1.25, 2, 2.5, 5];
  const steps = progIds.map((id) => {
    const ex = exDef(id);
    const cur = weightStepFor(ex, st);
    return `<div class="list-row"><span class="spacer">${esc(exName(ex, lang))}</span><div class="mini-seg">${stepOpts.map((v) =>
      `<button class="${cur === v ? 'on' : ''}" data-a="wstep" data-id="${esc(id)}" data-v="${v}">${fmt(v)}</button>`).join('')}</div></div>`;
  }).join('');
  return `<h1>${esc(t('settings'))}</h1>
    <div class="card stack">
      <div class="field"><span>${esc(t('language'))}</span><div class="seg">
        <button class="${lang === 'ru' ? 'on' : ''}" data-a="lang" data-v="ru">Русский</button>
        <button class="${lang === 'en' ? 'on' : ''}" data-a="lang" data-v="en">English</button></div></div>
      <div class="field"><span>${esc(t('target_per_week'))}</span><div class="mini-seg">${[2, 3, 4, 5].map((v) =>
        `<button class="${st.target === v ? 'on' : ''}" data-a="target" data-v="${v}">${v}</button>`).join('')}</div></div>
    </div>
    <h2>${esc(t('sync'))}</h2>
    <div class="card stack">
      <label class="field"><span>${esc(t('script_url'))}</span><input data-in="scriptUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(st.scriptUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="field"><span>${esc(t('secret'))}</span><input data-in="secret" type="password" autocomplete="off" value="${esc(st.secret)}"></label>
      <p class="muted small">${esc(t('secret_hint'))}</p>
      <div class="row"><button class="btn block" data-a="test-conn">${esc(t('test_connection'))}</button>
        <button class="btn block" data-a="refresh-program">${esc(t('refresh_program'))}</button></div>
      ${syncLine()}
      ${programBanner()}
    </div>
    <h2>${esc(t('weight_steps'))}</h2>
    <div class="card steps-list">${steps}</div>
    <h2>${esc(t('backup'))}</h2>
    <div class="card row">
      <button class="btn block" data-a="export">${esc(t('export_json'))}</button>
      <label class="btn block">${esc(t('import_json'))}<input type="file" accept="application/json,.json" data-in="import" hidden></label>
    </div>
    <p class="muted small center" style="margin-top:16px">${esc(t('version', { v: APP_VERSION }))}</p>`;
}

/* ---------- Модалки ---------- */

function openModal(m) { S.modal = m; renderModal(); }
function closeModal() { S.modal = null; renderModal(); }

function renderModal() {
  const m = S.modal;
  if (!m) { $modal.innerHTML = ''; return; }
  let inner = '';
  if (m.type === 'num') {
    inner = `<h3>${esc(m.title)}</h3><input class="numinput" id="numin" inputmode="${m.int ? 'numeric' : 'decimal'}" value="${esc(m.value)}" autocomplete="off">
      <div class="row" style="margin-top:12px"><button class="btn block" data-a="modal-close">${esc(t('cancel'))}</button>
      <button class="btn primary block" data-a="num-ok">${esc(t('ok'))}</button></div>`;
  } else if (m.type === 'options') {
    inner = `<h3>${esc(m.title)}</h3>${m.html || ''}${m.options.map((o, i) =>
      `<button class="opt ${o.danger ? 'danger' : ''}" data-a="opt" data-i="${i}">${esc(o.label)}</button>`).join('')}
      <button class="btn block" style="margin-top:8px" data-a="modal-close">${esc(t('close'))}</button>`;
  } else if (m.type === 'picker') {
    inner = pickerHtml();
  }
  $modal.innerHTML = `<div class="sheet-veil" data-a="veil"><div class="sheet" role="dialog">${inner}</div></div>`;
  if (m.type === 'num') {
    const el = document.getElementById('numin');
    el.focus(); el.select();
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doAction('num-ok', {}); });
  }
  if (m.type === 'picker') {
    const el = document.getElementById('pickq');
    el?.addEventListener('input', () => { S.ui.pickerQuery = el.value; document.getElementById('picklist').innerHTML = pickerList(); });
  }
}

function pickerList() {
  const lang = getLang();
  const q = S.ui.pickerQuery.trim().toLowerCase();
  const count = {};
  for (const w of S.workouts) for (const e of w.exercises) if (!e.skipped) count[e.exerciseId] = (count[e.exerciseId] || 0) + 1;
  const all = Object.values(S.program.exercises).filter((ex) => !q || ex.name.ru.toLowerCase().includes(q) || ex.name.en.toLowerCase().includes(q));
  const freq = all.filter((ex) => count[ex.id]).sort((a, b) => count[b.id] - count[a.id]).slice(0, 6);
  const rest = all.filter((ex) => !freq.includes(ex)).sort((a, b) => exName(a, lang).localeCompare(exName(b, lang), lang));
  const item = (ex) => `<button class="opt" data-a="pick-ex" data-id="${esc(ex.id)}">${esc(exName(ex, lang))}<span class="spacer"></span><span class="muted small">${esc(t(`type_${ex.type}`))}</span></button>`;
  return `${freq.length ? `<div class="muted small">${esc(t('frequent'))}</div>${freq.map(item).join('')}` : ''}
    <div class="muted small" style="margin-top:8px">${esc(t('all_exercises'))}</div>${rest.map(item).join('')}`;
}

function pickerHtml() {
  return `<h3>${esc(t('pick_exercise'))}</h3>
    <label class="field"><input id="pickq" placeholder="${esc(t('search'))}" value="${esc(S.ui.pickerQuery)}" autocomplete="off"></label>
    <div id="picklist" style="margin-top:8px">${pickerList()}</div>
    <button class="btn block" style="margin-top:8px" data-a="modal-close">${esc(t('close'))}</button>`;
}

let toastTimer = null;
function toast(msg, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${action ? `<button data-a="${action.a}">${esc(action.label)}</button>` : ''}</div>`;
  if (!action) toastTimer = setTimeout(() => { $toast.innerHTML = ''; }, 3000);
}

/* =========================================================
   Действия
   ========================================================= */

function setsOf(d) {
  const e = S.active.exercises[Number(d.ex)];
  return { e, s: d.set !== undefined ? e.sets[Number(d.set)] : null };
}

async function startWorkout(day) {
  if (S.active) return go('workout');
  S.active = createWorkout(day, S.program, S.workouts);
  await saveActive();
  go('workout');
}

async function finishWorkout() {
  const n = uncheckedSets(S.active);
  if (n) {
    openModal({
      type: 'options', title: t('unchecked_title', { n }),
      options: [
        { label: t('unchecked_mark'), run: () => mutate((w) => { for (const e of w.exercises) if (!e.skipped) for (const s of e.sets) if (!s.done) { s.done = true; s.doneAt = Date.now(); } }).then(toRating) },
        { label: t('unchecked_delete'), danger: true, run: () => mutate((w) => { for (const e of w.exercises) if (!e.skipped) e.sets = e.sets.filter((s) => s.done); }).then(toRating) },
        { label: t('back'), run: () => {} },
      ],
    });
    return;
  }
  toRating();
}

async function toRating() {
  await mutate((w) => {
    if (w.pausedAt) { w.pausedTotal += Date.now() - w.pausedAt; w.pausedAt = null; }
    w.endedAt = Date.now();
    w.rest = null;
    w.status = 'rating';
    if (!w.title) w.title = t('weekday_title', { day: dayName(w.day), weekday: weekdayName(w.startedAt) });
  });
  window.scrollTo(0, 0);
}

async function saveWorkout() {
  const w = S.active;
  const history = S.workouts;
  const lastBw = S.bodyweight[S.bodyweight.length - 1];
  const bw = w.ratings.bodyweight || lastBw?.kg || null;
  w.durationMs = elapsedMs(w);
  w.summary = computeSummary(w, history, S.program, bw);
  w.xp = workoutXp(w.summary);
  const before = computeAchievements(history, S.settings.target);
  w.status = 'done';
  const after = computeAchievements([...history, w], S.settings.target);
  w.newAchievements = Object.keys(after).filter((k) => !before[k]);
  w.xp += 50 * w.newAchievements.length;
  const shown = (await db.kvGet('shownFacts')) || [];
  w.fact = pickFact(factCandidates(w, history, S.program, S.settings.target), shown);
  if (w.fact) await db.kvSet('shownFacts', [w.fact.id, ...shown].slice(0, 8));

  await db.put('workouts', w);
  if (w.ratings.bodyweight) {
    const entry = { id: w.id, date: w.startedAt, kg: w.ratings.bodyweight, workoutId: w.id };
    await db.put('bodyweight', entry);
    S.bodyweight.push(entry);
  }
  await enqueue(w, S.program);
  S.workouts = [...history, w];
  S.active = null;
  await saveActive();
  await refreshQueue();
  go(`summary/${w.id}`);
  runSync(true);
}

function exMenu(ei) {
  const e = S.active.exercises[ei];
  const ex = exDef(e.exerciseId);
  const opts = [
    { label: `⏱ ${t('rest_timer')} (${fmtDuration(e.restSec * 1000)})`, run: () => startRest(ei) },
    { label: t('add_warmup'), run: () => mutate((w) => { w.exercises[ei].sets.unshift(newSet(e.sets[0]?.weight || 0, e.sets[0]?.reps || 0, true)); }) },
  ];
  if (ei > 0) opts.push({ label: t('move_up'), run: () => mutate((w) => { const a = w.exercises; [a[ei - 1], a[ei]] = [a[ei], a[ei - 1]]; }) });
  if (ei < S.active.exercises.length - 1) opts.push({ label: t('move_down'), run: () => mutate((w) => { const a = w.exercises; [a[ei + 1], a[ei]] = [a[ei], a[ei + 1]]; }) });
  opts.push({ label: t('skip_exercise'), run: () => mutate((w) => { w.exercises[ei].skipped = true; }) });
  if (e.adhoc) opts.push({ label: t('remove_exercise'), danger: true, run: () => mutate((w) => { w.exercises.splice(ei, 1); }) });
  const note = ex?.notes?.[getLang()] ? `<p class="muted small">${esc(ex.notes[getLang()])}</p>` : '';
  openModal({ type: 'options', title: exName(ex, getLang()), html: note, options: opts });
}

function setMenu(ei, si) {
  const s = S.active.exercises[ei].sets[si];
  const rirBtns = [null, 0, 1, 2, 3, 4].map((v) =>
    `<button class="${s.rir === v ? 'on' : ''}" data-a="rir" data-ex="${ei}" data-set="${si}" data-v="${v === null ? '' : v}">${v === null ? '—' : v}</button>`).join('');
  openModal({
    type: 'options', title: t('set_menu', { n: si + 1 }),
    html: `<div class="field" style="margin-bottom:8px"><span>${esc(t('rir'))}</span><div class="mini-seg">${rirBtns}</div></div>`,
    options: [
      { label: s.warmup ? t('mark_work') : t('mark_warmup'), run: () => mutate((w) => { const x = w.exercises[ei].sets[si]; x.warmup = !x.warmup; }) },
      { label: t('delete_set'), danger: true, run: () => mutate((w) => { w.exercises[ei].sets.splice(si, 1); }) },
    ],
  });
}

function startRest(ei) {
  const e = S.active.exercises[ei];
  mutate((w) => { w.rest = { endsAt: Date.now() + e.restSec * 1000, duration: e.restSec * 1000 }; });
}

function openNum(d) {
  const { e, s } = setsOf(d);
  const ex = exDef(e.exerciseId);
  const isW = d.field === 'weight';
  openModal({
    type: 'num',
    title: isW ? (ex?.type === 'bodyweight' ? t('enter_added') : t('enter_weight')) : t('enter_reps'),
    value: isW ? String(s.weight).replace('.', getLang() === 'ru' ? ',' : '.') : String(s.reps),
    int: !isW,
    target: { ex: d.ex, set: d.set, field: d.field },
  });
}

async function exportBackup() {
  const [workouts, bodyweight, queue, program] = await Promise.all([db.getAll('workouts'), db.getAll('bodyweight'), db.getAll('queue'), db.kvGet('program')]);
  const { scriptUrl, secret, ...safeSettings } = S.settings; // URL и секрет в файл не пишем
  const data = { app: 'gym-log', format: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), settings: safeSettings, workouts, bodyweight, queue, program };
  const name = `gymlog-backup-${ymd(Date.now())}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'gym-log' || !Array.isArray(data.workouts)) throw new Error('bad');
    const have = new Set((await db.getAll('workouts')).map((w) => w.id));
    let n = 0;
    for (const w of data.workouts) if (w && w.id && !have.has(w.id)) { await db.put('workouts', w); n++; }
    for (const b of data.bodyweight || []) if (b && b.id) await db.put('bodyweight', b);
    const haveQ = new Set((await db.getAll('queue')).map((q) => q.id));
    for (const q of data.queue || []) if (q && q.id && !haveQ.has(q.id)) await db.put('queue', { ...q, nextAt: 0 });
    if (data.program && S.program.source === 'default') await db.kvSet('program', data.program);
    await loadAll();
    toast(t('imported', { n }));
    render();
    runSync(true);
  } catch {
    toast(t('import_bad'));
  }
}

const ACTIONS = {
  'go': (d) => go(d.to),
  'open-active': () => go('workout'),
  'start': (d) => startWorkout(d.day),
  'toggle-done': (d) => mutate(() => { const { s } = setsOf(d); s.done = !s.done; s.doneAt = s.done ? Date.now() : null; }),
  'step': (d) => mutate(() => {
    const { e, s } = setsOf(d);
    const dir = Number(d.dir);
    if (d.field === 'weight') s.weight = clean(Math.max(0, s.weight + dir * weightStepFor(exDef(e.exerciseId), S.settings)));
    else s.reps = Math.max(0, s.reps + dir);
  }),
  'add-set': (d) => mutate((w) => {
    const e = w.exercises[Number(d.ex)];
    const lastWork = [...e.sets].reverse().find((s) => !s.warmup) || e.sets[e.sets.length - 1];
    e.sets.push(newSet(lastWork?.weight || 0, lastWork?.reps || e.repMin, false));
  }),
  'ex-menu': (d) => exMenu(Number(d.ex)),
  'set-menu': (d) => setMenu(Number(d.ex), Number(d.set)),
  'unskip': (d) => mutate((w) => { w.exercises[Number(d.ex)].skipped = false; }),
  'rest-start': (d) => startRest(Number(d.ex)),
  'rest-adj': (d) => mutate((w) => { if (w.rest) { w.rest.endsAt += Number(d.d) * 1000; w.rest.duration = Math.max(15000, w.rest.duration + Number(d.d) * 1000); } }),
  'rest-stop': () => mutate((w) => { w.rest = null; }),
  'pause': () => mutate((w) => { w.pausedAt = Date.now(); }),
  'resume': () => mutate((w) => { if (w.pausedAt) { w.pausedTotal += Date.now() - w.pausedAt; w.pausedAt = null; } }),
  'add-ex': () => { S.ui.pickerQuery = ''; openModal({ type: 'picker' }); },
  'pick-ex': (d) => { closeModal(); mutate((w) => { w.exercises.push(adhocExercise(exDef(d.id), S.workouts)); }); },
  'finish': () => finishWorkout(),
  'discard': () => openModal({
    type: 'options', title: t('discard_q'),
    options: [
      { label: t('discard_yes'), danger: true, run: async () => { S.active = null; await saveActive(); go('home'); } },
      { label: t('back'), run: () => {} },
    ],
  }),
  'rate': (d) => mutate((w) => { const v = Number(d.v); w.ratings[d.k] = w.ratings[d.k] === v ? null : v; }),
  'back-set': (d) => mutate((w) => { const v = d.v === '1'; w.ratings.backOk = w.ratings.backOk === v ? null : v; }),
  'back-to-workout': () => mutate((w) => { w.status = 'active'; w.endedAt = null; }),
  'save-workout': () => saveWorkout(),
  'rir': (d) => { mutate((w) => { w.exercises[Number(d.ex)].sets[Number(d.set)].rir = d.v === '' ? null : Number(d.v); }); closeModal(); },
  'opt': async (d) => { const o = S.modal.options[Number(d.i)]; closeModal(); await o.run(); },
  'modal-close': () => closeModal(),
  'veil': (d, ev) => { if (ev.target.classList.contains('sheet-veil')) closeModal(); },
  'num-ok': () => {
    const m = S.modal;
    const v = toNum(document.getElementById('numin').value, NaN);
    closeModal();
    if (!Number.isFinite(v) || v < 0) return;
    mutate(() => { const { s } = setsOf(m.target); if (m.target.field === 'weight') s.weight = clean(v); else s.reps = Math.round(v); });
  },
  'htab': (d) => { S.ui.historyTab = d.tab; render(); },
  'cal': (d) => { S.ui.calOffset += Number(d.d); render(); },
  'lang': (d) => { S.settings.lang = d.v; setLang(d.v); saveSettings(); render(); },
  'target': (d) => { S.settings.target = Number(d.v); saveSettings(); render(); },
  'wstep': (d) => { S.settings.weightSteps = { ...S.settings.weightSteps, [d.id]: Number(d.v) }; saveSettings(); render(); },
  'test-conn': async () => {
    try { await api(S.settings, 'ping'); toast(t('conn_ok')); } catch (e) { toast(t('conn_fail', { e: e.message })); }
  },
  'refresh-program': () => fetchProgram({ silent: false }),
  'sync-now': () => runSync(true),
  'export': () => exportBackup(),
  'reload': () => location.reload(),
};

function doAction(name, d, ev) {
  const fn = ACTIONS[name];
  if (fn) fn(d, ev);
}

/* ---------- События ---------- */

let suppressClick = false;
document.addEventListener('click', (ev) => {
  if (suppressClick) { suppressClick = false; ev.preventDefault(); ev.stopPropagation(); return; }
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  if (el.tagName === 'A') return;
  doAction(el.dataset.a, { ...el.dataset }, ev);
});

// Долгий тап по степперу — ввод числом.
let lpTimer = null, lpStart = null;
document.addEventListener('pointerdown', (ev) => {
  const el = ev.target.closest('[data-lp]');
  if (!el) return;
  lpStart = { x: ev.clientX, y: ev.clientY };
  lpTimer = setTimeout(() => {
    lpTimer = null;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 800);
    openNum({ ...el.dataset });
  }, 500);
});
const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
document.addEventListener('pointerup', cancelLp);
document.addEventListener('pointercancel', cancelLp);
document.addEventListener('pointermove', (ev) => {
  if (lpTimer && lpStart && Math.hypot(ev.clientX - lpStart.x, ev.clientY - lpStart.y) > 10) cancelLp();
});
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-lp]')) ev.preventDefault(); });

// Поля ввода: без перерисовки, но с сохранением.
let saveTimer = null;
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-in]');
  if (!el) return;
  const k = el.dataset.in;
  if (k === 'title' || k === 'comment' || k === 'bodyweight') {
    if (k === 'title') S.active.title = el.value;
    if (k === 'comment') S.active.ratings.comment = el.value;
    if (k === 'bodyweight') { const v = toNum(el.value, 0); S.active.ratings.bodyweight = v > 20 && v < 400 ? clean(v) : null; }
    clearTimeout(saveTimer); saveTimer = setTimeout(saveActive, 300);
  } else if (k === 'scriptUrl' || k === 'secret') {
    S.settings[k] = el.value.trim();
    clearTimeout(saveTimer); saveTimer = setTimeout(saveSettings, 300);
  }
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-in]');
  if (!el) return;
  if (el.dataset.in === 'chartEx') { S.ui.chartEx = el.value; render(); }
  if (el.dataset.in === 'import' && el.files[0]) importBackup(el.files[0]);
  if (el.dataset.in === 'scriptUrl' || el.dataset.in === 'secret') { saveSettings(); render(); }
});

/* ---------- Часы ---------- */

function tick() {
  const w = S.active;
  if (!w) return;
  const c = document.querySelector('[data-clock]');
  if (c) c.textContent = fmtDuration(elapsedMs(w));
  const bar = document.querySelector('[data-restbar]');
  if (bar && w.rest) {
    const left = w.rest.endsAt - Date.now();
    const over = left <= 0;
    bar.classList.toggle('over', over);
    bar.querySelector('[data-rest-t]').textContent = over ? `+${fmtDuration(-left)}` : fmtDuration(left + 999);
    bar.querySelector('[data-rest-label]').textContent = over ? t('rest_over') : t('rest');
    bar.querySelector('[data-rest-fill]').style.width = `${Math.min(100, Math.max(0, (1 - left / w.rest.duration) * 100))}%`;
  }
}
setInterval(tick, 1000);

/* =========================================================
   Старт
   ========================================================= */

async function boot() {
  await loadAll();
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (S.settings.scriptUrl && S.settings.secret) {
    fetchProgram();
    runSync();
  }
  window.addEventListener('online', () => { render(); runSync(true); fetchProgram(); });
  window.addEventListener('offline', () => render());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (S.queue.length) runSync(); } });
  setInterval(() => { if (S.queue.length) runSync(); }, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('update_ready'), { a: 'reload', label: t('reload') });
        });
      });
    }).catch(() => {});
  }
}

boot();
