// Подсказки двойной прогрессии. Только подсказки: вес никогда не меняется сам.
import { roundTo, clean } from './util.js';

/**
 * Прошлые сессии упражнения (новые первыми) для того же дня A/B.
 * Если истории нет — базовая запись из start_sets листа Program.
 * → [{ sets: [{weight, reps, rir}], backOk, baseline }]
 */
export function previousSessions(exerciseId, day, history, programDay) {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < 3; i--) {
    const w = history[i];
    if (w.day !== day) continue;
    const e = w.exercises.find((x) => x.exerciseId === exerciseId && !x.skipped);
    if (!e) continue;
    const sets = e.sets.filter((s) => s.done && !s.warmup);
    if (!sets.length) continue;
    out.push({ sets, backOk: w.ratings?.backOk ?? null, baseline: false, date: w.startedAt });
  }
  if (!out.length) {
    const pe = programDay?.find((p) => p.exerciseId === exerciseId);
    const sets = (pe?.startSets || []).filter((s) => !s.warmup).map((s) => ({ ...s, rir: null }));
    if (sets.length) out.push({ sets, backOk: null, baseline: true, date: null });
  }
  return out;
}

/** Провал: не выполнен минимум в нескольких (≥2) подходах подряд. */
export function isFailSession(session, repMin) {
  let run = 0;
  let best = 0;
  for (const s of session.sets) {
    run = s.reps < repMin ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best >= 2;
}

/**
 * Подсказка для упражнения.
 * entry: { repMin, repMax }, ex: определение упражнения, sessions: previousSessions(...)
 * → { kind, params, noFailure }
 *   kind: none | up | up_bw | reps | reps_bw | stay | reduce | back_rollback | need_back_ok | no_failure_repeat
 */
export function progressionHint(entry, ex, sessions, weightStep) {
  const noFailure = !!ex.noFailure;
  if (!sessions.length) return { kind: 'none', params: {}, noFailure };
  const last = sessions[0];
  const work = last.sets;
  if (!work.length) return { kind: 'none', params: {}, noFailure };

  const isBW = ex.type === 'bodyweight';
  const step = ex.progressStep || weightStep || 2.5;
  const rstep = weightStep || step;
  const top = Math.max(...work.map((s) => s.weight));
  const { repMin, repMax } = entry;

  // Спина: дискомфорт в прошлый раз → откат.
  if (ex.backCheck && last.backOk === false) {
    if (isBW || top <= 0) return { kind: 'back_rollback', params: { pct: 10 }, noFailure };
    return { kind: 'back_rollback', params: { pct: 10, to: clean(roundTo(top * 0.9, rstep)) }, noFailure };
  }

  const failLast = isFailSession(last, repMin);
  const failPrev = sessions[1] ? isFailSession(sessions[1], repMin) : false;
  if (failLast && failPrev && top > 0) {
    return {
      kind: 'reduce',
      params: { from: top, lo: clean(roundTo(top * 0.9, rstep)), hi: clean(roundTo(top * 0.95, rstep)), min: repMin },
      noFailure,
    };
  }
  if (failLast) return { kind: 'stay', params: { min: repMin }, noFailure };

  const allMax = work.every((s) => s.reps >= repMax);
  if (allMax) {
    if (ex.backCheck && last.backOk !== true) return { kind: 'need_back_ok', params: {}, noFailure };
    if (noFailure && work.some((s) => s.rir === 0)) return { kind: 'no_failure_repeat', params: {}, noFailure };
    return { kind: isBW ? 'up_bw' : 'up', params: { step }, noFailure };
  }
  if (isBW && top <= 0) return { kind: 'reps_bw', params: { max: repMax, step }, noFailure };
  return { kind: 'reps', params: { max: repMax }, noFailure };
}

/** Короткая строка «в прошлый раз»: 60×8 · 60×7 */
export function lastSetsText(session, isBW, fmt = (x) => String(x)) {
  if (!session) return '';
  return session.sets
    .map((s) => (isBW ? (s.weight > 0 ? `+${fmt(s.weight)}×${s.reps}` : `${s.reps}`) : `${fmt(s.weight)}×${s.reps}`))
    .join(' · ');
}
