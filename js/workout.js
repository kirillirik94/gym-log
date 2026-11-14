// Модель тренировки: создание из шаблона и прошлой такой же тренировки.
import { uuid, APP_VERSION } from './util.js';

export function newSet(weight = 0, reps = 0, warmup = false) {
  return { uid: uuid(), warmup, weight, reps, done: false, rir: null, doneAt: null };
}

export function lastWorkoutOfDay(history, day) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].day === day) return history[i];
  return null;
}

/** Последний раз, когда упражнение реально делалось (любой день). */
export function lastExerciseEntry(history, exerciseId) {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i].exercises.find((x) => x.exerciseId === exerciseId && !x.skipped && x.sets.some((s) => s.done));
    if (e) return { workout: history[i], entry: e };
  }
  return null;
}

/** Схема тяжёлая — лёгкая — тяжёлая: A B A A B A ... */
export function suggestNextDay(history, days = ['A', 'B']) {
  if (!days.includes('B')) return days[0] || 'A';
  const n = history.length;
  if (!n) return 'A';
  const last = history[n - 1].day;
  const prev = n > 1 ? history[n - 2].day : null;
  if (last === 'B') return 'A';
  if (last === 'A' && prev === 'A') return 'B';
  if (last === 'A' && prev === null) return 'B';
  return 'A';
}

export function exerciseFromTemplate(pe, prevEntry) {
  let sets;
  if (prevEntry && prevEntry.sets.length) {
    sets = prevEntry.sets.map((s) => newSet(s.weight, s.reps, s.warmup));
  } else if (pe.startSets && pe.startSets.length) {
    sets = pe.startSets.map((s) => newSet(s.weight, s.reps, s.warmup));
  } else {
    sets = Array.from({ length: pe.sets }, () => newSet(0, pe.repMin, false));
  }
  return {
    uid: uuid(),
    exerciseId: pe.exerciseId,
    repMin: pe.repMin,
    repMax: pe.repMax,
    restSec: pe.restSec,
    superset: pe.superset || '',
    notes: pe.notes || { ru: '', en: '' },
    skipped: false,
    adhoc: false,
    sets,
  };
}

export function createWorkout(day, program, history, now = Date.now()) {
  const tpl = program.days[day] || [];
  const prev = lastWorkoutOfDay(history, day);
  const exercises = tpl.map((pe) => {
    const prevEntry = prev?.exercises.find((e) => e.exerciseId === pe.exerciseId && !e.skipped && e.sets.length);
    return exerciseFromTemplate(pe, prevEntry);
  });
  return {
    id: uuid(),
    day,
    title: '',
    status: 'active', // active → rating → done
    startedAt: now,
    endedAt: null,
    pausedTotal: 0,
    pausedAt: null,
    exercises,
    rest: null,
    ratings: { feel: null, sleep: null, food: null, mood: null, backOk: null, comment: '', bodyweight: null },
    appVersion: APP_VERSION,
  };
}

/** Упражнение, добавленное вручную: подходы из последнего раза или 3 пустых. */
export function adhocExercise(ex, history) {
  const last = lastExerciseEntry(history, ex.id);
  const pe = {
    exerciseId: ex.id,
    repMin: last?.entry.repMin ?? 8,
    repMax: last?.entry.repMax ?? 12,
    restSec: ex.restSec,
    sets: 3,
    startSets: [],
    notes: ex.notes,
  };
  const e = exerciseFromTemplate(pe, last?.entry);
  e.adhoc = true;
  return e;
}

export function elapsedMs(w, now = Date.now()) {
  const end = w.endedAt || now;
  const paused = w.pausedTotal + (w.pausedAt ? end - w.pausedAt : 0);
  return Math.max(0, end - w.startedAt - paused);
}

export function uncheckedSets(w) {
  let n = 0;
  for (const e of w.exercises) if (!e.skipped) for (const s of e.sets) if (!s.done) n++;
  return n;
}

export function usesBackCheck(w, program) {
  return w.exercises.some((e) => !e.skipped && program.exercises[e.exerciseId]?.backCheck && e.sets.some((s) => s.done));
}
