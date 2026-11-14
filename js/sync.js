// Мост к Apps Script и офлайн-очередь. URL и секрет — только из локальных настроек.
import * as db from './db.js';
import { ymd, ymdhm, APP_VERSION } from './util.js';
import { setLoad } from './stats.js';

const TIMEOUT_MS = 25000;

export async function api(settings, action, extra = {}) {
  if (!settings.scriptUrl || !settings.secret) throw new Error('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(settings.scriptUrl, {
      method: 'POST',
      // text/plain — «простой» запрос без CORS preflight, Apps Script его принимает.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: settings.secret, action, ...extra }),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'server_error');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Тренировка → тело для doPost. */
export function buildPayload(w, program) {
  const bw = w.summary?.bw || null;
  const sets = [];
  let order = 0;
  for (const e of w.exercises) {
    if (e.skipped) continue;
    order++;
    const ex = program.exercises[e.exerciseId];
    const isBW = ex?.type === 'bodyweight';
    e.sets.forEach((s, i) => {
      sets.push({
        exercise_id: e.exerciseId,
        exercise_name: ex ? ex.name.ru : e.exerciseId,
        order,
        set_no: i + 1,
        is_warmup: !!s.warmup,
        weight_kg: isBW ? (bw ? setLoad(s, ex, bw) : '') : s.weight,
        is_bodyweight: isBW,
        added_kg: isBW ? s.weight : '',
        reps: s.reps,
        done: !!s.done,
        rir: s.rir,
        created_at: s.doneAt ? ymdhm(s.doneAt) : ymdhm(w.endedAt),
      });
    });
  }
  const r = w.ratings;
  const sm = w.summary;
  return {
    workout_id: w.id,
    date: ymd(w.startedAt),
    start: ymdhm(w.startedAt),
    end: ymdhm(w.endedAt),
    duration_min: Math.round(w.durationMs / 60000),
    day_type: w.day,
    title: w.title,
    feel_1_5: r.feel, sleep_1_5: r.sleep, food_1_3: r.food, mood_1_5: r.mood,
    back_ok: r.backOk,
    comment: r.comment || '',
    bodyweight_kg: r.bodyweight || '',
    volume_kg: sm.volume,
    volume_work_kg: sm.volumeWork,
    sets_count: sm.workSets,
    reps_count: sm.reps,
    prs_json: JSON.stringify(sm.prs),
    app_version: w.appVersion || APP_VERSION,
    sets,
  };
}

export async function enqueue(w, program) {
  await db.put('queue', { id: w.id, payload: buildPayload(w, program), attempts: 0, lastError: null, nextAt: 0, createdAt: Date.now() });
}

let running = false;

/**
 * Отправить всё из очереди. Повтор с экспоненциальной паузой.
 * Сервер идемпотентен по workout_id, поэтому повторная отправка безопасна.
 */
export async function processQueue(settings, { force = false, onChange } = {}) {
  if (running) return { skipped: true };
  running = true;
  const res = { sent: 0, failed: 0, duplicates: 0 };
  try {
    const items = (await db.getAll('queue')).sort((a, b) => a.createdAt - b.createdAt);
    for (const it of items) {
      if (!force && it.nextAt > Date.now()) continue;
      if (!settings.scriptUrl || !settings.secret) { res.failed++; continue; }
      try {
        const r = await api(settings, 'saveWorkout', { workout: it.payload });
        await db.del('queue', it.id);
        const w = await db.get('workouts', it.id);
        if (w) { w.syncedAt = Date.now(); await db.put('workouts', w); }
        res.sent++;
        if (r.duplicate) res.duplicates++;
      } catch (e) {
        it.attempts++;
        it.lastError = String(e.message || e);
        it.nextAt = Date.now() + Math.min(30 * 60000, 5000 * 2 ** Math.min(it.attempts, 8));
        await db.put('queue', it);
        res.failed++;
      }
      onChange?.();
    }
  } finally {
    running = false;
  }
  return res;
}
